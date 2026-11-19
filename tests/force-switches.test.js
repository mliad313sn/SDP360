'use strict';
// P03 — the test-only preload that forces switches on refuses outside a test run and refuses unknown keys.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const cp = require('child_process');
const fsw = require('../tools/test/force-switches');

test('parse / refusal / apply', () => {
  assert.deepEqual(fsw.parse('a=1, b ,c=shadow'), { a: '1', b: '1', c: 'shadow' });
  assert.match(fsw.refusal({}), /empty/);
  assert.match(fsw.refusal({ SDP_FORCE_SWITCHES: 'a' }), /node --test/);
  assert.match(fsw.refusal({ SDP_FORCE_SWITCHES: 'a', NODE_TEST_CONTEXT: 'child', NODE_ENV: 'production' }), /production/);
  assert.match(fsw.refusal({ SDP_FORCE_SWITCHES: 'a', NODE_TEST_CONTEXT: 'child', SDP_TEST_PG_URL: 'postgres://x' }), /existing/);
  assert.equal(fsw.refusal({ SDP_FORCE_SWITCHES: 'a', NODE_TEST_CONTEXT: 'child' }), null);
  const d = { a: '0', b: '0' };
  assert.deepEqual(fsw.apply(d, 'a=1'), ['a']); assert.equal(d.a, '1'); assert.equal(d.b, '0');
  assert.throws(() => fsw.apply(d, 'nope=1'), /unknown/);
});

test('as a preload it overrides the defaults only inside a test child', () => {
  const pre = path.join(__dirname, '..', 'tools', 'test', 'force-switches.js');
  const probe = "process.stdout.write(require('./services/reportConfig').DEFAULTS.ui_home_queue)";
  const run = (env) => cp.spawnSync(process.execPath, ['--require', pre, '-e', probe], { cwd: path.join(__dirname, '..'), encoding: 'utf8', env: { PATH: process.env.PATH, ...env } }).stdout;
  assert.equal(run({ SDP_FORCE_SWITCHES: 'ui_home_queue=1', NODE_TEST_CONTEXT: 'child' }), '1');
  assert.equal(run({ SDP_FORCE_SWITCHES: 'ui_home_queue=1' }), '0', 'outside node --test nothing is forced');
});
