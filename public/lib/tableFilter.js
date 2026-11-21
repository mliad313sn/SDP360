/* tableFilter.js — VISUAL POLISH 2026-11 / UX committee admin P2: a client-side "find in this table" box.
 *   <input type="search" data-table-filter="#user-table" aria-label="Search users">
 * Hides the tbody rows whose text does not contain every typed word (case- and accent-insensitive). It only reads
 * what the table already shows — no request, no new data, nothing changes on the server.
 */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var fold = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  function apply(input) {
    var table = document.querySelector(input.getAttribute('data-table-filter'));
    if (!table) return;
    var words = fold(input.value).split(/\s+/).filter(Boolean);
    var shown = 0, rows = table.querySelectorAll('tbody tr');
    Array.prototype.forEach.call(rows, function (tr) {
      var t = fold(tr.textContent), ok = words.every(function (w) { return t.indexOf(w) !== -1; });
      tr.hidden = !ok; if (ok) shown++;
    });
    var out = input.getAttribute('aria-controls') && document.getElementById(input.getAttribute('aria-controls'));
    if (out) out.textContent = words.length ? shown + ' / ' + rows.length : '';
  }
  document.addEventListener('input', function (e) { if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-table-filter')) apply(e.target); });
})();
