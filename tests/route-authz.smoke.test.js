'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Step 4 (SDP-DASH-2.0) — authorization test on EVERY API route, discovered from the live router
// (a route added later is covered with no edit here):
//   1. without credentials, every /api route answers 401/403 — except the declared PUBLIC list;
//   2. a `viewer` session gets 403 on every route that declares a role middleware above viewer
//      (requireAdmin / requireSuperAdmin / requireExecutiveOrSuperAdmin / requireRole([...])).
// Throwaway sqlite; boots the app in-process.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'route-authz-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'ra-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'ra-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ra-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

// Routes that are public BY DESIGN (each one carries its own reason).
const PUBLIC = new Map([
  ['GET /api/exec/summary', 'SharePoint executive view — aggregates only'],
  ['GET /api/auth/config', 'login page asks whether SSO is on'],
  ['GET /api/auth/sso/login', 'starts the Microsoft sign-in'],
  ['GET /api/auth/sso/callback', 'Microsoft redirects back here'],
  ['POST /api/reports/auth/login', 'the password sign-in itself'],
  ['GET /api/actions/open', 'server-to-server, its own X-API-Key (401 without it)'],
]);
const ROLE_OF = { requireAdmin: 'admin', requireSuperAdmin: 'super_admin', requireExecutiveOrSuperAdmin: 'executive' };

function collect(stack, prefix = '', out = []) {
  for (const layer of stack || []) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const p of paths) {
        if (typeof p !== 'string') continue;                 // regex routes (central read guard)
        const full = prefix + p;
        if (!full.startsWith('/api/')) continue;
        const roles = [];
        for (const s of layer.route.stack) {
          if (ROLE_OF[s.name]) roles.push(ROLE_OF[s.name]);
          if (s.handle && s.handle.requiredRoles) roles.push(...s.handle.requiredRoles);
        }
        for (const m of Object.keys(layer.route.methods)) {
          if (m === '_all') continue;
          out.push({ method: m.toUpperCase(), pattern: full, roles });
        }
      }
    } else if (layer.handle && layer.handle.stack) {
      collect(layer.handle.stack, prefix, out);              // mounted express.Router()
    }
  }
  return out;
}
const concrete = p => p.replace(/:[A-Za-z_]+\??/g, '1').replace(/\*/g, 'x');

let server, base, viewer, routes;
before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  await rdb.createUser({ username: 'ra-viewer', full_name: 'RA Viewer', password: 'ra-viewer-0000', roles: ['viewer'] });
  viewer = (await rdb.login('ra-viewer', 'ra-viewer-0000')).token;
  routes = collect(app._router.stack);
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

async function call(method, path, headers = {}) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers },
    body: ['GET', 'HEAD', 'DELETE'].includes(method) ? undefined : '{}' });
  return r.status;
}

test('the router inventory is not empty (the discovery works)', () => {
  assert.ok(routes.length > 300, `found ${routes.length} API routes`);
  assert.ok(routes.some(r => r.roles.includes('super_admin')), 'role middlewares are recognised');
});

test('every non-public API route refuses an anonymous call (401/403)', async () => {
  const open = [];
  for (const r of routes) {
    const id = `${r.method} ${r.pattern}`;
    if (PUBLIC.has(id)) continue;
    const st = await call(r.method, concrete(r.pattern));
    if (st !== 401 && st !== 403) open.push(`${id} → ${st}`);
  }
  assert.deepEqual(open, [], 'routes reachable without credentials:\n' + open.join('\n'));
});

test('a viewer is refused on every route that declares a higher role', async () => {
  const leaks = [];
  for (const r of routes) {
    if (!r.roles.length || r.roles.includes('viewer')) continue;
    const st = await call(r.method, concrete(r.pattern), { 'x-report-token': viewer });
    if (st !== 403) leaks.push(`${r.method} ${r.pattern} [${r.roles.join('|')}] → ${st}`);
  }
  assert.deepEqual(leaks, [], 'viewer reached role-gated routes:\n' + leaks.join('\n'));
});
