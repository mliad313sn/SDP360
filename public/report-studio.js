/* Step 9 — report studio: generate a draft from a template, review and edit the commentary, approve, outputs (HTML,
 * PDF, slides, CSV), share link. No inline script (strict CSP). */
(function () {
  'use strict';
  var S = window.SdpApi, esc = S.esc;
  var $ = function (id) { return document.getElementById(id); };
  var st = function (m, e) { S.status($('rs-status'), m, e); };
  var templates = [], cur = null;
  var STATUS = { draft: 'Brouillon', approved: 'Validé' };
  var ACTION = { generated: 'généré', edited: 'commentaire modifié', approved: 'validé', shared: 'partagé' };
  var opt = function (v, t, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(t) + '</option>'; };

  function load() {
    return Promise.all([S.api('GET', '/api/reportgen/templates'), S.api('GET', '/api/reportgen/runs')]).then(function (r) {
      var t = r[0]; templates = t.templates;
      $('rs-gen').hidden = !t.author;
      $('rs-site').innerHTML = opt('', '— ensemble du groupe —') + (t.sites || []).map(function (s) { return opt(s.code, s.name); }).join('');
      $('rs-template').innerHTML = templates.filter(function (x) { return x.published_version; }).map(function (x) { return opt(x.id, S.label(x.title) + (x.scope === 'own' ? ' (un site)' : '')); }).join('');
      $('rs-ai').textContent = t.ai_available ? 'Rédaction assistée disponible sur ce serveur pour les modèles qui la demandent ; tout chiffre absent des données fait rejeter le texte proposé.' : 'Rédaction par intelligence artificielle désactivée sur ce serveur : l’analyse est rédigée automatiquement à partir des chiffres.';
      var rows = r[1].runs;
      $('rs-runs').innerHTML = '<thead><tr><th scope="col">Mois</th><th scope="col">Rapport</th><th scope="col">Site</th><th scope="col">État</th><th scope="col"></th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (x) { return '<tr><td>' + esc(x.month) + '</td><td>' + esc(S.label(x.title)) + '</td><td>' + esc(x.site_code || 'Groupe') + '</td><td>' + esc(STATUS[x.status] || x.status) + (x.approved_by ? ' par ' + esc(x.approved_by) : '') + '</td><td><button class="db-btn" type="button" data-run="' + esc(x.id) + '">Ouvrir</button></td></tr>'; }).join('')
          : '<tr><td colspan="5">Aucun rapport.</td></tr>') + '</tbody>';
    }).catch(function (e) { st(e.message, true); });
  }
  $('rs-form').addEventListener('submit', function (e) {
    e.preventDefault();
    st('Génération en cours (les chiffres sont calculés maintenant)…');
    S.api('POST', '/api/reportgen/runs', { template_id: $('rs-template').value, month: $('rs-month').value, site: $('rs-site').value }).then(function (j) {
      return load().then(function () { return openRun(j.run.id); }).then(function () {
        var ai = j.run.ai;
        st('Brouillon généré.' + (ai ? (ai.accepted ? ' Commentaire rédigé par l’assistant, chiffres vérifiés.' : ai.skipped ? ' ' + ai.skipped.charAt(0).toUpperCase() + ai.skipped.slice(1) + '.' : ' Texte de l’assistant rejeté (chiffres inconnus : ' + ai.unknown.join(', ') + ') : analyse automatique conservée.') : ''));
      });
    }).catch(function (e2) { st(e2.message, true); });
  });
  $('rs-runs').addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-run]'); if (b) openRun(b.getAttribute('data-run')); });

  function openRun(id) {
    return S.api('GET', '/api/reportgen/runs/' + encodeURIComponent(id)).then(function (j) {
      cur = j;
      $('rs-run').hidden = false;
      $('rs-run-h').textContent = S.label(j.template.title) + ' — ' + j.run.month + (j.run.site_code ? ' — ' + j.run.site_code : '');
      $('rs-run-meta').textContent = (STATUS[j.run.status] || j.run.status) + ' · généré le ' + j.run.created_at.slice(0, 16).replace('T', ' ') + ' par ' + (j.run.created_by || '—') + (j.run.approved_by ? ' · validé par ' + j.run.approved_by : '');
      $('rs-approve').hidden = !j.can_approve; $('rs-share').hidden = !j.can_share; $('rs-save').hidden = !j.can_edit; $('rs-share-out').textContent = '';
      var secs = j.template.sections.filter(function (s) { return s.type === 'commentary'; });
      $('rs-commentary').innerHTML = secs.map(function (s) {
        var txt = (j.run.commentary || {})[s.id] || '';
        return '<label class="ck-wide" for="rs-c-' + esc(s.id) + '"><b>' + esc(s.title) + '</b><textarea class="ck-notes" id="rs-c-' + esc(s.id) + '" data-sec="' + esc(s.id) + '"' + (j.can_edit ? '' : ' readonly') + '>' + esc(txt) + '</textarea></label>';
      }).join('') || '<p class="db-note">Ce modèle n’a pas de section de commentaire.</p>';
      $('rs-events').innerHTML = (j.events || []).map(function (ev) { return '<li>' + esc(ev.at.slice(0, 16).replace('T', ' ')) + ' — ' + esc(ACTION[ev.action] || ev.action) + (ev.by ? ' par ' + esc(ev.by) : '') + (ev.note ? ' : ' + esc(ev.note) : '') + '</li>'; }).join('') || '<li class="ck-muted">—</li>';
    }).catch(function (e) { st(e.message, true); });
  }
  $('rs-save').addEventListener('click', function () {
    var c = {}; Array.prototype.slice.call($('rs-commentary').querySelectorAll('textarea')).forEach(function (t) { c[t.getAttribute('data-sec')] = t.value; });
    S.api('PUT', '/api/reportgen/runs/' + encodeURIComponent(cur.run.id) + '/commentary', { commentary: c }).then(function () { return openRun(cur.run.id).then(function () { st('Commentaire enregistré.'); }); }).catch(function (e) { st(e.message, true); });
  });
  $('rs-approve').addEventListener('click', function () {
    S.api('POST', '/api/reportgen/runs/' + encodeURIComponent(cur.run.id) + '/approve', {}).then(function () { return load().then(function () { return openRun(cur.run.id); }).then(function () { st('Rapport validé : il est diffusable.'); }); }).catch(function (e) { st(e.message, true); });
  });
  $('rs-share').addEventListener('click', function () {
    S.api('POST', '/api/reportgen/runs/' + encodeURIComponent(cur.run.id) + '/share', { days: 7 }).then(function (j) {
      $('rs-share-out').textContent = 'Lien valable ' + j.days + ' jour(s), jusqu’au ' + j.expires_at.slice(0, 10) + ' : ' + location.origin + j.path;
    }).catch(function (e) { st(e.message, true); });
  });
  document.querySelector('#rs-run .db-toolbar').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-out]'); if (!b) return;
    var fmt = b.getAttribute('data-out'), path = '/api/reportgen/runs/' + encodeURIComponent(cur.run.id) + '/output.' + fmt;
    (fmt === 'html' ? S.openDocument(path) : S.download(path, cur.run.template_id + '-' + cur.run.month + '.' + fmt)).catch(function (e2) { st(e2.message, true); });
  });
  var d = new Date(); d.setUTCMonth(d.getUTCMonth() - 1);
  $('rs-month').value = d.toISOString().slice(0, 7);
  load();
})();
