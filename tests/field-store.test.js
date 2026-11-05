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
  st._tick(100 * 864e5); assert.deepEqual(await st.purgeOutbox({ days: 90 }), { deleted: 1, kept_unresolved: 1 }, 'E-F01: the unresolved received row is kept');
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

test('E-F01 purge: an old applying / failed / received row is never purged; applied and rejected are', async () => {
  const st = (await mk()); await st.init();
  const id = (n) => `${n}f1e4c3a-9b7d-4e21-a3f5-0c8d1e2f3a4b`;
  for (const [n, kind] of [[1, 'ticket'], [2, 'inspection'], [3, 'tracker'], [4, 'tracker'], [5, 'action']]) await st.receive({ uuid: id(n), userId: 7, kind, payloadHash: 'h' });
  await st.claim(id(1), { kind: 'ticket' });                                   // stuck applying
  await st.claim(id(2), { kind: 'inspection' }).then((c) => st.finish(id(2), 'failed', { error: 'internal_error' }, c));
  await st.finish(id(3), 'applied', { saved: 1 }); await st.finish(id(4), 'rejected', { error: 'no' });   // 5 stays received
  st._tick(120 * 864e5);
  assert.deepEqual(await st.purgeOutbox({ days: 90 }), { deleted: 2, kept_unresolved: 3 });
  assert.equal((await st.getOutbox(id(1))).status, 'applying');
  assert.deepEqual(await st.outboxStats(), { received: 1, applying: 1, applied: 0, rejected: 0, failed: 1 });
});

test('E-F01 listUnresolved: no payload, ages, error, outcome_unknown, filters', async () => {
  const st = (await mk()); await st.init();
  const id = (n) => `${n}a1e4c3a-9b7d-4e21-a3f5-0c8d1e2f3a4b`;
  await st.receive({ uuid: id(1), userId: 7, kind: 'ticket', payloadHash: 'h', device: 'Pixel' }); await st.claim(id(1), { kind: 'ticket' });
  await st.receive({ uuid: id(2), userId: 8, kind: 'inspection', payloadHash: 'h' });
  const c = await st.claim(id(2), { kind: 'inspection' }); await st.finish(id(2), 'failed', { error: 'internal_error', correlation_id: 'x' }, c);
  await st.receive({ uuid: id(3), userId: 8, kind: 'tracker', payloadHash: 'h' }); await st.finish(id(3), 'applied', { saved: 1 });
  st._tick(30 * 60000);
  const all = await st.listUnresolved();
  assert.deepEqual(all.map((r) => r.uuid), [id(1), id(2)], 'applied rows are not listed');
  const t = all[0];
  assert.deepEqual(Object.keys(t).sort(), ['age_min', 'applying_for_min', 'claimed_at', 'error', 'kind', 'not_reclaimable', 'outcome_unknown', 'received_at', 'status', 'user_id', 'uuid'].sort(), 'no payload, hash or device');
  assert.equal(t.age_min, 30); assert.equal(t.applying_for_min, 30); assert.equal(t.not_reclaimable, true);
  assert.equal(all[1].error, 'internal_error');
  assert.deepEqual((await st.listUnresolved({ status: 'failed' })).map((r) => r.uuid), [id(2)]);
  assert.deepEqual((await st.listUnresolved({ kind: 'ticket' })).map((r) => r.uuid), [id(1)]);
  assert.equal((await st.listUnresolved({ olderThanMin: 60 })).length, 0);
  assert.equal((await st.listUnresolved({ status: 'applied' })).length, 0, 'final statuses are not a valid filter');
});

test('E-F01 resolve: release a ticket needs confirmation + reason; mark_rejected ends any open entry; release then one claim', async () => {
  const st = (await mk()); await st.init();
  const id = (n) => `${n}b1e4c3a-9b7d-4e21-a3f5-0c8d1e2f3a4b`;
  await st.receive({ uuid: id(1), userId: 7, kind: 'ticket', payloadHash: 'h' }); await st.claim(id(1), { kind: 'ticket' });
  await assert.rejects(st.resolve(id(1), { action: 'release', reason: 'checked SDP' }), /confirm/);
  await assert.rejects(st.resolve(id(1), { action: 'release', reason: 'short', confirmCheckedSdp: true }), /10 characters/);
  await assert.rejects(st.resolve(id(1), { action: 'delete', reason: 'whatever reason' }), /mark_rejected or release/);
  await assert.rejects(st.resolve(id(1), { action: 'mark_rejected', reason: '' }), /reason/);
  const r = await st.resolve(id(1), { action: 'release', reason: 'SDP checked: no request #123 created', confirmCheckedSdp: true, actor: 'admin1' });
  assert.deepEqual([r.from, r.to], ['applying', 'failed']);
  assert.equal((await st.getOutbox(id(1))).result.released.by, 'admin1');
  const both = await Promise.all([st.claim(id(1), { kind: 'ticket' }), st.claim(id(1), { kind: 'ticket' })]);
  assert.equal(both.filter(Boolean).length, 1, 'after release exactly one send claims it');
  await assert.rejects(st.resolve(id(9), { action: 'mark_rejected', reason: 'gone' }), /not found/);
  await st.receive({ uuid: id(2), userId: 7, kind: 'inspection', payloadHash: 'h' });
  await assert.rejects(st.resolve(id(2), { action: 'release', reason: 'nothing to release' }), /only an entry in applying/);
  const m = await st.resolve(id(2), { action: 'mark_rejected', reason: 'duplicate of another entry' });
  assert.equal(m.to, 'rejected'); const row = await st.getOutbox(id(2)); assert.match(row.result.error, /refused by an administrator/); assert.ok(row.applied_at);
  await assert.rejects(st.resolve(id(2), { action: 'mark_rejected', reason: 'again' }), /already rejected/);
});

test('E-F01 CLI: dry run by default, refused while the switch is off, applies + logs with --apply', async () => {
  const st = (await mk()); await st.init();
  const cli = require('../tools/field/outbox-admin');
  const V = '7c1e4c3a-9b7d-4e21-a3f5-0c8d1e2f3a4b';
  await st.receive({ uuid: V, userId: 7, kind: 'inspection', payloadHash: 'h' }); await st.claim(V, { kind: 'inspection' });
  const logs = []; const events = [];
  const deps = (on) => ({ store: st, loadConfig: async () => ({ field_outbox_resolve_enabled: on ? '1' : '0' }), logEvent: async (e) => events.push(e), log: (m) => logs.push(m), actor: 'ops' });
  assert.equal((await cli.run([], deps(false))).listed, 1);
  const dry = await cli.run([`--resolve=${V}`, '--action=release', '--reason=phone crashed mid-send'], deps(true));
  assert.equal(dry.dry_run, true); assert.equal((await st.getOutbox(V)).status, 'applying');
  assert.equal((await cli.run([`--resolve=${V}`, '--action=release', '--reason=phone crashed mid-send', '--apply'], deps(false))).error, 'disabled');
  const done = await cli.run([`--resolve=${V}`, '--action=release', '--reason=phone crashed mid-send', '--apply'], deps(true));
  assert.equal(done.to, 'failed'); assert.equal(events.length, 1); assert.equal(events[0].risk, 1); assert.equal(events[0].details.reason, 'phone crashed mid-send');
});
