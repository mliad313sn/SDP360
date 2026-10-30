'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// G-03 (audit 2026-09-24) — GET /api/assets/sync-status.
//
// The Assets module showed no freshness signal at all: an asset manager who fixed 100
// acquisition dates and saw the same score the next minute concluded the tool was
// broken. The reader already existed (reports-db.getLastSyncAt('assets_assets'), used
// by the hygiene digest) but nothing exposed it to a page.
//
// The hard rule this file pins: a job that never ran reads `null` — "jamais
// synchronisé" — and NEVER today's date. A fabricated freshness is worse than none.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'assets-fresh-'));
process.env.DASH_USER = process.env.DASH_USER || 'fresh-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'fresh-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'fresh-smoke-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, token, rdb;

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  assert.ok(sess && sess.token, 'login seeded admin');
  token = sess.token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const auth = () => ({ 'x-report-token': token });

test('401 without a session', async () => {
  const res = await fetch(base + '/api/assets/sync-status');
  assert.equal(res.status, 401, `expected 401, got ${res.status}`);
});

test('never synced → last_sync is null, NOT a fabricated date', async () => {
  const res = await fetch(base + '/api/assets/sync-status', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.strictEqual(body.last_sync, null, 'an unrun job reads null');
  assert.equal(typeof body.next_cron, 'string');
  assert.ok(body.next_cron.includes('04:30'), 'states when the nightly sync runs');
});

test('after a successful sync → last_sync carries the stored timestamp', async () => {
  await rdb.markSyncSuccess('assets_assets', 7);
  const res = await fetch(base + '/api/assets/sync-status', { headers: auth() });
  const body = await res.json();
  assert.equal(typeof body.last_sync, 'string');
  assert.ok(body.last_sync.length >= 10, `expected a timestamp, got ${JSON.stringify(body.last_sync)}`);
  assert.strictEqual(body.last_sync, await rdb.getLastSyncAt('assets_assets'), 'same value as the reader');
});
