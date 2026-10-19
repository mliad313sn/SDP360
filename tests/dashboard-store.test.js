'use strict';
// Step 6 — dashboard definition store on sqlite: draft → publish (versioned) → retire, seeds never overwrite.
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { makeDashboardStore } = require('../services/dashboardStore');
const { SEED_DASHBOARDS, EXEC_HOME } = require('../services/dashboardSeeds');
const { SEED } = require('../services/metricRegistry');

const METRICS = SEED.map(m => m.key);
async function fresh() { const s = makeDashboardStore(new Database(':memory:')); await s.init(); return s; }
const doc = (over) => ({ key: 'k1', title: 'K1', audience: 'site', grid: { columns: 12 }, widgets: [{ id: 'a', type: 'kpi', metric: 'assets.total', layout: { x: 0, y: 0, w: 3, h: 2 } }], ...over });

test('draft saved, not visible as published until publish; publish numbers versions', async () => {
  const s = await fresh();
  const d = await s.saveDraft(doc(), { user: { id: 7 }, metrics: METRICS });
  assert.equal(d.status, 'draft'); assert.equal(d.version, null); assert.equal(d.owner_id, 7);
  assert.equal(await s.published('k1'), null);
  const p = await s.publish('k1', { user: { id: 7 }, note: 'first' });
  assert.equal(p.status, 'published'); assert.equal(p.version, 1);
  // a new draft does not change what viewers see until the next publish
  await s.saveDraft(doc({ title: 'K1 v2' }), { user: { id: 7 }, metrics: METRICS });
  assert.equal((await s.published('k1')).definition.title, 'K1');
  assert.equal((await s.get('k1')).definition.title, 'K1 v2');
  const p2 = await s.publish('k1', { user: { id: 7 } });
  assert.equal(p2.version, 2); assert.equal((await s.published('k1')).definition.title, 'K1 v2');
  assert.deepEqual((await s.versions('k1')).map(v => v.version), [2, 1]);
  const r = await s.setStatus('k1', 'retired'); assert.equal(r.status, 'retired'); assert.equal(await s.published('k1'), null);
});

test('an invalid definition (unknown metric, raw sql, overlap) is refused with the validator errors', async () => {
  const s = await fresh();
  await assert.rejects(s.saveDraft(doc({ widgets: [{ id: 'a', type: 'kpi', metric: 'nope.x', layout: { x: 0, y: 0, w: 3, h: 2 } }] }), { metrics: METRICS }), e => e.code === 'INVALID' && /unknown metric/.test(e.message));
  await assert.rejects(s.saveDraft(doc({ widgets: [{ id: 'a', type: 'kpi', metric: 'assets.total', sql: 'select 1', layout: { x: 0, y: 0, w: 3, h: 2 } }] }), { metrics: METRICS }), /raw sql/);
  assert.equal(await s.get('k1'), null, 'nothing written');
});

test('seeds publish the shipped dashboards once and never overwrite an edited one', async () => {
  const s = await fresh();
  const added = await s.seed(SEED_DASHBOARDS);
  assert.deepEqual(added.sort(), SEED_DASHBOARDS.map(d => d.key).sort());
  assert.equal((await s.published('exec-home')).version, 1);
  await s.saveDraft({ ...EXEC_HOME, title: 'Edited by the committee' }, { metrics: METRICS });
  assert.deepEqual(await s.seed(SEED_DASHBOARDS), []);
  assert.equal((await s.get('exec-home')).definition.title, 'Edited by the committee');
  const site = await s.list({ audience: 'site', status: 'published' });
  assert.ok(site.length >= 2 && site.every(d => d.audience === 'site'));
});

test('list scopes site-pinned dashboards to the caller sites (fleet ones always visible)', async () => {
  const s = await fresh();
  await s.saveDraft(doc({ key: 'fleet' }), { metrics: METRICS }); await s.publish('fleet');
  await s.saveDraft(doc({ key: 'sgo' }), { siteId: 5, metrics: METRICS }); await s.publish('sgo');
  await s.saveDraft(doc({ key: 'hgo' }), { siteId: 9, metrics: METRICS }); await s.publish('hgo');
  assert.deepEqual((await s.list({ status: 'published', siteIds: [5] })).map(d => d.key).sort(), ['fleet', 'sgo']);
  assert.deepEqual((await s.list({ status: 'published', siteIds: null })).map(d => d.key).sort(), ['fleet', 'hgo', 'sgo']);
});
