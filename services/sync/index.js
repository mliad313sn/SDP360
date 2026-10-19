'use strict';
// SDP360 — process-wide sync runner bound to the reports backend (sqlite or pg).
// Lazy: nothing is opened until the first getRunner()/getStore() call, so requiring this module
// from a route file has no side effect at boot and the test suites that force *_BACKEND=sqlite
// keep working unchanged.
//
// Usage from a cron job in server.js:
//   const { getRunner } = require('./services/sync');
//   cron.schedule('30 4 * * *', () => getRunner().run({ name: 'assets.sync', key: 'asset_id', fetch, apply }));
// Failures are mirrored to system_log (category 'sync') so they show on the System Logs page.

const { createSyncRunner } = require('./syncRunner');
const { makeSyncStore } = require('./syncStore');

let _store = null;
let _runner = null;
let _pgReady = null;

function getStore() {
  if (_store) return _store;
  const rdb = require('../../reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') {
    const pg = rdb.pgHandle();
    _store = makeSyncStore(pg, { init: false });
    // apply the pg DDL once; callers await ensureReady() before the first run
    _pgReady = pg.exec(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'db', 'postgres', 'sync', '001_init.sql'), 'utf8'))
      .catch((e) => console.warn('[sync] pg schema init failed (runs will not be recorded):', e.message));
  } else {
    _store = makeSyncStore(rdb.db);
    _pgReady = Promise.resolve();
  }
  return _store;
}

function ensureReady() { getStore(); return _pgReady; }

function getRunner() {
  if (_runner) return _runner;
  const store = getStore();
  let logEvent = null;
  try { ({ logEvent } = require('../../reports-db')); } catch (_) { /* tests without reports-db */ }
  _runner = createSyncRunner({
    store,
    onEvent(kind, p) {
      if (!logEvent) return;
      if (kind === 'sync_failed') logEvent({ category: 'sync', action: 'sync_failed', target: p.job, details: p, risk: 1 });
      else if (kind === 'sync_skipped_overlap') logEvent({ category: 'sync', action: 'sync_overlap_skipped', target: p.job, details: p });
    },
  });
  return _runner;
}

// test seam
function _reset() { _store = null; _runner = null; _pgReady = null; }

module.exports = { getStore, getRunner, ensureReady, _reset };
