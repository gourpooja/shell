// ================================================================
// pages/settings.js
// Wraps the standalone drgsbc_settings.html (same /shell/ folder) in
// an iframe — same pattern as dashboard.js / tree_explorer.js.
//
// drgsbc_settings.html is fully independent of this shell's index.html:
// it has its own theme sync, its own session-badge/admin-gating logic,
// and talks to Nexus directly via core/services.js's nxFetch(). It
// would work identically opened as a bare URL with no shell around it
// at all — this wrapper just gives it a tab in the nav.
// ================================================================

export async function render(container, ctx) {
  const iframe = document.createElement('iframe');
  iframe.src = './drgsbc_settings.html?embedded=shell';
  iframe.title = 'DRGSBC Settings';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.style.display = 'block';
  container.appendChild(iframe);
}

export function destroy(container) {
  container.innerHTML = '';
}
