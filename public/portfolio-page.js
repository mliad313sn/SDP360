/* Step 8 — the portfolio: tree, schedule (Gantt with dependencies, today line), alerts, evidence, editing for the
 * portfolio managers, monthly report. No inline script (strict CSP). Every status and alert is computed by the
 * server (services/portfolio/analysis.js). */
(function () {
  'use strict';
  var S = window.SdpApi, esc = S.esc;
  var $ = function (id) { return document.getElementById(id); };
  var st = function (m, e) { S.status($('pf-status'), m, e); };
  var KIND = { programme: 'Programme', objective: 'Objectif', project: 'Projet', milestone: 'Jalon', deliverable: 'Livrable' };
  var STATUS = { not_started: 'Pas commencé', on_track: 'En bonne voie', at_risk: 'À risque', late: 'En retard', done: 'Terminé', cancelled: 'Annulé' };
  var CLS = { late: 'ck-late', at_risk: 'ck-risk', done: 'ck-ok', on_track: 'ck-ok' };
  var CHILD = { programme: 'objective', objective: 'project', project: 'milestone', milestone: 'deliverable' };
  var data = null, editing = null, parentFor = null;
  var opt = function (v, t, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(t) + '</option>'; };
  var pct = function (x) { return x == null ? '—' : Math.round(x * 100) + ' %'; };

  function load() {
    return S.api('GET', '/api/portfolio?month=' + encodeURIComponent($('pf-month').value)).then(function (j) {
      data = j;
      $('pf-add-root').hidden = !j.can_edit;
      $('pf-roadmap').hidden = !(window.__userHasRole && window.__userHasRole('super_admin'));
      $('pf-alerts').innerHTML = j.alerts.length ? '<ul class="ck-list">' + j.alerts.map(function (a) { return '<li class="' + (a.kind === 'late' ? 'ck-late' : 'ck-risk') + '">' + esc(a.text) + '</li>'; }).join('') + '</ul>' : '<p class="db-note">Aucune alerte.</p>';
      renderTree(); renderGantt();
      $('pf-metric').innerHTML = opt('', '— aucune —') + j.metrics.map(function (m) { return opt(m.key, m.fr || m.key); }).join('');
      $('pf-scope').innerHTML = opt('GROUP', 'Ensemble du groupe') + j.sites.map(function (s) { return opt(s.code, s.name); }).join('');
    }).catch(function (e) { st(e.message, true); });
  }
  function kids(id) { return data.nodes.filter(function (n) { return (n.parent_id || null) === id; }); }
  function renderTree() {
    var rows = [];
    var walk = function (pid, depth) {
      kids(pid).forEach(function (n) {
        var ev = n.evidence;
        rows.push('<tr><td style="padding-left:' + (8 + depth * 18) + 'px"><span class="pf-kind">' + esc(KIND[n.kind]) + '</span> ' + esc(n.title) + (n.owner ? ' <small class="ck-muted">· ' + esc(n.owner) + '</small>' : '') + '</td>' +
          '<td class="' + (CLS[n.effective_status] || '') + '">' + esc(STATUS[n.effective_status] || n.effective_status) + '</td>' +
          '<td>' + esc(n.due_date || '—') + (n.drift_days ? ' <small class="ck-muted">(' + (n.drift_days > 0 ? '+' : '') + n.drift_days + ' j)</small>' : '') + '</td>' +
          '<td>' + pct(n.progress) + '</td>' +
          '<td>' + (ev ? (ev.error ? '<span class="ck-risk">' + esc(ev.error) + '</span>' : esc(ev.metric) + ' : ' + (ev.value == null ? 'non mesuré' : esc(ev.value)) + (ev.target != null ? ' / ' + esc(ev.target) : '') + (ev.met === true ? ' <span class="ck-ok">atteint</span>' : ev.met === false ? ' <span class="ck-late">non atteint</span>' : '')) : '—') + '</td>' +
          '<td class="ck-row">' + (data.can_edit ? '<button class="db-btn" type="button" data-edit="' + esc(n.id) + '">Modifier</button>' + (CHILD[n.kind] ? '<button class="db-btn" type="button" data-add="' + esc(n.id) + '">+ ' + esc(KIND[CHILD[n.kind]]) + '</button>' : '') : '') + '</td></tr>');
        walk(n.id, depth + 1);
      });
    };
    walk(null, 0);
    $('pf-tree').innerHTML = '<thead><tr><th scope="col">Élément</th><th scope="col">État</th><th scope="col">Échéance (glissement)</th><th scope="col">Avancement</th><th scope="col">Preuve</th><th scope="col"></th></tr></thead><tbody>' +
      (rows.length ? rows.join('') : '<tr><td colspan="6">Le portefeuille est vide.' + (data.can_edit ? ' Commencez par un programme.' : '') + '</td></tr>') + '</tbody>';
  }

  // ── Gantt (SVG) ──────────────────────────────────────────────────────
  function renderGantt() {
    var items = data.nodes.filter(function (n) { return n.kind !== 'programme' && n.kind !== 'deliverable' && (n.start_date || n.due_date); });
    if (!items.length) { $('pf-gantt').innerHTML = '<p class="db-note">Aucune date à planifier.</p>'; $('pf-gantt-words').textContent = ''; return; }
    var ts = function (d) { return Date.parse(d + 'T00:00:00Z'); };
    var dates = []; items.forEach(function (n) { if (n.start_date) dates.push(ts(n.start_date)); if (n.due_date) dates.push(ts(n.due_date)); });
    dates.push(ts(data.today));
    var min = Math.min.apply(null, dates) - 7 * 864e5, max = Math.max.apply(null, dates) + 7 * 864e5;
    var W = 1000, L = 260, ROW = 22, H = 30 + items.length * ROW;
    var x = function (t) { return L + (W - L - 10) * (t - min) / (max - min); };
    var g = '<defs><marker id="pf-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#666666"/></marker></defs>';
    for (var t = new Date(min); t.getTime() <= max; t.setUTCMonth(t.getUTCMonth() + 1, 1)) {
      var xm = x(t.getTime());
      if (xm >= L) g += '<line class="pf-axis" x1="' + xm.toFixed(1) + '" x2="' + xm.toFixed(1) + '" y1="18" y2="' + H + '"/><text x="' + (xm + 3).toFixed(1) + '" y="12">' + t.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }) + '</text>';
    }
    var pos = {};
    items.forEach(function (n, i) {
      var y = 26 + i * ROW, s = ts(n.start_date || n.due_date), e = ts(n.due_date || n.start_date);
      var x1 = x(s), x2 = Math.max(x(e), x1 + 6);
      pos[n.id] = { x1: x1, x2: x2, y: y + 7 };
      g += '<text x="4" y="' + (y + 11) + '">' + esc((n.kind === 'milestone' ? '◆ ' : '') + (n.title.length > 38 ? n.title.slice(0, 37) + '…' : n.title)) + '</text>';
      g += n.kind === 'milestone' && !n.start_date
        ? '<path class="pf-' + esc(n.effective_status) + '" d="M' + x2.toFixed(1) + ',' + y + ' l7,7 l-7,7 l-7,-7 z"/>'
        : '<rect class="pf-bar pf-' + esc(n.effective_status) + '" x="' + x1.toFixed(1) + '" y="' + (y + 1) + '" width="' + (x2 - x1).toFixed(1) + '" height="12"/>';
    });
    items.forEach(function (n) {
      (n.depends_on || []).forEach(function (dep) {
        var a = pos[dep], b = pos[n.id]; if (!a || !b) return;
        g += '<path class="pf-dep" d="M' + a.x2.toFixed(1) + ',' + a.y + ' C' + (a.x2 + 20).toFixed(1) + ',' + a.y + ' ' + (b.x1 - 20).toFixed(1) + ',' + b.y + ' ' + b.x1.toFixed(1) + ',' + b.y + '"/>';
      });
    });
    var xt = x(ts(data.today));
    g += '<line class="pf-today" x1="' + xt.toFixed(1) + '" x2="' + xt.toFixed(1) + '" y1="18" y2="' + H + '"/>';
    $('pf-gantt').innerHTML = '<svg class="pf-gantt" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-labelledby="pf-gantt-words">' + g + '</svg>';
    var late = items.filter(function (n) { return n.effective_status === 'late'; }).length;
    $('pf-gantt-words').textContent = items.length + ' éléments planifiés, dont ' + late + ' en retard. Le détail est dans l’arborescence ci-dessus.';
  }

  // ── Editing ──────────────────────────────────────────────────────────
  function openForm(node, parentId, kind) {
    editing = node; parentFor = parentId;
    $('pf-edit').hidden = false;
    $('pf-edit-h').textContent = node ? 'Modifier : ' + node.title : 'Nouvel élément';
    var n = node || { kind: kind, status: 'not_started' };
    $('pf-kind').value = n.kind; $('pf-kind').disabled = !!node;
    $('pf-title').value = n.title || ''; $('pf-owner').value = n.owner || ''; $('pf-st').value = n.status;
    $('pf-conf').value = n.confidence == null ? '' : n.confidence;
    $('pf-start').value = n.start_date || ''; $('pf-due').value = n.due_date || ''; $('pf-done').value = n.done_date || '';
    $('pf-budget').value = n.budget == null ? '' : n.budget; $('pf-spent').value = n.spent == null ? '' : n.spent;
    $('pf-metric').value = n.evidence_metric || ''; $('pf-target').value = n.evidence_target == null ? '' : n.evidence_target; $('pf-scope').value = n.evidence_scope || 'GROUP';
    $('pf-deps').innerHTML = data.nodes.filter(function (x) { return !node || x.id !== node.id; }).filter(function (x) { return x.kind !== 'programme'; })
      .map(function (x) { return opt(x.id, KIND[x.kind] + ' — ' + x.title, (n.depends_on || []).indexOf(x.id) >= 0); }).join('');
    $('pf-risk').value = n.risk || ''; $('pf-inc').value = (n.incidents || []).join(', ');
    $('pf-del').hidden = !node;
    $('pf-title').focus();
  }
  $('pf-tree').addEventListener('click', function (e) {
    var ed = e.target.closest && e.target.closest('[data-edit]'), ad = e.target.closest && e.target.closest('[data-add]');
    if (ed) openForm(data.nodes.find(function (n) { return n.id === ed.getAttribute('data-edit'); }), null, null);
    if (ad) { var p = data.nodes.find(function (n) { return n.id === ad.getAttribute('data-add'); }); openForm(null, p.id, CHILD[p.kind]); }
  });
  $('pf-add-root').addEventListener('click', function () { openForm(null, null, 'programme'); });
  $('pf-cancel').addEventListener('click', function () { $('pf-edit').hidden = true; });
  $('pf-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var body = { title: $('pf-title').value, owner: $('pf-owner').value, status: $('pf-st').value, confidence: $('pf-conf').value,
      start_date: $('pf-start').value, due_date: $('pf-due').value, done_date: $('pf-done').value, budget: $('pf-budget').value, spent: $('pf-spent').value,
      evidence_metric: $('pf-metric').value, evidence_target: $('pf-target').value, evidence_scope: $('pf-scope').value,
      depends_on: Array.prototype.slice.call($('pf-deps').selectedOptions).map(function (o) { return o.value; }),
      risk: $('pf-risk').value, incidents: $('pf-inc').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean) };
    var call = editing ? S.api('PUT', '/api/portfolio/nodes/' + encodeURIComponent(editing.id), body)
      : S.api('POST', '/api/portfolio/nodes', Object.assign(body, { kind: $('pf-kind').value, parent_id: parentFor }));
    call.then(function () { $('pf-edit').hidden = true; return load().then(function () { st('Enregistré.'); }); }).catch(function (e2) { st(e2.message, true); });
  });
  $('pf-del').addEventListener('click', function () {
    if (!editing) return;
    S.api('DELETE', '/api/portfolio/nodes/' + encodeURIComponent(editing.id)).then(function () { $('pf-edit').hidden = true; return load().then(function () { st('Élément supprimé.'); }); }).catch(function (e) { st(e.message, true); });
  });
  $('pf-report').addEventListener('click', function () { S.openDocument('/api/portfolio/report?month=' + encodeURIComponent($('pf-month').value)).catch(function (e) { st(e.message, true); }); });
  $('pf-roadmap').addEventListener('click', function () {
    S.api('POST', '/api/portfolio/import-roadmap', {}).then(function (r) { return load().then(function () { st('Roadmap copiée : ' + r.created + ' élément(s) créé(s), ' + r.updated + ' mis à jour. Le Roadmap Manager reste inchangé.'); }); })
      .catch(function (e) { st(e.message, true); });
  });
  $('pf-month').value = new Date().toISOString().slice(0, 7);
  $('pf-month').addEventListener('change', load);
  load();
})();
