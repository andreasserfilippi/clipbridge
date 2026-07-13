const { app, Tray, Menu, BrowserWindow, nativeImage, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');

// electron-store's renderer/preload usage relies on an IPC listener that's
// only registered via this explicit call — without it, `new Store()` in
// preload.js hangs forever waiting on a synchronous IPC call the main
// process never answers.
require('electron-store').initRenderer();

const store = new Store();

const COLLAPSED_SIZE = 64;
const EXPANDED_WIDTH = 320;
const EXPANDED_HEIGHT = 460;

let tray = null;
let mainWindow = null;
let floatingWindow = null;
let isExpanded = false;
let wasConfiguredAtLaunch = false;
let collapsedPos = null;
// Separate from collapsedPos so the circle and the expanded panel can each
// be dragged to their own spot without fighting over one remembered place.
let expandedPos = null;

function isConfigured() {
  return !!(store.get('baseUrl') && store.get('apiKey') && store.get('pusherKey') &&
    store.get('pusherCluster') && store.get('blobToken') && store.get('deviceName'));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// mainWindow only handles first-run setup now. Day to day, the floating
// overlay is the entire UI — this window stays hidden and just keeps the
// account config, the Pusher connection, and the upload/history logic
// running in the background (hidden Electron windows keep executing their
// renderer JS, they just don't paint anything).
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 560,
    show: false,
    resizable: false,
    title: 'ClipBridge Setup',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // The preload script needs to require('electron-store'), which the
      // default sandbox blocks (only Electron's built-ins are allowed
      // there). Trusted, local-only content — the renderer itself still
      // has no Node access, only what preload explicitly exposes.
      sandbox: false,
    },
  });

  mainWindow.webContents.on('did-fail-load', (event, code, description, url) => {
    console.error('Failed to load', url, code, description);
  });
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer process gone:', details.reason);
    // Rare native crashes (observed: Electron's clipboard.readImage() can
    // crash on certain malformed clipboard image data — a hard process
    // crash, not a catchable JS exception) would otherwise leave the
    // window permanently blank since nothing else reloads it. Self-heal
    // instead of staying dead.
    if (details.reason !== 'clean-exit') {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadFile(path.join(__dirname, 'index.html'));
        }
      }, 500);
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  if (process.env.CLIPBRIDGE_DEBUG) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Closing the window just hides it — the app keeps running in the tray.
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function defaultCollapsedPosition() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  return { x: x + width - COLLAPSED_SIZE - 24, y: y + height - COLLAPSED_SIZE - 24 };
}

// The expanded history panel anchors to whichever corner the collapsed
// circle is currently sitting in, growing away from the nearest screen
// edge so it never opens off-screen no matter where the button was dragged.
function computeExpandedBounds(circlePos) {
  const display = screen.getDisplayNearestPoint({
    x: circlePos.x + COLLAPSED_SIZE / 2,
    y: circlePos.y + COLLAPSED_SIZE / 2,
  });
  const area = display.workArea;
  const circleCenterX = circlePos.x + COLLAPSED_SIZE / 2;
  const circleCenterY = circlePos.y + COLLAPSED_SIZE / 2;
  const displayCenterX = area.x + area.width / 2;
  const displayCenterY = area.y + area.height / 2;

  let x = circleCenterX < displayCenterX ? circlePos.x : circlePos.x + COLLAPSED_SIZE - EXPANDED_WIDTH;
  let y = circleCenterY < displayCenterY ? circlePos.y : circlePos.y + COLLAPSED_SIZE - EXPANDED_HEIGHT;

  x = Math.max(area.x, Math.min(x, area.x + area.width - EXPANDED_WIDTH));
  y = Math.max(area.y, Math.min(y, area.y + area.height - EXPANDED_HEIGHT));

  return { x: Math.round(x), y: Math.round(y), width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT };
}

