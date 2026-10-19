'use strict';
// RBAC audit 2026-10-02, lot 3 (A3) — inspection.html confirmDelete.
// The server only lets admin+ delete an inspection (routes/inspection.js). When it
// REFUSED (403) the page still wiped its local copy and toasted "Inspection deleted.":
// the user believed it was gone while the record stayed on the server. A refusal now
// aborts with a clear message; a 404 (draft never synced) still cleans up locally.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fnSource } = require('./_fn-source');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'inspection.html'), 'utf8');

async function runDelete(status) {
  const removed = [], toasts = [];
  let index = [{ id: 'EM-1' }, { id: 'EM-2' }];
  const env = {
    closeDeleteModal: () => {},
    currentId: 'EM-1',
    KEY_DATA: (id) => 'data:' + id,
    KEY_CURRENT: 'cur',
    getIndex: () => index,
    setIndex: (i) => { index = i; },
    loadCurrent: () => {}, newInspection: () => {}, refreshSavedSelect: () => {},
    showToast: (m, kind) => toasts.push({ m, kind }),
    localStorage: { removeItem: (k) => removed.push(k), getItem: () => '', setItem: () => {} },
    document: { cookie: '' },
    fetch: async () => ({ ok: status >= 200 && status < 300, status, json: async () => ({ error: 'Forbidden — admin role required' }) }),
    console: { warn() {}, log() {} },
  };
  const names = Object.keys(env);
  const fn = new Function(...names, fnSource(SRC, 'confirmDelete') + '\nreturn confirmDelete;')(...names.map(n => env[n]));
  await fn();
  return { removed, toasts, index };
}

test('A3 a refused delete (403) keeps the local copy and never says "deleted"', async () => {
  const { removed, toasts, index } = await runDelete(403);
  assert.deepEqual(removed, [], 'nothing removed locally');
  assert.equal(index.length, 2, 'the inspection stays in the local index');
  assert.ok(!toasts.some(t => /Inspection deleted/i.test(t.m)), 'no success toast');
  assert.ok(toasts.some(t => /refus|denied|not allowed|administrat/i.test(t.m)), 'the refusal is explained');
});

test('A3 an expired session (401) is a refusal too', async () => {
  const { removed } = await runDelete(401);
  assert.deepEqual(removed, []);
});

test('A3 a draft that never reached the server (404) is still cleaned up locally', async () => {
  const { removed, index } = await runDelete(404);
  assert.deepEqual(removed, ['data:EM-1']);
  assert.equal(index.length, 1);
});

test('A3 a successful server delete removes the local copy', async () => {
  const { removed, toasts } = await runDelete(200);
  assert.deepEqual(removed, ['data:EM-1']);
  assert.ok(toasts.some(t => /Inspection deleted/i.test(t.m)));
});
