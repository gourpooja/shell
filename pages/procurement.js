// ================================================================
// pages/procurement.js
// Wraps the standalone drgsbc_procurement.html (same /shell/ folder)
// in an iframe — same pattern as settings.js / tree_explorer.js.
//
// drgsbc_procurement.html is fully independent of this shell's
// index.html: own theme sync, own session-badge logic, talks to
// Nexus/Sheets directly via core/services.js. No demo-data fallback —
// if neither source is configured/reachable it shows a blank state.
// Would work identically opened as a bare URL with no shell around it.
//
// Registered under id 'dashboard' in registry.js, shown first in the
// nav — this read/filter/search/sort/paginate/export/columns
// "Holdings table" view of master_dashboard_view is the Shell's
// dashboard. v16 has been fully retired from the Shell (it used to be
// iframed here under this same 'dashboard' id, before this page took
// over the slot); New Sanction / Edit Sanction / Process / Grant /
// Sub-Items / Chronolog all live in the Updation tab now, not in v16.
// ================================================================

export async function render(container, ctx) {
  const iframe = document.createElement('iframe');
  iframe.src = './drgsbc_procurement.html?embedded=shell';
  iframe.title = 'DRGSBC Dashboard';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.style.display = 'block';
  container.appendChild(iframe);
}

export function destroy(container) {
  container.innerHTML = '';
}
