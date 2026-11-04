'use strict';
// A-03 — an update stops the application that is running (pm2 or the Windows service) BEFORE any file is
// replaced: on Windows a folder holding a loaded native module cannot be renamed, and a pm2 auto-restart in
// the middle of the copy would start a mixed tree. A failure gives the operator back the host that was
// running. post-install's update flow is driven through runUpdate(deps) with fakes — nothing is booted.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.argv.push('--dir', fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-order-load-')));
const pi = require('../tools/installer-v2/post-install.js');

const ONLINE = (status) => JSON.stringify([{ name: 'endeavour-dashboard', pm2_env: { status, restart_time: 0 } }]);
/** A pm2 host whose process is online until `pm2 stop` is run; sc knows no SDPDashboard service. */
function pm2Machine() {
  let state = 'online'; const calls = [];
  const run = (cmd, args) => {
    const k = [cmd, ...args].join(' '); calls.push(k);
    if (k === 'pm2 jlist') return { status: 0, stdout: ONLINE(state), stderr: '' };
    if (k === 'pm2 stop endeavour-dashboard') { state = 'stopped'; return { status: 0, stdout: '', stderr: '' }; }
    if (k === 'pm2 start endeavour-dashboard') { state = 'online'; return { status: 0, stdout: '', stderr: '' }; }
    if (cmd === 'sc') return { status: 1060, stdout: 'The specified service does not exist as an installed service.', stderr: '' };
    return { status: 1, stdout: '', stderr: 'unexpected ' + k };
  };
  return { run, calls, state: () => state };
}

/** Every step pushes its name; `fail` names a step that throws. */
function fakeDeps({ fail = null, order = [], host = null, extra = {} } = {}) {
  const step = (name, ret) => async (...a) => { order.push(name); if (fail === name) throw new Error(name + ' broke'); return typeof ret === 'function' ? ret(...a) : ret; };
  const results = [];
  const deps = {
    log: () => {},
    preflight: step('preflight', { plan: true }),
    writeEnvPlan: step('writeEnvPlan'),
    stopCurrentHost: host ? async () => { order.push('stopCurrentHost'); if (fail === 'stopCurrentHost') throw new Error('stop broke'); return host.stop(); } : step('stopCurrentHost', null),
    swapDeps: step('swapDeps', () => () => order.push('undoDeps')),
    applyPackage: step('applyPackage', true),
    envSteps: step('envSteps', { PORT: '3466' }),
    migrate: step('migrate'),
    firewall: step('firewall'),
    serviceKind: () => 'pm2',
    registerService: async (kind) => { order.push('registerService:' + kind); if (fail === 'registerService') throw new Error('registerService broke'); },
    iis: step('iis'),
    probe: step('probe', '/ready'),
    stopHost: async (kind) => { order.push('stopHost:' + kind); },
    startHosts: host ? async (stopped) => { order.push('startHosts'); return host.start(stopped); } : async () => { order.push('startHosts'); },
    rollbackFiles: step('rollbackFiles'),
    restoreEnv: step('restoreEnv', {}),
    previousServiceKind: () => 'pm2',
    fixHostForRollback: step('fixHostForRollback'),
    writeResult: (r) => { results.push(r); },
    ...extra,
  };
  return { deps, order, results };
}

