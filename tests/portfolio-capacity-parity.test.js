'use strict';
// F-PRODUCT-02 — one fixture, three outputs: the portfolio tile, the A11 exception queue and the workbook Capacity
// sheet show the SAME conflicts; an unknown allocation is "unknown" on the three, never "none" and never 0.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const SCH = require('../services/projectSchedule');
const AC = require('../public/lib/allocationContract');
const PV = require('../public/lib/ppmVisuals');
const PX = require('../services/ppmAlerts');
const DECK = require('../services/portfolioDeck');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// fictitious portfolio
const t = (id, owner, o) => ({ id, project_id: 1, name: 'T' + id, owner, status: 'todo', start_date: '2027-01-04', end_date: '2027-01-08', depends_on: [], ...o });
const tasks = [t(1, 'Ana', { allocation_pct: 70 }), t(2, 'Ana', { allocation_pct: 50 }), t(3, 'Bob', { allocation_pct: 60 }), t(4, 'Bob', { allocation_pct: null }), t(5, 'Cy', { allocation_pct: 100 }), t(6, 'Cy', { allocation_pct: 10, start_date: '2027-01-08', end_date: '2027-01-09' }), t(7, 'Dee', {})];
const view = { as_of: '2027-01-02T00:00:00Z', projects: [{ id: 1, key: 'P1', name: 'Fixture', stage: 'in_progress', status: 'active', owner: 'pmo' }], tasks, milestones: [], risks: [] };

test('tile count = exception count = workbook rows, on the same fixture', () => {
  const conflicts = SCH.resourceConflicts(tasks), cov = SCH.resourceCoverage(tasks);
  assert.equal(conflicts.length, 2, 'Ana 120 %, Cy 110 %');
  const alerts = PX.findExceptions(view, { today: '2027-01-02', capacity: conflicts }).filter((x) => x.kind === 'capacity_overload');
  const sheet = XLSX.utils.sheet_to_json(XLSX.read(DECK.buildWorkbookBuffer(view, {}), { type: 'buffer' }).Sheets.Capacity);
  const wbConf = sheet.filter((r) => r.kind === 'conflict');
  assert.equal(alerts.length, conflicts.length);
  assert.equal(wbConf.length, conflicts.length);
  assert.deepEqual(wbConf.map((r) => [r.owner, r.from, r.to, r.peak_pct]), conflicts.map((c) => [c.owner, c.from, c.to, c.peak_pct]));
  assert.deepEqual(alerts.map((a) => a.owner).sort(), conflicts.map((c) => c.owner).sort());
  // the page's own pressure view flags the same people
  const over = PV.resourcePressure(tasks, { today: '2027-01-04' }).people.filter((p) => p.over_weeks).map((p) => p.owner).sort();
  assert.deepEqual(over, ['Ana', 'Cy']);
  // tile text: the count, and the unknown share next to it
  assert.equal(AC.coverageText(cov, conflicts.length), '2 · 2 unknown');
  assert.equal(sheet.filter((r) => r.kind === 'possible conflict').length, cov.possible_conflicts.length);
  assert.equal(cov.possible_conflicts.length, 1, 'Bob 60 % + unknown; Dee alone is not a possible conflict');
});

test('no known conflict but unknown allocations: the tile says "none known · N unknown", the panel explains, nothing reads 0', () => {
  const only = [t(3, 'Bob', { allocation_pct: 60 }), t(4, 'Bob', { allocation_pct: null })];
  const cov = SCH.resourceCoverage(only);
  assert.equal(AC.coverageText(cov, 0), 'none known · 1 unknown');
  const h = PV.coverageHtml(cov, 0, esc);
  assert.match(h, /this is not “none”/); assert.match(h, /Possible conflicts/); assert.match(h, /60 % known/);
  assert.doesNotMatch(h, /Nobody is booked above 100 %/);
  assert.match(PV.coverageHtml(SCH.resourceCoverage([t(1, 'Ana', { allocation_pct: 50 })]), 0, esc), /Nobody is booked above 100 %/);
  assert.match(PV.coverageHtml(SCH.resourceCoverage([t(1, '<b>x', { allocation_pct: 50 }), t(2, '<b>x', {})]), 0, esc), /&lt;b&gt;x/);
});

test('pages and callers are wired: tile reads resource_coverage, the queue and the nightly job pass capacity', () => {
  const pf = read('public/portfolio.html');
  assert.match(pf, /AllocationContract\.coverageText\(cov, rc\)/);
  assert.match(pf, /rc \|\| !blind \? rc : "—"/, 'no "0" tile number while allocations are unknown');
  assert.match(pf, /PpmVisuals\.coverageHtml\(cov, conf\.length, esc\)/);
  assert.match(read('public/project.html'), /PpmVisuals\.coverageHtml\(V\.resource_coverage, rc\.length, esc\)/);
  assert.match(read('routes/governance.js'), /capacity: require\('\.\.\/services\/projectSchedule'\)\.resourceConflicts\(v\.tasks \|\| \[\]\)/);
  assert.match(read('tools/governance/ppm-alerts.js'), /capacity: resourceConflicts\(pf\.tasks \|\| \[\]\)/);
});
