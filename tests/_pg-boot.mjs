// PostgreSQL-only test boot (2026-10-28, PO-08: SQLite removed).
// Preloaded by `npm test` (--import) into EVERY test process, before the test file runs.
// Each test file is its own process, so each gets its own throwaway SCHEMA (or database),
// every module is switched to postgres, initialised and migrated here — top-level await
// guarantees the singletons are ready before the first `require` of the test file
// (CommonJS module cache is shared with createRequire).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { provisionTestDb, dropTestDb } = require('./pg-helpers.js');

// Only the test-file process itself: children spawned by a test (stubs, CLIs, the
// node --test parent) inherit NODE_OPTIONS but must not provision a database.
const IS_TEST_FILE = /[\\/]tests[\\/][^\\/]+\.test\.js$/.test(process.argv[1] || '');
const MODULES = ['REPORTS', 'TRACKER', 'MEETINGS', 'INSPECTION', 'ASSETS'];
if (IS_TEST_FILE) {
// SDP_TEST_PG_URL points the file at an existing database instead (e.g. a restored prod
// snapshot for the QA suites) — never provisioned, never dropped.
const ctx = process.env.SDP_TEST_PG_URL ? { url: process.env.SDP_TEST_PG_URL, keep: true } : await provisionTestDb();
if (!ctx) throw new Error('[pg-boot] PostgreSQL is required for the test suite (set PG_ADMIN_URL or PG_URL)');
process.env.PG_URL = ctx.url;
process.env.DATABASE_URL = ctx.url;
for (const m of MODULES) process.env[m + '_BACKEND'] = 'postgres';
globalThis.__sdpPgTestCtx = ctx;

const quiet = console.log; console.log = () => {};
try {
  await require('../reports-db.js').initPgReports();
  await require('../tracker-db.js').initPgTracker();
  await require('../meetings-db.js').initPgMeetings();
  await require('../inspection-db.js').initPgInspection();
  await require('../assets-db.js').initPgAssets();
  await require('../db/migrate.js').migrateAtBoot({ log: () => {} });
} finally { console.log = quiet; }

let dropped = false;
async function cleanup() { if (dropped) return; dropped = true; try { if (!ctx.keep) await dropTestDb(ctx); } catch (_) {} }
process.once('beforeExit', cleanup);
}
