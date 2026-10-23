/* Step 7 — the tracker builder. No inline script (strict CSP). Edits a definition in memory; every change is
 * validated by the server (POST /api/trackers/preview) which answers with blocking errors, warnings and a dry-run
 * score from the common engine. Save = draft; publish = next version (publisher); rollback, retire. */
(function () {
  'use strict';
  var esc = window.DashboardRender.esc;
  var $ = function (id) { return document.getElementById(id); };
  var tok = function () { return window.__authToken || ''; };
  var cat = null, list = [], cur = null, model = null, timer = null, lastCheck = null, superAdmin = false;
  var KPI_FR = { COUNT: 'Nombre (cumul vs cible annuelle)', PERCENT: 'Pourcentage (moyenne)', BOOLEAN: 'Fait / pas fait', MILESTONE: 'Jalons (étape / cible)', CURRENCY: 'Montant (cumul vs cible)', RATING: 'Note (moyenne des mois notés)' };

  function api(method, path, body) {
    return fetch(path, { method: method, headers: { 'Content-Type': 'application/json', 'x-report-token': tok() }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error((j.error || ('HTTP ' + r.status)) + (j.details ? ' — ' + j.details.join(' ; ') : '')); e.status = r.status; throw e; }
          return j;
        });
      });
  }
  function status(msg, isErr) { var s = $('tb-status'); s.textContent = msg || ''; s.className = isErr ? 'db-error' : 'db-note'; }
  var label = function (t) { return t && typeof t === 'object' ? (t.fr || t.en || '') : String(t || ''); };
  var opt = function (v, text, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(text) + '</option>'; };

  // ── Load ─────────────────────────────────────────────────────────────
  function loadList(selectId) {
    return api('GET', '/api/trackers').then(function (j) {
      list = j.trackers.filter(function (t) { return t.editable; });
      superAdmin = !!j.super_admin;
      $('tb-pick').innerHTML = '<option value="">— choisir —</option>' + list.map(function (t) {
        return opt(t.id, label(t.title) + ' · ' + t.year + (t.kind === 'migrated' ? ' (migré)' : '') + (t.published_version ? ' · v' + t.published_version : ' · brouillon') + (t.retired ? ' · retiré' : ''));
      }).join('');
      if (selectId) { $('tb-pick').value = selectId; return open(selectId); }
    });
  }
  function open(id) {
    if (!id) { $('tb-editor').hidden = true; return Promise.resolve(); }
    return api('GET', '/api/trackers/' + encodeURIComponent(id)).then(function (j) {
      cur = j;
      model = JSON.parse(JSON.stringify(j.draft || (j.published && j.published.definition) || {}));
      ['units', 'groups', 'items'].forEach(function (k) { model[k] = model[k] || []; });
      model.targets = model.targets || {};
      $('tb-editor').hidden = false;
      $('tb-open').href = 'trackers.html#' + encodeURIComponent(id);
      fillProps(); renderUnits(); renderGroups(); renderItems(); renderTargets(); renderVersions(); check();
      $('tb-publish').disabled = !j.can_publish; $('tb-retire').disabled = !j.can_publish || !j.published;
      $('tb-delete').disabled = !!j.published || j.kind !== 'custom';
      status(j.draft_at ? 'Brouillon enregistré le ' + j.draft_at.slice(0, 16).replace('T', ' ') + ' par ' + (j.draft_by || '—') + '.' : '');
    }).catch(function (e) { status(e.message, true); });
  }

  // ── Properties ───────────────────────────────────────────────────────
  function checks(id, roles, selected) {
    $(id).innerHTML = roles.map(function (r, i) {
      return '<label for="' + id + '-' + i + '"><input type="checkbox" id="' + id + '-' + i + '" value="' + esc(r) + '"' + (selected.indexOf(r) >= 0 ? ' checked' : '') + '> ' + esc(r) + '</label>';
    }).join('');
  }
  function fillProps() {
    $('tb-title-fr').value = (model.title && model.title.fr) || label(model.title);
    $('tb-title-en').value = (model.title && model.title.en) || '';
    $('tb-desc').value = model.description || '';
    $('tb-year').value = model.year || '';
    checks('tb-aud', cat.audience_roles, (model.audience && model.audience.roles) || ['any']);
    checks('tb-entry', cat.audience_roles.filter(function (r) { return r !== 'any'; }), (model.entry && model.entry.roles) || ['editor']);
    $((model.audience && model.audience.site_scope) === 'own' ? 'tb-scope-own' : 'tb-scope-all').checked = true;
    $('tb-own').checked = !model.entry || model.entry.own_unit_only !== false;
    $('tb-mirror-l').hidden = cur.kind !== 'migrated';
    $('tb-mirror').checked = !!model.legacy_mirror;
  }
  function picked(id) { return Array.prototype.slice.call($(id).querySelectorAll('input:checked')).map(function (x) { return x.value; }); }
  function readProps() {
    model.title = { fr: $('tb-title-fr').value.trim(), en: $('tb-title-en').value.trim() || undefined };
    model.description = $('tb-desc').value.trim();
    model.year = Number($('tb-year').value);
    model.audience = { roles: picked('tb-aud'), site_scope: $('tb-scope-own').checked ? 'own' : 'all' };
    model.entry = { roles: picked('tb-entry'), own_unit_only: $('tb-own').checked };
    if (cur.kind === 'migrated') model.legacy_mirror = $('tb-mirror').checked;
  }

  // ── Tables ───────────────────────────────────────────────────────────
  function inp(kind, i, field, value, extra) {
    var id = 'tb-' + kind + '-' + i + '-' + field;
    return '<label class="db-sr" for="' + id + '">' + field + '</label><input id="' + id + '" data-kind="' + kind + '" data-i="' + i + '" data-f="' + field + '" value="' + esc(value == null ? '' : String(value)) + '"' + (extra || '') + '>';
  }
  function del(kind, i) { return '<button type="button" class="db-btn db-danger" data-del="' + kind + '" data-i="' + i + '" aria-label="Supprimer">×</button>'; }
  function renderUnits() {
    var sites = cat.sites || [];
    $('tb-units').innerHTML = '<thead><tr><th scope="col">Code</th><th scope="col">Nom</th><th scope="col">Site rattaché</th><th scope="col">Active</th><th scope="col"></th></tr></thead><tbody>' +
      model.units.map(function (u, i) {
        return '<tr><td>' + inp('units', i, 'code', u.code, ' maxlength="20"') + '</td><td>' + inp('units', i, 'name', u.name) + '</td><td><label class="db-sr" for="tb-units-' + i + '-site">site</label><select id="tb-units-' + i + '-site" data-kind="units" data-i="' + i + '" data-f="site_id">' +
          opt('', '— aucun —', !u.site_id) + sites.map(function (s) { return opt(s.site_id, s.name + (s.code ? ' (' + s.code + ')' : ''), Number(u.site_id) === s.site_id); }).join('') + '</select></td>' +
          '<td><label class="db-sr" for="tb-units-' + i + '-active">active</label><input type="checkbox" id="tb-units-' + i + '-active" data-kind="units" data-i="' + i + '" data-f="active"' + (u.active !== false ? ' checked' : '') + '></td><td>' + del('units', i) + '</td></tr>';
      }).join('') + '</tbody>';
  }
  function renderGroups() {
    $('tb-groups').innerHTML = '<thead><tr><th scope="col">Code</th><th scope="col">Nom</th><th scope="col">Poids (%)</th><th scope="col"></th></tr></thead><tbody>' +
      model.groups.map(function (g, i) {
        return '<tr><td>' + inp('groups', i, 'code', g.code) + '</td><td>' + inp('groups', i, 'name', g.name) + '</td><td class="tb-num">' + inp('groups', i, 'weight', Math.round((Number(g.weight) || 0) * 1000) / 10, ' inputmode="decimal"') + '</td><td>' + del('groups', i) + '</td></tr>';
      }).join('') + '</tbody>';
  }
  function renderItems() {
    var metrics = cat.metrics || [];
    $('tb-items').innerHTML = '<thead><tr><th scope="col">Code</th><th scope="col">Nom</th><th scope="col">Groupe</th><th scope="col">Type</th><th scope="col">Poids</th><th scope="col">Début</th><th scope="col">Fin</th><th scope="col">Commun</th><th scope="col">Lié à un indicateur</th><th scope="col"></th></tr></thead><tbody>' +
      model.items.map(function (it, i) {
        var sel = function (f, opts) { return '<label class="db-sr" for="tb-items-' + i + '-' + f + '">' + f + '</label><select id="tb-items-' + i + '-' + f + '" data-kind="items" data-i="' + i + '" data-f="' + f + '">' + opts + '</select>'; };
        return '<tr><td>' + inp('items', i, 'code', it.code) + '</td><td>' + inp('items', i, 'name', label(it.name)) + '</td>' +
          '<td>' + sel('group', model.groups.map(function (g) { return opt(g.code, g.name || g.code, g.code === it.group); }).join('')) + '</td>' +
          '<td>' + sel('kpi', cat.kpi_types.map(function (k) { return opt(k, KPI_FR[k] || k, k === it.kpi); }).join('')) + '</td>' +
          '<td class="tb-num">' + inp('items', i, 'weight', it.weight, ' inputmode="decimal"') + '</td>' +
          '<td class="tb-num">' + inp('items', i, 'start', it.start, ' inputmode="numeric"') + '</td><td class="tb-num">' + inp('items', i, 'end', it.end, ' inputmode="numeric"') + '</td>' +
          '<td><label class="db-sr" for="tb-items-' + i + '-shared">commun</label><input type="checkbox" id="tb-items-' + i + '-shared" data-kind="items" data-i="' + i + '" data-f="shared"' + (it.shared ? ' checked' : '') + '></td>' +
          '<td>' + sel('source', opt('', '— saisi —', !it.source) + metrics.map(function (m) { return opt(m.key, m.fr || m.key, it.source && it.source.metric === m.key); }).join('')) + '</td><td>' + del('items', i) + '</td></tr>';
      }).join('') + '</tbody>';
  }
  function renderTargets() {
    var u = $('tb-tunit').value;
    $('tb-tunit').innerHTML = model.units.map(function (x) { return opt(x.code, x.name || x.code, x.code === u); }).join('');
    u = $('tb-tunit').value;
    var t = model.targets[u] || {};
    $('tb-targets').innerHTML = '<thead><tr><th scope="col">Élément</th><th scope="col">Cible</th><th scope="col">Actif pour cette unité</th></tr></thead><tbody>' +
      model.items.map(function (it, i) {
        var x = t[it.code] || {};
        return '<tr><th scope="row">' + esc(label(it.name) || it.code) + '</th><td>' + inp('targets', i, 'target', x.target, ' maxlength="30"') + '</td>' +
          '<td><label class="db-sr" for="tb-targets-' + i + '-active">actif</label><input type="checkbox" id="tb-targets-' + i + '-active" data-kind="targets" data-i="' + i + '" data-f="active"' + (x.active ? ' checked' : '') + '></td></tr>';
      }).join('') + '</tbody>';
  }

  function onEdit(e) {
    var el = e.target, kind = el.getAttribute && el.getAttribute('data-kind'); if (!kind) return;
    var i = Number(el.getAttribute('data-i')), f = el.getAttribute('data-f');
    var v = el.type === 'checkbox' ? el.checked : el.value;
    if (kind === 'targets') {
      var u = $('tb-tunit').value, code = model.items[i].code;
      var t = model.targets[u] || (model.targets[u] = {});
      var x = t[code] || (t[code] = { target: '', active: false });
      x[f] = f === 'active' ? !!v : String(v);
    } else {
      var row = model[kind][i];
      if (f === 'weight' && kind === 'groups') row.weight = (Number(String(v).replace(',', '.')) || 0) / 100;
      else if (['weight', 'start', 'end'].indexOf(f) >= 0) row[f] = Number(String(v).replace(',', '.'));
      else if (f === 'site_id') { if (v) row.site_id = Number(v); else delete row.site_id; }
      else if (f === 'source') { if (v) row.source = { metric: v }; else delete row.source; }
      else if (f === 'code' && kind !== 'units') renameCode(kind, row, String(v).trim());
      else if (f === 'code') renameUnit(row, String(v).trim());
      else row[f] = v;
      if (kind === 'groups' || (kind === 'items' && f === 'code')) { renderItems(); renderTargets(); }
      if (kind === 'units') renderTargets();
    }
    schedule();
  }
  function renameCode(kind, row, code) {
    var old = row.code; row.code = code;
    if (kind === 'groups') model.items.forEach(function (it) { if (it.group === old) it.group = code; });
    if (kind === 'items') Object.keys(model.targets).forEach(function (u) { if (model.targets[u][old]) { model.targets[u][code] = model.targets[u][old]; delete model.targets[u][old]; } });
  }
  function renameUnit(row, code) {
    if (model.targets[row.code]) { model.targets[code] = model.targets[row.code]; delete model.targets[row.code]; }
    row.code = code;
  }
  ['tb-units', 'tb-groups', 'tb-items', 'tb-targets'].forEach(function (id) { $(id).addEventListener('change', onEdit); });
  ['tb-title-fr', 'tb-title-en', 'tb-desc', 'tb-year', 'tb-aud', 'tb-entry', 'tb-own', 'tb-scope-all', 'tb-scope-own', 'tb-mirror'].forEach(function (id) { $(id).addEventListener('change', function () { readProps(); schedule(); }); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-del]'); if (!b || !model) return;
    var kind = b.getAttribute('data-del'), i = Number(b.getAttribute('data-i')), gone = model[kind][i];
    model[kind].splice(i, 1);
    if (kind === 'units' && gone) delete model.targets[gone.code];
    if (kind === 'items' && gone) Object.keys(model.targets).forEach(function (u) { delete model.targets[u][gone.code]; });
    renderUnits(); renderGroups(); renderItems(); renderTargets(); schedule();
  });
  $('tb-unit-add').addEventListener('click', function () { model.units.push({ code: 'U' + (model.units.length + 1), name: 'Nouvelle unité', active: true }); renderUnits(); renderTargets(); schedule(); });
  $('tb-group-add').addEventListener('click', function () { model.groups.push({ code: 'G' + (model.groups.length + 1), name: 'Nouveau groupe', weight: 0 }); renderGroups(); renderItems(); schedule(); });
  $('tb-item-add').addEventListener('click', function () {
    var g = model.groups[0];
    model.items.push({ code: 'E' + (model.items.length + 1), name: 'Nouvel élément', group: g ? g.code : '', kpi: 'COUNT', weight: 1, start: 1, end: 12, shared: false });
    renderItems(); renderTargets(); schedule();
  });
  $('tb-tunit').addEventListener('change', renderTargets);
  $('tb-tcopy').addEventListener('click', function () {
    var from = $('tb-tunit').value, src = model.targets[from] || {};
    model.units.forEach(function (u) { if (u.code !== from) model.targets[u.code] = JSON.parse(JSON.stringify(src)); });
    status('Cibles de ' + from + ' copiées sur ' + (model.units.length - 1) + ' unité(s).'); schedule();
  });

  // ── Live check (server) ──────────────────────────────────────────────
  function schedule() { clearTimeout(timer); timer = setTimeout(check, 500); }
  function check() {
    readProps();
    api('POST', '/api/trackers/preview', { definition: model }).then(function (j) {
      lastCheck = j;
      var lines = (j.errors || []).map(function (x) { return '<div class="tb-err">Bloquant — ' + esc(x) + '</div>'; })
        .concat((j.warnings || []).map(function (x) { return '<div class="tb-warn">À vérifier — ' + esc(x) + '</div>'; }));
      $('tb-issues').innerHTML = lines.length ? lines.join('') : '<div class="tb-ok">Définition valide.</div>';
      if (!j.ok) { $('tb-dry').innerHTML = ''; return; }
      $('tb-dry').innerHTML = '<p class="db-note">Score à blanc (saisies actuelles, cumul à fin de décembre) : ensemble <b>' + Math.round(j.fleet.avg * 100) + ' %</b>.</p>' +
        '<div class="db-scroll"><table class="db-table"><thead><tr><th scope="col">Unité</th><th scope="col">Score</th><th scope="col">V / O / R</th></tr></thead><tbody>' +
        j.units.map(function (u) { return '<tr><th scope="row">' + esc(u.unit) + '</th><td>' + Math.round(u.avg * 100) + ' %</td><td>' + u.g + ' / ' + u.a + ' / ' + u.r + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }).catch(function (e) { $('tb-issues').innerHTML = '<div class="tb-err">' + esc(e.message) + '</div>'; });
  }

  // ── Draft, publish, versions ─────────────────────────────────────────
  $('tb-save').addEventListener('click', function () {
    readProps();
    api('PUT', '/api/trackers/' + encodeURIComponent(cur.id) + '/draft', { definition: model }).then(function () {
      var id = cur.id; return loadList(id).then(function () { status('Brouillon enregistré.'); });
    }).catch(function (e) { status(e.message, true); });
  });
  $('tb-publish').addEventListener('click', function () {
    if (lastCheck && !lastCheck.ok) { status('Corrigez les points bloquants avant de publier.', true); return; }
    $('tb-confirm-text').textContent = 'Publier « ' + label(model.title) + ' » comme nouvelle version ? Le brouillon est enregistré puis publié ; les personnes qui saisissent verront aussitôt cette structure.';
    $('tb-confirm').hidden = false;
  });
  $('tb-confirm-no').addEventListener('click', function () { $('tb-confirm').hidden = true; });
  $('tb-confirm-yes').addEventListener('click', function () {
    readProps();
    var id0 = encodeURIComponent(cur.id);
    api('PUT', '/api/trackers/' + id0 + '/draft', { definition: model }).then(function () {
      return api('POST', '/api/trackers/' + id0 + '/publish', { note: $('tb-note').value });
    }).then(function (j) {
      $('tb-confirm').hidden = true; $('tb-note').value = '';
      var id = cur.id; return loadList(id).then(function () { status('Version ' + j.version + ' publiée.'); });
    }).catch(function (e) { status(e.message, true); });
  });
  function renderVersions() {
    var v = cur.versions || [];
    $('tb-versions').innerHTML = v.length ? v.map(function (x) {
      return '<li><span>v' + x.version + ' · ' + esc((x.published_at || '').slice(0, 16).replace('T', ' ')) + ' · ' + esc(x.published_by || '—') + (x.note ? ' — ' + esc(x.note) : '') + '</span>' +
        (cur.can_publish && cur.published && x.version !== cur.published.version ? ' <button class="db-btn" type="button" data-rollback="' + x.version + '">Revenir à cette version</button>' : '') + '</li>';
    }).join('') : '<li>Jamais publié.</li>';
  }
  $('tb-versions').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-rollback]'); if (!b) return;
    api('POST', '/api/trackers/' + encodeURIComponent(cur.id) + '/rollback', { version: Number(b.getAttribute('data-rollback')) }).then(function (j) {
      var id = cur.id; return loadList(id).then(function () { status('Version ' + j.rollback_to + ' republiée comme version ' + j.version + '.'); });
    }).catch(function (e2) { status(e2.message, true); });
  });
  $('tb-retire').addEventListener('click', function () {
    api('POST', '/api/trackers/' + encodeURIComponent(cur.id) + '/retire', {}).then(function () {
      var id = cur.id; return loadList(id).then(function () { status('Tracker retiré de l’affichage (ses saisies et son historique restent).'); });
    }).catch(function (e) { status(e.message, true); });
  });
  $('tb-delete').addEventListener('click', function () {
    api('DELETE', '/api/trackers/' + encodeURIComponent(cur.id)).then(function () { $('tb-editor').hidden = true; return loadList().then(function () { status('Brouillon supprimé.'); }); })
      .catch(function (e) { status(e.message, true); });
  });

  // ── New ──────────────────────────────────────────────────────────────
  $('tb-new').addEventListener('click', function () {
    $('tb-new-form').hidden = false; $('tb-new-year').value = new Date().getFullYear();
    $('tb-legacy').hidden = !superAdmin; $('tb-new-id').focus();
  });
  $('tb-new-cancel').addEventListener('click', function () { $('tb-new-form').hidden = true; });
  $('tb-new-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var id = $('tb-new-id').value.trim(), year = Number($('tb-new-year').value), tpl = $('tb-new-template').value;
    var body = tpl ? { template: tpl, id: id, year: year } : { definition: { id: id, year: year, title: { fr: id }, units: (cat.sites || []).filter(function (s) { return s.code; }).map(function (s) { return { code: s.code, name: s.name, site_id: s.site_id, active: true }; }),
      groups: [{ code: 'G1', name: 'Groupe 1', weight: 1 }], items: [{ code: 'E1', name: 'Premier élément', group: 'G1', kpi: 'COUNT', weight: 1, start: 1, end: 12 }], targets: {} } };
    api('POST', '/api/trackers', body).then(function (j) { $('tb-new-form').hidden = true; return loadList(j.id).then(function () { status('Brouillon créé. Ajustez la structure, puis publiez.'); }); })
      .catch(function (e2) { status(e2.message, true); });
  });
  $('tb-legacy-go').addEventListener('click', function () {
    var year = Number($('tb-new-year').value);
    status('Migration en cours…');
    api('POST', '/api/trackers/legacy/import', { year: year }).then(function (j) {
      $('tb-new-form').hidden = true;
      var c = j.comparison;
      return loadList(j.id).then(function () {
        status('Tracker ' + j.id + ' : version ' + j.version + ', ' + j.cells + ' saisies recopiées. Comparaison des moteurs : ' + (c.accepted ? 'identiques' : 'ÉCARTS') + ' (écart maximal ' + c.max_gap_points + ' point, ' + c.colour_mismatches + ' couleur(s) différente(s), ' + c.checks + ' contrôles).', !c.accepted);
      });
    }).catch(function (e) { status(e.message, true); });
  });

  $('tb-pick').addEventListener('change', function () { open(this.value); });
  api('GET', '/api/trackers/templates').then(function (j) {
    cat = j;
    $('tb-new-template').innerHTML = opt('', 'Tracker vide') + j.templates.map(function (t) { return opt(t.key, 'Modèle : ' + label(t.title) + ' (' + t.items + ' éléments)'); }).join('');
    return loadList();
  }).catch(function (e) { status(e.message, true); });
})();
