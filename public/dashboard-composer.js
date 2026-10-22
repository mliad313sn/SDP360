/* Step 6 (lot 6.5) — the dashboard composer. No inline script (strict CSP). Edits a definition in memory,
 * saves it as the draft (PUT), previews it server-side in a chosen scope (POST /preview), publishes it as the
 * next version (publisher), rolls back or retires. The server validates every definition again. */
(function () {
  'use strict';
  var R = window.DashboardRender, esc = R.esc;
  var $ = function (id) { return document.getElementById(id); };
  var tok = function () { return window.__authToken || ''; };
  var cat = null, list = [], cur = null, model = null, canPublish = false;

  function api(method, path, body) {
    return fetch(path, { method: method, headers: { 'Content-Type': 'application/json', 'x-report-token': tok() }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error((j.error || ('HTTP ' + r.status)) + (j.details ? ' — ' + j.details.join(' ; ') : '')); e.status = r.status; throw e; }
          return j;
        });
      });
  }
  function status(msg, isErr) { var s = $('dc-status'); s.textContent = msg || ''; s.className = isErr ? 'db-error' : 'db-note'; }
  var wlabel = function (type) { var w = (cat.widgets || []).find(function (x) { return x.type === type; }); return w ? w.label.fr : type; };

  // ── Load ──────────────────────────────────────────────────────────────
  function loadList(selectId) {
    return api('GET', '/api/dashboards').then(function (j) {
      list = j.dashboards.filter(function (d) { return d.editable; });
      canPublish = !!j.can_publish;
      $('dc-pick').innerHTML = '<option value="">— choisir —</option>' + list.map(function (d) {
        return '<option value="' + esc(d.id) + '">' + esc((d.title && d.title.fr) || d.id) + (d.kind === 'system' ? ' (système)' : '') + (d.published_version ? ' · v' + d.published_version : ' · brouillon') + (d.retired ? ' · retiré' : '') + '</option>';
      }).join('');
      if (selectId) { $('dc-pick').value = selectId; open(selectId); }
    });
  }
  function open(id) {
    if (!id) { $('dc-editor').hidden = true; return; }
    api('GET', '/api/dashboards/' + encodeURIComponent(id)).then(function (j) {
      cur = j;
      model = JSON.parse(JSON.stringify(j.draft || (j.published && j.published.definition) || {}));
      model.widgets = model.widgets || [];
      $('dc-editor').hidden = false; $('dc-preview-out').hidden = true;
      fillProps(); renderList(); renderVersions();
      var sys = j.kind === 'system';
      $('dc-publish').disabled = !j.can_publish; $('dc-retire').disabled = !j.can_publish || !j.published;
      status(sys ? 'Tableau système : seul un super_admin le modifie et le publie.' : (j.draft_at ? 'Brouillon enregistré le ' + j.draft_at.slice(0, 16).replace('T', ' ') + ' par ' + (j.draft_by || '—') + '.' : ''));
    }).catch(function (e) { status(e.message, true); });
  }

  // ── Properties ────────────────────────────────────────────────────────
  function fillProps() {
    $('dc-title-fr').value = (model.title && model.title.fr) || '';
    $('dc-title-en').value = (model.title && model.title.en) || '';
    $('dc-desc').value = model.description || '';
    var roles = (model.audience && model.audience.roles) || [];
    $('dc-roles').innerHTML = cat.audience_roles.map(function (r, i) {
      return '<label for="dc-role-' + i + '"><input type="checkbox" id="dc-role-' + i + '" value="' + esc(r) + '"' + (roles.indexOf(r) >= 0 ? ' checked' : '') + '> ' + esc(r) + '</label>';
    }).join('');
    $((model.audience && model.audience.site_scope) === 'own' ? 'dc-scope-own' : 'dc-scope-all').checked = true;
    $('dc-density').value = model.density === 'compact' ? 'compact' : 'comfort';
  }
  function readProps() {
    model.title = { fr: $('dc-title-fr').value.trim(), en: $('dc-title-en').value.trim() };
    model.description = $('dc-desc').value.trim();
    model.audience = { roles: Array.prototype.map.call(document.querySelectorAll('#dc-roles input:checked'), function (x) { return x.value; }),
      site_scope: $('dc-scope-own').checked ? 'own' : 'all' };
    model.density = $('dc-density').value;
  }

  // ── Widgets ───────────────────────────────────────────────────────────
  function metricOptions(sel, weeklyOnly) {
    return cat.metrics.map(function (m) {
      var off = weeklyOnly && !m.weekly;
      return '<option value="' + esc(m.key) + '"' + (sel.indexOf(m.key) >= 0 ? ' selected' : '') + (off ? ' disabled' : '') + '>' + esc(m.fr) + ' — ' + esc(m.key) + (off ? ' (mensuel seulement)' : '') + '</option>';
    }).join('');
  }
  function renderList() {
    $('dc-list').innerHTML = model.widgets.map(function (w, i) {
      var spec = cat.widgets.find(function (x) { return x.type === w.type; }) || { metrics: [0, 0] };
      var p = 'dc-w' + i + '-';
      var html = '<li class="dc-item" data-i="' + i + '"><div class="dc-item-head"><b>' + (i + 1) + '. ' + esc(wlabel(w.type)) + '</b><span>' +
        '<button class="db-btn" type="button" data-act="up" ' + (i === 0 ? 'disabled' : '') + ' aria-label="Monter">↑</button> ' +
        '<button class="db-btn" type="button" data-act="down" ' + (i === model.widgets.length - 1 ? 'disabled' : '') + ' aria-label="Descendre">↓</button> ' +
        '<button class="db-btn db-danger" type="button" data-act="del">Retirer</button></span></div>' +
        '<div class="dc-row"><label for="' + p + 'title">Titre<input id="' + p + 'title" data-f="title" value="' + esc((w.title && w.title.fr) || '') + '"></label>' +
        '<label for="' + p + 'span">Largeur (sur 12)<select id="' + p + 'span" data-f="span">' + [3, 4, 6, 8, 12].map(function (n) { return '<option' + (Number(w.span) === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label></div>';
      if (spec.metrics[1] > 0) {
        var weekly = w.type === 'trend' && w.grain !== 'month';
        html += '<label for="' + p + 'metrics">Indicateurs (' + spec.metrics[0] + ' à ' + spec.metrics[1] + ', Ctrl pour plusieurs)<select multiple id="' + p + 'metrics" data-f="metrics">' + metricOptions(w.metrics || [], weekly) + '</select></label>';
      }
      if (w.type === 'trend') {
        html += '<div class="dc-row"><label for="' + p + 'grain">Pas<select id="' + p + 'grain" data-f="grain"><option value="week"' + (w.grain !== 'month' ? ' selected' : '') + '>Semaine</option><option value="month"' + (w.grain === 'month' ? ' selected' : '') + '>Mois</option></select></label>' +
          '<label for="' + p + 'points">Points<input id="' + p + 'points" data-f="points" type="number" min="2" max="26" value="' + esc(w.points || 13) + '"></label></div>';
      }
      if (w.type === 'heatmap') html += '<label for="' + p + 'points">Mois affichés<input id="' + p + 'points" data-f="points" type="number" min="2" max="12" value="' + esc(w.points || 6) + '"></label>';
      if (w.type === 'events') html += '<label for="' + p + 'source">Contenu<select id="' + p + 'source" data-f="source"><option value="incidents"' + (w.source === 'incidents' ? ' selected' : '') + '>Incidents majeurs</option><option value="decisions"' + (w.source === 'decisions' ? ' selected' : '') + '>Décisions en attente</option></select></label>';
      if (w.type === 'text') html += '<label for="' + p + 'md">Texte (Markdown : # titre, - liste, **gras**, [lien](page.html))<textarea id="' + p + 'md" data-f="markdown" rows="3" maxlength="2000">' + esc(w.markdown || '') + '</textarea></label>';
      return html + '</li>';
    }).join('') || '<li class="db-note">Ajoutez un widget depuis le catalogue.</li>';
  }
  function onListInput(e) {
    var li = e.target.closest('.dc-item'); if (!li) return;
    var w = model.widgets[Number(li.getAttribute('data-i'))], f = e.target.getAttribute('data-f');
    if (!f) return;
    if (f === 'title') w.title = { fr: e.target.value, en: e.target.value };
    else if (f === 'metrics') w.metrics = Array.prototype.map.call(e.target.selectedOptions, function (o) { return o.value; });
    else if (f === 'span' || f === 'points') w[f] = Number(e.target.value);
    else w[f] = e.target.value;
    if (f === 'grain') renderList();
  }
  function onListClick(e) {
    var b = e.target.closest('button[data-act]'); if (!b) return;
    var i = Number(b.closest('.dc-item').getAttribute('data-i')), a = b.getAttribute('data-act');
    if (a === 'del') model.widgets.splice(i, 1);
    if (a === 'up' && i > 0) model.widgets.splice(i - 1, 0, model.widgets.splice(i, 1)[0]);
    if (a === 'down' && i < model.widgets.length - 1) model.widgets.splice(i + 1, 0, model.widgets.splice(i, 1)[0]);
    renderList();
  }
  function addWidget(type) {
    var spec = cat.widgets.find(function (x) { return x.type === type; });
    var w = { id: 'w' + Date.now().toString(36), type: type, span: spec.span, title: { fr: spec.label.fr, en: spec.label.en } };
    if (spec.metrics[1] > 0) w.metrics = [cat.metrics[0].key];
    if (type === 'trend') { w.grain = 'week'; w.points = 13; }
    if (type === 'events') w.source = 'incidents';
    if (type === 'text') w.markdown = '';
    model.widgets.push(w); renderList();
    status('« ' + spec.label.fr + ' » ajouté au brouillon (pensez à enregistrer).');
  }

  // ── Save / preview / publish ──────────────────────────────────────────
  function current() { readProps(); return model; }
  function save() {
    return api('PUT', '/api/dashboards/' + encodeURIComponent(cur.id) + '/draft', { definition: current() })
      .then(function (j) { status('Brouillon enregistré.'); cur.draft = j.draft; return j; })
      .catch(function (e) { status('Brouillon non enregistré : ' + e.message, true); throw e; });
  }
  function preview() {
    var site = $('dc-as').value;
    api('POST', '/api/dashboards/preview', { definition: current(), as: site ? { site: site } : {} }).then(function (p) {
      var out = $('dc-preview-out');
      out.innerHTML = '<div class="db-banner">Aperçu du brouillon — ' + (p.context.scope === 'site' ? 'périmètre : ' + esc(p.context.site.name) : 'ensemble du groupe') + '. Rien n’est publié.</div>' + R.render(p.definition, p, { lang: 'fr' });
      out.hidden = false; out.scrollIntoView({ behavior: 'smooth', block: 'start' });
      status('Aperçu calculé.');
    }).catch(function (e) { status('Aperçu impossible : ' + e.message, true); });
  }
  function askPublish() {
    var next = (cur.versions && cur.versions.length ? cur.versions[0].version : 0) + 1;
    $('dc-confirm-text').textContent = 'Publier « ' + (model.title.fr || cur.id) + ' » en version ' + next + ' pour : ' + (model.audience.roles.join(', ') || '—') +
      (model.audience.site_scope === 'own' ? ' (chacun voit son site)' : '') + ' ? La version en ligne reste disponible pour un retour arrière.';
    $('dc-confirm').hidden = false; $('dc-confirm-yes').focus();
  }
  function publish() {
    save().then(function () {
      return api('POST', '/api/dashboards/' + encodeURIComponent(cur.id) + '/publish', { note: $('dc-note').value });
    }).then(function (j) { $('dc-confirm').hidden = true; return loadList(cur.id).then(function () { status('Version ' + j.version + ' publiée.'); }); })
      .catch(function (e) { status('Publication refusée : ' + e.message, true); });
  }
  function renderVersions() {
    var vs = cur.versions || [], on = cur.published && cur.published.version;
    $('dc-versions').innerHTML = vs.map(function (v) {
      return '<li><span><b>v' + v.version + '</b>' + (v.version === on ? ' (en ligne)' : '') + ' · ' + esc((v.published_at || '').slice(0, 10)) + ' · ' + esc(v.published_by || '') +
        (v.note ? ' · ' + esc(v.note) : '') + '</span>' + (v.version !== on && cur.can_publish ? '<button class="db-btn" type="button" data-v="' + v.version + '">Revenir</button>' : '') + '</li>';
    }).join('') || '<li class="db-note">Jamais publié.</li>';
  }

  // ── Wiring ────────────────────────────────────────────────────────────
  $('dc-pick').addEventListener('change', function (e) { open(e.target.value); });
  $('dc-new').addEventListener('click', function () { $('dc-new-form').hidden = false; $('dc-new-id').focus(); });
  $('dc-new-cancel').addEventListener('click', function () { $('dc-new-form').hidden = true; });
  $('dc-new-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var id = $('dc-new-id').value.trim().toLowerCase(), title = $('dc-new-title').value.trim();
    api('POST', '/api/dashboards', { definition: { id: id, title: { fr: title, en: title }, audience: { roles: ['any'], site_scope: 'own' },
      widgets: [{ type: 'kpi', metrics: ['helpdesk.sla_res_pct'], title: { fr: 'Indicateurs', en: 'Indicators' } }] } })
      .then(function () { $('dc-new-form').hidden = true; status('Brouillon « ' + title + ' » créé.'); return loadList(id); })
      .catch(function (err) { status('Création refusée : ' + err.message, true); });
  });
  $('dc-catalog').addEventListener('click', function (e) { var b = e.target.closest('button[data-type]'); if (b) addWidget(b.getAttribute('data-type')); });
  $('dc-list').addEventListener('input', onListInput);
  $('dc-list').addEventListener('change', onListInput);
  $('dc-list').addEventListener('click', onListClick);
  $('dc-save').addEventListener('click', function () { save().catch(function () {}); });
  $('dc-preview').addEventListener('click', preview);
  $('dc-publish').addEventListener('click', askPublish);
  $('dc-confirm-no').addEventListener('click', function () { $('dc-confirm').hidden = true; });
  $('dc-confirm-yes').addEventListener('click', publish);
  $('dc-versions').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-v]'); if (!b) return;
    api('POST', '/api/dashboards/' + encodeURIComponent(cur.id) + '/rollback', { version: Number(b.getAttribute('data-v')) })
      .then(function (j) { return loadList(cur.id).then(function () { status('Version ' + j.rollback_to + ' republiée en version ' + j.version + '.'); }); })
      .catch(function (err) { status(err.message, true); });
  });
  $('dc-retire').addEventListener('click', function () {
    api('POST', '/api/dashboards/' + encodeURIComponent(cur.id) + '/retire').then(function () { return loadList(cur.id).then(function () { status('Tableau retiré de l’affichage. Une nouvelle publication le remet en ligne.'); }); })
      .catch(function (err) { status(err.message, true); });
  });

  api('GET', '/api/dashboards/catalog').then(function (c) {
    cat = c;
    $('dc-catalog').innerHTML = c.widgets.map(function (w) { return '<button type="button" data-type="' + esc(w.type) + '">' + esc(w.label.fr) + '</button>'; }).join('');
    $('dc-as').innerHTML = (c.group_allowed ? '<option value="">Ensemble du groupe</option>' : '') + (c.preview_sites || []).map(function (x) {
      return '<option value="' + esc(x.code) + '">' + esc(x.name) + '</option>'; }).join('');
    var want = new URLSearchParams(location.search).get('id');
    return loadList(want || '');
  }).catch(function (e) { status('Le composeur n’a pas pu se charger : ' + e.message, true); });
})();
