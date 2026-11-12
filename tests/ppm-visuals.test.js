'use strict';
// C-14 (G22 / F28) — PPM visuals: risk P × I matrix, resource pressure per person per week, Gantt keyboard + legend.
// Pure helper tests (public/lib/ppmVisuals.js) + static checks of project.html / portfolio.html / help §25.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { fnSource } = require('./_fn-source');
const PV = require('../public/lib/ppmVisuals');
const SCH = require('../services/projectSchedule');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

test('riskMatrix: cell counts equal the scored open risks; unscored never placed in a cell', () => {
  const rs = [
    { id: 1, kind: 'risk', probability: 3, impact: 3, status: 'open' },
    { id: 2, kind: 'risk', probability: 3, impact: 3, status: 'open' },
    { id: 3, probability: 1, impact: 2, status: 'open' },              // no kind = risk
    { id: 4, kind: 'risk', probability: 0, impact: 2, status: 'open' }, // 0 = not scored (riskRow maps null → 0)
    { id: 5, kind: 'risk', probability: null, impact: 3, status: 'open' },
    { id: 6, kind: 'risk', probability: 4, impact: 1, status: 'open' }, // out of scale
    { id: 7, kind: 'issue', probability: 3, impact: 3, status: 'open' },// not a risk
    { id: 8, kind: 'risk', probability: 2, impact: 2, status: 'closed' },
  ];
  const m = PV.riskMatrix(rs);
  assert.equal(m.cells.length, 9);
  const sum = m.cells.reduce((a, c) => a + c.count, 0);
  assert.equal(sum, 3);
  assert.equal(m.considered, 6);
  assert.equal(sum + m.not_scored.length, m.considered);
  assert.deepEqual(m.not_scored.map((r) => r.id).sort(), [4, 5, 6]);
  const hi = m.cells.find((c) => c.probability === 3 && c.impact === 3);
  assert.deepEqual(hi.ids, [1, 2]); assert.equal(hi.band, 'high');
  assert.equal(m.cells[0].impact, 3, 'top row is the highest impact');
  assert.equal(PV.riskMatrix(rs, { includeClosed: true }).considered, 7);
});

test('resourcePressure: peak per person/week, >100 flagged, missing allocation counted unknown (never guessed)', () => {
  const tasks = [
    { id: 1, owner: 'Ana', start_date: '2026-11-02', end_date: '2026-11-06', allocation_pct: 60, effort_hours: 20 },
    { id: 2, owner: ' ana ', start_date: '2026-11-04', end_date: '2026-11-13', allocation_pct: 50 },
    { id: 3, owner: 'Ana', start_date: '2026-11-09', end_date: '2026-11-10', allocation_pct: null },
    { id: 4, owner: 'Bob', start_date: '2026-11-02', end_date: '2026-11-03' },
    { id: 5, owner: null, start_date: '2026-11-02', end_date: '2026-11-03', allocation_pct: 50 },
    { id: 6, owner: 'Bob', allocation_pct: 50 },
    { id: 7, owner: 'Bob', start_date: '2026-11-02', end_date: '2026-11-03', allocation_pct: 90, status: 'done' },
  ];
  const r = PV.resourcePressure(tasks, { today: '2026-11-04' });
  assert.deepEqual(r.weeks, ['2026-11-02', '2026-11-09']);
  assert.equal(r.unassigned, 1); assert.equal(r.undated, 1);
  const ana = r.people.find((p) => p.owner.toLowerCase() === 'ana');
  assert.equal(ana.cells[0].peak_pct, 110); assert.equal(ana.cells[0].over, true);
  assert.equal(ana.cells[0].effort_hours, 20);
  assert.equal(ana.cells[1].peak_pct, 50); assert.equal(ana.cells[1].unknown, 1); assert.equal(ana.cells[1].over, false);
  assert.equal(ana.over_weeks, 1);
  const bob = r.people.find((p) => p.owner === 'Bob');
  assert.equal(bob.cells[0].peak_pct, null, 'only unknown allocation → not measured, not 0');
  assert.equal(bob.cells[0].unknown, 1);
  assert.equal(bob.cells[1].tasks, 0); assert.equal(bob.cells[1].peak_pct, null);
  assert.equal(r.people[0].owner.toLowerCase(), 'ana', 'over-allocated people first');
});

