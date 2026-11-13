/* PPM parity W4 — the project page's enterprise panels (Board tab, Comments tab, Project roles panel, offline editing).
 * Mounted by public/project.html only while the matching switch is on (GET /api/governance/ppm/features):
 *   agile_board  → mountBoard   (lib/ppmBoard.js)       comments → mountComments
 *   project_roles → mountRoles                           offline_edit → installOffline (lib/ppmOfflineQueue.js)
 * Every write goes through the EXISTING routes; the server decides (403 codes are shown in plain words).
 */
(function (root) {
  'use strict';
  var PLAIN = {
    CLIENT_READ_ONLY: 'You follow this project as a client: you can read it, not change it.',
    ROLE_SCOPE: 'Your project role does not cover this change — the project manager makes it.',
    FIELD_SCOPE: 'Your project role lets you change only some fields of this task.',
    OWN_TASK_ONLY: 'As a contributor you update only the tasks you own.',
    ROLE_ASSIGN: 'The committee or the project manager assigns project roles.',
    NO_ACCOUNT: 'A project role needs a team member linked to a user account.',
    STALE_VERSION: 'Someone else changed this task since you opened the page. Reload the page to see their change, then try again.',
    BODY_REQUIRED: 'Write something before posting.',
    BODY_TOO_LONG: 'A comment is at most 4000 characters.',
  };
  var said = function (e) { return (e && e.code && PLAIN[e.code]) || (e && e.message) || 'Error'; };
  var me = function () { return root.__authUser || {}; };

  // ---- Board -----------------------------------------------------------------------------------------------------
  function mountBoard(X) {
    var B = root.PpmBoard, box = X.$('board'); if (!B || !box) return;
    var V = X.V(), ctx = { committee: !!V.committee, canEditPlan: !!V.can_edit_plan, projectRole: V.project_role || null, user: me() };
    var data = B.board(V.tasks || []);
    box.innerHTML = B.html(data, X.esc, ctx) + '<p class="muted">Work packages are the tasks without sub-tasks; a summary task rolls up from its children. Drag a card, or use “Move to”.</p>';
    var find = function (id) { var all = data.other.slice(); data.columns.forEach(function (c) { all = all.concat(c.cards); }); return all.filter(function (c) { return String(c.id) === String(id); })[0]; };
    var move = function (id, to) {
      var b = B.movePayload(find(id), to); if (!b) return;
      X.api('/api/governance/portfolio/task', { method: 'PUT', body: JSON.stringify(b) }).then(function (j) { X.msg(j && j.queued ? 'Saved on this device — it will be sent when the connection is back.' : 'Task moved to ' + B.LABELS[to] + '.'); return X.reload(); }).catch(function (e) { X.msg(said(e), 'errors'); mountBoard(X); });
    };
    box.onchange = function (ev) { var s = ev.target; if (s && s.getAttribute && s.getAttribute('data-move')) move(s.getAttribute('data-move'), s.value); };
    box.ondragstart = function (ev) { var li = ev.target.closest && ev.target.closest('.pb-card'); if (li && ev.dataTransfer) ev.dataTransfer.setData('text/plain', li.getAttribute('data-task')); };
    box.ondragover = function (ev) { if (ev.target.closest && ev.target.closest('.pb-col')) ev.preventDefault(); };
    box.ondrop = function (ev) { var col = ev.target.closest && ev.target.closest('.pb-col'); if (!col || !ev.dataTransfer) return; ev.preventDefault(); move(ev.dataTransfer.getData('text/plain'), col.getAttribute('data-col')); };
  }

  // ---- Comments with @mentions ---------------------------------------------------------------------------------
  function mountComments(X) {
    var box = X.$('comments'); if (!box) return;
    var V = X.V(), client = V.project_role === 'client' && !V.committee;
    var tasks = (V.tasks || []).map(function (t) { return '<option value="' + X.esc(String(t.id)) + '">' + X.esc([t.wbs_code, t.name].filter(Boolean).join(' ')) + '</option>'; }).join('');
    var form = client ? '<p class="muted">You follow this project as a client: comments are read-only for you.</p>' :
      '<div class="row"><label style="grid-column:1/-1">Comment (type @username to notify someone who can read this project) <textarea id="cm-body" rows="3" maxlength="4000"></textarea></label>' +
      '<label>About a task (optional) <select id="cm-task"><option value="">— the whole project —</option>' + tasks + '</select></label></div>' +
      '<div class="bar"><button class="btn primary" id="cm-post" type="button">Post comment</button><span class="muted">Comments cannot be edited or deleted: post a correction instead.</span></div>';
    box.innerHTML = '<div id="cm-list"><p class="muted">Loading…</p></div>' + form;
    var render = function (list) {
      var byTask = {}; (V.tasks || []).forEach(function (t) { byTask[t.id] = t; });
      X.$('cm-list').innerHTML = list.length ? '<ul class="cm-list">' + list.map(function (c) {
        var t = c.task_id != null && byTask[c.task_id];
        return '<li><div class="muted">' + X.esc(String(c.created_at || '').slice(0, 16).replace('T', ' ')) + ' · ' + X.esc(c.author_name || '—') + (c.task_id != null ? ' · task ' + X.esc(t ? [t.wbs_code, t.name].filter(Boolean).join(' ') : '#' + c.task_id) : '') + '</div><div class="cm-body">' + X.esc(c.body) + '</div></li>';
      }).join('') + '</ul>' : '<p class="muted">No comment yet.</p>';
    };
    var load = function () { X.api('/api/governance/ppm/project/' + encodeURIComponent(X.pid) + '/comments').then(function (j) { render(j.comments || []); }).catch(function (e) { X.$('cm-list').innerHTML = '<p class="refusal">' + X.esc(said(e)) + '</p>'; }); };
    load();
    var post = X.$('cm-post');
    if (post) post.onclick = function () {
      var t = X.$('cm-task').value;
      X.api('/api/governance/ppm/project/' + encodeURIComponent(X.pid) + '/comments', { method: 'POST', body: JSON.stringify({ body: X.$('cm-body').value, task_id: t ? Number(t) : undefined }) }).then(function (j) {
        X.$('cm-body').value = '';
        X.msg((j.unresolved && j.unresolved.length ? 'Comment posted. Not notified (unknown, or cannot read this project): @' + j.unresolved.join(', @') : 'Comment posted.') + (j.notified ? ' ' + j.notified + ' person(s) notified.' : ''));
        load();
      }).catch(function (e) { X.msg(said(e), 'errors'); });
    };
  }

  // ---- Project roles ----------------------------------------------------------------------------------------------
  function mountRoles(X) {
    var box = X.$('roles'), panel = X.$('roles-panel'); if (!box || !panel) return;
    X.api('/api/governance/ppm/project/' + encodeURIComponent(X.pid) + '/roles').then(function (j) {
      panel.hidden = false;
      var label = function (r) { return r ? (j.labels[r] && j.labels[r].en) || r : '—'; };
      var opts = function (sel) { return '<option value="">— none —</option>' + j.roles.map(function (r) { return '<option value="' + r + '"' + (r === sel ? ' selected' : '') + '>' + X.esc(label(r)) + '</option>'; }).join(''); };
      box.innerHTML = (j.my_role ? '<p>Your role on this project: <b>' + X.esc(label(j.my_role)) + '</b></p>' : '') + (j.members.length ? '<table><thead><tr><th>Member</th><th>Job</th><th>Project role</th></tr></thead><tbody>' + j.members.map(function (m) {
        var cell = j.can_assign && m.linked ? '<select data-role-member="' + m.id + '" aria-label="Project role of ' + X.esc(m.display_name) + '">' + opts(m.ppm_role) + '</select>' : X.esc(label(m.ppm_role)) + (m.linked ? '' : ' <span class="muted">(no account)</span>');
        return '<tr><td>' + X.esc(m.display_name) + '</td><td>' + X.esc(m.job_role || '—') + '</td><td>' + cell + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="muted">No team member yet: add members in the Team panel first.</p>');
      box.onchange = function (ev) {
        var s = ev.target, mid = s && s.getAttribute && s.getAttribute('data-role-member'); if (!mid) return;
        X.api('/api/governance/ppm/project/' + encodeURIComponent(X.pid) + '/roles/' + mid, { method: 'PUT', body: JSON.stringify({ ppm_role: s.value || null }) }).then(function () { X.msg('Project role saved.'); mountRoles(X); }).catch(function (e) { X.msg(said(e), 'errors'); mountRoles(X); });
      };
    }).catch(function () { panel.hidden = true; });
  }

  // ---- Offline editing --------------------------------------------------------------------------------------------
  function installOffline(o) {
    var Q0 = root.PpmOfflineQueue, DS = root.DraftStore;
    if (!Q0 || root.__ppmOfflineInstalled || typeof root.fetch !== 'function') return null;
    root.__ppmOfflineInstalled = true;
    var store;
    if (DS) { var ds = DS.makeDraftStore({ adapter: DS.autoAdapter({ indexedDB: root.indexedDB, localStorage: root.localStorage, prefix: 'ppm-offline__', dbName: 'em-ppm-offline', storeName: 'queue' }) }); store = { get: function (k) { return ds.get(k); }, put: function (k, v) { return ds.put(k, v); } }; }
    else { var mem = {}; store = { get: function (k) { return Promise.resolve(mem[k] || null); }, put: function (k, v) { mem[k] = v; return Promise.resolve({ ok: true }); } }; }
    var Q = Q0.makeQueue(store, 'queue:' + o.pid), DKEY = 'detail:' + o.pid;
    var orig = root.fetch.bind(root);
    var DETAIL = '/api/governance/portfolio/project/' + o.pid;
    var json = function (status, body) { return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } }); };
    var rowOf = function (detail, kind, id) { var list = (detail && (kind === 'task' ? detail.tasks : detail.milestones)) || []; return list.filter(function (r) { return String(r.id) === String(id); })[0] || null; };
    function overlay(detail, items) {
      var d = JSON.parse(JSON.stringify(detail));
      items.filter(function (e) { return e.state === 'pending' && e.id != null; }).forEach(function (e) { var r = rowOf(d, e.kind, e.id); if (r) Object.keys(e.body).forEach(function (k) { if (k !== 'version') r[k] = e.body[k]; }); });
      return d;
    }
    function enqueue(kind, body) {
      return Promise.resolve(store.get(DKEY)).then(function (detail) {
        var row = body.id != null ? rowOf(detail, kind, body.id) : null, base = null;
        if (row) { base = { version: row.version == null ? null : row.version }; Q0.fieldsOf(body).forEach(function (f) { base[f] = row[f] == null ? null : row[f]; }); }
        return Q.enqueue({ kind: kind, id: body.id, project_id: body.project_id != null ? body.project_id : o.pid, body: body, base: base });
      }).then(function () { banner(); return json(202, { ok: true, id: body.id || null, queued: true }); });
    }
    root.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '', method = String((init && init.method) || 'GET').toUpperCase();
      var path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      var m = method === 'PUT' && path.match(/^\/api\/governance\/portfolio\/(task|milestone)$/);
      if (m) {
        var body; try { body = JSON.parse((init && init.body) || '{}'); } catch (_) { return orig(input, init); }
        if (root.navigator && root.navigator.onLine === false) return enqueue(m[1], body);
        return orig(input, init).catch(function () { return enqueue(m[1], body); });
      }
      if (method === 'GET' && path === DETAIL) {
        return orig(input, init).then(function (r) { if (r.ok) r.clone().json().then(function (j) { store.put(DKEY, j); }).catch(function () {}); return r; })
          .catch(function (err) { return Promise.all([store.get(DKEY), Q.list()]).then(function (a) { if (!a[0]) throw err; return json(200, Object.assign(overlay(a[0], a[1]), { offline: true })); }); });
      }
      return orig(input, init);
    };
    var send = function (e, body) {
      return orig('/api/governance/portfolio/' + e.kind, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, code: j && j.code }; }); })
        .catch(function () { return { network: true }; });
    };
    var current = function (e) { return orig(DETAIL).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d) store.put(DKEY, d); return rowOf(d, e.kind, e.id); }).catch(function () { return null; }); };
    function banner() {
      var el = document.getElementById('offline-banner'); if (!el) return Promise.resolve();
      return Q.list().then(function (items) {
        var pend = items.filter(function (x) { return x.state === 'pending'; }), conf = items.filter(function (x) { return x.state === 'conflict'; }), ref = items.filter(function (x) { return x.state === 'refused'; });
        el.hidden = !(items.length || (root.navigator && root.navigator.onLine === false));
        var off = root.navigator && root.navigator.onLine === false;
        el.innerHTML = '<p><b>' + (off ? 'Offline' : 'Online') + '</b> · ' + pend.length + ' edit(s) waiting on this device' + (conf.length ? ' · ' + conf.length + ' conflict(s) to merge' : '') + (ref.length ? ' · ' + ref.length + ' refused' : '') + '</p>' +
          conf.map(mergeHtml).join('') + ref.map(function (e) { return '<div class="merge"><p>' + o.esc(e.kind + ' #' + (e.id || 'new')) + ' was refused by the server (' + o.esc(said({ code: e.code, message: e.code })) + ').</p><button class="btn" type="button" data-drop="' + e.uuid + '">Discard this edit</button></div>'; }).join('');
      });
    }
    function mergeHtml(e) {
      var rows = (e.conflicts || []).map(function (c) {
        var nm = 'mg-' + e.uuid + '-' + c.field;
        return '<tr><td>' + o.esc(c.field) + '</td><td>' + o.esc(c.base == null ? '—' : String(c.base)) + '</td><td><label><input type="radio" name="' + nm + '" value="mine"> ' + o.esc(c.mine == null ? '—' : String(c.mine)) + '</label></td><td><label><input type="radio" name="' + nm + '" value="theirs" checked> ' + o.esc(c.theirs == null ? '—' : String(c.theirs)) + '</label></td></tr>';
      }).join('');
      return '<div class="merge" data-merge="' + e.uuid + '"><p>Your offline edit of ' + o.esc(e.kind + ' #' + e.id) + ' meets a change saved by someone else. Choose, field by field, which value to keep.</p>' +
        (rows ? '<table><thead><tr><th>Field</th><th>When you edited</th><th>Keep mine</th><th>Keep theirs</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="muted">The change could not be re-applied automatically.</p>') +
        '<div class="bar"><button class="btn primary" type="button" data-apply="' + e.uuid + '">Apply my choices</button><button class="btn" type="button" data-drop="' + e.uuid + '">Discard my edit</button></div></div>';
    }
    document.addEventListener('click', function (ev) {
      var a = ev.target.getAttribute && (ev.target.getAttribute('data-apply') || ev.target.getAttribute('data-drop')); if (!a) return;
      var drop = !!ev.target.getAttribute('data-drop');
      Q.list().then(function (items) {
        var e = items.filter(function (x) { return x.uuid === a; })[0]; if (!e) return null;
        if (drop) return Q.remove(a);
        var choices = {}; (e.conflicts || []).forEach(function (c) { var r = document.querySelector('input[name="mg-' + a + '-' + c.field + '"]:checked'); choices[c.field] = r ? r.value : 'theirs'; });
        return current(e).then(function (cur) {
          var res = Q0.resolve(e, choices, cur); if (res.drop) return Q.remove(a);
          return send(e, res.body).then(function (r) { if (r.ok) return Q.remove(a); o.msg(said({ code: r.code, message: 'not sent' }), 'errors'); return null; });
        });
      }).then(function () { banner(); if (o.reload) o.reload(); });
    });
    function flush() { return Q0.replay(Q, { send: send, current: current }).then(function (r) { banner(); if ((r.sent || r.conflicts) && o.reload) o.reload(); return r; }); }
    root.addEventListener('online', flush);
    root.addEventListener('offline', banner);
    banner(); flush();
    return { queue: Q, flush: flush };
  }

  root.PpmCollabUi = { mountBoard: mountBoard, mountComments: mountComments, mountRoles: mountRoles, installOffline: installOffline, PLAIN: PLAIN };
})(typeof window !== 'undefined' ? window : globalThis);
