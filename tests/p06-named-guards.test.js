'use strict';
// P06 — named guards (services/namedGuards.js) are catalogued in capabilityRegistry.NAMED_GUARDS, each maps onto an
// existing capability with the SAME role set (naming never adds a right), and they decide exactly as the inline
// closures they replaced (role test + 403 body).
const test = require('node:test');
const assert = require('node:assert');
const registry = require('../services/capabilityRegistry');
const guards = require('../services/namedGuards');

test('every exported named guard is catalogued, and every catalogued one exists', () => {
  const names = registry.NAMED_GUARDS.map((g) => g.name).sort();
  assert.deepStrictEqual(names, Object.keys(guards).sort());
});

test('each named guard maps onto a capability with exactly its role set', () => {
  for (const g of registry.NAMED_GUARDS) {
    const cap = registry.get(g.capability);
    assert.ok(cap, `${g.name}: capability ${g.capability} exists`);
    assert.deepStrictEqual([...cap.legacy].sort(), [...g.roles].sort(), `${g.name} roles = ${g.capability} roles`);
    if (guards[g.name].legacyRoles) assert.deepStrictEqual([...guards[g.name].legacyRoles].sort(), [...g.roles].sort());
  }
});

function res() { return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; }

test('requireMoneyRead / canReadMoney: admin tier and finance-viewer pass, others get the same 403 body', () => {
  const user = (roles) => ({ id: 1, roles });
  for (const [roles, ok] of [[['admin'], true], [['super_admin'], true], [['executive'], true], [['viewer', 'finance-viewer'], true],
    [['editor'], false], [['viewer'], false], [[], false]]) {
    assert.strictEqual(guards.canReadMoney(user(roles)), ok, roles.join(','));
    const r = res(); let nexted = false;
    guards.requireMoneyRead({ reportUser: user(roles) }, r, () => { nexted = true; });
    assert.strictEqual(nexted, ok, roles.join(','));
    if (!ok) assert.deepStrictEqual([r.code, r.body], [403, { error: 'Forbidden — required role(s): admin or finance-viewer' }]);
  }
});

test('requireSuperAdminInline: only super_admin passes; refusal is 403 {error:"super_admin only"}', () => {
  for (const [roles, ok] of [[['super_admin'], true], [['executive'], false], [['admin'], false], [['viewer'], false]]) {
    const r = res();
    assert.strictEqual(guards.requireSuperAdminInline({ reportUser: { id: 1, roles } }, r), ok, roles.join(','));
    if (!ok) assert.deepStrictEqual([r.code, r.body], [403, { error: 'super_admin only' }]);
  }
});
