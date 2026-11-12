'use strict';
// E-P03 (audit P-03, X-P-01) — capacity per site × week + conflicts sorted by excess then duration (public/lib/ppmVisuals.js,
// pure, no money); static checks of the pages (panel hidden until the switch answers, reassignment reason prompt).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const PV = require('../public/lib/ppmVisuals');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

// fictitious tasks: projects 1 (site 10) and 2 (site 20); week of 2026-11-02 and 2026-11-09
const projects = [{ id: 1, site_id: 10 }, { id: 2, site_id: 20 }, { id: 3, site_id: null }];
const tasks = [
  { id: 1, project_id: 1, owner: 'Ana', start_date: '2026-11-02', end_date: '2026-11-13', allocation_pct: 80 },
  { id: 2, project_id: 1, owner: 'Ana', start_date: '2026-11-02', end_date: '2026-11-06', allocation_pct: 50 },
  { id: 3, project_id: 1, owner: 'Bob', start_date: '2026-11-02', end_date: '2026-11-13', allocation_pct: 40 },
  { id: 4, project_id: 2, owner: 'Cy', start_date: '2026-11-02', end_date: '2026-11-13', allocation_pct: 90 },
  { id: 7, project_id: 2, owner: 'Cy', start_date: '2026-11-02', end_date: '2026-11-13', allocation_pct: 60 },
  { id: 5, project_id: 2, owner: 'Dee', start_date: '2026-11-09', end_date: '2026-11-13', allocation_pct: null },
  { id: 6, project_id: 3, owner: 'Eve', start_date: '2026-11-02', end_date: '2026-11-03', allocation_pct: 30 },
];

test('capacityBySite: per site and week the known peaks are SUMMED; people over 100 % counted', () => {
  const v = PV.capacityBySite(tasks, projects, { today: '2026-11-04' });
  assert.deepEqual(v.weeks, ['2026-11-02', '2026-11-09']);
  assert.deepEqual(v.sites.map((s) => s.site), ['10', '20', 'none'], 'a project without a site is under "none"');
  const s10 = v.sites.find((s) => s.site === '10');
  assert.equal(s10.weeks[0].total_pct, 130 + 40, 'Ana 130 + Bob 40');
  assert.equal(s10.weeks[0].people_over, 1);
  assert.equal(s10.weeks[1].total_pct, 80 + 40);
  assert.equal(s10.weeks[1].people_over, 0);
  assert.equal(s10.over_weeks, 1);
});

test('capacityBySite: unknown allocation stays unknown (never 0 %), a week with only unknown is not measured', () => {
  const v = PV.capacityBySite(tasks, projects, { today: '2026-11-04' });
  const s20 = v.sites.find((s) => s.site === '20');
  assert.equal(s20.weeks[1].unknown, 1, 'Dee has no allocation');
  assert.equal(s20.weeks[1].total_pct, 150, 'Dee is not counted as 0 nor 100');
  const only = PV.capacityBySite([{ id: 9, project_id: 1, owner: 'Zed', start_date: '2026-11-02', end_date: '2026-11-03' }], projects, {});
  assert.equal(only.sites[0].weeks[0].total_pct, null);
  assert.equal(only.sites[0].weeks[0].unknown, 1);
  assert.equal(only.sites[0].unknown_tasks, 1);
});

test('capacityBySite follows the allocation contract (F-PRODUCT-01): a legacy 150 % is invalid, never summed, never a conflict', () => {
  const v = PV.capacityBySite([{ id: 1, project_id: 1, owner: 'Ana', start_date: '2026-11-02', end_date: '2026-11-06', allocation_pct: 150 }, { id: 2, project_id: 1, owner: 'Ana', start_date: '2026-11-02', end_date: '2026-11-06', allocation_pct: 60 }], projects, { today: '2026-11-04' });
  const w = v.sites[0].weeks[0];
  assert.equal(w.total_pct, 60); assert.equal(w.invalid, 1); assert.equal(w.people_over, 0);
  assert.deepEqual(v.conflicts, []);
  assert.equal(v.coverage.invalid, 1); assert.equal(v.coverage.possible_conflicts.length, 1);
  assert.equal(v.sites[0].invalid_tasks, 1);
});

test('capacityConflicts: consecutive weeks merged, sorted by excess then duration; suggestion is a proposal only', () => {
  const v = PV.capacityBySite(tasks, projects, { today: '2026-11-04' });
  assert.deepEqual(v.conflicts.map((c) => [c.owner, c.excess_pct, c.weeks]), [['Cy', 50, 2], ['Ana', 30, 1]]);
  const cy = v.conflicts[0];
  assert.equal(cy.from, '2026-11-02'); assert.equal(cy.to, '2026-11-09'); assert.deepEqual(cy.task_ids, [4, 7]);
  // Bob is at 40 % in both weeks; Dee's week-2 allocation is unknown and Eve is free in week 2 but has a task in week 1
  assert.ok(cy.suggestion && cy.suggestion.proposal === true);
  assert.equal(cy.suggestion.to, 'Eve', 'lowest known peak first (Eve 30 % < Bob 40 %), Dee excluded (unknown)');
  assert.match(cy.suggestion.text, /^Proposal only:/);
  const sorted = PV.capacityConflicts({ weeks: ['a', 'b', 'c'], people: [
    { owner: 'Long', cells: [{ over: true, peak_pct: 120, task_ids: [1] }, { over: true, peak_pct: 120, task_ids: [1] }, { over: false }] },
    { owner: 'Short', cells: [{ over: true, peak_pct: 120, task_ids: [2] }, { over: false }, { over: false }] },
  ] });
  assert.deepEqual(sorted.map((c) => c.owner), ['Long', 'Short'], 'same excess → the longer first');
});

test('capacityHtml: escaped, no money, unknown worded; empty view says so', () => {
  const v = PV.capacityBySite(tasks, projects, { today: '2026-11-04' });
  const esc = (x) => String(x).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
  const h = PV.capacityHtml(v, esc, (k) => (k === '10' ? '<b>Site A</b>' : 'Site ' + k));
  assert.match(h, /&#60;b&#62;Site A/);
  assert.match(h, /No money in this view/);
  assert.match(h, /\+1 unknown/);
  assert.doesNotMatch(h, /budget|spent|USD|XOF/i);
  assert.match(PV.capacityHtml({ sites: [], weeks: [], conflicts: [] }, esc), /No open task/);
});

test('pages: the capacity panel is hidden until the switch answers; project.html asks a reason only with the switch on', () => {
  const pf = read('public/portfolio.html');
  assert.match(pf, /id="capacity-panel" hidden/);
  assert.match(pf, /\/api\/governance\/ppm\/capacity/);
  const pj = read('public/project.html');
  assert.match(pj, /FEAT\.capacity && String\(was \|\| ""\)\.trim\(\) !== String\(b\.owner \|\| ""\)\.trim\(\)/);
  assert.match(pj, /REASON_REQUIRED/);
  const doc = read('docs/ops/CAPACITY-DATA-CONTRACT.md');
  assert.match(doc, /DRAFT/); assert.match(doc, /HR data is not a source/i);
});
