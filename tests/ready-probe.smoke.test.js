'use strict';
const fetch = require('./_http-fetch');
// F-ARCH-09 — GET /ready `last_job_at` also reflects the jobs run by the shared runner (sync_runs), not only the
// legacy sync_metadata rows. Same public shape {ok, db, last_job_at}; a skipped or failed run never moves it.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ready-probe-'));
process.env.DASH_USER = process.env.DASH_USER || 'ready-probe-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ready-probe-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ready-probe-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, sync;
before(async () => {
  const { app } = require('../server');
  sync = require('../services/sync');
  await sync.ensureReady();
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const ready = async () => { const r = await fetch(base + '/ready'); return { status: r.status, json: await r.json() }; };
const lastRun = async (job) => (await sync.getStore().recentRuns(job, 1))[0];

test('/ready stays public, 200, and exposes only {ok, db, last_job_at}', async () => {
  const r = await ready();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['db', 'last_job_at', 'ok']);
  assert.equal(r.json.ok, true); assert.equal(r.json.db, true);
});

test('a successful runner job moves last_job_at to its finish time', async () => {
  const before0 = (await ready()).json.last_job_at;
  const out = await sync.getRunner().run({ name: 'ready.probe', key: 'id', fetch: async () => ({ rows: [{ id: 1 }] }) });
  assert.equal(out.status, 'ok');
  const run = await lastRun('ready.probe');
  const r = await ready();
  assert.equal(r.json.last_job_at, run.finished_at);
  assert.notEqual(r.json.last_job_at, before0);
});

test('a skipped run and a failed run do not move last_job_at', async () => {
  const at = (await ready()).json.last_job_at;
  await new Promise((r) => setTimeout(r, 15));
  assert.equal((await sync.getRunner().run({ name: 'ready.probe', fetch: async () => ({ skipped: true, reason: 'not configured' }) })).status, 'skipped');
  assert.equal((await sync.getRunner().run({ name: 'ready.probe', opts: { maxAttempts: 1 }, fetch: async () => { throw new Error('boom'); } })).status, 'error');
  assert.equal((await ready()).json.last_job_at, at);
});

test('the later of the legacy sync_metadata stamp and the runner stamp wins', async () => {
  const rdb = require('../reports-db');
  const future = new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');   // legacy shape: no zone
  await rdb.pgHandle().prepare(`INSERT INTO sync_metadata (job_name, last_sync_at) VALUES (?, ?)
    ON CONFLICT (job_name) DO UPDATE SET last_sync_at = excluded.last_sync_at`).run('requests', future);
  assert.equal((await ready()).json.last_job_at, future, 'a newer legacy stamp is kept as is');
  const past = '2020-01-01 00:00:00';
  await rdb.pgHandle().prepare('UPDATE sync_metadata SET last_sync_at = ? WHERE job_name = ?').run(past, 'requests');
  const okRun = (await sync.getStore().recentRuns('ready.probe', 10)).find((x) => x.status === 'ok');
  assert.equal((await ready()).json.last_job_at, okRun.finished_at, 'an older legacy stamp gives way to the runner job');
});
