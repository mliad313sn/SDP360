'use strict';
// F-ARCH-08 seed — PUT / DELETE /api/roadmap/action/:uid and /api/roadmap/resource/:uid: super_admin only,
// scoped to the caller (another super_admin cannot touch the row), delete removes it.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { boot } = require('./_write-smoke-boot');
let H;
before(async () => { H = await boot([['s1', ['super_admin']], ['s2', ['super_admin']], ['adm', ['admin']]], { prefix: 'rmw' }); });
after(() => H && H.close());

for (const kind of ['action', 'resource']) {
  test(`roadmap ${kind}: admin 403; owner updates and deletes; another super_admin cannot`, async () => {
    const list = async (t) => (await (await H.send('GET', '/api/roadmap/project', t)).json())[kind + 's'] || [];
    const add = await H.send('POST', `/api/roadmap/${kind}`, H.tok.s1, kind === 'action' ? { label: 'F08 action', title: 'F08 action' } : { name: 'F08 resource', label: 'F08 resource' });
    assert.equal(add.status, 200);
    const { uid } = await add.json();
    assert.ok(uid);
    assert.equal((await H.send('PUT', `/api/roadmap/${kind}/${uid}`, H.tok.adm, { status: 'done' })).status, 403);
    assert.equal((await H.send('DELETE', `/api/roadmap/${kind}/${uid}`, H.tok.adm)).status, 403);
    assert.equal((await H.send('PUT', `/api/roadmap/${kind}/${uid}`, H.tok.s1, { notes: 'F08 updated' })).status, 200);
    // another super_admin: the write is scoped to its own rows → the owner's row is untouched
    await H.send('DELETE', `/api/roadmap/${kind}/${uid}`, H.tok.s2);
    assert.ok((await list(H.tok.s1)).some((x) => x.uid === uid), 'not deleted by another user');
    assert.equal((await H.send('DELETE', `/api/roadmap/${kind}/${uid}`, H.tok.s1)).status, 200);
    assert.ok(!(await list(H.tok.s1)).some((x) => x.uid === uid), 'deleted by its owner');
  });
}
