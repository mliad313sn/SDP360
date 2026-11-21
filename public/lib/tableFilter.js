/* tableFilter.js — VISUAL POLISH 2026-11 / UX committee admin P2: a client-side "find in this table" box.
 *   <input type="search" data-table-filter="#user-table" aria-label="Search users">
 *   <select data-table-facet="#user-table" data-facet="role">…</select>      (optional, VISUAL POLISH 3 — admin P2-5)
 * Hides the tbody rows whose text does not contain every typed word (case- and accent-insensitive) or whose
 * data-f-<facet> attribute (space-separated tokens written by the page on each <tr>) does not hold the value chosen
 * in a facet list. It only reads what the table already shows — no request, no new data, nothing changes on the server.
 */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var fold = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  function apply(sel) {
    var table = document.querySelector(sel);
    if (!table) return;
    var q = function (attr) { return Array.prototype.filter.call(document.querySelectorAll('[' + attr + ']'), function (e) { return e.getAttribute(attr) === sel; }); };
    var inputs = q('data-table-filter'), facets = q('data-table-facet').filter(function (f) { return f.value !== ''; });
    var words = fold(inputs.map(function (i) { return i.value; }).join(' ')).split(/\s+/).filter(Boolean);
    var shown = 0, rows = table.querySelectorAll('tbody tr');
    Array.prototype.forEach.call(rows, function (tr) {
      var t = fold(tr.textContent), ok = words.every(function (w) { return t.indexOf(w) !== -1; });
      if (ok) ok = facets.every(function (f) { return (' ' + (tr.getAttribute('data-f-' + f.getAttribute('data-facet')) || '') + ' ').indexOf(' ' + f.value + ' ') !== -1; });
      tr.hidden = !ok; if (ok) shown++;
    });
    inputs.forEach(function (input) {
      var out = input.getAttribute('aria-controls') && document.getElementById(input.getAttribute('aria-controls'));
      if (out) out.textContent = (words.length || facets.length) ? shown + ' / ' + rows.length : '';
    });
  }
  document.addEventListener('input', function (e) { if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-table-filter')) apply(e.target.getAttribute('data-table-filter')); });
  document.addEventListener('change', function (e) { if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-table-facet')) apply(e.target.getAttribute('data-table-facet')); });
  window.TableFilter = { apply: apply };
})();
