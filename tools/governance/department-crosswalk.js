'use strict';
// F-PRODUCT-05 — department crosswalk check (READ-ONLY, writes nothing).
//
//   node tools/governance/department-crosswalk.js --check            # lists the department values found in data
//                                                                    # (commitments, handoffs from/to, report actions,
//                                                                    # PV issues) that the crosswalk does not map
//   node tools/governance/department-crosswalk.js --check --json     # same, as JSON
//   node tools/governance/department-crosswalk.js --check --strict   # exit 1 when at least one value is unmapped
//
// A pair is never created here: the mapping is approved by people. "not set" (blank department) is listed apart.
const path = require('path');
if (require.main === module) require('dotenv').config({ quiet: true, path: path.join(__dirname, '..', '..', '.env') });

const X = require('../../services/departmentCrosswalk');
const { makeDepartmentCrosswalkStore } = require('../../services/departmentCrosswalkStore');

function _defaultStore() {
  const rdb = require('../../reports-db'); let meetings = null;
  try { meetings = require('../../meetings-db').getDB(); } catch (_) { meetings = null; }
  return makeDepartmentCrosswalkStore({ reports: rdb.pgHandle(), meetings });
}

/** Build the report (pure once the store has answered). */
async function check({ store } = {}) {
  const S = store || _defaultStore();
  const [rows, mdNames, actionNames, data] = [await S.listCrosswalk(), await S.mdNames(), await S.actionNames(), await S.collectValues()];
  const index = X.makeIndex(rows, { mdNames });
  const c = X.check(data.values, index);
  // exact pairs present in the live lists but absent from the table (a list was extended): proposals only
  const paired = new Set(rows.filter((r) => r.md_code && r.action_department_name).map((r) => r.md_code));
  const candidates = X.proposeExactPairs(Object.entries(mdNames).map(([code, name_en]) => ({ code, name_en })), actionNames || []).filter((p) => !paired.has(p.md_code));
  return { pairs: rows.filter((r) => r.md_code && r.action_department_name), listed_alone: rows.filter((r) => !(r.md_code && r.action_department_name)), ...c, not_measured: data.not_measured, candidate_exact_pairs: candidates };
}

function format(r) {
  const L = [];
  L.push(`Department crosswalk — ${r.pairs.length} pair(s) (${r.pairs.filter((p) => p.status === 'approved').length} approved, ${r.pairs.filter((p) => p.status === 'proposed').length} proposed), ${r.listed_alone.length} value(s) listed alone`);
  L.push(`Records read: ${r.total} — mapped ${r.mapped}, unmapped ${r.unmapped_total}, department not set ${r.not_set}`);
  for (const m of r.not_measured) L.push(`  not measured: ${m.source} (${m.reason})`);
  if (!r.unmapped.length) L.push('No unmapped value in data.');
  else {
    L.push('Unmapped values found in data (never merged):');
    for (const v of r.unmapped) L.push(`  - "${v.value}" × ${v.total} [${Object.entries(v.by_source).map(([s, n]) => `${s} ${n}`).join(', ')}]${v.known ? ' (listed, no pair)' : ' (not in the crosswalk)'}`);
  }
  for (const p of r.candidate_exact_pairs) L.push(`  candidate exact pair (not written): ${p.md_code} ↔ ${p.action_department_name}`);
  L.push('Nothing was changed. A pair is approved by people (HR / department heads + Group IT).');
  return L.join('\n');
}

async function run({ argv = process.argv.slice(2), store, log = console.log } = {}) {
  if (!argv.includes('--check')) { log('usage: node tools/governance/department-crosswalk.js --check [--json] [--strict]'); return { code: 2 }; }
  const r = await check({ store });
  log(argv.includes('--json') ? JSON.stringify(r, null, 2) : format(r));
  return { code: argv.includes('--strict') && r.unmapped.length ? 1 : 0, report: r };
}

if (require.main === module) {
  (async () => {
    try {
      const rdb = require('../../reports-db'); if (typeof rdb.initPgReports === 'function') await rdb.initPgReports();
      try { const mdb = require('../../meetings-db'); if (typeof mdb.initPgMeetings === 'function') await mdb.initPgMeetings(); } catch (_) { /* meetings store optional */ }
      const { code } = await run(); process.exit(code);
    } catch (e) { console.error('[department-crosswalk] ' + (e && e.message)); process.exit(1); }
  })();
}

module.exports = { check, format, run };
