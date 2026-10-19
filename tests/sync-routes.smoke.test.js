'use strict';
const fetch = require('./_http-fetch');
// SDP360 sync observability routes smoke — boots the app on sqlite, runs one job through the
// shared runner and reads it back through /api/sync/runs and /api/sync/health.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.REPORTS_BACKEND = 'sqlite';
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
