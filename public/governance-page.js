/* Step 8 — governance indicators of the committee (GET /api/portfolio/governance). No inline script (strict CSP). */
(function () {
  'use strict';
  var S = window.SdpApi, esc = S.esc;
  var $ = function (id) { return document.getElementById(id); };
  var card = function (value, text) { return '<div class="gv-card"><b>' + esc(value) + '</b><span>' + esc(text) + '</span></div>'; };
  function load() {
    S.api('GET', '/api/portfolio/governance?from=' + $('gv-from').value + '&to=' + $('gv-to').value).then(function (g) {
      var m = g.milestones_on_time, r = g.rfi_to_decision_days, e = g.evidence_coverage;
      $('gv-cards').innerHTML =
        card(m.pct == null ? '—' : m.pct + ' %', m.pct == null ? 'Aucun jalon échu sur la période' : 'Jalons livrés à l’heure (' + m.on_time + ' sur ' + m.due + ')') +
        card(g.mean_drift_days == null ? '—' : (g.mean_drift_days > 0 ? '+' : '') + g.mean_drift_days + ' j', 'Glissement moyen des jalons par rapport à la date initiale') +
        card(r.mean == null ? '—' : r.mean + ' j', 'Délai moyen entre une demande et sa décision (' + r.decided + ' tranchée(s))') +
        card(g.rfis_open, 'Demandes en attente du comité') +
        card(e.pct == null ? '—' : e.pct + ' %', 'Objectifs portant une preuve automatique (' + e.with_evidence + ' sur ' + e.objectives + ')') +
        card(g.meetings.held, 'Réunions tenues (' + g.meetings.cadences + ' cadence(s)), ' + g.meetings.with_minutes_sent + ' avec procès-verbal envoyé');
      var rows = Object.entries(g.adoption_by_role);
      $('gv-adoption').innerHTML = '<thead><tr><th scope="col">Rôle</th><th scope="col">Personnes</th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (x) { return '<tr><th scope="row">' + esc(x[0]) + '</th><td>' + esc(x[1]) + '</td></tr>'; }).join('') : '<tr><td colspan="2">Aucune activité sur la période.</td></tr>') + '</tbody>';
      S.status($('gv-status'), 'Période du ' + g.window.from + ' au ' + g.window.to + '.');
    }).catch(function (e2) { S.status($('gv-status'), e2.message, true); });
  }
  var now = new Date();
  $('gv-to').value = now.toISOString().slice(0, 10);
  $('gv-from').value = new Date(now.getTime() - 90 * 864e5).toISOString().slice(0, 10);
  $('gv-from').addEventListener('change', load); $('gv-to').addEventListener('change', load);
  load();
})();
