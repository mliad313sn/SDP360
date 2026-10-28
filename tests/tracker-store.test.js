'use strict';
// Step 7 — trackerStore on sqlite: draft/publish/versions/rollback, entries with month lock + unit scope,
// per-unit targets merged into the engine, template seed idempotent, legacy import + parallel run ±0.1 pt.
const { test } = require('node:test');
const assert = require('node:assert');
const { makeTrackerStore } = require('../services/trackerStore');
const { TEMPLATES } = require('../services/trackerTemplates');
const Legacy = require('../services/trackerLegacy');

const DEF = { key: 'ut-1', name: 'Unit test', version: 1, period: { kind: 'monthly', start: '2026', count: 12 }, units: [{ code: 'HGO', name: 'Houndé' }, { code: 'MGO', name: 'Mana' }], ragPolicy: 'tracker-activity',
  groups: [{ code: 'G1', name: 'A', weight: 0.5, items: [{ code: 'G1-01', name: 'Visits', kpiType: 'COUNT', weight: 1, target: 12, start: 1, end: 12 }] }, { code: 'G2', name: 'B', weight: 0.5, items: [{ code: 'G2-01', name: 'Plan', kpiType: 'BOOLEAN', weight: 1, start: 1, end: 12 }] }] };
const mk = async () => { const s = makeTrackerStore((await require('./_pg-fresh').freshStore(['tracker_definitions', 'tracker_definition_versions', 'tracker_entries', 'tracker_unit_targets']))); return s.init().then(() => s); };

test('draft → publish → version snapshot → rollback; invalid draft is refused', async () => {
  const s = await mk();
  await assert.rejects(s.saveDraft({ ...DEF, groups: [] }, {}), /invalid tracker/);
  const d = await s.saveDraft(DEF, { user: { id: 7 } }); assert.equal(d.status, 'draft'); assert.equal(d.version, null); assert.equal(await s.published('ut-1'), null);
  const p = await s.publish('ut-1', { user: { id: 7 }, note: 'v1' }); assert.equal(p.version, 1); assert.equal(p.status, 'published');
  await s.saveDraft({ ...DEF, name: 'Renamed' }, {}); assert.equal((await s.published('ut-1')).definition.name, 'Unit test', 'published snapshot untouched by a draft save');
  await s.publish('ut-1', {}); assert.equal((await s.versions('ut-1')).length, 2);
  const rb = await s.rollback('ut-1', 1); assert.equal(rb.definition.name, 'Unit test');
  assert.deepEqual((await s.list({ status: 'published' })).map(x => x.key), ['ut-1']);
  await s.setStatus('ut-1', 'retired'); await s.remove('ut-1'); assert.equal(await s.get('ut-1'), null);
});

test('entries: closed months keep their value, unit scope enforced, targets merged, engine scores', async () => {
  const s = await mk(); await s.saveDraft(DEF, {}); await s.publish('ut-1', {});
  const now = new Date('2026-06-10T12:00:00Z');
  const r = await s.saveEntries('ut-1', [
    { unit: 'HGO', item: 'G1-01', slot: 1, value: 2 },     // January — closed in June → blocked
    { unit: 'HGO', item: 'G1-01', slot: 6, value: 3 },     // June — open
    { unit: 'MGO', item: 'G1-01', slot: 6, value: 1 },     // outside scope → rejected
    { unit: 'HGO', item: 'nope', slot: 6, value: 1 },      // unknown item → rejected
  ], { allowedUnits: ['HGO'], now });
  assert.deepEqual(r, { saved: 1, blocked: 1, rejected: 2 });
  const sup = await s.saveEntries('ut-1', [{ unit: 'HGO', item: 'G1-01', slot: 1, value: 2 }], { lockClosed: false, now });
  assert.equal(sup.saved, 1, 'super_admin writes a closed month');
  const e = await s.entries('ut-1'); assert.equal(e.inputs.HGO['G1-01'][0], 2); assert.equal(e.inputs.HGO['G1-01'][5], 3); assert.equal(e.rows.length, 2);
  await s.saveTargets('ut-1', [{ unit: 'HGO', item: 'G1-01', target: 6 }, { unit: 'MGO', item: 'G2-01', active: false }]);
  const sc = await s.scoreTracker('ut-1', { currentPeriod: 6 });
  assert.equal(sc.version, 1); assert.equal(sc.units.HGO.items['G1-01'].target, 6);
  assert.ok(Math.abs(sc.units.HGO.items['G1-01'].attainment - (5 / 3)) < 1e-9, 'attainment 5 of pro-rated 3');
  assert.equal(sc.units.MGO.items['G2-01'].rag, 'NA'); assert.equal(sc.units.MGO.items['G2-01'].weight, 0);
  assert.ok(sc.units.HGO.score > 0.49 && sc.units.HGO.score <= 0.5, 'G1 capped at 1 × 0.5 + G2 0 × 0.5');
});

test('templates validate and seed once as drafts', async () => {
  const s = await mk();
  for (const t of TEMPLATES) await s.saveDraft(t, {});
  assert.equal((await s.list({ status: 'draft' })).length, 4);
  assert.deepEqual(await s.seed([]), []);
});

test('legacy import + parallel run: engine reproduces tracker-pptx within ±0.1 pt on the shipped 2026 programme', async () => {
  process.env.SDP_DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'trk-leg-'));
  const tdb = require('../tracker-db');
  const D = await tdb.loadTracker();
  const cmp = Legacy.compare(D, D.year || 2026, require('../tracker-pptx'));
  assert.ok(cmp.ok, 'max deviation ' + cmp.maxDelta + ' pt: ' + JSON.stringify(cmp.rows.filter(r => !r.ok).slice(0, 3)));
  assert.ok(cmp.rows.length >= 5 * 12); assert.match(cmp.csv.split('\n')[0], /^site,month,legacy_pct/);
  const s = await mk(); const imp = Legacy.importLegacy(D, D.year || 2026);
  const d = await s.saveDraft(imp.definition, {}); await s.saveTargets(d.key, imp.targets);
  const e = await s.saveEntries(d.key, imp.entries, { def: imp.definition, lockClosed: false, source: 'import:legacy' });
  assert.equal(e.rejected, 0); assert.ok(e.saved > 50);
  const sc = await s.scoreTracker(d.key, { currentPeriod: 3 });
  const leg = require('../tracker-pptx').ss(D, 'HGO', D.year || 2026, 3);
  assert.ok(Math.abs(sc.units.HGO.score * 100 - leg.avg * 100) <= 0.1);
});
