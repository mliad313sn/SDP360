'use strict';
// A-19a — soft delete for inspections (switch soft_delete_enabled, default '0' = hard delete).
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-insp-sd-'));

const idb = require('../inspection-db');
const blob = require('../services/blobStore');
const sd = require('../services/softDelete');
const ops = require('../services/softDeleteOps');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function state(id, extra = {}) {
  return {
    meta: { f_id: id, f_site: 'Hounde (HGO)', f_area: 'Server Room', f_date: '2026-05-10', f_label: 'L ' + id, f_inspector: 'Ann' },
    items: { net__0: { status: 'major', notes: 'x', photos: [{ dataUrl: PNG, caption: 'c' }] } },
    actions: [{ desc: 'Fix ' + id, owner: 'Bob', priority: 'High', due: '2020-01-01', status: 'Open' }],
    signatures: {}, status: 'submitted', ...extra,
  };
}
const ownerDir = (id) => path.join(blob.BLOB_ROOT, 'inspection', blob._safeSeg(id));

before(async () => { await idb.loadLookups(); });

test('switch off: delete removes the row (today\'s behaviour)', async () => {
  await idb.saveInspection(state('SD-HARD'), null, null);
  assert.equal(await idb.deleteInspection('SD-HARD'), true);
  assert.equal(await idb.getInspection('SD-HARD', { includeDeleted: true }), null);
  assert.equal(fs.existsSync(ownerDir('SD-HARD')), false, 'blobs removed by the hard delete');
});

test('switch on: deleted inspection disappears from list, aggregate, actions register, score inputs; blobs remain', async () => {
  await idb.saveInspection(state('SD-SOFT'), null, null);
  const before = {
    list: (await idb.listInspections({ site: 'HGO' })).length,
    agg: Number((await idb.aggregate({ site: 'HGO' })).counts.total),
    acts: (await idb.listActions({ site: 'HGO' })).length,
    score: (await idb.getSiteScoreInputs('HGO', '2026-01-01', '2026-12-31')).inspections,
  };
  const actionId = (await idb.getInspection('SD-SOFT')).actions[0].id;
  assert.equal(await idb.deleteInspection('SD-SOFT', { soft: true, by: 7, reason: 'duplicate' }), true);
  assert.equal((await idb.listInspections({ site: 'HGO' })).length, before.list - 1);
  assert.equal(Number((await idb.aggregate({ site: 'HGO' })).counts.total), before.agg - 1);
  assert.equal((await idb.listActions({ site: 'HGO' })).length, before.acts - 1);
  assert.equal((await idb.getSiteScoreInputs('HGO', '2026-01-01', '2026-12-31')).inspections, before.score - 1);
  assert.equal(await idb.getInspection('SD-SOFT'), null, 'getInspection 404s a deleted row');
  assert.equal(await idb.getInspectionHeader('SD-SOFT'), null);
  assert.equal(await idb.getActionParent(actionId), null, 'action of a deleted inspection has no live parent');
  const ex = await idb.exportRows({});
  assert.ok(!ex.inspections.some((r) => r.id === 'SD-SOFT'));
  const row = await idb.getInspectionTrashRow('SD-SOFT');
  assert.equal(row.deleted_by, 7);
  assert.equal(row.delete_reason, 'duplicate');
  assert.ok(row.deleted_at);
  assert.ok(fs.existsSync(ownerDir('SD-SOFT')), 'blobs kept');
  assert.ok((await idb.listDeletedInspections()).some((r) => r.id === 'SD-SOFT'));
});

test('switch on: re-saving the deleted id (offline replay) is refused with CONFLICT and does not resurrect it', async () => {
  await idb.saveInspection(state('SD-REPLAY'), null, null);
  await idb.deleteInspection('SD-REPLAY', { soft: true });
  await assert.rejects(() => idb.saveInspection(state('SD-REPLAY'), null, null), (e) => e.code === 'CONFLICT' && /deleted on .* ask an administrator to restore it/.test(e.message));
  assert.equal(await idb.getInspection('SD-REPLAY'), null);
});

test('restore within retention brings it back; restore after retention is refused', async () => {
  await idb.saveInspection(state('SD-REST'), null, null);
  await idb.deleteInspection('SD-REST', { soft: true });
  const cfg = { soft_delete_retention_days: '30' };
  sd.assertRestorable(await idb.getInspectionTrashRow('SD-REST'), cfg, { what: 'inspection' });
  assert.equal(await idb.restoreInspection('SD-REST'), true);
  assert.ok(await idb.getInspection('SD-REST'));
  assert.ok((await idb.listInspections({ site: 'HGO' })).some((r) => r.id === 'SD-REST'));
  // past the window
  await idb.deleteInspection('SD-REST', { soft: true });
  const later = new Date(Date.now() + 31 * 86400000);
  assert.throws(() => sd.assertRestorable(null, cfg), (e) => e.code === 'NOT_FOUND');
  const row = await idb.getInspectionTrashRow('SD-REST');
  assert.throws(() => sd.assertRestorable(row, cfg, { now: later }), (e) => e.code === 'CONFLICT' && /retention/.test(e.message));
  assert.throws(() => sd.assertRestorable({ ...row, deleted_at: null }, cfg), (e) => e.code === 'CONFLICT' && /not deleted/.test(e.message));
});

test('purge (dry run) lists, purge apply hard-deletes and removes blobs', async () => {
  await idb.saveInspection(state('SD-PURGE'), null, null);
  await idb.deleteInspection('SD-PURGE', { soft: true });
  const later = new Date(Date.now() + 40 * 86400000);
  const dry = await ops.purge({ apply: false, cfg: { soft_delete_retention_days: '30' }, now: later, modules: ['inspection'] });
  assert.equal(dry.apply, false);
  assert.ok(dry.modules.inspection.ids.includes('SD-PURGE'));
  assert.ok(await idb.getInspectionTrashRow('SD-PURGE'), 'dry run deletes nothing');
  const run = await ops.purge({ apply: true, cfg: { soft_delete_retention_days: '30' }, now: later, modules: ['inspection'] });
  assert.ok(run.modules.inspection.purged >= 1);
  assert.equal(await idb.getInspectionTrashRow('SD-PURGE'), null);
  assert.equal(fs.existsSync(ownerDir('SD-PURGE')), false, 'blobs removed by the purge');
  // a recent stamp is NOT purged
  await idb.saveInspection(state('SD-FRESH'), null, null);
  await idb.deleteInspection('SD-FRESH', { soft: true });
  const now = await ops.purge({ apply: true, cfg: { soft_delete_retention_days: '30' }, modules: ['inspection'] });
  assert.ok(!now.modules.inspection.ids.includes('SD-FRESH'));
  assert.ok(await idb.getInspectionTrashRow('SD-FRESH'));
});

test('softDelete helper: switch reading and retention defaults', () => {
  assert.equal(sd.isEnabled({}), false);
  assert.equal(sd.isEnabled({ soft_delete_enabled: '1' }), true);
  assert.equal(sd.purgeEnabled({ soft_delete_purge_enabled: '0' }), false);
  assert.equal(sd.retentionDays({}), 30);
  assert.equal(sd.retentionDays({ soft_delete_retention_days: 'x' }), 30);
  assert.equal(sd.retentionDays({ soft_delete_retention_days: '7' }), 7);
  const { DEFAULTS } = require('../services/reportConfig');
  assert.equal(DEFAULTS.soft_delete_enabled, '0');
  assert.equal(DEFAULTS.soft_delete_retention_days, '30');
  assert.equal(DEFAULTS.soft_delete_purge_enabled, '0');
});
