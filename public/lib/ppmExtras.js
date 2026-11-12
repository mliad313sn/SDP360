/* W2-PPM — project page add-ons, each shown only while its PROPOSED switch is on (GET /api/governance/ppm/features).
   UMD: loaded by project.html, required by tests. The *Html functions are PURE (esc = the page's HTML escaper; every
   value goes through it); mount* functions wire one tab pane to its API.
   E-P04 budgetHtml(view)  — per currency: month × baseline / actual / forecast, totals, EAC, variance; "—" = not
                             entered (never 0); currencies are never added together; "not certified" label.
   E-P06 raciHtml(matrix)  — task × person letters; a task without exactly one A is flagged in words.
         raciEditorHtml / raciRowsFrom — one line per task, four inputs (names separated by commas) → rows.
         templatesHtml(list) — the templates with their status (draft / approved) and who approved them. */
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

  var LETTERS = ['R', 'A', 'C', 'I'], LNAME = { R: 'Responsible', A: 'Accountable', C: 'Consulted', I: 'Informed' };
  function raciHtml(m, esc) {
    if (!m || !m.tasks.length) return '<p class="muted">No task in this project yet — add tasks in the Plan tab first.</p>';
    if (!m.people.length) return '<p class="muted">No responsibility entered yet.</p>';
    var head = '<tr><th scope="col">Task</th>' + m.people.map(function (p) { return '<th scope="col">' + esc(p) + '</th>'; }).join('') + '<th scope="col">Check</th></tr>';
    var body = m.tasks.map(function (t) {
      var any = m.people.some(function (p) { return t.cells[p]; });
      var chk = !any ? '<span class="muted">no RACI</span>' : t.accountable === 1 ? '✓ one A' : '<b>! ' + (t.accountable ? 'more than one A' : 'no A') + '</b>';
      return '<tr><th scope="row">' + esc(t.label) + '</th>' + m.people.map(function (p) { return '<td>' + esc(t.cells[p] || '') + '</td>'; }).join('') + '<td>' + chk + '</td></tr>';
    }).join('');
    return '<table><caption>R = ' + LNAME.R + ' · A = ' + LNAME.A + ' (exactly one per task) · C = ' + LNAME.C + ' · I = ' + LNAME.I + '</caption><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }
  function raciEditorHtml(m, rows, esc) {
    var by = {}; (rows || []).forEach(function (r) { var k = r.task_id + '|' + r.letter; (by[k] = by[k] || []).push(r.person); });
    return '<table><thead><tr><th>Task</th>' + LETTERS.map(function (l) { return '<th>' + esc(l + ' — ' + LNAME[l]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      m.tasks.map(function (t) { return '<tr><th scope="row">' + esc(t.label) + '</th>' + LETTERS.map(function (l) { return '<td><input data-raci-task="' + esc(String(t.id)) + '" data-raci-letter="' + esc(l) + '" aria-label="' + esc(l + ' for ' + t.label) + '" value="' + esc((by[t.id + '|' + l] || []).join(', ')) + '"></td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }
  /** inputs = [{task, letter, value}] → rows [{task_id, letter, person}] (names split on commas, blanks dropped). */
  function raciRowsFrom(inputs) {
    var out = [];
    (inputs || []).forEach(function (x) { String(x.value || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean).forEach(function (p) { out.push({ task_id: Number(x.task), letter: x.letter, person: p }); }); });
    return out;
  }
  function mountRaci(ctx) {
    var $ = ctx.$, esc = ctx.esc, url = '/api/governance/ppm/project/' + encodeURIComponent(ctx.pid) + '/raci';
    $('raci-csv').setAttribute('href', url + '.csv');
    var draw = function (r) { $('raci').innerHTML = raciHtml(r.matrix, esc); if (ctx.canEdit) { $('raci-edit').hidden = false; $('raci-editor').innerHTML = raciEditorHtml(r.matrix, r.rows, esc); } };
    ctx.api(url).then(draw).catch(ctx.fail);
    if ($('raci-save').getAttribute('data-wired')) return;
    $('raci-save').setAttribute('data-wired', '1');
    $('raci-save').addEventListener('click', function () {
      var ins = Array.prototype.map.call(document.querySelectorAll('[data-raci-task]'), function (i) { return { task: i.getAttribute('data-raci-task'), letter: i.getAttribute('data-raci-letter'), value: i.value }; });
      ctx.api(url, { method: 'PUT', body: JSON.stringify({ rows: raciRowsFrom(ins) }) }).then(function (r) { ctx.msg('RACI saved.'); draw(r); }).catch(ctx.fail);
    });
  }
  function templatesHtml(r, esc) {
    var list = (r && r.templates) || [];
    if (!list.length) return '<p class="muted">No template yet — save the structure of a project from its Plan tab.</p>';
    return '<table><thead><tr><th>Template</th><th>Tasks</th><th>Milestones</th><th>Status</th><th>Author</th><th>Approved by</th><th></th></tr></thead><tbody>' + list.map(function (t) {
      var st = t.structure || {}, act = '';
      if (r.committee && t.status === 'draft' && t.created_by !== r.me) act = '<button class="btn" type="button" data-tpl-approve="' + esc(String(t.id)) + '">Approve</button>';
      if (r.committee && t.status === 'approved') act = '<button class="btn" type="button" data-tpl-use="' + esc(String(t.id)) + '">Create a project</button>';
      return '<tr><td>' + esc(t.name) + ' <small class="muted">#' + esc(String(t.id)) + '</small></td><td>' + esc(String((st.tasks || []).length)) + '</td><td>' + esc(String((st.milestones || []).length)) + '</td><td>' + (t.status === 'approved' ? '✓ approved' : '<i>draft — not approved</i>') + '</td><td>' + esc(t.created_by_name || '—') + '</td><td>' + esc(t.approved_by_name || '—') + '</td><td>' + act + '</td></tr>';
    }).join('') + '</tbody></table><p class="muted">A template carries the structure only (task names, WBS, durations, milestone names) — never people, dates or money. Its author cannot approve it.</p>';
  }

  return { budgetHtml: budgetHtml, mountBudget: mountBudget, raciHtml: raciHtml, raciEditorHtml: raciEditorHtml, raciRowsFrom: raciRowsFrom, mountRaci: mountRaci, templatesHtml: templatesHtml };
}));
