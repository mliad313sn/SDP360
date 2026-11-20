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

let dropped = false; let dropDone = false;
async function cleanup() { if (dropped) return; dropped = true; try { if (!ctx.keep) await dropTestDb(ctx); dropDone = true; } catch (_) {} }
process.once('beforeExit', cleanup);
// P11 r6 O-6 — `node --test --test-force-exit` (the mandated command) ends the process with process.exit(): 'beforeExit'
// never fires and the throwaway database leaked until a sweep. 'exit' always fires but runs synchronously only, so it
// launches a DETACHED dropper (tests/_pg-drop-detached.js) that outlives this process; the connection details travel in
// its environment, never on its command line. Idempotent (DROP … IF EXISTS), skipped when the async drop completed.
process.once('exit', () => {
  if (dropDone || ctx.keep) return;
  try {
    const { spawn } = require('node:child_process');
    const env = { ...process.env, SDP_DROP_CTX: JSON.stringify({ name: ctx.name || null, schema: ctx.schema || null, adminUrl: ctx.adminUrl || null, baseUrl: ctx.schema ? ctx.url : null }) };
    delete env.NODE_OPTIONS;
    const cp = spawn(process.execPath, [require('node:url').fileURLToPath(new URL('./_pg-drop-detached.js', import.meta.url))], { detached: true, stdio: 'ignore', env, windowsHide: true });
    cp.unref();
  } catch (_) { /* the end-of-run sweep remains the safety net */ }
});
}
