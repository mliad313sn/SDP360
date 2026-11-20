'use strict';
// P11 round 3 (R3-3) + carried R1-F3 — the offline replay must never silently overwrite a colleague's change:
// object arrays (dependency_links) are compared by content (order-insensitive by link identity), and an edit queued
// with NO base (the cached detail did not hold the row) is a conflict unless the stored value already equals mine.
const { test } = require('node:test');
const assert = require('node:assert');
const OQ = require('../public/lib/ppmOfflineQueue');

const memStore = () => { const m = {}; return { get: async (k) => (k in m ? JSON.parse(m[k]) : null), put: async (k, v) => { m[k] = JSON.stringify(v); return { ok: true }; } }; };
const serverOf = (row) => {
  const s = { row, sent: [] };
  s.deps = {
    send: async (e, b) => { s.sent.push(b); if (b.version != null && b.version !== s.row.version) return { status: 409 }; s.row = { ...s.row, ...b, version: s.row.version + 1 }; return { ok: true }; },
    current: async () => s.row,
  };
  return s;
};

test('R3-3: a concurrent dependency_links change of the same length is a conflict, never overwritten', async () => {
  const q = OQ.makeQueue(memStore(), 'k');
  await q.enqueue({ kind: 'task', id: 7, body: { id: 7, version: 1, dependency_links: [{ id: 4, type: 'FS', lag: 0 }] }, base: { version: 1, dependency_links: [{ id: 3, type: 'FS', lag: 0 }] } });
  const s = serverOf({ id: 7, version: 2, dependency_links: [{ id: 5, type: 'SS', lag: 2 }] });
  const r = await OQ.replay(q, s.deps);
  assert.deepEqual(r, { sent: 0, conflicts: 1, refused: 0, stopped: false });
  assert.deepEqual(s.row.dependency_links, [{ id: 5, type: 'SS', lag: 2 }]);
  const [e] = await q.list();
  assert.equal(e.state, 'conflict');
  assert.equal(e.conflicts[0].field, 'dependency_links');
});

test('R3-3: links compared by content, order-insensitive (same links reordered = no change, auto-rebase)', async () => {
  const q = OQ.makeQueue(memStore(), 'k');
  const base = [{ id: 3, type: 'FS', lag: 0 }, { id: 9, type: 'SS', lag: 1 }];
  await q.enqueue({ kind: 'task', id: 7, body: { id: 7, version: 1, dependency_links: [{ id: 4, type: 'FS', lag: 0 }], name: 'x' }, base: { version: 1, dependency_links: base, name: 'a' } });
  // someone touched another field and stored the same links in another order, keys in another order
  const s = serverOf({ id: 7, version: 2, name: 'a', progress_pct: 30, dependency_links: [{ lag: 1, type: 'SS', id: 9 }, { type: 'FS', id: 3, lag: 0 }] });
  const r = await OQ.replay(q, s.deps);
  assert.equal(r.sent, 1); assert.equal(r.conflicts, 0);
  assert.deepEqual(s.row.dependency_links, [{ id: 4, type: 'FS', lag: 0 }]);
  assert.equal(s.row.progress_pct, 30);
});

test('R3-3: a changed lag on the same link is a difference', async () => {
  const c = OQ.conflictsOf({ body: { dependency_links: [{ id: 3, type: 'FS', lag: 5 }] }, base: { dependency_links: [{ id: 3, type: 'FS', lag: 0 }] } }, { dependency_links: [{ id: 3, type: 'FS', lag: 2 }] });
  assert.equal(c.length, 1);
});

test('R1-F3: an edit queued without base does not overwrite a colleague (conflict, theirs kept)', async () => {
  const q = OQ.makeQueue(memStore(), 'k');
  await q.enqueue({ kind: 'task', id: 7, body: { id: 7, version: 1, name: 'mine' }, base: null });
  const s = serverOf({ id: 7, version: 2, name: 'theirs' });
  const r = await OQ.replay(q, s.deps);
  assert.equal(r.sent, 0); assert.equal(r.conflicts, 1);
  assert.equal(s.row.name, 'theirs');
  const [e] = await q.list();
  assert.deepEqual(e.conflicts, [{ field: 'name', base: null, mine: 'mine', theirs: 'theirs' }]);
});

test('R1-F3: without base and without a version in the body, the stored row is checked BEFORE sending', async () => {
  const q = OQ.makeQueue(memStore(), 'k');
  await q.enqueue({ kind: 'task', id: 7, body: { id: 7, name: 'mine' }, base: null });
  const s = serverOf({ id: 7, version: 2, name: 'theirs' });
  const r = await OQ.replay(q, s.deps);
  assert.equal(r.conflicts, 1); assert.equal(s.sent.length, 0); assert.equal(s.row.name, 'theirs');
});

test('R1-F3: without base, a stored value already equal to mine is not a conflict (sent with the current version)', async () => {
  const q = OQ.makeQueue(memStore(), 'k');
  await q.enqueue({ kind: 'task', id: 7, body: { id: 7, version: 1, name: 'same', progress_pct: 40 }, base: null });
  const s = serverOf({ id: 7, version: 3, name: 'same', progress_pct: '40' });
  const r = await OQ.replay(q, s.deps);
  assert.equal(r.sent, 1); assert.equal(r.conflicts, 0);
  assert.equal(s.sent[s.sent.length - 1].version, 3);
});

test('R1-F3: a NEW row (no id) without base is sent as before', async () => {
  const q = OQ.makeQueue(memStore(), 'k');
  await q.enqueue({ kind: 'task', id: null, body: { project_id: 1, name: 'new' }, base: null });
  const sent = [];
  const r = await OQ.replay(q, { send: async (e, b) => { sent.push(b); return { ok: true }; }, current: async () => { throw new Error('not called'); } });
  assert.equal(r.sent, 1); assert.equal(sent.length, 1);
});
