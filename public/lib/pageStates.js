/* Page states (design review 2026-10-29, B7 / B8). Two safety nets for long legacy pages:
 *  1. the full-screen #loader is dismissed even when the window `load` event is late (blocked CDN,
 *     slow site link) — the page shows its content instead of a dark cover;
 *  2. once the live data request has settled, any placeholder still reading "Loading…" / "•••" says
 *     "— not available" instead of spinning forever (a figure that never came is not "loading").
 *  3. F-UX-11 — slowNotice(): a page whose first load can take minutes (Helpdesk waits up to 180 s for the
 *     ticket set) says so after a few seconds instead of spinning silently: "still loading" + keep waiting +
 *     a link to a lighter page + try again. It never shows a cached figure as current; it only talks.
 * Pages opt in by including this script; nothing else changes. data-last-resort="off" on the script tag skips
 * the 30 s "— not available" sweep (for a page whose own loader legitimately runs longer). */
(function () {
  'use strict';
  var me = document.currentScript;
  var lastResort = !(me && me.getAttribute && me.getAttribute('data-last-resort') === 'off');
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
    if (lastResort) setTimeout(settle, 30000);   // last resort: nothing arrived at all
  });
  var SLOW = {
    en: { still: 'Still loading — this page reads the full ticket set and can take a few minutes on a slow link.', wait: 'Keep waiting', open: 'Open my summary instead', retry: 'Try again' },
    fr: { still: 'Chargement toujours en cours — cette page lit tous les tickets et peut prendre quelques minutes sur une liaison lente.', wait: 'Continuer d\u2019attendre', open: 'Ouvrir plutôt mon résumé', retry: 'Réessayer' },
  };
  /** opts: { overlayId, msgId, stillLoading (fn), after (ms, default 20000), summaryHref (relative page, default 'home.html') }.
   *  After `after` ms, if the overlay is still shown, add a polite notice with three choices. Returns the timer. */
  function slowNotice(opts) {
    var o = opts || {};
    var href = /^[a-z0-9_-]+\.html(\?[a-z0-9=&_.-]*)?$/i.test(o.summaryHref || '') ? o.summaryHref : 'home.html';
    return setTimeout(function () {
      var ov = document.getElementById(o.overlayId || 'loadOverlay');
      var box = document.getElementById(o.msgId || 'loadMsg');
      if (!ov || !box || ov.style.display === 'none' || document.getElementById('psSlow')) return;
      if (typeof o.stillLoading === 'function' && !o.stillLoading()) return;   // the page already showed its own error
      var L = SLOW[document.documentElement.lang === 'fr' ? 'fr' : 'en'];
      var d = document.createElement('div');
      d.id = 'psSlow'; d.className = 'ps-slow'; d.setAttribute('role', 'status'); d.setAttribute('aria-live', 'polite');
      d.innerHTML = '<p>' + L.still + '</p><p><button type="button" class="ps-wait">' + L.wait + '</button> <a href="' + href + '">' + L.open + '</a> <button type="button" class="ps-retry">' + L.retry + '</button></p>';
      box.appendChild(d);
      var w = d.querySelector('.ps-wait'); if (w) w.addEventListener('click', function () { d.remove(); slowNotice(o); });
      var r = d.querySelector('.ps-retry'); if (r) r.addEventListener('click', function () { location.reload(); });
    }, o.after == null ? 20000 : o.after);
  }
  window.PageStates = { settle: settle, dismissLoader: dismissLoader, slowNotice: slowNotice };
})();
