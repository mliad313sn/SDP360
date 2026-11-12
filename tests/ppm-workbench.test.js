'use strict';
// R2-WORKBENCH (REBUILD-SPEC R5) — the PURE rules of the project workbench additions, fictitious data only.
const { test } = require('node:test');
const assert = require('node:assert');
const WB = require('../services/ppmWorkbench');
const SCH = require('../services/projectSchedule');
const AC = require('../public/lib/allocationContract');
const PV = require('../public/lib/ppmVisuals');
const UI = require('../public/lib/ppmWorkbench');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// three tasks of one person on the same days: two with no allocation (unknown), one at 60 %
const TASKS = [
  { id: 1, project_id: 9, owner: 'Ana', start_date: '2026-11-02', end_date: '2026-11-06', allocation_pct: null, status: 'todo' },
  { id: 2, project_id: 9, owner: 'ana ', start_date: '2026-11-02', end_date: '2026-11-06', allocation_pct: null, status: 'todo' },
  { id: 3, project_id: 9, owner: 'Ana', start_date: '2026-11-02', end_date: '2026-11-06', allocation_pct: 60, status: 'todo' },
];

test('R2-WB-04 normaliseMember: a name is required, allocation 0..100 or unknown (null, never 0), window in order', () => {
  assert.deepEqual(WB.normaliseMember({ label: ' Ana ', role: 'engineer', allocation_pct: '' }), { user_id: null, label: 'Ana', role: 'engineer', allocation_pct: null, from_day: null, to_day: null });
  assert.equal(WB.normaliseMember({ label: 'Bob', allocation_pct: 0 }).allocation_pct, 0, 'a stated 0 % stays 0');
  for (const [b, code] of [[{}, 'LABEL_REQUIRED'], [{ label: 'x', allocation_pct: 140 }, 'BAD_ALLOCATION'], [{ label: 'x', allocation_pct: 'lots' }, 'BAD_ALLOCATION'],
    [{ label: 'x', user_id: 'me' }, 'BAD_USER'], [{ label: 'x', from_day: '2026-02-30' }, 'BAD_DAY'], [{ label: 'x', from_day: '2026-11-10', to_day: '2026-11-01' }, 'BAD_WINDOW']]) {
    assert.throws(() => WB.normaliseMember(b), (e) => e.reason === code && e.status === 400, code);
  }
});

test('R2-WB-04 golden: with no member the conflicts, the coverage and the capacity are exactly today’s', () => {
  assert.strictEqual(AC.withMembers(TASKS, []), TASKS, 'same array, untouched');
  assert.strictEqual(AC.withMembers(TASKS, undefined), TASKS);
  assert.deepEqual(SCH.resourceConflicts(TASKS, []), AC.conflicts(TASKS));
  assert.deepEqual(SCH.resourceCoverage(TASKS, []), AC.coverage(TASKS));
  assert.deepEqual(SCH.resourceConflicts(TASKS), [], 'today: the unknown tasks are not summed → no conflict');
  assert.equal(SCH.resourceCoverage(TASKS).unknown, 2);
  const projects = [{ id: 9, site_id: 4 }];
  assert.deepEqual(PV.capacityBySite(TASKS, projects, { today: '2026-11-02', members: [] }), PV.capacityBySite(TASKS, projects, { today: '2026-11-02' }));
});

test('R2-WB-04 a member allocation fills an UNKNOWN task allocation only (never overrides a known one)', () => {
  const members = [{ project_id: 9, label: 'ANA', allocation_pct: 50 }];
  const t = AC.withMembers(TASKS, members);
  assert.deepEqual(t.map((x) => x.allocation_pct), [50, 50, 60]);
  assert.equal(t[2], TASKS[2], 'the known task is the same object');
  assert.deepEqual(SCH.resourceConflicts(TASKS, members).map((c) => [c.owner, c.peak_pct, c.task_ids]), [['Ana', 160, [1, 2, 3]]]);
  assert.equal(SCH.resourceCoverage(TASKS, members).unknown, 0);
  // another project, another person, a window that does not cover the task, an unknown member allocation: no effect
  for (const m of [{ project_id: 8, label: 'Ana', allocation_pct: 50 }, { project_id: 9, label: 'Bob', allocation_pct: 50 },
    { project_id: 9, label: 'Ana', allocation_pct: 50, from_day: '2026-11-04' }, { project_id: 9, label: 'Ana', allocation_pct: null }]) {
    assert.deepEqual(AC.withMembers(TASKS, [m]).map((x) => x.allocation_pct), [null, null, 60], JSON.stringify(m));
  }
  // a linked user is matched by username too
  assert.deepEqual(AC.withMembers([{ ...TASKS[0], owner: 'a.kone' }], [{ project_id: 9, label: 'Ana Koné', username: 'a.kone', allocation_pct: 30 }]).map((x) => x.allocation_pct), [30]);
  const cap = PV.capacityBySite(TASKS, [{ id: 9, site_id: 4 }], { today: '2026-11-02', members });
  assert.equal(cap.conflicts.length, 1);
});

