'use strict';
// E-D07 (audit D-09) — data-quality board, PURE composition of signals that already exist:
//   per SOURCE (sync job): freshness (sync_runs last ok vs FRESHNESS_HOURS), content drift + duplicates
//                          (services/sync/drift.js, E-D04);
//   per SITE:              asset hygiene completeness, money coverage (share of assets with a cost),
//                          site-code disagreements (services/siteCodeRegistry.diff);
//   global:                unmapped Risk-Register site labels for the month.
// Each cell = { value, status: 'ok' | 'warn' | 'UNKNOWN', fix } — fix is the page where it is corrected.
// RULE: a signal we could not read is UNKNOWN, never ok; no score is invented for a source with no data.
// The two % lines below are PROPOSITIONS (no approved threshold exists) and are returned with the answer.
const PROPOSED = Object.freeze({ completeness_warn_below_pct: 80, money_coverage_warn_below_pct: 50 });
const FIX = Object.freeze({
  sync: 'system-logs.html', hygiene: 'assets.html#hygiene', money: 'assets.html#finance',
  site_codes: 'policies.html', risk_register: 'reports.html#admin/risk',
});
const H = 3600000;
const cell = (value, status, fix, extra) => ({ value, status, fix, ...(extra || {}) });

function sourceRows({ syncRows, freshness, drift, now = Date.now() }) {
  const by = new Map((Array.isArray(syncRows) ? syncRows : []).map((r) => [r.job, r]));
  return Object.keys(freshness || {}).sort().map((job) => {
    let fr;
    if (!Array.isArray(syncRows)) fr = cell(null, 'UNKNOWN', FIX.sync, { reason: 'run log unreadable' });
    else {
      const last = by.get(job) && by.get(job).last_ok;
      const t = last ? Date.parse(last) : NaN;
      if (!Number.isFinite(t)) fr = cell(null, 'UNKNOWN', FIX.sync, { reason: 'never synced' });
      else { const age = Math.round(((now - t) / H) * 10) / 10; fr = cell(age, age <= Number(freshness[job]) ? 'ok' : 'warn', FIX.sync, { unit: 'h', limit_h: Number(freshness[job]) }); }
    }
    const d = drift && drift[job];
    let dr, dup;
    if (!d || d.status === 'unknown') {
      dr = cell(null, 'UNKNOWN', FIX.sync, { reason: (d && d.reason) || 'drift not computed' });
      dup = cell(null, 'UNKNOWN', FIX.sync);
    } else {
      dr = cell(d.flags || [], d.status === 'drift' ? 'warn' : 'ok', FIX.sync);
      dup = d.duplicates_pct == null ? cell(null, 'UNKNOWN', FIX.sync) : cell(d.duplicates_pct, (d.flags || []).includes('duplicates_rate') ? 'warn' : 'ok', FIX.sync, { unit: '%' });
    }
    return { source: job, freshness: fr, drift: dr, duplicates: dup };
  });
}

function _norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+it agents?$/, '').trim(); }

function siteRows({ sites, hygieneBySite, siteCodeDiff }) {
  const hy = Array.isArray(hygieneBySite) ? hygieneBySite : null;
  const diff = Array.isArray(siteCodeDiff) ? siteCodeDiff : null;
  return (sites || []).map((s) => {
    const h = hy ? hy.find((r) => _norm(r.site) === _norm(s.name)) : null;
    let completeness, money;
    if (!hy) { completeness = cell(null, 'UNKNOWN', FIX.hygiene, { reason: 'asset hygiene unreadable' }); money = cell(null, 'UNKNOWN', FIX.money, { reason: 'asset hygiene unreadable' }); }
    else if (!h || !(Number(h.total) > 0)) { completeness = cell(null, 'UNKNOWN', FIX.hygiene, { reason: 'no asset under this site label' }); money = cell(null, 'UNKNOWN', FIX.money, { reason: 'no asset under this site label' }); }
    else {
      completeness = h.completeness == null ? cell(null, 'UNKNOWN', FIX.hygiene) : cell(h.completeness, h.completeness >= PROPOSED.completeness_warn_below_pct ? 'ok' : 'warn', FIX.hygiene, { unit: '%', assets: Number(h.total) });
      money = h.cost_pct == null ? cell(null, 'UNKNOWN', FIX.money) : cell(h.cost_pct, h.cost_pct >= PROPOSED.money_coverage_warn_below_pct ? 'ok' : 'warn', FIX.money, { unit: '%', assets: Number(h.total) });
    }
    let codes;
    if (!diff) codes = cell(null, 'UNKNOWN', FIX.site_codes, { reason: 'site-code registry unreadable' });
    else {
      const mine = diff.filter((d) => Number(d.site_id) === Number(s.id));
      codes = cell(mine.length, mine.length ? 'warn' : 'ok', FIX.site_codes, { kinds: [...new Set(mine.map((d) => d.kind))] });
    }
    return { site_id: Number(s.id), site: s.name, hygiene_completeness: completeness, money_coverage: money, site_code_disagreements: codes };
  });
}

function riskRegister(unmapped, month) {
  if (!Array.isArray(unmapped)) return cell(null, 'UNKNOWN', FIX.risk_register, { month, reason: 'incident labels unreadable' });
  return cell(unmapped.length, unmapped.length ? 'warn' : 'ok', FIX.risk_register, { month, labels: unmapped.slice(0, 50).map((u) => ({ label: u.sdp_label, tickets: Number(u.ticket_count) || 0 })) });
}

function compose(r = {}) {
  const now = r.now != null ? r.now : Date.now();
  const sources = sourceRows({ syncRows: r.syncRows, freshness: r.freshness, drift: r.drift, now });
  const sites = siteRows({ sites: r.sites, hygieneBySite: r.hygieneBySite, siteCodeDiff: r.siteCodeDiff });
  const rr = riskRegister(r.unmappedRiskLabels, r.month);
  const all = [...sources.flatMap((x) => [x.freshness, x.drift, x.duplicates]), ...sites.flatMap((x) => [x.hygiene_completeness, x.money_coverage, x.site_code_disagreements]), rr];
  const counts = { ok: 0, warn: 0, UNKNOWN: 0 };
  for (const c of all) counts[c.status] = (counts[c.status] || 0) + 1;
  return { checked_at: new Date(now).toISOString(), counts, thresholds_proposed: PROPOSED, sources, sites, risk_register_unmapped: rr };
}

module.exports = { compose, sourceRows, siteRows, riskRegister, PROPOSED, FIX };
