'use strict';
// D-02 (AMDEC 2026-11-05, AM-02/AM-03) — read-only onboarding checklist of the site admin card and the
// "fill the registry from the hard maps" DRY RUN. Pure: the route passes the data in. Nothing is written —
// a proposed row is applied (or not) by a super_admin through PUT /api/governance/site-codes/:site.
const MODULES = ['tracker', 'inspection', 'meetings'];

/** From the registry diff: hard-coded codes the registry lacks → proposed rows; shared or clashing codes → skipped. */
function fillPlan(diff) {
  const rows = diff || [];
  const sharedHard = new Set(rows.filter((r) => r.kind === 'shared_code' && r.source === 'hard_coded').map((r) => r.module + '|' + r.hard_coded));
  const inRegistry = new Map(); for (const r of rows) if (r.registry && r.kind !== 'shared_code') inRegistry.set(r.module + '|' + r.registry, r.site_id);
  const proposed = []; const skipped = [];
  for (const r of rows) {
    if (r.kind !== 'missing_in_registry') continue;
    const base = { module: r.module, site_id: r.site_id, site: r.site };
    if (!r.hard_coded) { skipped.push({ ...base, code: null, reason: 'no_hard_code' }); continue; }
    const k = r.module + '|' + r.hard_coded;
    if (sharedHard.has(k)) skipped.push({ ...base, code: r.hard_coded, reason: 'shared_code' });
    else if (inRegistry.has(k) && inRegistry.get(k) !== r.site_id) skipped.push({ ...base, code: r.hard_coded, reason: 'registry_clash' });
    else proposed.push({ ...base, code: r.hard_coded });
  }
  return { dry_run: true, proposed, skipped };
}

/** One row per active site: what a coordinator needs before day one, and what is missing. */
function buildOnboarding({ sites, attrs, codesFor, currencyFor, coordinatorFor, sharedFor }) {
  return (sites || []).map((s) => {
    const a = (attrs && attrs.get(Number(s.id))) || {};
    const codes = codesFor(s) || {}; const currency = currencyFor(s) || null; const coord = coordinatorFor(s) || null;
    const missing = [];
    for (const m of MODULES) {
      if (!codes[m]) { missing.push(`${m} code`); continue; }
      const w = sharedFor(s, m) || []; if (w.length) missing.push(`${m} code ${codes[m]} shared with ${w.join(', ')}`);
    }
    if (!a.country) missing.push('country');
    if (!a.business_unit) missing.push('business unit');
    if (!currency) missing.push('currency');
    if (!s.zoho_group) missing.push('Zoho group');
    if (!coord || !coord.confirmed) missing.push('coordinator');
    return { site_id: Number(s.id), site: s.name, codes, country: a.country || null, business_unit: a.business_unit || null,
      currency, zoho_group: s.zoho_group || null, coordinator: coord, missing, ready: missing.length === 0 };
  });
}
module.exports = { MODULES, fillPlan, buildOnboarding };
