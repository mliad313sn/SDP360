'use strict';
// B8 (goal programme 2026-11-12) — dated FX rates and reproducible conversion. PURE: no DB, no clock.
// Convention (as asset_currency_rates / xof_usd_rate): `rate` = USD for 1 unit of the currency. USD is the base (1).
// The rate of a day = the latest NON-retired row with effective_from <= that day. A conversion always names the
// rate rows it used (id, value, effective date, source) so it can be replayed; a missing rate gives value null
// (UNKNOWN), never 0 and never a silent fallback rate. Totals in several currencies are listed per currency; a
// converted total exists only when EVERY currency converted.
const SUPPORTED = Object.freeze(['USD', 'XOF', 'EUR']);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (v) => Math.round(v * 100) / 100;

function validateRate(r) {
  const x = r || {};
  const cur = String(x.currency || '').toUpperCase();
  if (!SUPPORTED.includes(cur) || cur === 'USD') return 'currency must be XOF or EUR (USD is the base, rate 1)';
  if (!DAY_RE.test(String(x.effective_from || '')) || Number.isNaN(Date.parse(x.effective_from + 'T00:00:00Z'))) return 'effective_from must be YYYY-MM-DD';
  const n = Number(x.rate);
  if (!(Number.isFinite(n) && n > 0)) return 'rate must be a number > 0 (USD for 1 unit)';
  if (x.source == null || !String(x.source).trim() || String(x.source).length > 200) return 'source is required (e.g. BCEAO, ECB, Finance)';
  return null;
}

const BASE = Object.freeze({ id: null, currency: 'USD', rate: 1, effective_from: null, source: 'base currency' });
function rateOn(rates, currency, date) {
  const cur = String(currency || '').toUpperCase();
  if (cur === 'USD') return BASE;
  const d = String(date || '').slice(0, 10);
  let best = null;
  for (const r of rates || []) {
    if (!r || r.retired_at || String(r.currency).toUpperCase() !== cur || !(Number(r.rate) > 0)) continue;
    if (String(r.effective_from) > d) continue;
    if (!best || String(r.effective_from) > String(best.effective_from)) best = r;
  }
  return best ? { id: best.id == null ? null : Number(best.id), currency: cur, rate: Number(best.rate), effective_from: best.effective_from, source: best.source || null } : null;
}
const describe = (r) => (r.id == null ? 'USD (base)' : `${r.currency}→USD @ ${r.rate} (rate #${r.id}, from ${r.effective_from}, ${r.source || 'no source'})`);

function convert(amount, from, to, date, rates) {
  const f = String(from || '').toUpperCase(), t = String(to || '').toUpperCase(), d = String(date || '').slice(0, 10);
  const a = Number(amount);
  const out = { amount: Number.isFinite(a) ? a : null, from: f, to: t, date: d, value: null, from_rate: null, to_rate: null, basis: null, missing: [] };
  if (out.amount == null) { out.missing = ['amount']; return out; }
  const fr = rateOn(rates, f, d), tr = rateOn(rates, t, d);
  if (!fr) out.missing.push(f); if (!tr && t !== f) out.missing.push(t);
  if (out.missing.length) return out;
  out.from_rate = fr; out.to_rate = tr;
  out.value = f === t ? round2(a) : round2((a * fr.rate) / tr.rate);
  out.basis = f === t ? `${f}, no conversion` : (t === 'USD' ? describe(fr) : f === 'USD' ? `USD→${t} via ${describe(tr)}` : `${describe(fr)} then USD→${t} via ${describe(tr)}`) + ` · on ${d}`;
  return out;
}

/** [{currency, amount}] → per-currency lines + a converted total ONLY when every line converted. */
function convertTotals(list, to, date, rates) {
  const lines = (list || []).filter((x) => x && x.amount != null).map((x) => ({ currency: String(x.currency).toUpperCase(), amount: Number(x.amount), conversion: convert(x.amount, x.currency, to, date, rates) }));
  const missing = [...new Set(lines.flatMap((l) => l.conversion.missing))];
  const used = new Map();
  for (const l of lines) for (const r of [l.conversion.from_rate, l.conversion.to_rate]) if (r && r.id != null) used.set(r.id, r);
  return { to: String(to || '').toUpperCase(), date: String(date || '').slice(0, 10),
    by_currency: lines.map((l) => ({ currency: l.currency, amount: l.amount, converted: l.conversion.value, basis: l.conversion.basis })),
    converted_total: missing.length || !lines.length ? null : round2(lines.reduce((s, l) => s + l.conversion.value, 0)),
    missing, rates_used: [...used.values()], never_summed_without_rate: true };
}

/** The user's display currency: their preference, else their site's currency (if supported), else USD. */
function displayCurrency({ pref, siteCurrency } = {}) {
  for (const c of [pref, siteCurrency]) { const u = String(c || '').toUpperCase(); if (SUPPORTED.includes(u)) return u; }
  return 'USD';
}

module.exports = { SUPPORTED, validateRate, rateOn, convert, convertTotals, displayCurrency };
