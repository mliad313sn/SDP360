'use strict';
// G-22 — persistence of interdepartmental handoffs (PostgreSQL, db/postgres/reports/026_handoffs.sql).
// Every status change goes through services/handoffLifecycle.check and is guarded by an optimistic
// `version` (stale writer → 409). handoff_events is append-only. Creation is idempotent on
// (requested_by, idem_key): a repeated submit returns the first handoff instead of a duplicate.

const L = require('./handoffLifecycle');
const { typed } = require('./httpError');

const str = (v, max = 4000) => (v == null || v === '' ? null : String(v).slice(0, max));
const day = (v) => { if (v == null || v === '') return null; const d = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw typed('VALIDATION', 'due_date must be YYYY-MM-DD', 400); return d; };
const bad = (m) => typed('VALIDATION', m, 400);

function makeHandoffStore(db, { now = () => new Date().toISOString() } = {}) {
  if (!db) throw new Error('handoffStore needs a db handle');
  const P = (sql) => db.prepare(sql);
  async function init() {}
  const row = (r) => r && ({ ...r, id: Number(r.id), site_id: Number(r.site_id), requested_by: Number(r.requested_by), receiver_id: Number(r.receiver_id),
    delivered_by: r.delivered_by == null ? null : Number(r.delivered_by), verified_by: r.verified_by == null ? null : Number(r.verified_by),
    commitment_id: r.commitment_id == null ? null : Number(r.commitment_id), version: Number(r.version) });
  async function event(hid, actorId, action, from, to, details) {
    await P('INSERT INTO handoff_events (handoff_id, at, actor_id, action, from_status, to_status, details) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(Number(hid), now(), actorId == null ? null : Number(actorId), action, from || null, to || null, details ? JSON.stringify(details) : null);
  }
  async function getRaw(id) { return row(await P('SELECT * FROM handoffs WHERE id=?').get(Number(id))); }
  async function get(id) {
    const h = await getRaw(id); if (!h) return null;
    h.events = (await P('SELECT id, at, actor_id, action, from_status, to_status, details FROM handoff_events WHERE handoff_id=? ORDER BY id').all(h.id))
      .map((e) => ({ ...e, id: Number(e.id), actor_id: e.actor_id == null ? null : Number(e.actor_id), details: e.details ? JSON.parse(e.details) : null }));
    return h;
  }
  // References come from a sequence (migration 029): unique under concurrent creates, never reused.
  async function nextRef(year) {
    const r = await P("SELECT nextval('handoff_ref_seq') AS n").get();
    return `HO-${year}-${String(Number(r.n)).padStart(4, '0')}`;
  }
  const tx = async (fn) => (db.runTransaction ? db.runTransaction(fn) : fn());

  /** d = { title, description, site_id, from_department, to_department, receiver_id, due_date, source_kind, source_ref, commitment_id, idem_key } */
  async function create(d, { user } = {}) {
    d = d || {};
    if (!user || user.id == null) throw typed('NO_USER', 'no user', 401);
    const idem = str(d.idem_key, 80);
    if (idem) { const ex = await P('SELECT id FROM handoffs WHERE requested_by=? AND idem_key=?').get(Number(user.id), idem); if (ex) return { handoff: await get(ex.id), created: false }; }
    if (!str(d.title)) throw bad('title is required');
    if (d.site_id == null || !Number.isInteger(Number(d.site_id))) throw bad('site_id is required');
    if (!str(d.from_department) || !str(d.to_department)) throw bad('from_department and to_department are required');
    if (String(d.from_department).trim().toLowerCase() === String(d.to_department).trim().toLowerCase()) throw bad('a handoff goes to ANOTHER department');
    if (d.receiver_id == null) throw bad('receiver is required');
    if (Number(d.receiver_id) === Number(user.id)) throw bad('the requester cannot be the receiver — nothing is accepted on their behalf');
    const t = now();
    const r = await P(`INSERT INTO handoffs (ref, title, description, site_id, from_department, to_department, requested_by, receiver_id, due_date, status, source_kind, source_ref, commitment_id, idem_key, version, created_at, updated_at, receiver_contact)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT (requested_by, idem_key) DO NOTHING RETURNING id`)
      .run(await nextRef(t.slice(0, 4)), str(d.title, 300), str(d.description), Number(d.site_id), str(d.from_department, 120), str(d.to_department, 120), Number(user.id), Number(d.receiver_id), day(d.due_date),
        str(d.source_kind, 40), str(d.source_ref, 120), d.commitment_id == null || d.commitment_id === '' ? null : Number(d.commitment_id), idem, t, t, str(d.receiver_contact, 120));
    const id = r && (r.id != null ? Number(r.id) : r.lastID != null ? Number(r.lastID) : null);
    if (!id && idem) { const ex = await P('SELECT id FROM handoffs WHERE requested_by=? AND idem_key=?').get(Number(user.id), idem); return { handoff: await get(ex.id), created: false }; }   // concurrent double submit
    if (!id) throw typed('CONFLICT', 'the handoff could not be created — retry', 409);
    await event(id, user.id, 'created', null, 'requested', { receiver_id: Number(d.receiver_id), to_department: str(d.to_department, 120) });
    return { handoff: await get(id), created: true };
  }

  async function bump(h, expectedVersion, sets) {
    if (expectedVersion == null || Number(expectedVersion) !== h.version) throw typed('CONFLICT', `stale version (current ${h.version})`, 409);
    const keys = Object.keys(sets);
    const r = await P(`UPDATE handoffs SET ${keys.map((k) => `${k}=?`).join(', ')}, version=version+1, updated_at=? WHERE id=? AND version=?`).run(...keys.map((k) => sets[k]), now(), h.id, h.version);
    if (!r || Number(r.changes) !== 1) throw typed('CONFLICT', 'the handoff changed meanwhile — reload', 409);
  }

  async function transition(id, to, { actor, expectedVersion, reason, policy } = {}) {
    const h = await getRaw(id); if (!h) throw typed('NOT_FOUND', 'handoff not found', 404);
    const c = L.check(h, to, actor, { reason, policy });
    if (c) throw typed(c.code, c.error, c.status);
    const t = now(), sets = { status: to, last_reason: str(reason, 1000) };
    if (to === 'accepted' && h.status === 'requested') sets.accepted_at = t;
    if (to === 'delivered') { sets.delivered_at = t; sets.delivered_by = Number(actor.id); }
    if (to === 'verified') { sets.verified_at = t; sets.verified_by = Number(actor.id); }
    if (to === 'accepted' && h.status === 'delivered') { sets.delivered_at = null; sets.delivered_by = null; }   // rework
    if (h.status === 'escalated') { sets.escalated_from = null; }
    // the change and its audit event are one unit (audit P1-2); "acting for" is explicit (audit P2-10)
    // ADR-006: a deputy acts in the name of the person they replace; an account-less contact is recorded too
    const side = (L.TRANSITIONS[h.status] || []).find((x) => x.to === to);
    const deputy = side ? L.actingFor(h, actor, side.who) : null;
    const actingFor = deputy || (actor.isAdmin && !L.actsAsRequester(h, actor) && !L.actsAsReceiver(h, actor) ? 'admin_for_requester' : null);
    const contact = side && side.who === 'receiver' && h.receiver_contact ? str(h.receiver_contact, 120) : null;
    await tx(async () => {
      await bump(h, expectedVersion, sets);
      await event(h.id, actor.id, to === 'accepted' && h.status === 'delivered' ? 'rework' : 'transition', h.status, to, reason || actingFor || contact ? { reason: reason ? str(reason, 1000) : undefined, acting_for: actingFor || undefined, on_behalf_of_contact: contact || undefined } : null);
    });
    return get(h.id);
  }

  async function reassign(id, newReceiverId, { actor, expectedVersion, reason, policy } = {}) {
    const h = await getRaw(id); if (!h) throw typed('NOT_FOUND', 'handoff not found', 404);
    const c = L.checkReassign(h, actor, newReceiverId, { reason, policy });
    if (c) throw typed(c.code, c.error, c.status);
    await tx(async () => {
      await bump(h, expectedVersion, { receiver_id: Number(newReceiverId), status: 'requested', accepted_at: null, escalated_from: null, last_reason: str(reason, 1000) });
      await event(h.id, actor.id, 'reassigned', h.status, 'requested', { from_receiver: h.receiver_id, to_receiver: Number(newReceiverId), reason: str(reason, 1000), acting_for: L.actingFor(h, actor, 'requester') || undefined });
    });
    return get(h.id);
  }

  /** Escalate every overdue open handoff once. Returns the escalated rows. */
  /** policyFor(siteId) → resolved policy (per-site switch and grace). Absent → defaults.
   *  targetFor(h, overdueDays) → { role, targets, gap } from the escalation matrix (ADR-006); recorded on the event. */
  async function escalateOverdue({ today, policyFor = null, targetFor = null } = {}) {
    const d = String(today || now()).slice(0, 10);
    // escalated ONCE per due date: a handoff resumed after an escalation is not re-escalated every hour (QA P1-2);
    // a new due date (moved by reassignment or agreement) can escalate again.
    const rows = (await P(`SELECT * FROM handoffs WHERE status IN ('requested','accepted','blocked') AND due_date IS NOT NULL AND due_date < ? AND (escalated_for_due IS NULL OR escalated_for_due <> due_date)`).all(d)).map(row);
    const out = [];
    const bySite = new Map(); for (const h of rows) { if (!bySite.has(h.site_id)) bySite.set(h.site_id, []); bySite.get(h.site_id).push(h); }
    const due = []; const pols = new Map();
    const WC = require('./workCalendar');
    const polOf = async (sid) => { if (!pols.has(sid)) pols.set(sid, policyFor ? await policyFor(sid) : null); return pols.get(sid); };
    for (const [sid, list] of bySite) due.push(...L.overdue(list, d, await polOf(sid)));
    for (const h of due) {
      const overdueDays = WC.workingDaysAfter(h.due_date, d, await polOf(h.site_id));   // working days (committee #40)
      let esc = null;
      if (targetFor) { try { esc = await targetFor(h, overdueDays); } catch (_) { esc = null; } }
      const ok = await tx(async () => {
        const r = await P(`UPDATE handoffs SET status='escalated', escalated_from=?, escalated_at=?, escalated_for_due=due_date, version=version+1, updated_at=? WHERE id=? AND version=?`).run(h.status, now(), now(), h.id, h.version);
        if (Number(r && r.changes) !== 1) return false;
        await event(h.id, null, 'escalated_overdue', h.status, 'escalated', { due_date: h.due_date, overdue_days: overdueDays,
          ...(esc && esc.role ? { escalated_to_role: esc.role, escalated_to: esc.targets, matrix_id: esc.matched && esc.matched.id, no_holder: esc.gap || undefined } : {}) });
        return true;
      });
      if (ok) out.push({ ...h, escalated_from: h.status, status: 'escalated', overdue_days: overdueDays, escalation: esc });
    }
    // ADR-006 levels: a handoff still escalated reaches the NEXT matrix level when its days overdue cross it
    // (e.g. site target after 1 day, group after 3). Each level is raised once (event 'escalation_level').
    if (targetFor) {
      const still = (await P(`SELECT * FROM handoffs WHERE status='escalated' AND due_date IS NOT NULL AND due_date < ?`).all(d)).map(row);
      for (const h of still) {
        const overdueDays = WC.workingDaysAfter(h.due_date, d, await polOf(h.site_id));
        let esc = null; try { esc = await targetFor(h, overdueDays); } catch (_) { esc = null; }
        if (!esc || !esc.matched) continue;
        const seen = (await P(`SELECT details FROM handoff_events WHERE handoff_id=? AND action IN ('escalated_overdue','escalation_level')`).all(h.id))
          .map((e) => { try { return JSON.parse(e.details || '{}').matrix_id; } catch (_) { return null; } }).filter((x) => x != null).map(Number);
        if (seen.includes(Number(esc.matched.id))) continue;
        await event(h.id, null, 'escalation_level', 'escalated', 'escalated', { overdue_days: overdueDays, escalated_to_role: esc.role, escalated_to: esc.targets, matrix_id: esc.matched.id, no_holder: esc.gap || undefined });
        out.push({ ...h, overdue_days: overdueDays, escalation: esc, level_raised: true });
      }
    }
    return out;
  }

  /** siteIds null = all (admin); otherwise the user's sites OR where they are requester / receiver. */
  async function list({ siteIds = null, userId = null, userIds = [], status = null, limit = 500 } = {}) {
    const where = [], args = [];
    if (Array.isArray(siteIds)) {
      const parts = [];
      if (siteIds.length) { parts.push(`site_id IN (${siteIds.map(() => '?').join(',')})`); args.push(...siteIds.map(Number)); }
      // the user's own handoffs, and those of the people they stand in for today (ADR-006)
      const people = [...new Set([userId, ...(userIds || [])].filter((x) => x != null).map(Number))];
      if (people.length) { const q = people.map(() => '?').join(','); parts.push(`requested_by IN (${q}) OR receiver_id IN (${q})`); args.push(...people, ...people); }
      if (!parts.length) return [];
      where.push(`(${parts.join(' OR ')})`);
    }
    if (status) { const st = String(status).split(',').filter((s) => L.STATUSES.includes(s)); if (st.length) { where.push(`status IN (${st.map(() => '?').join(',')})`); args.push(...st); } }
    return (await P(`SELECT * FROM handoffs${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${Math.max(1, Math.min(2000, Math.floor(Number(limit)) || 500))}`).all(...args)).map(row);
  }

  /** Committee #39 — link the handoff to the commitment that records it in the ledger (once). */
  async function setCommitment(id, commitmentId, actorId) {
    return tx(async () => {
      const r = await P('UPDATE handoffs SET commitment_id=?, updated_at=? WHERE id=? AND commitment_id IS NULL').run(Number(commitmentId), now(), Number(id));
      if (Number(r && r.changes) === 1) await event(id, actorId, 'ledger_linked', null, null, { commitment_id: Number(commitmentId) });
      return Number(r && r.changes) === 1;
    });
  }
  return { init, create, get, getRaw, transition, reassign, escalateOverdue, list, setCommitment };
}

module.exports = { makeHandoffStore };
