'use strict';
// P11 round 4 R4-A2(b) — services/approverProvenance.js (pure, fake db): the approver must be independent of the
// requester according to the identity journal; unknown or unreadable provenance fails closed.
const { test } = require('node:test');
const assert = require('node:assert');
const { checkIndependent } = require('../services/approverProvenance');

const NOW = Date.parse('2026-11-20T12:00:00Z');
const old = '2026-01-01T00:00:00Z', fresh = '2026-11-19T12:00:00Z';
function fakeDb(users, log) {
  return { prepare: (sql) => ({
    get: async (v) => (/FROM users WHERE id/.test(sql) ? users.find((u) => u.id === Number(v)) : users.find((u) => u.username === v)) || null,
    all: async (name) => log.filter((r) => r.target === name),
  }) };
}
const created = (target, by, roles = ['super_admin'], ts = fresh) => ({ target, ts, action: 'user_created', actor_id: by, details: JSON.stringify({ after: { roles } }) });

test('created by the requester → refused; through a chain → refused', async () => {
  const users = [{ id: 1, username: 'a', created_at: old }, { id: 2, username: 'b', created_at: fresh }, { id: 3, username: 'c', created_at: fresh }];
  const log = [created('b', 1), created('c', 2)];
  assert.strictEqual((await checkIndependent({ db: fakeDb(users, log), requesterId: 1, approver: { id: 2 }, now: NOW })).ok, false);
  assert.strictEqual((await checkIndependent({ db: fakeDb(users, log), requesterId: 1, approver: { id: 3 }, now: NOW })).ok, false);
});

test('a recent account with no journal row, or a recent unnamed super_admin grant → refused (fail closed)', async () => {
  const users = [{ id: 4, username: 'd', created_at: fresh }, { id: 5, username: 'e', created_at: old }];
  const log = [{ target: 'e', ts: fresh, action: 'user_role_changed', actor_id: null, details: JSON.stringify({ before: ['admin'], after: ['super_admin'] }) }];
  assert.match((await checkIndependent({ db: fakeDb(users, []), requesterId: 1, approver: { id: 4 }, now: NOW })).reason, /provenance unknown/);
  assert.match((await checkIndependent({ db: fakeDb(users, log), requesterId: 1, approver: { id: 5 }, now: NOW })).reason, /provenance unknown/);
});

test('an unreadable journal → refused; an established or independently created account → allowed', async () => {
  const broken = { prepare: () => ({ get: async () => { throw new Error('db down'); }, all: async () => { throw new Error('db down'); } }) };
  assert.match((await checkIndependent({ db: broken, requesterId: 1, approver: { id: 2 }, now: NOW })).reason, /fail closed/);
  const users = [{ id: 6, username: 'f', created_at: old }, { id: 7, username: 'g', created_at: fresh }, { id: 9, username: 'other', created_at: old }];
  assert.strictEqual((await checkIndependent({ db: fakeDb(users, []), requesterId: 1, approver: { id: 6 }, now: NOW })).ok, true);
  assert.strictEqual((await checkIndependent({ db: fakeDb(users, [created('g', 9)]), requesterId: 1, approver: { id: 7 }, now: NOW })).ok, true);
});