test('R2-WB-04 teamHtml escapes every field and reads unknown, never 0', () => {
  const h = UI.teamHtml([{ id: 1, label: '<b>Ana</b>', role: 'x"y', allocation_pct: null, user_id: null }, { id: 2, label: 'Bob', allocation_pct: 0, user_id: 4, username: 'bob' }], esc, true);
  assert.ok(!h.includes('<b>Ana</b>') && h.includes('&lt;b&gt;Ana&lt;/b&gt;') && h.includes('x&quot;y'));
  assert.match(h, /unknown/); assert.match(h, /0 %/); assert.match(h, /data-team-del="2"/);
  assert.match(UI.teamHtml([], esc), /No team member/);
});

test('R2-WB-02 actualHours: no entry = null (unknown), an entry of 0 h = 0; variance only when both are known', () => {
  const tasks = [{ id: 1, effort_hours: 10 }, { id: 2, effort_hours: 4 }, { id: 3, effort_hours: null }, { id: 4, effort_hours: 8 }];
  const entries = [{ task_id: 1, hours: 6 }, { task_id: 1, hours: 5.5 }, { task_id: 2, hours: 0 }, { task_id: 3, hours: 2 }, { task_id: 9, hours: 3 }, { task_id: 1, hours: 'x' }];
  assert.deepEqual(SCH.actualHours(tasks, entries), [
    { task_id: 1, planned: 10, actual: 11.5, variance: 1.5, entries: 2 },
    { task_id: 2, planned: 4, actual: 0, variance: -4, entries: 1 },
    { task_id: 3, planned: null, actual: 2, variance: null, entries: 1 },
    { task_id: 4, planned: 8, actual: null, variance: null, entries: 0 },
  ]);
  assert.deepEqual(SCH.actualHours([], entries), []);
});

test('R2-WB-02 normaliseTimeEntry: day and hours 0..24 required, the recorder by default, a stated 0 h stays 0', () => {
  const me = { id: 7, username: 'pmo', full_name: 'PMO Person' };
  assert.deepEqual(WB.normaliseTimeEntry({ day: '2026-11-03', hours: 0 }, me), { person_user_id: 7, person_label: 'PMO Person', day: '2026-11-03', hours: 0, note: null });
  assert.equal(WB.normaliseTimeEntry({ day: '2026-11-03', hours: '7.5', person_label: 'Ana' }, me).person_user_id, null, 'another named person is not linked to the recorder');
  for (const [b, code] of [[{ hours: 2 }, 'DAY_REQUIRED'], [{ day: '2026-11-03' }, 'BAD_HOURS'], [{ day: '2026-11-03', hours: 25 }, 'BAD_HOURS'], [{ day: '2026-11-03', hours: -1 }, 'BAD_HOURS'], [{ day: '03/11/2026', hours: 1 }, 'BAD_DAY']]) {
    assert.throws(() => WB.normaliseTimeEntry(b, me), (e) => e.reason === code, code);
  }
  assert.throws(() => WB.normaliseTimeEntry({ day: '2026-11-03', hours: 1 }, null), (e) => e.reason === 'PERSON_REQUIRED');
});

test('R2-WB-02 hoursHtml / entriesHtml: "—" for unknown, escaped labels', () => {
  const h = UI.hoursHtml([{ task_id: 1, planned: 10, actual: null, variance: null, entries: 0 }, { task_id: 2, planned: null, actual: 0, variance: null, entries: 1 }], [{ id: 1, name: '<i>A</i>' }, { id: 2, name: 'B' }], esc);
  assert.ok(h.includes('&lt;i&gt;A&lt;/i&gt;')); assert.match(h, /0 h/); assert.match(h, /1 of 2/);
  assert.match(UI.entriesHtml([{ id: 3, day: '2026-11-03', person_label: 'Ana', hours: 2, note: null }], esc, true), /data-time-del="3"/);
});

test('R2-WB-02 workbook: no actual_hours column unless given; given = per task actual / variance, unknown = empty cell', () => {
  const XLSX = require('xlsx'), D = require('../services/portfolioDeck');
  const view = { projects: [{ id: 1, key: 'P-1', name: 'P' }], tasks: [{ id: 1, project_id: 1, name: 'A', effort_hours: 10 }, { id: 2, project_id: 1, name: 'B', effort_hours: null }] };
  const head = (wb) => XLSX.utils.sheet_to_json(wb.Sheets.Tasks, { header: 1 })[0];
  const off = XLSX.read(D.buildWorkbookBuffer(view, {}), { type: 'buffer' });
  assert.ok(!head(off).includes('actual_hours'), 'today: no column');
  const on = XLSX.read(D.buildWorkbookBuffer(view, { actualHours: SCH.actualHours(view.tasks, [{ task_id: 1, hours: 12 }]) }), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(on.Sheets.Tasks, { defval: null });
  assert.deepEqual(rows.map((r) => [r.name, r.effort_hours, r.actual_hours, r.hours_variance]), [['A', 10, 12, 2], ['B', null, null, null]]);
});
