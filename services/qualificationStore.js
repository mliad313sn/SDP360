'use strict';
// C-19 (G41) — persistence of qualification evidence (059). Evidence only: nothing here grants a role, a
// site or a physical authorisation. Every change is logged to system_log category 'identity'.
const Q = require('./qualificationPolicy');
const { typed } = require('./httpError');

const toId = (v) => Number(v);
const fail = (c) => { throw typed(c.code, c.error, c.status); };
const str = (v, max = 500) => { const s = String(v == null ? '' : v).trim(); return s ? s.slice(0, max) : null; };

function makeQualificationStore(db, rdb, { now = () => new Date().toISOString(), getConfig = null } = {}) {
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (db.runTransaction ? db.runTransaction(fn) : fn());
  const today = () => String(now()).slice(0, 10);
  let _cfg = { v: null, at: 0 };   // 30 s cache: the gate sits on field writes
  const cfg = async () => {
    const ttl = Number.isFinite(+process.env.SDP_QUAL_CFG_TTL_MS) ? +process.env.SDP_QUAL_CFG_TTL_MS : 30000;
    if (_cfg.v && Date.now() - _cfg.at < ttl) return _cfg.v;
    try { _cfg = { v: (await (getConfig ? getConfig() : require('./reportConfig').getConfig(rdb.db))) || {}, at: Date.now() }; return _cfg.v; }
    catch (_) { return _cfg.v || {}; }   // unreadable: last good value, else the default ('0' = today)
  };
  const row = (q) => (q ? { ...q, id: toId(q.id), user_id: toId(q.user_id), recorded_by: toId(q.recorded_by), verified_by: q.verified_by == null ? null : toId(q.verified_by) } : null);
  const log = (action, actorId, target, details, risk = 0) => { try { Promise.resolve(rdb.logEvent({ category: 'identity', action, actor: 'user:' + actorId, actor_id: actorId, target: String(target), details, risk })).catch(() => {}); } catch (_) {} };

  async function listKinds({ includeInactive = false } = {}) {
    return P(`SELECT key, name_en, name_fr, active, display_order FROM qualification_kinds ${includeInactive ? '' : 'WHERE active = true'} ORDER BY display_order, key`).all();
  }
  async function upsertKind(key, b, { actorId }) {
    key = String(key || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(key)) fail({ status: 400, code: 'VALIDATION', error: 'key: 2-48 lower-case letters, digits, -' });
    b = b || {};
    if (!str(b.name_en) || !str(b.name_fr)) fail({ status: 400, code: 'VALIDATION', error: 'name_en and name_fr are required' });
    await P(`INSERT INTO qualification_kinds (key, name_en, name_fr, active, display_order, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET name_en = EXCLUDED.name_en, name_fr = EXCLUDED.name_fr, active = EXCLUDED.active, display_order = EXCLUDED.display_order, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`)
      .run(key, str(b.name_en, 120), str(b.name_fr, 120), b.active !== false, Number.isInteger(Number(b.display_order)) ? Number(b.display_order) : 0, toId(actorId), now());
    log('qualification_kind_saved', actorId, key, { active: b.active !== false });
  }
  async function list({ userId = null } = {}) {
    const rows = userId == null ? await P('SELECT * FROM qualification_records ORDER BY id DESC LIMIT 500').all()
      : await P('SELECT * FROM qualification_records WHERE user_id = ? ORDER BY id DESC').all(toId(userId));
    const t = today();
    return rows.map(row).map((q) => ({ ...q, state: Q.stateOf(q, t) }));
  }
  async function get(id) { return row(await P('SELECT * FROM qualification_records WHERE id = ?').get(toId(id))); }

  async function record(b, { actorId }) {
    const kinds = (await listKinds()).map((k) => k.key);
    const v = Q.validateRecord(b, { kinds, today: today() }); if (v.error) fail(v.error);
    const q = v.value;
    const users = (await rdb.listUsers()) || [];
    if (!users.some((u) => toId(u.id) === q.user_id)) fail({ status: 400, code: 'VALIDATION', error: 'no account with this id' });
    const r = await P(`INSERT INTO qualification_records (user_id, kind, issuer, issued_on, expires_on, evidence_ref, notes, recorded_by, recorded_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'recorded') RETURNING id`).get(q.user_id, q.kind, q.issuer, q.issued_on, q.expires_on, q.evidence_ref, q.notes, toId(actorId), now());
    log('qualification_recorded', actorId, r.id, { user_id: q.user_id, kind: q.kind, expires_on: q.expires_on });
    return toId(r.id);
  }

  async function deputyIdsFor(q) {
    const t = today();
    const rows = await P('SELECT deputy_id FROM deputies WHERE user_id IN (?, ?) AND revoked_at IS NULL AND start_date <= ? AND end_date >= ?')
      .all(q.user_id, q.recorded_by, t, t);
    return new Set(rows.map((x) => toId(x.deputy_id)));
  }

  /** verify | reject (from recorded) — SoD: not the holder, not the recorder, not a deputy of either. revoke (from verified). */
  async function decide(id, action, actor, { reason } = {}) {
    if (!['verify', 'reject', 'revoke'].includes(action)) fail({ status: 400, code: 'VALIDATION', error: 'unknown action' });
    if (action !== 'verify' && String(reason || '').trim().length < 5) fail({ status: 400, code: 'VALIDATION', error: 'a reason (5+ characters) is required' });
    const isAdminTier = !!(actor && rdb.userHasRole(actor, 'admin'));
    const me = toId(actor.id);
    return tx(async () => {
      const q = row(await P('SELECT * FROM qualification_records WHERE id = ? FOR UPDATE').get(toId(id)));
      if (action === 'revoke') {
        if (!q) fail({ status: 404, code: 'NOT_FOUND', error: 'qualification record not found' });
        if (!isAdminTier) fail({ status: 403, code: 'FORBIDDEN', error: 'only the admin tier may revoke qualification evidence' });
        if (q.status !== 'verified' && q.status !== 'recorded') fail({ status: 409, code: 'CONFLICT', error: `a ${q.status} record cannot be revoked` });
      } else {
        const c = Q.verifyCheck(q, actor, { isAdminTier, deputyIds: q ? await deputyIdsFor(q) : new Set() }); if (c) fail(c);
      }
      const status = action === 'verify' ? 'verified' : action === 'reject' ? 'rejected' : 'revoked';
      if (action === 'verify') await P("UPDATE qualification_records SET status = 'verified', verified_by = ?, verified_at = ? WHERE id = ?").run(me, now(), q.id);
      else await P('UPDATE qualification_records SET status = ?, status_by = ?, status_at = ?, status_reason = ? WHERE id = ?').run(status, me, now(), str(reason, 1000), q.id);
      log('qualification_' + (action === 'verify' ? 'verified' : action + 'ed'), me, q.id, { user_id: q.user_id, kind: q.kind, reason: str(reason, 300) }, action === 'revoke' ? 1 : 0);
      return { status };
    });
  }

  /**
   * Is `user` allowed `capId` once qualification evidence is taken into account? The role decision comes from
   * authorizationService.can; this only ADDS a denial when qualification_check_enabled='1' and the capability
   * declares required kinds. An unreadable record table while the check is on refuses (error); an unreadable
   * configuration keeps the last value read (never seen = the default, off).
   */
  async function checkCapability(user, capId) {
    const c = await cfg();
    if (String(c.qualification_check_enabled || '0') !== '1') return { allow: true, reason_code: 'check_off', required: [] };
    const required = Q.requirementsFor(capId, c.qualification_requirements);
    if (!required.length) return { allow: true, reason_code: 'no_requirement', required };
    const records = await list({ userId: user.id });
    const d = require('./authorizationService').can(user, capId, { qualification: { enabled: true, required, records, today: today() } });
    return { ...d, required, reason: d.qualification ? d.qualification.reason : null };
  }

  /** Express middleware: refuse 403 with the reason when the check is on and evidence is missing/expired. */
  function gate(capId) {
    const mw = async (req, res, next) => {
      try {
        const d = await checkCapability(req.reportUser || {}, capId);
        if (d.allow || d.reason_code === 'missing_role') return next();   // role gates answer for roles
        const { fail: httpFail } = require('./httpError');
        return httpFail(res, typed('FORBIDDEN', (d.reason || d.reason_code) + ' — SDP360 records evidence only; ask your site HSE owner', 403));
      } catch (e) { const { fail: httpFail } = require('./httpError'); return httpFail(res, e); }
    };
    Object.defineProperty(mw, 'name', { value: 'qualificationGate' });
    return mw;
  }

  return { listKinds, upsertKind, list, get, record, decide, checkCapability, gate };
}

function forRdb(rdb) {
  return makeQualificationStore({ prepare: (sql) => rdb.pgHandle().prepare(sql), runTransaction: (fn) => rdb.pgHandle().runTransaction(fn) }, rdb);
}

module.exports = { makeQualificationStore, forRdb };
