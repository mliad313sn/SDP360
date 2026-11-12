'use strict';
// F-ARCH-08 seed — meetings lookup writes: POST /:table (refuses a duplicate code), PUT /:table/:code (patch),
// PATCH /:table/:code/active (soft toggle, the row stays and leaves the form list), GET /:table (admin list).
// super_admin only; an unknown table is refused.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { boot } = require('./_write-smoke-boot');
let H;
before(async () => { H = await boot([['sup', ['super_admin']], ['adm', ['admin']]], { prefix: 'mlw' }); });
after(() => H && H.close());

test('meetings lookups: admin 403; add, duplicate 400, patch, deactivate (kept, hidden from the form), unknown table 400', async () => {
  const T = 'md_intake_sources', code = 'f08_smoke';
  assert.equal((await H.send('POST', `/api/meetings/lookups/${T}`, H.tok.adm, { code, name_en: 'x', name_fr: 'x' })).status, 403);
  assert.equal((await H.send('POST', `/api/meetings/lookups/${T}`, H.tok.sup, { code, name_en: 'F08 smoke', name_fr: 'F08 essai' })).status, 200);
  assert.equal((await H.send('POST', `/api/meetings/lookups/${T}`, H.tok.sup, { code, name_en: 'dup', name_fr: 'dup' })).status, 400, 'duplicate code refused');
  assert.equal((await H.send('PUT', `/api/meetings/lookups/${T}/${code}`, H.tok.adm, { name_en: 'x' })).status, 403);
  const p = await H.send('PUT', `/api/meetings/lookups/${T}/${code}`, H.tok.sup, { name_en: 'F08 smoke renamed' });
  assert.equal(p.status, 200);
  assert.equal((await p.json()).changes, 1);
  assert.equal((await H.send('PATCH', `/api/meetings/lookups/${T}/${code}/active`, H.tok.adm, { active: 0 })).status, 403);
  const off = await H.send('PATCH', `/api/meetings/lookups/${T}/${code}/active`, H.tok.sup, { active: 0 });
  assert.equal(off.status, 200);
  assert.equal((await off.json()).active, 0);
  assert.equal((await H.send('GET', `/api/meetings/lookups/${T}`, H.tok.adm)).status, 403);
  const admin = await (await H.send('GET', `/api/meetings/lookups/${T}`, H.tok.sup)).json();
  const row = admin.rows.find((r) => r.code === code);
  assert.ok(row && row.name_en === 'F08 smoke renamed' && !row.active, 'kept, renamed, inactive in the admin list');
  const form = await (await H.send('GET', '/api/meetings/lookups', H.tok.sup)).json();
  assert.ok(!JSON.stringify(form).includes(code), 'hidden from the form-facing list');
  assert.equal((await H.send('POST', '/api/meetings/lookups/not_a_table', H.tok.sup, { code: 'x', name_en: 'x' })).status, 400);
});
