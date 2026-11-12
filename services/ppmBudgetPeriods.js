'use strict';
// E-P04 (audit P-04) — budget per period: baseline / actual / forecast per project × month × currency, and the
// Estimate At Completion. PURE: no DB, no clock (the caller passes asOf).
//   • currencies are NEVER added together: every total is per currency (no grand total exists);
//   • a period with no row of a kind is null for that kind (not measured), never 0;
//   • actual_to_date = Σ actual for months ≤ the as-of month (null when none);
//     remaining_forecast = Σ forecast for months after the as-of month (null when none);
//     EAC = actual_to_date + remaining_forecast (null only when both are null; `eac_basis` says which part is missing);
//     variance = EAC − Σ baseline (null when either side is null);
//   • a change of an existing amount, or an actual / forecast that differs from the period's baseline, needs a
//     justification (needsJustification) — the store refuses the write without one.
// Every view is labelled "not certified": Finance certifies the figures (HUMAN), not this module.
const KINDS = ['baseline', 'actual', 'forecast'];
const CERTIFICATION = 'not certified — figures entered in the dashboard, Finance has not certified them';
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const num = (v) => (v == null || v === '' ? null : Number(v));

function validate(r) {
  const row = r || {};
  if (!PERIOD_RE.test(String(row.period || ''))) return 'period must be YYYY-MM';
  if (!/^[A-Z]{3}$/.test(String(row.currency || ''))) return 'currency must be an ISO code such as USD or XOF';
  if (!KINDS.includes(row.kind)) return 'kind must be ' + KINDS.join(' | ');
  const a = num(row.amount);
  if (a == null || !Number.isFinite(a) || a < 0) return 'amount must be a number ≥ 0';
  return null;
}

/** existing = the stored row of the same key (or null); baseline = the stored baseline of the same period/currency. */
function needsJustification({ row, existing = null, baseline = null }) {
  const a = num(row && row.amount);
  if (existing && num(existing.amount) !== a) return true;
  if (row && row.kind !== 'baseline' && baseline && num(baseline.amount) !== a) return true;
  return false;
}

const sum = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100 : null);

function view(rows, { asOf } = {}) {
  const asMonth = String(asOf || '').slice(0, 7);
  const byCur = {};
  for (const r of rows || []) {
    if (!r || !KINDS.includes(r.kind) || !r.currency || !r.period) continue;
    const c = (byCur[r.currency] = byCur[r.currency] || {});
    const p = (c[r.period] = c[r.period] || { period: r.period, baseline: null, actual: null, forecast: null });
    p[r.kind] = num(r.amount);
  }
  const currencies = Object.keys(byCur).sort().map((cur) => {
    const periods = Object.values(byCur[cur]).sort((a, b) => a.period.localeCompare(b.period));
    const bl = periods.filter((p) => p.baseline != null).map((p) => p.baseline);
    const act = periods.filter((p) => p.actual != null && (!asMonth || p.period <= asMonth)).map((p) => p.actual);
    const fc = periods.filter((p) => p.forecast != null && asMonth && p.period > asMonth).map((p) => p.forecast);
    const baseline_total = sum(bl), actual_to_date = sum(act), remaining_forecast = sum(fc);
    const eac = actual_to_date == null && remaining_forecast == null ? null : Math.round(((actual_to_date || 0) + (remaining_forecast || 0)) * 100) / 100;
    const eac_basis = eac == null ? 'none' : actual_to_date == null ? 'forecast_only' : remaining_forecast == null ? 'actual_only' : 'actual_plus_forecast';
    return { currency: cur, periods, baseline_total, actual_to_date, remaining_forecast, eac, eac_basis, variance: eac == null || baseline_total == null ? null : Math.round((eac - baseline_total) * 100) / 100 };
  });
  return { as_of: asMonth || null, currencies, certification: CERTIFICATION, never_summed_across_currencies: true };
}

module.exports = { KINDS, CERTIFICATION, validate, needsJustification, view };
