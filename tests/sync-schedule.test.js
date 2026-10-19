'use strict';
// Step 1 — schedule.start binds every registry job to cron and routes failures to the alerter.
const test = require('node:test');
const assert = require('node:assert');
const { createSyncRunner, memoryStore } = require('../services/sync/syncRunner');
const schedule = require('../services/sync/schedule');

test('start(): one cron task per job + the staleness sweep; runJob goes through the runner; failures alert', async () => {
  schedule._reset();
  const store = memoryStore();
  store.recentRuns = async (job, n) => store.runs.filter((r) => r.job === job).slice(-n).reverse();
  let hook = null;
  const runner = createSyncRunner({ store, sleep: async () => {}, log: () => {}, onEvent: (k, p) => hook && hook(k, p) });
  const syncModule = { getRunner: () => runner, getStore: () => store, ensureReady: async () => {}, setEventHook: (fn) => { hook = fn; } };
  const scheduled = [];
  const cron = { schedule: (expr, fn) => { scheduled.push({ expr, fn }); return { stop() {} }; } };
  const sent = [];
  const mailer = { send: async (m) => { sent.push(m); return { ok: true }; } };
  const s = schedule.start({
    cron, syncModule, fetchView: () => {},
    sync: { syncRequestData: async () => { throw new Error('zoho 500'); }, syncChangeCab: async () => ({ upserted: 2 }), syncSurveyData: async () => 0 },
    assets: { syncAllAssets: async () => [], afterAssetsSync: async () => {} },
    tools: { 'teams/poll-sla': { run: async () => ({ ok: true }) } },
    getAlertConfig: async () => ({ recipients: ['ops@example.com'], from: 'x@example.com', mailer, teamsUrl: '', post: null }),
  });
  assert.equal(scheduled.length, s.jobs.length + 1, 'every job + the staleness sweep');
  const ok = await s.runJob('zoho.change_cab');
  assert.equal(ok.status, 'ok'); assert.equal(ok.rows, 2);
  const r1 = await s.runJob('zoho.requests');
  assert.equal(r1.status, 'error');
  await s.runJob('zoho.requests');
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(sent.length, 1, 'e-mail alert after 2 consecutive failures');
  assert.match(sent[0].subject, /zoho\.requests/);
  await assert.rejects(() => s.runJob('nope'), /unknown job/);
  schedule._reset();
});
