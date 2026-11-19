'use strict';
// P08 §6 — site_codes_from_registry READINESS: the difference report a human reads before switching the
// registry on (report_config site_codes_from_registry: '0' → 'shadow' → '1', human gate 10). Nothing is switched
// and nothing is written: one read of `sites` + `site_module_codes`, the modules' hard-coded maps, then
// services/siteCodeRegistry.diff (the same diff GET /api/governance/site-codes shows) and siteOnboarding.fillPlan
// (the dry-run fill). The verdict lists what still blocks; the switch decision stays with the data owner + KPI committee.
//
//   PG_URL=… node tools/sites/site-code-readiness.js [--out=FILE.md]
const fs = require('fs');
const SCR = require('../../services/siteCodeRegistry');
const OB = require('../../services/siteOnboarding');

const hardMaps = () => ({ tracker: (n) => require('../../tracker-db').hardSiteNameToCode(n), inspection: (n) => require('../../inspection-db').hardSiteNameToCode(n), meetings: (n) => require('../../inspection-db').hardSiteNameToCode(n) });

/** Pure: diff rows → readiness summary. BLOCKING = a code the two sides disagree on, or one code shared by two sites. */
function readiness(diff, plan) {
  const by = {}; for (const r of diff) { const k = `${r.module}|${r.kind}`; by[k] = (by[k] || 0) + 1; }
  const blocking = diff.filter((r) => r.kind === 'different' || r.kind === 'shared_code');
  const fillable = (plan && plan.proposed) || []; const unfillable = (plan && plan.skipped) || [];
  const verdict = blocking.length ? 'NOT READY — differences to arbitrate' : unfillable.length ? 'NOT READY — registry gaps without a hard-coded code' : fillable.length ? 'READY AFTER FILL — apply the dry-run fill, then shadow' : 'READY FOR SHADOW';
  return { verdict, counts: by, blocking, fillable, unfillable };
}

function markdown(r, status) {
  const L = [`# site_codes_from_registry — readiness (difference report)`, '', `Generated ${new Date().toISOString()} · current switch: \`${status && status.mode || 'unknown'}\` · **${r.verdict}**`, '',
    'The switch is NOT changed by this report. Gate 10: data owner + KPI committee decide `shadow` (≥ 2 weeks of divergence log) then `1`.', '',
    '## Counts by module and kind', '', '| Module | Kind | Sites |', '|---|---|---|',
    ...Object.entries(r.counts).sort().map(([k, n]) => { const [m, kind] = k.split('|'); return `| ${m} | ${kind} | ${n} |`; }), '',
    '## Blocking differences (a human arbitrates each)', '', '| Module | Site | Hard-coded | Registry | Kind | Shared with |', '|---|---|---|---|---|---|',
    ...(r.blocking.length ? r.blocking.map((x) => `| ${x.module} | ${x.site} | ${x.hard_coded || '—'} | ${x.registry || '—'} | ${x.kind}${x.source ? ' (' + x.source + ')' : ''} | ${(x.shared_with || []).join(', ') || '—'} |`) : ['| — | none | | | | |']), '',
    '## Dry-run fill (registry rows that would be written from the hard-coded maps — PUT /api/governance/site-codes/:site, one by one, with a reason)', '', '| Module | Site | Code |', '|---|---|---|',
    ...(r.fillable.length ? r.fillable.map((x) => `| ${x.module} | ${x.site} | ${x.code} |`) : ['| — | nothing to fill | |']), '',
    '## Gaps the fill cannot close', '', '| Module | Site | Code | Reason |', '|---|---|---|---|',
    ...(r.unfillable.length ? r.unfillable.map((x) => `| ${x.module} | ${x.site} | ${x.code || '—'} | ${x.reason} |`) : ['| — | none | | |']), ''];
  return L.join('\n');
}

async function main(argv) {
  if (!process.env.PG_URL) { console.error('PG_URL is required (read-only use)'); return 2; }
  const { Client } = require('pg'); const c = new Client({ connectionString: process.env.PG_URL }); await c.connect();
  let sites, codes;
  try {
    sites = (await c.query('SELECT id, name, zoho_group, active FROM sites WHERE COALESCE(active,1) = 1 ORDER BY id')).rows;
    codes = (await c.query('SELECT site_id, module, code FROM site_module_codes')).rows;
  } finally { await c.end(); }
  const shim = { listSites: async () => sites, listSiteModuleCodes: async (m) => codes.filter((x) => x.module === m) };
  const diff = await SCR.diff(shim, hardMaps());
  const r = readiness(diff, OB.fillPlan(diff));
  const md = markdown(r, SCR.status());
  const out = (argv.find((a) => a.startsWith('--out=')) || '').slice(6);
  if (out) fs.writeFileSync(out, md); else console.log(md);
  return 0;
}
if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(2); });
module.exports = { readiness, markdown, main };
