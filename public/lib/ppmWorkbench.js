/* R2-WORKBENCH (REBUILD-SPEC R5) — project page add-ons, each shown only while its PROPOSED switch is on
   (GET /api/governance/ppm/features). UMD: loaded by project.html, required by tests. The *Html functions are PURE
   (esc = the page's HTML escaper; every value goes through it, "—" = not known, never 0); mount* wire a panel.
   R2-WB-04 teamHtml(members) — the project team (name, user link, role, allocation, window). */
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
        return '<tr><td>' + esc(m.label) + '</td><td>' + (m.user_id != null ? n(m.username || ('#' + m.user_id), esc) : '<span class="muted">not linked</span>') + '</td><td>' + n(m.role, esc) + '</td><td>' + (m.allocation_pct == null ? '<span class="muted">unknown</span>' : n(m.allocation_pct, esc, ' %')) + '</td><td>' + n(m.from_day, esc) + '</td><td>' + n(m.to_day, esc) + '</td>' +
          (canEdit ? '<td><button class="btn" type="button" data-team-edit="' + esc(String(m.id)) + '">Edit</button> <button class="btn danger" type="button" data-team-del="' + esc(String(m.id)) + '">Remove</button></td>' : '') + '</tr>';
      }).join('') + '</tbody></table><p class="muted">A task whose allocation is not entered is read at its owner\'s allocation to the project (when the owner is a member); an entered allocation always wins.</p>';
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
    if ($('team-save').getAttribute('data-wired')) return;
    $('team-save').setAttribute('data-wired', '1');
    var field = function (id) { var v = $(id).value.trim(); return v === '' ? null : v; };
    $('team-save').addEventListener('click', function () {
      var b = { id: field('tm-id') ? Number(field('tm-id')) : undefined, label: field('tm-label'), role: field('tm-role'), allocation_pct: field('tm-alloc') == null ? null : Number(field('tm-alloc')), from_day: field('tm-from'), to_day: field('tm-to'), user_id: field('tm-user') == null ? null : Number(field('tm-user')) };
      ctx.api(url, { method: 'PUT', body: JSON.stringify(b) }).then(function (j) { ctx.msg('Team member saved.'); draw(j.members); ['tm-id', 'tm-label', 'tm-role', 'tm-alloc', 'tm-from', 'tm-to', 'tm-user'].forEach(function (k) { $(k).value = ''; }); }).catch(ctx.fail);
    });
    $('team').addEventListener('click', function (ev) {
      var e = ev.target.closest && ev.target.closest('[data-team-edit]'), d = ev.target.closest && ev.target.closest('[data-team-del]');
      if (e) { var m = TEAM.members.filter(function (x) { return String(x.id) === e.getAttribute('data-team-edit'); })[0]; if (!m) return;
        $('tm-id').value = m.id; $('tm-label').value = m.label || ''; $('tm-role').value = m.role || ''; $('tm-alloc').value = m.allocation_pct == null ? '' : m.allocation_pct; $('tm-from').value = m.from_day || ''; $('tm-to').value = m.to_day || ''; $('tm-user').value = m.user_id == null ? '' : m.user_id; }
      if (d) ctx.api(url + '/' + encodeURIComponent(d.getAttribute('data-team-del')), { method: 'DELETE' }).then(function (j) { ctx.msg('Team member removed.'); draw(j.members); }).catch(ctx.fail);
    });
  }

  return { teamHtml: teamHtml, mountTeam: mountTeam };
}));
