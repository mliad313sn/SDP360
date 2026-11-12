'use strict';
// R6 — tools/demo/seed-demo.js: the target guard (pure) and a full seed → remove round trip on this file's own
// throwaway database (tests/_pg-boot.mjs). Proves: production-looking targets are refused (flag or not), a
// non-empty portfolio is refused, the seed creates what the inventory says, and --remove deletes exactly that —
// a row that is not DEMO-labelled is never deleted even when a hand-edited inventory names it.
const { test } = require('node:test');
const assert = require('node:assert');
const D = require('../tools/demo/seed-demo');
const rdb = require('../reports-db');

test('classifyTarget: test databases and schemas are throwaway; production names are not', () => {
  assert.equal(D.classifyTarget({ database: 'sdp_tracker_test_ab12', schema: 'public' }).throwaway, true);
  assert.equal(D.classifyTarget({ database: 'sdp_dashboard', schema: 'sdp_test_x1y2' }).throwaway, true, 'test schema pinned on the dev database');
  assert.equal(D.classifyTarget({ database: 'sdp_demo', schema: 'public' }).throwaway, true);
  for (const db of ['sdp_dashboard', 'fmp_v2', 'postgres', 'sdp_prod_copy']) assert.equal(D.classifyTarget({ database: db, schema: 'public' }).productionLike, true, db);
  assert.equal(D.classifyTarget({ database: 'reporting', schema: 'public' }).throwaway, false);
});

test('assertSafeTarget: production refused even with the flag; unknown needs the flag; non-empty refused', () => {
  assert.throws(() => D.assertSafeTarget({ database: 'sdp_dashboard', schema: 'public', projectCount: 0, iKnow: true }), (e) => e.code === 'REFUSED_PRODUCTION');
  assert.throws(() => D.assertSafeTarget({ database: 'fmp_v2', schema: 'public', projectCount: 0, iKnow: true }), (e) => e.code === 'REFUSED_PRODUCTION');
  assert.throws(() => D.assertSafeTarget({ database: 'reporting', schema: 'public', projectCount: 0 }), (e) => e.code === 'REFUSED_NOT_THROWAWAY');
  assert.ok(D.assertSafeTarget({ database: 'reporting', schema: 'public', projectCount: 0, iKnow: true }));
  assert.throws(() => D.assertSafeTarget({ database: 'sdp_tracker_test_x', schema: 'public', projectCount: 1 }), (e) => e.code === 'REFUSED_NOT_EMPTY');
  assert.ok(D.assertSafeTarget({ database: 'sdp_tracker_test_x', schema: 'public', projectCount: 0 }));
});