test('resourcePressure agrees with projectSchedule.resourceConflicts — known, unknown, omitted, empty, 0 and legacy out-of-range (F-PRODUCT-01)', () => {
  const tasks = [
    { id: 1, owner: 'Ana', start_date: '2026-11-02', end_date: '2026-11-20', allocation_pct: 70 },
    { id: 2, owner: 'Ana', start_date: '2026-11-16', end_date: '2026-11-27', allocation_pct: 40 },
    { id: 3, owner: 'Bob', start_date: '2026-11-02', end_date: '2026-11-27', allocation_pct: 100 },
    { id: 4, owner: 'Bob', start_date: '2026-11-02', end_date: '2026-11-06', allocation_pct: null },
    { id: 5, owner: 'Cy', start_date: '2026-11-02', end_date: '2026-11-13', allocation_pct: 60 },
    { id: 6, owner: 'Cy', start_date: '2026-11-02', end_date: '2026-11-06' },
    { id: 7, owner: 'Cy', start_date: '2026-11-09', end_date: '2026-11-13', allocation_pct: '' },
    { id: 8, owner: 'Dee', start_date: '2026-11-02', end_date: '2026-11-06', allocation_pct: 60 },
    { id: 9, owner: 'Dee', start_date: '2026-11-02', end_date: '2026-11-06', allocation_pct: 120 },
    { id: 10, owner: 'Dee', start_date: '2026-11-09', end_date: '2026-11-13', allocation_pct: 60 },
    { id: 11, owner: 'Dee', start_date: '2026-11-09', end_date: '2026-11-13', allocation_pct: -50 },
    { id: 12, owner: 'Eve', start_date: '2026-11-02', end_date: '2026-11-06', allocation_pct: 60 },
    { id: 13, owner: 'Eve', start_date: '2026-11-02', end_date: '2026-11-06', allocation_pct: 0 },
  ];
  const r = PV.resourcePressure(tasks, { today: '2026-11-04' });
  const conf = SCH.resourceConflicts(tasks);
  for (const p of r.people) for (const c of p.cells) {
    const we = new Date(Date.parse(c.week + 'T00:00:00Z') + 6 * 86400000).toISOString().slice(0, 10);
    const hit = conf.some((x) => x.owner.toLowerCase() === p.owner.toLowerCase() && x.from <= we && x.to >= c.week);
    assert.equal(c.over, hit, `${p.owner} ${c.week}`);
  }
});

test('resourcePressure caps a long range and says so', () => {
  const r = PV.resourcePressure([{ id: 1, owner: 'A', start_date: '2025-01-06', end_date: '2027-01-01', allocation_pct: 10 }], { today: '2026-11-04', maxWeeks: 8 });
  assert.equal(r.weeks.length, 8); assert.equal(r.truncated, true);
  assert.ok(r.weeks[0] <= '2026-11-02' && r.weeks[7] >= '2026-11-02', 'window includes today');
});

const page = read('public/project.html');
const script = page.slice(page.lastIndexOf('<script nonce='));
const pf = read('public/portfolio.html');

