'use strict';
const fetch = require('./_http-fetch');
// SDP360 sync observability routes smoke — boots the app on sqlite, runs one job through the
// shared runner and reads it back through /api/sync/runs and /api/sync/health.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'sync-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'sync-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'sync-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'sync-smoke-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, token;

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  try { await rdb.createUser({ username: 'sy_admin', full_name: 'S', password: 'adminpass1234', role: 'admin', roles: ['admin'] }); } catch {}
  token = (await rdb.login('sy_admin', 'adminpass1234')).token;
  const sync = require('../services/sync');
  await sync.ensureReady();
  await sync.getRunner().run({ name: 'smoke.job', key: 'id', fetch: async () => ({ rows: [{ id: 1 }, { id: 1 }, { id: 2 }], nextWatermark: '2026-10-19' }) });
  await sync.getRunner().run({ name: 'smoke.job', key: 'id', opts: { maxAttempts: 1 }, fetch: async () => { const e = new Error('upstream 503 token=secret123'); e.status = 503; throw e; } });
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());

const get = (p, t) => fetch(base + p, t ? { headers: { 'x-report-token': t } } : {});

test('unauthenticated → 401', async () => {
  const res = await get('/api/sync/runs');
  assert.equal(res.status, 401);
});

test('GET /api/sync/runs lists the runs with scrubbed errors and parsed meta', async () => {
  const res = await get('/api/sync/runs?job=smoke.job&limit=5', token);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.runs.length, 2);
  assert.equal(j.runs[0].status, 'error');
  assert.match(j.runs[0].error, /token=\*\*\*/);
  assert.equal(j.runs[1].status, 'ok');
  assert.equal(j.runs[1].rows, 2);
  assert.equal(j.runs[1].duplicates, 1);
  assert.equal(typeof j.runs[1].meta, 'object');
});

test('GET /api/sync/health summarises per job', async () => {
  const res = await get('/api/sync/health', token);
  assert.equal(res.status, 200);
  const j = await res.json();
  const job = j.jobs.find(x => x.job === 'smoke.job');
  assert.ok(job);
  assert.equal(job.errors, 1);
  assert.ok(job.last_ok);
  assert.equal(job.stale_hours, 0);
});

test('a failed run is mirrored to system_log (category sync)', async () => {
  const rdb = require('../reports-db');
  const { rows } = await rdb.listSystemLog({ category: 'sync', limit: 10 });
  assert.ok(rows.some(r => r.action === 'sync_failed' && r.target === 'smoke.job'));
});

test('health merges runner + legacy rows and labels status against the freshness window', async () => {
  const res = await get('/api/sync/health', token);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.summary && typeof body.summary.ok === 'number');
  const names = body.jobs.map(j => j.job);
  for (const n of ['zoho.requests', 'assets.sync', 'teams.sla_poll', 'smoke.job']) assert.ok(names.includes(n), `job ${n} listed`);
  const smoke = body.jobs.find(j => j.job === 'smoke.job');
  assert.equal(smoke.status, 'error', 'last run failed → error');
  assert.equal(body.jobs.find(j => j.job === 'teams.sla_poll').status, 'idle', 'optional never-ran → idle');
  assert.equal(body.jobs.find(j => j.job === 'zoho.requests').status, 'never');
});

test('the cron registry started at boot with every declared job', async () => {
  const sched = require('../services/sync/schedule').status();
  assert.ok(sched, 'schedule started by server.js');
  assert.ok(sched.jobs.length >= 11);
  assert.ok(sched.jobs.some(j => j.name === 'zoho.requests' && j.cron === '45 * * * *'));
});

test('E-D04: every job carries a drift field; one successful run is UNKNOWN, never ok', async () => {
  const body = await (await get('/api/sync/health', token)).json();
  for (const j of body.jobs) assert.ok(j.drift && typeof j.drift.status === 'string', j.job);
  const smoke = body.jobs.find(j => j.job === 'smoke.job');
  assert.equal(smoke.drift.status, 'unknown');
  assert.equal(smoke.drift.runs_considered, 1);
});