test('update on a pm2 host: preflight, stop, swap, package, env, migrate, service, probe — in that order', async () => {
  const { deps, order, results } = fakeDeps();
  const r = await pi.runUpdate(deps, { mode: 'update' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(order, ['preflight', 'writeEnvPlan', 'stopCurrentHost', 'swapDeps', 'applyPackage', 'envSteps', 'migrate', 'firewall', 'registerService:pm2', 'iis', 'probe']);
  assert.strictEqual(results.pop().ok, true);
});

test('stopCurrentHost runs before swapDeps and calls `pm2 stop endeavour-dashboard` through the injected runner', async () => {
  const m = pm2Machine();
  const host = {
    stop: () => pi.stopRunningHost({ mode: 'update', envExists: true, env: {}, port: 3466, run: m.run, portOpen: async () => false, pollMs: 1, log: () => {} }),
    start: (stopped) => pi.startHosts(stopped, {}, { run: m.run, log: () => {} }),
  };
  const { deps, order } = fakeDeps({ host });
  await pi.runUpdate(deps, { mode: 'update' });
  assert.ok(order.indexOf('stopCurrentHost') < order.indexOf('swapDeps'));
  assert.ok(m.calls.includes('pm2 stop endeavour-dashboard'), m.calls.join(' | '));
  assert.ok(!m.calls.some((c) => /reload/.test(c)), 'never a pm2 reload');
  assert.strictEqual(m.state(), 'stopped', 'the success path restarts through registerService, not startHosts');
});

test('stopRunningHost: nothing stopped on a new install, on a missing .env, or when nothing runs', async () => {
  const m = pm2Machine();
  const base = { env: {}, port: 3466, run: m.run, portOpen: async () => false, pollMs: 1, log: () => {} };
  assert.strictEqual(await pi.stopRunningHost({ ...base, mode: 'new', envExists: true }), null);
  assert.strictEqual(await pi.stopRunningHost({ ...base, mode: 'update', envExists: false }), null);
  assert.deepStrictEqual(m.calls, [], 'no probe at all');
  const idle = (cmd) => (cmd === 'pm2' ? { status: 0, stdout: '[]', stderr: '' } : { status: 1060, stdout: '', stderr: '' });
  assert.strictEqual(await pi.stopRunningHost({ ...base, run: idle, mode: 'repair', envExists: true }), null);
});

test('stopRunningHost: a running Windows service (manual run) is stopped with net stop', async () => {
  const calls = [];
  const run = (cmd, args) => {
    const k = [cmd, ...args].join(' '); calls.push(k);
    if (cmd === 'pm2') return { status: 0, stdout: '[]', stderr: '' };
    if (k === 'sc query SDPDashboard') return { status: 0, stdout: 'STATE              : 4  RUNNING', stderr: '' };
    if (k === 'net stop SDPDashboard') return { status: 0, stdout: '', stderr: '' };
    return { status: 1, stdout: '', stderr: '' };
  };
  const r = await pi.stopRunningHost({ mode: 'update', envExists: true, env: {}, port: 3466, run, portOpen: async () => false, pollMs: 1, log: () => {} });
  assert.deepStrictEqual(r.kinds, ['windows']);
  assert.ok(calls.includes('net stop SDPDashboard'));
});

test('stopRunningHost waits for the port to be released, and refuses to go on when it never is', async () => {
  const m = pm2Machine();
  let probes = 0;
  const r = await pi.stopRunningHost({ mode: 'update', envExists: true, env: {}, port: 3466, run: m.run, portOpen: async () => (++probes < 3), pollMs: 1, waitMs: 2000, log: () => {} });
  assert.deepStrictEqual(r.kinds, ['pm2']);
  assert.ok(probes >= 3, 'polled until the port closed');
  const m2 = pm2Machine();
  await assert.rejects(pi.stopRunningHost({ mode: 'update', envExists: true, env: {}, port: 3466, run: m2.run, portOpen: async () => true, pollMs: 1, waitMs: 20, log: () => {} }),
    (e) => { assert.match(e.message, /still answers on port 3466/); assert.deepStrictEqual(e.stopped, { kinds: ['pm2'] }); return true; });
});

test('a preflight refusal calls neither stopCurrentHost nor any file step, and says nothing was changed', async () => {
  const { deps, order, results } = fakeDeps({ fail: 'preflight' });
  const r = await pi.runUpdate(deps, { mode: 'update' });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(order, ['preflight']);
  assert.strictEqual(results.pop().ok, false);
});

test('a failure in swapDeps after the stop restarts the pm2 host once (pm2 start) and writes ok:false', async () => {
  const m = pm2Machine();
  const host = {
    stop: () => pi.stopRunningHost({ mode: 'update', envExists: true, env: {}, port: 3466, run: m.run, portOpen: async () => false, pollMs: 1, log: () => {} }),
    start: (stopped) => pi.startHosts(stopped, {}, { run: m.run, log: () => {} }),
  };
  const { deps, order, results } = fakeDeps({ fail: 'swapDeps', host });
  const r = await pi.runUpdate(deps, { mode: 'update' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(m.calls.filter((c) => c === 'pm2 start endeavour-dashboard').length, 1, m.calls.join(' | '));
  assert.strictEqual(m.state(), 'online', 'the operator is never left with the application down');
  assert.ok(!order.includes('rollbackFiles') && !order.some((o) => o.startsWith('registerService')), order.join(' > '));
  assert.ok(order.includes('restoreEnv'), '.env put back');
  const last = results.pop();
  assert.strictEqual(last.ok, false);
  assert.deepStrictEqual(last.stopped, { kinds: ['pm2'] });
});

test('a stop that leaves the port busy restarts what it stopped', async () => {
  const { deps, order } = fakeDeps({ extra: {
    stopCurrentHost: async () => { order.push('stopCurrentHost'); const e = new Error('still answers'); e.stopped = { kinds: ['pm2'] }; throw e; },
  } });
  const r = await pi.runUpdate(deps, { mode: 'update' });
  assert.strictEqual(r.ok, false);
  assert.ok(order.includes('startHosts'), order.join(' > '));
  assert.ok(!order.includes('swapDeps'));
});

test('a probe failure on a 1.x tree stops the new process, rolls files back, then registerService("pm2") — never windows', async () => {
  const { deps, order } = fakeDeps({ fail: 'probe', extra: { serviceKind: () => 'pm2', previousServiceKind: () => 'pm2' } });
  const r = await pi.runUpdate(deps, { mode: 'update' });
  assert.strictEqual(r.ok, false);
  const tail = order.slice(order.indexOf('probe') + 1);
  assert.deepStrictEqual(tail, ['stopHost:pm2', 'rollbackFiles', 'undoDeps', 'restoreEnv', 'fixHostForRollback', 'registerService:pm2']);
  assert.ok(!order.includes('registerService:windows'));
  assert.ok(!order.includes('startHosts'), 'registerService already restarts the previous version');
});

test('SDP_SETUP_TEST_FAIL_PROBE=1 makes probe throw at once and the message says test seam', async () => {
  process.env.SDP_SETUP_TEST_FAIL_PROBE = '1';
  try {
    const t0 = Date.now();
    await assert.rejects(pi.probe(1), /test seam/);
    assert.ok(Date.now() - t0 < 1000, 'no 2-minute wait');
  } finally { delete process.env.SDP_SETUP_TEST_FAIL_PROBE; }
});

test('main() is wired through runUpdate, and stopCurrentHost comes right before the dependency swap', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'installer-v2', 'post-install.js'), 'utf8').replace(/\r\n/g, '\n');
  const body = src.slice(src.indexOf('async function runUpdate'), src.indexOf('async function main'));
  assert.ok(body.length > 0, 'runUpdate found before main');
  assert.ok(body.indexOf('deps.stopCurrentHost(') < body.indexOf('deps.swapDeps('));
  assert.ok(body.indexOf('deps.preflight(') < body.indexOf('deps.stopCurrentHost('));
  assert.match(src.slice(src.indexOf('async function main')), /runUpdate\(/);
});
