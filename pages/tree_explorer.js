// ================================================================
// pages/tree_explorer.js
// Wraps the standalone drgsbc_tree_explorer.html (now living in
// /shell/ alongside this page module — fully self-contained) in an
// iframe — same pattern as dashboard.js. It has its own theme sync
// (drgsbc_theme_sync.js) and reads the same localStorage.drgsbc_db_config
// the main dashboard uses, so it just works.
//
// NOTE: currently reachable with no login check at all (same as when
// it was a bare standalone page at the web root). Known gap, flagged
// for a later pass — see settings.js / drgsbc_settings.html for the
// interim pattern (session-based tab gating) once you're ready to
// apply something similar here too.
// ================================================================

export async function render(container, ctx) {
  const iframe = document.createElement('iframe');
  iframe.src = './drgsbc_tree_explorer.html?embedded=shell';
  iframe.title = 'DRGSBC Procurement Tree Explorer';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.style.display = 'block';
  container.appendChild(iframe);
}

export function destroy(container) {
  container.innerHTML = '';
}

