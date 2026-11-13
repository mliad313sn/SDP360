'use strict';
// A0 — "a deliberate rule break fails CI". Each case below breaks ONE rule in-process (no file is edited), runs the
// same checks as tests/rbac-matrix.smoke.test.js / tests/rbac-scope-frozen.smoke.test.js (shared harness
// tests/_rbac-matrix-core.js), asserts that the break is DETECTED, then restores the rule and proves the checks are
// clean again. Runs inside `npm test`, so it is part of the CI gate: if a check silently stops detecting its rule
// (a vacuous check), this file goes red.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const core = require('./_rbac-matrix-core');
const walker = require('../tools/agent/authz-walk');
const { routerStack } = require('../services/routerStack');
const { diffMatrix, widenings } = require('../tools/agent/authz-diff');

let w;
before(async () => { w = await core.bootWorld({ prefix: 'a0x' }); });
after(() => { try { w && w.close(); } catch {} });

async function mutated(apply, run) {
  const restore = apply();
  try { return await run(); } finally { restore(); }
}

function findRouteLayer(app, method, path) {
  const routes = walker.walkRoutes(routerStack(app));
  const r = routes.find((x) => x.method === method && x.path === path);
  if (!r) throw new Error('route not found ' + method + ' ' + path);
  // walkRoutes copies layers; find the real Layer objects in the router to mutate them
  const stack = [];
  const visit = (s) => { for (const l of s || []) { if (l.route && l.route.path === path && l.route.methods[method.toLowerCase()]) stack.push(...l.route.stack); else if (l.handle && l.handle.stack) visit(l.handle.stack); } };
  visit(routerStack(app));
  return stack;
}

test('M1 — the role engine grants everything (rdb.userHasRole → true): the route × role sweep fails', async () => {
  const v = await mutated(() => { const o = w.rdb.userHasRole; w.rdb.userHasRole = () => true; return () => { w.rdb.userHasRole = o; }; },
    () => core.checkRoleGuards(w, { methods: ['GET'], limit: 3, allowSide: false }));
  assert.ok(v.length > 0, 'a broken role engine went undetected');
  assert.match(v[0], /^DENY .* expected 403/);
});

test('M2 — one guard removed from one route (requireMoneyRead on GET /api/assets/finance/summary): runtime sweep AND matrix freshness both fail', async () => {
  const layers = findRouteLayer(w.app, 'GET', '/api/assets/finance/summary');
  const g = layers.find((l) => l.handle && Array.isArray(l.handle.legacyRoles));
  assert.ok(g, 'money guard present before the mutation');
  const v = await mutated(() => {
    const h = g.handle, n = g.name;
    g.handle = function passThrough(req, res, next) { next(); }; g.name = 'passThrough';
    return () => { g.handle = h; g.name = n; };
  }, async () => {
    const run = await core.checkRoleGuards(w, { keys: new Set(['GET /api/assets/finance/summary']), allowSide: false });
    const d = diffMatrix(w.matrix, walker.buildMatrix(w.app));
    return { run, wid: widenings(d) };
  });
  assert.ok(v.run.length > 0, 'runtime sweep missed the removed guard');
  assert.ok(v.wid.some((x) => /GET \/api\/assets\/finance\/summary: guard removed/.test(x)), 'matrix freshness missed it: ' + v.wid.join('; '));
});

test('M3 — the business-only (métier) lock is switched off: the métier sweep fails', async () => {
  const layer = routerStack(w.app).find((l) => { try { return /site view only/.test(Function.prototype.toString.call(l.handle)); } catch (_) { return false; } });
  assert.ok(layer, 'business guard middleware found');
  const v = await mutated(() => { const h = layer.handle; layer.handle = (req, res, next) => next(); return () => { layer.handle = h; }; },
    () => core.checkBusinessLock(w, { methods: ['GET'], limit: 3 }));
  assert.ok(v.length > 0, 'a disabled métier lock went undetected');
});

test('M4 — the site perimeter is broken (userSites.hasSite → true): the site perimeter check fails', async () => {
  const us = require('../services/userSites');
  const v = await mutated(() => { const o = us.hasSite; us.hasSite = () => true; return () => { us.hasSite = o; }; },
    () => core.checkSitePerimeter(w, { limit: 2 }));
  assert.ok(v.length > 0, 'a broken site perimeter went undetected');
});

test('M5 — the submitted-report freeze is broken (everyone counts as super_admin for it): the frozen check fails', async () => {
  const v = await mutated(() => {
    const o = w.rdb.userHasRole;
    w.rdb.userHasRole = (u, r) => (r === 'super_admin' ? true : o(u, r));
    return () => { w.rdb.userHasRole = o; };
  }, () => core.checkFrozen(w, { limit: 1 }));
  assert.ok(v.length > 0 && /FROZEN submitted report/.test(v[0]), 'a broken report freeze went undetected: ' + v.join('; '));
});

test('M6 — the closed-month tracker lock is broken (mergeClosed keeps the incoming value): the frozen check fails', async () => {
  const lock = require('../public/lib/trackerMonthLock');
  const v = await mutated(() => { const o = lock.mergeClosed; lock.mergeClosed = (y, months) => ({ months: (months || []).slice(), blocked: 0 }); return () => { lock.mergeClosed = o; }; },
    () => core.checkFrozen(w));
  assert.ok(v.some((x) => /FROZEN tracker: closed month/.test(x)), 'a broken month lock went undetected: ' + v.join('; '));
});

test('M7 — amounts unmasked for everyone (finance-viewer granted to all): the amounts check fails', async () => {
  const v = await mutated(() => {
    const o = w.rdb.userHasRole;
    w.rdb.userHasRole = (u, r) => (r === 'finance-viewer' ? true : o(u, r));
    return () => { w.rdb.userHasRole = o; };
  }, () => core.checkMoneyMasking(w, { limit: 2 }));
  const { unexpected } = core.splitKnown(v, core.KNOWN_MONEY_DEVIATIONS);
  assert.ok(unexpected.some((x) => /LEAKED|non-reader served/.test(x)), 'leaked amounts went undetected: ' + v.join('; '));
});

test('after every mutation is restored, the same checks are clean again (no residue)', async () => {
  const v = [
    ...(await core.checkRoleGuards(w, { methods: ['GET'], allowSide: false })),
    ...(await core.checkBusinessLock(w, { methods: ['GET'] })),
    ...(await core.checkSitePerimeter(w)),
    ...(await core.checkFrozen(w)),
  ];
  assert.equal(v.length, 0, v.join('\n'));
  assert.equal(diffMatrix(w.matrix, walker.buildMatrix(w.app)).total, 0, 'router restored');
});
