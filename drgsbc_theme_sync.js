/* ================================================================
   drgsbc_theme_sync.js
   Shared theme bridge for DRGSBC standalone/extra pages.

   The main dashboard's applyTheme() already writes the user's chosen
   theme id to localStorage.drgsbc_theme on every change. This script
   just reads that value and sets data-theme on <html>, so that
   drgsbc_shared_theme.css (which defines the actual colours per
   data-theme) picks the right palette.

   Usage: include this BEFORE drgsbc_shared_theme.css in <head>, so
   data-theme is set before the stylesheet is applied (no flash of
   the wrong theme):

     <script src="drgsbc_theme_sync.js"></script>
     <link rel="stylesheet" href="drgsbc_shared_theme.css">

   Also listens for the 'storage' event, so if this page is open in a
   tab/iframe while the user switches themes in the main dashboard,
   it updates live with zero extra wiring.
   ================================================================ */
(function(){
  function applyStoredTheme(){
    var theme = 'cyber';
    try { theme = localStorage.getItem('drgsbc_theme') || 'cyber'; } catch(e) {}
    document.documentElement.setAttribute('data-theme', theme);
  }
  applyStoredTheme();
  window.addEventListener('storage', function(e){
    if (e.key === 'drgsbc_theme') applyStoredTheme();
  });
})();
