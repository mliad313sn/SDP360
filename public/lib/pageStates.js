/* Page states (design review 2026-10-29, B7 / B8). Two safety nets for long legacy pages:
 *  1. the full-screen #loader is dismissed even when the window `load` event is late (blocked CDN,
 *     slow site link) — the page shows its content instead of a dark cover;
 *  2. once the live data request has settled, any placeholder still reading "Loading…" / "•••" says
 *     "— not available" instead of spinning forever (a figure that never came is not "loading").
 * Pages opt in by including this script; nothing else changes. */
(function () {
  'use strict';
  var PLACEHOLDER = /^\s*(⚠\s*)?(Loading…|Loading\.\.\.|Loading|•••)\s*$/;
  function settle(root) {
    var n = 0, els = (root || document).querySelectorAll('span, div, td, small, b, strong');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.children.length || !PLACEHOLDER.test(el.textContent || '')) continue;
      el.textContent = document.documentElement.lang === 'fr' ? '— non disponible' : '— not available';
      el.classList.add('ps-unavailable'); el.title = 'No data arrived for this figure'; n++;
    }
    return n;
  }
  function dismissLoader() { var l = document.getElementById('loader'); if (l && !l.classList.contains('gone')) l.classList.add('gone'); }
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(dismissLoader, 3500);
    if (typeof window.loadLiveData === 'function') {
      var orig = window.loadLiveData;
      window.loadLiveData = async function () { try { return await orig.apply(this, arguments); } finally { setTimeout(settle, 1500); } };
    }
    setTimeout(settle, 30000);   // last resort: nothing arrived at all
  });
  window.PageStates = { settle: settle, dismissLoader: dismissLoader };
})();
