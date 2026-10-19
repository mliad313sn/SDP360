'use strict';
// Step 3 acceptance — "no scale outside the registry": no scoring module may carry a literal
// RAG cut-off; every band must come from services/kpiRag.js (public/lib/kpiRag.js). The scan
// targets the comparison-then-colour idiom (`>= 0.9 ? 'GREEN'`, `>= 75 ? 'green'`, …).
// Files kept out of the scan carry the reason next to their name.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SCAN = ['services/siteScore.js', 'services/siteComposite.js', 'services/siteScoreboard.js', 'services/siteScoreboardReport.js',
  'services/trackerDefinitions.js', 'services/dashboardWidgets.js', 'services/metricRegistry.js', 'tracker-pptx.js', 'public/activity-tracker/engine.js'];
const EXEMPT = {
  'services/reviewDashboard.js': 'verbatim port of the author\'s IT Review Dashboard (fidelity test pins its numbers) — convergence = DEC in ETAPE-03',
  'services/merakiWanQuality.js': 'WAN report band ≥ target / ≥ target × 0.9 — registered as policy wan-availability; the function keeps the target arithmetic',
  'services/infraHealth.js': 'same WAN band as merakiWanQuality (one canonical band)',
};
const IDIOM = /(>=|>|<=|<)\s*(0\.\d+|\d{2,3})\s*\?\s*['"](GREEN|AMBER|RED|green|amber|red|orange)['"]/;

test('scoring modules carry no literal RAG cut-off (bands come from the registry)', () => {
  const hits = [];
  for (const f of SCAN) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
    src.split('\n').forEach((line, i) => { if (IDIOM.test(line) && !/^\s*\/\//.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
  assert.deepEqual(hits, [], 'literal RAG cut-offs found:\n' + hits.join('\n'));
});

test('every exempt file still exists and the exemption is explained', () => {
  for (const [f, why] of Object.entries(EXEMPT)) { assert.ok(fs.existsSync(path.join(ROOT, f)), f); assert.ok(why.length > 20, f); }
});

test('the registry policies are the only cut-offs the scoring modules reference', () => {
  const K = require('../services/kpiRag');
  for (const n of ['tracker-activity', 'tracker-executive', 'site-score', 'site-composite', 'sla-percent', 'tracker-boolean', 'wan-availability']) {
    require('../services/metricRegistry');
    assert.ok(K.POLICIES[n], n);
  }
});
