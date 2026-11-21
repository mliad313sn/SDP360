/* modalA11y.js — VISUAL POLISH 2026-11 / UX committee admin P1-1: one keyboard contract for the page modals that use
 * the `.modal-overlay.open` pattern (reports.html admin console and its siblings).
 *   · Escape closes the top-most open overlay (removes `.open`, the same thing every Cancel button does);
 *     an overlay marked data-modal-escape="off" is left alone (a dialog that must be answered).
 *   · Tab / Shift+Tab stay inside the open overlay (focus trap).
 *   · When an overlay opens, focus moves to its first field; when it closes, focus returns to what opened it.
 * Pure DOM, no dependency, nothing sent anywhere. The overlay itself scrolls (CSS), so a tall form is reachable.
 */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var SEL = '.modal-overlay.open';
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var opener = null;
  function top() { var l = document.querySelectorAll(SEL); return l.length ? l[l.length - 1] : null; }
  function items(o) { return Array.prototype.filter.call(o.querySelectorAll(FOCUSABLE), function (e) { return e.offsetParent !== null || e === document.activeElement; }); }
  document.addEventListener('keydown', function (e) {
    var o = top(); if (!o) return;
    if (e.key === 'Escape' && o.getAttribute('data-modal-escape') !== 'off') {
      o.classList.remove('open'); e.preventDefault();
      if (opener && opener.focus) { try { opener.focus(); } catch (_) { /* gone */ } }
      return;
    }
    if (e.key !== 'Tab') return;
    var f = items(o); if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (!o.contains(document.activeElement)) { first.focus(); e.preventDefault(); return; }
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });
  function watch() {
    if (typeof MutationObserver === 'undefined') return;
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        var o = m.target;
        if (!o.classList || !o.classList.contains('modal-overlay')) return;
        if (o.classList.contains('open')) {
          if (!o.hasAttribute('role')) o.setAttribute('role', 'presentation');
          var dlg = o.querySelector('.modal'); if (dlg && !dlg.hasAttribute('role')) { dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); }
          opener = document.activeElement;
          var f = items(o); if (f.length) { try { f[0].focus(); } catch (_) { /* not focusable yet */ } }
          o.scrollTop = 0;
        }
      });
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
})();
