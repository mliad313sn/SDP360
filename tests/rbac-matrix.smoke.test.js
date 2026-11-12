'use strict';
// A0 — SAFETY NET BEFORE ANY ENABLEMENT: the generated RBAC regression suite (route × role).
// Expectations come from the COMMITTED matrix docs/ops/authz-matrix.json (kept fresh by tests/authz-matrix-json.test.js);
// the harness lives in tests/_rbac-matrix-core.js and is shared with tests/rbac-mutation.smoke.test.js, which proves
// that a deliberately broken rule makes these checks fail. Invariants covered here:
//   1/3 every role-guarded route refuses (403) every persona its guards refuse, on every method, and lets the narrowest
//       admitted persona through the guard (GET); every non-public route refuses an anonymous caller;
//   3   business-only accounts (site-business / group-business) get 403 on every route outside Site Awareness +
//       session/workspace, on every method;
//   2   amounts (asset money columns, money exports, portfolio budget, budget periods) reach only the admin tier +
//       finance-viewer;
//   8   switching workspace profile / blocks never changes an allow/deny decision nor the session roles.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const core = require('./_rbac-matrix-core');

let w;
before(async () => { w = await core.bootWorld({ prefix: 'a0m' }); });
after(() => { try { w && w.close(); } catch {} });

const fmt = (v) => `${v.length} violation(s):\n` + v.slice(0, 60).join('\n');

test('matrix covers every guard class and every canonical persona', () => {
  const names = new Set();
  for (const r of w.matrix.routes) for (const g of r.guards) if (g.roles) names.add(g.name.replace(/\(.*$/, ''));
  for (const n of ['requireAdmin', 'requireSuperAdmin', 'requireExecutiveOrSuperAdmin', 'requireRole', 'requireMoneyRead', 'requireCommittee', 'requireBuilder', 'requirePublisher', 'requireField', 'requireAuthor'])
    assert.ok(names.has(n), 'guard class present in the matrix: ' + n);
  assert.equal(core.PERSONAS.length, 13);
});

test('invariant 1/3 — route × role: every guard refuses exactly the personas it must (all methods) and admits the narrowest one (GET)', async () => {
  const v = await core.checkRoleGuards(w);
  console.log(`# route x role: ${v.stats.routes} routes, ${v.stats.deny_probes} deny probes, ${v.stats.allow_probes} allow probes, ${v.stats.capabilities.size} capabilities, ${v.stats.guard_classes.size} guard classes`);
  assert.equal(v.length, 0, fmt(v));
  assert.ok(v.stats.routes >= 200 && v.stats.deny_probes >= 2000, `routes ${v.stats.routes} deny ${v.stats.deny_probes}`);
  // every catalogued capability and every guard class of the committed matrix received at least one deny probe
  const caps = new Set(), classes = new Set();
  for (const r of w.matrix.routes) { r.capabilities.forEach((c) => caps.add(c)); r.guards.forEach((g) => g.roles && classes.add(g.name.replace(/\(.*$/, ''))); }
  assert.deepEqual([...caps].filter((c) => !v.stats.capabilities.has(c)), [], 'capabilities never probed');
  assert.deepEqual([...classes].filter((c) => !v.stats.guard_classes.has(c)), [], 'guard classes never probed');
  assert.ok(v.stats.allow_probes >= 60 && v.stats.allow_ok >= 60, `allow side not vacuous: ${v.stats.allow_probes}/${v.stats.allow_ok}`);
});

test('session rule: every non-public /api route refuses an anonymous caller (401/403)', async () => {
  const v = await core.checkAnonymous(w);
  assert.equal(v.length, 0, fmt(v));
});

test('invariant 3 — métier lock: business-only accounts get 403 on every route outside Site Awareness (all methods)', async () => {
  const v = await core.checkBusinessLock(w);
  assert.equal(v.length, 0, fmt(v));
});

test('invariant 2 — amounts: asset money columns, money exports, portfolio budget and budget periods reach only admin tier + finance-viewer', async () => {
  const v = await core.checkMoneyMasking(w);
  // Expected-fail list (KNOWN_MONEY_DEVIATIONS): the committee-member reads portfolio amounts today — policy decision
  // pending. Any OTHER violation fails; a known deviation that stops reproducing also fails (remove the entry then).
  const { unexpected, matched, unmatchedKnown } = core.splitKnown(v, core.KNOWN_MONEY_DEVIATIONS);
  assert.equal(unexpected.length, 0, fmt(unexpected));
  assert.deepEqual(unmatchedKnown.map((d) => String(d.re)), [], 'a known deviation no longer reproduces — the policy was decided: update KNOWN_MONEY_DEVIATIONS and docs/agent-execution/F-A0.md');
  assert.equal(matched.length, core.KNOWN_MONEY_DEVIATIONS.length, matched.join('\n'));
});

test('invariant 8 — workspace profiles / blocks never change an allow/deny decision nor the session roles', async () => {
  const v = await core.checkWorkspaceGrantsNothing(w);
  assert.equal(v.length, 0, fmt(v));
  assert.ok(v.stats.profiles_saved >= 4 && v.stats.routes >= 100, 'not vacuous: ' + JSON.stringify(v.stats));
});
