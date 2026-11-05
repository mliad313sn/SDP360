'use strict';
// C-21 (G47) — persistence of shift handovers (migration 062). Nothing is deleted; a decision is a single
// conditional UPDATE (status = 'pending' → accepted | refused), so two people deciding at once cannot both win.
const S = require('./shiftHandover');
const { typed } = require('./httpError');

function makeShiftHandoverStore(db, { now = () => new Date().toISOString() } = {}) {
  const P = (sql) => db.prepare(sql);
  const row = (r) => (r ? { ...r, id: Number(r.id), site_id: Number(r.site_id), from_user: Number(r.from_user), to_user: Number(r.to_user), created_by: Number(r.created_by),
    accepted_by: r.accepted_by == null ? null : Number(r.accepted_by), decided_by: r.decided_by == null ? null : Number(r.decided_by), acting_for: r.acting_for == null ? null : Number(r.acting_for),
    items: (() => { try { return JSON.parse(r.items_json || '[]'); } catch (_) { return []; } })() } : null);

  /** Open handoffs at the site where the outgoing person is the receiver — frozen into the snapshot. */
  async function openHandoffsOf(siteId, userId) {
    try {
      const L = require('./handoffLifecycle');
      return (await P(`SELECT id, ref, title, status FROM handoffs WHERE site_id = ? AND receiver_id = ? AND status IN (${L.OPEN.map(() => '?').join(',')}) ORDER BY id LIMIT 50`).all(Number(siteId), Number(userId), ...L.OPEN))
        .map((h) => ({ ref: h.ref || `handoff ${h.id}`, title: String(h.title || '').slice(0, 300), status: h.status, source: 'handoff' }));
    } catch (_) { return []; }   // no handoffs table yet / module off: the listed items stand alone
  }
  async function create(b, { actorId, idemKey = null }) {
    if (idemKey) { const dup = await P('SELECT * FROM shift_handovers WHERE idem_key = ?').get(String(idemKey)); if (dup) return { ...row(dup), replayed: true }; }
    const items = [...S.cleanItems(b.items), ...(await openHandoffsOf(b.site_id, actorId))].slice(0, S.MAX_ITEMS);
    const r = await P(`INSERT INTO shift_handovers (site_id, family, shift_label, from_user, to_user, items_json, notes, status, created_by, created_at, idem_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?) RETURNING *`)
      .get(Number(b.site_id), String(b.family), b.shift_label ? String(b.shift_label).slice(0, 120) : null, Number(actorId), Number(b.to_user), JSON.stringify(items), b.notes ? String(b.notes).slice(0, 4000) : null, Number(actorId), now(), idemKey ? String(idemKey).slice(0, 120) : null);
    return row(r);
  }
  async function get(id) { return row(await P('SELECT * FROM shift_handovers WHERE id = ?').get(Number(id))); }
  /** Handovers of these sites (null = every site) plus those the user gives or receives. */
  async function list({ siteIds = null, userIds = [], limit = 200 } = {}) {
    const where = []; const args = [];
    if (siteIds) { if (siteIds.length) { where.push(`site_id IN (${siteIds.map(() => '?').join(',')})`); args.push(...siteIds.map(Number)); } }
    if (userIds.length) { const q = userIds.map(() => '?').join(','); where.push(`from_user IN (${q}) OR to_user IN (${q})`); args.push(...userIds.map(Number), ...userIds.map(Number)); }
    if (siteIds && !siteIds.length && !userIds.length) return [];
    const w = siteIds == null ? '' : ` WHERE ${where.map((x) => `(${x})`).join(' OR ')}`;
    return (await P(`SELECT * FROM shift_handovers${w} ORDER BY created_at DESC, id DESC LIMIT ${Math.max(1, Math.min(500, Math.floor(Number(limit)) || 200))}`).all(...args)).map(row);
  }
  async function decide(id, { status, actorId, actingFor = null, reason = null }) {
    const t = now();
    const r = status === 'accepted'
      ? await P("UPDATE shift_handovers SET status = 'accepted', accepted_at = ?, accepted_by = ?, decided_at = ?, decided_by = ?, acting_for = ? WHERE id = ? AND status = 'pending'").run(t, Number(actorId), t, Number(actorId), actingFor, Number(id))
      : await P("UPDATE shift_handovers SET status = 'refused', refusal_reason = ?, decided_at = ?, decided_by = ?, acting_for = ? WHERE id = ? AND status = 'pending'").run(String(reason).slice(0, 1000), t, Number(actorId), actingFor, Number(id));
    if (Number(r && r.changes) !== 1) throw typed('CONFLICT', 'this handover was already decided');
    return get(id);
  }
  return { create, get, list, decide };
}

function forRdb(rdb) { return makeShiftHandoverStore({ prepare: (sql) => rdb.pgHandle().prepare(sql), runTransaction: (fn) => rdb.pgHandle().runTransaction(fn) }); }

module.exports = { makeShiftHandoverStore, forRdb };
