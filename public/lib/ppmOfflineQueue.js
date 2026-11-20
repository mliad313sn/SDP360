/* PPM parity W4 — offline project editing: a local queue of plan edits, replay with row versions, conflict + merge.
 * (PURE logic over an injected async key/value store — public/lib/draftStore.js shape {get, put}; UMD.)
 *
 * Same envelope discipline as the field app outbox (public/field/app.js): each queued edit is {uuid, kind, id,
 * project_id, body, base, at, state}, kept IN ORDER, removed only on a terminal answer. Here:
 *   kind   'task' | 'milestone' (the only plan rows with a row version, migration 092)
 *   body   the fields the person changed (+ id, project_id for a new row); never a whole row
 *   base   the value of those same fields (and the row version) as the person saw them when editing; null for a new row.
 *          An earlier queued edit of the same row and field replaces the base value (P04, T8: no false conflict
 *          against the person's own earlier offline edit)
 * replay(queue, {send, current}) walks the queue in order:
 *   - send(entry, body) → {ok:true} → removed;  {status:409} → conflict check; network error ({network:true}) → stop
 *     (still offline: nothing is lost, the order is kept); any other refusal → the entry is marked 'refused' with the
 *     server's code (shown to the person, never silently dropped).
 *   - on 409: current(entry) gives the row as stored now. Fields the person changed where the stored value moved
 *     away from base are CONFLICTS ("theirs" vs "mine"). No conflicting field (someone changed OTHER fields) → the
 *     edit is re-sent once with the current version (auto-rebase, mine kept, theirs kept). Otherwise the entry is
 *     marked 'conflict' with {mine, theirs, base} per field, and replay goes on with the next entry.
 * resolve(entry, choices, current) builds the merged edit: each conflicting field 'mine' | 'theirs'; the body keeps
 *   only 'mine' fields (+ the non-conflicting ones) with the CURRENT version; nothing left → the entry is dropped.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PpmOfflineQueue = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var KINDS = ['task', 'milestone'];
  var META = ['id', 'version', 'project_id', 'reason'];

  function uuid() {
    var c = (typeof crypto !== 'undefined' && crypto) || null;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return 'q-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  // P11 R3-3: compare by CONTENT. A scalar keeps the old loose rule (null ≡ '', 40 ≡ '40'); an object is compared key by
  // key whatever the key order; an array of objects (dependency_links) is compared as a set (order-insensitive by link
  // identity: the items are sorted by their canonical form). String([{…}]) used to be "[object Object]" for every value
  // of the same length, so a colleague's links change was never seen as a conflict.
  function canon(v) {
    if (v == null) return '';
    if (Array.isArray(v)) {
      var items = v.map(canon);
      if (v.some(function (x) { return x != null && typeof x === 'object'; })) items.sort();
      return '[' + items.map(function (x) { return JSON.stringify(x); }).join(',') + ']';
    }
    if (typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + JSON.stringify(canon(v[k])); }).join(',') + '}';
    return String(v);
  }
  var same = function (a, b) {
    var oa = a != null && typeof a === 'object', ob = b != null && typeof b === 'object';
    if (!oa && !ob) return String(a == null ? '' : a) === String(b == null ? '' : b);
    return canon(a) === canon(b);
  };
  function fieldsOf(body) { return Object.keys(body || {}).filter(function (k) { return META.indexOf(k) < 0 && body[k] !== undefined; }); }

  /** A queue persisted under one key of an async {get, put} store (draftStore / memory). */
  function makeQueue(store, key) {
    key = key || 'ppm-offline-queue';
    var load = function () { return Promise.resolve(store.get(key)).then(function (v) { return Array.isArray(v) ? v : (v && Array.isArray(v.items) ? v.items : []); }).catch(function () { return []; }); };
    var save = function (items) { return Promise.resolve(store.put(key, { items: items })).then(function (r) { if (r && r.ok === false) throw new Error(r.error || 'the device refused to keep the queued edit'); return items; }); };
    return {
      list: load,
      enqueue: function (e) {
        if (!e || KINDS.indexOf(e.kind) < 0) return Promise.reject(new Error('only task and milestone edits are queued'));
        var entry = { uuid: e.uuid || uuid(), kind: e.kind, id: e.id == null ? null : Number(e.id), project_id: e.project_id == null ? null : Number(e.project_id),
          body: e.body || {}, base: e.base || null, at: e.at || new Date().toISOString(), state: 'pending', code: null, conflicts: null };
        return load().then(function (items) {
          // P04 (T8): an earlier queued edit of the SAME row and field is the person's own value — it becomes the base
          // of this edit, so that replay does not report the person's own first edit as someone else's change.
          if (entry.id != null && entry.base) {
            items.forEach(function (x) {
              if (x.kind !== entry.kind || x.id !== entry.id || (x.state !== 'pending' && x.state !== 'conflict')) return;
              fieldsOf(entry.body).forEach(function (f) { if (Object.prototype.hasOwnProperty.call(x.body || {}, f) && x.body[f] !== undefined) entry.base[f] = x.body[f]; });
            });
          }
          items.push(entry); return save(items);
        }).then(function () { return entry; });
      },
      update: function (u, patch) { return load().then(function (items) { items.forEach(function (x, i) { if (x.uuid === u) items[i] = Object.assign({}, x, patch); }); return save(items); }); },
      remove: function (u) { return load().then(function (items) { return save(items.filter(function (x) { return x.uuid !== u; })); }); },
    };
  }

  /** The conflicting fields of an edit against the row as stored now. */
  function conflictsOf(entry, current) {
    if (!current) return [];
    // P11 R1-F3: an edit of an EXISTING row queued without base (the cached detail did not hold the row) cannot tell
    // "nobody touched it" from "a colleague changed it": every field whose stored value differs from mine is a conflict.
    var base = entry.base;
    if (!base) { if (entry.id == null) return []; base = {}; }
    return fieldsOf(entry.body).filter(function (f) {
      var noBase = !Object.prototype.hasOwnProperty.call(base, f);
      return (noBase || !same(current[f], base[f])) && !same(current[f], entry.body[f]);
    }).map(function (f) { return { field: f, base: base[f] == null ? null : base[f], mine: entry.body[f], theirs: current[f] == null ? null : current[f] }; });
  }
  function withVersion(body, version) { var b = Object.assign({}, body); if (version != null) b.version = Number(version); return b; }

  /**
   * deps: { send(entry, body) → Promise<{ok, status, code, network}>, current(entry) → Promise<row|null> }
   * → Promise<{ sent, conflicts, refused, stopped }>
   */
  function replay(queue, deps) {
    var out = { sent: 0, conflicts: 0, refused: 0, stopped: false };
    return queue.list().then(function (items) {
      var pending = items.filter(function (x) { return x.state === 'pending'; });
      var i = 0;
      function next() {
        if (i >= pending.length) return out;
        var e = pending[i++];
        // P11 R1-F3: no base for an existing row → read the stored row FIRST (the body may carry no version, so the
        // server would accept it blindly): conflict on any field that differs from mine, otherwise send with the
        // current version.
        if (e.id != null && !e.base) {
          return Promise.resolve(deps.current(e)).then(function (cur) {
            if (!cur) return queue.update(e.uuid, { state: 'refused', code: 'NOT_FOUND' }).then(function () { out.refused++; return next(); });
            var c0 = conflictsOf(e, cur);
            if (c0.length) return queue.update(e.uuid, { state: 'conflict', conflicts: c0, current_version: cur.version == null ? null : Number(cur.version) }).then(function () { out.conflicts++; return next(); });
            return deps.send(e, withVersion(e.body, cur.version)).then(function (r0) {
              if (r0 && r0.ok) { out.sent++; return queue.remove(e.uuid).then(next); }
              if (r0 && r0.network) { out.stopped = true; return out; }
              if (r0 && r0.status === 409) return queue.update(e.uuid, { state: 'conflict', conflicts: [], current_version: cur.version }).then(function () { out.conflicts++; return next(); });
              return queue.update(e.uuid, { state: 'refused', code: (r0 && r0.code) || ('HTTP_' + (r0 && r0.status)) }).then(function () { out.refused++; return next(); });
            });
          }, function () { out.stopped = true; return out; });
        }
        return deps.send(e, e.body).then(function (r) {
          if (r && r.ok) { out.sent++; return queue.remove(e.uuid).then(next); }
          if (r && r.network) { out.stopped = true; return out; }
          if (r && r.status === 409 && e.id != null) {
            return deps.current(e).then(function (cur) {
              if (!cur) return queue.update(e.uuid, { state: 'refused', code: 'NOT_FOUND' }).then(function () { out.refused++; return next(); });
              var c = conflictsOf(e, cur);
              if (!c.length) {
                return deps.send(e, withVersion(e.body, cur.version)).then(function (r2) {
                  if (r2 && r2.ok) { out.sent++; return queue.remove(e.uuid).then(next); }
                  if (r2 && r2.network) { out.stopped = true; return out; }
                  return queue.update(e.uuid, { state: 'conflict', conflicts: [], current_version: cur.version }).then(function () { out.conflicts++; return next(); });
                });
              }
              return queue.update(e.uuid, { state: 'conflict', conflicts: c, current_version: cur.version == null ? null : Number(cur.version) }).then(function () { out.conflicts++; return next(); });
            });
          }
          return queue.update(e.uuid, { state: 'refused', code: (r && r.code) || ('HTTP_' + (r && r.status)) }).then(function () { out.refused++; return next(); });
        });
      }
      return next();
    });
  }

  /**
   * choices: { field: 'mine' | 'theirs' } (a conflicting field without a choice keeps 'theirs' — never overwrite blindly).
   * → { body, drop } — body = the merged edit with the current version; drop = nothing of mine is left to send.
   */
  function resolve(entry, choices, current) {
    choices = choices || {};
    var conflicting = (entry.conflicts || []).map(function (c) { return c.field; });
    var body = {};
    fieldsOf(entry.body).forEach(function (f) {
      if (conflicting.indexOf(f) < 0 || choices[f] === 'mine') body[f] = entry.body[f];
    });
    // a non-conflicting field equal to what is stored now carries no change
    Object.keys(body).forEach(function (f) { if (current && same(current[f], body[f])) delete body[f]; });
    if (!Object.keys(body).length) return { body: null, drop: true };
    if (entry.id != null) body.id = entry.id;
    var v = current && current.version != null ? current.version : entry.current_version;
    return { body: withVersion(body, v), drop: false };
  }

  return { KINDS: KINDS, makeQueue: makeQueue, conflictsOf: conflictsOf, replay: replay, resolve: resolve, fieldsOf: fieldsOf };
});
