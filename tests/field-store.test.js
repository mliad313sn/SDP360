'use strict';
// Step 10 — field store on sqlite: idempotent ledger (receive twice = one row), finish, stats, chunk upload lifecycle, purges.
const { test } = require('node:test');
const assert = require('node:assert');
const { makeFieldStore } = require('../services/fieldStore');
const U = '2f1e4c3a-9b7d-4e21-a3f5-0c8d1e2f3a4b';

async function mk() { let t = Date.parse('2026-10-19T08:00:00Z'); const st = makeFieldStore((await require('./_pg-fresh').freshStore(['field_outbox', 'field_uploads', 'field_chunks'])), { now: () => new Date(t).toISOString() }); st._tick = (ms) => { t += ms; }; return st; }

test('outbox: receive is idempotent, finish records status + result, list/stats/purge', async () => {
  const st = (await mk()); await st.init();
  const a = await st.receive({ uuid: U, userId: 7, kind: 'tracker', payloadHash: 'h1', clientTs: '2026-10-19T07:59:00Z', device: 'Pixel' });
  assert.equal(a.status, 'received'); assert.equal(a.user_id, 7);
  const b = await st.receive({ uuid: U, userId: 7, kind: 'tracker', payloadHash: 'OTHER' }); assert.equal(b.payload_hash, 'h1', 'existing row untouched');
  const f = await st.finish(U, 'applied', { saved: 2 }); assert.equal(f.status, 'applied'); assert.deepEqual(f.result, { saved: 2 }); assert.ok(f.applied_at);
  await assert.rejects(st.finish(U, 'weird'), /bad outbox status/);
  await st.receive({ uuid: U.replace('2f1e', '3f1e'), userId: 7, kind: 'action', payloadHash: 'h2' });
  assert.equal((await st.listOutbox(7)).length, 2); assert.equal((await st.listOutbox(8)).length, 0);
  assert.deepEqual(await st.outboxStats(), { received: 1, applying: 0, applied: 1, rejected: 0, failed: 0 });
  st._tick(100 * 864e5); assert.equal(await st.purgeOutbox({ days: 90 }), 2);
});

test('uploads: create → chunks (idempotent, range-checked) → complete drops chunks; abandoned uploads purged', async () => {
  const st = (await mk()); await st.init();
  const up = await st.createUpload({ userId: 7, ownerKind: 'inspection', ownerId: 'EM-IT-1', name: 'p.jpg', mime: 'image/jpeg', size: 100, chunkBytes: 64, chunksTotal: 2 });
  assert.equal(up.status, 'open'); assert.deepEqual(up.received, []);
  const c1 = await st.putChunk(up.id, 0, Buffer.alloc(64, 1).toString('base64')); assert.deepEqual(c1.received, [0]);
  await st.putChunk(up.id, 0, Buffer.alloc(64, 1).toString('base64')); assert.deepEqual((await st.getUpload(up.id)).received, [0], 'same idx twice = one chunk');
  await assert.rejects(st.putChunk(up.id, 2, 'AA=='), /out of range/); await assert.rejects(st.putChunk(up.id, 1, ''), /required/);
  await st.putChunk(up.id, 1, Buffer.alloc(36, 2).toString('base64'));
  assert.equal((await st.chunksOf(up.id)).length, 2);
  const done = await st.completeUpload(up.id, 'inspection/EM-IT-1/p.jpg'); assert.equal(done.status, 'done'); assert.equal(done.ref, 'inspection/EM-IT-1/p.jpg');
  assert.equal((await st.chunksOf(up.id)).length, 0, 'chunks dropped once the blob store holds the bytes');
  await assert.rejects(st.putChunk(up.id, 0, 'AA=='), /already completed/);
  await st.createUpload({ userId: 7, ownerKind: 'inspection', ownerId: 'x', name: 'q', mime: 'image/png', size: 10, chunkBytes: 64, chunksTotal: 1 });
  st._tick(49 * 3600e3); assert.equal(await st.purgeUploads({ hours: 48 }), 1); assert.equal((await st.listUploads(7)).length, 1, 'the completed one stays');
});

test('G19 claim: only one request applies an envelope; a transient failure is retryable; a stuck claim expires', async () => {
  const st = (await mk()); await st.init();
  const V = U.replace('2f1e', '4f1e');
  await st.receive({ uuid: V, userId: 7, kind: 'tracker', payloadHash: 'h' });
  const both = await Promise.all([st.claim(V, { kind: 'tracker' }), st.claim(V, { kind: 'tracker' })]);
  assert.strictEqual(both.filter(Boolean).length, 1, 'exactly one of two simultaneous sends wins');
  const c1 = both.find(Boolean);
  assert.equal((await st.getOutbox(V)).status, 'applying');
  await st.finish(V, 'failed', { error: 'internal_error' }, c1);
  const c2 = await st.claim(V, { kind: 'tracker' }); assert.ok(c2, 'failed → can be applied again');
  assert.equal(await st.claim(V, { kind: 'tracker' }), null, 'a fresh claim blocks a second one');
  st._tick(10 * 60000); assert.equal(await st.claim(V, { kind: 'tracker' }), null, 'still inside the 15-minute window (above the 5-minute proxy timeout)');
  st._tick(6 * 60000);
  const c3 = await st.claim(V, { kind: 'tracker' }); assert.ok(c3, 'a claim stuck for over 15 minutes is taken again');
  await assert.rejects(st.finish(V, 'applied', { saved: 1 }, c2), /claim on this entry was lost/, 'the request that lost its claim cannot overwrite');
  await st.finish(V, 'applied', { saved: 1 }, c3);
  assert.equal(await st.claim(V, { kind: 'tracker' }), null, 'applied is final');
});

test('G19 claim: a ticket or an action stuck in applying is never taken again automatically (not idempotent)', async () => {
  const st = (await mk()); await st.init();
  for (const kind of ['ticket', 'action']) {
    const W = (kind === 'ticket' ? '5' : '6') + U.slice(1);
    await st.receive({ uuid: W, userId: 7, kind, payloadHash: 'h' });
    assert.ok(await st.claim(W, { kind }));
    st._tick(60 * 60000);
    assert.equal(await st.claim(W, { kind }), null, kind);
  }
});
