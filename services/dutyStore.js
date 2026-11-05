'use strict';
// C-20 (G44 · R9) — persistence of duty families, coverage policies and roster shifts (migration 061).
// Nothing is deleted: a removed shift keeps its row (removed_at). A shift is unique while live
// (site × family × user × start × end), so a re-imported CSV inserts nothing new (idempotent).
const C = require('./dutyCoverage');
const { typed } = require('./httpError');

function makeDutyStore(db, { now = () => new Date().toISOString() } = {}) {
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (db.runTransaction ? db.runTransaction(fn) : fn());
  const num = (r) => ({ ...r, id: r.id == null ? undefined : Number(r.id), site_id: Number(r.site_id), user_id: r.user_id == null ? undefined : Number(r.user_id) });

  async function families() { return P('SELECT key, title_en, title_fr FROM duty_families WHERE active = 1 ORDER BY key').all(); }
  async function policies() { return (await P('SELECT * FROM duty_coverage_policy').all()).map(num); }
  async function setPolicy(siteId, family, body, actorId) {
    const v = C.validatePolicy(body); if (v.error) throw typed('VALIDATION', v.error);
    if (!(await families()).some((f) => f.key === family)) throw typed('VALIDATION', `unknown duty family "${family}"`);
    const p = v.value;
    await P(`INSERT INTO duty_coverage_policy (site_id, family, mode, min_people, shift_start, shift_hours, business_start, business_end, business_days, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (site_id, family) DO UPDATE SET mode = EXCLUDED.mode, min_people = EXCLUDED.min_people,
      shift_start = EXCLUDED.shift_start, shift_hours = EXCLUDED.shift_hours, business_start = EXCLUDED.business_start, business_end = EXCLUDED.business_end,
      business_days = EXCLUDED.business_days, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`)
      .run(Number(siteId), family, p.mode, p.min_people, p.shift_start, p.shift_hours, p.business_start, p.business_end, p.business_days, actorId, now());
    return p;
  }
  /** Live shifts of these sites overlapping [from, to). */
  async function shifts(siteIds, from, to) {
    if (!siteIds.length) return [];
    const q = siteIds.map(() => '?').join(',');
    return (await P(`SELECT id, site_id, family, user_id, starts_at, ends_at, source, imported_by, created_by, created_at FROM duty_roster_shifts
      WHERE removed_at IS NULL AND site_id IN (${q}) AND ends_at > ? AND starts_at < ? ORDER BY site_id, family, starts_at`).all(...siteIds.map(Number), from, to)).map(num);
  }
  /** Period each site × family roster was entered for (all live rows) — outside it, coverage is unknown. */
  async function extents(siteIds) {
    if (!siteIds.length) return [];
    const q = siteIds.map(() => '?').join(',');
    return (await P(`SELECT site_id, family, MIN(starts_at) AS data_from, MAX(ends_at) AS data_to FROM duty_roster_shifts
      WHERE removed_at IS NULL AND site_id IN (${q}) GROUP BY site_id, family`).all(...siteIds.map(Number))).map(num);
  }
  async function insertShift(s, { actorId, source = 'manual' }) {
    const r = await P(`INSERT INTO duty_roster_shifts (site_id, family, user_id, starts_at, ends_at, source, imported_by, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (site_id, family, user_id, starts_at, ends_at) WHERE removed_at IS NULL DO NOTHING RETURNING id`)
      .get(s.site_id, s.family, s.user_id, s.starts_at, s.ends_at, source, source === 'csv' ? actorId : null, actorId, now());
    return r ? Number(r.id) : null;
  }
  async function addShift(s, actorId) { return insertShift(s, { actorId, source: 'manual' }); }
  async function getShift(id) { const r = await P('SELECT * FROM duty_roster_shifts WHERE id = ?').get(Number(id)); return r ? num(r) : null; }
  async function removeShift(id, actorId) {
    const r = await P('UPDATE duty_roster_shifts SET removed_at = ?, removed_by = ? WHERE id = ? AND removed_at IS NULL').run(now(), actorId, Number(id));
    if (Number(r && r.changes) !== 1) throw typed('NOT_FOUND', 'shift not found or already removed');
  }
  /** Idempotent commit of parsed CSV rows: { inserted, already } in one transaction. */
  async function importRows(rows, actorId) {
    return tx(async () => {
      let inserted = 0;
      for (const r of rows) if (await insertShift(r, { actorId, source: 'csv' })) inserted++;
      return { inserted, already: rows.length - inserted };
    });
  }
  /** Account state for the eligibility rule: active ids + each person's sites (null = admin tier, every site). */
  async function accountState() {
    const [users, extra, tier] = await Promise.all([
      P('SELECT id, active, site_id, role FROM users').all(),
      P('SELECT user_id, site_id FROM user_sites').all(),
      P("SELECT user_id FROM user_roles WHERE role IN ('super_admin','executive','admin')").all(),
    ]);
    const admin = new Set(tier.map((r) => Number(r.user_id)));
    for (const u of users) if (['super_admin', 'executive', 'admin'].includes(u.role)) admin.add(Number(u.id));
    const sites = new Map(users.map((u) => [Number(u.id), u.site_id == null ? [] : [Number(u.site_id)]]));
    for (const x of extra) { const l = sites.get(Number(x.user_id)); if (l) l.push(Number(x.site_id)); }
    const active = new Set(users.filter((u) => Number(u.active) === 1 || u.active === true).map((u) => Number(u.id)));
    return { active, sitesOf: (id) => (admin.has(Number(id)) ? null : (sites.get(Number(id)) || [])) };
  }
  async function users() { return P('SELECT id, username, email FROM users').all(); }
  async function calendar() { return P('SELECT site_id, day FROM site_calendar WHERE removed_at IS NULL').all(); }

  return { families, policies, setPolicy, shifts, extents, addShift, getShift, removeShift, importRows, accountState, users, calendar };
}

function forRdb(rdb) {
  return makeDutyStore({ prepare: (sql) => rdb.pgHandle().prepare(sql), runTransaction: (fn) => rdb.pgHandle().runTransaction(fn) });
}

module.exports = { makeDutyStore, forRdb };
