'use strict';
// C-19 (G43 · R8) — the separation-of-duties registry: per-object refusals, one watched pair as a warning.
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../services/sodPolicy');

test('access.decide: no self-approval (subject, requester) and no deputy decision', () => {
  const f = { subjectId: 10, requesterId: 11, deputyIds: new Set([12]) };
  assert.match(S.evaluate('access.decide', { ...f, actorId: 10 }).refuse.error, /your own access/);
  assert.match(S.evaluate('access.decide', { ...f, actorId: 11 }).refuse.error, /you filed/);
  assert.equal(S.evaluate('access.decide', { ...f, actorId: 12 }).refuse.rule, 'no_deputy_verification');
  assert.equal(S.evaluate('access.decide', { ...f, actorId: 13 }).refuse, null);
});

test('qualification.verify: neither holder, nor recorder, nor a deputy of either', () => {
  const f = { subjectId: 1, recorderId: 2, deputyIds: [3] };
  assert.equal(S.evaluate('qualification.verify', { ...f, actorId: 1 }).refuse.rule, 'no_self_verification');
  assert.match(S.evaluate('qualification.verify', { ...f, actorId: 2 }).refuse.error, /recorded/);
  assert.equal(S.evaluate('qualification.verify', { ...f, actorId: 3 }).refuse.rule, 'no_deputy_verification');
  assert.equal(S.evaluate('qualification.verify', { ...f, actorId: 4 }).refuse, null);
});

test('R8: report-author approving their own report is a WARNING, never a refusal; no platform role-pair conflict', () => {
  const r = S.evaluate('report.approve', { actorId: 5, authorId: 5 });
  assert.equal(r.refuse, null);
  assert.equal(r.warnings[0].rule, 'report_author_approver');
  assert.deepEqual(S.evaluate('report.approve', { actorId: 6, authorId: 5 }).warnings, []);
  assert.ok(S.WATCHED_PAIRS.every((p) => p.level === 'warn'), 'no hard role-pair conflict at platform level');
});

test('registry: unknown object refused, rules named once, version is a stable hash', () => {
  assert.equal(S.evaluate('nope', { actorId: 1 }).refuse.rule, 'unknown_object');
  assert.deepEqual(S.RULES.map((r) => r.id), ['no_self_approval', 'no_self_verification', 'no_deputy_verification']);
  assert.match(S.POLICY_VERSION, /^[0-9a-f]{12}$/);
});
