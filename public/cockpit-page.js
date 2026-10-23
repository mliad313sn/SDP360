/* Step 8 — the meeting cockpit: meetings (plan, open), cadences (chairs: editor, agenda preview, publish), actions
 * (follow-up between meetings). No inline script (strict CSP). The server re-validates everything. */
(function () {
  'use strict';
  var S = window.SdpApi, esc = S.esc;
  var $ = function (id) { return document.getElementById(id); };
  var st = function (m, e) { S.status($('ck-status'), m, e); };
  var cat = null, chair = false, cadences = [], cur = null, model = null;
  var STATUS = { planned: 'Planifiée', live: 'En cours', closed: 'Close' };
  var opt = function (v, t, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(t) + '</option>'; };
  var today = function () { return new Date().toISOString().slice(0, 10); };

  // ── Tabs ─────────────────────────────────────────────────────────────
  var TABS = ['meetings', 'cadences', 'actions'];
  function show(name) {
    TABS.forEach(function (t) { $('t-' + t).setAttribute('aria-selected', String(t === name)); $('p-' + t).hidden = t !== name; });
    if (name === 'actions') loadActions();
    try { history.replaceState(null, '', '#' + name); } catch (_) {}
  }
  TABS.forEach(function (t) { $('t-' + t).addEventListener('click', function () { show(t); }); });

  // ── Meetings ─────────────────────────────────────────────────────────
  function loadMeetings() {
    return Promise.all([S.api('GET', '/api/cockpit/cadences'), S.api('GET', '/api/cockpit/sessions')]).then(function (r) {
      cadences = r[0].cadences; chair = !!r[0].chair;
      $('t-cadences').hidden = !chair; $('ck-plan').hidden = !chair;
      $('ck-plan-cad').innerHTML = cadences.filter(function (c) { return c.published_version && !c.retired; }).map(function (c) { return opt(c.id, c.title); }).join('');
      $('ck-plan-date').value = today();
      var rows = r[1].sessions;
      $('ck-sessions').innerHTML = '<thead><tr><th scope="col">Date</th><th scope="col">Réunion</th><th scope="col">État</th><th scope="col">Procès-verbal</th><th scope="col"></th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (s) {
          return '<tr><td>' + esc(s.held_on) + '</td><td>' + esc(s.title) + '</td><td>' + esc(STATUS[s.status] || s.status) + '</td><td>' +
            (s.has_minutes ? 'Rédigé' + (s.minutes_sent_at ? ', envoyé' : '') : '—') + '</td><td><a class="db-btn" href="cockpit-session.html#' + esc(s.id) + '">' + (s.status === 'closed' ? 'Consulter' : chair ? 'Animer' : 'Suivre') + '</a></td></tr>';
        }).join('') : '<tr><td colspan="5">Aucune réunion pour l’instant.</td></tr>') + '</tbody>';
    }).catch(function (e) { st(e.message, true); });
  }
  $('ck-plan-form').addEventListener('submit', function (e) {
    e.preventDefault();
    S.api('POST', '/api/cockpit/sessions', { cadence_id: $('ck-plan-cad').value, held_on: $('ck-plan-date').value }).then(function (s) {
      return loadMeetings().then(function () { st('Réunion du ' + s.held_on + ' planifiée.'); });
    }).catch(function (e2) { st(e2.message, true); });
  });

  // ── Cadences ─────────────────────────────────────────────────────────
  function fillCadencePick(selectId) {
    $('ck-cad-pick').innerHTML = opt('', '— choisir —') + cadences.map(function (c) { return opt(c.id, c.title + (c.published_version ? ' · v' + c.published_version : ' · brouillon') + (c.retired ? ' · retirée' : '')); }).join('');
    if (selectId) { $('ck-cad-pick').value = selectId; return openCadence(selectId); }
    return Promise.resolve();
  }
  function openCadence(id) {
    if (!id) { $('ck-cad-editor').hidden = true; return Promise.resolve(); }
    return S.api('GET', '/api/cockpit/cadences/' + encodeURIComponent(id)).then(function (j) {
      cur = j; model = JSON.parse(JSON.stringify(j.draft || (j.published && j.published.definition) || {}));
      model.agenda = model.agenda || []; model.participants = model.participants || [];
      $('ck-cad-editor').hidden = false; $('ck-c-preview-out').innerHTML = '';
      fillCadence(); renderAgenda(); renderVersions(); check();
    }).catch(function (e) { st(e.message, true); });
  }
  function siteOptions(sel) { return opt('', 'Ensemble du groupe', !sel) + cat.sites.map(function (s) { return opt(s.site_id, s.name, Number(sel) === s.site_id); }).join(''); }
  function fillCadence() {
    $('ck-c-title').value = model.title || '';
    $('ck-c-type').innerHTML = Object.keys(cat.types).map(function (k) { return opt(k, cat.types[k], k === model.type); }).join('');
    $('ck-c-site').innerHTML = siteOptions(model.site_id);
    $('ck-c-rhythm').value = model.rhythm || 'weekly'; $('ck-c-weekday').value = String(model.weekday || 1);
    $('ck-c-time').value = model.time || '09:00'; $('ck-c-duration').value = model.duration_min || 60; $('ck-c-preparer').value = model.preparer || '';
    $('ck-c-participants').value = model.participants.map(function (p) { return [p.name, p.email || '', p.role || ''].join(' ; ').replace(/( ; )+$/, ''); }).join('\n');
  }
  function readCadence() {
    model.title = $('ck-c-title').value.trim(); model.type = $('ck-c-type').value;
    model.site_id = $('ck-c-site').value ? Number($('ck-c-site').value) : null;
    model.rhythm = $('ck-c-rhythm').value; model.weekday = Number($('ck-c-weekday').value); model.time = $('ck-c-time').value;
    model.duration_min = Number($('ck-c-duration').value); model.preparer = $('ck-c-preparer').value.trim();
    model.participants = $('ck-c-participants').value.split('\n').map(function (l) { return l.split(';').map(function (x) { return x.trim(); }); })
      .filter(function (p) { return p[0]; }).map(function (p) { var o = { name: p[0] }; if (p[1]) o.email = p[1]; if (p[2]) o.role = p[2]; return o; });
  }
  function renderAgenda() {
    $('ck-c-agenda').innerHTML = '<thead><tr><th scope="col">Section</th><th scope="col">Titre</th><th scope="col">Minutes</th><th scope="col">Indicateurs / texte</th><th scope="col"></th></tr></thead><tbody>' +
      model.agenda.map(function (s, i) {
        var extra = s.kind === 'kpi'
          ? '<label class="db-sr" for="ag-m-' + i + '">indicateurs</label><select multiple size="4" id="ag-m-' + i + '" data-i="' + i + '" data-f="metrics">' + cat.metrics.map(function (m) { return opt(m.key, m.fr || m.key, (s.metrics || []).indexOf(m.key) >= 0); }).join('') + '</select>'
          : s.kind === 'topic' ? '<label class="db-sr" for="ag-x-' + i + '">texte</label><input id="ag-x-' + i + '" data-i="' + i + '" data-f="text" value="' + esc(s.text || '') + '">' : '<span class="ck-muted">calculé à l’ouverture</span>';
        return '<tr><td>' + esc(cat.sections[s.kind] || s.kind) + '</td><td><label class="db-sr" for="ag-t-' + i + '">titre</label><input id="ag-t-' + i + '" data-i="' + i + '" data-f="title" value="' + esc(s.title || '') + '"></td>' +
          '<td class="tb-num"><label class="db-sr" for="ag-n-' + i + '">minutes</label><input id="ag-n-' + i + '" data-i="' + i + '" data-f="minutes" inputmode="numeric" value="' + esc(s.minutes || '') + '"></td><td>' + extra + '</td>' +
          '<td class="ck-row"><button class="db-btn" type="button" data-up="' + i + '" aria-label="Monter">↑</button><button class="db-btn db-danger" type="button" data-del="' + i + '" aria-label="Supprimer">×</button></td></tr>';
      }).join('') + '</tbody>';
  }
  $('ck-c-agenda').addEventListener('change', function (e) {
    var el = e.target, i = Number(el.getAttribute('data-i')), f = el.getAttribute('data-f'); if (!f) return;
    if (f === 'metrics') model.agenda[i].metrics = Array.prototype.slice.call(el.selectedOptions).map(function (o) { return o.value; }).slice(0, 8);
    else if (f === 'minutes') model.agenda[i].minutes = Number(el.value) || 0;
    else model.agenda[i][f] = el.value;
    check();
  });
  $('ck-c-agenda').addEventListener('click', function (e) {
    var up = e.target.closest && e.target.closest('[data-up]'), del = e.target.closest && e.target.closest('[data-del]');
    if (up) { var i = Number(up.getAttribute('data-up')); if (i > 0) { var t = model.agenda[i - 1]; model.agenda[i - 1] = model.agenda[i]; model.agenda[i] = t; } }
    else if (del) model.agenda.splice(Number(del.getAttribute('data-del')), 1);
    else return;
    renderAgenda(); check();
  });
  $('ck-c-add').addEventListener('click', function () {
    var k = $('ck-c-addkind').value; model.agenda.push({ kind: k, title: cat.sections[k], minutes: 10, metrics: k === 'kpi' ? ['helpdesk.sla_res_pct'] : undefined });
    renderAgenda(); check();
  });
  ['ck-c-title', 'ck-c-type', 'ck-c-site', 'ck-c-rhythm', 'ck-c-weekday', 'ck-c-time', 'ck-c-duration', 'ck-c-preparer', 'ck-c-participants'].forEach(function (id) { $(id).addEventListener('change', function () { readCadence(); check(); }); });
  function check() {
    readCadence();
    return S.api('PUT', '/api/cockpit/cadences/' + encodeURIComponent(cur.id) + '/draft', { definition: model }).then(function (j) {
      $('ck-c-issues').innerHTML = (j.warnings || []).length ? j.warnings.map(function (w) { return '<div class="tb-warn">À vérifier — ' + esc(w) + '</div>'; }).join('') : '<div class="tb-ok">Cadence valide, brouillon enregistré.</div>';
    }).catch(function (e) {
      var d = (e.body && e.body.details) || [e.message];
      $('ck-c-issues').innerHTML = d.map(function (x) { return '<div class="tb-err">Bloquant — ' + esc(x) + '</div>'; }).join('');
    });
  }
  function renderVersions() {
    var v = cur.versions || [];
    $('ck-c-versions').innerHTML = v.length ? v.map(function (x) { return '<li>v' + x.version + ' · ' + esc((x.published_at || '').slice(0, 16).replace('T', ' ')) + ' · ' + esc(x.published_by || '—') + (x.note ? ' — ' + esc(x.note) : '') + '</li>'; }).join('') : '<li>Jamais publiée.</li>';
  }
  $('ck-c-save').addEventListener('click', function () { check().then(function () { st('Brouillon enregistré.'); }); });
  $('ck-c-publish').addEventListener('click', function () {
    check().then(function () { return S.api('POST', '/api/cockpit/cadences/' + encodeURIComponent(cur.id) + '/publish', {}); })
      .then(function (j) { return reloadCadences(cur.id).then(function () { st('Cadence publiée (version ' + j.version + ').'); }); })
      .catch(function (e) { st(e.message, true); });
  });
  $('ck-c-retire').addEventListener('click', function () {
    S.api('POST', '/api/cockpit/cadences/' + encodeURIComponent(cur.id) + '/retire', {}).then(function () { return reloadCadences(cur.id).then(function () { st('Cadence retirée.'); }); }).catch(function (e) { st(e.message, true); });
  });
  $('ck-c-preview').addEventListener('click', function () {
    st('Préparation de l’ordre du jour…');
    S.api('GET', '/api/cockpit/cadences/' + encodeURIComponent(cur.id) + '/agenda?date=' + today()).then(function (a) {
      $('ck-c-preview-out').innerHTML = '<div class="db-w"><h2>Aperçu — ' + esc(a.site ? a.site.name : 'ensemble du groupe') + ', ' + esc(a.held_on) + '</h2></div>' + a.sections.map(sectionHtml).join('');
      st('');
    }).catch(function (e) { st(e.message, true); });
  });
  var sectionHtml = function (x) { return window.CockpitRender.section(x); };
  function reloadCadences(selectId) {
    return S.api('GET', '/api/cockpit/cadences').then(function (j) { cadences = j.cadences; return fillCadencePick(selectId); }).then(loadMeetings);
  }
  $('ck-cad-pick').addEventListener('change', function () { openCadence(this.value); });
  $('ck-cad-new').addEventListener('click', function () { $('ck-cad-new-form').hidden = false; $('ck-new-id').focus(); });
  $('ck-cad-new-form').addEventListener('submit', function (e) {
    e.preventDefault();
    S.api('POST', '/api/cockpit/cadences', { id: $('ck-new-id').value.trim(), title: $('ck-new-title').value.trim(), type: $('ck-new-type').value, site_id: $('ck-new-site').value || null })
      .then(function (j) { $('ck-cad-new-form').hidden = true; return reloadCadences(j.id).then(function () { st('Cadence créée à partir de l’ordre du jour type. Complétez les participants puis publiez.'); }); })
      .catch(function (e2) { st(e2.message, true); });
  });

  // ── Actions ──────────────────────────────────────────────────────────
  function loadActions() {
    var s = $('ck-a-status').value;
    S.api('GET', '/api/cockpit/actions' + (s ? '?status=' + s : '')).then(function (j) {
      var t = today();
      $('ck-actions').innerHTML = '<thead><tr><th scope="col">Action</th><th scope="col">Responsable</th><th scope="col">Échéance</th><th scope="col">Rattachée à</th><th scope="col">Mettre à jour</th></tr></thead><tbody>' +
        (j.actions.length ? j.actions.map(function (a) {
          var late = a.status === 'open' && a.due_date && a.due_date < t;
          return '<tr><td>' + esc(a.title) + '</td><td>' + esc(a.owner || '—') + '</td><td class="' + (late ? 'ck-late' : '') + '">' + esc(a.due_date || '—') + (late ? ' (en retard)' : '') + '</td><td>' + esc(a.source_kind === 'free' ? '—' : a.source_kind + (a.source_ref ? ' ' + a.source_ref : '')) + '</td>' +
            '<td class="ck-row">' + (a.status === 'open' ? '<button class="db-btn" type="button" data-act="' + esc(a.id) + '" data-to="done">Faite</button><button class="db-btn" type="button" data-act="' + esc(a.id) + '" data-to="cancelled">Abandonner</button>' : '<button class="db-btn" type="button" data-act="' + esc(a.id) + '" data-to="open">Rouvrir</button>') + '</td></tr>';
        }).join('') : '<tr><td colspan="5">Aucune action.</td></tr>') + '</tbody>';
    }).catch(function (e) { st(e.message, true); });
  }
  $('ck-a-status').addEventListener('change', loadActions);
  $('ck-actions').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-act]'); if (!b) return;
    S.api('POST', '/api/cockpit/actions/' + encodeURIComponent(b.getAttribute('data-act')), { status: b.getAttribute('data-to') })
      .then(function () { loadActions(); st('Action mise à jour.'); }).catch(function (e2) { st(e2.message, true); });
  });

  // ── Start ────────────────────────────────────────────────────────────
  loadMeetings().then(function () {
    if (!chair) return;
    return S.api('GET', '/api/cockpit/catalog').then(function (c) {
      cat = c;
      $('ck-new-type').innerHTML = Object.keys(c.types).map(function (k) { return opt(k, c.types[k]); }).join('');
      $('ck-new-site').innerHTML = siteOptions(null);
      $('ck-c-addkind').innerHTML = Object.keys(c.sections).map(function (k) { return opt(k, c.sections[k]); }).join('');
      return fillCadencePick();
    });
  }).then(function () {
    var h = (location.hash || '').slice(1);
    if (TABS.indexOf(h) >= 0 && !(h === 'cadences' && !chair)) show(h);
  }).catch(function (e) { st(e.message, true); });
})();
