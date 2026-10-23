/* Step 7 — the business trackers screen: list, monthly entry per unit, live scores (public/lib/trackerEngine.js,
 * the same engine as the server's Excel and slides), month locks, Excel import / export. No inline script (strict
 * CSP). The server re-checks every right: unit, lock, linked item, parallel run. */
(function () {
  'use strict';
  var E = window.TrackerEngine, esc = window.DashboardRender.esc;
  var $ = function (id) { return document.getElementById(id); };
  var tok = function () { return window.__authToken || ''; };
  var MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var RAG = { GREEN: ['db-green', 'Dans l’objectif'], AMBER: ['db-amber', 'À surveiller'], RED: ['db-red', 'Hors objectif'] };
  var cur = null, def = null, values = {}, dirty = {}, locks = [], writable = [], canPublish = false;

  function api(method, path, body) {
    return fetch(path, { method: method, headers: { 'Content-Type': 'application/json', 'x-report-token': tok() }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error((j.error || ('HTTP ' + r.status)) + (j.details ? ' — ' + j.details.join(' ; ') : '')); e.status = r.status; e.body = j; throw e; }
          return j;
        });
      });
  }
  function status(msg, isErr) { var s = $('tk-status'); s.textContent = msg || ''; s.className = isErr ? 'db-error' : 'db-note'; }
  var label = function (t) { return t && typeof t === 'object' ? (t.fr || t.en || '') : String(t || ''); };
  var pct = function (x) { return x == null ? '—' : Math.round(x * 100) + ' %'; };
  function pill(rg) { var r = RAG[rg]; return r ? '<span class="db-pill ' + r[0] + '">' + r[1] + '</span>' : '<span class="db-pill db-none">Non mesuré</span>'; }

  // ── List ─────────────────────────────────────────────────────────────
  function loadList() {
    return api('GET', '/api/trackers').then(function (j) {
      var vis = j.trackers.filter(function (t) { return t.visible; });
      $('tk-builder').hidden = !j.author;
      canPublish = !!j.can_publish;
      $('tk-pick').innerHTML = '<option value="">— choisir —</option>' + vis.map(function (t) {
        return '<option value="' + esc(t.id) + '">' + esc(label(t.title)) + ' · ' + esc(t.year) + (t.parallel_run ? ' · en parallèle' : '') + '</option>';
      }).join('');
      var want = (location.hash || '').slice(1);
      if (!vis.length) status(j.author ? 'Aucun tracker publié. Construisez-en un depuis le builder.' : 'Aucun tracker publié pour votre rôle.');
      else if (want && vis.some(function (t) { return t.id === want; })) { $('tk-pick').value = want; open(want); }
    }).catch(function (e) { status(e.message, true); });
  }

  function open(id) {
    if (!id) { $('tk-view').hidden = true; return Promise.resolve(); }
    return api('GET', '/api/trackers/' + encodeURIComponent(id)).then(function (j) {
      if (!j.published) { status('Ce tracker n’est pas encore publié.', true); $('tk-view').hidden = true; return; }
      cur = j; def = j.published.definition; values = j.values || {}; locks = (j.locks || []).map(function (l) { return l.month; });
      writable = j.writable_units || []; dirty = {};
      try { history.replaceState(null, '', '#' + id); } catch (_) {}
      $('tk-title').textContent = label(def.title) + ' — ' + j.year;
      $('tk-desc').textContent = def.description || '';
      $('tk-parallel').hidden = !def.legacy_mirror;
      var now = new Date(), mNow = j.year === now.getFullYear() ? now.getMonth() + 1 : 12;
      $('tk-month').innerHTML = MONTHS.map(function (m, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === mNow ? ' selected' : '') + '>' + m + ' ' + j.year + '</option>'; }).join('');
      var units = def.units.filter(function (u) { return u.active !== false; });
      $('tk-unit').innerHTML = units.map(function (u) { return '<option value="' + esc(u.code) + '">' + esc(u.name || u.code) + (writable.indexOf(u.code) >= 0 ? ' · saisie' : '') + '</option>'; }).join('');
      var mine = units.find(function (u) { return writable.indexOf(u.code) >= 0; });
      if (mine) $('tk-unit').value = mine.code;
      $('tk-locks-w').hidden = !j.can_publish && !canPublish;
      $('tk-view').hidden = false; status('');
      renderSummary(); renderGrid(); renderLocks();
    }).catch(function (e) { status(e.message, true); $('tk-view').hidden = true; });
  }

  // ── Summary (engine) ─────────────────────────────────────────────────
  function renderSummary() {
    var mo = Number($('tk-month').value) || 12;
    var units = E.activeUnits(def), f = E.fleet(def, values, mo);
    var head = '<tr><th scope="col">Unité</th><th scope="col">Global</th>' + def.groups.map(function (g) { return '<th scope="col">' + esc(g.name) + ' <small>(' + Math.round(g.weight * 100) + ' %)</small></th>'; }).join('') + '<th scope="col">Vert / orange / rouge</th></tr>';
    var rows = units.map(function (u) {
      var s = E.unitSummary(def, values, u, mo);
      return '<tr><th scope="row">' + esc(u) + '</th><td><b>' + pct(s.avg) + '</b></td>' + def.groups.map(function (g) { return '<td>' + pct(s.groups[g.code]) + '</td>'; }).join('') + '<td>' + s.g + ' / ' + s.a + ' / ' + s.r + '</td></tr>';
    }).join('');
    $('tk-summary').innerHTML = '<p class="db-note">Ensemble : <b>' + pct(f.avg) + '</b> · éléments dans l’objectif : ' + pct(f.attainment) + (f.best ? ' · meilleure unité : ' + esc(f.best) + ' · plus faible : ' + esc(f.worst) : '') + '</p>' +
      '<div class="db-scroll"><table class="db-table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>';
  }

  // ── Entry grid ───────────────────────────────────────────────────────
  function cellValue(unit, item, m) {
    var k = unit + '|' + item + '|' + m;
    if (k in dirty) return dirty[k];
    var r = values[unit] && values[unit][item];
    return r ? r[m - 1] || 0 : 0;
  }
  function renderGrid() {
    var unit = $('tk-unit').value, mo = Number($('tk-month').value) || 12;
    var canType = writable.indexOf(unit) >= 0;
    var view = JSON.parse(JSON.stringify(values));
    Object.keys(dirty).forEach(function (k) { var p = k.split('|'); var u = view[p[0]] || (view[p[0]] = {}); var r = u[p[1]] || (u[p[1]] = [0,0,0,0,0,0,0,0,0,0,0,0]); r[Number(p[2]) - 1] = dirty[k]; });
    var sc = E.score(def, view, unit, mo);
    $('tk-rights').textContent = def.legacy_mirror ? 'Lecture seule (fonctionnement en parallèle).' : canType ? 'Vous pouvez saisir pour cette unité.' : 'Lecture seule pour cette unité.';
    var head = '<thead><tr><th scope="col">Élément</th><th scope="col">Type</th>' + MONTHS.map(function (m, i) { return '<th scope="col" class="' + (locks.indexOf(i + 1) >= 0 ? 'tk-locked' : '') + '">' + m + (locks.indexOf(i + 1) >= 0 ? '<small class="tk-lock-tag">clos</small>' : '') + '</th>'; }).join('') + '<th scope="col">Cumul / cible</th><th scope="col">Score</th></tr></thead>';
    var groupOf = {}; def.groups.forEach(function (g) { groupOf[g.code] = g.name; });
    var lastGroup = null, body = '';
    def.items.forEach(function (it, i) {
      var s = sc[i], t = def.targets[unit] && def.targets[unit][it.code];
      if (it.group !== lastGroup) { lastGroup = it.group; body += '<tr class="tk-group"><th scope="rowgroup" colspan="16">' + esc(groupOf[it.group] || it.group) + '</th></tr>'; }
      var inactive = !t || !t.active;
      body += '<tr class="' + (inactive ? 'tk-off' : '') + '"><th scope="row">' + esc(label(it.name)) + (it.source ? ' <small class="tk-linked">calculé : ' + esc(it.source.metric) + '</small>' : '') + (it.shared ? ' <small>(commun)</small>' : '') + '</th><td><small>' + esc(it.kpi) + '</small></td>';
      for (var m = 1; m <= 12; m++) {
        var v = cellValue(unit, it.code, m), out = m < it.start || m > it.end;
        var ro = !canType || inactive || out || !!it.source || locks.indexOf(m) >= 0;
        var id = 'c-' + i + '-' + m;
        body += '<td class="' + (out ? 'tk-out' : '') + '">' + (ro ? '<span class="tk-ro">' + (v ? esc(String(v)) : '·') + '</span>'
          : '<label class="db-sr" for="' + id + '">' + esc(label(it.name)) + ', ' + MONTHS[m - 1] + '</label><input id="' + id + '" class="tk-in" inputmode="decimal" data-item="' + esc(it.code) + '" data-month="' + m + '" value="' + (v ? esc(String(v)) : '') + '">') + '</td>';
      }
      body += '<td>' + (s.on ? esc(String(s.ya)) + ' / ' + esc(String(s.yt)) : '—') + '</td><td>' + (s.on ? (typeof s.sc === 'number' ? pct(s.sc) + ' ' : '') + pill(s.rg) : '<small>inactif</small>') + '</td></tr>';
    });
    $('tk-grid').innerHTML = head + '<tbody>' + body + '</tbody>';
    $('tk-save').disabled = !Object.keys(dirty).length;
  }
  $('tk-grid').addEventListener('change', function (e) {
    var el = e.target; if (!el.classList || !el.classList.contains('tk-in')) return;
    var raw = String(el.value).trim().replace(',', '.'), v = raw === '' ? 0 : Number(raw);
    if (!isFinite(v)) { el.setAttribute('aria-invalid', 'true'); status('« ' + el.value + ' » n’est pas un nombre.', true); return; }
    el.removeAttribute('aria-invalid');
    dirty[$('tk-unit').value + '|' + el.getAttribute('data-item') + '|' + el.getAttribute('data-month')] = v;
    status(Object.keys(dirty).length + ' saisie(s) non enregistrée(s).');
    renderSummaryWithDirty(); renderGrid();
  });
  function renderSummaryWithDirty() {
    var keep = values; values = JSON.parse(JSON.stringify(values));
    Object.keys(dirty).forEach(function (k) { var p = k.split('|'); var u = values[p[0]] || (values[p[0]] = {}); var r = u[p[1]] || (u[p[1]] = [0,0,0,0,0,0,0,0,0,0,0,0]); r[Number(p[2]) - 1] = dirty[k]; });
    renderSummary(); values = keep;
  }
  $('tk-save').addEventListener('click', function () {
    var cells = Object.keys(dirty).map(function (k) { var p = k.split('|'); return { unit: p[0], item: p[1], month: Number(p[2]), value: dirty[k] }; });
    api('POST', '/api/trackers/' + encodeURIComponent(cur.id) + '/entries', { year: cur.year, cells: cells }).then(function (j) {
      var refused = (j.refused || []).map(function (r) { return r.unit + ' ' + r.item + ' ' + r.month + ' : ' + r.reason; });
      var msg = j.written + ' saisie(s) enregistrée(s).' + (refused.length ? ' Refusées : ' + refused.join(' ; ') : '');
      dirty = {}; return open(cur.id).then(function () { status(msg, refused.length > 0); });
    }).catch(function (e) { status(e.message + (e.body && e.body.refused ? ' — ' + e.body.refused.map(function (r) { return r.month + ' ' + r.reason; }).join(' ; ') : ''), true); });
  });

  // ── Locks ────────────────────────────────────────────────────────────
  function renderLocks() {
    $('tk-locks').innerHTML = MONTHS.map(function (m, i) {
      var on = locks.indexOf(i + 1) >= 0;
      return '<button type="button" class="db-btn tk-lock' + (on ? ' tk-lock-on' : '') + '" data-month="' + (i + 1) + '" aria-pressed="' + on + '">' + m + (on ? ' · verrouillé' : '') + '</button>';
    }).join('');
  }
  $('tk-locks').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.tk-lock'); if (!b) return;
    var month = Number(b.getAttribute('data-month')), on = b.getAttribute('aria-pressed') === 'true';
    api('POST', '/api/trackers/' + encodeURIComponent(cur.id) + '/locks', { year: cur.year, month: month, locked: !on }).then(function (j) {
      locks = j.locks.map(function (l) { return l.month; }); renderLocks(); renderGrid();
      status(MONTHS[month - 1] + (on ? ' déverrouillé.' : ' verrouillé.'));
    }).catch(function (e) { status(e.message, true); });
  });
  $('tk-sources').addEventListener('click', function () {
    api('POST', '/api/trackers/' + encodeURIComponent(cur.id) + '/refresh-sources', {}).then(function (j) {
      var msg = j.cells + ' valeur(s) recalculée(s) depuis le dictionnaire.' + (j.skipped && j.skipped.length ? ' Ignorées : ' + j.skipped.join(' ; ') : '');
      return open(cur.id).then(function () { status(msg); });
    }).catch(function (e) { status(e.message, true); });
  });

  // ── Exchange ─────────────────────────────────────────────────────────
  function download(kind) {
    var url = '/api/trackers/' + encodeURIComponent(cur.id) + '/export.' + kind + '?year=' + cur.year + '&month=' + $('tk-month').value;
    fetch(url, { headers: { 'x-report-token': tok() } }).then(function (r) {
      if (!r.ok) throw new Error('Export impossible (HTTP ' + r.status + ')');
      return r.blob();
    }).then(function (b) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = cur.id + '-' + cur.year + '.' + kind;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }).catch(function (e) { status(e.message, true); });
  }
  $('tk-xlsx').addEventListener('click', function (e) { e.preventDefault(); download('xlsx'); });
  $('tk-pptx').addEventListener('click', function (e) { e.preventDefault(); download('pptx'); });
  $('tk-import').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    var input = this;
    var rd = new FileReader();
    rd.onload = function () {
      var b64 = String(rd.result).split(',')[1] || '';
      var send = function (dry) { return api('POST', '/api/trackers/' + encodeURIComponent(cur.id) + '/import', { year: cur.year, file: b64, dry: dry }); };
      send(true).then(function (j) {
        var out = $('tk-import-out'); out.hidden = false;
        var problems = (j.rejected || []).concat((j.refused || []).map(function (r) { return r.unit + ' ' + r.item + ' ' + r.month + ' : ' + r.reason; }));
        out.innerHTML = '<p><b>' + j.accepted + '</b> valeur(s) prête(s) à importer' + (problems.length ? ', <b>' + problems.length + '</b> écartée(s) :' : '.') + '</p>' +
          (problems.length ? '<ul>' + problems.slice(0, 30).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
          (j.accepted ? '<button class="db-btn db-primary" type="button" id="tk-import-go">Importer ces ' + j.accepted + ' valeurs</button>' : '');
        var go = $('tk-import-go');
        if (go) go.addEventListener('click', function () { send(false).then(function (k) { out.hidden = true; return open(cur.id).then(function () { status(k.written + ' valeur(s) importée(s).'); }); }).catch(function (e) { status(e.message, true); }); });
      }).catch(function (e) { status(e.message, true); });
      input.value = '';
    };
    rd.readAsDataURL(f);
  });

  $('tk-pick').addEventListener('change', function () { open(this.value); });
  $('tk-unit').addEventListener('change', renderGrid);
  $('tk-month').addEventListener('change', function () { renderSummaryWithDirty(); renderGrid(); });
  loadList();
})();
