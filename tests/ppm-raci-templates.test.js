'use strict';
// E-P06 (audit P-06) — RACI (exactly one A per task) and project templates (structure only) — pure rules
// (services/ppmRaci.js) + renderers (public/lib/ppmExtras.js) + static page checks. Fictitious data.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const RC = require('../services/ppmRaci');
const X = require('../public/lib/ppmExtras');
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('validateRaci: exactly one A per task that has letters; letters R/A/C/I; tasks of the project only', () => {
  assert.deepEqual(RC.validateRaci([{ task_id: 1, person: 'Ana', letter: 'A' }, { task_id: 1, person: 'Bob', letter: 'R' }], [1, 2]), []);
  assert.equal(RC.validateRaci([{ task_id: 1, person: 'Bob', letter: 'R' }], [1])[0].code, 'NO_ACCOUNTABLE');
  assert.equal(RC.validateRaci([{ task_id: 1, person: 'Ana', letter: 'A' }, { task_id: 1, person: 'Bob', letter: 'A' }], [1])[0].code, 'MULTIPLE_ACCOUNTABLE');
  assert.equal(RC.validateRaci([{ task_id: 9, person: 'Ana', letter: 'A' }], [1])[0].code, 'UNKNOWN_TASK');
  assert.equal(RC.validateRaci([{ task_id: 1, person: 'Ana', letter: 'X' }], [1])[0].code, 'BAD_LETTER');
  assert.equal(RC.validateRaci([{ task_id: 1, person: ' ', letter: 'A' }], [1])[0].code, 'NO_PERSON');
  assert.deepEqual(RC.validateRaci([], [1]), [], 'a task with no letter is allowed (not every task needs a RACI)');
  assert.equal(RC.normalise([{ task_id: 1, person: 'Ana', letter: 'a' }, { task_id: 1, person: ' ana', letter: 'A' }]).length, 1, 'duplicates folded');
});

test('matrix + CSV: letters per person, the check column, formula injection guarded', () => {
  const m = RC.matrix([{ task_id: 1, person: '=cmd', letter: 'A' }, { task_id: 1, person: 'Bob', letter: 'R' }, { task_id: 1, person: 'Bob', letter: 'I' }], [{ id: 1, wbs_code: '1', name: 'Cabling' }, { id: 2, name: 'Tests' }]);
  assert.deepEqual(m.people, ['=cmd', 'Bob']); assert.equal(m.tasks[0].cells.Bob, 'RI'); assert.equal(m.tasks[0].accountable, 1);
  const csv = RC.raciCsv(m);
  assert.match(csv, /^Task,'=cmd,Bob\r\n1 Cabling,A,RI\r\nTests,,\r\n$/);
  const h = X.raciHtml(m, esc);
  assert.match(h, /✓ one A/); assert.match(h, /no RACI/);
  assert.match(X.raciHtml(RC.matrix([{ task_id: 2, person: 'Bob', letter: 'R' }], [{ id: 2, name: 'T' }]), esc), /! no A/);
  assert.deepEqual(X.raciRowsFrom([{ task: '1', letter: 'C', value: 'Ana, Bob ,' }]), [{ task_id: 1, letter: 'C', person: 'Ana' }, { task_id: 1, letter: 'C', person: 'Bob' }]);
});

test('templateFromProject carries no people, dates, allocation, effort or money; planFromTemplate puts parents first', () => {
  const d = { project: { budget: 5000, currency: 'USD', owner: 'Ana' },
    tasks: [{ id: 11, parent_id: 10, name: 'Child', owner: 'Ana', start_date: '2026-01-01', end_date: '2026-01-05', duration_days: 5, allocation_pct: 50, effort_hours: 8, wbs_code: '1.1' },
      { id: 10, parent_id: null, name: 'Phase', owner: 'Bob', duration_days: null, wbs_code: '1' }],
    milestones: [{ id: 3, name: 'Go-live', due_date: '2026-02-01', owner: 'Cy' }] };
  const t = RC.templateFromProject(d);
  const json = JSON.stringify(t);
  for (const k of ['owner', 'start_date', 'end_date', 'due_date', 'allocation_pct', 'effort_hours', 'budget', 'currency', 'Ana', 'Bob', 'Cy', '2026', '5000']) assert.ok(!json.includes(k), 'no ' + k);
  assert.deepEqual(t.tasks.map((x) => [x.ref, x.parent_ref, x.name, x.duration_days]), [['t1', 't2', 'Child', 5], ['t2', null, 'Phase', null]]);
  const p = RC.planFromTemplate(t);
  assert.deepEqual(p.tasks.map((x) => x.ref), ['t2', 't1'], 'the parent is created first');
  assert.deepEqual(p.milestones, [{ name: 'Go-live' }]);
});

test('templatesHtml: draft vs approved, the author gets no Approve button', () => {
  const r = { committee: true, me: 5, templates: [{ id: 1, name: '<T>', status: 'draft', created_by: 5, structure: { tasks: [{}], milestones: [] } }, { id: 2, name: 'U', status: 'draft', created_by: 6, structure: {} }, { id: 3, name: 'V', status: 'approved', created_by: 6, approved_by_name: 'cio', structure: {} }] };
  const h = X.templatesHtml(r, esc);
  assert.match(h, /&#60;T&#62;/); assert.ok(!h.includes('data-tpl-approve="1"')); assert.ok(h.includes('data-tpl-approve="2"')); assert.ok(h.includes('data-tpl-use="3"'));
  assert.match(h, /draft — not approved/); assert.match(h, /never people, dates or money/);
});

test('pages: RACI tab + template panels hidden until their switch answers', () => {
  const pj = read('public/project.html');
  assert.match(pj, /id="tab-raci"[^>]*hidden/); assert.match(pj, /if \(FEAT\.raci\) addTab\("raci", "gates"\)/);
  assert.match(pj, /id="tpl-save-box" hidden/);
  const pf = read('public/portfolio.html');
  assert.match(pf, /id="templates-panel" hidden/); assert.match(pf, /\/api\/governance\/ppm\/templates/);
});
