'use strict';
// E-V01 — no-growth design ratchet. Per page, hex-colour literals, dual axes (yAxisID) and doughnut/pie charts may
// only go DOWN from the budget recorded here (counts by tools/agent/ui-inventory.js). Lower a budget when you migrate
// a page; never raise one — use a _tokens.css variable instead, and see docs/ux/CHART-INVENTORY.md for the
// substitution to consider (small multiples instead of a dual axis, ordered bars instead of a doughnut).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('../tools/agent/ui-inventory');

const BUDGETS = {
  "public/access.html": {hex: 16},
  "public/analytics.html": {hex: 32, doughnut: 1},
  "public/assets.html": {hex: 230, dualAxis: 2, doughnut: 4},
  "public/cockpit.html": {hex: 47},
  "public/commitments.html": {hex: 19},
  "public/coverage.html": {hex: 25},
  "public/dashboard-composer.html": {hex: 41},
  "public/dashboards.html": {hex: 25},
  "public/exec-view.html": {hex: 108},
  "public/executive-report.html": {hex: 294, dualAxis: 8, doughnut: 4},
  "public/executive.html": {hex: 1080, dualAxis: 11, doughnut: 3},
  "public/handoffs.html": {hex: 21},
  "public/help.html": {hex: 85},
  "public/home.html": {hex: 12},
  "public/index.html": {hex: 114},
  "public/infra-health.html": {hex: 88, doughnut: 2},
  "public/inspection-actions.html": {hex: 100, doughnut: 3},
  "public/inspection.html": {hex: 200},
  "public/inspections.html": {hex: 105, doughnut: 3},
  "public/integrations.html": {hex: 40},
  "public/it-review.html": {hex: 71},
  "public/itsm-integrations-plan.html": {hex: 44},
  "public/itsm-roadmap.html": {hex: 47},
  "public/kpi-builder.html": {hex: 39},
  "public/login.html": {hex: 32},
  "public/meeting.html": {hex: 105},
  "public/meetings-actions.html": {hex: 102, doughnut: 3},
  "public/meetings-compliance.html": {hex: 68},
  "public/meetings-council.html": {hex: 57},
  "public/meetings-import.html": {hex: 136},
  "public/meetings-insights.html": {hex: 105, doughnut: 1},
  "public/meetings-issues.html": {hex: 80},
  "public/meetings-progress.html": {hex: 106},
  "public/meetings-setup.html": {hex: 58},
  "public/meetings-unsigned.html": {hex: 62},
  "public/meetings.html": {hex: 87},
  "public/notifications.html": {hex: 41},
  "public/obligations.html": {hex: 13},
  "public/policies.html": {hex: 15},
  "public/portfolio.html": {hex: 74},
  "public/project.html": {hex: 79},
  "public/report-studio.html": {hex: 42},
  "public/reports.html": {hex: 818},   // E-A02: 15 moved with the Backups cards to lib/reports-backups.js
  "public/rfi.html": {hex: 40},
  "public/site-actions.html": {hex: 76},
  "public/site-awareness.html": {hex: 131, dualAxis: 4, doughnut: 5},
  "public/site-report.html": {hex: 75},
  "public/system-logs.html": {hex: 57},
  "public/tracker-builder.html": {hex: 30},
  "public/trackers.html": {hex: 33},
  "public/wan-health.html": {hex: 1},
  "public/wan-sla.html": {hex: 1},
  "public/wan.html": {hex: 99, dualAxis: 2},
  "public/lib/chartTheme.js": {hex: 14},
  "public/lib/charts.js": {hex: 7},
  "public/lib/dashboard-shared.js": {hex: 1},
  "public/lib/incubationEditor.js": {hex: 1},
  "public/lib/moneyCertBand.js": {hex: 3},
  "public/lib/reasonDialog.js": {hex: 10},
  "public/lib/reports-backups.js": {hex: 15},   // E-A02 — moved from reports.html, no restyling in this goal
  "public/lib/siteCodeBanner.js": {hex: 3},
  "public/lib/siteOnboardingCard.js": {hex: 4},
  "public/lib/statusTransfer.js": {hex: 11},
  "public/lib/tableScroll.js": {hex: 1},
  "public/lib/trustLabel.js": {hex: 1},
};