// Keeps a remembered position on-screen even if it was saved on a display
// that's since been unplugged or resized.
function clampToNearestDisplay(pos, width, height) {
  const display = screen.getDisplayNearestPoint({ x: pos.x + width / 2, y: pos.y + height / 2 });
  const area = display.workArea;
  return {
    x: Math.round(Math.max(area.x, Math.min(pos.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(pos.y, area.y + area.height - height))),
  };
}

function createFloatingWindow() {
  collapsedPos = store.get('floatingPos') || defaultCollapsedPosition();
  expandedPos = store.get('expandedPos') || null;

  floatingWindow = new BrowserWindow({
    width: COLLAPSED_SIZE,
    height: COLLAPSED_SIZE,
    x: collapsedPos.x,
    y: collapsedPos.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false, // repositioned manually via IPC, not OS window dragging
    alwaysOnTop: true,
    skipTaskbar: true,
    // Doesn't take OS keyboard focus when clicked, so it never interrupts
    // whatever the user was typing into when they click it.
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'floating-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  floatingWindow.setAlwaysOnTop(true, 'screen-saver');
  floatingWindow.loadFile(path.join(__dirname, 'floating.html'));
  if (process.env.CLIPBRIDGE_DEBUG) {
    floatingWindow.webContents.on('console-message', (event, level, message) => {
      console.log('[floating console]', message);
    });
  }

  floatingWindow.on('closed', () => {
    floatingWindow = null;
  });
}

function setExpanded(expanded) {
  if (!floatingWindow || floatingWindow.isDestroyed()) return;
  isExpanded = expanded;
  if (expanded) {
    // Once it's been dragged somewhere, the panel reopens there — same as
    // the circle remembering where it was left — rather than always
    // snapping back to the auto-anchored corner.
    const bounds = expandedPos
      ? { ...clampToNearestDisplay(expandedPos, EXPANDED_WIDTH, EXPANDED_HEIGHT), width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT }
      : computeExpandedBounds(collapsedPos);
    expandedPos = { x: bounds.x, y: bounds.y };
    floatingWindow.setBounds(bounds);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('request-history-refresh');
    }
  } else {
    floatingWindow.setBounds({ x: collapsedPos.x, y: collapsedPos.y, width: COLLAPSED_SIZE, height: COLLAPSED_SIZE });
  }
  floatingWindow.webContents.send('set-expanded', expanded);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('ClipBridge');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Settings…', click: () => mainWindow.show() },
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (menuItem) => app.setLoginItemSettings({ openAtLogin: menuItem.checked }),
    },
    {
      label: 'Show Floating Button',
      type: 'checkbox',
      checked: true,
      click: (menuItem) => {
        if (!floatingWindow) return;
        if (menuItem.checked) floatingWindow.show();
        else floatingWindow.hide();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit ClipBridge',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

// ---------- Floating overlay IPC ----------
// Sending never happens automatically — only an explicit click reads the
// clipboard and sends it, the same one-tap model as the iOS Shortcuts. This
// window is a thin client: mainWindow (hidden, in the background) holds the
// account config and does the actual network work; everything here relays
// through main.js.

ipcMain.on('floating-button-clicked', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('trigger-manual-sync');
  }
});

ipcMain.on('sync-result-from-main-window', (event, result) => {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.webContents.send('sync-result', result);
  }
});

ipcMain.on('floating-toggle-expand', () => setExpanded(!isExpanded));

ipcMain.on('history-updated', (event, entries) => {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.webContents.send('history-updated', entries);
  }
});

ipcMain.on('floating-copy-entry', (event, entry) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('trigger-copy-entry', entry);
  }
});

ipcMain.on('copy-result-from-main-window', (event, result) => {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.webContents.send('copy-result', result);
  }
});

ipcMain.on('renderer-ready', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  // Only right after a fresh setup, never on a normal launch of an
  // already-configured install — asked once, respected from then on.
  if (!wasConfiguredAtLaunch && !store.get('loginItemConfigured')) {
    promptLoginItem();
  }
});

function promptLoginItem() {
  store.set('loginItemConfigured', true); // don't ask again regardless of the answer
  dialog
    .showMessageBox({
      type: 'question',
      buttons: ['Launch at Login', 'Not Now'],
      defaultId: 0,
      cancelId: 1,
      title: 'ClipBridge',
      message: 'Launch ClipBridge automatically when you log in?',
      detail: 'You can change this anytime from the tray menu.',
    })
    .then((result) => {
      const enable = result.response === 0;
      app.setLoginItemSettings({
        openAtLogin: enable,
        path: process.execPath,
        args: app.isPackaged ? [] : [path.resolve(__dirname, '..')],
      });
    });
}

ipcMain.handle('floating-get-position', () => (floatingWindow ? floatingWindow.getPosition() : [0, 0]));

// The circle (collapsed) and the panel's header bar (expanded) both drag
// the same underlying window — which stored position gets updated just
// depends on which state it's currently in.
ipcMain.on('floating-window-move', (event, { x, y }) => {
  if (!floatingWindow || floatingWindow.isDestroyed()) return;
  const pos = { x: Math.round(x), y: Math.round(y) };
  if (isExpanded) {
    expandedPos = pos;
  } else {
    collapsedPos = pos;
  }
  floatingWindow.setPosition(pos.x, pos.y);
});

ipcMain.on('floating-window-drag-ended', (event, { x, y }) => {
  const pos = { x: Math.round(x), y: Math.round(y) };
  if (isExpanded) {
    expandedPos = pos;
    store.set('expandedPos', pos);
  } else {
    collapsedPos = pos;
    store.set('floatingPos', pos);
  }
});

app.whenReady().then(() => {
  // The custom UI doesn't need Electron's default File/Edit/View/Window
  // menu bar — it's unstyled chrome that doesn't belong here.
  Menu.setApplicationMenu(null);

  // Without this, macOS shows the app in the Dock and Cmd+Tab like a normal
  // foreground application. This is meant to be a menu-bar-only background
  // utility — same intent as `skipTaskbar` on the floating window for
  // Windows, just macOS's separate mechanism for the same thing.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  // Whether login-item is offered as a prompt (fresh setup) or left alone
  // entirely (already-configured install, every normal launch after that)
  // depends on this being captured before onboarding could possibly run.
  wasConfiguredAtLaunch = isConfigured();

  createWindow();
  // Only first-run setup needs the window visible; once configured, the
  // floating overlay is the entire UI and this stays hidden in the
  // background (renderer-ready below also hides it after a fresh setup).
  if (!wasConfiguredAtLaunch) mainWindow.show();

  createFloatingWindow();
  try {
    createTray();
  } catch (err) {
    console.error('Tray creation failed:', err);
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

// Background app — stay running when all windows are closed/hidden.
app.on('window-all-closed', (event) => {
  event.preventDefault();
});
