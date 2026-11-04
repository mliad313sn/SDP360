'use strict';
// A-07 — inspection drafts move from localStorage (~5 MB, quota errors swallowed) to
// IndexedDB through public/lib/draftStore.js. These tests pin the module contract with
// injected adapters: node has no IndexedDB, so the store is built around an adapter.
const test = require('node:test');
const assert = require('node:assert');
const DS = require('../public/lib/draftStore');

const PREFIX = 'em_it_inspection_v2';

function fakeLocalStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

test('put then get round-trips a 12 MB state object through the memory adapter', async () => {
  const store = DS.makeDraftStore({ adapter: DS.memoryAdapter() });
  const big = 'x'.repeat(12 * 1024 * 1024);
  const state = { meta: { f_id: 'EM-1' }, items: { 'net-01': { photos: [{ dataUrl: big }] } } };
  const r = await store.put('EM-1', state);
  assert.equal(r.ok, true);
  const back = await store.get('EM-1');
  assert.equal(back.items['net-01'].photos[0].dataUrl.length, big.length);
  assert.deepEqual(await store.keys(), ['EM-1']);
});

test('put serialises at call time: mutating the object after put() does not change the stored value', async () => {
  const store = DS.makeDraftStore({ adapter: DS.memoryAdapter() });
  const state = { meta: { f_site: 'A' } };
  const p = store.put('EM-1', state);
  state.meta.f_site = 'B';                // e.g. switchInspection swaps state before the write lands
  assert.equal((await p).ok, true);
  assert.equal((await store.get('EM-1')).meta.f_site, 'A');
});

test('a rejecting adapter makes put resolve {ok:false} with the QuotaExceededError (no throw swallowed)', async () => {
  const adapter = Object.assign(DS.memoryAdapter(), {
    set: () => Promise.reject({ name: 'QuotaExceededError', message: 'quota' }),
  });
  const store = DS.makeDraftStore({ adapter });
  const r = await store.put('EM-1', { meta: {} });
  assert.equal(r.ok, false);
  assert.equal(r.error.name, 'QuotaExceededError');
});

test('a synchronously throwing adapter (localStorage quota) is reported, not thrown', async () => {
  const ls = fakeLocalStorage();
  ls.setItem = () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
  const store = DS.makeDraftStore({ adapter: DS.localStorageAdapter(ls, PREFIX + '__data__') });
  const r = await store.put('EM-1', { meta: {} });
  assert.equal(r.ok, false);
  assert.equal(r.error.name, 'QuotaExceededError');
});

test('migrateFromLocalStorage moves every data key, verifies, removes the localStorage copies, keeps index/current/queue keys', async () => {
  const ls = fakeLocalStorage({
    [PREFIX + '__index']: '[{"id":"EM-1"},{"id":"EM-2"}]',
    [PREFIX + '__current']: 'EM-1',
    em_insp_sync_queue: '["EM-2"]',
    [PREFIX + '__data__EM-1']: JSON.stringify({ meta: { f_id: 'EM-1' } }),
    [PREFIX + '__data__EM-2']: JSON.stringify({ meta: { f_id: 'EM-2' } }),
  });
  const store = DS.makeDraftStore({ adapter: DS.memoryAdapter() });
  const res = await DS.migrateFromLocalStorage(ls, store, PREFIX);
  assert.equal(res.moved, 2);
  assert.equal(res.kept, 0);
  assert.deepEqual((await store.keys()).sort(), ['EM-1', 'EM-2']);
  assert.equal((await store.get('EM-2')).meta.f_id, 'EM-2');
  assert.equal(ls.getItem(PREFIX + '__data__EM-1'), null);
  assert.equal(ls.getItem(PREFIX + '__data__EM-2'), null);
  assert.ok(ls.getItem(PREFIX + '__index'));
  assert.equal(ls.getItem(PREFIX + '__current'), 'EM-1');
  assert.equal(ls.getItem('em_insp_sync_queue'), '["EM-2"]');
});

test('migrateFromLocalStorage is idempotent (second run moves nothing)', async () => {
  const ls = fakeLocalStorage({ [PREFIX + '__data__EM-1']: '{"meta":{}}' });
  const store = DS.makeDraftStore({ adapter: DS.memoryAdapter() });
  assert.equal((await DS.migrateFromLocalStorage(ls, store, PREFIX)).moved, 1);
  const second = await DS.migrateFromLocalStorage(ls, store, PREFIX);
  assert.equal(second.moved, 0);
  assert.equal(second.kept, 0);
  assert.deepEqual(await store.keys(), ['EM-1']);
});

test('migration keeps the localStorage copy when the read-back verification fails', async () => {
  const raw = JSON.stringify({ meta: { f_id: 'EM-1' } });
  const ls = fakeLocalStorage({ [PREFIX + '__data__EM-1']: raw });
  const mem = DS.memoryAdapter();
  const adapter = Object.assign({}, mem, { get: async () => '{"corrupted":true}' });
  const store = DS.makeDraftStore({ adapter });
  const res = await DS.migrateFromLocalStorage(ls, store, PREFIX);
  assert.equal(res.moved, 0);
  assert.equal(res.kept, 1);
  assert.equal(ls.getItem(PREFIX + '__data__EM-1'), raw, 'the only good copy stays');
});

