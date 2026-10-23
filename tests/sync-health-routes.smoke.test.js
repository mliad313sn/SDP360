'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Step 1 (SDP-DASH-2.0) — sync runner wired into the app: every former cron line is a registered
// job, /api/sync/health + /api/sync/runs + /api/sync/run/:key (admin), a truncated export cannot
// empty a table, the run log persists. Throwaway sqlite; boots the app in-process.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'sync-health-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'sh-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'sh-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'sh-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, admin, viewer;
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  await rdb.createUser({ username: 'sh-admin', full_name: 'SH Admin', password: 'sh-admin-0000', roles: ['admin'] });
  await rdb.createUser({ username: 'sh-viewer', full_name: 'SH Viewer', password: 'sh-viewer-0000', roles: ['viewer'] });
  admin = (await rdb.login('sh-admin', 'sh-admin-0000')).token;
  viewer = (await rdb.login('sh-viewer', 'sh-viewer-0000')).token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const EXPECTED = ['zoho.token', 'zoho.requests', 'zoho.change_cab', 'zoho.survey', 'cache.raw_refresh', 'cache.nightly',
  'assets.sync', 'meridian.resources', 'opmanager.availability', 'meraki.wan', 'meraki.wan_events',
  'meraki.wan_events_nightly', 'meraki.wan_poller', 'teams.sla', 'db.backup', 'audit.retention', 'entra.deprovision',
  'trackers.legacy_mirror', 'trackers.sources',   // step 7
  'engagement.evaluate', 'engagement.digest', 'publication.snapshot', 'publication.run'];   // step 9

test('server.js schedules nothing outside the runner', () => {
  // server.js is being split into routes/*.js (step 5): a schedule must not hide there either.
  const routesDir = _p.join(__dirname, '..', 'routes');
  const files = ['server.js', ..._fs.readdirSync(routesDir).filter(f => f.endsWith('.js')).map(f => _p.join('routes', f))];
  for (const f of files) {
    const src = _fs.readFileSync(_p.join(__dirname, '..', f), 'utf8');
    assert.equal((src.match(/cron\.schedule\(/g) || []).length, 0, `${f}: every schedule lives in services/sync/jobs.js`);
  }
  const crons = require('../services/sync/jobs').buildJobs({}).map(j => j.cron);
  assert.ok(crons.every(Boolean));
});

test('health lists every job; admin only', async () => {
  const no = await fetch(base + '/api/sync/health', { headers: H(viewer) });
  assert.equal(no.status, 403);
  const r = await fetch(base + '/api/sync/health', { headers: H(admin) });
  assert.equal(r.status, 200);
  const h = await r.json();
  assert.deepEqual(h.jobs.map(j => j.key).sort(), [...EXPECTED].sort());
  assert.equal(h.summary.total, EXPECTED.length);
  assert.ok(h.jobs.every(j => ['ok', 'running', 'idle', 'stale', 'error', 'never'].includes(j.status)));
  assert.deepEqual(Object.keys(h.alerts).sort(), ['email', 'recipients', 'teams']);
});

test('run a job now: unknown → 404, config-gated job → logged as skipped, health idle', async () => {
  assert.equal((await fetch(base + '/api/sync/run/nope', { method: 'POST', headers: H(admin) })).status, 404);
  assert.equal((await fetch(base + '/api/sync/run/meridian.resources', { method: 'POST', headers: H(viewer) })).status, 403);
  const r = await fetch(base + '/api/sync/run/meridian.resources', { method: 'POST', headers: H(admin) });
  assert.equal(r.status, 200);
  let runs = [];
  for (let i = 0; i < 40 && !runs.length; i++) {
    await new Promise(res => setTimeout(res, 100));
    runs = (await (await fetch(base + '/api/sync/runs?job=meridian.resources', { headers: H(admin) })).json()).runs;
  }
  assert.equal(runs.length, 1);
  assert.equal(runs[0].run_trigger, 'manual');
  assert.equal(runs[0].status, 'skipped', 'Meridian is not configured → skipped, not a failure');
  const h = await (await fetch(base + '/api/sync/health', { headers: H(admin) })).json();
  assert.equal(h.jobs.find(j => j.key === 'meridian.resources').status, 'idle');
});

test('a truncated export cannot empty a table (sqlite reconcilers)', () => {
  const db = rdb.db;
  const ins = db.prepare('INSERT INTO change_records (change_id) VALUES (?)');
  for (let i = 0; i < 40; i++) ins.run('CH' + i);
  const live = new Set(['CH0', 'CH1', 'CH2']);   // the "export" lost 37 of 40 rows
  assert.throws(() => rdb.reconcileChangeRecords(live), /refused/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM change_records').get().n, 40, 'nothing deleted');
  const most = new Set([...Array(38).keys()].map(i => 'CH' + i));   // 2 really deleted in Zoho
  assert.equal(rdb.reconcileChangeRecords(most), 2, 'a normal reconciliation still deletes');
});

test('alert settings are accepted by the config store (in DEFAULTS)', async () => {
  const rc = require('../services/reportConfig');
  await rc.setConfig(rdb.db, { sync_alert_enabled: '1', sync_alert_recipients: 'ops@example.com', sync_alert_teams: '0' }, 'test');
  const c = await rc.getConfig(rdb.db);
  assert.equal(c.sync_alert_enabled, '1');
  assert.equal(c.sync_alert_recipients, 'ops@example.com');
});

test('the System Logs page carries the Sync health tab', () => {
  const src = _fs.readFileSync(_p.join(__dirname, '..', 'public', 'system-logs.html'), 'utf8');
  assert.match(src, /data-tab="sync"/);
  assert.match(src, /\/api\/sync\/health/);
  assert.match(src, /\/api\/sync\/run\//);
});
