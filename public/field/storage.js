/* B-06 — field app storage durability (pure, browser + Node). The outbox lives in IndexedDB, which a
 * browser may evict under storage pressure unless the origin is "persistent". makeGuard(navigator.storage):
 *   ensurePersist() asks for persistent storage ONCE per page (idempotent; already-persistent → no ask);
 *   usage()         → { usage, quota, ratio, warn } or null when the browser cannot tell (never 0);
 * isQuotaError(e) recognises the "storage full" errors so a write that failed is reported, never dropped. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FieldStorage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var WARN_RATIO = 0.7;
  function isQuotaError(e) {
    if (!e) return false;
    return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014;
  }
  function makeGuard(st) {
    var pending = null;
    function ensurePersist() {
      if (pending) return pending;
      if (!st || typeof st.persist !== 'function') return Promise.resolve(null);
      pending = Promise.resolve().then(function () {
        return typeof st.persisted === 'function' ? st.persisted() : false;
      }).then(function (already) { return already ? true : st.persist(); })
        .then(function (granted) { return !!granted; }, function () { return null; });
      return pending;
    }
    function usage() {
      if (!st || typeof st.estimate !== 'function') return Promise.resolve(null);
      return Promise.resolve().then(function () { return st.estimate(); }).then(function (e) {
        var u = e && Number(e.usage), q = e && Number(e.quota);
        if (!e || !isFinite(u) || !isFinite(q) || q <= 0) return null;
        var ratio = Math.round((u / q) * 1000) / 1000;
        return { usage: u, quota: q, ratio: ratio, warn: ratio > WARN_RATIO };
      }, function () { return null; });
    }
    return { ensurePersist: ensurePersist, usage: usage };
  }
  return { makeGuard: makeGuard, isQuotaError: isQuotaError, WARN_RATIO: WARN_RATIO };
});
