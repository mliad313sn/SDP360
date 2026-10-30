'use strict';
// ADR-006 — persistence of role assignments, deputies and the escalation matrix (migration 035).
// Nothing is ever deleted: an assignment is ended, a deputy revoked, a matrix row retired; every change
// is written to governance_role_events (append-only, hash-chained) in the same transaction.
const R = require('./governanceRoles');
const { typed } = require('./httpError');

const str = (v, max = 1000) => (v == null || v === '' ? null : String(v).slice(0, max));
const n = (v) => (v == null || v === '' ? null : Number(v));

function makeGovernanceRolesStore(db, { now = () => new Date().toISOString() } = {}) {
  if (!db) throw new Error('governanceRolesStore needs a db handle');
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (db.runTransaction ? db.runTransaction(fn) : fn());
  const fail = (c) => { throw typed(c.code, c.error, c.status); };
  async function event(entity, id, action, actorId, details) {
    await P('INSERT INTO governance_role_events (entity, entity_id, action, actor_id, at, details) VALUES (?, ?, ?, ?, ?, ?)')
      .run(entity, id == null ? null : Number(id), action, actorId == null ? null : Number(actorId), now(), details ? JSON.stringify(details) : null);
  }
  const ids = (rows) => rows.map((r) => ({ ...r, id: Number(r.id) }));

  async function snapshot() {
    const [assignments, deputies, matrix] = await Promise.all([
      P('SELECT * FROM role_assignments ORDER BY role, site_id NULLS FIRST, id').all(),
      P('SELECT * FROM deputies ORDER BY start_date DESC, id DESC').all(),
      P('SELECT * FROM escalation_matrix ORDER BY register, site_id NULLS FIRST, after_days, id').all(),
    ]);
    return { assignments: ids(assignments), deputies: ids(deputies), matrix: ids(matrix) };
  }

  async function assign(b, { actorId }) {
    const c = R.validateAssignment(b); if (c) fail(c);
    return tx(async () => {
      const r = await P('INSERT INTO role_assignments (role, site_id, user_id, effective_from, effective_to, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
        .get(b.role, n(b.site_id), Number(b.user_id), b.effective_from, str(b.effective_to, 10), str(b.reason), n(actorId), now());
      await event('role_assignment', r.id, 'assigned', actorId, { role: b.role, site_id: n(b.site_id), user_id: Number(b.user_id), from: b.effective_from, to: str(b.effective_to, 10), reason: str(b.reason) });
      return Number(r.id);
    });
  }
  async function endAssignment(id, { actorId, reason }) {
    if (String(reason || '').trim().length < 5) fail({ status: 400, code: 'VALIDATION', error: 'a reason (5+ characters) is required' });
    return tx(async () => {
      const r = await P('UPDATE role_assignments SET ended_by=?, ended_at=? WHERE id=? AND ended_at IS NULL').run(n(actorId), now(), Number(id));
      if (Number(r && r.changes) !== 1) fail({ status: 404, code: 'NOT_FOUND', error: 'assignment not found or already ended' });
      await event('role_assignment', id, 'ended', actorId, { reason: str(reason) });
    });
  }
  async function addDeputy(b, { actorId }) {
    const c = R.validateDeputy(b); if (c) fail(c);
    return tx(async () => {
      const r = await P('INSERT INTO deputies (user_id, deputy_id, start_date, end_date, reason, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
        .get(Number(b.user_id), Number(b.deputy_id), b.start_date, b.end_date, str(b.reason), n(actorId), now());
      await event('deputy', r.id, 'named', actorId, { user_id: Number(b.user_id), deputy_id: Number(b.deputy_id), from: b.start_date, to: b.end_date, reason: str(b.reason) });
      return Number(r.id);
    });
  }
  async function revokeDeputy(id, { actorId, reason }) {
    if (String(reason || '').trim().length < 5) fail({ status: 400, code: 'VALIDATION', error: 'a reason (5+ characters) is required' });
    return tx(async () => {
      const r = await P('UPDATE deputies SET revoked_by=?, revoked_at=? WHERE id=? AND revoked_at IS NULL').run(n(actorId), now(), Number(id));
      if (Number(r && r.changes) !== 1) fail({ status: 404, code: 'NOT_FOUND', error: 'deputy not found or already revoked' });
      await event('deputy', id, 'revoked', actorId, { reason: str(reason) });
    });
  }
  async function addMatrixRow(b, { actorId }) {
    const c = R.validateMatrix(b); if (c) fail(c);
    return tx(async () => {
      const r = await P('INSERT INTO escalation_matrix (register, severity, site_id, after_days, role, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
        .get(b.register, String(b.severity || '*').toLowerCase(), n(b.site_id), Number(b.after_days || 0), b.role, str(b.reason), n(actorId), now());
      await event('escalation_matrix', r.id, 'added', actorId, { register: b.register, severity: String(b.severity || '*').toLowerCase(), site_id: n(b.site_id), after_days: Number(b.after_days || 0), role: b.role, reason: str(b.reason) });
      return Number(r.id);
    });
  }
  async function retireMatrixRow(id, { actorId, reason }) {
    if (String(reason || '').trim().length < 5) fail({ status: 400, code: 'VALIDATION', error: 'a reason (5+ characters) is required' });
    return tx(async () => {
      const r = await P('UPDATE escalation_matrix SET retired_by=?, retired_at=? WHERE id=? AND retired_at IS NULL').run(n(actorId), now(), Number(id));
      if (Number(r && r.changes) !== 1) fail({ status: 404, code: 'NOT_FOUND', error: 'rule not found or already retired' });
      await event('escalation_matrix', id, 'retired', actorId, { reason: str(reason) });
    });
  }
  async function events(limit = 200) {
    return (await P(`SELECT id, entity, entity_id, action, actor_id, at, details FROM governance_role_events ORDER BY id DESC LIMIT ${Math.max(1, Math.min(1000, Math.floor(Number(limit)) || 200))}`).all())
      .map((e) => ({ ...e, id: Number(e.id), entity_id: e.entity_id == null ? null : Number(e.entity_id), details: e.details ? JSON.parse(e.details) : null }));
  }

  // committee #40 — holiday / shutdown days (site_calendar, migration 037)
  async function calendar({ from = null } = {}) {
    const rows = from ? await P('SELECT * FROM site_calendar WHERE removed_at IS NULL AND day >= ? ORDER BY day, site_id NULLS FIRST').all(from)
      : await P('SELECT * FROM site_calendar WHERE removed_at IS NULL ORDER BY day, site_id NULLS FIRST').all();
    return ids(rows);
  }
  async function addCalendarDay(b, { actorId, maxPerYear = null }) {
    const day = String(b.day || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day + 'T00:00:00Z'))) fail({ status: 400, code: 'VALIDATION', error: 'day must be YYYY-MM-DD' });
    const kind = String(b.kind || 'holiday'); if (!['holiday', 'shutdown'].includes(kind)) fail({ status: 400, code: 'VALIDATION', error: 'kind must be holiday or shutdown' });
    if (String(b.label || '').trim().length < 3) fail({ status: 400, code: 'VALIDATION', error: 'name the day (3+ characters)' });
    if (String(b.reason || '').trim().length < 5) fail({ status: 400, code: 'VALIDATION', error: 'a reason (5+ characters) is required — a listed day pauses the overdue rules' });
    const sid = b.site_id == null || b.site_id === '' ? null : Number(b.site_id);
    if (sid != null && (!Number.isInteger(sid) || sid <= 0)) fail({ status: 400, code: 'VALIDATION', error: 'site_id must be a site id or empty (whole platform)' });
    return tx(async () => {
      // security review: a calendar day silently relaxes escalation — cap the days a site (or the platform)
      // gets per calendar year unless the caller is allowed more (super_admin)
      if (maxPerYear != null) {
        const y = day.slice(0, 4);
        const c = await P("SELECT COUNT(*) AS n FROM site_calendar WHERE removed_at IS NULL AND COALESCE(site_id, 0) = ? AND day >= ? AND day <= ?").get(sid == null ? 0 : sid, y + '-01-01', y + '-12-31');
        if (Number(c && c.n) >= maxPerYear) fail({ status: 409, code: 'CALENDAR_LIMIT', error: `at most ${maxPerYear} days per site and per year — a longer shutdown is a super_admin decision` });
      }
      const dup = await P('SELECT id FROM site_calendar WHERE removed_at IS NULL AND COALESCE(site_id, 0) = ? AND day = ?').get(b.site_id == null || b.site_id === '' ? 0 : Number(b.site_id), day);
      if (dup) fail({ status: 409, code: 'CONFLICT', error: 'this day is already in the calendar' });
      const r = await P('INSERT INTO site_calendar (site_id, day, kind, label, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id').get(n(b.site_id), day, kind, str(b.label, 120), n(actorId), now());
      await event('calendar', r.id, 'added', actorId, { site_id: n(b.site_id), day, kind, label: str(b.label, 120), reason: str(b.reason) });
      return Number(r.id);
    });
  }
  async function removeCalendarDay(id, { actorId, reason }) {
    if (String(reason || '').trim().length < 5) fail({ status: 400, code: 'VALIDATION', error: 'a reason (5+ characters) is required' });
    return tx(async () => {
      const r = await P('UPDATE site_calendar SET removed_by=?, removed_at=? WHERE id=? AND removed_at IS NULL').run(n(actorId), now(), Number(id));
      if (Number(r && r.changes) !== 1) fail({ status: 404, code: 'NOT_FOUND', error: 'day not found or already removed' });
      await event('calendar', id, 'removed', actorId, { reason: str(reason) });
    });
  }
  /** History version: moves on every change (callers re-read their snapshot when it moves). */
  async function version() { const r = await P('SELECT COALESCE(MAX(id), 0) AS v FROM governance_role_events').get(); return Number(r && r.v) || 0; }
  /** People a deputy stands in for today (used by the lifecycles). */
  async function principalsOf(userId, today) { return R.principalsOf((await snapshot()).deputies, userId, today || now()); }
  /** Escalation target + targets' ids for one overdue item. */
  async function escalationTarget(q) { return R.escalationTarget(await snapshot(), { today: now(), ...q }); }

  return { version, calendar, addCalendarDay, removeCalendarDay, snapshot, assign, endAssignment, addDeputy, revokeDeputy, addMatrixRow, retireMatrixRow, events, principalsOf, escalationTarget };
}

module.exports = { makeGovernanceRolesStore };
