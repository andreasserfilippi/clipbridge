const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floatingNative', {
  triggerSync: () => ipcRenderer.send('floating-button-clicked'),
  onSyncResult: (callback) => ipcRenderer.on('sync-result', (event, result) => callback(result)),
  getPosition: () => ipcRenderer.invoke('floating-get-position'),
  // Fire-and-forget — called continuously during a drag, doesn't need a reply.
  moveTo: (x, y) => ipcRenderer.send('floating-window-move', { x, y }),
  dragEnded: (x, y) => ipcRenderer.send('floating-window-drag-ended', { x, y }),

  toggleExpand: () => ipcRenderer.send('floating-toggle-expand'),
  onSetExpanded: (callback) => ipcRenderer.on('set-expanded', (event, expanded) => callback(expanded)),
  onHistoryUpdated: (callback) => ipcRenderer.on('history-updated', (event, entries) => callback(entries)),
  copyEntry: (entry) => ipcRenderer.send('floating-copy-entry', entry),
  onCopyResult: (callback) => ipcRenderer.on('copy-result', (event, result) => callback(result)),
  // Deletes everywhere (Redis, Blob if it was an image, every other
  // connected client via Pusher), not just from this list — the actual
  // removal from view happens when the resulting history-updated event
  // comes back, same as any other real-time change. This result is only
  // for surfacing a failure; success has no separate feedback since
  // watching the entry disappear from the list already is the feedback.
  deleteEntry: (id) => ipcRenderer.send('floating-delete-entry', id),
  onDeleteResult: (callback) => ipcRenderer.on('delete-result', (event, result) => callback(result)),

  // Always-reachable path to editing setup (backend URL, keys, etc.) or
  // starting over, without needing to find the tray icon.
  openSettings: () => ipcRenderer.send('floating-open-settings'),

  // Opt-in: sends every new copy automatically while on, instead of
  // needing a click each time. Never persists across restarts (always
  // off on launch) — see main.js for why.
  toggleAutoSend: () => ipcRenderer.send('floating-toggle-auto-send'),
  onAutoSendStateChanged: (callback) => ipcRenderer.on('auto-send-state-changed', (event, enabled) => callback(enabled)),
});
