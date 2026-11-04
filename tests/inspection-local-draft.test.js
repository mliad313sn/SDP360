'use strict';
// A-07 — inspection.html: a failed local save is reported, never hidden.
// Runs the page's own functions (sliced with tests/_fn-source.js) under new Function
// with injected fakes, like tests/inspection-delete-client.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fnSource } = require('./_fn-source');
const DS = require('../public/lib/draftStore');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'inspection.html'), 'utf8');
const QUOTA = { name: 'QuotaExceededError', message: 'The quota has been exceeded.' };

function build(names, env, body, ret) {
  return new Function(...names, body + '\nreturn ' + ret + ';')(...names.map(n => env[n]));
}

// The page's own status helpers ride along with the function under test.
function helpers(...names) {
  return [...names, '_localFailHtml', 'escapeLocal'].map(n => fnSource(SRC, n)).join('\n');
}

function rejectingStore() {
  return DS.makeDraftStore({ adapter: Object.assign(DS.memoryAdapter(), { set: () => Promise.reject(QUOTA) }) });
}

test('saveCurrent resolves ok:false when the store rejects with QuotaExceededError', async () => {
  const env = { currentId: 'EM-1', state: { meta: {} }, DRAFTS: rejectingStore(), _requestPersist: () => {}, console: { warn() {}, log() {} } };
  const names = Object.keys(env);
  const saveCurrent = build(names, env, fnSource(SRC, 'saveCurrent'), 'saveCurrent');
  const r = await saveCurrent();
  assert.equal(r.ok, false);
  assert.equal(r.error.name, 'QuotaExceededError');
});

test('saveCurrent resolves ok:true through a working store, written under the id at call time', async () => {
  const store = DS.makeDraftStore({ adapter: DS.memoryAdapter() });
  const env = { currentId: 'EM-1', state: { meta: { f_site: 'A' } }, DRAFTS: store, _requestPersist: () => {}, console: { warn() {}, log() {} } };
  const names = Object.keys(env);
  const saveCurrent = build(names, env, fnSource(SRC, 'saveCurrent'), 'saveCurrent');
  assert.equal((await saveCurrent()).ok, true);
  assert.equal((await store.get('EM-1')).meta.f_site, 'A');
});

function patchEnv(orig) {
  const marks = [];
  const env = {
    window: { saveCurrent: orig },
    currentId: 'EM-1',
    state: { meta: { f_site: 'SGO' } },
    _markStatus: (html, kind) => marks.push({ html, kind }),
    _hhmm: () => '10:00',
    _promotedIds: new Set(),
    _stateIsMeaningful: () => true,
    _localDirty: false,
    _lastLocalError: null,
    describeLocalSaveError: DS.describeError,
  };
  const names = Object.keys(env);
  const api = build(names, env, helpers('installSavePatch', '_markSavedLocally'),
    '{ installSavePatch, get lastLocalError(){ return _lastLocalError; } }');
  api.installSavePatch();
  return { env, api, marks };
}

test('patched saveCurrent shows the red "NOT saved on this device" status on failure and never "Saved locally"', async () => {
  const { env, api, marks } = patchEnv(async () => ({ ok: false, error: QUOTA }));
  const r = await env.window.saveCurrent();
  assert.equal(r.ok, false);
  assert.ok(marks.some(m => /NOT saved on this device/.test(m.html) && m.kind === 'local-fail'), JSON.stringify(marks));
  assert.ok(marks.some(m => /Save now/.test(m.html) && /export/i.test(m.html)), 'the way out is named');
  assert.ok(!marks.some(m => /Saved locally/.test(m.html)), 'never claims a local save');
  assert.equal(api.lastLocalError.name, 'QuotaExceededError');
});

test('patched saveCurrent shows "Saved locally" only after a resolved ok', async () => {
  let release;
  const pending = new Promise(res => { release = res; });
  const { env, api, marks } = patchEnv(() => pending);
  const p = env.window.saveCurrent();
  await new Promise(r => setTimeout(r, 5));
  assert.ok(!marks.some(m => /Saved locally/.test(m.html)), 'nothing claimed while the write is pending');
  release({ ok: true });
  await p;
  assert.ok(marks.some(m => /Saved locally/.test(m.html)));
  assert.equal(api.lastLocalError, null);
});

test('flushQueue keeps an id in the queue when its draft is missing (does not dequeue)', async () => {
  let queue = ['EM-GONE', 'EM-OK'];
  const posted = [], toasts = [];
  const store = DS.makeDraftStore({ adapter: DS.memoryAdapter() });
  await store.put('EM-OK', { meta: { f_id: 'EM-OK' } });
  const env = {
    readQueue: () => queue,
    dequeue: (id) => { queue = queue.filter(x => x !== id); },
    refreshSyncPill: () => {},
    postSave: async (s) => { posted.push(s.meta.f_id); },
    DRAFTS: store,
    currentId: 'EM-OTHER',
    state: { meta: { f_id: 'EM-OTHER' } },
    showToast: (m) => toasts.push(m),
    _missingIds: new Set(),
    console: { warn() {}, log() {} },
  };
  const names = Object.keys(env);
  const flushQueue = build(names, env, fnSource(SRC, 'flushQueue'), 'flushQueue');
  await flushQueue();
  assert.deepEqual(queue, ['EM-GONE'], 'the missing draft stays queued, the good one is sent');
  assert.deepEqual(posted, ['EM-OK']);
  assert.ok(env._missingIds.has('EM-GONE'));
  assert.ok(toasts.some(t => /missing/i.test(t)), toasts.join(' | '));
});

