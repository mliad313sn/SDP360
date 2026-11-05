'use strict';
// C-22 (G49 · R7) — persistence of emergency (break-glass) access (migration 063). The grant goes through the
// C-18 request / grant path (services/accessStore.js): an access_requests row kind='emergency' with access_grants
// rows, so revoke and expiry behave exactly as for any grant and every step is in the hash-chained
// access_request_events. access_emergencies adds the exact end hour and the mandatory post-review.
// Behind report_config emergency_access_enabled (the routes 404 while it is '0').
const E = require('./emergencyAccess');
const { typed } = require('./httpError');

const toId = (v) => Number(v);
const fail = (c) => { throw typed(c.code, c.error, c.status); };

function makeEmergencyStore(db, rdb, access, { now = () => new Date().toISOString(), getConfig = null, qualifications = null } = {}) {
  if (!db || !rdb || !access) throw new Error('emergencyAccessStore needs a db handle, reports-db and the access store');
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (db.runTransaction ? db.runTransaction(fn) : fn());
  const cfg = async () => { try { return (await (getConfig ? getConfig() : require('./reportConfig').getConfig(rdb.db))) || {}; } catch (_) { return {}; } };
  const knownRoles = () => [...(rdb.ROLE_HIERARCHY || []), ...(rdb.FEATURE_ROLES_KNOWN || [])];
  const log = (action, actorId, target, details) => {
    try { Promise.resolve(rdb.logEvent({ category: 'identity', action, actor: actorId == null ? 'system' : 'user:' + actorId, actor_id: actorId, target: String(target), details, risk: 1 })).catch(() => {}); } catch (_) { /* never blocks */ }
  };
  const row = (e) => (e ? { ...e, id: toId(e.id), request_id: toId(e.request_id), subject_user_id: toId(e.subject_user_id), granted_by: toId(e.granted_by),
    reviewed_by: e.reviewed_by == null ? null : toId(e.reviewed_by), roles: e.roles || [], site_ids: (e.site_ids || []).map(Number) } : null);
  const decorate = (e, t) => ({ ...e, live: E.isLive(e, t) && (!e.request_status || e.request_status === 'ACTIVE'), review_overdue: E.isOverdue(e, t) });

  async function enabled() { return String((await cfg()).emergency_access_enabled || '0') === '1'; }

  async function deputiesOfSubject(subjectId) {
    const t = String(now()).slice(0, 10);
    const rows = await P('SELECT deputy_id FROM deputies WHERE user_id = ? AND revoked_at IS NULL AND start_date <= ? AND end_date >= ?').all(toId(subjectId), t, t);
    return new Set(rows.map((x) => toId(x.deputy_id)));
  }

  /** Capabilities opened by `roles` that declare a qualification the subject does not hold (never waived). */
  async function qualificationUnmet(subject, roles) {
    if (!qualifications || !roles.length) return [];
    const caps = require('./capabilityRegistry').list().filter((c) => (c.legacy || []).some((l) => roles.some((r) => rdb.userHasRole({ roles: [r] }, l))));
    const user = { ...subject, roles: [...new Set([...(subject.roles || []), ...roles])] };
    const out = [];
    for (const c of caps) {
      const d = await qualifications.checkCapability(user, c.id);
      if (!d.allow && String(d.reason_code || '').startsWith('qualification')) out.push({ capability: c.id, reason: d.reason || d.reason_code, required: d.required });
    }
    return out;
  }

  async function grant(body, actor) {
    const c = await cfg();
    const subjectId = Number((body || {}).subject_user_id);
    const v = E.validateGrant(body, { granter: actor, isSuper: !!(actor && rdb.userHasRole(actor, 'super_admin')), deputyIds: Number.isInteger(subjectId) && subjectId > 0 ? await deputiesOfSubject(subjectId) : new Set(),
      knownRoles: knownRoles(), now: now(), maxHours: c.emergency_access_max_hours });
    if (v.error) fail(v.error);
    const q = v.value;
    const subject = ((await rdb.listUsers()) || []).find((u) => toId(u.id) === q.subject_user_id);
    if (!subject || subject.active === 0 || subject.active === false) fail({ status: 400, code: 'VALIDATION', error: 'no active account with this id' });
    const out = await tx(async () => {
      const { requestId, grantIds } = await access.createEmergency(q, { actorId: actor.id });
      const r = await P(`INSERT INTO access_emergencies (request_id, source, subject_user_id, granted_by, reason, roles, site_ids, starts_at, expires_at, review_due, created_at)
        VALUES (?, 'emergency', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
        .get(requestId, q.subject_user_id, toId(actor.id), q.reason, q.roles, q.site_ids, q.starts_at, q.expires_at, q.review_due, now());
      return { id: toId(r.id), request_id: requestId, grant_ids: grantIds };
    });
    const unmet = await qualificationUnmet(subject, q.roles).catch(() => []);
    log('access_emergency_granted', actor.id, subject.username, { emergency_id: out.id, request_id: out.request_id, user_id: q.subject_user_id, roles: q.roles,
      site_ids: q.site_ids, expires_at: q.expires_at, review_due: q.review_due, reason: q.reason, qualification_unmet: unmet });
    return { ...out, expires_at: q.expires_at, review_due: q.review_due, qualification_unmet: unmet };
  }

  /** The C-18 break-glass direct edit, when the switch is on: same emergency record, time-boxed, to be reviewed. */
  async function recordBreakGlass({ subjectId, roles, actor, reason }) {
    const c = await cfg();
    const hours = E.maxHours(c.emergency_access_max_hours);
    const startsAt = now();
    const expiresAt = new Date(Date.parse(startsAt) + hours * 3600e3).toISOString();
    const due = E.addWorkingDays(startsAt);
    return tx(async () => {
      const { requestId, grantIds } = await access.recordDirectEmergency({ subjectId, roles, actorId: actor.id, reason, startsAt, expiresAt });
      const r = await P(`INSERT INTO access_emergencies (request_id, source, subject_user_id, granted_by, reason, roles, site_ids, starts_at, expires_at, review_due, created_at)
        VALUES (?, 'break_glass', ?, ?, ?, ?, '{}', ?, ?, ?, ?) RETURNING id`)
        .get(requestId, toId(subjectId), toId(actor.id), String(reason).slice(0, 2000), roles, startsAt, expiresAt, due, now());
      return { id: toId(r.id), request_id: requestId, grant_ids: grantIds, expires_at: expiresAt, review_due: due };
    });
  }

  async function get(id) {
    const e = row(await P('SELECT e.*, r.status AS request_status FROM access_emergencies e LEFT JOIN access_requests r ON r.id = e.request_id WHERE e.id = ?').get(toId(id)));
    return e ? decorate(e, now()) : null;
  }
  async function list({ overdueOnly = false } = {}) {
    const t = now();
    const rows = (await P('SELECT e.*, r.status AS request_status FROM access_emergencies e LEFT JOIN access_requests r ON r.id = e.request_id ORDER BY e.id DESC LIMIT 500').all()).map(row).map((e) => decorate(e, t));
    return overdueOnly ? rows.filter((e) => e.review_overdue) : rows;
  }

  async function review(id, actor, { outcome, notes } = {}) {
    return tx(async () => {
      const e = row(await P('SELECT * FROM access_emergencies WHERE id = ? FOR UPDATE').get(toId(id)));
      const c = E.reviewCheck(e, actor, { isSuper: !!(actor && rdb.userHasRole(actor, 'super_admin')), outcome, notes }); if (c) fail(c);
      const n = String(notes).trim().slice(0, 2000);
      await P('UPDATE access_emergencies SET reviewed_by = ?, reviewed_at = ?, review_outcome = ?, review_notes = ? WHERE id = ?').run(toId(actor.id), now(), outcome, n, e.id);
      await P('INSERT INTO access_request_events (request_id, action, actor_id, at, details) VALUES (?, ?, ?, ?, ?)')
        .run(e.request_id, 'emergency_reviewed', toId(actor.id), now(), JSON.stringify({ emergency_id: e.id, outcome, notes: n, overdue: E.isOverdue(e, now()) }));
      log('access_emergency_reviewed', actor.id, e.subject_user_id, { emergency_id: e.id, outcome, overdue: E.isOverdue(e, now()) });
      return { id: e.id, outcome };
    });
  }

  /** End every emergency whose hour has come (the request's grants go through the C-18 removal rule). */
  async function expireDue({ actorId = null } = {}) {
    const t = now();
    const due = (await P('SELECT id, request_id, expires_at FROM access_emergencies WHERE ended_at IS NULL ORDER BY id').all()).filter((e) => Date.parse(e.expires_at) <= Date.parse(t));
    let ended = 0;
    for (const e of due) {
      const r = await access.endRequest(e.request_id, { actorId, why: 'emergency_expired' });
      await P("UPDATE access_emergencies SET ended_at = ?, end_reason = 'expired' WHERE id = ? AND ended_at IS NULL").run(now(), toId(e.id));
      if (r.ended) { ended++; log('access_emergency_expired', actorId, e.request_id, { emergency_id: toId(e.id) }); }
    }
    return { ended, rows: ended };
  }

  return { enabled, grant, recordBreakGlass, get, list, review, expireDue, qualificationUnmet };
}

function forRdb(rdb) {
  const h = { prepare: (sql) => rdb.pgHandle().prepare(sql), runTransaction: (fn) => rdb.pgHandle().runTransaction(fn) };
  return makeEmergencyStore(h, rdb, require('./accessStore').forRdb(rdb), { qualifications: require('./qualificationStore').forRdb(rdb) });
}

module.exports = { makeEmergencyStore, forRdb };
