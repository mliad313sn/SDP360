'use strict';
// E-A01b / X-Q-01 — deleting a tracker year on PostgreSQL hard-deletes the year by FK cascade.
// Before this fix there was no snapshot (backup_path: null). Now every row the cascade removes is
// exported as JSON through services/blobStore.js BEFORE the delete; a failed export deletes nothing.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'trk-del-'));
const { test } = require('node:test');
const assert = require('node:assert');
const tdb = require('../tracker-db');
const blobStore = require('../services/blobStore');

async function seedYear(y) {
  const h = tdb.pgHandle();
  const cfg = await h.prepare('SELECT years_json FROM tracker_config WHERE id=1').get();
  const years = JSON.parse(cfg.years_json || '[]');
  if (!years.includes(2026)) years.push(2026);
  await h.prepare('INSERT INTO tracker_years (year,active) VALUES (2026,1) ON CONFLICT DO NOTHING').run();
  if (!years.includes(y)) years.push(y);
  await h.prepare('UPDATE tracker_config SET years_json=? WHERE id=1').run(JSON.stringify(years));
  await h.prepare('INSERT INTO tracker_years (year,active) VALUES (?,1) ON CONFLICT DO NOTHING').run(y);
  const p = await h.prepare(`INSERT INTO tracker_pillars (year,code,name,weight,display_order,active) VALUES (?,'PX','Pillar X',25,0,1)`).run(y);
  const a = await h.prepare(`INSERT INTO tracker_activities (pillar_id,code,name,kpi_type,start_month,end_month,display_order,active,weight,shared) VALUES (?,'AX','Act X','COUNT',1,12,0,1,0,0)`).run(p.lastID);
  await h.prepare(`INSERT INTO tracker_targets_v2 (year,site,activity_id,target,active) VALUES (?,'HGO',?,'4',1)`).run(y, a.lastID);
  await h.prepare(`INSERT INTO tracker_inputs_v2 (year,site,activity_id,months_json) VALUES (?,'HGO',?,'[1,2,0,0,0,0,0,0,0,0,0,0]')`).run(y, a.lastID);
}
const { after } = require('node:test');
after(() => { try { _fs.rmSync(_path.join(blobStore.BLOB_ROOT, 'tracker'), { recursive: true, force: true }); } catch {} });
const count = async (sql, ...p) => (await tdb.pgHandle().prepare(sql).get(...p)).n;

test('delete-year exports every cascaded row to a blob and returns its ref as backup_path', async () => {
  await seedYear(2091);
  const r = await tdb.deleteTrackerYear(2091);
  assert.ok(r.backup_path, 'backup_path is set');
  assert.match(r.backup_path, /^tracker\/year-2091-/);
  const snap = JSON.parse(Buffer.from(blobStore.getB64(r.backup_path), 'base64').toString('utf8'));
  assert.equal(snap.year, 2091);
  assert.equal(snap.tables.tracker_years.length, 1);
  assert.equal(snap.tables.tracker_pillars.length, 1);
  assert.equal(snap.tables.tracker_activities.length, 1);
  assert.equal(snap.tables.tracker_targets_v2.length, 1);
  assert.equal(snap.tables.tracker_inputs_v2.length, 1);
  assert.equal(snap.tables.tracker_inputs_v2[0].months_json, '[1,2,0,0,0,0,0,0,0,0,0,0]');
  assert.deepEqual(r.counts, { tracker_years: 1, tracker_pillars: 1, tracker_activities: 1, tracker_targets_v2: 1, tracker_inputs_v2: 1 });
  assert.equal(await count('SELECT count(*)::int n FROM tracker_years WHERE year=?', 2091), 0);
});

test('a failed export leaves the year intact', async () => {
  await seedYear(2092);
  await assert.rejects(() => tdb.deleteTrackerYear(2092, { snapshot: () => { throw new Error('disk full'); } }), /snapshot failed.*disk full/);
  assert.equal(await count('SELECT count(*)::int n FROM tracker_years WHERE year=?', 2092), 1);
  assert.equal(await count('SELECT count(*)::int n FROM tracker_inputs_v2 WHERE year=?', 2092), 1);
  const cfg = await tdb.pgHandle().prepare('SELECT years_json FROM tracker_config WHERE id=1').get();
  assert.ok(JSON.parse(cfg.years_json).includes(2092), 'year still listed');
});
