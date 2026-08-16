'use strict';
// V1a Task 7 — sync main(): config-gated, awaits everything (pg Promises), pre-resolves
// a plain probe→site map, composes week+month, fills trend vs prior BEFORE upsert,
// best-effort on failure. All injected — no real DB/network.
const { test } = require('node:test');
const assert = require('node:assert');
const { main } = require('../tools/opmanager/sync-availability');

const DAILY = () => {
  const up = '1 days 00 hrs 00 mins 00 secs', zero = '0 days 00 hrs 00 mins 00 secs';
  const rows = [];
  for (let d = 20; d <= 26; d++) rows.push({ probe: 'Mana', type: 'Meraki MS Series', category: 'Meraki Switch',
    device_key: 'sw1', day: `2026-07-${d}`, uptime_pct: '100%', uptime_dur: up, downtime_dur: zero,
    dependent_dur: zero, unmonitored_dur: zero });
  return rows;
};

function stub(over = {}) {
  const captured = { upserts: [], priorQueries: [] };
  const rdb = {
    db: {},
    listSiteModuleCodes: async (m) => (m === 'opmanager' ? [{ code: 'Mana', site_id: 42, module: 'opmanager' }] : []),
    getInfraSnapshots: over.getInfraSnapshots || (async (f) => { captured.priorQueries.push(f); return []; }),
    upsertInfraSnapshots: async (rows) => { captured.upserts.push(...rows); },
  };
  const deps = {
    rdb,
    getConfig: over.getConfig || (async () => ({ opm_availability_view_id: 'V1', opm_targets: JSON.stringify({ lan: 99 }) })),
    readDailyRows: over.readDailyRows || (async () => DAILY()),
    now: '2026-07-27T00:00:00Z',
    log: () => {},
  };
  return { deps, captured };
}

test('armed → composes week + month snapshots and upserts them', async () => {
  const { deps, captured } = stub();
  const r = await main(deps);
  assert.equal(r.ok, true);
  assert.equal(r.week, 1); assert.equal(r.month, 1);
  assert.equal(captured.upserts.length, 2);
  const wk = captured.upserts.find(u => u.period_type === 'week');
  assert.equal(wk.site_id, 42); assert.equal(wk.kpi_family, 'lan');
  assert.equal(wk.metric_value, 100); assert.equal(wk.status_color, 'green');
  assert.equal(wk.source, 'analytics_opmanager'); assert.equal(wk.source_view, 'V1');
  assert.equal(wk.collected_at, '2026-07-27T00:00:00Z');
});

test('trend read BEFORE upsert (prior queried for the PREVIOUS period)', async () => {
  const { deps, captured } = stub({
    getInfraSnapshots: async (f) => { return f.period_start === '2026-07-13' ? [{ metric_value: 90 }] : []; },
  });
  const r = await main(deps);
  const wk = captured.upserts.find(u => u.period_type === 'week');
  assert.equal(wk.trend, 'up');   // 100 > 90 (prior week 2026-07-13)
  assert.equal(r.ok, true);
});

test('config-gated: no view id → skips, no upsert', async () => {
  const { deps, captured } = stub({ getConfig: async () => ({ opm_availability_view_id: '' }) });
  const r = await main(deps);
  assert.equal(r.skipped, true);
  assert.equal(captured.upserts.length, 0);
});

test('fetch failure → best-effort {ok:false}, no upsert, no throw', async () => {
  const { deps, captured } = stub({ readDailyRows: async () => { throw new Error('analytics down'); } });
  const r = await main(deps);
  assert.equal(r.ok, false);
  assert.match(r.error, /analytics down/);
  assert.equal(captured.upserts.length, 0);
});

// ── V1b-B — REST device-grain path (LAN/WLAN/Servers). Preferred when opmanager REST configured.
test('REST path: device-grain aggregate → infra_metric_snapshots (rest, basis recent, no wan)', async () => {
  const captured = { upserts: [] };
  const rdb = {
    db: {},
    listSiteModuleCodes: async (m) => (m === 'opmanager' ? [{ code: 'Mana', site_id: 42, module: 'opmanager' }] : []),
    upsertInfraSnapshots: async (rows) => { captured.upserts.push(...rows); },
  };
  const opmanagerClient = {
    listDevices: async () => [
      { name: 'MANA-SW-01', type: 'Meraki MS Series', category: 'Meraki Switch', probeName: 'Mana' },
      { name: 'MANA-SRV-01', type: 'Windows 2022', category: 'Server', probeName: 'Mana' },
      { name: 'MANA-F/W-01', type: 'Meraki MX Series', category: 'Meraki Security', probeName: 'Mana' }, // firewall → skipped
    ],
    getDeviceCompleteDetails: async ({ name }) => ({ availdata: { Up: name === 'MANA-SW-01' ? 99 : 96 } }),
  };
  const deps = {
    rdb, opmanagerClient,
    getConfig: async () => ({ opmanager_api_key: 'K', opmanager_base_url: 'https://opm:8061', opm_targets: JSON.stringify({ lan: 99, servers: 99 }) }),
    deviceToSite: () => 42,
    asOfWeek: { period_type: 'week', period_start: '2026-08-09', period_end: '2026-08-15' },
    asOfMonth: { period_type: 'month', period_start: '2026-08-01', period_end: '2026-08-31' },
    now: '2026-08-16T05:10:00Z', log: () => {},
  };
  const r = await main(deps);
  assert.equal(r.ok, true); assert.equal(r.mode, 'rest');
  // lan + servers, week + month = 4 rows; NO wan (firewall skipped)
  assert.equal(captured.upserts.length, 4);
  assert.ok(!captured.upserts.some(u => u.kpi_family === 'wan'), 'firewall/WAN excluded from REST path');
  const lanWk = captured.upserts.find(u => u.kpi_family === 'lan' && u.period_type === 'week');
  assert.equal(lanWk.site_id, 42); assert.equal(lanWk.metric_value, 99);
  assert.equal(lanWk.source, 'opmanager_rest'); assert.equal(lanWk.basis, 'recent');
});

test('REST path: fetch failure → best-effort {ok:false}, no upsert', async () => {
  const captured = { upserts: [] };
  const rdb = { db: {}, listSiteModuleCodes: async () => [], upsertInfraSnapshots: async (rows) => { captured.upserts.push(...rows); } };
  const deps = {
    rdb,
    opmanagerClient: { listDevices: async () => { throw new Error('opmanager down'); }, getDeviceCompleteDetails: async () => null },
    getConfig: async () => ({ opmanager_api_key: 'K', opmanager_base_url: 'https://opm:8061', opm_targets: '{}' }),
    deviceToSite: () => 1,
    asOfWeek: { period_type: 'week', period_start: '2026-08-09', period_end: '2026-08-15' },
    asOfMonth: { period_type: 'month', period_start: '2026-08-01', period_end: '2026-08-31' },
    now: 'x', log: () => {},
  };
  const r = await main(deps);
  assert.equal(r.ok, false); assert.match(r.error, /opmanager down/); assert.equal(captured.upserts.length, 0);
});
