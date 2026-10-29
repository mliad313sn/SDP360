/* Phone layout for editing tables (UAT F-05): below 640 px a row becomes a card and each cell shows its
 * column name. This only copies each header's text into data-label on the cells (CSS does the layout),
 * for every table marked data-cards, including rows rendered later. Inputs are not touched. */
(function () {
  'use strict';
  function label(table) {
    const heads = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach((tr) => {
      Array.from(tr.children).forEach((td, i) => { if (heads[i] && td.getAttribute('data-label') !== heads[i]) td.setAttribute('data-label', heads[i]); });
    });
  }
  function watch(table) {
    label(table);
    const body = table.querySelector('tbody');
    if (body) new MutationObserver(() => label(table)).observe(body, { childList: true, subtree: false });
  }
  function init() { document.querySelectorAll('table[data-cards]').forEach(watch); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.TableCards = { label };
})();
