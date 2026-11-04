'use strict';
// A-26 — per-site currency for asset money (PURE, no I/O).
//
// Today (switches at their defaults) every asset purchase_cost is XOF and multiplied
// by xof_usd_rate. PROPOSED (Finance, not approved): each asset site maps to a
// currency through report_config asset_site_currency (JSON, "*" = default) and each
// currency to a USD rate through asset_currency_rates. An unknown currency is
// UNKNOWN (null): the amount is excluded and counted, never converted at the XOF
// rate. Licence cost is native USD and never goes through this map.
const money = require('./money');

const DEFAULT_OUTLIER_FACTOR = 10;

// Accent / case / whitespace fold — 'Houndé', 'HOUNDE', ' hounde ' are one key.
function fold(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function _parseObject(json, what) {
  if (json && typeof json === 'object' && !Array.isArray(json)) return json;
  if (json == null || String(json).trim() === '') return null;
  try {
    const o = JSON.parse(String(json));
    if (o && typeof o === 'object' && !Array.isArray(o)) return o;
  } catch { /* fall through */ }
  console.warn(`[currency] ${what} is not a JSON object — ignored (today's behaviour kept)`);
  return null;
}

// JSON {"MANA":"XOF","LONDON":"GBP","*":"XOF"} → folded {mana:'XOF', london:'GBP', '*':'XOF'}.
// Blank or invalid → {} (an empty map = the legacy single-rate path). Never throws.
function parseCurrencyMap(json) {
  const o = _parseObject(json, 'asset_site_currency');
  const out = {};
  if (!o) return out;
  for (const [k, v] of Object.entries(o)) {
    const cur = String(v == null ? '' : v).trim().toUpperCase();
    if (!cur) continue;
    out[k.trim() === '*' ? '*' : fold(k)] = cur;
  }
  return out;
}

// Site label → currency code, or null when unmapped and no "*" default.
function resolveSiteCurrency(site, map) {
  const m = map || {};
  const k = fold(site);
  if (k && Object.prototype.hasOwnProperty.call(m, k)) return m[k];
  return Object.prototype.hasOwnProperty.call(m, '*') ? m['*'] : null;
}

// JSON {"GBP":1.27} merged over the default {XOF: xofRate, USD: 1}. A blank, zero or
// non-numeric entry is ignored (a bad rate never becomes 1).
function parseRates(json, xofRate) {
  const out = { XOF: Number(xofRate), USD: 1 };
  const o = _parseObject(json, 'asset_currency_rates');
  if (o) {
    for (const [k, v] of Object.entries(o)) {
      const n = Number(v);
      if (n > 0) out[String(k).trim().toUpperCase()] = n;
    }
  }
  return out;
}

// The five switches → reader options. `rate` is the already-resolved xof_usd_rate.
function optsFromConfig(cfg, rate) {
  const c = cfg || {};
  const f = Number(c.asset_cost_outlier_factor);
  return {
    rate,
    mode: c.asset_amount_parser === 'locale' ? 'locale' : 'legacy',
    currencyMap: parseCurrencyMap(c.asset_site_currency),
    rates: parseRates(c.asset_currency_rates, rate),
    outlierFactor: f > 0 ? f : DEFAULT_OUTLIER_FACTOR,
    outlierExclude: String(c.asset_cost_outlier_exclude) === '1',
  };
}

function _median(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Reader-side helper. opts: {rate, mode, currencyMap, rates, outlierFactor, outlierExclude}
// — currencyMap / rates may be JSON strings or already parsed. `active` is true only
// when the map is non-empty; otherwise rateOf() is the single legacy rate.
function moneyContext(opts = {}) {
  const map = typeof opts.currencyMap === 'object' && opts.currencyMap
    ? parseCurrencyMap(opts.currencyMap) : parseCurrencyMap(opts.currencyMap || '');
  const active = Object.keys(map).length > 0;
  const rates = typeof opts.rates === 'object' && opts.rates
    ? parseRates(opts.rates, opts.rates.XOF != null ? opts.rates.XOF : opts.rate)
    : parseRates(opts.rates || '', opts.rate);
  const mode = opts.mode === 'locale' ? 'locale' : 'legacy';
  const factor = Number(opts.outlierFactor) > 0 ? Number(opts.outlierFactor) : DEFAULT_OUTLIER_FACTOR;
  const ctx = {
    active,
    mode,
    rate: opts.rate,
    excludeOutliers: opts.outlierExclude === true || String(opts.outlierExclude) === '1',
    factor,
    parse: (raw) => (mode === 'locale' ? money.parseAmount(raw, { mode }) : money.parseAmount(raw)),
    currencyOf: (site) => (active ? resolveSiteCurrency(site, map) : 'XOF'),
    rateOf: (site) => {
      if (!active) return opts.rate;
      const cur = resolveSiteCurrency(site, map);
      const r = cur ? Number(rates[cur]) : NaN;
      return r > 0 ? r : null;
    },
    // Raw amount → USD for one row: the exact legacy call when nothing is switched on.
    toUsd: (raw, site) => {
      if (!active && mode === 'legacy') return money.toUsd(raw, opts.rate);
      const r = ctx.rateOf(site);
      if (r == null) return null;
      const v = ctx.parse(raw);
      return v == null ? null : v * r;
    },
    // Cost outliers: rows whose parsed purchase_cost > factor × the median (cost > 0)
    // of the same product_type and currency. Returns Map row → {currency, median, ratio}.
    outliers: (rows) => {
      const groups = new Map();
      for (const row of rows || []) {
        const v = ctx.parse(row.purchase_cost);
        if (!(v > 0)) continue;
        const cur = ctx.currencyOf(row.site);
        const key = fold(row.product_type) + '|' + (cur || '');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ row, v, cur });
      }
      const out = new Map();
      for (const list of groups.values()) {
        const med = _median(list.map((x) => x.v));
        for (const x of list) if (med > 0 && x.v > factor * med) out.set(x.row, { currency: x.cur, median: med, ratio: x.v / med });
      }
      return out;
    },
  };
  return ctx;
}

module.exports = { fold, parseCurrencyMap, resolveSiteCurrency, parseRates, optsFromConfig, moneyContext,
  DEFAULT_OUTLIER_FACTOR };
