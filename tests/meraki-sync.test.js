'use strict';
// V1b-A Task 6 — sync-wan collector. Everything injected (client + rdb + config + windows)
// so no DB/network. Asserts: config-gate, week+month compose per uplink, upsert shape,
// site resolution via network name, best-effort on failure.
const { test } = require('node:test');
const assert = require('node:assert');
const { main } = require('../tools/meraki/sync-wan');

function stub(over = {}) {
  const cap = { upserts: [] };
  const client = {
    orgUplinkStatuses: async () => [{ networkId: 'N1', serial: 'Q2-AB',
      uplinks: [{ interface: 'wan1', status: 'active' }, { interface: 'wan2', status: 'active' }] }],
    orgUplinksLossLatency: async () => [{ serial: 'Q2-AB', uplink: 'wan1', ip: '8.8.8.8' },
      { serial: 'Q2-AB', uplink: 'wan2', ip: '8.8.4.4' }],
    deviceLossLatencyHistory: async () => Array.from({ length: 168 }, (_, i) => ({ startTs: `t${i}`, endTs: `t${i}`, lossPercent: 0, latencyMs: 20, jitter: 2, goodput: 1000 })),
    ...(over.client || {}),
  };
  const rdb = {
    listSiteModuleCodes: async (m) => (m === 'meraki' ? [{ code: 'Ity Gold Operations', site_id: 7, module: 'meraki' }] : []),
    listWanSubsiteNetworks: async () => [],
    upsertWanSnapshots: async (rows) => { cap.upserts.push(...rows); },
    ...(over.rdb || {}),
  };
  const deps = {
    client, rdb,
    getConfig: over.getConfig || (async () => ({ meraki_api_key: 'K', meraki_org_id: 'O', opm_targets: JSON.stringify({ wan: 98 }), meraki_missing_policy: 'down' })),
    networkNameById: over.networkNameById || (() => 'Ity Gold Operations'),
    now: '2026-08-16T05:20:00Z',
    asOfWeek: { period_start: '2026-08-09', period_end: '2026-08-15' },
    asOfMonth: { period_start: '2026-08-01', period_end: '2026-08-31' },
    log: () => {},
  };
  return { deps, cap };
}

test('armed → composes week + month per uplink and upserts', async () => {
  const { deps, cap } = stub();
  const r = await main(deps);
  assert.equal(r.ok, true);
  assert.equal(cap.upserts.length, 4);          // 2 uplinks × 2 periods
  const wk1 = cap.upserts.find(u => u.period_type === 'week' && u.uplink === 'wan1');
  assert.equal(wk1.site_id, 7);
  assert.equal(wk1.availability_pct, 100);       // 168 up samples of a ~168-interval week
  assert.equal(wk1.status_color, 'green');
  assert.equal(wk1.status_current, 'active');
  assert.equal(wk1.device_serial, 'Q2-AB');
  assert.equal(wk1.source, 'meraki_api');
  assert.equal(wk1.period_start, '2026-08-09');
  assert.ok(cap.upserts.some(u => u.period_type === 'month' && u.uplink === 'wan2'));
});

test('config-gated: no api key → skips, no upsert', async () => {
  const { deps, cap } = stub({ getConfig: async () => ({ meraki_api_key: '' }) });
  const r = await main(deps);
  assert.equal(r.skipped, true);
  assert.equal(cap.upserts.length, 0);
});

test('unmapped network → skipped, not upserted', async () => {
  const { deps, cap } = stub({ networkNameById: () => 'Unknown Network' });
  const r = await main(deps);
  assert.equal(r.ok, true);
  assert.equal(cap.upserts.length, 0);           // no site resolves → nothing stored
});

test('fetch failure → best-effort {ok:false}, no upsert, no throw', async () => {
  const { deps, cap } = stub({ client: { deviceLossLatencyHistory: async () => { throw new Error('meraki down'); } } });
  const r = await main(deps);
  assert.equal(r.ok, false);
  assert.match(r.error, /meraki down/);
  assert.equal(cap.upserts.length, 0);
});

