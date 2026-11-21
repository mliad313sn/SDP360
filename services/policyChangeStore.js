'use strict';
// Policy Control Center — four-eyes requests for high-risk report_config rules (migration 120).
// A super_admin requests; ANOTHER super_admin approves or rejects (same person refused, by id AND by normalised
// identity — services/commitmentLifecycle.skeletonKey (refusal side), so "J.Doe" / "j.doe " / a confusable spelling is one person).
// A request lapses after `days` days. Approving re-checks that the stored value is still the one the request saw.
const { typed } = require('./httpError');
const { skeletonKey } = require('./commitmentLifecycle');   // refusal side: look-alikes fold (P11 N-R4-3)

// 'failed' (P11 r8 N-R8-1): approved by a second super_admin, but the apply step refused (e.g. the value no longer passes
// today's validation) — nothing was applied; decision_reason carries the cause.
const STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'expired', 'stale', 'failed'];

function makePolicyChangeStore(handle, { now = () => new Date().toISOString(), days = 7 } = {}) {
  const Q = (sql) => handle().prepare(sql);
  const row = (r) => r && ({ ...r, id: Number(r.id), requested_by: Number(r.requested_by), decided_by: r.decided_by == null ? null : Number(r.decided_by) });
  async function expireOld() { await Q("UPDATE policy_change_requests SET status='expired' WHERE status='pending' AND expires_at <= ?").run(now()); }
  async function list({ status = 'pending', key = null, limit = 200 } = {}) {
    await expireOld();
    const c = [], p = [];
    if (status) { c.push('status = ?'); p.push(status); }
    if (key) { c.push('key = ?'); p.push(key); }
    const lim = Math.max(1, Math.min(500, Math.floor(Number(limit)) || 200));
    return ((await Q(`SELECT * FROM policy_change_requests ${c.length ? 'WHERE ' + c.join(' AND ') : ''} ORDER BY id DESC LIMIT ${lim}`).all(...p)) || []).map(row);
  }
  async function get(id) { await expireOld(); return row(await Q('SELECT * FROM policy_change_requests WHERE id = ?').get(Number(id))); }
  async function pendingFor(key, scope = 'global') { await expireOld(); return row(await Q("SELECT * FROM policy_change_requests WHERE key=? AND scope=? AND status='pending'").get(key, scope)); }
  /**
   * P11 r9 R9-A2 / N-R9-1 — `origin` names the trusted path ('web' = the logged-in Policy Center route, 'cli' =
   * tools/ops/activate-switches.js with `operatorTokenId`). The row is written with an origin signature
   * (services/policyOrigin.js, keyed outside the database) and, for a CLI request, the consumed operator token is bound
   * to the new request id — both in the same transaction. Without SDP_CONFIG_KEY nothing is filed (fail closed).
   */
  async function create({ key, scope = 'global', oldValue, newValue, reason, actor, origin = 'web', operatorTokenId = null }) {
    const PO = require('./policyOrigin');
    const why = String(reason || '').trim();
    if (why.length < 10) throw typed('VALIDATION', 'a high-risk change needs a reason (10+ characters)', 400);
    if (!PO.ORIGINS.includes(origin)) throw typed('VALIDATION', 'unknown request origin', 400);
    if (origin === 'cli' && operatorTokenId == null) throw typed('VALIDATION', 'a CLI request must name the operator token that authenticated it', 400);
    const okey = PO.originKey();
    if (!okey) throw typed('CONFLICT', PO.NO_KEY, 409);
    if (await pendingFor(key, scope)) throw typed('CONFLICT', `a change of ${key} is already awaiting approval`, 409);
    const t = now(); const exp = new Date(Date.parse(t) + days * 864e5).toISOString();
    const work = async () => {
      const r = await Q('INSERT INTO policy_change_requests (key, scope, old_value, new_value, reason, requested_by, requested_by_name, requested_at, expires_at, origin, operator_token_id, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
        .run(key, scope, oldValue == null ? null : String(oldValue), newValue == null ? null : String(newValue), why.slice(0, 1000), Number(actor.id), String(actor.username || actor.name || ''), t, exp,
          origin, operatorTokenId == null ? null : Number(operatorTokenId), origin === 'cli' ? 'cli' : 'policy_center');
      const id = Number(r.lastID);
      const row = await Q('SELECT * FROM policy_change_requests WHERE id = ?').get(id);
      await Q('UPDATE policy_change_requests SET origin_sig = ? WHERE id = ?').run(PO.sign(okey, row), id);
      if (origin === 'cli') {
        const b = await Q("UPDATE operator_tokens SET bound_request_ids = COALESCE(NULLIF(bound_request_ids, ''), ',') || ? WHERE id = ? AND user_id = ? AND consumed_at IS NOT NULL RETURNING id")
          .run(id + ',', Number(operatorTokenId), Number(actor.id));
        if (!b || !b.lastID) throw typed('CONFLICT', `operator token #${operatorTokenId} is not a consumed token of ${actor.username || actor.id} — request not filed`, 409);
      }
      return id;
    };
    const h = handle();
    const id = typeof h.runTransaction === 'function' ? await h.runTransaction(work) : await work();
    return get(id);
  }
  const samePerson = (req, actor) => Number(req.requested_by) === Number(actor.id)
    || (!!skeletonKey(req.requested_by_name) && [actor.username, actor.email, actor.name].map(skeletonKey).includes(skeletonKey(req.requested_by_name)));
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
    if (status === 'approved' && apply) {
      try { await apply(req); } catch (e) {
        // P11 r8 N-R8-1 — never leave an "approved" request whose change was not applied: mark it failed with the cause
        // (the key is then free for a corrected request); the caller journals the failure and returns the error.
        const cause = `apply failed: ${String((e && e.message) || e).slice(0, 300)}`;
        await Q("UPDATE policy_change_requests SET status='failed', decision_reason=? WHERE id=? AND status='approved'")
          .run(((why ? why + ' | ' : '') + cause).slice(0, 1000), Number(id));
        e.policyRequest = await get(id);
        throw e;
      }
    }
    return get(id);
  }
  return { list, get, pendingFor, create, decide, samePerson, STATUSES };
}

module.exports = { makePolicyChangeStore, STATUSES };
