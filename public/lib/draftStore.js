/* Inspection drafts on this device (A-07, 2026-11-02).
 *
 * The inspection form used to keep each draft in localStorage. A documented inspection
 * carries its photos inline (base64), 25-80 MB, while localStorage holds ~5 MB — and the
 * QuotaExceededError was swallowed, so the page said "Saved locally" for a draft that was
 * not saved anywhere. Drafts now live in IndexedDB (database 'em-inspection-drafts' —
 * deliberately NOT the field app's 'field' database, whose kv store auth.js wipes on
 * logout), and every save RESOLVES with its outcome instead of hiding it.
 *
 * Contract:
 *   makeDraftStore({adapter}) → { put, putRaw, get, getRaw, del, keys, ready, kind }
 *     put(id, obj)   serialises synchronously, at call time (before any await), so a later
 *                    change of the page's state/currentId cannot leak into the write. Never
 *                    rejects: resolves {ok:true, bytes} or {ok:false, error}.
 *     get(id)        → parsed object, or null when there is no draft. Rejects on a read error.
 *   adapters: idbAdapter(indexedDB, dbName, storeName), localStorageAdapter(ls, prefix),
 *             memoryAdapter() (tests), autoAdapter({indexedDB, localStorage, prefix}) —
 *             IndexedDB, or localStorage when IndexedDB cannot open (never on a quota error).
 *   migrateFromLocalStorage(ls, store, prefix) copies every <prefix>__data__<id> key into
 *     the store, verifies it by reading it back, and only then removes the localStorage
 *     key. Idempotent. Index, current and queue keys stay where they are.
 *
 * UMD: the page loads it with <script src>; the node tests require() it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DraftStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DB_NAME = 'em-inspection-drafts';
  const STORE_NAME = 'drafts';

  function toError(e, fallback) {
    if (e && typeof e === 'object' && (e.name || e.message)) return e;
    const err = new Error(e == null ? (fallback || 'unknown storage error') : String(e));
    err.name = 'StorageError';
    return err;
  }

  function memoryAdapter() {
    const m = new Map();
    return {
      kind: 'memory',
      ready: () => Promise.resolve('memory'),
      set: (k, v) => { m.set(k, v); return Promise.resolve(); },
      get: (k) => Promise.resolve(m.has(k) ? m.get(k) : null),
      del: (k) => { m.delete(k); return Promise.resolve(); },
      keys: () => Promise.resolve([...m.keys()]),
    };
  }

  function localStorageAdapter(ls, prefix) {
    const unavailable = () => {
      const e = new Error('no storage available on this device');
      e.name = 'StorageUnavailableError';
      return e;
    };
    const wrap = (fn) => (...a) => {
      if (!ls) return Promise.reject(unavailable());
      try { return Promise.resolve(fn(...a)); } catch (e) { return Promise.reject(toError(e)); }
    };
    return {
      kind: 'localStorage',
      ready: () => Promise.resolve('localStorage'),
      set: wrap((k, v) => { ls.setItem(prefix + k, v); }),
      get: wrap((k) => ls.getItem(prefix + k)),
      del: wrap((k) => { ls.removeItem(prefix + k); }),
      keys: wrap(() => {
        const out = [];
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i);
          if (k && k.indexOf(prefix) === 0) out.push(k.slice(prefix.length));
        }
        return out;
      }),
    };
  }

  function idbAdapter(idb, dbName, storeName) {
    dbName = dbName || DB_NAME;
    storeName = storeName || STORE_NAME;
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((resolve, reject) => {
        if (!idb || typeof idb.open !== 'function') {
          const e = new Error('IndexedDB is not available'); e.name = 'StorageUnavailableError';
          reject(e); return;
        }
        let req;
        try { req = idb.open(dbName, 1); } catch (e) { reject(toError(e)); return; }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => { try { db.close(); } catch (_) {} dbp = null; };
          resolve(db);
        };
        req.onerror = () => reject(toError(req.error, 'IndexedDB open failed'));
        req.onblocked = () => reject(toError(null, 'IndexedDB open blocked by another tab'));
      });
      dbp.catch(() => { dbp = null; });
      return dbp;
    }
    // One request per transaction. A quota error does not throw: the transaction ABORTS
    // and tx.error carries the QuotaExceededError — so the promise settles on
    // oncomplete / onabort, never on the request's onsuccess alone.
    function run(mode, op) {
      return open().then((db) => new Promise((resolve, reject) => {
        let tx, req, out;
        try {
          tx = db.transaction(storeName, mode);
          req = op(tx.objectStore(storeName));
        } catch (e) { reject(toError(e)); return; }
        if (req) req.onsuccess = () => { out = req.result; };
        tx.oncomplete = () => resolve(out);
        tx.onabort = () => reject(toError(tx.error || (req && req.error), 'IndexedDB transaction aborted'));
        tx.onerror = () => { /* the abort that follows carries the error */ };
      }));
    }
    return {
      kind: 'indexeddb',
      open,
      ready: () => open().then(() => 'indexeddb'),
      set: (k, v) => run('readwrite', (s) => s.put(v, k)).then(() => undefined),
      get: (k) => run('readonly', (s) => s.get(k)).then((v) => (v === undefined ? null : v)),
      del: (k) => run('readwrite', (s) => s.delete(k)).then(() => undefined),
      keys: () => run('readonly', (s) => s.getAllKeys()).then((ks) => (ks || []).map(String)),
    };
  }

  // IndexedDB when it opens; localStorage only when IndexedDB cannot open at all. A
  // quota error on IndexedDB is NOT a reason to fall back (localStorage is smaller).
  function autoAdapter(opts) {
    const o = opts || {};
    let chosen = null, readyP = null, kind = null, fallbackReason = null;
    function ready() {
      if (!readyP) {
        readyP = (async () => {
          if (o.indexedDB) {
            const a = idbAdapter(o.indexedDB, o.dbName, o.storeName);
            try { await a.open(); chosen = a; kind = 'indexeddb'; return kind; }
            catch (e) { fallbackReason = toError(e); }
          }
          chosen = localStorageAdapter(o.localStorage || null, o.prefix || '');
          kind = 'localStorage';
          return kind;
        })();
      }
      return readyP;
    }
    const via = (name) => (...a) => ready().then(() => chosen[name](...a));
    return {
      get kind() { return kind; },
      get fallbackReason() { return fallbackReason; },
      ready,
      set: via('set'), get: via('get'), del: via('del'), keys: via('keys'),
    };
  }

  function makeDraftStore(opts) {
    const adapter = opts && opts.adapter;
    if (!adapter) throw new Error('makeDraftStore: adapter required');
    function putRaw(id, text) {
      let p;
      try { p = Promise.resolve(adapter.set(String(id), text)); }
      catch (e) { p = Promise.reject(e); }
      return p.then(() => ({ ok: true, bytes: text.length }),
                    (e) => ({ ok: false, error: toError(e) }));
    }
    function put(id, obj) {
      let text;
      try { text = JSON.stringify(obj); }   // synchronous, before any await
      catch (e) { return Promise.resolve({ ok: false, error: toError(e) }); }
      return putRaw(id, text);
    }
    function getRaw(id) { return Promise.resolve().then(() => adapter.get(String(id))); }
    function get(id) {
      return getRaw(id).then((raw) => (raw == null || raw === '' ? null : JSON.parse(raw)));
    }
    return {
      put, putRaw, get, getRaw,
      del: (id) => Promise.resolve().then(() => adapter.del(String(id))),
      keys: () => Promise.resolve().then(() => adapter.keys()),
      ready: () => Promise.resolve(adapter.ready ? adapter.ready() : (adapter.kind || 'unknown')),
      get kind() { return adapter.kind || null; },
    };
  }

  async function migrateFromLocalStorage(ls, store, prefix) {
    const out = { moved: 0, kept: 0, errors: [] };
    if (!ls || !store) return out;
    // A store that falls back to localStorage writes the SAME keys: "moving" a draft
    // onto itself and then removing the source would delete it. Nothing to migrate.
    if (store.kind === 'localStorage') { out.skipped = 'store is localStorage'; return out; }
    const dataPrefix = prefix + '__data__';
    const found = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.indexOf(dataPrefix) === 0) found.push(k);
    }
    for (const k of found) {
      const id = k.slice(dataPrefix.length);
      const raw = ls.getItem(k);
      if (raw == null) continue;
      const w = await store.putRaw(id, raw);
      if (!w.ok) { out.kept++; out.errors.push({ id, error: w.error && (w.error.name || w.error.message) }); continue; }
      let back = null;
      try { back = await store.getRaw(id); } catch (_) { back = null; }
      if (back !== raw) { out.kept++; out.errors.push({ id, error: 'verification failed' }); continue; }
      try { ls.removeItem(k); out.moved++; }
      catch (e) { out.kept++; out.errors.push({ id, error: 'could not remove the localStorage copy' }); }
    }
    return out;
  }

  // ROLLBACK helper (never called by the page): copies drafts back into localStorage so
  // a reverted page (which reads localStorage only) still finds them. Entries larger
  // than maxBytes (default 4 MB) cannot fit and are skipped + reported, never truncated.
  async function reverseCopyToLocalStorage(store, ls, prefix, maxBytes) {
    const out = { copied: 0, skipped: [] };
    const limit = maxBytes || 4 * 1024 * 1024;
    for (const id of await store.keys()) {
      const raw = await store.getRaw(id);
      if (raw == null) continue;
      if (raw.length > limit) { out.skipped.push({ id, bytes: raw.length, reason: 'too large' }); continue; }
      try { ls.setItem(prefix + '__data__' + id, raw); out.copied++; }
      catch (e) { out.skipped.push({ id, bytes: raw.length, reason: (e && e.name) || 'write failed' }); }
    }
    if (out.skipped.length && typeof console !== 'undefined') console.warn('[drafts] not copied back:', out.skipped);
    return out;
  }

  // Plain-language reason for a failed save on this device (status line, toasts).
  function describeError(e) {
    const name = e && e.name;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return 'device storage is full';
    if (name === 'StorageUnavailableError') return 'no storage available on this device';
    if (name === 'InvalidStateError' || name === 'SecurityError') return 'browser storage is blocked (private window?)';
    return (e && (e.message || name)) || 'unknown storage error';
  }

  return {
    DB_NAME, STORE_NAME,
    makeDraftStore, memoryAdapter, localStorageAdapter, idbAdapter, autoAdapter,
    migrateFromLocalStorage, reverseCopyToLocalStorage, describeError,
  };
});