test('multi-destination: fetches history per destination and merges (up if any dest up)', async () => {
  const cap = { upserts: [], histCalls: [] };
  const up1 = '1 days 00 hrs 00 mins 00 secs';
  const client = {
    orgUplinkStatuses: async () => [{ networkId: 'N1', serial: 'Q2-AB', uplinks: [{ interface: 'wan1', status: 'active' }] }],
    orgUplinksLossLatency: async () => [{ serial: 'Q2-AB', uplink: 'wan1', ip: '8.8.8.8' }],
    networkConnectivityDestinations: async ({ networkId }) => ({ destinations: [{ ip: '8.8.8.8', default: true }, { ip: '1.1.1.1', default: false }] }),
    // dest 8.8.8.8: fully up ; dest 1.1.1.1: fully down → merged is up (any dest up)
    deviceLossLatencyHistory: async ({ ip }) => { cap.histCalls.push(ip); return Array.from({ length: 168 }, (_, i) => ({ startTs: `t${i}`, endTs: `t${i}`, lossPercent: ip === '8.8.8.8' ? 0 : 100, latencyMs: 20, jitter: 2, goodput: 1000 })); },
  };
  const rdb = {
    listSiteModuleCodes: async () => [{ code: 'Ity Gold Operations', site_id: 7, module: 'meraki' }],
    upsertWanSnapshots: async (rows) => { cap.upserts.push(...rows); },
  };
  const deps = {
    client, rdb,
    getConfig: async () => ({ meraki_api_key: 'K', meraki_org_id: 'O', opm_targets: JSON.stringify({ wan: 98 }), meraki_missing_policy: 'down' }),
    networkNameById: () => 'Ity Gold Operations',
    now: '2026-08-16T05:20:00Z',
    asOfWeek: { period_start: '2026-08-09', period_end: '2026-08-15' },
    asOfMonth: { period_start: '2026-08-01', period_end: '2026-08-31' },
    log: () => {},
  };
  const r = await main(deps);
  assert.equal(r.ok, true);
  // 2 destinations × 2 periods (week+month) = 4 history calls for the one uplink
  assert.ok(cap.histCalls.filter(ip => ip === '8.8.8.8').length >= 1 && cap.histCalls.filter(ip => ip === '1.1.1.1').length >= 1, 'both destinations queried');
  const wk = cap.upserts.find(u => u.period_type === 'week' && u.uplink === 'wan1');
  assert.equal(wk.availability_pct, 100, 'up because one destination (8.8.8.8) responded on every interval');
});

test('a network in BOTH the main map and a sub-site map fans to two rows from one fetch', async () => {
  const { deps, cap } = stub({
    rdb: {
      listSiteModuleCodes: async (m) => (m === 'meraki' ? [{ code: 'Massawa Gold Operations', site_id: 5, module: 'meraki' }] : []),
      listWanSubsiteNetworks: async () => [{ site_id: 9, sub_site: 'MASSAWA', network: 'Massawa Gold Operations' }],
    },
    networkNameById: () => 'Massawa Gold Operations',
  });
  const r = await main(deps);
  assert.equal(r.ok, true);
  const wk = cap.upserts.filter(u => u.period_type === 'week' && u.uplink === 'wan1');
  assert.ok(wk.find(u => u.site_id === 5 && u.sub_site === ''),        'Massawa mine row');
  assert.ok(wk.find(u => u.site_id === 9 && u.sub_site === 'MASSAWA'), 'Exploration MASSAWA row');
});

test('suffix-tolerant site match: a "... - appliance" network maps to the base-name seed', async () => {
  // Meraki splits a site into product networks; the seed stores the base name.
  const { deps, cap } = stub({
    rdb: { listSiteModuleCodes: async (m) => (m === 'meraki' ? [{ code: 'Sabodala Gold Operations', site_id: 9, module: 'meraki' }] : []) },
    networkNameById: () => 'Sabodala Gold Operations - appliance',
  });
  const r = await main(deps);
  assert.equal(r.ok, true);
  assert.ok(cap.upserts.length > 0, 'appliance-suffixed network resolves to the site');
  assert.equal(cap.upserts[0].site_id, 9);
});

test('two MX in one network (master + warm spare): the spare empty result does not overwrite master data', async () => {
  const cap = { upserts: [] };
  const client = {
    // master FIRST, spare (empty) LAST — so the old last-wins upsert would clobber master with null.
    orgUplinkStatuses: async () => [
      { networkId: 'N1', serial: 'Q2-MASTER', uplinks: [{ interface: 'wan1', status: 'active' }] },
      { networkId: 'N1', serial: 'Q2-SPARE',  uplinks: [{ interface: 'wan1', status: 'not connected' }] },
    ],
    orgUplinksLossLatency: async () => [{ serial: 'Q2-MASTER', uplink: 'wan1', ip: '8.8.8.8' }],
    deviceLossLatencyHistory: async ({ serial }) => serial === 'Q2-MASTER'
      ? Array.from({ length: 168 }, (_, i) => ({ startTs: `t${i}`, endTs: `t${i}`, lossPercent: 0, latencyMs: 20, jitter: 2, goodput: 1000 }))
      : [],   // warm spare: no samples
  };
  const rdb = {
    listSiteModuleCodes: async (m) => (m === 'meraki' ? [{ code: 'Mana Gold Operations', site_id: 3, module: 'meraki' }] : []),
    upsertWanSnapshots: async (rows) => { cap.upserts.push(...rows); },
  };
  const deps = {
    client, rdb,
    getConfig: async () => ({ meraki_api_key: 'K', meraki_org_id: 'O', opm_targets: JSON.stringify({ wan: 98 }), meraki_missing_policy: 'down' }),
    networkNameById: () => 'Mana Gold Operations', now: '2026-08-16T05:20:00Z',
    asOfWeek: { period_start: '2026-08-09', period_end: '2026-08-15' }, asOfMonth: { period_start: '2026-08-01', period_end: '2026-08-31' }, log: () => {},
  };
  const r = await main(deps);
  assert.equal(r.ok, true);
  const wk = cap.upserts.filter(u => u.period_type === 'week' && u.uplink === 'wan1');
  assert.equal(wk.length, 1, 'only the master (with data) produced a row — the empty spare is skipped');
  assert.equal(wk[0].availability_pct, 100, 'master data preserved, not overwritten by the spare null');
  assert.equal(wk[0].device_serial, 'Q2-MASTER');
});
