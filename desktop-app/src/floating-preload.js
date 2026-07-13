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

  // Always-reachable path to editing setup (backend URL, keys, etc.) or
  // starting over, without needing to find the tray icon.
  openSettings: () => ipcRenderer.send('floating-open-settings'),
});
