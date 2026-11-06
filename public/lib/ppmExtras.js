/* W2-PPM — project page add-ons, each shown only while its PROPOSED switch is on (GET /api/governance/ppm/features).
   UMD: loaded by project.html, required by tests. The *Html functions are PURE (esc = the page's HTML escaper; every
   value goes through it); mount* functions wire one tab pane to its API.
   E-P04 budgetHtml(view)  — per currency: month × baseline / actual / forecast, totals, EAC, variance; "—" = not
                             entered (never 0); currencies are never added together; "not certified" label. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PpmExtras = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var n = function (v, esc) { return v == null || v === '' || (typeof v === 'number' && !isFinite(v)) ? '—' : esc(String(v)); };
  var BASIS = { none: 'nothing entered', forecast_only: 'forecast only (no actual yet)', actual_only: 'actual only (no remaining forecast)', actual_plus_forecast: 'actual to date + remaining forecast' };

  function budgetHtml(r, esc) {
    if (!r) return '';
    var cert = '<p class="muted"><b>' + esc(r.certification || 'not certified') + '</b></p>';
    if (r.money_hidden) return '<p class="muted">Amounts are restricted to the committee, the admin tier and the finance role.</p>' + cert;
    var v = r.view || { currencies: [] };
    if (!v.currencies.length) return '<p class="muted">No budget period entered.</p>' + cert;
    return v.currencies.map(function (c) {
      var rows = c.periods.map(function (p) { return '<tr><td>' + esc(p.period) + '</td><td>' + n(p.baseline, esc) + '</td><td>' + n(p.actual, esc) + '</td><td>' + n(p.forecast, esc) + '</td></tr>'; }).join('');
      return '<h3>' + esc(c.currency) + '</h3><table><thead><tr><th>Month</th><th>Baseline</th><th>Actual</th><th>Forecast</th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<table><tbody><tr><th>Baseline total</th><td>' + n(c.baseline_total, esc) + '</td></tr><tr><th>Actual to date</th><td>' + n(c.actual_to_date, esc) + '</td></tr><tr><th>Remaining forecast</th><td>' + n(c.remaining_forecast, esc) + '</td></tr>' +
        '<tr><th>Estimate at completion (EAC)</th><td><b>' + n(c.eac, esc) + '</b> <small class="muted">' + esc(BASIS[c.eac_basis] || '') + '</small></td></tr><tr><th>Variance vs baseline</th><td>' + n(c.variance, esc) + '</td></tr></tbody></table>';
    }).join('') + '<p class="muted">Each currency is shown on its own — amounts in different currencies are never added together.</p>' + cert;
  }

  function mountBudget(ctx) {
    var $ = ctx.$, esc = ctx.esc, url = '/api/governance/ppm/project/' + encodeURIComponent(ctx.pid) + '/budget-periods';
    var draw = function (r) { $('budget').innerHTML = budgetHtml(r, esc); $('bp-edit').hidden = !r.can_edit; };
    ctx.api(url).then(draw).catch(ctx.fail);
    if ($('bp-save').getAttribute('data-wired')) return;
    $('bp-save').setAttribute('data-wired', '1');
    $('bp-save').addEventListener('click', function () {
      var b = { period: $('bp-period').value, currency: $('bp-cur').value.trim().toUpperCase(), kind: $('bp-kind').value, amount: $('bp-amount').value === '' ? null : Number($('bp-amount').value), reason: $('bp-reason').value.trim() || null };
      ctx.api(url, { method: 'PUT', body: JSON.stringify(b) }).then(function (r) { ctx.msg('Budget period saved.'); draw(Object.assign({ can_edit: true }, r)); $('bp-reason').value = ''; }).catch(ctx.fail);
    });
  }

  return { budgetHtml: budgetHtml, mountBudget: mountBudget };
}));
