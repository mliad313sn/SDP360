'use strict';
// W3-GOVERNANCE (PPM parity G3) — RAID log (risks, assumptions, issues, dependencies). PURE: no I/O, no clock.
// The register rows stay in portfolio_risks (kind, title, probability 1..3, impact 1..3, owner, status, mitigation);
// the RAID details live in ppm_raid_details (migration 110) so that no existing reader ever sees an amount:
//   response        the planned response (avoid / mitigate / transfer / accept text)
//   review_date     YYYY-MM-DD; past it the entry is "review overdue"
//   probability_pct 0..100 (optional; the 1..3 score is NOT converted to a percentage — that mapping is not decided)
//   impact_amount   ≥ 0 with its ISO currency (never defaulted)
//   dependency_ref  free text: the other project / supplier / decision a dependency waits for
// Exposure (money) = impact_amount × probability_pct / 100, null when either is unknown. Amounts are shown only to the
// admin tier and finance-viewer (invariant 2 — not the wider committee money rule); others get money_hidden.

const KINDS = ['risk', 'issue', 'assumption', 'dependency'];
const RESPONSES = ['avoid', 'mitigate', 'transfer', 'accept', 'exploit', 'escalate'];
const bad = (msg, reason) => Object.assign(new Error(msg), { code: 'INVALID', reason, status: 400 });
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

/** Normalise a RAID body (row + details). Throws INVALID. */
function normalise(body) {
  const b = body || {};
  const kind = String(b.kind || 'risk');
  if (!KINDS.includes(kind)) throw bad('kind must be ' + KINDS.join(' | '), 'BAD_KIND');
  const title = String(b.title || '').trim();
  if (title.length < 3) throw bad('a title of 3+ characters is required', 'BAD_TITLE');
  const score = (k) => { if (b[k] == null || b[k] === '') return null; const n = Number(b[k]); if (!Number.isInteger(n) || n < 1 || n > 3) throw bad(`${k} must be 1..3`, 'BAD_SCORE'); return n; };
  const probability = score('probability'), impact = score('impact');
  const status = String(b.status || 'open');
  if (!['open', 'closed'].includes(status)) throw bad('status must be open | closed', 'BAD_STATUS');
  const response = b.response == null || b.response === '' ? null : String(b.response);
  if (response != null && !RESPONSES.includes(response)) throw bad('response must be ' + RESPONSES.join(' | '), 'BAD_RESPONSE');
  const review_date = b.review_date == null || b.review_date === '' ? null : String(b.review_date);
  if (review_date != null && !isDay(review_date)) throw bad('review_date must be YYYY-MM-DD', 'DATE_INVALID');
  const probability_pct = num(b.probability_pct);
  if (b.probability_pct != null && b.probability_pct !== '' && (probability_pct == null || probability_pct < 0 || probability_pct > 100)) throw bad('probability_pct must be 0..100 (empty = unknown)', 'BAD_PCT');
  const impact_amount = num(b.impact_amount);
  if (b.impact_amount != null && b.impact_amount !== '' && (impact_amount == null || impact_amount < 0)) throw bad('impact_amount must be ≥ 0 (empty = unknown)', 'BAD_AMOUNT');
  const impact_currency = b.impact_currency == null || b.impact_currency === '' ? null : String(b.impact_currency).toUpperCase();
  if (impact_currency != null && !/^[A-Z]{3}$/.test(impact_currency)) throw bad('impact_currency must be an ISO code such as USD or XOF', 'BAD_CURRENCY');
  if (impact_amount != null && impact_currency == null) throw bad('an amount needs its currency (never defaulted)', 'CURRENCY_REQUIRED');
  const owner = b.owner == null ? null : String(b.owner).trim().slice(0, 300) || null;
  const mitigation = b.mitigation == null ? null : String(b.mitigation).slice(0, 4000) || null;
  const dependency_ref = b.dependency_ref == null ? null : String(b.dependency_ref).trim().slice(0, 300) || null;
  return { row: { kind, title: title.slice(0, 300), probability, impact, status, owner, mitigation }, details: { response, review_date, probability_pct, impact_amount, impact_currency, dependency_ref } };
}

/** One RAID entry for a reader. today = server date (YYYY-MM-DD); money = may the reader see amounts. */
function view(row, details, { today, money }) {
  const d = details || {};
  const p = num(row.probability), i = num(row.impact);
  const score = p != null && i != null ? p * i : null;
  const amt = num(d.impact_amount), pp = num(d.probability_pct);
  const exposure = amt != null && pp != null ? Math.round(amt * pp) / 100 : null;
  const out = {
    id: Number(row.id), project_id: Number(row.project_id), kind: row.kind || 'risk', title: row.title, probability: p, impact: i, score,
    severity: score == null ? null : score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low',
    owner: row.owner || null, status: row.status, mitigation: row.mitigation || null,
    response: d.response || null, review_date: d.review_date || null,
    review_overdue: !!(d.review_date && row.status === 'open' && today && d.review_date < today),
    probability_pct: pp, dependency_ref: d.dependency_ref || null,
  };
  if (money) Object.assign(out, { impact_amount: amt, impact_currency: d.impact_currency || null, exposure_amount: exposure, money_hidden: false });
  else Object.assign(out, { money_hidden: true });
  return out;
}

/** Totals per currency (never across currencies) of the open entries' exposure; unknown when any is unknown. */
function exposureTotals(items) {
  const by = new Map();
  for (const it of items) {
    if (it.status !== 'open' || it.money_hidden) continue;
    if (it.impact_currency == null) continue;
    const c = by.get(it.impact_currency) || { currency: it.impact_currency, exposure_amount: 0, entries: 0, unknown: 0 };
    c.entries += 1;
    if (it.exposure_amount == null) c.unknown += 1; else c.exposure_amount += it.exposure_amount;
    by.set(it.impact_currency, c);
  }
  return [...by.values()].map((c) => ({ ...c, exposure_amount: c.unknown ? null : Math.round(c.exposure_amount * 100) / 100 }));
}

module.exports = { normalise, view, exposureTotals, KINDS, RESPONSES };
