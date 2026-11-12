'use strict';
// F-ARCH-08 seed — PUT /api/reports/:id/helpdesk: anonymous 401, cross-site editor 403, own-site editor saves
// and the saved section reads back; an unknown report is refused, never written.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { boot } = require('./_write-smoke-boot');
let H, rA, rB;
before(async () => {
  H = await boot([['edA', ['editor'], 0], ['edB', ['editor'], 1]], { prefix: 'hdw' });
  rA = await H.rdb.ensureReport(H.sites[0].id, 2026, 31);
  rB = await H.rdb.ensureReport(H.sites[1].id, 2026, 31);
});
after(() => H && H.close());

test('PUT /api/reports/:id/helpdesk — 401 anonymous, 403 cross-site, 200 own site with read-back', async () => {
  assert.equal((await H.send('PUT', `/api/reports/${rA.id}/helpdesk`, null, {})).status, 401);
  assert.equal((await H.send('PUT', `/api/reports/${rB.id}/helpdesk`, H.tok.edA, { comments: 'x' })).status, 403);
  const r = await H.send('PUT', `/api/reports/${rA.id}/helpdesk`, H.tok.edA, { comments_metrics: 'weekly helpdesk note F-ARCH-08' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const back = JSON.stringify(await H.rdb.getReport(rA.id));
  assert.ok(back.includes('weekly helpdesk note F-ARCH-08'), 'the saved helpdesk section is read back');
  const miss = await H.send('PUT', '/api/reports/99999999/helpdesk', H.tok.edA, { comments: 'x' });
  assert.ok([403, 404].includes(miss.status), `unknown report refused (${miss.status})`);
});