// E-R04 — /api/sync/health carries the failed deliveries (fail rows only, no address)
test('health lists failed report deliveries, not ok / resent ones, without recipients', async () => {
  const rdb = require('../reports-db'); const L = require('../services/reportSentLog');
  await L.record(rdb.db, { report_type: 'hygiene', site_code: 'GROUP', period: '2026-W44', recipients: 'probe@example.com', result: 'fail' });
  await L.record(rdb.db, { report_type: 'scoreboard', site_code: 'HGO', period: '2026-11', recipients: 'probe@example.com', result: 'ok' });
  const body = await (await get('/api/sync/health', token)).json();
  assert.ok(body.delivery && Array.isArray(body.delivery.failures));
  const kinds = body.delivery.failures.filter((f) => f.kind === 'report_send').map((f) => f.type);
  assert.ok(kinds.includes('hygiene')); assert.ok(!kinds.includes('scoreboard'));
  assert.ok(!JSON.stringify(body.delivery).includes('probe@example.com'));
});

// F-ARCH-01 / F-DATA-01 — a skip is not a collection: health says not_configured / skipped and keeps the last real date
test('health: a skipped optional job reads not_configured, a skipped mandatory one reads skipped; last_ok is the last real collection', async () => {
  const sync = require('../services/sync'); const { legacyJob } = require('../services/sync/jobs'); const R = sync.getRunner();
  // optional, collected once, then the key is removed
  assert.equal((await R.run(legacyJob('meraki.wan', async () => ({ rows: 6 }), { failOnZero: true, maxAttempts: 1 }))).status, 'ok');
  const before = (await (await get('/api/sync/health', token)).json()).jobs.find((j) => j.job === 'meraki.wan');
  assert.equal(before.status, 'ok'); assert.ok(before.last_ok);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal((await R.run(legacyJob('meraki.wan', async () => ({ skipped: true }), { failOnZero: true, maxAttempts: 1 }))).status, 'skipped');
  // optional, never collected
  await R.run(legacyJob('meraki.wan_poller', async () => ({ skipped: true })));
  // mandatory, skipped with a reason
  await R.run(legacyJob('audit.retention', async () => ({ skipped: 'disarmed' })));
  const body = await (await get('/api/sync/health', token)).json();
  const wan = body.jobs.find((j) => j.job === 'meraki.wan');
  assert.equal(wan.status, 'not_configured');
  assert.equal(wan.last_ok, before.last_ok, 'last valid collection date kept');
  assert.ok(wan.last_skipped > wan.last_ok);
  assert.equal(wan.skip_reason, 'not configured');
  const poller = body.jobs.find((j) => j.job === 'meraki.wan_poller');
  assert.equal(poller.status, 'not_configured'); assert.equal(poller.last_ok, null); assert.equal(poller.stale_hours, null);
  const ret = body.jobs.find((j) => j.job === 'audit.retention');
  assert.equal(ret.status, 'skipped'); assert.equal(ret.skip_reason, 'disarmed'); assert.equal(ret.last_ok, null);
  assert.ok(body.summary.not_configured >= 2); assert.ok(body.summary.skipped >= 1);
  // the run log shows the skip as such, with its reason and no row count
  const runs = (await (await get('/api/sync/runs?job=meraki.wan&limit=5', token)).json()).runs;
  assert.equal(runs[0].status, 'skipped'); assert.equal(runs[0].rows, null); assert.equal(runs[0].meta.skipped, 'not configured');
  assert.equal(runs[1].status, 'ok');
  // the publication gate reads the last REAL collection only
  const PG = require('../services/publishGate');
  const lastOk = await PG.lastOkFromSyncStore(['meraki.wan', 'meraki.wan_poller']);
  assert.equal(new Date(lastOk['meraki.wan']).toISOString(), new Date(before.last_ok).toISOString());
  assert.equal(lastOk['meraki.wan_poller'], null);
});
