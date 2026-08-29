// ================================================================
// pages/_template.js
// Starter template for a new shell page.
//
// HOW TO USE:
//   1. Copy this file to pages/<your_page_id>.js
//   2. Add an entry to pages/registry.js pointing at it:
//        { id: 'your_page_id', label: 'YOUR LABEL', module: './pages/your_page_id.js' }
//   3. Build your UI inside render()
//
// Each page gets its own isolated module scope — variable and
// function names here can NEVER collide with another page's, or
// with v16's. This is what stops new features from "breaking the
// main file": there is no shared file left to break.
//
// render(container, ctx) is called every time the shell navigates TO
// this page. destroy(container) is called every time the shell
// navigates AWAY from it (clear timers/intervals/listeners there).
// ================================================================

import { pgFetch, showToast, fmtDate, getActiveSession } from '../core/services.js';

export async function render(container, ctx) {
  // Prefix ALL class names with your page id (e.g. "yp-") so this
  // page's styles can never collide with another page's styles.
  container.innerHTML = `
    <style>
      .yp-wrap   { padding: 20px; font-family: var(--font-body); color: var(--text-primary); height: 100%; overflow:auto; box-sizing: border-box; }
      .yp-title  { font-family: var(--font-display); font-weight:700; font-size: 20px; letter-spacing: 2px; color: var(--accent-cyan); margin-bottom: 16px; }
    </style>
    <div class="yp-wrap">
      <div class="yp-title">YOUR PAGE TITLE</div>
      <p>Build your page here. Shared helpers come from core/services.js,
         shared look-and-feel (fonts, colors, .btn, .card, table styles,
         all 9 theme palettes) comes from core/theme.css — already
         loaded by the shell.</p>
      <button class="btn" id="yp-demo-btn">Test toast</button>
      <div id="yp-output" style="margin-top:16px;"></div>
    </div>
  `;

  container.querySelector('#yp-demo-btn').onclick = () => showToast('Hello from the new page!');

  // Example: read who's logged in (shared with v16 automatically)
  // const session = getActiveSession();
  // if (session) container.querySelector('#yp-output').textContent =
  //   `Logged in as ${session.user} (${session.role})`;

  // Example: pull some data from PostgREST and render it
  // try {
  //   const rows = await pgFetch('/sanction_header?limit=5&order=created_at.desc');
  //   container.querySelector('#yp-output').textContent =
  //     `Loaded ${rows.length} rows. Latest: ${fmtDate(rows[0]?.created_at)}`;
  // } catch (err) {
  //   showToast('Could not load data: ' + err.message, 'error');
  // }

  // ctx is the shared context object from the shell:
  //   ctx.session         — same as getActiveSession(), convenience getter
  //   ctx.navigateTo(id)  — switch to another registered page programmatically
}

// Optional cleanup hook — called when the shell navigates away from
// this page. Clear any timers/intervals/listeners here.
export function destroy(container) {
  container.innerHTML = '';
}
