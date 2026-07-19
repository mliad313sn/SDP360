'use strict';
// services/assetForecast.js — the PURE forecast engine for the Assets
// Investment tab. Three builders (historical investment curve, hardware CAPEX
// forecast, software renewal forecast) + coverage-% transparency on every one.
//
// PURE: no DB, no I/O, and NEVER `new Date()`/`Date.now()` with no argument —
// callers ALWAYS pass `asOf` (an ISO date string) so the current year is
// deterministic and the module is unit-testable without a clock.
//
// Money rules (services/money.js):
//   - asset purchase_cost is XOF raw TEXT → toUsd(raw, rate) for the SUMMED amount.
//   - software cost is already USD → parseAmount(cost) directly.
//   - Eligibility gates are RATE-INDEPENDENT (parseAmount(x) > 0, NOT toUsd),
//     so coverage% never depends on the XOF→USD rate (review M4).

const money = require('./money');
const { resolveForType } = require('./depreciation');

// ── Tolerant helpers ────────────────────────────────────────────────────────

// 4-digit year from an ISO-ish string; empty/garbage/invalid → null.
function _yearOf(s) {
  if (s == null) return null;
  const str = String(s).trim();
  if (str === '') return null;
  const head = str.slice(0, 4);
  if (/^\d{4}$/.test(head)) {
    const y = Number(head);
    if (y >= 1900) return y;
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.getUTCFullYear();
}

// Expiry year — handles 'DD Mon YYYY' (e.g. '30 Jun 2027') via Date parsing.
function _expiryYearOf(s) {
  if (s == null) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getUTCFullYear();
}

// Current year from the caller-passed asOf (never a bare clock read).
function _curYear(asOf) {
  return new Date(asOf).getUTCFullYear();
}

// Coverage percentage, guarded against total=0 (no NaN).
function _pct(elig, total) {
  return total > 0 ? Math.round((100 * elig) / total) : 0;
}

// ── Builder 1: historical investment curve + coverage ───────────────────────
function buildInvestmentHistory(assetRows, licenceRows, rate) {
  const hwByYear = new Map();
  const swByYear = new Map();
  const hwCov = { eligible: 0, total: 0, pct: 0, excluded: { no_date: 0, no_cost: 0 } };
  const swCov = { eligible: 0, total: 0, pct: 0, excluded: { no_date: 0, no_cost: 0 } };

  for (const r of (assetRows || [])) {
    hwCov.total++;
    const y = _yearOf(r.acquisition_date);
    // rate-INDEPENDENT eligibility gate — coverage% must not depend on rate
    const amt = money.parseAmount(r.purchase_cost);
    if (y == null) { hwCov.excluded.no_date++; continue; }
    if (!(amt > 0)) { hwCov.excluded.no_cost++; continue; }
    hwCov.eligible++;
    const usd = money.toUsd(r.purchase_cost, rate) || 0;
    hwByYear.set(y, (hwByYear.get(y) || 0) + usd);
  }

  for (const r of (licenceRows || [])) {
    swCov.total++;
    const y = _yearOf(r.acquisition_date);
    const amt = money.parseAmount(r.cost); // already USD
    if (y == null) { swCov.excluded.no_date++; continue; }
    if (!(amt > 0)) { swCov.excluded.no_cost++; continue; }
    swCov.eligible++;
    swByYear.set(y, (swByYear.get(y) || 0) + amt);
  }

  hwCov.pct = _pct(hwCov.eligible, hwCov.total);
  swCov.pct = _pct(swCov.eligible, swCov.total);

  const presentYears = [...hwByYear.keys(), ...swByYear.keys()];
  const years = [];
  if (presentYears.length) {
    const min = Math.min(...presentYears);
    const max = Math.max(...presentYears);
    let cumulative = 0;
    for (let y = min; y <= max; y++) {
      const hardware_usd = Math.round(hwByYear.get(y) || 0);
      const software_usd = Math.round(swByYear.get(y) || 0);
      const total_usd = hardware_usd + software_usd;
      cumulative += total_usd;
      years.push({ year: y, hardware_usd, software_usd, total_usd, cumulative_usd: cumulative });
    }
  }

  return { years, coverage: { hardware: hwCov, software: swCov } };
}

// ── Builder 2: forward hardware replacement (CAPEX) forecast + coverage ──────
function buildHardwareForecast(assetRows, { config, rate, upliftPct, horizonYears, asOf } = {}) {
  const cur = _curYear(asOf);
  const up = Number(upliftPct) || 0;
  const horizon = Number(horizonYears) || 0;
  const yearMap = new Map(); // year → { replacement_usd, count }
  const due_now = { replacement_usd: 0, count: 0 };
  const beyond_horizon = { count: 0, usd: 0 };
  const coverage = { eligible: 0, total: 0, pct: 0, excluded: { no_date: 0, no_cost: 0, no_life: 0 } };

  for (const r of (assetRows || [])) {
    coverage.total++;
    const acqYear = _yearOf(r.acquisition_date);
    const amt = money.parseAmount(r.purchase_cost); // rate-independent gate
    const life = Number(resolveForType(config, r.product_type).useful_life_months);
    // First-failing gate: no_date → no_cost → no_life
    if (acqYear == null) { coverage.excluded.no_date++; continue; }
    if (!(amt > 0)) { coverage.excluded.no_cost++; continue; }
    if (!(life > 0)) { coverage.excluded.no_life++; continue; }
    coverage.eligible++;

    const costUsd = money.toUsd(r.purchase_cost, rate) || 0;
    const lifeYears = Math.ceil(life / 12);
    const ry = acqYear + lifeYears;              // replacement year
    const yu = ry - cur;                          // years until replacement
    const repl = Math.round(costUsd * Math.pow(1 + up, Math.max(0, yu)));

    if (ry <= cur) {
      due_now.replacement_usd += repl;            // yu clamped to 0 (no past compounding)
      due_now.count++;
    } else if (ry <= cur + horizon) {
      const slot = yearMap.get(ry) || { replacement_usd: 0, count: 0 };
      slot.replacement_usd += repl;
      slot.count++;
      yearMap.set(ry, slot);
    } else {
      beyond_horizon.count++;
      beyond_horizon.usd += repl;
    }
  }

  coverage.pct = _pct(coverage.eligible, coverage.total);
  const years = [...yearMap.keys()].sort((a, b) => a - b)
    .map((year) => ({ year, replacement_usd: yearMap.get(year).replacement_usd, count: yearMap.get(year).count }));
  const total_forecast_usd = due_now.replacement_usd + years.reduce((s, y) => s + y.replacement_usd, 0);

  return { years, due_now, beyond_horizon, total_forecast_usd, coverage };
}

// ── Builder 3: forward software renewal forecast + coverage ─────────────────
function buildSoftwareForecast(licenceRows, { horizonYears, asOf } = {}) {
  const cur = _curYear(asOf);
  const horizon = Number(horizonYears) || 0;
  const RECUR = /subscription|annual|monthly|saas/i; // NOT `volume`
  const yearMap = new Map(); // year → { renewal_usd, count }
  const due_now = { renewal_usd: 0, count: 0 };
  const beyond_horizon = { count: 0, usd: 0 };
  let recurring_count = 0;
  const coverage = { eligible: 0, total: 0, pct: 0, excluded: { no_expiry: 0, no_cost: 0 } };

  const addYear = (y, cost) => {
    const slot = yearMap.get(y) || { renewal_usd: 0, count: 0 };
    slot.renewal_usd += cost;
    slot.count++;
    yearMap.set(y, slot);
  };

  for (const r of (licenceRows || [])) {
    coverage.total++;
    const ey = _expiryYearOf(r.expiry_date);
    const cost = money.parseAmount(r.cost); // already USD
    // First-failing gate: no_expiry → no_cost
    if (ey == null) { coverage.excluded.no_expiry++; continue; }
    if (!(cost > 0)) { coverage.excluded.no_cost++; continue; }
    coverage.eligible++;

    const recurring = RECUR.test(String(r.license_option || ''));
    if (recurring) {
      recurring_count++;
      // A live sub renews every year in the horizon regardless of exact expiry —
      // it NEVER goes to beyond_horizon (review M3).
      for (let y = cur + 1; y <= cur + horizon; y++) addYear(y, cost);
      // If also expired, an overdue renewal is due now (M1: no same-year
      // double-count — due_now is the current-year slot, years start at cur+1).
      if (ey <= cur) { due_now.renewal_usd += cost; due_now.count++; }
    } else {
      if (ey <= cur) { due_now.renewal_usd += cost; due_now.count++; }
      else if (ey <= cur + horizon) addYear(ey, cost);
      else { beyond_horizon.count++; beyond_horizon.usd += cost; }
    }
  }

  coverage.pct = _pct(coverage.eligible, coverage.total);
  const years = [...yearMap.keys()].sort((a, b) => a - b)
    .map((year) => ({ year, renewal_usd: yearMap.get(year).renewal_usd, count: yearMap.get(year).count }));
  const total_forecast_usd = due_now.renewal_usd + years.reduce((s, y) => s + y.renewal_usd, 0);

  return { years, due_now, beyond_horizon, total_forecast_usd, recurring_count, coverage };
}

module.exports = {
  buildInvestmentHistory,
  buildHardwareForecast,
  buildSoftwareForecast,
  _yearOf,
  _expiryYearOf,
};
