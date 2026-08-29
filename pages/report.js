// ================================================================
// pages/report.js
// Shell SPA wrapper for the Custom Report Builder.
// Iframes drgsbc_report.html — same pattern as updation.js,
// procurement.js, settings.js, tree_explorer.js.
// ================================================================

export async function render(container, ctx) {
  const iframe = document.createElement('iframe');
  iframe.src = './drgsbc_report.html?embedded=shell';
  iframe.title = 'DRGSBC Custom Reports';
  iframe.style.width  = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.style.display = 'block';
  container.appendChild(iframe);
}

export function destroy(container) {
  container.innerHTML = '';
}
