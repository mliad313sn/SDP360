'use strict';
// RBAC audit 2026-10-02, lot 3 — auth.js kept the user cached in localStorage at login
// and never refreshed it: after an administrator changed someone's roles, every page
// still gated buttons, tabs and whole pages on the OLD roles for up to the 24 h session
// (the server re-reads roles on every request, so the two disagreed). The background
// /api/reports/auth/me check now refreshes the cached user and reloads the page ONCE when
// the roles changed, so the page re-evaluates its gates. Runs the real auth.js in a vm.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'auth.js'), 'utf8');

async function run({ cached, fresh, status = 200, session = {} }) {
  const store = { report_token: 'tok', report_user: JSON.stringify(cached) };
  const calls = { reload: 0, replace: [] };
  const ctx = {
    console,
    JSON, Array, Object, String, encodeURIComponent,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: k => (k in session ? session[k] : null), setItem: (k, v) => { session[k] = String(v); } },
    document: { currentScript: { getAttribute: () => 'any' }, addEventListener() {}, getElementById: () => null },
    location: { pathname: '/reports.html', search: '', replace: u => calls.replace.push(u), reload: () => { calls.reload++; } },
    fetch: async () => ({ status, ok: status === 200, json: async () => ({ user: fresh }) }),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
  return { store, calls, session };
}

const base = { id: 7, username: 'hounde', site_id: 3, role: 'admin' };

test('changed roles: the cached user is refreshed and the page reloads once', async () => {
  const { store, calls } = await run({
    cached: { ...base, roles: ['admin', 'tracker-editor'] },
    fresh:  { ...base, role: 'editor', roles: ['editor', 'tracker-editor'] },
  });
  assert.deepEqual(JSON.parse(store.report_user).roles, ['editor', 'tracker-editor']);
  assert.equal(calls.reload, 1);
});

test('unchanged roles: no reload', async () => {
  const { calls } = await run({
    cached: { ...base, roles: ['admin', 'tracker-editor'] },
    fresh:  { ...base, roles: ['tracker-editor', 'admin'] },   // same set, other order
  });
  assert.equal(calls.reload, 0);
});

test('never loops: a second change in the same tab session does not reload again', async () => {
  const session = {};
  await run({ cached: { ...base, roles: ['admin'] }, fresh: { ...base, roles: ['editor'] }, session });
  const { calls } = await run({ cached: { ...base, roles: ['admin'] }, fresh: { ...base, roles: ['editor'] }, session });
  assert.equal(calls.reload, 0);
});

test('an expired session still logs out (401)', async () => {
  const { calls, store } = await run({ cached: { ...base, roles: ['admin'] }, fresh: null, status: 401 });
  assert.equal(store.report_user, undefined);
  assert.ok(calls.replace.some(u => /login\.html/.test(u)));
});
