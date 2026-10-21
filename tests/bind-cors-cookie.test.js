'use strict';
// E3 — the network boundary: Node listens on loopback by default, the CORS list
// carries no raw-IP origin, and the session cookie's Secure flag follows
// req.secure (Express + trust proxy 'loopback'), never a client-sent header.
// Unit-tests the pure helper the server uses (services/netBinding.js) plus the
// installer's firewall commands — no server boot.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const nb = require('../services/netBinding');
const installer = require('../tools/installer-v2/post-install');

const serverSrc = () => fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('BIND_HOST defaults to 127.0.0.1 and honours an explicit override', () => {
  assert.equal(nb.resolveBindHost({}), '127.0.0.1');
  assert.equal(nb.resolveBindHost({ BIND_HOST: '' }), '127.0.0.1');
  assert.equal(nb.resolveBindHost({ BIND_HOST: ' 0.0.0.0 ' }), '0.0.0.0');
  assert.equal(nb.DEFAULT_BIND_HOST, '127.0.0.1');
});

test('server.js uses the helper for BIND_HOST and has no 0.0.0.0 default left', () => {
  const src = serverSrc();
  assert.match(src, /const BIND_HOST = netBinding\.resolveBindHost\(process\.env\)/);
  assert.ok(!/BIND_HOST \|\| '0\.0\.0\.0'/.test(src), 'legacy 0.0.0.0 default must be gone');
});

test('corsAllowed carries no IP origin (built-in or via CORS_EXTRA_ORIGINS)', () => {
  const list = nb.corsAllowedOrigins(3456, { CORS_EXTRA_ORIGINS: 'https://staging.example.com, http://10.225.99.173:3456' });
  assert.deepEqual(list, ['http://localhost:3456', 'http://127.0.0.1:3456', 'https://itops-dashboard.edv-ops.com', 'https://staging.example.com']);
  assert.ok(!list.some(o => /10\.225\.99\.173/.test(o)));
  const src = serverSrc();
  assert.ok(!src.includes('10.225.99.173'), 'server.js must not name the legacy IP origin');
  assert.match(src, /const corsAllowed = netBinding\.corsAllowedOrigins\(PORT, process\.env\)/);
});

test('cookie Secure follows req.secure only — a client X-Forwarded-Proto header is ignored', () => {
  // req.secure is what Express computes; with trust proxy 'loopback' a header from a
  // non-loopback client leaves it false. The helper must never read the header itself.
  assert.equal(nb.cookieSecure({ secure: false, headers: { 'x-forwarded-proto': 'https' } }), false);
  assert.equal(nb.cookieSecure({ secure: true, headers: {} }), true);
  assert.equal(nb.cookieSecure({ secure: 'https' }), false, 'strict boolean, no truthy coercion');
  assert.equal(nb.cookieSecure({ secure: false }, true), true, 'SESSION_COOKIE_SECURE=1 forces it on');
  assert.equal(nb.cookieSecure(null), false);
});

test('server.js sets both cookies through the helper and never reads x-forwarded-proto', () => {
  const src = serverSrc();
  assert.equal((src.match(/netBinding\.cookieSecure\(req, SESSION_COOKIE_SECURE\)/g) || []).length, 2);
  assert.ok(!/req\.headers\[['"]x-forwarded-proto['"]\]/i.test(src), 'server.js must not inspect x-forwarded-proto directly');
  assert.match(src, /app\.set\('trust proxy', 'loopback'\)/);
});

test('installer firewall rules: allow TCP port from 127.0.0.1 only, block the rest; BIND_HOST written to .env', () => {
  const cmds = installer.firewallCommands(3456);
  const adds = cmds.filter(c => c[2] === 'add');
  assert.equal(adds.length, 2);
  const allow = adds.find(c => c.includes('action=allow')), block = adds.find(c => c.includes('action=block'));
  assert.ok(allow.includes('remoteip=127.0.0.1') && allow.includes('localport=3456') && allow.includes('protocol=TCP') && allow.includes('dir=in'));
  assert.ok(block.includes('remoteip=any') && block.includes('localport=3456'));
  assert.equal(installer.envDefaults().BIND_HOST, '127.0.0.1');
  const ps1 = fs.readFileSync(path.join(__dirname, '..', 'tools', 'installer', 'Install-SDP.ps1'), 'utf8');
  assert.match(ps1, /netsh advfirewall firewall add rule[^\n]*action=allow[^\n]*remoteip=127\.0\.0\.1/);
  assert.match(ps1, /netsh advfirewall firewall add rule[^\n]*action=block[^\n]*remoteip=any/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'tools', 'installer', 'env.template'), 'utf8'), /^BIND_HOST=127\.0\.0\.1$/m);
});
