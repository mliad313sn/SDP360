'use strict';
// Step 6 (lots 6.4-6.5) — dashboards store + group SLA numerators + pending CAB reader, PostgreSQL parity
// (db/postgres/reports/018_dashboards.sql applied by the migrator).
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pgdash-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('pg: draft, publish, versions, rollback, retire; helpdesk numerators; pending CAB', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  const store = require('../services/dashboards/store');
  try {
    const def = { id: 'pg-board', title: { fr: 'T', en: 'T' }, widgets: [{ id: 'w1', type: 'text', markdown: 'one' }] };
    await store.saveDraft('pg-board', def, 'author', 'custom');
    assert.equal((await store.get('pg-board')).draft.widgets[0].markdown, 'one');
    assert.equal(await store.getPublished('pg-board'), null, 'a draft is not on air');
    assert.equal(await store.publishDefinition('pg-board', def, 'pub', 'first'), 1);
    await store.saveDraft('pg-board', { ...def, widgets: [{ id: 'w1', type: 'text', markdown: 'two' }] }, 'author');
    const v2 = await store.publishDefinition('pg-board', (await store.get('pg-board')).draft, 'pub');
    assert.equal(v2, 2);
    assert.equal((await store.getPublished('pg-board')).definition.widgets[0].markdown, 'two');
    const back = await store.getVersion('pg-board', 1);
    assert.equal(await store.publishDefinition('pg-board', back.definition, 'pub', 'rollback to v1'), 3);
    assert.equal((await store.getPublished('pg-board')).definition.widgets[0].markdown, 'one');
    assert.deepEqual((await store.versions('pg-board')).map(v => v.version), [3, 2, 1]);
    const listed = (await store.list()).find(r => r.id === 'pg-board');
    assert.equal(listed.published_version, 3);
    await store.retire('pg-board');
    assert.equal(await store.getPublished('pg-board'), null);
    await store.saveDraft('pg-draft-only', def, 'author');
    await store.removeDraftOnly('pg-draft-only');
    assert.equal(await store.get('pg-draft-only'), null);
    await store.removeDraftOnly('pg-board');
    assert.ok(await store.get('pg-board'), 'a published dashboard is never deleted');

    // Group SLA numerators from the pg fork of getCalendarMonthlyHelpdesk.
    const H = rdb.pgHandle();
    const grp = 'PG Dash Group';
    const site = await rdb.createSite({ name: 'PG Dash Site', zoho_group: grp });
    const ins = (id, pending, overdue, responded, fro) => H.prepare(`INSERT INTO request_records (request_id, tech_group, created_time, pending_status, overdue_status, responded_time, first_response_overdue)
      VALUES (?, ?, '2026-09-10T10:00:00.000Z', ?, ?, ?, ?)`).run(id, grp, pending, overdue, responded, fro);
    await ins('PG1', 0, 0, '2026-09-10T11:00:00.000Z', 'false');
    await ins('PG2', 0, 1, '2026-09-10T11:00:00.000Z', 'true');
    await ins('PG3', 1, 0, null, null);
    const m = await rdb.getCalendarMonthlyHelpdesk(site.id, 2026, 9);
    assert.deepEqual([m.inbound, m.closed, m.sla_res_ok, m.sla_reply_ok, m.sla_reply_total, m.sla_res_pct], [3, 2, 1, 1, 2, 50]);

    // Pending CAB decisions: one open change with a pending approval; a closed one is ignored.
    await H.prepare(`INSERT INTO change_records (change_id, display_id, subject, stage, group_name) VALUES ('C1','CH-1','Open change','Approval',?), ('C2','CH-2','Closed change','Close',?)`).run(grp, grp);
    await H.prepare(`INSERT INTO cab_approvals (approval_id, change_id, approval_status, recommendation_requested) VALUES ('A1','C1','Pending','2026-10-01T00:00:00Z'), ('A2','C2','Pending','2026-10-01T00:00:00Z')`).run();
    const cab = await rdb.getPendingCabDecisions();
    assert.deepEqual(cab.map(c => c.display_id), ['CH-1']);
    assert.ok(!('requester' in cab[0]) && !('approver_name' in cab[0]), 'no personal field selected');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
