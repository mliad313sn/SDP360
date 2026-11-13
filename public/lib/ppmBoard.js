/* PPM parity W4 — agile board mapped to work packages (PURE + a small HTML renderer; UMD for the page and the tests).
 *
 * A work package = a LEAF task of the WBS (a task with no child). Summary tasks are not cards: their status rolls up
 * from the plan, so they only label the swimlane of their children (top-level ancestor). Columns = the task statuses
 * the server accepts (todo · in_progress · blocked · done · cancelled); an unknown status lands in "other", never
 * silently in "todo". Moving a card is the EXISTING task update (PUT /api/governance/portfolio/task) with the row
 * version read with the plan: {id, status, version} — a 409 STALE_VERSION means someone saved in between.
 * Who may move (presentation only — the server decides): the committee / a plan editor any card, a pm or scheduler
 * project role any card, a contributor only the cards of tasks they own.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PpmBoard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var COLUMNS = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'];
  var LABELS = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled', other: 'Other status' };

  function leafTasks(tasks) {
    var parents = {};
    (tasks || []).forEach(function (t) { if (t.parent_id != null) parents[t.parent_id] = 1; });
    return (tasks || []).filter(function (t) { return !parents[t.id]; });
  }
  function topAncestor(t, byId) {
    var cur = t, seen = {};
    while (cur && cur.parent_id != null && byId[cur.parent_id] && !seen[cur.id]) { seen[cur.id] = 1; cur = byId[cur.parent_id]; }
    return cur === t ? null : cur;
  }
  /** { columns: [{key, label, cards:[...] }], other: [...] } — cards ordered by WBS then id. */
  function board(tasks) {
    var byId = {};
    (tasks || []).forEach(function (t) { byId[t.id] = t; });
    var cols = {}; COLUMNS.forEach(function (c) { cols[c] = []; }); var other = [];
    var cmp = function (a, b) { return String(a.wbs_code || '').localeCompare(String(b.wbs_code || ''), undefined, { numeric: true }) || a.id - b.id; };
    leafTasks(tasks).sort(cmp).forEach(function (t) {
      var lane = topAncestor(t, byId);
      var card = { id: t.id, name: t.name, wbs_code: t.wbs_code || null, owner: t.owner || null, status: t.status || null,
        progress_pct: t.progress_pct == null || t.progress_pct === '' ? null : Number(t.progress_pct), version: t.version == null ? null : Number(t.version),
        lane: lane ? [lane.wbs_code, lane.name].filter(Boolean).join(' ') : null };
      if (cols[t.status]) cols[t.status].push(card); else other.push(card);
    });
    return { columns: COLUMNS.map(function (k) { return { key: k, label: LABELS[k], cards: cols[k] }; }), other: other };
  }
  function norm(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  /** Does this user own the task (owner text = username, full name or e-mail)? */
  function owns(card, user) {
    var o = norm(card && card.owner); if (!o || !user) return false;
    return [user.username, user.full_name, user.email].map(norm).filter(Boolean).indexOf(o) >= 0;
  }
  /** ctx: { canEditPlan, committee, projectRole, user } */
  function canMove(card, ctx) {
    ctx = ctx || {};
    if (ctx.committee) return true;
    if (ctx.projectRole) {
      if (ctx.projectRole === 'pm' || ctx.projectRole === 'scheduler') return true;
      return ctx.projectRole === 'contributor' && owns(card, ctx.user);
    }
    return !!ctx.canEditPlan;
  }
  /** The body of the existing task update for a move, or null when nothing changes / the column is unknown. */
  function movePayload(card, to) {
    if (!card || COLUMNS.indexOf(to) < 0 || card.status === to) return null;
    var b = { id: card.id, status: to };
    if (card.version != null) b.version = card.version;
    return b;
  }
  function cardHtml(c, esc, movable) {
    var opts = COLUMNS.map(function (k) { return '<option value="' + k + '"' + (k === c.status ? ' selected' : '') + '>' + esc(LABELS[k]) + '</option>'; }).join('');
    return '<li class="pb-card" data-task="' + esc(String(c.id)) + '"' + (movable ? ' draggable="true"' : '') + '>' +
      '<div class="pb-name">' + esc([c.wbs_code, c.name].filter(Boolean).join(' ')) + '</div>' +
      (c.lane ? '<div class="pb-lane">' + esc(c.lane) + '</div>' : '') +
      '<div class="pb-meta">' + esc(c.owner || '—') + ' · ' + esc(c.progress_pct == null ? '—' : c.progress_pct + ' %') + '</div>' +
      (movable ? '<label class="pb-move">Move to <select data-move="' + esc(String(c.id)) + '" aria-label="Move this task to another column">' + opts + '</select></label>' : '') + '</li>';
  }
  function html(b, esc, ctx) {
    var col = function (key, label, cards) {
      return '<section class="pb-col" data-col="' + key + '" aria-label="' + esc(label) + '"><h3>' + esc(label) + ' <span class="muted">' + cards.length + '</span></h3><ul class="pb-list">' +
        cards.map(function (c) { return cardHtml(c, esc, canMove(c, ctx)); }).join('') + '</ul></section>';
    };
    var out = b.columns.map(function (c) { return col(c.key, c.label, c.cards); }).join('');
    if (b.other.length) out += col('other', LABELS.other, b.other);
    return '<div class="pb-board">' + out + '</div>';
  }
  return { COLUMNS: COLUMNS, LABELS: LABELS, leafTasks: leafTasks, board: board, owns: owns, canMove: canMove, movePayload: movePayload, html: html };
});