test('shared renderers: matrix grid + table + not-scored list, pressure table + list view, every value escaped, no money', () => {
  const lib = read('public/lib/ppmVisuals.js');
  for (const name of ['riskMatrixHtml', 'cellListHtml', 'pressureHtml']) {
    const src = fnSource(lib, name);
    const raw = [...src.matchAll(/["']\s*\+\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)+)(?!\s*\(|[\w$.])/g)].map((m) => m[1]);
    assert.deepEqual(raw, [], `${name} concatenates raw values: ${raw.join(', ')}`);
    assert.ok(!/budget|spent|currency/.test(src), `${name}: no money`);
  }
  const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const items = [{ id: 1, kind: 'risk', title: '<b>x</b>', probability: 3, impact: 3, status: 'open' }, { id: 2, kind: 'risk', title: 'unscored', probability: 0, impact: 2, status: 'open' }];
  const m = PV.riskMatrix(items);
  const h = PV.riskMatrixHtml(m, esc);
  assert.match(h, /data-cell="3-3"/); assert.match(h, /Not scored/); assert.match(h, /<table/); assert.match(h, /unscored/);
  assert.ok(!h.includes('<b>x</b>'));
  assert.match(PV.cellListHtml(m, items, '3-3', esc), /&lt;b&gt;x/);
  const r = PV.resourcePressure([{ id: 1, owner: 'A"', start_date: '2026-11-02', end_date: '2026-11-03', allocation_pct: 70 }, { id: 2, owner: 'A"', start_date: '2026-11-02', end_date: '2026-11-03', allocation_pct: 50 }, { id: 3, owner: 'A"', start_date: '2026-11-02', end_date: '2026-11-03', allocation_pct: 120 }], { today: '2026-11-02' });
  const ph = PV.pressureHtml(r, esc);
  assert.match(ph, /▲ over/); assert.match(ph, /List view/); assert.match(ph, /A&quot;/);
  assert.match(ph, /\+1 invalid/); assert.match(ph, /outside 0–100 % \(#3\): not summed/);
});

test('project.html: risk matrix in the RAID tab, pressure view in the Plan tab', () => {
  assert.match(page, /src="lib\/ppmVisuals\.js"/);
  assert.match(page, /id="risk-matrix"/); assert.match(page, /id="plan-pressure"/);
  assert.match(script, /PpmVisuals\.riskMatrix\(/); assert.match(script, /PpmVisuals\.resourcePressure\(/);
});

test('project.html Gantt: bars are focusable, arrows move, Enter opens the task, baseline legend is visible', () => {
  const g = fnSource(script, 'ganttSvg');
  assert.match(g, /tabindex=/); assert.match(g, /data-task=/);
  assert.match(script, /function ganttKey/);
  const k = fnSource(script, 'ganttKey');
  // C-07: arrows / Home / End go through the shared PpmVisuals.navIndex (its keys pinned in chart-a11y.test.js)
  assert.match(k, /PpmVisuals\.navIndex\(ev\.key/); assert.match(k, /Enter/);
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) assert.notEqual(PV.navIndex(key, 1, 3), -1, key);
  assert.match(script, /function openTask/);
  assert.match(page, /id="gantt-legend"/);
  assert.match(fnSource(script, 'ganttLegend'), /baseline/);
});

test('portfolio.html: risk matrix, pressure view, keyboard row links and a swatch legend', () => {
  assert.match(pf, /src="lib\/ppmVisuals\.js"/);
  assert.match(pf, /id="risk-matrix"/); assert.match(pf, /id="pressure"/);
  assert.match(pf, /tl-legend-sw/);
  assert.match(pf, /PpmVisuals\.navIndex\(ev\.key, cur, links\.length\)/);
});

test('help §25 documents the matrix, the pressure view and the Gantt keyboard in EN and FR', () => {
  const h = read('public/help.html');
  for (const [id, words] of [['en-25', ['Risk matrix', 'Resource pressure', 'arrow keys']], ['fr-25', ['Matrice des risques', 'Charge des ressources', 'flèches']]]) {
    const start = h.indexOf(`<div class="section" id="${id}">`); const end = h.indexOf('<div class="section"', start + 10);
    const s = h.slice(start, end);
    for (const w of words) assert.ok(s.includes(w), `${id}: ${w}`);
  }
});
