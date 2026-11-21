'use strict';
// P11 round 9 (UX/field) — pure / static checks on the inspection form.
//  F-32 — a save stored by the offline queue drain (flushQueue) left the form on the version it had loaded, so the
//         user's next Save now was refused 409 "changed by someone else" although nobody else saved. The drain now
//         writes the save's version / known action ids / loaded fingerprint back into the copy it sent (the open form
//         or the stored draft) exactly as Save now does, and drains run one after another so two drains never send the
//         same draft with the same version.
// The server side of F-33 (clients without a version) is in p11-r9-field-fixes.smoke.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const page = read('public/inspection.html');
const has = (name) => page.indexOf('function ' + name + '(') >= 0;

function grab(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' exists');
  const start = src.lastIndexOf('async ', i) === i - 6 ? i - 6 : i;
  let depth = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
  return src.slice(start, j + 1);
}
const plain = (v) => JSON.parse(JSON.stringify(v));

// The queue drain of the page, run against stubbed network / draft store / queue. The functions are the page's own
// source; only what they call is stubbed.
function makeDrain({ currentId, state, drafts, post }) {
  const names = ['_photoSig', 'inspItemFp', 'inspActionFp', 'inspSigFp', 'inspFingerprint', 'inspKnownIds', 'mergeKeptRows', 'uiF']
    .concat(['applySaveOutcome', 'announceSaveOutcome', 'flushQueueOnce'].filter(has), ['flushQueue']);
  const queue = [];
  const store = new Map(Object.entries(drafts || {}).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  const sent = [];
  const ctx = {
    window: {}, console, Promise, JSON, Map, Set, Number, Array, Object, String, setTimeout,
    currentId, state,
    _missingIds: new Set(), _promotedIds: new Set(), _localDirty: true, _lastServerError: 'x', _flushChain: Promise.resolve(),
    readQueue: () => queue.slice(), dequeue: (id) => { const i = queue.indexOf(id); if (i >= 0) queue.splice(i, 1); },
    refreshSyncPill: () => {}, showToast: () => {}, renderActions: () => {}, autosave: () => {}, _rawSave: () => {},
    DRAFTS: { get: async (id) => (store.has(id) ? JSON.parse(JSON.stringify(store.get(id))) : null), put: async (id, v) => { store.set(id, JSON.parse(JSON.stringify(v))); } },
    postSave: async (st) => { const body = JSON.parse(JSON.stringify(st)); sent.push(body); return post(body, sent.length); },
  };
  vm.createContext(ctx);
  vm.runInContext('let __unused; ' + names.map((n) => grab(page, n)).join('\n') + '\n;this.__flushQueue = flushQueue;', ctx);
  return { ctx, queue, store, sent, flush: () => ctx.__flushQueue() };
}

// a server stand-in that behaves like _saveInspectionPg for versions: 409 when the base version is not the current
function versionedServer(start) {
  let cur = start, n = 0;
  return {
    get version() { return cur; },
    post(body) {
      if (body.server_version && body.server_version !== cur) { const e = new Error('save HTTP 409'); e.status = 409; e.reason = 'inspection_changed'; throw e; }
      cur = 'v' + (++n + 1);
      const ids = (body.actions || []).map((a, i) => (a.id != null ? Number(a.id) : 100 + i));
      return { id: 'X', action_ids: ids, action_states: ids.map((id) => ({ id, status: 'Open', owner: '' })), kept_rows: [], version: cur };
    },
  };
}

test('F-32: the open form drained from the queue takes the version, known ids and base its save returned', async () => {
  const srv = versionedServer('v1');
  const state = { meta: { f_id: 'X', f_obs: 'edit 1' }, items: {}, actions: [{ desc: 'A1', id: 7 }, { desc: 'new here' }], status: 'draft', server_version: 'v1', known_action_ids: [7] };
  const d = makeDrain({ currentId: 'X', state, post: (b) => srv.post(b) });
  d.queue.push('X');
  await d.flush();
  assert.strictEqual(d.sent.length, 1);
  assert.strictEqual(d.queue.length, 0, 'dequeued');
  assert.strictEqual(state.server_version, srv.version, 'the next Save now is based on the version the drained save stored');
  assert.deepStrictEqual(plain(state.known_action_ids).sort((a, b) => a - b), [7, 101]);
  assert.strictEqual(state.actions[1].id, 101, 'the new action carries its stored id (the next save updates it)');
  assert.ok(state.base_fp && state.base_fp.meta.f_obs === 'edit 1', 'the loaded fingerprint is what was stored');
  // the user's next Save now (same version check as the server) is accepted
  state.meta.f_obs = 'edit 2';
  assert.doesNotThrow(() => srv.post(JSON.parse(JSON.stringify(state))), 'no false "changed by someone else"');
});

test('F-32: a queued draft that is not open is updated in the draft store, and the next drain chains its version', async () => {
  const srv = versionedServer('v1');
  const draft = { meta: { f_id: 'Y' }, items: {}, actions: [], status: 'draft', server_version: 'v1', known_action_ids: [] };
  const d = makeDrain({ currentId: 'OTHER', state: { meta: {} }, drafts: { Y: draft }, post: (b) => srv.post(b) });
  d.queue.push('Y');
  await d.flush();
  assert.strictEqual(d.store.get('Y').server_version, srv.version, 'the stored draft carries the new version (boot drain, page reload)');
  // the user edits that draft offline again: queued again, drained again — it must use the version just returned
  d.queue.push('Y');
  await d.flush();
  assert.strictEqual(d.sent.length, 2);
  assert.strictEqual(d.sent[1].server_version, 'v2', 'the second drain sends the version the first one stored');
  assert.strictEqual(d.queue.length, 0, 'both drains stored (no 409, nothing parked as a conflict)');
});

test('F-32: two drains started together (boot + Save now) run one after another — never a false conflict', async () => {
  const srv = versionedServer('v1');
  const state = { meta: { f_id: 'Z' }, items: {}, actions: [], status: 'draft', server_version: 'v1', known_action_ids: [] };
  let release;
  const gate = new Promise((r) => { release = r; });
  const d = makeDrain({ currentId: 'Z', state, post: async (b, n) => { if (n === 1) await gate; return srv.post(b); } });
  d.queue.push('Z');
  const a = d.flush();
  // the second drain starts while the first is still waiting for the server; the id is still queued
  d.queue.includes('Z') || d.queue.push('Z');
  const b = d.flush();
  release();
  await Promise.all([a, b]);
  assert.strictEqual(d.queue.length, 0);
  assert.ok(d.sent.length >= 1);
  for (let i = 1; i < d.sent.length; i++) assert.notStrictEqual(d.sent[i].server_version, d.sent[0].server_version, 'a later drain never resends the base version the first one consumed');
  assert.strictEqual(state.server_version, srv.version);
});

test('F-32: Save now and the queue drain share one write-back; a drained Save now is reported as saved', () => {
  const fsn = grab(page, 'forceSyncNow');
  const fq = grab(page, 'flushQueueOnce');
  assert.match(fsn, /applySaveOutcome\(state, out, sentActions, sentRemoved\)/);
  assert.match(fq, /applySaveOutcome\(draft, out, sentActions, sentRemoved\)/);
  assert.match(fq, /DRAFTS\.put\(id, draft\)/, 'a draft that is not open is written back to the draft store');
  assert.match(grab(page, 'applySaveOutcome'), /st\.server_version = out\.version/);
  assert.match(grab(page, 'flushQueue'), /_flushChain/, 'drains are serialised');
  assert.match(fsn, /drained\.saved\.has\(id\)/, 'Save now #1 whose retry was stored by the drain does not say "Server queued"');
});
