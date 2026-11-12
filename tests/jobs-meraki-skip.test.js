'use strict';
// E-Q03 (audit Q-03) — the Meraki WAN jobs self-skip when Meraki is not configured: no client built, no
// network call, a recorded "ok / 0 rows" run instead of a failure. Tools reached through buildJobs' injected
// `tools` map, config through an injected getConfig — no database, no Meraki API.
const test = require('node:test');
const assert = require('node:assert');
const { createSyncRunner, memoryStore } = require('../services/sync/syncRunner');
const { buildJobs } = require('../services/sync/jobs');

const runner = () => createSyncRunner({ store: memoryStore(), sleep: async () => {}, log: () => {} });
const noClient = { orgNetworks: async () => { throw new Error('no Meraki call expected'); }, orgUplinkStatuses: async () => { throw new Error('no Meraki call expected'); } };

for (const tool of ['sync-wan-events', 'poll-wan-outages']) {
  test(`tools/meraki/${tool}: no meraki_api_key → { skipped: true }, no client call`, async () => {
    const { main } = require(`../tools/meraki/${tool}`);
    const logs = [];
    for (const config of [{}, { meraki_api_key: '' }, null]) {
      const out = await main({ getConfig: async () => config, client: noClient, mailer: { send: async () => { throw new Error('no mail'); } }, rdb: {}, log: (m) => logs.push(m) });
      assert.deepEqual(out, { skipped: true });
    }
    assert.ok(logs.every((m) => /not configured \(meraki_api_key\)/.test(m)));
  });
}

test('meraki.wan_events / meraki.wan_events_5m / meraki.wan_poller: wired to the tools, optional, a self-skip is an ok run with 0 rows', async () => {
  const calls = [];
  const tools = {
    'meraki/sync-wan-events': { main: async (o) => { calls.push(['events', o]); return { skipped: true }; } },
    'meraki/poll-wan-outages': { main: async (o) => { calls.push(['poller', o]); return { skipped: true }; } },
  };
  const jobs = buildJobs({ sync: {}, assets: {}, tools });
  const want = { 'meraki.wan_events': ['25 5 * * *', 30], 'meraki.wan_events_5m': ['*/5 * * * *', 1], 'meraki.wan_poller': ['*/5 * * * *', 1] };
  const r = runner();
  for (const [name, [cron, fresh]] of Object.entries(want)) {
    const j = jobs.find((x) => x.name === name);
    assert.ok(j, name);
    assert.equal(j.cron, cron);
    assert.equal(j.freshnessHours, fresh);
    assert.equal(j.optional, true);
    const out = await r.run(j.job);
    assert.equal(out.status, 'ok', name);
    assert.equal(out.rows, 0, name);
  }
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], ['events', {}], 'nightly ingest: default lookback');
  assert.match(String(calls[1][1].since), /^\d{4}-\d\d-\d\dT/, '5-minute ingest passes a since watermark');
  assert.ok(Date.now() - Date.parse(calls[1][1].since) >= 3 * 3600 * 1000 - 5000, 'since = now − 3 h');
  assert.deepEqual(calls[2], ['poller', {}]);
});

test('a Meraki tool that reports an error result fails the run (not a silent ok)', async () => {
  const tools = { 'meraki/poll-wan-outages': { main: async () => ({ error: 'Meraki 503' }) }, 'meraki/sync-wan-events': { main: async () => ({}) } };
  const j = buildJobs({ sync: {}, assets: {}, tools }).find((x) => x.name === 'meraki.wan_poller');
  assert.equal((await runner().run(j.job)).status, 'error');
});

test('meridian.resources (dormant connector): retired or unconfigured → self-skip with no read/post; the job records an ok run', async () => {
  const { main } = require('../tools/meridian/sync-resources');
  const trap = async () => { throw new Error('no read / post expected'); };
  const deps = (cfg) => ({ getConfig: async () => cfg, readSites: trap, readPeople: trap, httpPost: trap, log: () => {} });
  assert.deepEqual(await main(deps({ meridian_enabled: '0', meridian_base_url: 'https://m.test', meridian_out_key: 'k' })), { skipped: 'disabled' });
  assert.deepEqual(await main(deps({ meridian_enabled: '1' })), { skipped: true });
  const j = buildJobs({ sync: {}, assets: {}, tools: { 'meridian/sync-resources': { main: async () => ({ skipped: true }) } } }).find((x) => x.name === 'meridian.resources');
  assert.equal(j.optional, true);
  const out = await runner().run(j.job);
  assert.equal(out.status, 'ok'); assert.equal(out.rows, 0);
});
