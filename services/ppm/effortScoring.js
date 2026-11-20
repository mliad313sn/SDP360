'use strict';
// PORTFOLIO LOT 6 (IT portfolio reconstruction spec §16) — the scoring model under the delivery-effort category. PURE.
// Seven factors, each scored 1 (low) … 5 (high): technical, integration, procurement complexity, site impact,
// stakeholder count, cross-site coverage, change impact. Score = Σ wᵢ·sᵢ ÷ Σ wᵢ·5 × 100 (0–100, floored), only when
// ALL seven are answered (a partial score is null — unknown, never low). The category the score suggests is compared
// with the declared delivery_effort (Lot 1 field): a difference is shown, never applied automatically.
// PROPOSED (a PMO decision, not approved): equal weights 1 and the bands < 35 small · < 55 medium · < 75 large ·
// ≥ 75 very_large. report_config ppm_effort_weights (JSON {factor: weight > 0}) overrides the weights; '' = PROPOSED.
const FACTORS = Object.freeze(['technical_complexity', 'integration_complexity', 'procurement_complexity', 'site_impact', 'stakeholder_count', 'cross_site_coverage', 'change_impact']);
const PROPOSED_WEIGHTS = Object.freeze(Object.fromEntries(FACTORS.map((f) => [f, 1])));
const BANDS = Object.freeze([{ max: 35, band: 'small' }, { max: 55, band: 'medium' }, { max: 75, band: 'large' }, { max: Infinity, band: 'very_large' }]);
const STATUS = 'PROPOSED — weights and bands not approved by the PMO; set report_config ppm_effort_weights once they are';
const bad = (msg, reason) => Object.assign(new Error(msg), { code: 'INVALID', reason, status: 400 });

function parseWeights(raw) {
  if (raw == null || String(raw).trim() === '') return { weights: { ...PROPOSED_WEIGHTS }, problems: [], status: STATUS };
  let o; try { o = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return { weights: { ...PROPOSED_WEIGHTS }, problems: ['ppm_effort_weights is not valid JSON — the PROPOSED weights apply'], status: STATUS }; }
  const w = { ...PROPOSED_WEIGHTS }; const problems = [];
  for (const f of FACTORS) if (o && Object.prototype.hasOwnProperty.call(o, f)) { const n = Number(o[f]); if (Number.isFinite(n) && n > 0 && n <= 100) w[f] = n; else problems.push(`weight of ${f} must be a number > 0`); }
  return { weights: w, problems, status: problems.length ? STATUS : 'configured in report_config ppm_effort_weights' };
}
/** Normalise the factor answers: each 1..5 integer or null (unanswered). Throws INVALID. */
function normalise(body) {
  const b = (body && body.factors) || body || {};
  const out = {};
  for (const f of FACTORS) { const v = b[f]; if (v == null || v === '') { out[f] = null; continue; } const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 5) throw bad(`${f} must be 1..5 (empty = not answered)`, 'EFFORT_SCORE'); out[f] = n; }
  return out;
}
function bandOf(score) { if (score == null) return null; return BANDS.find((b) => score < b.max).band; }
/** {score, band, answered, missing, declared, mismatch} */
function score(factors, { weights = PROPOSED_WEIGHTS, declared = null } = {}) {
  const f = factors || {};
  const missing = FACTORS.filter((k) => f[k] == null);
  let num = 0, den = 0;
  for (const k of FACTORS) if (f[k] != null) { num += weights[k] * f[k]; den += weights[k] * 5; }
  const s = missing.length || !den ? null : Math.floor((num / den) * 100);
  const band = bandOf(s);
  return { score: s, band, answered: FACTORS.length - missing.length, missing, declared: declared || null, mismatch: !!(band && declared && band !== declared) };
}
module.exports = { FACTORS, PROPOSED_WEIGHTS, BANDS, STATUS, parseWeights, normalise, score, bandOf };
