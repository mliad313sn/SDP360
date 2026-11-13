'use strict';
// PPM parity W4 / T10 — offline project editing (PURE queue): order kept, zero loss offline, conflicts detected by row
// version on replay, auto-rebase when someone changed OTHER fields, merge per field (mine / theirs).
const { test } = require('node:test');
const assert = require('node:assert');
const OQ = require('../public/lib/ppmOfflineQueue');

const memStore = () => { const m = {}; return { get: async (k) => (k in m ? JSON.parse(m[k]) : null), put: async (k, v) => { m[k] = JSON.stringify(v); return { ok: true }; } }; };

test('50 edits made disconnected: kept in order, nothing lost while the network is down', async () => {
  const q = OQ.makeQueue(memStore(), 'k');
  for (let i = 0; i < 50; i++) await q.enqueue({ kind: 'task', id: i + 1, body: { id: i + 1, progress_pct: i }, base: { version: 1, progress_pct: null } });
  const r = await OQ.replay(q, { send: async () => ({ network: true }), current: async () => null });
  assert.equal(r.stopped, true);
  const items = await q.list();
  assert.equal(items.length, 50);
  assert.deepEqual(items.map((x) => x.id), Array.from({ length: 50 }, (_, i) => i + 1));
  const sent = [];
  const r2 = await OQ.replay(q, { send: async (e, b) => { sent.push(b.id); return { ok: true }; }, current: async () => null });
  assert.equal(r2.sent, 50); assert.deepEqual(sent, Array.from({ length: 50 }, (_, i) => i + 1));
  assert.equal((await q.list()).length, 0);
});

test('only task / milestone edits are queued', async () => {
  const q = OQ.makeQueue(memStore());
  await assert.rejects(q.enqueue({ kind: 'risk', body: {} }));
});

test('409 with someone changing OTHER fields: re-sent once with the current version (mine + theirs kept)', async () => {
  const q = OQ.makeQueue(memStore());
  await q.enqueue({ kind: 'task', id: 7, body: { id: 7, version: 2, progress_pct: 60 }, base: { version: 2, progress_pct: 40 } });
  const calls = [];
  const r = await OQ.replay(q, {
    send: async (e, b) => { calls.push(b); return calls.length === 1 ? { status: 409, code: 'STALE_VERSION' } : { ok: true }; },
    current: async () => ({ id: 7, version: 3, progress_pct: 40, name: 'renamed by someone else' }),
  });
  assert.equal(r.sent, 1); assert.equal(r.conflicts, 0);
  assert.deepEqual(calls[1], { id: 7, version: 3, progress_pct: 60 });
});

test('409 on the SAME field: a conflict with base / mine / theirs; merge keeps the chosen values with the current version', async () => {
  const q = OQ.makeQueue(memStore());
  await q.enqueue({ kind: 'task', id: 7, body: { id: 7, version: 2, progress_pct: 60, status: 'in_progress' }, base: { version: 2, progress_pct: 40, status: 'todo' } });
  const cur = { id: 7, version: 5, progress_pct: 80, status: 'blocked' };
  const r = await OQ.replay(q, { send: async () => ({ status: 409 }), current: async () => cur });
  assert.equal(r.conflicts, 1);
  const [e] = await q.list();
  assert.equal(e.state, 'conflict');
  assert.deepEqual(e.conflicts.map((c) => [c.field, c.base, c.mine, c.theirs]), [['progress_pct', 40, 60, 80], ['status', 'todo', 'in_progress', 'blocked']]);
  assert.deepEqual(OQ.resolve(e, { progress_pct: 'mine' }, cur), { body: { progress_pct: 60, id: 7, version: 5 }, drop: false }, 'a field without a choice keeps theirs');
  assert.deepEqual(OQ.resolve(e, { progress_pct: 'theirs', status: 'theirs' }, cur), { body: null, drop: true });
});

test('a refusal other than 409 is kept and marked (never silently dropped)', async () => {
  const q = OQ.makeQueue(memStore());
  await q.enqueue({ kind: 'task', id: 3, body: { id: 3, name: 'x' }, base: { version: 1, name: 'y' } });
  const r = await OQ.replay(q, { send: async () => ({ ok: false, status: 403, code: 'OWN_TASK_ONLY' }), current: async () => null });
  assert.equal(r.refused, 1);
  const [e] = await q.list();
  assert.deepEqual([e.state, e.code], ['refused', 'OWN_TASK_ONLY']);
});
