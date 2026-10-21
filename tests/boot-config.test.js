'use strict';
// Fiche C2 (2026-10-20) — no weak fallback API key. server.js is run as a CHILD PROCESS:
//   • NODE_ENV=production without DASHBOARD_API_KEY → exits non-zero (78) with an explicit message;
//   • NODE_ENV=production with a key shorter than 32 characters → same refusal;
//   • outside production without a key → a random key is generated per boot and the log shows
//     only its first 8 characters (the child is killed as soon as the line is seen).
// The pure resolver (services/apiKey.js) is also exercised directly so the rule is pinned
// independently of the process plumbing.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const net = require('net');
const os = require('os'), fs = require('fs'), path = require('path');

const SERVER = path.join(__dirname, '..', 'server.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

function childEnv(extra) {
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'UTC',
    DOTENV_CONFIG_PATH: path.join(os.tmpdir(), 'boot-config-no-dotenv-' + process.pid),   // a dev .env must not leak a key into the child
    PORT: String(extra.PORT), BIND_HOST: '127.0.0.1',
    SDP_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'boot-config-')),
    REPORTS_BACKEND: 'sqlite', TRACKER_BACKEND: 'sqlite', MEETINGS_BACKEND: 'sqlite', INSPECTION_BACKEND: 'sqlite', ASSETS_BACKEND: 'sqlite',
    DASH_USER: 'boot-admin', DASH_PASS: 'boot-pass-000000',
    ZOHO_CLIENT_ID: 'dummy', ZOHO_CLIENT_SECRET: 'dummy', ZOHO_REFRESH_TOKEN: 'dummy',
    SDP_CONFIG_KEY: 'boot-config-passphrase-0123456789',
  };
  for (const [k, v] of Object.entries(extra)) if (k !== 'PORT') env[k] = v;
  return env;
}

// Runs server.js; resolves {code, out} on exit or, when `until` matches the output, kills the child
// and resolves {code:null, out}. A hard timeout fails the test instead of hanging the suite.
function runServer(env, { until, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { env, cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', done = false;
    const finish = (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, out }); };
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill('SIGKILL'); } catch {} reject(new Error('server.js did not finish within ' + timeoutMs + ' ms; output:\n' + out)); } }, timeoutMs);
    const onData = (d) => { out += d.toString(); if (until && until.test(out) && !done) { try { child.kill('SIGKILL'); } catch {} finish(null); } };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('exit', (code) => finish(code));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

test('resolveApiKey: production rules and non-production masked generation (pure)', () => {
  const { resolveApiKey, MIN_LENGTH } = require('../services/apiKey');
  assert.equal(MIN_LENGTH, 32);
  const warnings = [];
  const log = { warn: (m) => warnings.push(m), error: () => {} };
  const missing = resolveApiKey({ NODE_ENV: 'production' }, log);
  assert.equal(missing.ok, false); assert.match(missing.reason, /DASHBOARD_API_KEY is required in production/);
  const short = resolveApiKey({ NODE_ENV: 'production', DASHBOARD_API_KEY: 'abcdefghijklmnop' }, log);
  assert.equal(short.ok, false); assert.match(short.reason, /too short/);
  const good = resolveApiKey({ NODE_ENV: 'production', DASHBOARD_API_KEY: 'x'.repeat(32) }, log);
  assert.deepEqual(good, { ok: true, key: 'x'.repeat(32), generated: false });
  assert.equal(warnings.length, 0, 'production never logs the key');
  const dev = resolveApiKey({ NODE_ENV: 'development' }, log);
  assert.equal(dev.ok, true); assert.equal(dev.generated, true); assert.equal(dev.key.length, 64);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes(dev.key.slice(0, 8) + '…'), 'log shows the first 8 characters');
  assert.ok(!warnings[0].includes(dev.key), 'log never shows the whole key');
  const dev2 = resolveApiKey({}, log);
  assert.notEqual(dev2.key, dev.key, 'a fresh key per boot');
});

test('production boot without DASHBOARD_API_KEY exits non-zero with an explicit message', async () => {
  const port = await freePort();
  const r = await runServer(childEnv({ PORT: port, NODE_ENV: 'production' }));
  assert.notEqual(r.code, 0, 'exit code must be non-zero');
  assert.equal(r.code, 78);
  assert.match(r.out, /DASHBOARD_API_KEY is required in production/);
});

test('production boot with a key shorter than 32 characters is refused', async () => {
  const port = await freePort();
  const r = await runServer(childEnv({ PORT: port, NODE_ENV: 'production', DASHBOARD_API_KEY: 'too-short-key-123' }));
  assert.equal(r.code, 78);
  assert.match(r.out, /too short/);
});

test('non-production boot without a key generates one per boot and logs only 8 characters', async () => {
  const port = await freePort();
  const r = await runServer(childEnv({ PORT: port, NODE_ENV: 'test' }), { until: /generated a per-boot random key \([0-9a-f]{8}…\)/ });
  assert.equal(r.code, null, 'child was still running (killed by the test) — it did not refuse to start');
  assert.match(r.out, /generated a per-boot random key \([0-9a-f]{8}…\)/);
  assert.ok(!/[0-9a-f]{64}/.test(r.out), 'the full 64-hex key never reaches the log');
});