test('migration keeps the localStorage copy when the IndexedDB write fails', async () => {
  const ls = fakeLocalStorage({ [PREFIX + '__data__EM-1']: '{"meta":{}}' });
  const adapter = Object.assign(DS.memoryAdapter(), { set: () => Promise.reject({ name: 'QuotaExceededError' }) });
  const res = await DS.migrateFromLocalStorage(ls, DS.makeDraftStore({ adapter }), PREFIX);
  assert.equal(res.moved, 0);
  assert.equal(res.kept, 1);
  assert.ok(ls.getItem(PREFIX + '__data__EM-1'));
});

// Minimal IndexedDB fake: enough to prove a quota error surfacing as a transaction
// ABORT (not a thrown exception) is turned into a rejected write.
function fakeIndexedDB({ abortWith } = {}) {
  const data = new Map();
  const later = (f) => setTimeout(f, 0);
  return {
    open() {
      const req = {};
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore() {},
        close() {},
        transaction() {
          const tx = {};
          const store = {
            put(v, k) { const r = {}; later(() => { if (abortWith) { tx.error = abortWith; tx.onabort && tx.onabort(); } else { data.set(k, v); r.onsuccess && r.onsuccess(); tx.oncomplete && tx.oncomplete(); } }); return r; },
            get(k) { const r = {}; later(() => { r.result = data.get(k); r.onsuccess && r.onsuccess(); tx.oncomplete && tx.oncomplete(); }); return r; },
            delete(k) { const r = {}; later(() => { data.delete(k); tx.oncomplete && tx.oncomplete(); }); return r; },
            getAllKeys() { const r = {}; later(() => { r.result = [...data.keys()]; r.onsuccess && r.onsuccess(); tx.oncomplete && tx.oncomplete(); }); return r; },
          };
          tx.objectStore = () => store;
          return tx;
        },
      };
      later(() => { req.result = db; req.onsuccess && req.onsuccess(); });
      return req;
    },
  };
}

test('idbAdapter: a quota error that arrives as a transaction abort rejects the write', async () => {
  const quota = { name: 'QuotaExceededError', message: 'quota' };
  const store = DS.makeDraftStore({ adapter: DS.idbAdapter(fakeIndexedDB({ abortWith: quota })) });
  const r = await store.put('EM-1', { meta: {} });
  assert.equal(r.ok, false);
  assert.equal(r.error.name, 'QuotaExceededError');
});

test('idbAdapter round-trips through a working IndexedDB', async () => {
  const store = DS.makeDraftStore({ adapter: DS.idbAdapter(fakeIndexedDB()) });
  assert.equal((await store.put('EM-1', { meta: { a: 1 } })).ok, true);
  assert.deepEqual(await store.get('EM-1'), { meta: { a: 1 } });
  assert.deepEqual(await store.keys(), ['EM-1']);
  await store.del('EM-1');
  assert.equal(await store.get('EM-1'), null);
});

test('autoAdapter falls back to localStorage when IndexedDB cannot open, and says so', async () => {
  const ls = fakeLocalStorage();
  const broken = { open() { throw Object.assign(new Error('denied'), { name: 'InvalidStateError' }); } };
  const store = DS.makeDraftStore({ adapter: DS.autoAdapter({ indexedDB: broken, localStorage: ls, prefix: PREFIX + '__data__' }) });
  assert.equal(await store.ready(), 'localStorage');
  assert.equal((await store.put('EM-1', { meta: {} })).ok, true);
  assert.ok(ls.getItem(PREFIX + '__data__EM-1'));
});

test('autoAdapter with no storage at all reports every save as failed', async () => {
  const store = DS.makeDraftStore({ adapter: DS.autoAdapter({ indexedDB: null, localStorage: null, prefix: 'p' }) });
  const r = await store.put('EM-1', { meta: {} });
  assert.equal(r.ok, false);
});

test('migration never runs onto a localStorage fallback store (it would delete the drafts it copies onto themselves)', async () => {
  const raw = '{"meta":{"f_id":"EM-1"}}';
  const ls = fakeLocalStorage({ [PREFIX + '__data__EM-1']: raw });
  const broken = { open() { throw Object.assign(new Error('denied'), { name: 'InvalidStateError' }); } };
  const store = DS.makeDraftStore({ adapter: DS.autoAdapter({ indexedDB: broken, localStorage: ls, prefix: PREFIX + '__data__' }) });
  await store.ready();
  const res = await DS.migrateFromLocalStorage(ls, store, PREFIX);
  assert.equal(res.moved, 0);
  assert.equal(ls.getItem(PREFIX + '__data__EM-1'), raw);
  assert.deepEqual(await store.get('EM-1'), { meta: { f_id: 'EM-1' } });
});

test('rollback helper copies drafts back to localStorage and skips the ones over 4 MB', async () => {
  const store = DS.makeDraftStore({ adapter: DS.memoryAdapter() });
  await store.put('EM-S', { meta: { f_id: 'EM-S' } });
  await store.put('EM-L', { blob: 'x'.repeat(5 * 1024 * 1024) });
  const ls = fakeLocalStorage();
  const warn = console.warn; console.warn = () => {};
  const res = await DS.reverseCopyToLocalStorage(store, ls, PREFIX);
  console.warn = warn;
  assert.equal(res.copied, 1);
  assert.deepEqual(res.skipped.map(s => s.id), ['EM-L']);
  assert.ok(ls.getItem(PREFIX + '__data__EM-S'));
  assert.equal(ls.getItem(PREFIX + '__data__EM-L'), null);
});
