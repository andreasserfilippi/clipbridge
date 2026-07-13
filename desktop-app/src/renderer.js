const CHANNEL = 'clipbridge';
const EVENT = 'new-clipboard-entry';

const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const onboardingEl = document.getElementById('onboarding');
const mainViewEl = document.getElementById('main-view');
const historyEl = document.getElementById('history');
const toastEl = document.getElementById('toast');

let config = null;
// Prevents an overlapping send if the floating button is clicked again
// while a previous upload (e.g. a slow image) is still in flight.
let isSyncing = false;

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function arrayBufferToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function setStatus(text, cls) {
  statusText.textContent = text;
  statusDot.className = cls || '';
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1500);
}

function loadConfig() {
  return {
    baseUrl: window.native.storeGet('baseUrl'),
    apiKey: window.native.storeGet('apiKey'),
    pusherKey: window.native.storeGet('pusherKey'),
    pusherCluster: window.native.storeGet('pusherCluster'),
    blobToken: window.native.storeGet('blobToken'),
    deviceName: window.native.storeGet('deviceName'),
  };
}

function isConfigComplete(c) {
  return !!(c && c.baseUrl && c.apiKey && c.pusherKey && c.pusherCluster && c.blobToken && c.deviceName);
}

// ---------- Onboarding ----------

function showOnboarding() {
  onboardingEl.style.display = 'block';
  mainViewEl.style.display = 'none';
  setStatus('Setup required', '');
}

document.getElementById('fill-from-code').addEventListener('click', () => {
  const errorEl = document.getElementById('setup-error');
  const raw = document.getElementById('f-setup-code').value.trim();
  if (!raw) {
    errorEl.textContent = 'Paste a setup code first.';
    return;
  }
  try {
    const decoded = JSON.parse(atob(raw));
    document.getElementById('f-baseUrl').value = decoded.baseUrl || '';
    document.getElementById('f-apiKey').value = decoded.apiKey || '';
    document.getElementById('f-pusherKey').value = decoded.pusherKey || '';
    document.getElementById('f-pusherCluster').value = decoded.pusherCluster || '';
    document.getElementById('f-blobToken').value = decoded.blobToken || '';
    errorEl.textContent = '';
    document.getElementById('f-deviceName').focus();
  } catch (err) {
    errorEl.textContent = 'That setup code looks invalid — check you copied all of it.';
  }
});

document.getElementById('save-setup').addEventListener('click', () => {
  const vals = {
    baseUrl: document.getElementById('f-baseUrl').value.trim().replace(/\/$/, ''),
    apiKey: document.getElementById('f-apiKey').value.trim(),
    pusherKey: document.getElementById('f-pusherKey').value.trim(),
    pusherCluster: document.getElementById('f-pusherCluster').value.trim(),
    blobToken: document.getElementById('f-blobToken').value.trim(),
    deviceName: document.getElementById('f-deviceName').value.trim(),
  };
  const errorEl = document.getElementById('setup-error');
  if (!isConfigComplete(vals)) {
    errorEl.textContent = 'All fields are required.';
    return;
  }
  errorEl.textContent = '';
  Object.keys(vals).forEach((k) => window.native.storeSet(k, vals[k]));
  config = vals;
  startApp();
});

// ---------- History rendering ----------

function timeAgo(ts) {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  return days + 'd ago';
}

function imageSrc(entry) {
  // Images are stored either as a Blob storage URL (current clients) or,
  // for older entries, inline base64 (legacy, from before Blob storage).
  return entry.content.startsWith('http')
    ? entry.content
    : 'data:image/png;base64,' + entry.content;
}

