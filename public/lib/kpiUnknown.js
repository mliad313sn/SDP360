/* VISUAL POLISH 2 (executive F14/F15, data rule) — a KPI tile whose value is not measured ("—", "•••", "N/A",
 * empty) carries NO verdict colour: its RAG dot goes neutral and its trend chip loses the good / bad tint.
 * The tile markup ships with a default dot colour; this pass follows the VALUE, so an unknown never reads green.
 * It only adds / removes the class `kpi-unknown` on .kpi-tile — no figure, formula or threshold is touched.
 * <script src="lib/kpiUnknown.js" data-auto> watches the page; KpiUnknown.isUnknown(text) is the pure rule. */
(function (root) {
  'use strict';
  function isUnknown(text) {
    var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    return t === '' || /^(—|–|-|•+|\.{3}|…|n\/?a|computing…?|loading…?)$/i.test(t);
  }
  function mark(tile) {
    var v = tile.querySelector('.kpi-tile-value'); if (!v) return;
    tile.classList.toggle('kpi-unknown', isUnknown(v.textContent));
  }
  function scan(scope) { [].forEach.call((scope || root.document).querySelectorAll('.kpi-tile'), mark); }
  function install() {
    var doc = root.document;
    try {
      var st = doc.createElement('style'), n = doc.querySelector('style[nonce],script[nonce]'); if (n && n.nonce) st.nonce = n.nonce;
      st.textContent = '.kpi-tile.kpi-unknown .rag-indicator{background:var(--color-border-strong,var(--color-border)) !important;box-shadow:none !important}' +
        '.kpi-tile.kpi-unknown .kpi-trend{background:transparent !important;color:var(--color-text-muted) !important}' +
        '.kpi-tile.kpi-unknown{border-left-color:var(--color-border) !important}';
      doc.head.appendChild(st);
    } catch (_) { /* no DOM */ }
    scan();
    var pending = false;
    try { new root.MutationObserver(function () { if (pending) return; pending = true; root.setTimeout(function () { pending = false; scan(); }, 80); }).observe(doc.body, { childList: true, subtree: true, characterData: true }); } catch (_) { /* one pass */ }
  }
  var api = { isUnknown: isUnknown, scan: scan, install: install };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.KpiUnknown = api;
  try { var cs = root.document.currentScript; if (cs && cs.hasAttribute('data-auto')) { if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', install); else install(); } } catch (_) { /* no DOM */ }
})(typeof window !== 'undefined' ? window : globalThis);
