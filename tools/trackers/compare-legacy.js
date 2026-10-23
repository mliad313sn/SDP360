#!/usr/bin/env node
'use strict';
// Step 7 — acceptance of the tracker migration. READ ONLY: loads the IT Activity Tracker as the server does,
// scores it with the legacy engine and with the business-tracker engine, prints the largest gap (in points) and
// any colour that differs. The study's criterion: no gap above 0.1 point, no colour difference.
//
//   node tools/trackers/compare-legacy.js [--year=2026] [--month=12] [--json]
//
// Exit code 0 = accepted, 2 = a gap or a colour difference was found.
if (require.main === module) require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

async function main(argv) {
  const arg = (k, d) => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
  const year = Number(arg('year', new Date().getFullYear()));
  const month = Math.max(1, Math.min(12, Number(arg('month', 12)) || 12));
  const tdb = require('../../tracker-db');
  if (tdb.TRACKER_BACKEND === 'postgres' && tdb.initPgTracker) await tdb.initPgTracker();
  const D = await tdb.loadTracker();
  const r = require('../../services/trackers/legacyCompare').compare(D, year, { month });
  if (argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); return r.accepted ? 0 : 2; }
  console.log(`Tracker ${year}, months 1-${month}: ${r.units} active units × ${r.items} items, ${r.checks} comparisons`);
  console.log(`Largest gap: ${r.max_gap_points} point(s) (criterion ≤ 0.1) · colour differences: ${r.colour_mismatches}`);
  for (const w of r.worst) console.log(`  ${w.where}: legacy ${w.legacy} · new ${w.next}${w.gap != null ? ` (gap ${Math.round(w.gap * 10000) / 100} pt)` : ''}`);
  console.log(r.accepted ? 'ACCEPTED — the new engine reproduces the tracker.' : 'NOT ACCEPTED — see the gaps above.');
  return r.accepted ? 0 : 2;
}

if (require.main === module) main(process.argv.slice(2)).then(c => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
module.exports = { main };
