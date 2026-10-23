'use strict';
// Step 9 — engagement, report runs, API consumers, snapshot and publications on PostgreSQL
// (db/postgres/reports/021_engagement_reports_publication.sql applied by the migrator).
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pgs9-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('pg: engagement, report runs, API consumers, snapshot, publications', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  const es = require('../services/engagement/store');
  const rs = require('../services/reportgen/store');
  const clients = require('../services/publication/clients');
  const runner = require('../services/publication/runner');
  const { handle } = require('../services/sqlStore');
  try {
    const rule = require('../services/engagement/rules').validate({ id: 'r1', title: 'R', kind: 'major_incident', config: { scope: 'GROUP', threshold: 1 }, enabled: true }).rule;
    await es.saveRule(rule, 'a');
    assert.equal((await es.getRule('r1')).enabled, true);
    await es.saveState('r1', { breaches: 2, last_value: 3, last_eval_at: '2026-10-23T08:00:00Z', firing: true, fire_id: null, last_fired_at: null });
    assert.equal((await es.getState('r1')).breaches, 2);
    const f = await es.addFire('r1', 3, 'msg');
    const n = await es.notify({ fire_id: f, rule_id: 'r1', username: 'u1', title: 'T' });
    assert.equal(await es.unreadCount('u1'), 1);
    await es.markRead('u1', [n]);
    assert.equal(await es.unreadCount('u1'), 0);
    assert.ok((await es.receipts(f))[0].read_at);
    await es.addComment(f, 'u1', 'ok');
    assert.equal((await es.comments(f)).length, 1);
    await es.setSubscription('u2', 'r1', 'email', true);
    assert.deepStrictEqual(await es.subscribers('r1'), [{ username: 'u2', channel: 'email' }]);
    const ch = await es.addChannel({ name: 'c', kind: 'webhook', url: 'https://example.org/h', signingSecret: 's' }, 'sa');
    assert.equal((await es.channelSecret(ch)).url, 'https://example.org/h');
    assert.ok(!JSON.stringify(await es.listChannels()).includes('example.org'));

    const run = await rs.createRun({ template_id: 'tpl', template_version: 1, month: '2026-09', data: { widgets: {} }, analysis: { facts: [] }, commentary: { c1: 'x' }, html: '<p>x</p>' }, 'author');
    await rs.setCommentary(run.id, { c1: 'y' }, '<p>y</p>', 'author');
    await rs.approve(run.id, '<p>ok</p>', 'reviewer');
    assert.equal((await rs.getRun(run.id, true)).status, 'approved');
    assert.equal((await rs.latestApproved('tpl')).id, run.id);
    assert.deepStrictEqual((await rs.events(run.id)).map(e => e.action), ['generated', 'edited', 'approved']);

    const c = await clients.create({ name: 'BI', scopes: ['metrics'] }, 'sa');
    assert.ok(await clients.authenticate({ headers: { 'x-api-key': c.key } }));
    const { H } = handle('021_engagement_reports_publication.sql');
    await H.prepare(`INSERT INTO pb_metric_values (metric_key, scope, month, value, unit, rag, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('k', 'GROUP', '2026-09', 1.5, '%', null, 'now');
    const rows = await require('../services/publication/snapshot').read({ key: 'k' });
    assert.equal(Number(rows[0].value), 1.5);
    const v = runner.validate({ title: 'P', kind: 'webhook', channel_id: ch, what: { metrics: ['k'] } }, { channelIds: new Set([ch]) });
    const p = await runner.save(null, v.publication, 'sa');
    await runner.mark(p.id, 'ok');
    assert.equal((await runner.get(p.id)).last_status, 'ok');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
