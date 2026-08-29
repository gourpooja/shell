// ================================================================
// pages/dashboard.js
// Wraps the existing production dashboard (drgsbc_dashboard_v16.html)
// in an iframe.
//
// This is the "legacy" page. v16 is untouched and keeps doing its own
// thing — auth, RBAC, theme switching, session persistence, all its
// tabs, everything. There is nothing to maintain here.
//
// The shell and v16 are served from the same Web Station origin
// (10.205.50.15:8088), just different paths — v16 lives one folder
// up from /shell/, hence '../'. Because it's same-origin, v16's
// sessionStorage (drgsbc_user/role/profile/login_ts) and localStorage
// (drgsbc_theme, drgsbc_db_config) are automatically shared with the
// shell and any other page module — see core/services.js's
// getActiveSession().
//
// As you find time, individual v16 tabs can be peeled out into their
// own page modules (see pages/_template.js) one at a time. Until
// then, this single iframe covers all of v16's functionality.
// ================================================================

export async function render(container, ctx) {
  const iframe = document.createElement('iframe');
  iframe.src = '../drgsbc_dashboard_v16.html';
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
