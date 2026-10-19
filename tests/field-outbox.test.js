'use strict';
// Step 10 — pure outbox rules: envelope validation, stable hash, chunk plan/assembly, payload shapes, data as-of.
const { test } = require('node:test');
const assert = require('node:assert');
const F = require('../services/fieldOutbox');

test('validateEnvelope: uuid v4 + kind + payload object required, optional client_ts/device checked', () => {
  const good = { uuid: '2f1e4c3a-9b7d-4e21-a3f5-0c8d1e2f3a4b', kind: 'tracker', payload: { key: 'k' }, client_ts: '2026-10-19T08:00:00Z' };
  assert.deepEqual(F.validateEnvelope(good), { ok: true, errors: [] });
  const bad = F.validateEnvelope({ uuid: 'nope', kind: 'photo', payload: 'x', client_ts: 'yesterday', device: 'd'.repeat(121) });
  assert.equal(bad.ok, false); assert.equal(bad.errors.length, 5);
  assert.equal(F.validateEnvelope(null).ok, false);
});

test('payloadHash is key-order independent and changes with any value', () => {
  const a = F.payloadHash({ b: 1, a: [1, { y: 2, x: 1 }] }), b = F.payloadHash({ a: [1, { x: 1, y: 2 }], b: 1 });
  assert.equal(a, b); assert.notEqual(a, F.payloadHash({ a: [1, { x: 1, y: 2 }], b: 2 })); assert.match(a, /^[0-9a-f]{64}$/);
});

test('chunkPlan caps at 300 KB and 64 chunks; missing/assemble round-trip; a missing chunk is named', () => {
  const plan = F.chunkPlan(150 * 1024); assert.deepEqual(plan, { chunk_bytes: 65536, chunks_total: 3, size: 153600 });
  assert.throws(() => F.chunkPlan(F.MAX_PHOTO_BYTES + 1), /field cap/);
  assert.throws(() => F.chunkPlan(0), /positive/);
  assert.deepEqual(F.missingChunks([0, 2], 3), [1]);
  const buf = Buffer.alloc(plan.size, 7); const chunks = [];
  for (let i = 0; i < plan.chunks_total; i++) chunks.push({ idx: i, data: buf.subarray(i * plan.chunk_bytes, (i + 1) * plan.chunk_bytes).toString('base64') });
  assert.ok(F.assembleChunks(chunks, { total: 3, size: plan.size }).equals(buf));
  let err; try { F.assembleChunks(chunks.slice(0, 2), { total: 3, size: plan.size }); } catch (e) { err = e; }
  assert.equal(err.code, 'INVALID'); assert.deepEqual(err.missing, [2]);
  assert.throws(() => F.assembleChunks(chunks, { total: 3, size: plan.size + 1 }), /expected/);
});

test('payload validators: tracker, action (status or comment), ticket subject; conflict policy declared per kind', () => {
  assert.equal(F.validateTrackerPayload({ key: 'k', cells: [{}] }), null);
  assert.match(F.validateTrackerPayload({ key: 'k', cells: [] }), /cells/);
  assert.equal(F.validateActionPayload({ source: 'inspection', id: 3, status_change: 'Closed' }), null);
  assert.equal(F.validateActionPayload({ source: 'meetings', id: 3, body: 'note' }), null);
  assert.match(F.validateActionPayload({ source: 'meetings', id: 3 }), /status_change or a comment/);
  assert.match(F.validateActionPayload({ source: 'x', id: 1, body: 'b' }), /source/);
  assert.equal(F.validateTicketPayload({ subject: 'Printer down' }), null); assert.match(F.validateTicketPayload({}), /subject/);
  assert.deepEqual(Object.keys(F.CONFLICT_POLICY).sort(), [...F.KINDS].sort());
});

test('dataAsOf: newest as_of across widgets, null when nothing is dated (never now())', () => {
  assert.equal(F.dataAsOf({ a: { as_of: '2026-10-01T00:00:00.000Z' }, b: { as_of: '2026-10-05T00:00:00.000Z' }, c: {} }), '2026-10-05T00:00:00.000Z');
  assert.equal(F.dataAsOf({ a: {}, b: null }), null); assert.equal(F.dataAsOf(null), null);
});
