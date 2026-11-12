'use strict';
// P8 / goal B1 — SLA credit claims: PURE rules (no DB, no network, no clock — `nowMs` is injected).
//
//   Lifecycle (per circuit × month):  due → claimed → credited
//                                           ↘ disputed ↗ (→ claimed again, credited or written_off)
//                                     due | claimed | disputed → written_off
//   credited and written_off are TERMINAL; only an explicit reopen (admin tier, motive) leaves them:
//     credited → disputed (the credit is contested after the fact), written_off → due | claimed.
//   Every transition carries a motive. The store (services/wanSlaClaimsStore.js) writes the hash-chained
//   event; the routes (routes/wanSlaClaims.js) decide who may call it.
//
//   Money: amounts keep the claim's currency and are NEVER summed across currencies. NULL = unknown, never 0.
//   The due amount is the WAN SLA engine's figure (services/wanSla.computeCircuitSla) FROZEN at claim time with
//   evidence_hash = sha256(outage set + contract parameters); a later outage edit or contract change makes the
//   claim "stale vs evidence" (compared on read, never silently recomputed).
const crypto = require('crypto');
const { clipToService } = require('./wanSla');

const STATUSES = Object.freeze(['due', 'claimed', 'credited', 'disputed', 'written_off']);
const TERMINAL = Object.freeze(['credited', 'written_off']);
const TRANSITIONS = Object.freeze({
  due: ['claimed', 'written_off'],
  claimed: ['credited', 'disputed', 'written_off'],
  disputed: ['claimed', 'credited', 'written_off'],
  credited: [],
  written_off: [],
});
const REOPEN = Object.freeze({ credited: ['disputed'], written_off: ['due', 'claimed'] });
const MONEY_FIELDS = Object.freeze(['due_amount', 'claimed_amount', 'credited_amount']);
const NOTIFY_STATES = Object.freeze(['none', 'requested', 'approved', 'sent', 'failed']);

const invalid = (msg, reason) => Object.assign(new Error(msg), { code: 'INVALID', status: 400, expose: true, ...(reason ? { reason } : {}) });
const conflict = (msg, reason) => Object.assign(new Error(msg), { code: 'CONFLICT', status: 409, expose: true, ...(reason ? { reason } : {}) });

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
function periodBounds(period) {
  const m = PERIOD_RE.exec(String(period || ''));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]) - 1;
  const monthStart = Date.UTC(y, mo, 1), monthEnd = Date.UTC(y, mo + 1, 1);
  return { monthStart, monthEnd, fromISO: new Date(monthStart).toISOString(), toISO: new Date(monthEnd).toISOString() };
}
/** A claim is only opened on a CLOSED month (the in-progress month is provisional by design of the engine). */
function isClosedPeriod(period, nowMs) {
  const b = periodBounds(period);
  return !!b && b.monthEnd <= nowMs;
}
function quarterOf(period) {
  const m = PERIOD_RE.exec(String(period || ''));
  return m ? `${m[1]}-Q${Math.floor((Number(m[2]) - 1) / 3) + 1}` : null;
}
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
function periodsOfQuarter(q) {
  const m = QUARTER_RE.exec(String(q || ''));
  if (!m) return null;
  const first = (Number(m[2]) - 1) * 3 + 1;
  return [0, 1, 2].map((i) => `${m[1]}-${String(first + i).padStart(2, '0')}`);
}

function _amount(v, field) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw invalid(`${field} must be a number ≥ 0 (leave empty when unknown)`, 'BAD_AMOUNT');
  return Math.round(n * 100) / 100;
}
function _motive(m) {
  const s = String(m == null ? '' : m).trim();
  if (s.length < 3) throw invalid('a motive (at least 3 characters) is required for every status change', 'MOTIVE_REQUIRED');
  return s.slice(0, 1000);
}
/** [{label, url}] — http(s) links only, at most 20. */
function normaliseLinks(raw) {
  if (raw == null || raw === '') return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const x of arr.slice(0, 20)) {
    const url = String(x && typeof x === 'object' ? x.url : x || '').trim();
    if (!url) continue;
    if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 500) throw invalid('evidence links must be http(s) URLs', 'BAD_LINK');
    const label = String(x && typeof x === 'object' && x.label ? x.label : '').trim().slice(0, 120) || null;
    out.push({ label, url });
  }
  return out;
}

/**
 * Validate one status change. Returns the patch to apply (status, *_at, amounts) — never touches anything else.
 * Throws INVALID (bad input) or CONFLICT (illegal from → to).
 */
