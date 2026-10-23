/* Step 8 — requests to the committee: submit (everyone), triage / score / decide (committee-member). No inline
 * script (strict CSP). */
(function () {
  'use strict';
  var S = window.SdpApi, esc = S.esc;
  var $ = function (id) { return document.getElementById(id); };
  var st = function (m, e) { S.status($('rf-status'), m, e); };
  var STATUS = { new: 'Nouvelle', triage: 'En tri', scored: 'Notée', decided: 'Tranchée', rejected: 'Rejetée', done: 'Terminée' };
  var rows = [], committee = false, sel = null;

  function load() {
    var f = $('rf-filter').value;
    return S.api('GET', '/api/cockpit/rfis' + (f ? '?status=' + f : '')).then(function (j) {
      rows = j.rfis; committee = !!j.committee;
      $('rf-list').innerHTML = '<thead><tr><th scope="col">Déposée le</th><th scope="col">Objet</th><th scope="col">Catégorie</th><th scope="col">Demandeur</th><th scope="col">État</th><th scope="col">Score</th><th scope="col"></th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (r) {
          return '<tr><td>' + esc(r.submitted_at.slice(0, 10)) + '</td><td>' + esc(r.title) + '</td><td>' + esc(r.category || '—') + '</td><td>' + esc(r.requester || '—') + '</td><td>' + esc(STATUS[r.status] || r.status) +
            (r.decided_at ? ' le ' + esc(r.decided_at.slice(0, 10)) : '') + '</td><td>' + (r.score == null ? '—' : esc(r.score)) + '</td><td>' + (committee ? '<button class="db-btn" type="button" data-id="' + esc(r.id) + '">Traiter</button>' : '') + '</td></tr>';
        }).join('') : '<tr><td colspan="7">Aucune demande.</td></tr>') + '</tbody>';
    }).catch(function (e) { st(e.message, true); });
  }
  $('rf-filter').addEventListener('change', load);
  $('rf-form').addEventListener('submit', function (e) {
    e.preventDefault();
    S.api('POST', '/api/cockpit/rfis', { title: $('rf-title').value, category: $('rf-cat').value, description: $('rf-desc').value }).then(function () {
      $('rf-title').value = ''; $('rf-desc').value = '';
      return load().then(function () { st('Demande soumise au comité.'); });
    }).catch(function (e2) { st(e2.message, true); });
  });
  $('rf-list').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-id]'); if (!b) return;
    sel = rows.find(function (r) { return r.id === b.getAttribute('data-id'); });
    if (!sel) return;
    $('rf-panel').hidden = false;
    $('rf-panel-h').textContent = 'Traiter : ' + sel.title;
    $('rf-panel-desc').textContent = sel.description || 'Pas de description.';
    $('rf-value').value = sel.value || ''; $('rf-urgency').value = sel.urgency || ''; $('rf-effort').value = sel.effort || ''; $('rf-note').value = sel.triage_note || '';
    $('rf-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('rf-triage').addEventListener('submit', function (e) {
    e.preventDefault();
    S.api('POST', '/api/cockpit/rfis/' + encodeURIComponent(sel.id) + '/triage', { value: $('rf-value').value, urgency: $('rf-urgency').value, effort: $('rf-effort').value, note: $('rf-note').value })
      .then(function (j) { return load().then(function () { st('Tri enregistré' + (j.rfi.score != null ? ' — score ' + j.rfi.score : '') + '.'); }); }).catch(function (e2) { st(e2.message, true); });
  });
  $('rf-decide').addEventListener('submit', function (e) {
    e.preventDefault();
    S.api('POST', '/api/cockpit/rfis/' + encodeURIComponent(sel.id) + '/decide', { text: $('rf-dec').value, owner: $('rf-owner').value, rejected: $('rf-reject').checked })
      .then(function () { $('rf-panel').hidden = true; $('rf-dec').value = ''; return load().then(function () { st('Décision enregistrée et tracée.'); }); }).catch(function (e2) { st(e2.message, true); });
  });
  load();
})();