function renderHistory(entries) {
  if (!entries || entries.length === 0) {
    historyEl.innerHTML = '<div class="empty">No clipboard history yet.</div>';
    return;
  }
  historyEl.innerHTML = '';
  for (const entry of entries) {
    const div = document.createElement('div');
    div.className = 'entry';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'content';
    if (entry.type === 'image') {
      const img = document.createElement('img');
      img.src = imageSrc(entry);
      contentDiv.appendChild(img);
    } else {
      contentDiv.textContent = entry.content;
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = entry.device + ' · ' + timeAgo(entry.timestamp);

    div.appendChild(contentDiv);
    div.appendChild(meta);
    div.addEventListener('click', () => copyEntryToClipboard(entry, true));
    historyEl.appendChild(div);
  }
}

async function copyEntryToClipboard(entry, isManual) {
  try {
    if (entry.type === 'image') {
      const res = await fetch(imageSrc(entry));
      const base64 = arrayBufferToBase64(await res.arrayBuffer());
      window.native.writeClipboardImageBase64(base64);
    } else {
      window.native.writeClipboardText(entry.content);
    }
    if (isManual) showToast('Copied');
    return { ok: true };
  } catch (err) {
    if (isManual) showToast('Copy failed');
    return { ok: false, error: err.message };
  }
}

async function refreshHistory() {
  try {
    const res = await fetch(config.baseUrl + '/api/clipboard/history', {
      headers: { 'x-api-key': config.apiKey },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    renderHistory(data.entries || []);
    // This window stays hidden once configured — the floating overlay is
    // the one actually showing history, so it needs a copy of this too.
    window.native.reportHistoryUpdated(data.entries || []);
  } catch (err) {
    historyEl.innerHTML = '<div class="empty">Failed to load history: ' + err.message + '</div>';
  }
}

// ---------- Sending: manual only, triggered by the floating button ----------
// Nothing here runs automatically. Copying to the clipboard does nothing by
// itself — a sync only happens when the floating button is clicked, which
// reads whatever is on the clipboard at that moment and sends it, same as
// tapping "Copy Text"/"Copy Image" in the iOS Shortcuts.

async function uploadImageToBlob(base64) {
  const bytes = base64ToUint8Array(base64);
  const res = await fetch('https://blob.vercel-storage.com/clipboard-image.png', {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + config.blobToken },
    body: bytes,
  });
  if (!res.ok) throw new Error('Blob upload failed: HTTP ' + res.status);
  const data = await res.json();
  return data.url;
}

async function postEntry(content, type) {
  const res = await fetch(config.baseUrl + '/api/clipboard', {
    method: 'POST',
    headers: { 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, type, device: config.deviceName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'HTTP ' + res.status);
  }
  return res.json();
}

async function performManualSync() {
  if (isSyncing) return { ok: false, error: 'Already sending' };
  isSyncing = true;
  try {
    const formats = window.native.readClipboardFormats();
    const hasImage = formats.some((f) => f.startsWith('image/'));

    if (hasImage) {
      const base64 = window.native.readClipboardImageBase64();
      if (!base64) return { ok: false, error: 'Clipboard is empty' };
      setStatus('Sending image…', 'connected');
      const url = await uploadImageToBlob(base64);
      await postEntry(url, 'image');
      setStatus('Connected', 'connected');
      refreshHistory();
      return { ok: true };
    }

    const text = window.native.readClipboardText();
    if (!text) return { ok: false, error: 'Clipboard is empty' };
    setStatus('Sending…', 'connected');
    await postEntry(text, 'text');
    setStatus('Connected', 'connected');
    refreshHistory();
    return { ok: true };
  } catch (err) {
    setStatus('Send failed: ' + err.message, 'error');
    return { ok: false, error: err.message };
  } finally {
    isSyncing = false;
  }
}

// ---------- Receiving: Pusher (no polling) ----------

function connectPusher() {
  const pusherClient = new Pusher(config.pusherKey, { cluster: config.pusherCluster });
  const channel = pusherClient.subscribe(CHANNEL);

  pusherClient.connection.bind('connected', () => setStatus('Connected', 'connected'));
  pusherClient.connection.bind('unavailable', () => setStatus('Disconnected', 'error'));
  pusherClient.connection.bind('failed', () => setStatus('Connection failed', 'error'));

  channel.bind(EVENT, async (entry) => {
    if (entry.device === config.deviceName) return; // our own echo
    await copyEntryToClipboard(entry, false);
    showToast('Received from ' + entry.device);
    refreshHistory();
  });
}

// ---------- Boot ----------

function startApp() {
  onboardingEl.style.display = 'none';
  mainViewEl.style.display = 'flex';
  setStatus('Connecting…', '');

  connectPusher();
  refreshHistory();

  // The floating overlay is the actual UI now; this window just holds the
  // config and does the network work in the background. Everything below
  // relays through main.js to and from that overlay.
  window.native.onManualSyncTrigger(async () => {
    const result = await performManualSync();
    window.native.reportSyncResult(result);
  });
  window.native.onRequestHistoryRefresh(() => refreshHistory());
  window.native.onCopyEntryTrigger(async (entry) => {
    const result = await copyEntryToClipboard(entry, false);
    window.native.reportCopyResult(result);
  });

  window.native.notifyReady();
}

config = loadConfig();
if (isConfigComplete(config)) {
  startApp();
} else {
  showOnboarding();
}
