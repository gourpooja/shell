// ================================================================
// pages/registry.js
// One entry per tab in the shell's top bar.
//
// TO ADD A NEW PAGE:
//   1. Copy pages/_template.js  ->  pages/your_page_name.js
//   2. Build out render() in that file
//   3. Add one entry to the PAGES array below
//   4. Done — nothing else (shell, other pages) needs to change
//
// 'module' paths are relative to index.html (i.e. relative to /shell/).
// Order here is display order in the top nav.
// ================================================================

export const PAGES = [
  { id: 'dashboard',     label: 'DASHBOARD',      module: './pages/procurement.js' },
  { id: 'updation',      label: 'UPDATION',       module: './pages/updation.js' },
  { id: 'tree_explorer', label: 'TREE EXPLORER',  module: './pages/tree_explorer.js' },
  { id: 'settings',      label: 'SETTINGS',       module: './pages/settings.js' },

  // --- Example of what your next entry will look like: ---
  // { id: 'reports', label: 'REPORTS', module: './pages/reports.js' },
];
