'use strict';
// P8 / goal B1 — SLA credit claims store (migration 098: wan_sla_claims + wan_sla_claim_events) and the claim BASIS
// (the WAN SLA engine run for one circuit × month, exactly like GET /api/analytics/wan/sla/summary).
//
// Same db handle shape as the other stores (prepare(sql).get/all/run, runTransaction). Every write leaves one
// hash-chained, append-only wan_sla_claim_events row in the SAME transaction (no state change without its audit
// row). The rules (transitions, amounts, motive) are decided by the pure services/wanSlaClaims.js; the routes
// (routes/wanSlaClaims.js) decide the switch and who may call. Amounts are NULL when unknown, never 0.
const W = require('./wanSlaClaims');
const { computeCircuitSla } = require('./wanSla');
const { parseSlaWanConfig, resolveCircuit } = require('./slaWanConfig');

const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const typedErr = (code, status, msg, reason) => Object.assign(new Error(msg), { code, status, expose: true, ...(reason ? { reason } : {}) });

/**
 * The engine run for one circuit × month → { circuit, tierName, outages, sla, params, hash, certified, amount, currency }
 * or null when the circuit is not mapped in sla_wan_config. `rc` = report_config (already awaited).
 * The certified gate mirrors the summary: with wan_sla_require_contract_evidence='1' an uncertified circuit has no amount.
 */
async function computeBasis(rdb, rc, { site_id, sub_site = '', uplink, period, nowMs }) {
  const b = W.periodBounds(period);
  if (!b) throw typedErr('INVALID', 400, 'period must be YYYY-MM', 'BAD_PERIOD');
  const cfg = parseSlaWanConfig(rc.sla_wan_config);
  const raw = (Array.isArray(cfg.circuits) ? cfg.circuits : []).find((c) => c && Number(c.site_id) === Number(site_id) && (c.sub_site || '') === (sub_site || '') && c.uplink === uplink);
  const circuit = resolveCircuit(cfg, { site_id: raw ? raw.site_id : site_id, sub_site, uplink });
  if (!circuit) return null;
  const clockStart = cfg.clock_start;
  const triggerMinutes = (cfg.notify && cfg.notify.trigger_minutes) || 15;
  const rows = (await rdb.getWanOutages({ site_id: circuit.site_id, from: b.fromISO, to: b.toISO, uplink })) || [];
  const outages = rows.filter((o) => (o.sub_site || '') === (sub_site || ''));
  const sla = computeCircuitSla({ outages, circuit, tier: circuit.tier, maintenance: cfg.maintenance,
    monthStart: b.monthStart, monthEnd: b.monthEnd, clockStart, triggerMinutes, nowMs });
  const params = W.contractParams(circuit, { clockStart, triggerMinutes, tierName: raw ? raw.tier : null });
  let certified = false;
  try {
    const key = rdb.wanCircuitKey({ site_id: circuit.site_id, sub_site, uplink });
    const contract = await rdb.getWanContract(key);
    certified = !!(contract && contract.reviewed_by && contract.mrc_amount != null && circuit.mrc_amount != null && Number(contract.mrc_amount) === Number(circuit.mrc_amount));
  } catch (_) { /* contracts are best-effort: no table → nothing certified */ }
  const requireEvidence = String(rc.wan_sla_require_contract_evidence || '0') === '1';
  const amount = requireEvidence && !certified ? null : (sla.amount == null ? null : Number(sla.amount));
  return { circuit, tierName: params.tier, outages, sla, params, certified, amount,
    currency: circuit.currency ? String(circuit.currency).toUpperCase() : null,
    hash: W.evidenceHash(outages, params), clockStart, triggerMinutes, bounds: b };
}

