'use strict';
// F-PRODUCT-06 — pure transition table of the decision register (services/decisionLifecycle).
const { test } = require('node:test');
const assert = require('node:assert');
const DL = require('../services/decisionLifecycle');

const on = (from, to, actor, reason) => DL.resolve(from, to, { actor, reason, enforced: true });

test('switch off: today — any of the four statuses from anywhere, no reason; the new status is not reachable', () => {
  for (const from of DL.BASE_STATUSES) for (const to of DL.BASE_STATUSES) {
    const r = DL.resolve(from, to, { actor: 'site', enforced: false });
    assert.equal(r.ok, true); assert.equal(r.to, to); assert.equal(r.proposed, false); assert.equal(r.changed, from !== to);
  }
  assert.equal(DL.resolve('open', 'awaiting_confirmation', { enforced: false }).status, 400);
  assert.equal(DL.resolve('open', 'nope', { enforced: false }).code, 'INVALID');
});

test('the historical statuses are kept; awaiting_confirmation is open, not closed', () => {
  assert.deepEqual(DL.BASE_STATUSES, ['open', 'in_progress', 'done', 'cancelled']);
  assert.ok(DL.OPEN_STATUSES.includes('awaiting_confirmation')); assert.equal(DL.isClosed('awaiting_confirmation'), false);
  assert.equal(DL.isClosed('done'), true); assert.equal(DL.isClosed('cancelled'), true);
});

test('enforced: the table — committee moves', () => {
  assert.equal(on('open', 'in_progress', 'committee').to, 'in_progress');
  assert.equal(on('open', 'done', 'committee').to, 'done');
  assert.equal(on('in_progress', 'open', 'committee').to, 'open');
  assert.equal(on('in_progress', 'done', 'committee').to, 'done');
  assert.equal(on('awaiting_confirmation', 'done', 'committee').to, 'done');
  assert.equal(on('open', 'open', 'committee').changed, false);
  // illegal jumps
  assert.equal(on('done', 'in_progress', 'committee', 'because').status, 409);
  assert.equal(on('done', 'cancelled', 'committee', 'because').code, 'ILLEGAL_TRANSITION');
  assert.equal(on('cancelled', 'done', 'committee', 'because').status, 409);
  assert.equal(on('open', 'awaiting_confirmation', 'committee').status, 403, 'only a site proposes completion');
});

test('enforced: a reason is required to cancel, to reopen and to send a proposal back', () => {
  for (const [from, to] of [['open', 'cancelled'], ['in_progress', 'cancelled'], ['awaiting_confirmation', 'cancelled'], ['done', 'open'], ['cancelled', 'open'], ['awaiting_confirmation', 'in_progress']]) {
    assert.equal(on(from, to, 'committee').code, 'REASON_REQUIRED', `${from} → ${to} without a reason`);
    assert.equal(on(from, to, 'committee', '  ').status, 400);
    assert.equal(on(from, to, 'committee', 'duplicate of DEC-2026-004').ok, true);
  }
});

test('enforced: a site cannot close, cancel or reopen — its "done" is a proposal', () => {
  assert.equal(on('open', 'in_progress', 'site').to, 'in_progress');
  assert.equal(on('in_progress', 'open', 'site').to, 'open');
  const p = on('in_progress', 'done', 'site'); assert.equal(p.ok, true); assert.equal(p.to, 'awaiting_confirmation'); assert.equal(p.proposed, true);
  assert.equal(on('open', 'done', 'site').to, 'awaiting_confirmation');
  assert.equal(on('awaiting_confirmation', 'done', 'site').code, 'COMMITTEE_ONLY', 'a site cannot confirm its own proposal');
  assert.equal(on('awaiting_confirmation', 'in_progress', 'site').to, 'in_progress', 'a site may withdraw its proposal');
  assert.equal(on('open', 'cancelled', 'site', 'not needed').status, 403);
  assert.equal(on('done', 'open', 'site', 'still broken').status, 403);
  assert.equal(on('cancelled', 'open', 'site', 'still needed').status, 403);
  assert.equal(on('open', 'done', 'nobody').status, 403);
});

test('allowed(): what the UI may offer', () => {
  assert.deepEqual(DL.allowed('open', 'site', { enforced: false }), ['in_progress', 'done', 'cancelled']);
  const site = DL.allowed('in_progress', 'site', { enforced: true });
  assert.deepEqual(site.map((t) => t.to).sort(), ['awaiting_confirmation', 'done', 'open']);
  assert.equal(site.find((t) => t.to === 'done').proposes, 'awaiting_confirmation');
  assert.deepEqual(DL.allowed('done', 'site', { enforced: true }), []);
  assert.deepEqual(DL.allowed('done', 'committee', { enforced: true }), [{ to: 'open', reason: true }]);
});
