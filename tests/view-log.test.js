'use strict';
// G-06 (audit 2026-09-24) — the once-per-actor-per-day gate behind the `*_viewed`
// events.
//
// Why a gate at all: the audit found system_log carries only auth + report_* events,
// so "how many asset managers opened the module in the last 30 days" — a KPI the audit
// engine asks for by name — is unanswerable. Logging the read route answers it, but a
// tab switch re-hits that route, so an ungated log would write dozens of rows per
// person per day and drown the journal it is supposed to feed.
//
// The gate is pure and injectable (no clock, no DB) so the policy is testable on its own.
const test = require('node:test');
const assert = require('node:assert');
const { makeOncePerDay } = require('../services/viewLog');

test('first call for an actor on a day passes, the next ones do not', () => {
  const gate = makeOncePerDay();
  assert.strictEqual(gate('alice', '2026-09-24'), true);
  assert.strictEqual(gate('alice', '2026-09-24'), false);
  assert.strictEqual(gate('alice', '2026-09-24'), false);
});

test('a new day re-opens the gate for the same actor', () => {
  const gate = makeOncePerDay();
  assert.strictEqual(gate('alice', '2026-09-24'), true);
  assert.strictEqual(gate('alice', '2026-09-25'), true);
});

test('actors are independent', () => {
  const gate = makeOncePerDay();
  assert.strictEqual(gate('alice', '2026-09-24'), true);
  assert.strictEqual(gate('bob', '2026-09-24'), true);
  assert.strictEqual(gate('bob', '2026-09-24'), false);
});

test('an anonymous/missing actor is still gated, never used as a wildcard', () => {
  const gate = makeOncePerDay();
  assert.strictEqual(gate(null, '2026-09-24'), true);
  assert.strictEqual(gate(null, '2026-09-24'), false);
  assert.strictEqual(gate(undefined, '2026-09-24'), false, 'null and undefined are the same actor');
});

test('the map does not grow without bound — yesterday is dropped', () => {
  const gate = makeOncePerDay();
  for (let i = 1; i <= 40; i++) gate('u' + i, '2026-09-24');
  gate('u1', '2026-09-25');                       // a new day arrives
  assert.ok(gate.size() <= 2, `expected the previous day to be dropped, size=${gate.size()}`);
});
