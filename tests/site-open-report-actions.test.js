'use strict';
// SP1b-lignée Task 2 — getSiteOpenReportActions: all non-closed, non-merged
// report follow-ups across a site's reports, deduped by carry-forward lineage
// (latest week wins), each carrying its own report_id + week_label.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'sora-'));
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'sora-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'sora-pass-0000';

const { test, before } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

let siteId, w30, w31;
before(async () => {
  const site = await rdb.createSite({ name: 'LinSite', zoho_group: 'LinSite IT' });
  siteId = site.id;
  w30 = (await rdb.ensureReport(siteId, 2026, 30)).id;
  w31 = (await rdb.ensureReport(siteId, 2026, 31)).id;
  // W30: A (lineage L) + a closed one
  await rdb.saveActionItems(w30, [
    { task: 'A', status: 'open', lineage: 'L' },
    { task: 'C closed', status: 'closed', lineage: 'L2' },
  ]);
  // W31: A' (carried, lineage L) + native B + M (to be merged)
  await rdb.saveActionItems(w31, [
    { task: 'A carried', status: 'open', lineage: 'L' },
    { task: 'B native', status: 'open' },
    { task: 'M merged', status: 'open' },
  ]);
  const mUid = (await rdb.getReport(w31)).action_items.find(x => x.task === 'M merged').uid;
  await rdb.setActionMerge(mUid, { source: 'meetings', origin_id: 1 });
});

test('dedups by lineage (latest week), drops closed + merged, keeps per-row report', async () => {
  const res = await rdb.getSiteOpenReportActions(siteId);
  const titles = res.actions.map(a => a.task).sort();
  assert.deepEqual(titles, ['A carried', 'B native'], 'A(old) folded into A carried; C closed + M merged excluded');
  const a = res.actions.find(x => x.task === 'A carried');
  assert.equal(a.report_id, w31, 'kept the latest-week instance');
  assert.ok(a.week_label, 'carries its own week_label');
  assert.equal(a.lineage, 'L');
});
