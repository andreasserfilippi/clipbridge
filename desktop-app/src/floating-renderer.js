const btn = document.getElementById('btn');
const expandHandle = document.getElementById('expand-handle');
const collapsedEl = document.getElementById('collapsed');
const expandedEl = document.getElementById('expanded');
const panelHeader = document.querySelector('.panel-header');
const miniSend = document.getElementById('mini-send');
const autoToggle = document.getElementById('auto-toggle');
const settingsBtn = document.getElementById('settings-btn');
const collapseBtn = document.getElementById('collapse-btn');
const panelHistory = document.getElementById('panel-history');
const panelStatusDot = document.getElementById('panel-status-dot');
const panelToast = document.getElementById('panel-toast');

let latestEntries = [];

// ---------- Dragging: the circle (collapsed) and the panel's header bar
// (expanded) both reposition the same underlying window this way. A click
// and a drag both start as a pointerdown on the element, so they're
// disambiguated by movement distance: past DRAG_THRESHOLD px it's a drag
// (the window follows the cursor); released before that, it's a click.
const DRAG_THRESHOLD = 4;

function makeDraggable(element, onClick) {
  let dragging = false;
  let startScreenX = 0;
  let startScreenY = 0;
  let winStartX = 0;
  let winStartY = 0;

  element.addEventListener('pointerdown', async (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.mini-btn')) return; // let header buttons handle their own clicks
    element.setPointerCapture(e.pointerId);
    dragging = false;
    startScreenX = e.screenX;
    startScreenY = e.screenY;
    const pos = await window.floatingNative.getPosition();
    winStartX = pos[0];
    winStartY = pos[1];
  });

  element.addEventListener('pointermove', (e) => {
    if (!element.hasPointerCapture(e.pointerId)) return;
    const dx = e.screenX - startScreenX;
    const dy = e.screenY - startScreenY;
    if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragging = true;
      element.classList.add('dragging');
    }
    if (dragging) window.floatingNative.moveTo(winStartX + dx, winStartY + dy);
  });

  element.addEventListener('pointerup', (e) => {
    if (!element.hasPointerCapture(e.pointerId)) return;
    element.releasePointerCapture(e.pointerId);
    if (dragging) {
      dragging = false;
      element.classList.remove('dragging');
      window.floatingNative.dragEnded(winStartX + (e.screenX - startScreenX), winStartY + (e.screenY - startScreenY));
    } else if (onClick) {
      onClick();
    }
  });
}

makeDraggable(btn, () => triggerSend(btn));
makeDraggable(panelHeader); // no click action of its own — just the drag handle

// Right-click works too, but the handle is the discoverable path — nothing
// should be reachable only through a hidden gesture.
btn.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.floatingNative.toggleExpand();
});
expandHandle.addEventListener('click', () => window.floatingNative.toggleExpand());

collapseBtn.addEventListener('click', () => window.floatingNative.toggleExpand());
miniSend.addEventListener('click', () => triggerSend(miniSend));
settingsBtn.addEventListener('click', () => window.floatingNative.openSettings());
autoToggle.addEventListener('click', () => window.floatingNative.toggleAutoSend());

// Reflected in both places at once: the toggle button in the expanded
// panel (where you'd actually turn it on) and the collapsed circle's
// pulsing ring (so it stays a visible reminder even when the panel isn't
// open — the whole point of it being hard to miss).
window.floatingNative.onAutoSendStateChanged((enabled) => {
  autoToggle.classList.toggle('active', enabled);
  btn.classList.toggle('auto-active', enabled);
});

function triggerSend(el) {
  if (el.classList.contains('syncing')) return;
  el.classList.add('syncing');
  window.floatingNative.triggerSync();
}

window.floatingNative.onSyncResult((result) => {
  for (const el of [btn, miniSend]) {
    el.classList.remove('syncing');
    el.classList.add(result.ok ? 'success' : 'error');
    setTimeout(() => el.classList.remove('success', 'error'), 1100);
  }
});

// ---------- Expanded panel: history + tap to copy back ----------

window.floatingNative.onSetExpanded((expanded) => {
  collapsedEl.style.display = expanded ? 'none' : 'block';
  expandedEl.style.display = expanded ? 'flex' : 'none';
  if (expanded) panelStatusDot.className = 'connected';
});

window.floatingNative.onHistoryUpdated((entries) => {
  latestEntries = entries || [];
  renderPanelHistory();
});

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
  return entry.content.startsWith('http')
    ? entry.content
    : 'data:image/png;base64,' + entry.content;
}

function renderPanelHistory() {
  if (!latestEntries.length) {
    panelHistory.innerHTML = '<div class="empty">No clipboard history yet.</div>';
    return;
  }
  panelHistory.innerHTML = '';
  for (const entry of latestEntries) {
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

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'entry-delete';
    deleteBtn.title = 'Delete everywhere';
    deleteBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M3 6h18"></path><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>' +
      '<path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"></path>' +
      '<path d="M10 11v6"></path><path d="M14 11v6"></path>' +
      '</svg>';
    // Stop propagation so this doesn't also trigger the entry's own click
    // handler (copy to clipboard) — they'd otherwise both fire on the same tap.
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Delete this entry everywhere? This removes it from every connected device, not just here.')) return;
      window.floatingNative.deleteEntry(entry.id);
    });

    div.appendChild(contentDiv);
    div.appendChild(meta);
    div.appendChild(deleteBtn);
    div.addEventListener('click', () => window.floatingNative.copyEntry(entry));
    panelHistory.appendChild(div);
  }
}

window.floatingNative.onCopyResult((result) => {
  panelToast.textContent = result.ok ? 'Copied' : 'Copy failed';
  panelToast.classList.add('show');
  setTimeout(() => panelToast.classList.remove('show'), 1200);
});

window.floatingNative.onDeleteResult((result) => {
  if (result.ok) return; // success has no separate feedback — the entry disappearing from the list is the feedback
  panelToast.textContent = 'Delete failed: ' + result.error;
  panelToast.classList.add('show');
  setTimeout(() => panelToast.classList.remove('show'), 1800);
});