function fmt(b) {
  return b.map((x) => `${x.file}: ${x.key} ${x.got} > budget ${x.allowed} — use a token / see docs/ux/CHART-INVENTORY.md`).join('\n');
}

test('no page exceeds its design budget (hex literals, dual axes, doughnuts)', () => {
  const { rows } = U.build();
  const breaches = U.checkBudgets(rows, BUDGETS);
  assert.deepEqual(breaches, [], fmt(breaches));
});

test('a fixture page with one extra hex literal breaches its budget', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-inv-'));
  fs.mkdirSync(path.join(dir, 'public', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'public', 'fixture.html'), '<style>a{color:#112233}b{color:#abc}</style><p>&#123;</p>');
  const { rows } = U.build({ root: dir });
  assert.equal(rows[0].hex, 2, 'two colour literals, the HTML entity is not one');
  assert.equal(rows[0].styleBlocks, 1);
  const breaches = U.checkBudgets(rows, { 'public/fixture.html': { hex: 1 } });
  assert.equal(breaches.length, 1);
  assert.match(fmt(breaches), /hex 2 > budget 1 — use a token/);
});

test('dual axes and doughnuts are counted; chart theme / table / state libraries detected', () => {
  const s = U.scanText("<script src='lib/chartTheme.js'></script><script>new Chart(c,{type:'doughnut'});new Chart(d,{type:'line',data:{datasets:[{yAxisID:'y1'}]}});ChartTable.rows()</script>");
  assert.equal(s.newChart, 2);
  assert.equal(s.dualAxis, 1);
  assert.equal(s.doughnut, 1);
  assert.deepEqual(s.types, { doughnut: 1, line: 1 });
  assert.equal(s.chartTheme, true);
  assert.equal(s.chartTable, true);
  assert.equal(s.pageStates, false);
  assert.match(U.substitution(s), /small multiples/);
  assert.match(U.substitution(s), /horizontal bars/);
});

// Freshness of the generated file is NOT asserted here (page bytes move with every edit and would turn every
// unrelated page change red); run `node tools/agent/ui-inventory.js --check` before a release.
test('docs/ux/CHART-INVENTORY.md exists, says it is generated, and lists every scanned file', () => {
  const { rows, markdown } = U.build();
  assert.match(markdown, /generated — do not edit/);
  const cur = fs.readFileSync(U.OUT, 'utf8');
  assert.match(cur, /generated — do not edit/);
  for (const r of rows) assert.ok(cur.includes('| `' + r.file + '` |'), r.file + ' missing — run node tools/agent/ui-inventory.js');
});

test('metric triage: every registry metric is listed in METRIC-TRIAGE.json; a missing one fails --check', () => {
  const MM = require('../tools/agent/metric-map');
  const { SEED } = require('../services/metricRegistry');
  const triage = MM.readTriage(path.join(__dirname, '..'));
  for (const m of SEED) assert.ok(triage.metrics[m.key], m.key + ' missing from docs/ux/METRIC-TRIAGE.json');
  for (const k of Object.keys(triage.metrics)) assert.ok(triage.statuses.includes(triage.metrics[k].status), k);
  const rows = SEED.map((m) => ({ key: m.key }));
  const partial = { metrics: Object.assign({}, triage.metrics) };
  delete partial.metrics[SEED[0].key];
  assert.deepEqual(MM.missingTriage(rows, partial), [SEED[0].key]);
  assert.deepEqual(MM.missingTriage(rows, triage), []);
  assert.ok(MM.build().markdown.includes('| Triage |'));
});