function makeClaimsStore(db, { now = () => new Date().toISOString() } = {}) {
  if (!db) throw new Error('claims store needs a db handle');
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (typeof db.runTransaction === 'function' ? db.runTransaction(fn) : fn());

  function row(r) {
    if (!r) return null;
    let calc = null, links = [];
    try { calc = JSON.parse(r.calc_json); } catch (_) { calc = null; }
    try { links = r.evidence_links ? JSON.parse(r.evidence_links) : []; } catch (_) { links = []; }
    const out = { ...r, id: Number(r.id), site_id: Number(r.site_id), calc, evidence_links: links,
      due_amount: num(r.due_amount), claimed_amount: num(r.claimed_amount), credited_amount: num(r.credited_amount),
      due_credit_pct: num(r.due_credit_pct), availability_pct: num(r.availability_pct),
      owner_user_id: r.owner_user_id == null ? null : Number(r.owner_user_id),
      notify_requested_by: r.notify_requested_by == null ? null : Number(r.notify_requested_by),
      notify_approved_by: r.notify_approved_by == null ? null : Number(r.notify_approved_by) };
    delete out.calc_json;
    return out;
  }
  async function event(claimId, { action, from_status = null, to_status = null, motive = null, details = null }, user) {
    await P(`INSERT INTO wan_sla_claim_events (claim_id, action, from_status, to_status, motive, actor_id, actor_name, at, details) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(Number(claimId), action, from_status, to_status, motive, user && user.id != null ? Number(user.id) : null,
        user ? String(user.full_name || user.username || '') || null : null, now(), details == null ? null : JSON.stringify(details));
  }
  async function get(id) { return row(await P('SELECT * FROM wan_sla_claims WHERE id=?').get(Number(id))); }
  async function list({ period = null, periods = null, status = null } = {}) {
    const w = [], p = [];
    if (period) { w.push('period=?'); p.push(period); }
    if (Array.isArray(periods) && periods.length) { w.push(`period IN (${periods.map(() => '?').join(',')})`); p.push(...periods); }
    if (status) { w.push('status=?'); p.push(status); }
    return (await P(`SELECT * FROM wan_sla_claims${w.length ? ' WHERE ' + w.join(' AND ') : ''} ORDER BY period DESC, site_id, uplink`).all(...p)).map(row);
  }
  async function events(claimId) {
    return (await P('SELECT id, claim_id, action, from_status, to_status, motive, actor_id, actor_name, at, details, row_hash FROM wan_sla_claim_events WHERE claim_id=? ORDER BY id').all(Number(claimId)))
      .map((e) => { let d = null; try { d = e.details ? JSON.parse(e.details) : null; } catch (_) { d = null; } return { ...e, id: Number(e.id), claim_id: Number(e.claim_id), details: d }; });
  }

  /** Open a claim (status 'due') from a basis; the engine figure is frozen. CONFLICT on a duplicate circuit × period. */
  async function create(basis, { period, owner_user_id = null, owner_name = null, notes = null, evidence_links = [] }, user) {
    const c = basis.circuit;
    const key = `${c.site_id}|${c.sub_site || ''}|${c.uplink}`;
    const calc = { availability_pct: basis.sla.availability_pct, availability_pct_objective: basis.sla.availability_pct_objective,
      credit_pct: basis.sla.credit_pct, counted_downtime_s: basis.sla.counted_downtime_s, service_seconds: basis.sla.service_seconds,
      allowed_s: basis.sla.allowed_s, gap_pp: basis.sla.gap_pp, amount: basis.amount, certified: basis.certified,
      outage_count: basis.outages.length, params: basis.params };
    const links = W.normaliseLinks(evidence_links);
    return tx(async () => {
      const dup = await P('SELECT id FROM wan_sla_claims WHERE circuit_key=? AND period=?').get(key, period);
      if (dup) throw typedErr('CONFLICT', 409, `a claim already exists for this circuit and month (#${dup.id})`, 'DUPLICATE_CLAIM');
      const at = now();
      let r;
      try {
        r = await P(`INSERT INTO wan_sla_claims (circuit_key, site_id, sub_site, uplink, period, status, isp, circuit_id, owner_user_id, owner_name,
            currency, due_amount, due_credit_pct, availability_pct, calc_json, evidence_hash, frozen_at, evidence_links, notes,
            created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,'due',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(key, Number(c.site_id), c.sub_site || '', c.uplink, period, c.isp || null, c.circuit_id || null,
            owner_user_id == null ? null : Number(owner_user_id), owner_name ? String(owner_name).slice(0, 120) : null,
            basis.amount == null ? basis.currency : basis.currency, basis.amount, basis.sla.credit_pct, basis.sla.availability_pct,
            JSON.stringify(calc), basis.hash, at, JSON.stringify(links), notes ? String(notes).slice(0, 2000) : null,
            user && user.id != null ? Number(user.id) : null, at, user && user.id != null ? Number(user.id) : null, at);
      } catch (e) {
        if (/wan_sla_claims_circuit_period|duplicate key/i.test(String(e && e.message))) throw typedErr('CONFLICT', 409, 'a claim already exists for this circuit and month', 'DUPLICATE_CLAIM');
        throw e;
      }
      const id = r.lastID;
      await event(id, { action: 'created', to_status: 'due', details: { due_amount: basis.amount, currency: basis.currency, credit_pct: basis.sla.credit_pct, evidence_hash: basis.hash } }, user);
      return get(id);
    });
  }

  /** Apply a planned transition. `refreeze` = a new basis to freeze (due → claimed: the claim is sent on the latest evidence). */
  async function transition(id, input, user, { refreeze = null } = {}) {
    return tx(async () => {
      const cur = await get(id);
      if (!cur) throw typedErr('NOT_FOUND', 404, 'claim not found');
      const plan = W.planTransition(refreeze ? { ...cur, due_amount: refreeze.amount, currency: refreeze.currency || cur.currency } : cur, input, { nowIso: now() });
      const sets = ['status=?', 'updated_by=?', 'updated_at=?'], vals = [plan.patch.status, user && user.id != null ? Number(user.id) : null, now()];
      for (const k of ['claimed_amount', 'claimed_at', 'credited_amount', 'credited_at', 'disputed_at', 'written_off_at']) {
        if (k in plan.patch) { sets.push(`${k}=?`); vals.push(plan.patch[k]); }
      }
      if (refreeze) {
        const calc = { ...(cur.calc || {}), availability_pct: refreeze.sla.availability_pct, availability_pct_objective: refreeze.sla.availability_pct_objective,
          credit_pct: refreeze.sla.credit_pct, counted_downtime_s: refreeze.sla.counted_downtime_s, service_seconds: refreeze.sla.service_seconds,
          allowed_s: refreeze.sla.allowed_s, gap_pp: refreeze.sla.gap_pp, amount: refreeze.amount, certified: refreeze.certified,
          outage_count: refreeze.outages.length, params: refreeze.params };
        sets.push('due_amount=?', 'currency=?', 'due_credit_pct=?', 'availability_pct=?', 'calc_json=?', 'evidence_hash=?', 'frozen_at=?');
        vals.push(refreeze.amount, refreeze.currency || cur.currency, refreeze.sla.credit_pct, refreeze.sla.availability_pct, JSON.stringify(calc), refreeze.hash, now());
      }
      await P(`UPDATE wan_sla_claims SET ${sets.join(', ')} WHERE id=?`).run(...vals, Number(id));
      const details = {};
      for (const k of ['claimed_amount', 'credited_amount']) if (k in plan.patch) details[k] = plan.patch[k];
      if (refreeze) { details.refrozen = true; details.evidence_hash = refreeze.hash; details.due_amount = refreeze.amount; }
      await event(id, { action: plan.action, from_status: plan.from, to_status: plan.to, motive: plan.motive, details }, user);
      return get(id);
    });
  }

  /** Owner / notes / evidence links. Audited (old → new). */
  async function update(id, body, user) {
    return tx(async () => {
      const cur = await get(id);
      if (!cur) throw typedErr('NOT_FOUND', 404, 'claim not found');
      const b = body || {};
      const next = {
        owner_user_id: 'owner_user_id' in b ? (b.owner_user_id == null || b.owner_user_id === '' ? null : Number(b.owner_user_id)) : cur.owner_user_id,
        owner_name: 'owner_name' in b ? (b.owner_name ? String(b.owner_name).trim().slice(0, 120) || null : null) : cur.owner_name,
        notes: 'notes' in b ? (b.notes ? String(b.notes).slice(0, 2000) : null) : cur.notes,
        evidence_links: 'evidence_links' in b ? W.normaliseLinks(b.evidence_links) : cur.evidence_links,
      };
      if (next.owner_user_id != null && !Number.isInteger(next.owner_user_id)) throw typedErr('INVALID', 400, 'owner_user_id must be a user id', 'BAD_OWNER');
      const changed = {};
      for (const k of Object.keys(next)) if (JSON.stringify(next[k]) !== JSON.stringify(cur[k])) changed[k] = { from: cur[k], to: next[k] };
      if (!Object.keys(changed).length) return cur;
      await P('UPDATE wan_sla_claims SET owner_user_id=?, owner_name=?, notes=?, evidence_links=?, updated_by=?, updated_at=? WHERE id=?')
        .run(next.owner_user_id, next.owner_name, next.notes, JSON.stringify(next.evidence_links), user && user.id != null ? Number(user.id) : null, now(), Number(id));
      await event(id, { action: 'edit', details: changed }, user);
      return get(id);
    });
  }

  /** Operator notification steps: requested → approved (another person) → sent | failed. Each step audited. */
  async function notifyStep(id, step, user, extra = {}) {
    return tx(async () => {
      const cur = await get(id);
      if (!cur) throw typedErr('NOT_FOUND', 404, 'claim not found');
      const uid = user && user.id != null ? Number(user.id) : null;
      const at = now();
      if (step === 'requested') {
        if (cur.notify_state === 'sent') throw typedErr('CONFLICT', 409, 'the notification was already sent', 'ALREADY_SENT');
        await P(`UPDATE wan_sla_claims SET notify_state='requested', notify_requested_by=?, notify_requested_at=?, notify_approved_by=NULL, notify_approved_at=NULL, notify_error=NULL, updated_at=? WHERE id=?`).run(uid, at, at, Number(id));
      } else if (step === 'approved') {
        if (cur.notify_state !== 'requested') throw typedErr('CONFLICT', 409, 'nothing to approve — request the notification first', 'NOT_REQUESTED');
        if (uid == null || uid === cur.notify_requested_by) throw typedErr('FORBIDDEN', 403, 'the approver must be a different person from the requester', 'SELF_APPROVAL');
        await P(`UPDATE wan_sla_claims SET notify_state='approved', notify_approved_by=?, notify_approved_at=?, updated_at=? WHERE id=?`).run(uid, at, at, Number(id));
      } else if (step === 'sent') {
        await P(`UPDATE wan_sla_claims SET notify_state='sent', notify_sent_at=?, notify_to=?, notify_error=NULL, updated_at=? WHERE id=?`).run(at, extra.to || null, at, Number(id));
      } else if (step === 'failed') {
        await P(`UPDATE wan_sla_claims SET notify_state='failed', notify_error=?, updated_at=? WHERE id=?`).run(String(extra.error || 'send failed').slice(0, 300), at, Number(id));
      } else throw typedErr('INVALID', 400, 'unknown notification step');
      await event(id, { action: 'notify_' + step, details: extra && (extra.to || extra.error || extra.subject) ? { to: extra.to || null, subject: extra.subject || null, error: extra.error || null } : null }, user);
      return get(id);
    });
  }

  return { get, list, events, create, transition, update, notifyStep };
}

module.exports = { computeBasis, makeClaimsStore };
