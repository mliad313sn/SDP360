'use strict';
// P5 / goal A4 — the "Site Coordinator" and "Committee Member" access bundles (tools/access/seed-bundles.js):
// roles ⊆ the known roles, never super_admin; dry run writes nothing; --apply creates DRAFTS only (never published,
// idempotent); and once a human publishes a version, a request filed from it and approved grants EXACTLY those roles.
const { test, before } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');
const S = require('../tools/access/seed-bundles');
const { makeAccessStore } = require('../services/accessStore');

const KNOWN = [...rdb.ROLE_HIERARCHY, ...rdb.FEATURE_ROLES_KNOWN];
const H = () => rdb.pgHandle();
const store = makeAccessStore({ prepare: (s) => H().prepare(s), runTransaction: (fn) => H().runTransaction(fn) }, rdb);
const ID = {}; let site1;
const quiet = () => {};

before(async () => {
  site1 = Number((await rdb.listSites({ includeInactive: true }))[0].id);
  const mk = async (k, roles, site) => { await rdb.createUser({ username: 'bd_' + k, full_name: 'BD ' + k, password: 'bd_' + k + 'pass1234', roles, site_id: site }); ID[k] = Number((await H().prepare('SELECT id FROM users WHERE username=?').get('bd_' + k)).id); };
  await mk('coord', ['viewer'], site1);
  await mk('member', ['viewer']);
  await mk('lead', ['editor'], site1);
  await mk('super', ['super_admin']);
});

test('the two bundles: explicit known roles, never super_admin, the plan refuses an unknown role', () => {
  assert.deepStrictEqual(S.BUNDLES.map((b) => b.key), ['site-coordinator', 'committee-member']);
  for (const b of S.BUNDLES) {
    assert.ok(b.payload.roles.length, b.key);
    for (const r of b.payload.roles) assert.ok(KNOWN.includes(r), `${b.key}: ${r} is a known role`);
    assert.ok(!b.payload.roles.includes('super_admin'));
  }
  assert.deepStrictEqual(S.BUNDLES[0].payload.roles, ['editor', 'tracker-editor'], 'coordinator = editor locked to the site + tracker inputs');
  assert.deepStrictEqual(S.BUNDLES[1].payload.roles, ['committee-member']);
  assert.throws(() => S.plan([], ['viewer']), /unknown role/);
});

test('dry run writes nothing; --apply creates DRAFTS only (nothing published), and is idempotent', async () => {
  const dry = await S.main({ argv: [], rdb, log: quiet });
  assert.equal(dry.apply, false); assert.deepStrictEqual(dry.created, []);
  assert.equal((await store.listTemplates({ includeDrafts: true })).filter((t) => /site-coordinator|committee-member/.test(t.key)).length, 0);
  const run = await S.main({ argv: ['--apply'], rdb, log: quiet });
  assert.equal(run.created.length, 2);
  const all = await store.listTemplates({ includeDrafts: true });
  for (const k of ['site-coordinator', 'committee-member']) {
    const t = all.find((x) => x.key === k);
    assert.deepStrictEqual(t.versions.map((v) => v.status), ['draft'], `${k}: one DRAFT version`);
  }
  assert.ok(!(await store.listTemplates()).some((t) => /site-coordinator|committee-member/.test(t.key)), 'a draft is not offered to requesters');
  const again = await S.main({ argv: ['--apply'], rdb, log: quiet });
  assert.deepStrictEqual(again.created, []); assert.ok(again.steps.every((s) => s.action === 'exists'));
});

test('published by a human, a request from each bundle grants exactly its roles — nothing more', async () => {
  const all = await store.listTemplates({ includeDrafts: true });
  const today = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  for (const [key, subject] of [['site-coordinator', 'coord'], ['committee-member', 'member']]) {
    const v = all.find((x) => x.key === key).versions[0];
    await store.publish(v.id, { actorId: ID.super });   // the human act this test stands in for
    const before = (await rdb.listUsers()).find((u) => Number(u.id) === ID[subject]).roles.slice().sort();
    const rid = await store.createRequest({ subject_user_id: ID[subject], template_version_id: v.id, roles: v.payload.roles, site_ids: [], valid_from: today, valid_to: to, justification: `Pilot ${key} bundle for the canary site` }, { actorId: ID.lead });
    assert.equal((await store.decide(rid, 'approve', { id: ID.super }, { isApprover: true, reason: 'pilot' })).status, 'ACTIVE');
    const after = (await rdb.listUsers()).find((u) => Number(u.id) === ID[subject]).roles.slice().sort();
    const added = after.filter((r) => !before.includes(r)).sort();
    assert.deepStrictEqual(added, v.payload.roles.filter((r) => !before.includes(r)).sort(), `${key}: added = the bundle roles`);
    assert.ok(!after.includes('super_admin') && !after.includes('admin') && !after.includes('executive'), `${key}: no tier above the bundle`);
    await assert.rejects(store.createRequest({ subject_user_id: ID[subject], template_version_id: v.id, roles: [...v.payload.roles, 'admin'], valid_from: today, valid_to: to, justification: 'trying to add a role outside the bundle' }, { actorId: ID.lead }), /template/);
  }
});
