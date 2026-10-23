/* Step 9 — notification centre: my notifications (read receipts, discussion of an alert), my subscriptions, the alert
 * rules (alert-manager) and the delivery channels (super_admin). No inline script (strict CSP). */
(function () {
  'use strict';
  var S = window.SdpApi, esc = S.esc;
  var $ = function (id) { return document.getElementById(id); };
  var st = function (m, e) { S.status($('nt-status'), m, e); };
  var cat = null, rules = [], manager = false, editing = null, fireId = null;
  var opt = function (v, t, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(t) + '</option>'; };
  var when = function (iso) { return iso ? iso.slice(0, 16).replace('T', ' ') : '—'; };
  var TABS = ['inbox', 'subs', 'rules', 'channels'];
  function show(name) { TABS.forEach(function (t) { $('t-' + t).setAttribute('aria-selected', String(t === name)); $('p-' + t).hidden = t !== name; }); }
  TABS.forEach(function (t) { $('t-' + t).addEventListener('click', function () { show(t); if (t === 'channels') loadChannels(); }); });

  // ── Inbox ────────────────────────────────────────────────────────────
  function loadInbox() {
    return S.api('GET', '/api/notifications' + ($('nt-only-unread').checked ? '?unread=1' : '')).then(function (j) {
      $('nt-unread').textContent = j.unread ? '(' + j.unread + ' non lue(s))' : '';
      $('nt-list').innerHTML = j.notifications.length ? j.notifications.map(function (n) {
        return '<li><span><b' + (n.read_at ? ' class="ck-muted"' : '') + '>' + esc(n.title) + '</b><br><small>' + esc(n.body || '') + ' · ' + when(n.created_at) + (n.read_at ? ' · lue' : '') + '</small></span>' +
          (n.fire_id ? ' <button class="db-btn" type="button" data-fire="' + esc(n.fire_id) + '">Ouvrir</button>' : '') + '</li>';
      }).join('') : '<li>Aucune notification.</li>';
    }).catch(function (e) { st(e.message, true); });
  }
  $('nt-only-unread').addEventListener('change', loadInbox);
  $('nt-read-all').addEventListener('click', function () { S.api('POST', '/api/notifications/read', { ids: 'all' }).then(loadInbox).catch(function (e) { st(e.message, true); }); });
  $('nt-list').addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-fire]'); if (b) openFire(b.getAttribute('data-fire')); });
  function openFire(id) {
    fireId = id;
    return S.api('GET', '/api/engagement/fires/' + encodeURIComponent(id)).then(function (j) {
      $('nt-fire').hidden = false;
      $('nt-fire-h').textContent = j.rule ? j.rule.title : 'Alerte';
      $('nt-fire-msg').textContent = (j.fire.message || '') + ' · déclenchée le ' + when(j.fire.fired_at) + (j.fire.resolved_at ? ' · rétablie le ' + when(j.fire.resolved_at) : ' · toujours en cours');
      $('nt-receipts').innerHTML = j.receipts ? '<p class="db-note">Accusés de lecture : ' + j.receipts.filter(function (r) { return r.read_at; }).length + ' sur ' + j.receipts.length + ' — ' +
        j.receipts.map(function (r) { return esc(r.username) + (r.read_at ? ' (lu ' + when(r.read_at) + ')' : ' (non lu)'); }).join(', ') + '</p>' : '';
      $('nt-comments').innerHTML = j.comments.length ? j.comments.map(function (c) { return '<li><b>' + esc(c.username) + '</b> — ' + esc(c.text) + ' <small class="ck-muted">' + when(c.at) + '</small></li>'; }).join('') : '<li class="ck-muted">Pas encore de commentaire.</li>';
      try { history.replaceState(null, '', '#' + id); } catch (_) {}
      loadInbox();
    }).catch(function (e) { st(e.message, true); });
  }
  $('nt-comment-form').addEventListener('submit', function (e) {
    e.preventDefault();
    S.api('POST', '/api/engagement/fires/' + encodeURIComponent(fireId) + '/comments', { text: $('nt-comment').value }).then(function () { $('nt-comment').value = ''; return openFire(fireId); }).catch(function (e2) { st(e2.message, true); });
  });

  // ── Subscriptions ────────────────────────────────────────────────────
  function loadRules() {
    return S.api('GET', '/api/engagement/rules').then(function (j) {
      rules = j.rules; manager = !!j.manager;
      $('t-rules').hidden = !manager; $('t-channels').hidden = !manager;
      var has = function (rid, ch) { return j.subscriptions.some(function (s) { return s.rule_id === rid && s.channel === ch; }); };
      var active = rules.filter(function (r) { return r.enabled; });
      $('nt-subs').innerHTML = '<thead><tr><th scope="col">Alerte</th><th scope="col">En cours</th><th scope="col">Dans l’application</th><th scope="col">Par e-mail</th></tr></thead><tbody>' +
        (active.length ? active.map(function (r) {
          return '<tr><th scope="row">' + esc(r.title) + '</th><td>' + (r.firing || (r.state && r.state.firing) ? '<span class="ck-late">oui</span>' : 'non') + '</td>' +
            ['inapp', 'email'].map(function (ch) { return '<td><label class="db-sr" for="sub-' + esc(r.id) + '-' + ch + '">' + ch + '</label><input type="checkbox" id="sub-' + esc(r.id) + '-' + ch + '" data-rule="' + esc(r.id) + '" data-ch="' + ch + '"' + (has(r.id, ch) ? ' checked' : '') + '></td>'; }).join('') + '</tr>';
        }).join('') : '<tr><td colspan="4">Aucune règle active pour l’instant.</td></tr>') + '</tbody>';
      if (manager) renderRules();
    }).catch(function (e) { st(e.message, true); });
  }
  $('nt-subs').addEventListener('change', function (e) {
    var el = e.target; if (!el.getAttribute('data-rule')) return;
    S.api('POST', '/api/engagement/subscriptions', { rule_id: el.getAttribute('data-rule'), channel: el.getAttribute('data-ch'), on: el.checked }).then(function () { st('Abonnement mis à jour.'); }).catch(function (e2) { st(e2.message, true); });
  });

  // ── Rules (alert-manager) ────────────────────────────────────────────
  function renderRules() {
    $('nt-rules').innerHTML = '<thead><tr><th scope="col">Règle</th><th scope="col">Active</th><th scope="col">Dernière valeur</th><th scope="col">En cours</th><th scope="col"></th></tr></thead><tbody>' +
      (rules.length ? rules.map(function (r) {
        var s = r.state || {};
        return '<tr><th scope="row">' + esc(r.title) + '<br><small class="ck-muted">' + esc(cat ? cat.kinds[r.kind] : r.kind) + '</small></th><td>' + (r.enabled ? '<span class="ck-ok">oui</span>' : 'non') + '</td>' +
          '<td>' + (s.last_value == null ? '—' : esc(s.last_value)) + (s.last_eval_at ? ' <small class="ck-muted">' + when(s.last_eval_at) + '</small>' : '') + '</td><td>' + (s.firing ? '<span class="ck-late">oui</span>' : 'non') + '</td>' +
          '<td class="ck-row"><button class="db-btn" type="button" data-edit="' + esc(r.id) + '">Modifier</button><button class="db-btn" type="button" data-toggle="' + esc(r.id) + '">' + (r.enabled ? 'Désactiver' : 'Activer') + '</button></td></tr>';
      }).join('') : '<tr><td colspan="5">Aucune règle. Ajoutez le catalogue initial pour partir des propositions.</td></tr>') + '</tbody>';
  }
  $('nt-rules').addEventListener('click', function (e) {
    var ed = e.target.closest && e.target.closest('[data-edit]'), tg = e.target.closest && e.target.closest('[data-toggle]');
    if (ed) openRule(rules.find(function (r) { return r.id === ed.getAttribute('data-edit'); }));
    if (tg) { var r = rules.find(function (x) { return x.id === tg.getAttribute('data-toggle'); }); S.api('POST', '/api/engagement/rules/' + encodeURIComponent(r.id) + '/enable', { enabled: !r.enabled }).then(loadRules).then(function () { st(r.enabled ? 'Règle désactivée.' : 'Règle activée : elle sera évaluée toutes les 30 minutes.'); }).catch(function (e2) { st(e2.message, true); }); }
  });
  function kindFields() {
    var k = $('nt-r-kind').value;
    $('nt-r-metric').parentNode.hidden = k !== 'metric'; $('nt-r-op').parentNode.hidden = k !== 'metric';
    $('nt-r-days').parentNode.hidden = k !== 'tickets_older'; $('nt-r-scope').parentNode.hidden = k === 'sync_health'; $('nt-r-threshold').parentNode.hidden = k === 'sync_health';
  }
  $('nt-r-kind').addEventListener('change', kindFields);
  function openRule(r) {
    editing = r || null;
    var x = r || { kind: 'metric', config: { scope: 'GROUP', op: '<' }, channels: ['inapp'], recipients: [{ type: 'role', value: 'admin' }], persistence: 2, cooldown_hours: 24 };
    $('nt-edit').hidden = false; $('nt-edit-h').textContent = r ? 'Modifier : ' + r.title : 'Nouvelle règle';
    $('nt-r-id').value = x.id || ''; $('nt-r-id').readOnly = !!r; $('nt-r-title').value = x.title || '';
    $('nt-r-kind').value = x.kind; $('nt-r-metric').value = x.config.metric || ''; $('nt-r-op').value = x.config.op || '<';
    $('nt-r-threshold').value = x.config.threshold == null ? '' : x.config.threshold; $('nt-r-days').value = String(x.config.days || 30);
    $('nt-r-scope').value = x.config.scope || 'GROUP'; $('nt-r-persist').value = x.persistence; $('nt-r-cool').value = x.cooldown_hours;
    $('nt-r-channels').innerHTML = cat.channels.map(function (c, i) { return '<label for="nt-rc-' + i + '"><input type="checkbox" id="nt-rc-' + i + '" value="' + c + '"' + (x.channels.indexOf(c) >= 0 ? ' checked' : '') + '> ' + ({ inapp: 'Dans l’application', email: 'E-mail', teams: 'Teams', webhook: 'Webhook' }[c] || c) + '</label>'; }).join('');
    $('nt-r-channel').value = x.channel_id || '';
    $('nt-r-recipients').value = (x.recipients || []).map(function (p) { return (p.type === 'user' ? '@' : '') + p.value; }).join(', ');
    $('nt-r-enabled').checked = !!x.enabled; $('nt-r-del').hidden = !r; $('nt-r-test').hidden = !r; $('nt-r-out').textContent = '';
    kindFields();
    if (r) S.api('GET', '/api/engagement/rules/' + encodeURIComponent(r.id) + '/fires').then(function (j) {
      $('nt-r-fires').innerHTML = '<thead><tr><th scope="col">Déclenchée</th><th scope="col">Valeur</th><th scope="col">Rétablie</th><th scope="col">Lue</th></tr></thead><tbody>' +
        (j.fires.length ? j.fires.map(function (f) { return '<tr><td>' + when(f.fired_at) + '</td><td>' + esc(f.value) + '</td><td>' + when(f.resolved_at) + '</td><td>' + f.read + ' / ' + f.notified + '</td></tr>'; }).join('') : '<tr><td colspan="4">Jamais déclenchée.</td></tr>') + '</tbody>';
    }); else $('nt-r-fires').innerHTML = '';
  }
  $('nt-new').addEventListener('click', function () { openRule(null); });
  $('nt-r-cancel').addEventListener('click', function () { $('nt-edit').hidden = true; });
  $('nt-rule-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var k = $('nt-r-kind').value;
    var body = { id: $('nt-r-id').value.trim(), title: $('nt-r-title').value.trim(), kind: k,
      config: { metric: $('nt-r-metric').value, op: $('nt-r-op').value, threshold: $('nt-r-threshold').value, days: Number($('nt-r-days').value), scope: $('nt-r-scope').value },
      channels: Array.prototype.slice.call($('nt-r-channels').querySelectorAll('input:checked')).map(function (x) { return x.value; }),
      channel_id: $('nt-r-channel').value || null, persistence: $('nt-r-persist').value, cooldown_hours: $('nt-r-cool').value, enabled: $('nt-r-enabled').checked,
      recipients: $('nt-r-recipients').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) { return s.charAt(0) === '@' ? { type: 'user', value: s.slice(1) } : { type: 'role', value: s }; }) };
    S.api('POST', '/api/engagement/rules', body).then(function () { return loadRules().then(function () { st('Règle enregistrée.'); $('nt-edit').hidden = true; }); }).catch(function (e2) { st(e2.message, true); });
  });
  $('nt-r-test').addEventListener('click', function () {
    S.api('POST', '/api/engagement/rules/' + encodeURIComponent(editing.id) + '/test', {}).then(function (j) {
      $('nt-r-out').textContent = 'Valeur actuelle : ' + (j.value == null ? 'non mesurée' : j.value) + ' — ' + (j.breach ? 'la règle serait en alerte. ' : 'pas d’alerte. ') + j.message;
    }).catch(function (e) { st(e.message, true); });
  });
  $('nt-r-del').addEventListener('click', function () { S.api('DELETE', '/api/engagement/rules/' + encodeURIComponent(editing.id)).then(function () { $('nt-edit').hidden = true; return loadRules(); }).catch(function (e) { st(e.message, true); }); });
  $('nt-import').addEventListener('click', function () { S.api('POST', '/api/engagement/catalogue/import', {}).then(function (j) { return loadRules().then(function () { st(j.added + ' règle(s) ajoutée(s), désactivées : activez celles que le comité retient.'); }); }).catch(function (e) { st(e.message, true); }); });

  // ── Channels ─────────────────────────────────────────────────────────
  function loadChannels() {
    S.api('GET', '/api/engagement/channels').then(function (j) {
      var sa = window.__userHasRole && window.__userHasRole('super_admin');
      $('nt-ch-form').hidden = !sa;
      $('nt-channels').innerHTML = j.channels.length ? j.channels.map(function (c) { return '<li><span><b>' + esc(c.name) + '</b> — ' + (c.kind === 'teams' ? 'Teams' : 'Webhook' + (c.signed ? ', signé' : '')) + ' <small class="ck-muted">ajouté par ' + esc(c.created_by || '—') + '</small></span>' + (sa ? ' <button class="db-btn db-danger" type="button" data-delch="' + esc(c.id) + '">Retirer</button>' : '') + '</li>'; }).join('') : '<li>Aucun canal.</li>';
    }).catch(function (e) { st(e.message, true); });
  }
  $('nt-channels').addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-delch]'); if (b) S.api('DELETE', '/api/engagement/channels/' + encodeURIComponent(b.getAttribute('data-delch'))).then(loadChannels).catch(function (e2) { st(e2.message, true); }); });
  $('nt-ch-form').addEventListener('submit', function (e) {
    e.preventDefault();
    S.api('POST', '/api/engagement/channels', { name: $('nt-ch-name').value, kind: $('nt-ch-kind').value, url: $('nt-ch-url').value, signing_secret: $('nt-ch-secret').value })
      .then(function () { ['nt-ch-name', 'nt-ch-url', 'nt-ch-secret'].forEach(function (x) { $(x).value = ''; }); loadChannels(); st('Canal ajouté ; son adresse est chiffrée.'); }).catch(function (e2) { st(e2.message, true); });
  });

  // ── Start ────────────────────────────────────────────────────────────
  loadInbox().then(loadRules).then(function () {
    if (!manager) return;
    return S.api('GET', '/api/engagement/catalog').then(function (c) {
      cat = c;
      $('nt-r-kind').innerHTML = Object.keys(c.kinds).map(function (k) { return opt(k, c.kinds[k]); }).join('');
      $('nt-r-metric').innerHTML = c.metrics.map(function (m) { return opt(m.key, m.fr || m.key); }).join('');
      $('nt-r-scope').innerHTML = opt('GROUP', 'Ensemble du groupe') + c.sites.map(function (s) { return opt(s.code, s.name); }).join('');
      $('nt-r-channel').innerHTML = opt('', '— aucun —') + c.channel_list.map(function (x) { return opt(x.id, x.name); }).join('');
      renderRules();
    });
  }).then(function () {
    var h = decodeURIComponent((location.hash || '').slice(1));
    if (/^F-/.test(h)) openFire(h);
  }).catch(function (e) { st(e.message, true); });
})();
