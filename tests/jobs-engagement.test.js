'use strict';
// E-Q03 (audit Q-03 / X-Q-03) — the engagement + publication jobs as the scheduler really runs them:
// buildJobs() wraps server.js's injected `engagement` functions in legacyJob(); bindJobs() halts every
// outbound channel on notifications_stop and keeps the connectors off unless publish_cron_enabled = '1'.
// No database, no SMTP, no webhook: config, stores, mailer and poster are injected fakes.
const test = require('node:test');
const assert = require('node:assert');
const { createSyncRunner, memoryStore } = require('../services/sync/syncRunner');
const { buildJobs } = require('../services/sync/jobs');
const EJ = require('../services/engagementJobs');

const runner = () => createSyncRunner({ store: memoryStore(), sleep: async () => {}, log: () => {} });
const jobOf = (jobs, name) => { const j = jobs.find((x) => x.name === name); assert.ok(j, name + ' declared'); return j; };

test('engagement.alerts / engagement.digest / engagement.digest_weekly / publish.connectors: declared optional, call the injected engagement functions', async () => {
  const calls = [];
  const engagement = {
    evaluate: async () => { calls.push(['evaluate']); return { alerts: 2 }; },
    digest: async (kind) => { calls.push(['digest', kind]); return { sent: 1, rows: 1 }; },
    reports: async () => ({}),
    publish: async () => { calls.push(['publish']); return { rows: 3 }; },
  };
  const jobs = buildJobs({ sync: {}, assets: {}, tools: {}, engagement });
  const want = { 'engagement.alerts': ['*/15 * * * *', 1], 'engagement.digest': ['0 7 * * *', 30], 'engagement.digest_weekly': ['15 7 * * 1', 24 * 8], 'publish.connectors': ['0 6 * * *', 30] };
  for (const [name, [cron, fresh]] of Object.entries(want)) {
    const j = jobOf(jobs, name);
    assert.equal(j.cron, cron, name + ' cron');
    assert.equal(j.freshnessHours, fresh, name + ' freshness');
    assert.equal(j.optional, true, name + ' optional');
  }
  const r = runner();
  assert.equal((await r.run(jobOf(jobs, 'engagement.alerts').job)).rows, 2);
  assert.equal((await r.run(jobOf(jobs, 'engagement.digest').job)).status, 'ok');
  assert.equal((await r.run(jobOf(jobs, 'engagement.digest_weekly').job)).status, 'ok');
  assert.equal((await r.run(jobOf(jobs, 'publish.connectors').job)).rows, 3);
  assert.deepEqual(calls, [['evaluate'], ['digest', 'daily'], ['digest', 'weekly'], ['publish']]);
});

test('without the engagement binding every engagement job is a recorded skip, never a failure', async () => {
  const jobs = buildJobs({ sync: {}, assets: {}, tools: {} });
  const r = runner();
  for (const name of ['engagement.alerts', 'engagement.digest', 'engagement.digest_weekly', 'publish.connectors']) {
    const out = await r.run(jobOf(jobs, name).job);
    assert.equal(out.status, 'ok', name);
    assert.equal(out.rows, 0, name);
  }
});

test('an engagement function that throws fails the run (alerting sees it)', async () => {
  const jobs = buildJobs({ sync: {}, assets: {}, tools: {}, engagement: { evaluate: async () => { throw new Error('alert engine down'); }, digest: async () => ({}), reports: async () => ({}), publish: async () => ({}) } });
  const out = await runner().run(jobOf(jobs, 'engagement.alerts').job);
  assert.equal(out.status, 'error');
});

// bindJobs: config read through reportConfig.getConfig — replaced here by a fixed object (no DB read).
function withConfig(cfg, fn) {
  const rc = require('../services/reportConfig');
  const orig = rc.getConfig;
  rc.getConfig = async () => cfg;
  return Promise.resolve().then(fn).finally(() => { rc.getConfig = orig; });
}
// stores() is read at call time; the halted paths must not USE any store (every method throws).
const trap = new Proxy({}, { get: () => () => { throw new Error('store used after halt'); } });
const noStores = () => ({ eng: trap, rep: trap, dash: trap });

