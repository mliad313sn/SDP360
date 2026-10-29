'use strict';
// services/serviceControl.js — Windows service or pm2, detected or forced by SDP_SERVICE; a restart is
// always stop → wait → start (never a reload). The process runner is stubbed: no Windows, no pm2 needed.
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../services/serviceControl');

function fakeRun(table) {
  const calls = [];
  const run = (cmd, args) => { const k = [cmd, ...args].join(' '); calls.push(k); const r = table[k] || table[cmd + ' *'] || { status: 1, stdout: '', stderr: 'not found' }; return typeof r === 'function' ? r() : r; };
  return { run, calls };
}
const SC_RUNNING = 'SERVICE_NAME: SDPDashboard\n        TYPE               : 10  WIN32_OWN_PROCESS\n        STATE              : 4  RUNNING\n';

test('parseScState reads the state line of sc query', () => {
  assert.equal(S.parseScState(SC_RUNNING), 'running');
  assert.equal(S.parseScState('STATE              : 1  STOPPED'), 'stopped');
  assert.equal(S.parseScState('STATE : 2  START_PENDING'), 'starting');
  assert.equal(S.parseScState('garbage'), 'unknown');
});

test('detect: .env wins, then the Windows service, then pm2, else none', () => {
  assert.equal(S.detect({ SDP_SERVICE: 'pm2' }, { run: () => assert.fail('no probe when forced') }), 'pm2');
  const win = fakeRun({ 'sc query SDPDashboard': { status: 0, stdout: SC_RUNNING } });
  assert.equal(S.detect({}, { run: win.run, platform: 'win32' }), 'windows');
  const pm2 = fakeRun({ 'pm2 jlist': { status: 0, stdout: JSON.stringify([{ name: 'endeavour-dashboard', pm2_env: { status: 'online', restart_time: 3 } }]) } });
  assert.equal(S.detect({}, { run: pm2.run, platform: 'linux' }), 'pm2');
  assert.deepEqual(S.status({}, { run: pm2.run, platform: 'linux' }), { kind: 'pm2', state: 'running', restarts: 3, name: 'endeavour-dashboard' });
  assert.equal(S.detect({}, { run: fakeRun({}).run, platform: 'win32' }), 'none');
  assert.throws(() => S.start({}, { run: fakeRun({}).run, platform: 'win32' }), /no SDP Dashboard service/);
});

test('restart = stop, wait, start — on the Windows service and on pm2; "already started" is not an error', () => {
  const w = fakeRun({ 'net stop SDPDashboard': { status: 0 }, 'net start SDPDashboard': { status: 2, stdout: 'The requested service has already been started.' } });
  let waited = 0;
  assert.equal(S.restart({ SDP_SERVICE: 'windows' }, { run: w.run, sleep: (ms) => { waited = ms; } }), 'windows');
  assert.deepEqual(w.calls, ['net stop SDPDashboard', 'net start SDPDashboard']);
  assert.equal(waited, 5000, 'the port is given time to be released');
  const p = fakeRun({ 'pm2 stop endeavour-dashboard': { status: 0 }, 'pm2 start endeavour-dashboard': { status: 0 } });
  S.restart({ SDP_SERVICE: 'pm2' }, { run: p.run, sleep: () => {} });
  assert.deepEqual(p.calls, ['pm2 stop endeavour-dashboard', 'pm2 start endeavour-dashboard']);
  assert.ok(!p.calls.some((c) => /reload/.test(c)), 'never a reload');
  const bad = fakeRun({ 'net stop SDPDashboard': { status: 2, stderr: 'Access is denied.' } });
  assert.throws(() => S.stop({ SDP_SERVICE: 'windows' }, { run: bad.run }), /Access is denied/);
});
