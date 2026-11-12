'use strict';
// F-ARCH-08 seed — POST + DELETE /api/risk-register-config/aliases[/:sdp_label]: super_admin only; a label with
// spaces is URL-decoded; deleting an absent label reports 0 rows (never an error, never another row).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { boot } = require('./_write-smoke-boot');
let H;
before(async () => { H = await boot([['sup', ['super_admin']], ['adm', ['admin']]], { prefix: 'rra' }); });
after(() => H && H.close());

test('risk-register alias: admin 403; super_admin upserts then deletes by encoded label; absent label → 0', async () => {
  const label = 'F08 Smoke Site - X';
  assert.equal((await H.send('POST', '/api/risk-register-config/aliases', H.tok.adm, { sdp_label: label, code: 'HGO' })).status, 403);
  const up = await H.send('POST', '/api/risk-register-config/aliases', H.tok.sup, { sdp_label: label, code: 'HGO' });
  assert.equal(up.status, 200);
  const enc = encodeURIComponent(label);
  assert.equal((await H.send('DELETE', `/api/risk-register-config/aliases/${enc}`, H.tok.adm)).status, 403);
  const before = await (await H.send('GET', '/api/risk-register-config/aliases', H.tok.sup)).json();
  const n0 = (before.aliases || before.rows || before).length;
  const del = await H.send('DELETE', `/api/risk-register-config/aliases/${enc}`, H.tok.sup);
  assert.equal(del.status, 200);
  assert.equal((await del.json()).deleted, 1);
  const afterList = await (await H.send('GET', '/api/risk-register-config/aliases', H.tok.sup)).json();
  const rows = afterList.aliases || afterList.rows || afterList;
  assert.equal(rows.length, n0 - 1, 'exactly one alias removed');
  assert.ok(!JSON.stringify(rows).includes(label));
  const again = await H.send('DELETE', `/api/risk-register-config/aliases/${enc}`, H.tok.sup);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).deleted, 0);
});
