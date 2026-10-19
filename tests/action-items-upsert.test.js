'use strict';
// SP1b Task 2 — saveActionItems is an upsert-by-uid: it mints uids, UPDATEs
// existing rows in place (preserving the server-owned source/origin_id merge
// columns), INSERTs new rows, DELETEs removed ones. This is the durability
// guarantee — a report re-save can never wipe a merge.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ai-upsert-'));
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'ai-upsert-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ai-upsert-pass-0000';

const { test, before } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

let rid;
before(async () => {
  const site = await rdb.createSite({ name: 'UpsertSite', zoho_group: 'UpsertSite IT' });
  const r = await rdb.ensureReport(site.id, 2026, 30);
  rid = r.id;
});

const load = async () => (await rdb.getReport(rid)).action_items;

test('upsert: mint uid, preserve merge on re-save, delete/insert, empty', async () => {
  // 1) initial save (no uids) → both minted
  await rdb.saveActionItems(rid, [{ task: 'A', status: 'open' }, { task: 'B', status: 'open' }]);
  let items = await load();
  assert.equal(items.length, 2);
  const uidA = items.find(x => x.task === 'A').uid;
  const uidB = items.find(x => x.task === 'B').uid;
  assert.ok(uidA && uidB && uidA !== uidB, 'distinct uids minted');

  // 2) a merge sets server-owned columns on A
  await rdb.setActionMerge(uidA, { source: 'meetings', origin_id: 7 });

  // 3) re-save the SAME rows (round-tripping uids), editing A's task
  await rdb.saveActionItems(rid, [
    { uid: uidA, task: 'A edited', status: 'in_progress' },
    { uid: uidB, task: 'B', status: 'open' },
  ]);
  items = await load();
  assert.equal(items.length, 2, 'still 2 — matched by uid, not re-inserted');
  const a2 = items.find(x => x.uid === uidA);
  assert.equal(a2.task, 'A edited', 'editable field updated');
  assert.equal(a2.status, 'in_progress');
  assert.equal(a2.source, 'meetings', 'MERGE PRESERVED across re-save');
  assert.equal(a2.origin_id, 7, 'origin preserved');

  // 4) drop B
  await rdb.saveActionItems(rid, [{ uid: uidA, task: 'A edited', status: 'in_progress' }]);
  assert.equal((await load()).length, 1);
  assert.equal((await load())[0].source, 'meetings', 'still merged');

  // 5) add a new row (no uid) alongside A
  await rdb.saveActionItems(rid, [{ uid: uidA, task: 'A', status: 'open' }, { task: 'C', status: 'open' }]);
  items = await load();
  assert.equal(items.length, 2);
  assert.ok(items.find(x => x.task === 'C').uid, 'new row minted a uid');

  // 6) unmerge clears the columns
  await rdb.clearActionMerge(uidA);
  assert.equal((await load()).find(x => x.uid === uidA).source, null, 'unmerged');

  // 7) empty save clears all
  await rdb.saveActionItems(rid, []);
  assert.equal((await load()).length, 0);
});

test('source/origin_id written on INSERT (SP3 import ref), immutable on UPDATE', async () => {
  await rdb.saveActionItems(rid, []);
  await rdb.saveActionItems(rid, [{ task: 'ref', status: 'open', source: 'meetings', origin_id: 9 }]);
  let row = (await load())[0];
  assert.equal(row.source, 'meetings', 'source stored on insert');
  assert.equal(row.origin_id, 9);
  const uid = row.uid;
  // re-save by uid with a DIFFERENT source claim → must NOT change (UPDATE never writes it)
  await rdb.saveActionItems(rid, [{ uid, task: 'ref edited', status: 'open', source: 'HACK', origin_id: 999 }]);
  row = (await load())[0];
  assert.equal(row.task, 'ref edited', 'editable field updated');
  assert.equal(row.source, 'meetings', 'source IMMUTABLE on re-save');
  assert.equal(row.origin_id, 9);
  // a native new row → source null
  await rdb.saveActionItems(rid, [{ uid, task: 'ref edited', status: 'open' }, { task: 'native', status: 'open' }]);
  assert.equal((await load()).find(x => x.task === 'native').source, null);
});

test('lineage is written on INSERT and immutable on UPDATE', async () => {
  await rdb.saveActionItems(rid, []);
  await rdb.saveActionItems(rid, [{ task: 'carried', status: 'open', lineage: 'root-42' }]);
  let row = (await load())[0];
  assert.equal(row.lineage, 'root-42', 'lineage stored on insert');
  const uid = row.uid;
  // re-save the same row (by uid) with a DIFFERENT lineage → must not change
  await rdb.saveActionItems(rid, [{ uid, task: 'carried (edited)', status: 'open', lineage: 'HACK' }]);
  row = (await load())[0];
  assert.equal(row.task, 'carried (edited)', 'editable field updated');
  assert.equal(row.lineage, 'root-42', 'lineage UNCHANGED on re-save (immutable)');
});
