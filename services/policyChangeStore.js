'use strict';
// Policy Control Center — four-eyes requests for high-risk report_config rules (migration 120).
// A super_admin requests; ANOTHER super_admin approves or rejects (same person refused, by id AND by normalised
// identity — services/commitmentLifecycle.identityKey, so "J.Doe" / "j.doe " / a confusable spelling is one person).
// A request lapses after `days` days. Approving re-checks that the stored value is still the one the request saw.
const { typed } = require('./httpError');
const { identityKey } = require('./commitmentLifecycle');

const STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'expired', 'stale'];

function makePolicyChangeStore(handle, { now = () => new Date().toISOString(), days = 7 } = {}) {
  const Q = (sql) => handle().prepare(sql);
  const row = (r) => r && ({ ...r, id: Number(r.id), requested_by: Number(r.requested_by), decided_by: r.decided_by == null ? null : Number(r.decided_by) });
  async function expireOld() { await Q("UPDATE policy_change_requests SET status='expired' WHERE status='pending' AND expires_at <= ?").run(now()); }
  async function list({ status = 'pending', key = null, limit = 200 } = {}) {
    await expireOld();
    const c = [], p = [];
    if (status) { c.push('status = ?'); p.push(status); }
    if (key) { c.push('key = ?'); p.push(key); }
    const lim = Math.max(1, Math.min(500, Number(limit) || 200));
    return ((await Q(`SELECT * FROM policy_change_requests ${c.length ? 'WHERE ' + c.join(' AND ') : ''} ORDER BY id DESC LIMIT ${lim}`).all(...p)) || []).map(row);
  }
  async function get(id) { await expireOld(); return row(await Q('SELECT * FROM policy_change_requests WHERE id = ?').get(Number(id))); }
  async function pendingFor(key, scope = 'global') { await expireOld(); return row(await Q("SELECT * FROM policy_change_requests WHERE key=? AND scope=? AND status='pending'").get(key, scope)); }
  async function create({ key, scope = 'global', oldValue, newValue, reason, actor }) {
    const why = String(reason || '').trim();
    if (why.length < 10) throw typed('VALIDATION', 'a high-risk change needs a reason (10+ characters)', 400);
    if (await pendingFor(key, scope)) throw typed('CONFLICT', `a change of ${key} is already awaiting approval`, 409);
    const t = now(); const exp = new Date(Date.parse(t) + days * 864e5).toISOString();
    const r = await Q('INSERT INTO policy_change_requests (key, scope, old_value, new_value, reason, requested_by, requested_by_name, requested_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .run(key, scope, oldValue == null ? null : String(oldValue), newValue == null ? null : String(newValue), why.slice(0, 1000), Number(actor.id), String(actor.username || actor.name || ''), t, exp);
    return get(r.lastID);
  }
  const samePerson = (req, actor) => Number(req.requested_by) === Number(actor.id)
    || (!!identityKey(req.requested_by_name) && [actor.username, actor.email, actor.name].map(identityKey).includes(identityKey(req.requested_by_name)));
  /**
   * decision: 'approve' | 'reject' | 'cancel'. apply(req) is called for an approval (inside nothing — the caller's
   * setConfig is its own transaction); currentValue(req.key) guards against a value changed since the request.
   */
  async function decide(id, decision, { actor, reason, currentValue, apply } = {}) {
    const req = await get(id);
    if (!req) throw typed('NOT_FOUND', 'request not found', 404);
    if (req.status !== 'pending') throw typed('CONFLICT', `request is ${req.status}`, 409);
    const why = String(reason || '').trim();
    if (decision === 'cancel') {
      if (Number(req.requested_by) !== Number(actor.id)) throw typed('FORBIDDEN', 'only the requester can withdraw a request', 403);
    } else {
      if (!actor.isSuper) throw typed('FORBIDDEN', 'super_admin role required', 403);
      if (samePerson(req, actor)) throw typed('FORBIDDEN', 'a second super_admin must decide — the requester cannot approve or reject their own request', 403);
      if (why.length < 3) throw typed('VALIDATION', 'a short reason is required to decide', 400);
    }
    let status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'cancelled';
    if (decision === 'approve' && currentValue) {
      const cur = await currentValue(req.key);
      if (String(cur == null ? '' : cur) !== String(req.old_value == null ? '' : req.old_value)) status = 'stale';
    }
    // claim the row first (a concurrent decision loses here), then apply
    const claimed = await Q("UPDATE policy_change_requests SET status=?, decided_by=?, decided_by_name=?, decided_at=?, decision_reason=? WHERE id=? AND status='pending' RETURNING id")
      .run(status, Number(actor.id), String(actor.username || ''), now(), why.slice(0, 1000) || null, Number(id));
    if (!claimed || !claimed.lastID) throw typed('CONFLICT', 'request was decided by someone else', 409);
    if (status === 'stale') throw typed('CONFLICT', 'the value changed since this request was made — it was marked stale; request again', 409);
    if (status === 'approved' && apply) await apply(req);
    return get(id);
  }
  return { list, get, pendingFor, create, decide, samePerson, STATUSES };
}

module.exports = { makePolicyChangeStore, STATUSES };