test('flushQueue sends the live in-memory state for the current inspection even when its draft is missing', async () => {
  let queue = ['EM-CUR'];
  const posted = [];
  const env = {
    readQueue: () => queue,
    dequeue: (id) => { queue = queue.filter(x => x !== id); },
    refreshSyncPill: () => {},
    postSave: async (s) => { posted.push(s.meta.f_id); },
    DRAFTS: DS.makeDraftStore({ adapter: DS.memoryAdapter() }),
    currentId: 'EM-CUR',
    state: { meta: { f_id: 'EM-CUR' } },
    showToast: () => {},
    _missingIds: new Set(),
    console: { warn() {}, log() {} },
  };
  const names = Object.keys(env);
  const flushQueue = build(names, env, fnSource(SRC, 'flushQueue'), 'flushQueue');
  await flushQueue();
  assert.deepEqual(posted, ['EM-CUR']);
  assert.deepEqual(queue, []);
});

test('forceSyncNow does not claim "safe locally" after a failed local save', async () => {
  const toasts = [], marks = [];
  const el = () => ({ textContent: '', disabled: false, classList: { add() {}, remove() {} } });
  const env = {
    currentId: 'EM-1',
    state: { meta: {} },
    document: { getElementById: () => el() },
    postSave: async () => { throw new Error('save HTTP 413 — Payload Too Large'); },
    enqueue: () => {}, dequeue: () => {},
    flushQueue: async () => {},
    _promotedIds: new Set(),
    _localDirty: true,
    _lastServerError: null,
    _lastLocalError: QUOTA,
    showToast: (m) => toasts.push(m),
    _markStatus: (html, kind) => marks.push({ html, kind }),
    _hhmm: () => '10:00',
    describeLocalSaveError: DS.describeError,
    setTimeout: () => {},
  };
  const names = Object.keys(env);
  const forceSyncNow = build(names, env, helpers('forceSyncNow'), 'forceSyncNow');
  const ok = await forceSyncNow();
  assert.equal(ok, false);
  assert.ok(!toasts.some(t => /safe locally/i.test(t)), toasts.join(' | '));
  assert.ok(toasts.some(t => /not saved on this device/i.test(t)), toasts.join(' | '));
  const last = marks[marks.length - 1];
  assert.ok(!/Saved locally/.test(last.html), last.html);
  assert.ok(/NOT saved on this device/.test(last.html), last.html);
});

test('forceSyncNow keeps the "safe locally" wording when the local save did succeed', async () => {
  const toasts = [];
  const el = () => ({ textContent: '', disabled: false, classList: { add() {}, remove() {} } });
  const env = {
    currentId: 'EM-1', state: { meta: {} },
    document: { getElementById: () => el() },
    postSave: async () => { throw new Error('offline'); },
    enqueue: () => {}, dequeue: () => {}, flushQueue: async () => {},
    _promotedIds: new Set(), _localDirty: true, _lastServerError: null, _lastLocalError: null,
    showToast: (m) => toasts.push(m), _markStatus: () => {}, _hhmm: () => '10:00',
    describeLocalSaveError: DS.describeError, setTimeout: () => {},
  };
  const names = Object.keys(env);
  const forceSyncNow = build(names, env, helpers('forceSyncNow'), 'forceSyncNow');
  await forceSyncNow();
  assert.ok(toasts.some(t => /safe locally/i.test(t)));
});

test('the page loads lib/draftStore.js before the main inline script', () => {
  const at = SRC.indexOf('src="lib/draftStore.js"');
  assert.ok(at > 0, 'script tag present');
  assert.ok(at < SRC.indexOf('const STORAGE_PREFIX'), 'loaded before the body script');
  assert.ok(/nonce="%%CSP_NONCE%%" src="lib\/draftStore\.js"/.test(SRC));
});

test('the old swallowing localStorage write is gone from saveCurrent', () => {
  const body = fnSource(SRC, 'saveCurrent');
  assert.ok(!/localStorage\.setItem/.test(body));
  assert.ok(!/catch\s*\(e\)\s*\{\s*console\.warn\('Save failed'/.test(body));
});

function switchEnv(over) {
  const env = Object.assign({
    currentId: 'EM-A', state: { meta: { f_id: 'EM-A' } },
    saveCurrent: async () => ({ ok: true }),
    _confirmLeaveUnsaved: () => true,
    refreshSavedSelect: () => {}, applyStateToUI: () => {},
    loadCurrent: async () => true,
    localStorage: { setItem: () => {} }, KEY_CURRENT: 'cur',
    window: {}, showToast: () => {},
  }, over);
  const names = Object.keys(env);
  return build(names, env, fnSource(SRC, 'switchInspection'),
    '{ switchInspection, get id(){ return currentId; } }');
}

test('switchInspection stays on the inspection when its draft could not be saved and the user cancels', async () => {
  let asked = 0;
  const api = switchEnv({ saveCurrent: async () => ({ ok: false, error: QUOTA }), _confirmLeaveUnsaved: () => { asked++; return false; } });
  await api.switchInspection('EM-B');
  assert.equal(asked, 1);
  assert.equal(api.id, 'EM-A');
});

test('switchInspection never keeps the old state under a new id whose draft is missing', async () => {
  const api = switchEnv({ loadCurrent: async () => false });
  await api.switchInspection('EM-B');
  assert.equal(api.id, 'EM-A', 'back on the inspection whose state is on screen');
});
