/* G17 — wide tables on a phone: wrap each table in a keyboard-scrollable region instead of turning the table into
 * a block (display:block on <table> can drop its table semantics in Safari/VoiceOver, WCAG 1.3.1).
 *   <script src="lib/tableScroll.js" data-root=".content"></script>   (data-root optional, default document.body)
 * Idempotent; tables rendered later are wrapped too (MutationObserver). The region has a name and tabindex so a
 * keyboard user can scroll it (WCAG 2.1.1). */
(function () {
  'use strict';
  const me = document.currentScript;
  const rootSel = (me && me.getAttribute('data-root')) || null;
  function wrap(t) {
    if (!t || t.closest('.tbl-scroll') || (t.parentElement && /auto|scroll/.test(getComputedStyle(t.parentElement).overflowX))) return;
    const d = document.createElement('div');
    d.className = 'tbl-scroll'; d.setAttribute('role', 'region'); d.setAttribute('tabindex', '0');
    const cap = t.querySelector('caption'); const h = t.previousElementSibling && /^H[1-6]$/.test(t.previousElementSibling.tagName) ? t.previousElementSibling : null;
    d.setAttribute('aria-label', ((cap && cap.textContent) || (h && h.textContent) || 'Table').trim().slice(0, 80) + ' (scrolls sideways)');
    t.parentNode.insertBefore(d, t); d.appendChild(t);
  }
  function run(scope) { (scope || document).querySelectorAll('table').forEach(wrap); }
  function start() {
    const root = (rootSel && document.querySelector(rootSel)) || document.body;
    run(root);
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.tagName === 'TABLE') wrap(n); else run(n); } }).observe(root, { childList: true, subtree: true });
  }
  if (!document.getElementById('tbl-scroll-css')) {
    const s = document.createElement('style'); s.id = 'tbl-scroll-css';
    s.textContent = '.tbl-scroll{max-width:100%;overflow-x:auto}.tbl-scroll:focus-visible{outline:2px solid #2A5490;outline-offset:2px}';
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
