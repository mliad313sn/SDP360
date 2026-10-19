'use strict';
// Step 9 — report + engagement stores on PostgreSQL (migration reports/019): parity with the sqlite suites.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'engpg-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin'; process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('pg: report + engagement stores parity (templates/runs/cascade, rules/state, notifications, share links, consumers)', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db'); await rdb.initPgReports();
  await require('../db/migrate').migrateAtBoot({ log: () => {} });
  const H = { prepare: (sql) => rdb.pgHandle().prepare(sql) };
  const rep = require('../services/reportStore').makeReportStore(H, { isPg: true });
  const eng = require('../services/engagementStore').makeEngagementStore(H, { isPg: true });
  const { SEED_TEMPLATES } = require('../services/reportGenerator'); const { SEED_RULES } = require('../services/alertRulesSeed');
  try {
    await rep.init(); await eng.init();
    assert.equal((await rep.seed(SEED_TEMPLATES)).length, 3); assert.equal((await rep.seed(SEED_TEMPLATES)).length, 0);
    const run = await rep.createRun({ templateKey: 'site-weekly-pack', siteId: 1, windowLabel: 'W42', figures: [{ id: 'a', value: 1.5 }], analysis: { headline: 'h' }, commentary: { text: 'c' }, html: '<p>x</p>', provider: 'deterministic', user: { id: 1 } });
    assert.ok(run.id > 0); assert.deepEqual(run.figures, [{ id: 'a', value: 1.5 }]); assert.equal(run.status, 'draft');
    const rv = await rep.setStatus(run.id, 'reviewed', { user: { id: 1 }, note: 'ok', rating: 4 }); assert.equal(rv.rating, 4);
    assert.equal((await rep.setStatus(run.id, 'published')).status, 'published');
    const l = await rep.listRuns({ templateKey: 'site-weekly-pack' }); assert.equal(l.length, 1); assert.equal(l[0].html, undefined); assert.equal(l[0].html_bytes, 8);
    assert.deepEqual(await rep.ratingStats(), { rated: 1, useful: 1, useful_pct: 100 });
    await rep.saveTemplate({ key: 'tmp', name: 'T', dashboard_key: 'exec-home' }); await rep.createRun({ templateKey: 'tmp', figures: [], analysis: {}, commentary: null });
    await rep.removeTemplate('tmp'); assert.equal((await rep.listRuns({ templateKey: 'tmp' })).length, 0, 'runs cascade on pg');

    assert.equal((await eng.seedRules(SEED_RULES)).length, 12); const r = await eng.getRule('sla.resolution.red'); assert.equal(r.threshold, 80); assert.equal(r.enabled, true);
    await eng.saveState({ 'sla.resolution.red|1': { breaches: 2, last_fired_at: null } }, { 'sla.resolution.red|1': 70 }); await eng.saveState({ 'sla.resolution.red|1': { breaches: 3, last_fired_at: '2026-10-19T10:00:00.000Z' } });
    assert.deepEqual(await eng.loadState(), { 'sla.resolution.red|1': { breaches: 3, last_fired_at: '2026-10-19T10:00:00.000Z' } });
    const fid = await eng.recordFiring({ rule: r, reading: { site_id: 1, value: 70 }, message: 'm', key: 'k' }); assert.ok(fid > 0); await eng.markFalsePositive(fid); assert.equal((await eng.firingStats()).false_positive_pct, 100);
    const nid = await eng.notify({ userId: 1, kind: 'alert', title: 'A' }); assert.ok(nid > 0); assert.equal(await eng.unreadCount(1), 1); assert.equal(await eng.markRead(1, [nid]), 1);
    const c = await eng.addComment({ sourceKind: 'alert_rule', sourceRef: 'k', user: { id: 1, username: 'u' }, body: 'b' }); assert.equal(c.user_name, 'u');
    const sid = await eng.subscribe(1, { kind: 'report_template', target_key: 'site-weekly-pack', digest: 'daily' }); assert.equal(await eng.subscribe(1, { kind: 'report_template', target_key: 'site-weekly-pack', digest: 'weekly' }), sid); assert.deepEqual(await eng.digestSubscribers('weekly'), [1]);
    const link = await eng.createShareLink({ targetKind: 'dashboard', targetKey: 'exec-home', siteId: 1, maxViews: 1, user: { id: 1 } }); assert.equal((await eng.openShareLink(link.token, { agent: 'UA' })).views, 1); assert.equal(await eng.openShareLink(link.token), null); assert.equal((await eng.shareReceipts(link.id)).length, 1);
    await eng.revokeShareLink(link.id); const links = await eng.listShareLinks(); assert.ok(links[0].revoked_at); assert.equal(links[0].token_hash, undefined);
    const con = await eng.createConsumer({ name: 'PBI', quotaPerDay: 1, user: { id: 1 } }); assert.equal((await eng.authenticate(con.key)).quota_left, 1);
    await eng.logCall(con.id, { path: '/ext/v1/metrics', status: 200, ms: 3 }); assert.equal((await eng.authenticate(con.key)).error, 'quota'); assert.deepEqual(await eng.callStats(), [{ consumer_id: con.id, calls: 1, errors: 0 }]);
    await eng.revokeConsumer(con.id); assert.equal((await eng.authenticate(con.key)).error, 'revoked');
  } finally { await dropTestDb(ctx); }
});
