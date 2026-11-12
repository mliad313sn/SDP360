'use strict';
// E-R02 — catalogue rules A01 (missing due date, behind a01_missing_due_date), A03 / A04 (in-app notices to the
// reviewer / owner) and A10 (stage-gate reminder, behind a10_gate_lead_days): pure rules, switch off = today.
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../services/commitmentEscalation');
const N = require('../services/commitmentNotices');
const P = require('../services/ppmAlerts');
const { DEFAULTS } = require('../services/reportConfig');

test('switches ship at today\'s behaviour', () => {
  assert.equal(DEFAULTS.a01_missing_due_date, '0');
  assert.equal(DEFAULTS.a10_gate_lead_days, '');
});

const rows = [
  { id: 1, site_id: 3, severity: 'high', status: 'committed', accountable_owner: 'x', due_date: null },
  { id: 2, site_id: 3, severity: 'critical', status: 'in_progress', accountable_owner: 'x', due_date: '', exception_approved_by: 'boss', exception_expires_at: '2099-01-01' },
  { id: 3, site_id: 3, severity: 'high', status: 'in_progress', accountable_owner: 'x', due_date: null, exception_approved_by: 'boss', exception_expires_at: '2026-01-01' },
  { id: 4, site_id: 3, severity: 'medium', status: 'committed', accountable_owner: 'x', due_date: null },
  { id: 5, site_id: 3, severity: 'high', status: 'verified_closed', accountable_owner: 'x', due_date: null },
];
test('A01: switch off = a missing due date raises nothing (today)', () => {
  assert.deepEqual(E.conditions(rows, '2026-11-06').map((c) => c.key), []);
});
test('A01: switch on = serious open commitment without due date nor live exception raises its own episode key', () => {
  const c = E.conditions(rows, '2026-11-06', { missingDueDate: true });
  assert.deepEqual(c.map((x) => x.key), ['A01:1:due', 'A01:3:due'], 'lapsed exception counts as none; medium and closed raise nothing');
  assert.ok(c.every((x) => x.kind === 'A01' && x.reason === 'no_due_date'));
  const d = E.diff(c, c.map((x) => ({ key: x.key, cleared_at: null })));
  assert.equal(d.open.length, 0, 'dedup: a persisting condition raises nothing');
});

const users = [{ id: 10, username: 'rev', email: 'rev@x', full_name: 'Ana Rev' }, { id: 11, username: 'own', email: 'own@x', full_name: 'Bo Own' }, { id: 12, username: 'gone', active: 0 }];
test('A03: completion tells the named reviewer (by username or e-mail, never full name), not the author', () => {
  const c = { id: 7, title: 'Fix', status: 'awaiting_verification', reviewer: 'REV@x', accountable_owner: 'own' };
  const r = N.noticesFor({ status: 'in_progress' }, c, { users, actorId: 11 });
  assert.deepEqual(r.notices.map((n) => [n.userId, n.rule]), [[10, 'A03']]);
  assert.match(r.notices[0].link, /commitments\.html\?id=7/);
  assert.deepEqual(N.noticesFor({ status: 'in_progress' }, { ...c, reviewer: 'Ana Rev' }, { users }).notices, [], 'full name never matches');
  assert.equal(N.noticesFor({ status: 'in_progress' }, { ...c, reviewer: 'Ana Rev' }, { users }).unmatched, 'reviewer');
  assert.deepEqual(N.noticesFor({ status: 'in_progress' }, c, { users, actorId: 10 }).notices, [], 'the reviewer completing is not told');
});
test('A03: no reviewer named → holders of commitments.reviewer', () => {
  const r = N.noticesFor({ status: 'in_progress' }, { id: 8, status: 'awaiting_verification', reviewer: '' }, { users, roleReviewerIds: [10, 12] });
  assert.deepEqual(r.notices.map((n) => n.userId), [10, 12]);
});
test('A04: rejection tells the owner with the reason; unchanged status tells nobody', () => {
  const c = { id: 9, title: 'Fix', status: 'rejected_for_rework', accountable_owner: 'own' };
  const r = N.noticesFor({ status: 'awaiting_verification' }, c, { users, reason: 'no acceptance memo', actorId: 10 });
  assert.deepEqual(r.notices.map((n) => [n.userId, n.rule]), [[11, 'A04']]);
  assert.match(r.notices[0].body, /no acceptance memo/);
  assert.deepEqual(N.noticesFor(c, c, { users }).notices, []);
  assert.deepEqual(N.noticesFor({ status: 'awaiting_verification' }, { ...c, accountable_owner: 'gone' }, { users }).notices, [], 'inactive user not told');
});

const pf = { projects: [
  { id: 1, key: 'P1', name: 'A', stage: 'approval', status: 'planned', start_date: '2026-11-10', owner: 'own' },
  { id: 2, key: 'P2', name: 'B', stage: 'in_progress', status: 'in_progress', end_date: '2026-11-20', baseline_end: '2026-11-20', owner: 'own' },
  { id: 3, key: 'P3', name: 'C', stage: 'proposal', status: 'planned', start_date: '2026-10-01' },
  { id: 4, key: 'P4', name: 'D', stage: 'approval', status: 'planned', start_date: null },
  { id: 5, key: 'P5', name: 'E', stage: 'closed', status: 'done', end_date: '2026-11-08' },
], tasks: [], milestones: [] };
const gates = (o) => P.findExceptions(pf, { today: '2026-11-06', ...o }).filter((x) => x.kind === 'gate_approaching');
test('A10: lead days null = off (today)', () => {
  assert.deepEqual(gates({}), []); assert.deepEqual(gates({ gateLeadDays: '' }), []); assert.deepEqual(gates({ gateLeadDays: 'x' }), []);
});
test('A10: gate within lead days raises one item per project, stage and date; past or missing date raises nothing', () => {
  assert.deepEqual(gates({ gateLeadDays: 7 }).map((x) => x.key), ['gate_approaching:project:1:approval:2026-11-10']);
  assert.deepEqual(gates({ gateLeadDays: 14 }).map((x) => x.key).sort(), ['gate_approaching:project:1:approval:2026-11-10', 'gate_approaching:project:2:in_progress:2026-11-20']);
  assert.match(gates({ gateLeadDays: 7 })[0].message, /in 4 d/);
});
