/* R2-WORKBENCH (REBUILD-SPEC R5) — project page add-ons, each shown only while its PROPOSED switch is on
   (GET /api/governance/ppm/features). UMD: loaded by project.html, required by tests. The *Html functions are PURE
   (esc = the page's HTML escaper; every value goes through it, "—" = not known, never 0); mount* wire a panel.
   R2-WB-04 teamHtml(members) — the project team (name, user link, role, allocation, window).
   R2-WB-02 hoursHtml(rows, tasks) — per task planned effort / actual hours / variance ("—" = no entry = unknown);
            entriesHtml(entries) — the time entries of one task.
   R2-WB-01 changesHtml(list, who) — change requests with the next steps this person may take (the server decides). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PpmWorkbench = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var n = function (v, esc, unit) { return v == null || v === '' || (typeof v === 'number' && !isFinite(v)) ? '—' : esc(String(v) + (unit || '')); };

  function teamHtml(members, esc, canEdit) {
    var list = members || [];
    if (!list.length) return '<p class="muted">No team member recorded yet. Task owners stay free text; members are offered in the task owner field.</p>';
    return '<table><thead><tr><th>Member</th><th>User account</th><th>Role</th><th>Allocation to the project</th><th>From</th><th>To</th>' + (canEdit ? '<th></th>' : '') + '</tr></thead><tbody>' +
      list.map(function (m) {
        return '<tr><td>' + esc(m.label) + '</td><td>' + (m.user_id != null ? n(m.user_name || ('User #' + m.user_id), esc) : '<span class="muted">not linked</span>') + '</td><td>' + n(m.role, esc) + '</td><td>' + (m.allocation_pct == null ? '<span class="muted">unknown</span>' : n(m.allocation_pct, esc, ' %')) + '</td><td>' + n(m.from_day, esc) + '</td><td>' + n(m.to_day, esc) + '</td>' +
          (canEdit ? '<td><button class="btn" type="button" data-team-edit="' + esc(String(m.id)) + '">Edit</button> <button class="btn danger" type="button" data-team-del="' + esc(String(m.id)) + '">Remove</button></td>' : '') + '</tr>';
      }).join('') + '</tbody></table><p class="muted">A task whose allocation is not entered is read at its owner\'s allocation to the project (when the owner is a member); an entered allocation always wins.</p>';
  }

  /** UAT-OI-08 — <option>s for the team picker: "not linked" first, then the people (id + display name). PURE. */
  function pickerOptions(people, esc) {
    return '<option value="">— not linked —</option>' + (people || []).map(function (p) { return '<option value="' + esc(String(p.id)) + '">' + esc(p.name) + '</option>'; }).join('');
  }
  // a member linked to an account the picker does not offer (inactive) keeps its link visible while edited
  function ensureOption(sel, m, esc) {
    if (!sel || m.user_id == null) return;
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === String(m.user_id)) return;
    sel.insertAdjacentHTML('beforeend', '<option value="' + esc(String(m.user_id)) + '">' + esc(m.user_name || ('User #' + m.user_id)) + '</option>');
  }

  var TEAM = { members: [] };   // shared by the listeners wired once and every later mount
  /** ctx: { $, esc, api, msg, fail, pid, canEdit } — fills #team, #team-edit and the task owner datalist. */
  function mountTeam(ctx) {
    var $ = ctx.$, esc = ctx.esc, url = '/api/governance/ppm/project/' + encodeURIComponent(ctx.pid) + '/team';
    $('team-panel').hidden = false; $('team-edit').hidden = !ctx.canEdit;
    var draw = function (members) {
      TEAM.members = members || [];
      $('team').innerHTML = teamHtml(TEAM.members, esc, ctx.canEdit);
      if ($('t-owner-list')) $('t-owner-list').innerHTML = TEAM.members.map(function (m) { return '<option value="' + esc(m.label) + '">' + esc(m.role || '') + '</option>'; }).join('');
    };
    ctx.api(url).then(function (j) { draw(j.members); }).catch(ctx.fail);
    // UAT-OI-08 — the account picker (active users, display names only); free text stays allowed for external people
    if (ctx.canEdit) ctx.api(url + '/people').then(function (j) { $('tm-user').innerHTML = pickerOptions(j.people, esc); }).catch(function () { /* the picker stays "not linked" */ });
    if ($('team-save').getAttribute('data-wired')) return;
    $('team-save').setAttribute('data-wired', '1');
    var field = function (id) { var v = $(id).value.trim(); return v === '' ? null : v; };
    $('team-save').addEventListener('click', function () {
      var b = { id: TEAM.editId || undefined, label: field('tm-label'), role: field('tm-role'), allocation_pct: field('tm-alloc') == null ? null : Number(field('tm-alloc')), from_day: field('tm-from'), to_day: field('tm-to'), user_id: field('tm-user') == null ? null : Number(field('tm-user')) };
      ctx.api(url, { method: 'PUT', body: JSON.stringify(b) }).then(function (j) { ctx.msg('Team member saved.'); draw(j.members); TEAM.editId = null; ['tm-label', 'tm-role', 'tm-alloc', 'tm-from', 'tm-to', 'tm-user'].forEach(function (k) { $(k).value = ''; }); }).catch(ctx.fail);
    });
    $('tm-user').addEventListener('change', function () {   // picking an account fills an empty name with its display name
      var o = this.options[this.selectedIndex]; if (o && o.value && !$('tm-label').value.trim()) $('tm-label').value = o.textContent;
    });
    $('team').addEventListener('click', function (ev) {
      var e = ev.target.closest && ev.target.closest('[data-team-edit]'), d = ev.target.closest && ev.target.closest('[data-team-del]');
      if (e) { var m = TEAM.members.filter(function (x) { return String(x.id) === e.getAttribute('data-team-edit'); })[0]; if (!m) return;
        TEAM.editId = m.id; $('tm-label').value = m.label || ''; $('tm-role').value = m.role || ''; $('tm-alloc').value = m.allocation_pct == null ? '' : m.allocation_pct; $('tm-from').value = m.from_day || ''; $('tm-to').value = m.to_day || ''; ensureOption($('tm-user'), m, esc); $('tm-user').value = m.user_id == null ? '' : String(m.user_id); }
      if (d) ctx.api(url + '/' + encodeURIComponent(d.getAttribute('data-team-del')), { method: 'DELETE' }).then(function (j) { ctx.msg('Team member removed.'); draw(j.members); }).catch(ctx.fail);
    });
  }

  function hoursHtml(rows, tasks, esc) {
    var name = {}; (tasks || []).forEach(function (t) { name[t.id] = [t.wbs_code, t.name].filter(function (x) { return x != null && x !== ''; }).join(' '); });
    var list = rows || [];
    if (!list.length) return '<p class="muted">No task yet.</p>';
    var known = list.filter(function (r) { return r.actual != null; }).length;
    return '<table><thead><tr><th>Task</th><th>Planned effort</th><th>Actual hours</th><th>Variance</th><th>Entries</th></tr></thead><tbody>' + list.map(function (r) {
      return '<tr><td>' + esc(name[r.task_id] || ('#' + r.task_id)) + '</td><td>' + n(r.planned, esc, ' h') + '</td><td>' + n(r.actual, esc, ' h') + '</td><td>' + (r.variance == null ? '—' : esc((r.variance > 0 ? '+' : '') + r.variance + ' h')) + '</td><td>' + esc(String(r.entries || 0)) + '</td></tr>';
    }).join('') + '</tbody></table><p class="muted">' + esc(known + ' of ' + list.length) + ' task(s) have recorded hours. “—” = no time entry (not measured), never 0; the variance needs both a planned effort and recorded hours.</p>';
  }
  function entriesHtml(entries, esc, canEdit) {
    if (!entries || !entries.length) return '<p class="muted">No hours recorded on this task.</p>';
    return '<table><thead><tr><th>Day</th><th>Person</th><th>Hours</th><th>Note</th>' + (canEdit ? '<th></th>' : '') + '</tr></thead><tbody>' + entries.map(function (e) {
      return '<tr><td>' + n(e.day, esc) + '</td><td>' + n(e.person_label, esc) + '</td><td>' + n(e.hours, esc, ' h') + '</td><td>' + n(e.note, esc) + '</td>' + (canEdit ? '<td><button class="btn danger" type="button" data-time-del="' + esc(String(e.id)) + '">Remove</button></td>' : '') + '</tr>';
    }).join('') + '</tbody></table>';
  }
  var TIME = { ctx: null };
  /** ctx: { $, esc, api, msg, fail, pid, canEdit, tasks } — fills #time-hours, the task picker and #time-entries. */
  function mountTime(ctx) {
    var $ = ctx.$, esc = ctx.esc; TIME.ctx = ctx;
    $('time-panel').hidden = false; $('time-edit').hidden = !ctx.canEdit;
    var tasks = ctx.tasks || [];
    var sel = $('te-task').value;
    $('te-task').innerHTML = tasks.map(function (t) { return '<option value="' + esc(String(t.id)) + '">' + esc([t.wbs_code, t.name].filter(function (x) { return x != null && x !== ''; }).join(' ')) + '</option>'; }).join('');
    if (sel) $('te-task').value = sel;
    var drawHours = function () { ctx.api('/api/governance/ppm/project/' + encodeURIComponent(ctx.pid) + '/actual-hours').then(function (j) { $('time-hours').innerHTML = hoursHtml(j.hours, tasks, esc); }).catch(ctx.fail); };
    var drawEntries = function () { var tid = $('te-task').value; if (!tid) { $('time-entries').innerHTML = ''; return; } ctx.api('/api/governance/ppm/task/' + encodeURIComponent(tid) + '/time').then(function (j) { $('time-entries').innerHTML = entriesHtml(j.entries, esc, TIME.ctx.canEdit); }).catch(ctx.fail); };
    TIME.redraw = function () { drawHours(); drawEntries(); };
    TIME.redraw();
    if ($('te-save').getAttribute('data-wired')) return;
    $('te-save').setAttribute('data-wired', '1');
    $('te-task').addEventListener('change', function () { TIME.redraw(); });
    $('te-save').addEventListener('click', function () {
      var c = TIME.ctx, tid = $('te-task').value; if (!tid) return;
      var b = { person_label: $('te-person').value.trim() || null, day: $('te-day').value || null, hours: $('te-hours').value === '' ? null : Number($('te-hours').value), note: $('te-note').value.trim() || null };
      c.api('/api/governance/ppm/task/' + encodeURIComponent(tid) + '/time', { method: 'POST', body: JSON.stringify(b) }).then(function () { c.msg('Hours recorded.'); $('te-hours').value = ''; $('te-note').value = ''; TIME.redraw(); }).catch(c.fail);
    });
    $('time-entries').addEventListener('click', function (ev) {
      var d = ev.target.closest && ev.target.closest('[data-time-del]'); if (!d) return;
      var c = TIME.ctx;
      c.api('/api/governance/ppm/task/' + encodeURIComponent($('te-task').value) + '/time/' + encodeURIComponent(d.getAttribute('data-time-del')), { method: 'DELETE' }).then(function () { c.msg('Time entry removed.'); TIME.redraw(); }).catch(c.fail);
    });
  }

  // the steps of a change request (mirror of services/ppmWorkbench.CR_ACTIONS — only to show buttons; the server decides)
  var CR_STEPS = { assess: { from: ['proposed'], committee: true, sod: false, label: 'Assess' }, approve: { from: ['assessed'], committee: true, sod: true, label: 'Approve' },
    reject: { from: ['proposed', 'assessed'], committee: true, sod: true, label: 'Reject' }, withdraw: { from: ['proposed', 'assessed', 'approved'], committee: false, sod: false, label: 'Withdraw' },
    apply: { from: ['approved'], committee: true, sod: false, label: 'Apply' } };
  function crSteps(cr, who) {
    var w = who || {}, author = cr.author_id != null && Number(cr.author_id) === Number(w.me);
    return Object.keys(CR_STEPS).filter(function (k) {
      var a = CR_STEPS[k];
      if (a.from.indexOf(cr.status) < 0) return false;
      if (k === 'withdraw') return author || !!w.committee;
      if (a.committee && !w.committee) return false;
      return !(a.sod && author);
    });
  }
  function changesHtml(list, esc, who) {
    var w = who || {};
    if (!list || !list.length) return '<p class="muted">No change request on this project.</p>';
    return '<table><thead><tr><th>#</th><th>Change</th><th>Status</th><th>Dates impact</th><th>Money impact</th><th>Author</th><th>Decided by</th><th>Baseline</th><th>Next step</th></tr></thead><tbody>' + list.map(function (c) {
      var money = w.moneyHidden ? '<span class="muted">restricted</span>' : (c.impact_budget == null ? '—' : esc(String(c.impact_budget)) + ' ' + n(c.currency, esc));
      var steps = crSteps(c, w).map(function (k) { return '<button class="btn' + (k === 'reject' || k === 'withdraw' ? ' danger' : '') + '" type="button" data-cr="' + esc(String(c.id)) + '" data-cr-action="' + esc(k) + '">' + esc(CR_STEPS[k].label) + '</button>'; }).join(' ');
      return '<tr><td>' + esc(String(c.id)) + '</td><td><b>' + esc(c.title) + '</b><br><span class="muted">' + n(c.reason, esc) + '</span></td><td><span class="pill">' + esc(c.status) + '</span></td><td>' + (c.impact_dates_days == null ? '—' : esc((c.impact_dates_days > 0 ? '+' : '') + c.impact_dates_days + ' d')) + '</td><td>' + money + '</td><td>' + n(c.author_name, esc) + '</td><td>' + n(c.decided_by_name, esc) + '</td><td>' + (c.applied_baseline_version == null ? '—' : 'v' + esc(String(c.applied_baseline_version))) + '</td><td>' + (steps || '<span class="muted">—</span>') + '</td></tr>';
    }).join('') + '</tbody></table><p class="muted">The author never approves or rejects their own change. Applying a change with a dates impact writes a new baseline version (committee re-baseline).</p>';
  }
  var CHG = { ctx: null, who: {} };
  function mountChanges(ctx) {
    var $ = ctx.$, esc = ctx.esc, url = '/api/governance/ppm/project/' + encodeURIComponent(ctx.pid) + '/changes'; CHG.ctx = ctx;
    $('cr-new').hidden = !ctx.canEdit;
    var draw = function () { ctx.api(url).then(function (j) { CHG.who = { me: j.me, committee: j.committee, moneyHidden: j.money_hidden }; $('cr-money-box').hidden = !!j.money_hidden; $('changes').innerHTML = changesHtml(j.changes, esc, CHG.who); }).catch(ctx.fail); };
    CHG.draw = draw; draw();
    if ($('cr-save').getAttribute('data-wired')) return;
    $('cr-save').setAttribute('data-wired', '1');
    $('cr-save').addEventListener('click', function () {
      var c = CHG.ctx, v = function (id) { var x = $(id).value.trim(); return x === '' ? null : x; };
      var b = { title: v('cr-title'), reason: v('cr-reason'), impact_dates_days: v('cr-days') == null ? null : Number(v('cr-days')), impact_budget: v('cr-amount') == null ? null : Number(v('cr-amount')), currency: v('cr-cur') };
      c.api(url, { method: 'POST', body: JSON.stringify(b) }).then(function () { c.msg('Change request proposed.'); ['cr-title', 'cr-reason', 'cr-days', 'cr-amount', 'cr-cur'].forEach(function (k) { $(k).value = ''; }); CHG.draw(); }).catch(c.fail);
    });
    $('changes').addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-cr-action]'); if (!b) return;
      var c = CHG.ctx, note = $('cr-note').value.trim() || null;
      c.api(url + '/' + encodeURIComponent(b.getAttribute('data-cr')) + '/' + encodeURIComponent(b.getAttribute('data-cr-action')), { method: 'POST', body: JSON.stringify({ note: note }) })
        .then(function (j) { c.msg('Change request #' + j.change.id + ' is now ' + j.change.status + '.'); $('cr-note').value = ''; CHG.draw(); })
        .catch(function (e) { if (e && e.code === 'SELF_REVIEW') c.msg('The author of a change request cannot approve or reject it — another committee member decides.', 'errors'); else c.fail(e); });
    });
  }

  return { crSteps: crSteps, changesHtml: changesHtml, mountChanges: mountChanges, teamHtml: teamHtml, mountTeam: mountTeam, pickerOptions: pickerOptions, hoursHtml: hoursHtml, entriesHtml: entriesHtml, mountTime: mountTime };
}));
