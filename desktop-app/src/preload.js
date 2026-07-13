const { contextBridge, ipcRenderer, clipboard, nativeImage } = require('electron');
const Store = require('electron-store');

const store = new Store();

// Exposes a minimal, safe surface to the isolated renderer world — no
// direct Node/Electron access there, only these specific operations.
contextBridge.exposeInMainWorld('native', {
  storeGet: (key) => store.get(key),
  storeSet: (key, value) => store.set(key, value),
  // Full local reset (re-onboarding after e.g. switching to a new backend
  // deployment) — wipes everything, not just the account fields, since a
  // half-cleared store is worse than a fully fresh one.
  storeClear: () => store.clear(),
  restartApp: () => ipcRenderer.send('request-restart'),

  readClipboardFormats: () => clipboard.availableFormats(),
  readClipboardText: () => clipboard.readText(),
  writeClipboardText: (text) => clipboard.writeText(text),

  // Images cross the bridge as base64 strings (Buffers don't serialize
  // cleanly through contextBridge).
  readClipboardImageBase64: () => {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    return img.toPNG().toString('base64');
  },
  writeClipboardImageBase64: (base64) => {
    const buf = Buffer.from(base64, 'base64');
    clipboard.writeImage(nativeImage.createFromBuffer(buf));
  },

  // The floating button lives in its own window (main.js); a click there is
  // forwarded here since this window already holds the account config.
  onManualSyncTrigger: (callback) => ipcRenderer.on('trigger-manual-sync', () => callback()),
  reportSyncResult: (result) => ipcRenderer.send('sync-result-from-main-window', result),

  // Once set up, this window stays hidden and just keeps history and the
  // Pusher connection alive in the background — the floating overlay is the
  // actual UI. These forward that data to it and relay its requests back.
  notifyReady: () => ipcRenderer.send('renderer-ready'),
  reportHistoryUpdated: (entries) => ipcRenderer.send('history-updated', entries),
  onRequestHistoryRefresh: (callback) => ipcRenderer.on('request-history-refresh', () => callback()),
  onCopyEntryTrigger: (callback) => ipcRenderer.on('trigger-copy-entry', (event, entry) => callback(entry)),
  reportCopyResult: (result) => ipcRenderer.send('copy-result-from-main-window', result),

  // Tray "Settings…" and the floating panel's settings button both reveal
  // this window then send this so it jumps straight to the editable form
  // instead of whatever it already had showing (history, once configured).
  onOpenSettingsRequested: (callback) => ipcRenderer.on('open-settings-view', () => callback()),
});
