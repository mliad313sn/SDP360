'use strict';
// SEC-01 — login.html followed ?next= blindly: location.replace(next). A crafted link to the REAL login
// page (…/login.html?next=https://evil.example or ?next=javascript:…) sent a freshly logged-in user
// off-site, or ran script in the dashboard origin. Only a same-origin relative page may be followed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { safeNext } = require('../public/lib/landing');

test('same-origin relative pages are kept', () => {
  assert.strictEqual(safeNext('executive.html'), 'executive.html');
  assert.strictEqual(safeNext('/reports.html?report=12#admin'), 'reports.html?report=12#admin');
  assert.strictEqual(safeNext('field/index.html'), 'field/index.html');
  assert.strictEqual(safeNext('itsm-integrations-plan.html'), 'itsm-integrations-plan.html');
});

test('absolute, protocol-relative, scheme and backslash targets are refused', () => {
  for (const bad of ['https://evil.example/x', 'http://evil.example', '//evil.example/x', '/\\evil.example', '\\\\evil.example',
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '\tjavascript:x',
    '/%2F%2Fevil.example', 'java\nscript:alert(1)', '', null, undefined, 42]) {
    assert.strictEqual(safeNext(bad), '', JSON.stringify(bad));
  }
});

test('login.html only follows ?next= through Landing.safeNext', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'login.html'), 'utf8').replace(/\r\n/g, '\n');
  const m = html.match(/const next\s*=([^\n]*)\n/);
  assert.ok(m, 'the post-login `next` binding exists');
  assert.ok(/safeNext\(new URLSearchParams\(location\.search\)\.get\('next'\)\)/.test(m[1]), 'the `next` that reaches location.replace is sanitised');
});
