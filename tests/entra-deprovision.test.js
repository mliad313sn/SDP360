'use strict';
// Step 4 (SDP-DASH-2.0) — departure deactivation: deleted/disabled identities are deactivated,
// a Graph error deactivates nobody, a mass result is refused, dry-run writes nothing.
const { test } = require('node:test');
const assert = require('node:assert');
const D = require('../services/entraDeprovision');

const CFG = { tenantId: 't', clientId: 'c', clientSecret: 's' };
function fakeHttp(status) {
  return {
    post: async () => ({ data: { access_token: 'tok' } }),
    get: async (url) => {
      const oid = decodeURIComponent(url.split('/users/')[1].split('?')[0]);
      const s = status[oid];
      if (s === 404) { const e = new Error('nf'); e.response = { status: 404 }; throw e; }
      if (s === 500) { const e = new Error('boom'); e.response = { status: 500 }; throw e; }
      return { data: { id: oid, accountEnabled: s !== 'disabled' } };
    },
  };
}
function fakeRdb(n) {
  const users = Array.from({ length: n }, (_, i) => ({ id: i + 1, username: 'u' + (i + 1), entra_oid: 'o' + (i + 1) }));
  const off = [];
  return { off, listEntraLinkedUsers: async () => users, deactivateUser: async id => { off.push(id); } };
}

test('armed off and unconfigured runs do nothing', async () => {
  assert.equal((await D.run({ enabled: false })).skipped, true);
  assert.equal((await D.run({ enabled: true, cfg: {} })).skipped, true);
});

test('deleted and disabled identities are deactivated and journaled', async () => {
  const rdb = fakeRdb(10), ev = [];
  const r = await D.run({ rdb, cfg: CFG, enabled: true, http: fakeHttp({ o2: 404, o7: 'disabled' }), logEvent: e => ev.push(e) });
  assert.deepEqual(rdb.off, [2, 7]);
  assert.equal(r.deactivated, 2);
  assert.ok(ev.every(e => e.action === 'user_deactivated'));
});

test('dry-run lists without writing; a Graph error deactivates nobody; a mass result is refused', async () => {
  const rdb = fakeRdb(10);
  const dry = await D.run({ rdb, cfg: CFG, enabled: true, http: fakeHttp({ o3: 404 }), dryRun: true });
  assert.deepEqual(dry.would_deactivate, ['u3 (deleted)']);
  assert.deepEqual(rdb.off, []);
  await assert.rejects(D.run({ rdb, cfg: CFG, enabled: true, http: fakeHttp({ o4: 500 }) }));
  assert.deepEqual(rdb.off, []);
  const many = {}; for (let i = 1; i <= 5; i++) many['o' + i] = 404;
  await assert.rejects(D.run({ rdb, cfg: CFG, enabled: true, http: fakeHttp(many) }), /cap 20 %/);
  assert.deepEqual(rdb.off, []);
});