test('seed → inventory → remove: exactly what was created, nothing else', async () => {
  const pg = rdb.pgHandle();
  const target = await D.targetIdentity(pg);
  assert.equal(target.projectCount, 0, 'fresh test database has no project');
  assert.ok(D.classifyTarget(target).throwaway, 'the test database is recognised as throwaway: ' + JSON.stringify(target));
  const keep = await rdb.createSite({ name: 'Keep me — not demo' });   // a real-looking row that must survive
  const gov = require('../routes/governance').createStore(rdb); await gov.init();
  const dash = require('../services/dashboardStore').makeDashboardStore({ prepare: (sql) => pg.prepare(sql) }, { isPg: true });
  const r = await D.seedDemo({ rdb, gov, dash, tag: 't1' });
  const inv = { ...r.inventory, database: target.database, schema: target.schema };

  // what was created
  assert.equal(inv.ids.sites.length, 2); assert.equal(inv.ids.users.length, 5); assert.equal(inv.ids.projects.length, 1);
  const d = await gov.projectDetail(r.ids.project);
  assert.equal(d.tasks.length, 3);
  const t2 = d.tasks.find((t) => t.id === r.ids.t2), t3 = d.tasks.find((t) => t.id === r.ids.t3);
  assert.deepEqual(t2.depends_on, [r.ids.t1], 'dependency recorded');
  assert.strictEqual(Number(t2.progress_pct), 0, 'measured zero stays 0'); assert.strictEqual(t3.progress_pct, null, 'unknown stays null');
  assert.equal(d.milestones.length, 1); assert.equal(d.risks.length, 1); assert.equal(d.benefits.length, 1);
  assert.strictEqual(d.benefits[0].realised_value, null, 'no benefit is invented');
  const bp = await gov.listBudgetPeriods(r.ids.project);
  assert.deepEqual([...new Set(bp.map((x) => x.currency))].sort(), ['USD', 'XOF'], 'actuals in two currencies');
  assert.ok((await dash.published(inv.ids.dashboards[0])), 'dashboard published');
  for (const u of Object.values(r.users)) assert.match(u.full_name, /^DEMO /);
  assert.ok((await gov.ppmEvents('project', r.ids.project)).length > 0, 'audit trail written');
  assert.ok(!JSON.stringify(inv).includes(r.users.pmo.password), 'no password in the inventory');

  // a tampered inventory that names the non-demo site: that row is skipped, never deleted
  const tampered = JSON.parse(JSON.stringify(inv)); tampered.ids.sites.push(Number(keep.id));
  await assert.rejects(D.removeDemo({ rdb, inventory: tampered, target: { ...target, database: 'other_db' } }), (e) => e.code === 'REFUSED_OTHER_TARGET');
  const out = await D.removeDemo({ rdb, inventory: tampered, target });
  assert.deepEqual(out.skipped.sites, [Number(keep.id)]);
  assert.equal(out.removed.projects, 1); assert.equal(out.removed.users, 5); assert.equal(out.removed.sites, 2); assert.equal(out.removed.dashboards, 1);
  assert.deepEqual(Object.values(out.residue).reduce((a, b) => a + b, 0), 0, 'nothing DEMO-labelled left: ' + JSON.stringify(out.residue));
  assert.ok(await pg.prepare('SELECT id FROM sites WHERE id=?').get(Number(keep.id)), 'the non-demo site survived');
  assert.equal(Number((await pg.prepare('SELECT COUNT(*) AS n FROM portfolio_tasks').get()).n), 0, 'tasks cascaded');
  assert.equal(Number((await pg.prepare('SELECT COUNT(*) AS n FROM ppm_budget_periods').get()).n), 0, 'budget periods cascaded');
  assert.ok((await gov.ppmEvents('project', r.ids.project)).length > 0, 'the append-only audit trail is retained by design');
  // a second removal is a no-op
  const again = await D.removeDemo({ rdb, inventory: inv, target });
  assert.equal(Object.values(again.removed).reduce((a, b) => a + b, 0), 0);
});

test('R2-WB-01: with nativeChangeRequests the demo change request is a native one (no stand-in request), removed by cascade', async () => {
  const pg = rdb.pgHandle();
  const target = await D.targetIdentity(pg);
  const gov = require('../routes/governance').createStore(rdb); await gov.init();
  const r = await D.seedDemo({ rdb, gov, dash: null, tag: 't2', nativeChangeRequests: true });
  const inv = { ...r.inventory, database: target.database, schema: target.schema };
  assert.equal(inv.ids.rfis.length, 0, 'no governance-request stand-in');
  const wb = require('../services/ppmWorkbenchStore').makeWorkbenchStore(pg, gov);
  const crs = await wb.listChangeRequests(r.ids.project);
  assert.deepEqual(crs.map((c) => [c.id, c.status, c.impact_dates_days, c.currency]), [[r.ids.changeRequest, 'proposed', 14, 'USD']]);
  assert.match(crs[0].title, /^DEMO /);
  await D.removeDemo({ rdb, inventory: inv, target });
  assert.equal(Number((await pg.prepare('SELECT COUNT(*) AS n FROM ppm_change_requests').get()).n), 0, 'change requests cascaded with the project');
});
