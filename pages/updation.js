// ================================================================
// pages/updation.js
// Wraps the standalone drgsbc_updation.html in an iframe — same
// pattern as settings.js / tree_explorer.js / procurement.js.
//
// drgsbc_updation.html owns its own internal sub-tab system (My
// Space / New Sanction / Edit Sanction / Sub-Items / Process / Grant
// / Chronolog) — only My Space is fully built so far; the rest show
// a clear "not yet built here" placeholder rather than failing
// silently. This tab does NOT replace the 'dashboard' tab, which
// still iframes full v16 for anything not yet ported.
// ================================================================

export async function render(container, ctx) {
  const iframe = document.createElement('iframe');
  iframe.src = './drgsbc_updation.html?embedded=shell';
  iframe.title = 'DRGSBC Updation';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.style.display = 'block';
  container.appendChild(iframe);
}

export function destroy(container) {
  container.innerHTML = '';
}