function planTransition(claim, { to, motive, claimed_amount, credited_amount, reopen = false } = {}, { nowIso }) {
  const from = claim && claim.status;
  if (!STATUSES.includes(from)) throw invalid('unknown current status', 'BAD_STATUS');
  if (!STATUSES.includes(to)) throw invalid('to must be ' + STATUSES.join(' | '), 'BAD_STATUS');
  const allowed = reopen ? (REOPEN[from] || []) : TRANSITIONS[from];
  if (!allowed.includes(to)) {
    if (!reopen && TERMINAL.includes(from)) throw conflict(`${from} is final — only a reopen (admin, with a motive) can change it`, 'TERMINAL');
    throw conflict(`illegal transition ${from} → ${to}${reopen ? ' (reopen)' : ''}`, 'ILLEGAL_TRANSITION');
  }
  const m = _motive(motive);
  const patch = { status: to };
  if (to === 'claimed') {
    const c = _amount(claimed_amount, 'claimed_amount');
    // nothing typed → the frozen due amount is what is claimed (still NULL when the due amount is unknown)
    patch.claimed_amount = c != null ? c : (claim.claimed_amount != null ? Number(claim.claimed_amount) : (claim.due_amount != null ? Number(claim.due_amount) : null));
    patch.claimed_at = nowIso;
  } else if (to === 'credited') {
    const c = _amount(credited_amount, 'credited_amount');
    if (c == null) throw invalid('credited_amount is required: the amount the operator actually credited', 'CREDITED_AMOUNT_REQUIRED');
    patch.credited_amount = c;
    patch.credited_at = nowIso;
  } else if (to === 'disputed') {
    patch.disputed_at = nowIso;
  } else if (to === 'written_off') {
    patch.written_off_at = nowIso;
  }
  if (patch.claimed_amount != null || patch.credited_amount != null) {
    if (!claim.currency) throw invalid('this claim has no currency (no MRC / contract on the circuit) — record the amount once the contract is entered', 'CURRENCY_REQUIRED');
  }
  return { patch, motive: m, from, to, action: reopen ? 'reopen' : 'transition' };
}

// ── frozen basis ───────────────────────────────────────────────────────────────────────────────────
const _OUTAGE_FIELDS = ['site_id', 'sub_site', 'uplink', 'detected_start', 'restored_end', 'notified_at', 'attribution'];
function canonicalOutages(outages) {
  return (outages || []).filter(Boolean).map((o) => {
    const r = {}; for (const k of _OUTAGE_FIELDS) r[k] = o[k] == null ? null : (k === 'site_id' ? Number(o[k]) : String(o[k]));
    r.sub_site = r.sub_site || '';
    return r;
  }).sort((a, b) => `${a.detected_start}|${a.uplink}`.localeCompare(`${b.detected_start}|${b.uplink}`));
}
/** The contract parameters the engine used (frozen + printed in the evidence pack). */
function contractParams(circuit, { clockStart, triggerMinutes, tierName = null }) {
  const c = circuit || {}, t = c.tier || {};
  const pick = (k) => (c[k] != null ? c[k] : t[k]);
  return {
    tier: tierName,
    isp: c.isp || null, circuit_id: c.circuit_id || null,
    availability_target_pct: pick('availability_target_pct'),
    min_outage_minutes: pick('min_outage_minutes'),
    credit_model: pick('credit_model') || 'tiered',
    credit_cap_pct: pick('credit_cap_pct'),
    credit_schedule: c.credit_schedule || t.credit_schedule || [],
    service_hours: c.hours || t.hours_default || null,
    mrc_amount: c.mrc_amount != null ? Number(c.mrc_amount) : null,
    currency: c.currency || null,
    clock_start: clockStart, trigger_minutes: triggerMinutes,
  };
}
function evidenceHash(outages, params) {
  const payload = JSON.stringify({ outages: canonicalOutages(outages), params });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Per-outage view of the engine's counting, for the evidence pack: wall duration, the in-service-hours seconds that
 * COUNT under the contract clock, and why an outage does not count. The sum of `counted_s` equals the engine's
 * counted_downtime_s (tested). Same rules as services/wanSla._clockedDowntime.
 */
function outageBreakdown(outages, circuit, { monthStart, monthEnd, nowMs, clockStart = 'notification', triggerMinutes = 15 }) {
  const c = circuit || {}, t = c.tier || {};
  const cal = c.hours || t.hours_default;
  const minOut = c.min_outage_minutes != null ? c.min_outage_minutes : t.min_outage_minutes;
  const openEnd = Math.min(nowMs, monthEnd);
  const ms = (v) => (typeof v === 'number' ? v : Date.parse(v));
  return (outages || []).filter(Boolean).map((o) => {
    const det = ms(o.detected_start);
    const restored = o.restored_end ? ms(o.restored_end) : openEnd;
    const wall_s = Math.max(0, Math.round((restored - det) / 1000));
    const base = { detected_start: o.detected_start, restored_end: o.restored_end || null, notified_at: o.notified_at || null,
      uplink: o.uplink, attribution: o.attribution || null, attribution_reason: o.attribution_reason || null, wall_s, counted_s: 0, counts: false, why: null };
    if (o.attribution !== 'isp') return { ...base, why: `attribution ${o.attribution || 'not reviewed'} — not the ISP's` };
    if (!((restored - det) / 60000 >= minOut)) return { ...base, why: `shorter than the ${minOut}-minute floor` };
    const start = clockStart === 'notification' ? (o.notified_at != null ? ms(o.notified_at) : det + triggerMinutes * 60000) : det;
    const s = Math.max(start, monthStart), e = Math.min(o.restored_end ? ms(o.restored_end) : openEnd, monthEnd);
    if (e <= s) return { ...base, why: 'outside the month / before the contract clock started' };
    const counted = clipToService(cal, [s, e]);
    return { ...base, counted_s: counted, counts: counted > 0, why: counted > 0 ? null : 'entirely outside service hours' };
  });
}

// ── reading ────────────────────────────────────────────────────────────────────────────────────────
/** Amounts removed for a reader without the money right (invariant 2) — the rest of the claim stays. */
function maskClaim(claim, canReadMoney) {
  if (!claim || canReadMoney) return claim;
  const out = { ...claim, money_hidden: true };
  for (const f of MONEY_FIELDS) out[f] = null;
  if (out.calc && typeof out.calc === 'object') out.calc = { ...out.calc, amount: null, params: out.calc.params ? { ...out.calc.params, mrc_amount: null } : out.calc.params };
  return out;
}
/** Days since the claim became due (created) and since it was claimed — null when not applicable. */
function aging(claim, nowMs) {
  const d = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? Math.floor((nowMs - t) / 86400000) : null; };
  const open = !TERMINAL.includes(claim.status);
  return {
    days_since_due: open ? d(claim.created_at) : null,
    days_since_claimed: open && claim.claimed_at ? d(claim.claimed_at) : null,
  };
}