test('stopped(): only notifications_stop = "1" halts', () => {
  assert.equal(EJ.stopped({ notifications_stop: '1' }), true);
  assert.equal(EJ.stopped({ notifications_stop: '0' }), false);
  assert.equal(EJ.stopped({}), false);
  assert.equal(EJ.stopped(null), false);
});

test('bindJobs: notifications_stop halts the digest before any store or mailer is used', () => withConfig({ notifications_stop: '1', smtp_host: '' }, async () => {
  const j = EJ.bindJobs({ stores: noStores });
  assert.deepEqual(await j.digest('daily'), { skipped: 'notifications_stop' });
  assert.deepEqual(await j.digest('weekly'), { skipped: 'notifications_stop' });
}));

test('bindJobs: publish.connectors stays off unless publish_cron_enabled = "1", and notifications_stop halts it when armed', () => withConfig({ publish_cron_enabled: '0', notifications_stop: '0' }, async () => {
  const j = EJ.bindJobs({ stores: noStores });
  assert.deepEqual(await j.publish(), { skipped: true }, 'unarmed (today\'s default) → skipped');
}).then(() => withConfig({ publish_cron_enabled: '1', notifications_stop: '1' }, async () => {
  const j = EJ.bindJobs({ stores: noStores });
  assert.deepEqual(await j.publish(), { skipped: 'notifications_stop' }, 'armed + stop → halted');
})));

test('sendDigest: one mail per subscriber who has items and an e-mail; no mailer → counted skip', async () => {
  const pulled = { 1: [{ title: 'A', body: 'b', created_at: '2026-11-01T08:00:00Z' }], 2: [{ title: 'B', body: '', created_at: '2026-11-01' }], 3: [] };
  const store = { digestSubscribers: async () => [1, 2, 3], pullForDigest: async (u) => pulled[u] };
  const rdb = { listUsers: async () => [{ id: 1, email: 'a@x.test' }, { id: 2, email: '' }, { id: 3, email: 'c@x.test' }] };
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return { ok: true }; } };
  const out = await EJ.sendDigest({ store, rdb, mailer, digest: 'weekly', baseUrl: 'https://x.test' });
  assert.deepEqual(out, { users: 3, sent: 1, skipped: 1, rows: 1 });
  assert.deepEqual(sent[0].to, ['a@x.test']);
  assert.match(sent[0].subject, /weekly digest \(1\)/);
  const none = await EJ.sendDigest({ store: { digestSubscribers: async () => [] }, rdb, mailer, digest: 'daily' });
  assert.deepEqual(none, { users: 0, sent: 0, rows: 0 });
});

test('publishScheduled: every connector self-skips without configuration (counted), the Excel mail goes out once when configured', async () => {
  const registry = { has: (k) => k === 'm.one', get: () => ({ name: 'One', unit: '%', reader: 'x.fleet' }), resolve: async () => ({ value: 91, rag: 'G', window: { label: 'W' }, as_of: '2026-11-01' }) };
  const rdb = { listSites: async () => [] };
  const empty = await EJ.publishScheduled({ registry, rdb, cfg: {} });
  assert.deepEqual(empty, { excel: 0, webhook: 0, sharepoint: 0, skipped: 3, rows: 0 });
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return { ok: true }; } };
  const out = await EJ.publishScheduled({ registry, rdb, cfg: { publish_metric_keys: 'm.one, nope', publish_excel_recipients: 'fin@x.test' }, mailer, now: new Date('2026-11-02T06:00:00Z') });
  assert.equal(out.excel, 1);
  assert.equal(out.skipped, 2, 'webhook + SharePoint unconfigured');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['fin@x.test']);
  assert.equal(sent[0].attachments[0].filename, 'metrics-2026-11-02.xlsx');
});
