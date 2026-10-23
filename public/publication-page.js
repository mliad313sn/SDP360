/* Step 9 — external publication admin: API consumers (key shown once), scheduled publications, snapshot, embed links.
 * No inline script (strict CSP). */
(function () {
  'use strict';
  var S = window.SdpApi, esc = S.esc;
  var $ = function (id) { return document.getElementById(id); };
  var st = function (m, e) { S.status($('pb-status'), m, e); };
  var opt = function (v, t, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(t) + '</option>'; };
  var superAdmin = window.__userHasRole && window.__userHasRole('super_admin');
  var FREQ = { daily: 'chaque jour', weekly: 'chaque semaine', monthly: 'chaque mois' };
  $('pb-odata').textContent = location.origin + '/odata';

  function loadClients() {
    return S.api('GET', '/api/publication/clients').then(function (j) {
      $('pb-clients').innerHTML = j.clients.length ? j.clients.map(function (c) {
        return '<li><span><b>' + esc(c.name) + '</b> — identifiant <code>' + esc(c.id) + '</code>, clé ' + esc(c.key_prefix) + '…, accès ' + esc(c.scopes.join(', ')) + ', ' + c.quota_per_day + ' appels/jour' + (c.revoked_at ? ' · <span class="ck-late">révoquée</span>' : '') + '</span>' +
          (c.revoked_at ? '' : ' <button class="db-btn db-danger" type="button" data-revoke="' + esc(c.id) + '">Révoquer</button>') + '</li>';
      }).join('') : '<li>Aucun consommateur.</li>';
    });
  }
  $('pb-clients').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-revoke]'); if (!b) return;
    S.api('POST', '/api/publication/clients/' + encodeURIComponent(b.getAttribute('data-revoke')) + '/revoke', {}).then(function () { loadClients(); st('Clé révoquée : elle ne fonctionne plus.'); }).catch(function (e2) { st(e2.message, true); });
  });
  $('pb-client-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var scopes = ['pb-c-m', 'pb-c-r'].filter(function (id) { return $(id).checked; }).map(function (id) { return $(id).value; });
    S.api('POST', '/api/publication/clients', { name: $('pb-c-name').value, scopes: scopes, quota_per_day: $('pb-c-quota').value }).then(function (j) {
      $('pb-key').hidden = false;
      $('pb-key').textContent = 'Clé de « ' + j.client.name + ' » (identifiant ' + j.client.id + ') : ' + j.key + ' — copiez-la maintenant, elle ne sera plus jamais affichée.';
      $('pb-c-name').value = ''; loadClients();
    }).catch(function (e2) { st(e2.message, true); });
  });

  function loadJobs() {
    return S.api('GET', '/api/publication/jobs').then(function (j) {
      $('pb-j-channel').innerHTML = opt('', '— aucun —') + j.channels.map(function (c) { return opt(c.id, c.name); }).join('');
      var tpl = j.templates.map(function (t) { return opt(t.id, S.label(t.title) || t.id); }).join('');
      $('pb-j-template').innerHTML = opt('', '— aucun —') + tpl; $('pb-e-template').innerHTML = tpl;
      $('pb-j-metrics').innerHTML = j.metrics.map(function (m) { return opt(m.key, m.fr || m.key); }).join('');
      $('pb-jobs').innerHTML = '<thead><tr><th scope="col">Publication</th><th scope="col">Destination</th><th scope="col">Rythme</th><th scope="col">Dernier envoi</th><th scope="col"></th></tr></thead><tbody>' +
        (j.publications.length ? j.publications.map(function (p) {
          return '<tr><th scope="row">' + esc(p.title) + (p.enabled ? '' : ' <small class="ck-muted">(inactive)</small>') + '</th><td>' + esc(p.kind) + '</td><td>' + esc(FREQ[p.schedule.freq] || p.schedule.freq) + ', ' + p.schedule.hour + ' h UTC</td>' +
            '<td>' + esc(p.last_run_at ? p.last_run_at.slice(0, 16).replace('T', ' ') + ' — ' + p.last_status : '—') + '</td><td class="ck-row"><button class="db-btn" type="button" data-run="' + esc(p.id) + '">Envoyer maintenant</button><button class="db-btn db-danger" type="button" data-del="' + esc(p.id) + '">Supprimer</button></td></tr>';
        }).join('') : '<tr><td colspan="5">Aucune publication.</td></tr>') + '</tbody>';
    });
  }
  $('pb-jobs').addEventListener('click', function (e) {
    var r = e.target.closest && e.target.closest('[data-run]'), d = e.target.closest && e.target.closest('[data-del]');
    if (r) S.api('POST', '/api/publication/jobs/' + encodeURIComponent(r.getAttribute('data-run')) + '/run', {}).then(function () { loadJobs(); st('Publication envoyée.'); }).catch(function (e2) { loadJobs(); st(e2.message, true); });
    if (d) S.api('DELETE', '/api/publication/jobs/' + encodeURIComponent(d.getAttribute('data-del'))).then(loadJobs).catch(function (e2) { st(e2.message, true); });
  });
  $('pb-job-form').addEventListener('submit', function (e) {
    e.preventDefault();
    S.api('POST', '/api/publication/jobs', { title: $('pb-j-title').value, kind: $('pb-j-kind').value, channel_id: $('pb-j-channel').value || null, recipients: $('pb-j-to').value,
      what: { metrics: Array.prototype.slice.call($('pb-j-metrics').selectedOptions).map(function (o) { return o.value; }), scope: $('pb-j-scope').value, template_id: $('pb-j-template').value || null },
      schedule: { freq: $('pb-j-freq').value, day: $('pb-j-day').value, weekday: $('pb-j-weekday').value, hour: $('pb-j-hour').value }, enabled: $('pb-j-enabled').checked })
      .then(function () { $('pb-j-title').value = ''; return loadJobs().then(function () { st('Publication créée.'); }); }).catch(function (e2) { st(e2.message, true); });
  });
  $('pb-snapshot').addEventListener('click', function () {
    st('Calcul des indicateurs publiés (13 mois, groupe et sites)…');
    S.api('POST', '/api/publication/snapshot', {}).then(function (j) { st(j.values + ' valeur(s) calculée(s) : ' + j.keys + ' indicateur(s) × ' + j.scopes + ' périmètre(s) × ' + j.months + ' mois.'); }).catch(function (e) { st(e.message, true); });
  });
  $('pb-embed-form').addEventListener('submit', function (e) {
    e.preventDefault();
    S.api('POST', '/api/publication/embed', { template_id: $('pb-e-template').value, days: $('pb-e-days').value }).then(function (j) {
      $('pb-embed-out').textContent = 'Lien valable jusqu’au ' + j.expires_at.slice(0, 10) + ' (pages autorisées : ' + j.frame_ancestors + ') : ' + location.origin + j.path;
    }).catch(function (e2) { st(e2.message, true); });
  });

  function loadSettings() {
    return S.api('GET', '/api/reports/config').then(function (c) {
      $('pb-s-email').checked = String(c.engagement_email) === '1';
      $('pb-s-base').value = c.public_base_url || '';
      var chosen = String(c.published_metrics || '').split(',').filter(Boolean);
      return S.api('GET', '/api/publication/jobs').then(function (j) {
        $('pb-s-metrics').innerHTML = j.metrics.map(function (m) { return opt(m.key, m.fr || m.key, chosen.indexOf(m.key) >= 0); }).join('');
      });
    });
  }
  $('pb-settings-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var base = $('pb-s-base').value.trim().replace(/\/$/, '');
    if (base && !/^https?:\/\/[^\s]+$/.test(base)) { st('L’adresse publique doit commencer par https://', true); return; }
    S.api('PUT', '/api/reports/config', { engagement_email: $('pb-s-email').checked ? '1' : '0', public_base_url: base,
      published_metrics: Array.prototype.slice.call($('pb-s-metrics').selectedOptions).map(function (o) { return o.value; }).join(',') })
      .then(function () { st('Réglages enregistrés.'); }).catch(function (e2) { st(e2.message, true); });
  });
  $('pb-settings-w').hidden = !superAdmin;
  if (superAdmin) loadSettings().catch(function (e) { st(e.message, true); });
  $('pb-clients-w').hidden = !superAdmin; $('pb-jobs-w').hidden = !superAdmin;
  (superAdmin ? loadClients().then(loadJobs) : S.api('GET', '/api/reportgen/templates').then(function (j) {
    $('pb-e-template').innerHTML = j.templates.filter(function (t) { return t.published_version; }).map(function (t) { return opt(t.id, S.label(t.title)); }).join('');
  })).catch(function (e) { st(e.message, true); });
})();
