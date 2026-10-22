'use strict';
// Step 6 (lot 6.7) — the pure core of tools/metrics/step6-acceptance.js (acceptance criteria, dossier §10).
const test = require('node:test');
const assert = require('node:assert');
const A = require('../tools/metrics/step6-acceptance');

test('SUS: the standard scoring (odd r-1, even 5-r, × 2.5) and its bounds', () => {
  assert.strictEqual(A.susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]), 100);
  assert.strictEqual(A.susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5]), 0);
  assert.strictEqual(A.susScore([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]), 50);
  assert.strictEqual(A.susScore([4, 2, 4, 2, 4, 2, 4, 2, 4, 2]), 75);
  assert.strictEqual(A.susScore([4, 2, 4]), null, 'incomplete');
  assert.strictEqual(A.susScore([4, 2, 4, 2, 4, 2, 4, 2, 4, 6]), null, 'out of the 1..5 scale');
});

test('SUS from CSV: header skipped, comma or semicolon, incomplete rows rejected not averaged', () => {
  const r = A.susFromCsv('participant;q1;q2;q3;q4;q5;q6;q7;q8;q9;q10\nP1;5;1;5;1;5;1;5;1;5;1\nP2,3,3,3,3,3,3,3,3,3,3\nP3;4;2\n');
  assert.deepStrictEqual([r.n, r.mean, r.rejected], [2, 75, ['P3']]);
  assert.strictEqual(A.susFromCsv('').mean, null, 'no answer → not measured, never 0');
});

test('weekly viewers: distinct people per ISO week, anonymous ignored, empty weeks present, current week flagged', () => {
  const rows = [
    { ts: '2026-10-19T08:00:00Z', actor: 'a' }, { ts: '2026-10-20T08:00:00Z', actor: 'A' }, { ts: '2026-10-21T08:00:00Z', actor: 'b' },
    { ts: '2026-10-25T23:00:00Z', actor: 'c' },                                  // Sunday: still the week of the 19th
    { ts: '2026-10-07T08:00:00Z', actor: 'a' }, { ts: '2026-10-07T09:00:00Z', actor: 'anonymous' },
  ];
  assert.deepStrictEqual(A.weeklyViewers(rows, { weeks: 4, today: '2026-10-27' }), [
    { week: '2026-10-05', viewers: 1, partial: false },
    { week: '2026-10-12', viewers: 0, partial: false },
    { week: '2026-10-19', viewers: 3, partial: false },
    { week: '2026-10-26', viewers: 0, partial: true },
  ]);
  assert.strictEqual(A.mondayOf('2026-11-01T10:00:00Z'), '2026-10-26');
});

test('publications: distinct dashboards by people without a technical role; system and unknown people excluded', () => {
  const roles = { lea: ['executive', 'dashboard-publisher'], tom: ['admin', 'dashboard-publisher'], sam: ['viewer', 'dashboard-author'] };
  const rows = [
    { actor: 'lea', target: 'board-1' }, { actor: 'lea', target: 'board-1' }, { actor: 'sam', target: 'board-2' },
    { actor: 'tom', target: 'board-3' }, { actor: 'system', target: 'direction' }, { actor: 'ghost', target: 'board-4' },
  ];
  assert.deepStrictEqual(A.nonTechnicalPublications(rows, a => roles[a]), { dashboards: 2, authors: 2 });
  assert.deepStrictEqual(A.nonTechnicalPublications(rows, a => roles[a], ['super_admin']), { dashboards: 3, authors: 3 }, 'the technical roles are a parameter');
});
