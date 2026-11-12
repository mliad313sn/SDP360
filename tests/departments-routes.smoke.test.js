'use strict';
// F-ARCH-08 seed — POST / PUT / DELETE /api/reports/departments[/:id]: executive or super_admin only;
// DELETE is a soft disable (the row stays, inactive) and both writes are audited.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { boot } = require('./_write-smoke-boot');
let H;
before(async () => { H = await boot([['exec', ['executive']], ['admin', ['admin']]], { prefix: 'dep' }); });
after(() => H && H.close());

test('departments: admin 403 on every write; executive creates, renames, disables (soft) — 404 on an unknown id', async () => {
  assert.equal((await H.send('POST', '/api/reports/departments', H.tok.admin, { name: 'Smoke Dept' })).status, 403);
  const c = await H.send('POST', '/api/reports/departments', H.tok.exec, { name: 'Smoke Dept F08', sort_order: 99 });
  assert.equal(c.status, 200);
  const dep = await c.json();
  assert.ok(dep.id);
  assert.equal((await H.send('PUT', `/api/reports/departments/${dep.id}`, H.tok.admin, { name: 'x' })).status, 403);
  const u = await H.send('PUT', `/api/reports/departments/${dep.id}`, H.tok.exec, { name: 'Smoke Dept F08 renamed' });
  assert.equal(u.status, 200);
  assert.equal((await u.json()).name, 'Smoke Dept F08 renamed');
  assert.equal((await H.send('DELETE', `/api/reports/departments/${dep.id}`, H.tok.admin)).status, 403);
  const d = await H.send('DELETE', `/api/reports/departments/${dep.id}`, H.tok.exec);
  assert.equal(d.status, 200);
  const all = await H.rdb.listDepartments({ includeInactive: true });
  const row = all.find((x) => x.id === dep.id);
  assert.ok(row, 'soft delete: the row is kept');
  assert.ok(!row.active, 'and inactive');
  assert.ok(!(await H.rdb.listDepartments({})).some((x) => x.id === dep.id), 'hidden from the active list');
  assert.equal((await H.send('DELETE', '/api/reports/departments/99999999', H.tok.exec)).status, 404);
  assert.equal((await H.send('PUT', '/api/reports/departments/99999999', H.tok.exec, { name: 'x' })).status, 404);
});
