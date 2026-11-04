'use strict';
// B-05 — boots the REAL application (server.js, every PostgreSQL store, every migration) on a
// throwaway database and an ephemeral 127.0.0.1 port, for the browser journeys.
//
// Same database recipe as tests/_pg-boot.mjs (a fresh DATABASE when PG_ADMIN_URL can create one,
// otherwise a fresh SCHEMA on PG_URL) — that preload only fires for tests/<name>.test.js, so the
// journeys repeat it here. Every credential the app needs is generated per run (never a literal in
// the repository); the database URL comes from the environment of the job.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..', '..', '..');
const MODULES = ['REPORTS', 'TRACKER', 'MEETINGS', 'INSPECTION', 'ASSETS'];
const rnd = (n) => crypto.randomBytes(n).toString('hex');

async function bootApp() {
  const { provisionTestDb, dropTestDb } = require(path.join(ROOT, 'tests', 'pg-helpers.js'));
  process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-e2e-'));
  process.env.DASH_USER = 'e2e-admin-' + rnd(3);
  process.env.DASH_PASS = 'E2e!' + rnd(12);
  process.env.DASHBOARD_API_KEY = rnd(16);
  process.env.SDP_TEST_NO_RATE_LIMIT = '1';
  process.env.TZ = process.env.TZ || 'UTC';
  for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'unused-in-e2e';

  const ctx = await provisionTestDb();
  if (!ctx) throw new Error('[e2e] PostgreSQL is required (set PG_ADMIN_URL or PG_URL)');
  process.env.PG_URL = ctx.url;
  process.env.DATABASE_URL = ctx.url;
  for (const m of MODULES) process.env[m + '_BACKEND'] = 'postgres';

  const quiet = console.log; console.log = () => {};
  let app, rdb;
  try {
    rdb = require(path.join(ROOT, 'reports-db.js'));
    await rdb.initPgReports();
    await require(path.join(ROOT, 'tracker-db.js')).initPgTracker();
    await require(path.join(ROOT, 'meetings-db.js')).initPgMeetings();
    await require(path.join(ROOT, 'inspection-db.js')).initPgInspection();
    await require(path.join(ROOT, 'assets-db.js')).initPgAssets();
    await require(path.join(ROOT, 'db', 'migrate.js')).migrateAtBoot({ log: () => {} });
    const mr = require(path.join(ROOT, 'services', 'metricRegistry.js'));
    mr.setCurrent(await mr.load({ pg: typeof rdb.pgHandle === 'function' ? rdb.pgHandle() : null, log: () => {} }));
    const srv = require(path.join(ROOT, 'server.js'));
    app = srv.app;
    await srv.seedStores();
  } finally { console.log = quiet; }

  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  return {
    base, rdb, ctx,
    async close() {
      await new Promise((r) => server.close(() => r()));
      try { await dropTestDb(ctx); } catch (_) { /* best effort */ }
    },
  };
}

module.exports = { bootApp };
