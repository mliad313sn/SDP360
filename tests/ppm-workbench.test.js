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
