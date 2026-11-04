'use strict';
// services/moneyCoverage.js — A-16: per-site money coverage + the switchable
// "Non certifié" state for the Assets money views (Finance, Depreciation,
// Investment). PURE: no DB, no I/O, no clock.
//
// Why: on the real AP export only MANA (226/499) and Ouagadougou (1/1) carry a
// purchase cost — a "fleet" total is essentially MANA presented as the group.
// Coverage says which sites a money figure actually rests on; certify() applies
// a PROPOSED policy (not approved — owner: Finance / IT management):
//   certified only when ≥ minSites sites have eligible assets AND eligible
//   assets are ≥ minPct % of the assets in scope.
// A figure with no eligible asset is NEVER certified, whatever the thresholds.
// A percentage with no denominator is null (not measured), never 0.

const DEFAULT_MIN_SITES = 3;
const DEFAULT_MIN_PCT = 50;

// Integer percentage; total 0 → null (not measured), never NaN or 0.
function pctOf(eligible, total) {
  return total > 0 ? Math.round((100 * eligible) / total) : null;
}

// rows → [{site, eligible, total, pct}] sorted by site. Every site present in
// `rows` is listed, including sites with 0 eligible (they are the point).
function coverageBySite(rows, { isEligible, siteOf } = {}) {
  const elig = typeof isEligible === 'function' ? isEligible : () => false;
  const site = typeof siteOf === 'function' ? siteOf : (r) => r && r.site;
  const acc = new Map();
  for (const r of (rows || [])) {
    const s = site(r);
    const key = s == null ? '' : String(s);
    if (!acc.has(key)) acc.set(key, { eligible: 0, total: 0 });
    const a = acc.get(key);
    a.total++;
    if (elig(r)) a.eligible++;
  }
  return [...acc.keys()].sort().map((k) => {
    const a = acc.get(k);
    return { site: k, eligible: a.eligible, total: a.total, pct: pctOf(a.eligible, a.total) };
  });
}

function _num(v, dflt) {
  if (v == null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

// coverageBySite → {certified, reason, sites_covered, sites_total, eligible,
// total, pct, min_sites, min_pct}. reason ∈ null | no_eligible | too_few_sites |
// low_coverage (first failing rule, in that order).
function certify(cov, { minSites, minPct } = {}) {
  const ms = _num(minSites, DEFAULT_MIN_SITES);
  const mp = _num(minPct, DEFAULT_MIN_PCT);
  const list = Array.isArray(cov) ? cov : [];
  let eligible = 0, total = 0, covered = 0;
  for (const c of list) {
    eligible += c.eligible || 0;
    total += c.total || 0;
    if ((c.eligible || 0) > 0) covered++;
  }
  const pct = pctOf(eligible, total);
  let reason = null;
  if (eligible === 0) reason = 'no_eligible';
  else if (covered < ms) reason = 'too_few_sites';
  else if (pct == null || pct < mp) reason = 'low_coverage';
  return {
    certified: reason === null,
    reason,
    sites_covered: covered,
    sites_total: list.length,
    eligible,
    total,
    pct,
    min_sites: ms,
    min_pct: mp,
  };
}

// report_config → {display:'0'|'1', minSites, minPct}. Anything but '1' is '0'
// (today's UI unchanged).
function optsFromConfig(cfg) {
  const c = cfg || {};
  return {
    display: String(c.asset_money_certify_display) === '1' ? '1' : '0',
    minSites: _num(c.asset_money_certify_min_sites, DEFAULT_MIN_SITES),
    minPct: _num(c.asset_money_certify_min_pct, DEFAULT_MIN_PCT),
  };
}

// The banner sentence (French, as used on the pages and the digest). null when
// certified. An unmeasured pct reads "—", never "0 %". No currency glyph.
function sentence(cert) {
  if (!cert || cert.certified) return null;
  const pct = cert.pct == null ? '—' : String(cert.pct);
  return `Non certifié — couvre ${cert.sites_covered || 0} site(s) / ${pct} % du parc ` +
    `(seuil : ≥ ${cert.min_sites} sites et ≥ ${cert.min_pct} %)`;
}

module.exports = {
  DEFAULT_MIN_SITES,
  DEFAULT_MIN_PCT,
  pctOf,
  coverageBySite,
  certify,
  optsFromConfig,
  sentence,
};
