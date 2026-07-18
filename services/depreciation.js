// services/depreciation.js — PURE, currency-agnostic asset depreciation.
//
// Computes an asset's current book value + an annual depreciation schedule from
// purchase cost + acquisition date + config, for the four ServiceDesk Plus
// methods (Straight Line / Declining Balance / Double Declining Balance /
// Sum Of The Years Digit). No DB, no I/O, no requires — operates on numbers so
// it works on any currency once the caller has coerced the raw cost to a number.
//
// I-1 (boundary consistency): both `currentBookValue` and every `schedule[k]`
// row are produced by the SAME per-method `bookValueAt(months)` helper — the
// schedule is a downsample at k×12-month marks, NOT an independently compounded
// annual series. So when `asOf` lands on a year boundary, currentBookValue ===
// the matching schedule row's bookValue exactly.
'use strict';

const METHODS = {
  straight_line: 'Straight Line',
  declining_balance: 'Declining Balance',
  double_declining: 'Double Declining Balance',
  sum_of_years: 'Sum Of The Years Digit',
};

const DEFAULT_DEPRECIATION_CONFIG = {
  default: { method: 'straight_line', useful_life_months: 48, salvage_pct: 0 },
  by_type: {
    Laptop: { method: 'straight_line', useful_life_months: 36, salvage_pct: 0 },
    Desktop: { method: 'straight_line', useful_life_months: 36, salvage_pct: 0 },
    Computer: { method: 'straight_line', useful_life_months: 36, salvage_pct: 0 },
    Server: { method: 'straight_line', useful_life_months: 60, salvage_pct: 0 },
    Network: { method: 'straight_line', useful_life_months: 60, salvage_pct: 0 },
    Smartphone: { method: 'straight_line', useful_life_months: 24, salvage_pct: 0 },
  },
};

// Whole months between two dates, computed on UTC components to avoid TZ drift.
// Both ISO ('2024-01-01') and 'DD Mon YYYY' parse in V8's `new Date`.
function _monthsBetween(a, b) {
  const da = new Date(a), db = new Date(b);
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return 0;
  let m = (db.getUTCFullYear() - da.getUTCFullYear()) * 12
    + (db.getUTCMonth() - da.getUTCMonth());
  if (db.getUTCDate() < da.getUTCDate()) m -= 1; // not a full final month yet
  return Math.max(0, m);
}

function computeDepreciation({
  cost, salvage = 0, method, usefulLifeMonths, declinePercent, acquisitionDate, asOf,
} = {}) {
  const NULLR = {
    currentBookValue: null, accumulated: null, pctDepreciated: null,
    monthsElapsed: null, monthsRemaining: null, schedule: [],
  };
  const c = Number(cost);
  const life = Number(usefulLifeMonths);
  const sv = Number(salvage) || 0;
  if (cost == null || !Number.isFinite(c) || !(life > 0)) return NULLR;

  const base = c - sv;                       // depreciable amount
  const n = Math.ceil(life / 12);            // whole years in the schedule

  // Sum-of-years accumulated depreciation over `months` (partial-year prorated).
  const SYD = (n * (n + 1)) / 2;
  const _sydAccum = (months) => {
    const capped = Math.min(months, life);
    const fullYears = Math.floor(capped / 12);
    let acc = 0;
    for (let y = 1; y <= n; y++) {
      const factor = (n - y + 1) / SYD;      // declining year weight
      if (y <= fullYears) acc += factor * base;
      else if (y === fullYears + 1) {
        const frac = (capped - fullYears * 12) / 12;
        acc += factor * base * frac;
      }
    }
    return acc;
  };

  // The SINGLE source of truth for book value at N months — both currentBookValue
  // and the schedule downsample call this, guaranteeing I-1 consistency.
  const bookValueAt = (months) => {
    const t = Math.min(months, life);
    let bv;
    switch (method) {
      case 'declining_balance': {
        const d = (declinePercent != null && Number.isFinite(Number(declinePercent)))
          ? Number(declinePercent)
          : 1 / (life / 12);                 // annual rate implied by useful life
        bv = c * Math.pow(1 - d / 12, months);
        break;
      }
      case 'double_declining':
        bv = c * Math.pow(1 - 2 / life, months);
        break;
      case 'sum_of_years':
        bv = c - _sydAccum(months);
        break;
      case 'straight_line':
      default:
        bv = c - t * (base / life);
        break;
    }
    if (!Number.isFinite(bv)) bv = sv;
    return Math.max(sv, bv);                  // floored at salvage, never negative for sv>=0
  };

  const monthsElapsed = _monthsBetween(acquisitionDate, asOf);
  const m = Math.min(monthsElapsed, life);   // book value stops at end of life
  const currentBookValue = bookValueAt(m);
  const accumulated = c - currentBookValue;
  const pctDepreciated = c > 0 ? 1 - currentBookValue / c : null;
  const monthsRemaining = Math.max(0, life - monthsElapsed);

  const acqYear = new Date(acquisitionDate);
  const startYear = isNaN(acqYear.getTime()) ? 0 : acqYear.getUTCFullYear();
  const schedule = [];
  for (let k = 1; k <= n; k++) {
    const bv = bookValueAt(k * 12);
    schedule.push({
      year: startYear ? startYear + k - 1 : k,
      depreciation: bookValueAt((k - 1) * 12) - bv,
      accumulated: c - bv,
      bookValue: bv,
    });
  }

  return { currentBookValue, accumulated, pctDepreciated, monthsElapsed, monthsRemaining, schedule };
}

function parseDepreciationConfig(raw) {
  try {
    const o = JSON.parse(raw);
    return (o && typeof o === 'object' && !Array.isArray(o) && o.default)
      ? o : DEFAULT_DEPRECIATION_CONFIG;
  } catch {
    return DEFAULT_DEPRECIATION_CONFIG;
  }
}

function resolveForType(config, product_type) {
  const cfg = (config && config.default) ? config : DEFAULT_DEPRECIATION_CONFIG;
  const dflt = cfg.default || {};
  const byType = cfg.by_type || {};
  const pt = String(product_type || '').toLowerCase();
  let entry = null;
  for (const key of Object.keys(byType)) {
    const k = key.toLowerCase();
    if (pt === k || (pt && pt.includes(k)) || (k && k.includes(pt) && pt)) { entry = byType[key]; break; }
  }
  const e = entry || dflt;
  return {
    method: e.method || dflt.method,
    useful_life_months: e.useful_life_months || dflt.useful_life_months,
    salvage_pct: e.salvage_pct != null ? e.salvage_pct : 0,
    declinePercent: e.declinePercent,
  };
}

module.exports = {
  computeDepreciation,
  parseDepreciationConfig,
  resolveForType,
  METHODS,
  DEFAULT_DEPRECIATION_CONFIG,
};