/**
 * Value metric per quarter and per currency: due vs claimed vs recovered (credited). A currency is never added to
 * another; `usd` is an INDICATIVE conversion with the given rates ({XOF: r, USD: 1, …}) and is null as soon as one
 * amount of the bucket has no rate (never a partial total). Unknown amounts are counted, not summed as 0.
 */
function valueTotals(claims, { rates = null, nowMs } = {}) {
  const byQ = new Map();
  const bucket = (q) => {
    if (!byQ.has(q)) byQ.set(q, { quarter: q, claims: 0, currencies: {}, unknown_amounts: 0, open: 0, aging_days: [] });
    return byQ.get(q);
  };
  for (const c of claims || []) {
    const q = quarterOf(c.period); if (!q) continue;
    const b = bucket(q); b.claims++;
    const cur = c.currency || 'UNKNOWN';
    const k = b.currencies[cur] || (b.currencies[cur] = { due: 0, claimed: 0, recovered: 0, written_off: 0 });
    if (c.due_amount == null) b.unknown_amounts++; else k.due += Number(c.due_amount);
    if (['claimed', 'credited', 'disputed'].includes(c.status) || (c.status === 'written_off' && c.claimed_at)) {
      if (c.claimed_amount != null) k.claimed += Number(c.claimed_amount);
    }
    if (c.status === 'credited' && c.credited_amount != null) k.recovered += Number(c.credited_amount);
    if (c.status === 'written_off' && c.due_amount != null) k.written_off += Number(c.due_amount);
    if (!TERMINAL.includes(c.status)) {
      b.open++;
      const a = aging(c, nowMs).days_since_due; if (a != null) b.aging_days.push(a);
    }
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  const out = [];
  for (const b of [...byQ.values()].sort((x, y) => x.quarter.localeCompare(y.quarter))) {
    const usd = { due: 0, claimed: 0, recovered: 0 }; let usdOk = !!rates;
    for (const [cur, v] of Object.entries(b.currencies)) {
      for (const f of ['due', 'claimed', 'recovered', 'written_off']) v[f] = r2(v[f]);
      const rate = rates && cur !== 'UNKNOWN' ? Number(rates[cur]) : NaN;
      if (!(rate > 0)) { if (v.due || v.claimed || v.recovered || cur === 'UNKNOWN') usdOk = false; continue; }
      usd.due += v.due * rate; usd.claimed += v.claimed * rate; usd.recovered += v.recovered * rate;
    }
    const sorted = b.aging_days.slice().sort((x, y) => x - y);
    const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
    out.push({ quarter: b.quarter, claims: b.claims, open: b.open, unknown_amounts: b.unknown_amounts, currencies: b.currencies,
      usd_indicative: usdOk ? { due: r2(usd.due), claimed: r2(usd.claimed), recovered: r2(usd.recovered) } : null,
      aging: { open_claims: b.open, median_days_since_due: median, max_days_since_due: sorted.length ? sorted[sorted.length - 1] : null } });
  }
  return out;
}

// ── operator (ISP) notification ────────────────────────────────────────────────────────────────────
function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
/** The e-mail to the operator for one claim. Pure — the template is the same in the dry run and in the send. */
function renderNotification(claim, { siteName, isp_email, cc = [], fromName = 'SDP NOC' } = {}) {
  const calc = claim.calc || {};
  const p = calc.params || {};
  const amount = claim.claimed_amount != null ? claim.claimed_amount : claim.due_amount;
  const amountTxt = amount == null ? 'to be confirmed (contract amount not on file)' : `${Number(amount).toLocaleString('en-US')} ${claim.currency || ''}`.trim();
  const subject = `SLA credit claim — ${claim.isp || 'circuit'} ${claim.circuit_id || ''} — ${siteName || 'site ' + claim.site_id} ${claim.uplink} — ${claim.period}`.replace(/\s+/g, ' ').trim();
  const rows = [
    ['Circuit', `${claim.isp || '—'} · ${claim.circuit_id || '—'} · ${siteName || claim.site_id}${claim.sub_site ? ' / ' + claim.sub_site : ''} · ${claim.uplink}`],
    ['Month', claim.period],
    ['Availability in service hours', calc.availability_pct == null ? '—' : calc.availability_pct + ' %'],
    ['Contract target', p.availability_target_pct == null ? '—' : p.availability_target_pct + ' %'],
    ['Credit tier', calc.credit_pct == null ? '—' : calc.credit_pct + ' % of the monthly charge'],
    ['Amount claimed', amountTxt],
    ['Evidence reference', `claim #${claim.id} · sha256 ${String(claim.evidence_hash || '').slice(0, 16)}…`],
  ];
  const html = `<p>Hello,</p><p>Under the service level agreement for the circuit below, we claim the service credit for ${_esc(claim.period)}. The outage evidence (in service hours, ISP-attributable outages only) is attached on request.</p>`
    + '<table cellpadding="4" style="border-collapse:collapse">' + rows.map(([k, v]) => `<tr><td><b>${_esc(k)}</b></td><td>${_esc(v)}</td></tr>`).join('') + '</table>'
    + `<p>Please confirm the credit on the next invoice.</p><p>${_esc(fromName)}</p>`;
  return { to: isp_email || null, cc: cc.filter(Boolean), subject, html };
}
/**
 * Can the notification be SENT now? Never unarmed (sla_wan_config.notify.enabled), never while the global STOP is on,
 * never without a second-person approval, never twice, never without a recipient.
 */
function notifyGate({ armed, stop, claim, to }) {
  if (stop) return { ok: false, reason: 'NOTIFICATIONS_STOPPED', message: 'notifications_stop is on — nothing is sent' };
  if (!armed) return { ok: false, reason: 'UNARMED', message: 'operator notification is not armed (Admin → SLA WAN → notify.enabled) — dry run only' };
  if (!claim || claim.notify_state !== 'approved') return { ok: false, reason: 'NOT_APPROVED', message: 'a second person must approve the notification before it is sent' };
  if (!claim.notify_approved_by || Number(claim.notify_approved_by) === Number(claim.notify_requested_by)) return { ok: false, reason: 'NOT_APPROVED', message: 'the approver must differ from the requester' };
  if (!to) return { ok: false, reason: 'NO_RECIPIENT', message: 'no operator e-mail on the circuit (isp_notify_email)' };
  return { ok: true };
}

module.exports = {
  STATUSES, TERMINAL, TRANSITIONS, REOPEN, MONEY_FIELDS, NOTIFY_STATES,
  periodBounds, isClosedPeriod, quarterOf, periodsOfQuarter, normaliseLinks,
  planTransition, canonicalOutages, contractParams, evidenceHash, outageBreakdown,
  maskClaim, aging, valueTotals, renderNotification, notifyGate,
};
