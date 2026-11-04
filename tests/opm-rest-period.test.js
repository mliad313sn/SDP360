'use strict';
// A-18a — OpManager REST snapshots carry an HONEST data_through (the collection date, never the
// future end of the current month) so staleness can fire on month rows; the device list is paged
// (a fleet over one page is no longer silently truncated). All injected — no real DB/network.
const { test } = require('node:test');
const assert = require('node:assert');
const { main } = require('../tools/opmanager/sync-availability');
const { _fillFamilies, _dataAsOf } = require('../routes/opmanager');

function harness({ pages, perDevice } = {}) {
  const captured = { upserts: [], listCalls: [], logs: [] };
  const rdb = {
    db: {},
    listSiteModuleCodes: async () => [{ code: 'Mana', site_id: 42, module: 'opmanager' }],
    upsertInfraSnapshots: async (rows) => { captured.upserts.push(...rows); },
  };
  const opmanagerClient = {
    listDevices: async ({ rows, page }) => {
      captured.listCalls.push({ rows, page });
      return pages ? pages(rows, page) : [];
    },
    getDeviceCompleteDetails: async ({ name }) => ({ availdata: { Up: perDevice ? perDevice(name) : 99 } }),
  };
  const deps = {
    rdb, opmanagerClient,
    getConfig: async () => ({ opmanager_api_key: 'K', opmanager_base_url: 'https://opm:8061', opm_targets: JSON.stringify({ lan: 99 }) }),
    deviceToSite: () => 42,
    asOfWeek: { period_type: 'week', period_start: '2026-08-09', period_end: '2026-08-15' },
    asOfMonth: { period_type: 'month', period_start: '2026-08-01', period_end: '2026-08-31' },
    now: '2026-08-16T05:10:00Z',
    log: (m) => captured.logs.push(m),
  };
  return { deps, captured };
}
const sw = (i) => ({ name: `MANA-SW-${i}`, type: 'Meraki MS Series', category: 'Meraki Switch', probeName: 'Mana' });
const range = (from, n) => Array.from({ length: n }, (_, k) => sw(from + k));

test('REST rows (week AND month) carry data_through = collection date, not period_end', async () => {
  const { deps, captured } = harness({ pages: (rows, page) => (page === 1 ? range(1, 2) : []) });
  const r = await main(deps);
  assert.equal(r.ok, true);
  const wk = captured.upserts.find(u => u.period_type === 'week');
  const mo = captured.upserts.find(u => u.period_type === 'month');
  assert.equal(wk.data_through, '2026-08-16');
  assert.equal(mo.data_through, '2026-08-16', 'month row must not carry the future end of the month');
  assert.equal(mo.period_end, '2026-08-31', 'the period itself is unchanged');
});

test('a month row collected 10 days ago reads stale (opm_stale_days 9)', () => {
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const fams = _fillFamilies([{
    kpi_family: 'lan', metric_name: 'availability', metric_value: 99, status_color: 'green',
    period_type: 'month', period_start: tenDaysAgo.slice(0, 8) + '01', period_end: '2999-12-31',
    data_through: tenDaysAgo, collected_at: tenDaysAgo + 'T05:10:00Z', source: 'opmanager_rest', basis: 'recent',
  }], {}, 9, Date.now());
  const lan = fams.find(f => f.kpi_family === 'lan');
  assert.equal(lan.stale, true);
});

test('listDevices is paged: 2 full pages + 1 short page → all devices aggregated', async () => {
  const { deps, captured } = harness({
    pages: (rows, page) => (page <= 2 ? range((page - 1) * rows + 1, rows) : (page === 3 ? range(2 * rows + 1, 5) : [])),
  });
  const r = await main(deps);
  assert.equal(r.ok, true);
  assert.equal(captured.listCalls.length, 3, 'stops after the short page');
  assert.ok(captured.listCalls.every(c => c.rows === 1000));
  assert.deepEqual(captured.listCalls.map(c => c.page), [1, 2, 3]);
  assert.equal(r.devices, 2005);
  assert.notEqual(r.truncated, true);
  const lanWk = captured.upserts.find(u => u.kpi_family === 'lan' && u.period_type === 'week');
  assert.equal(lanWk.device_count, 2005);
});

test('page cap reached → result.truncated true, warning logged, nothing thrown', async () => {
  const { deps, captured } = harness({ pages: (rows, page) => range((page - 1) * rows + 1, rows) });
  const warns = [];
  const orig = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  let r;
  try { r = await main(deps); } finally { console.warn = orig; }
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.equal(captured.listCalls.length, 50, 'hard cap of 50 pages');
  assert.ok([...warns, ...captured.logs].some(m => /device list truncated/.test(m)), 'truncation is logged');
});

test('_dataAsOf = max collected_at of the rows used; null when there are none', () => {
  assert.equal(_dataAsOf([]), null);
  assert.equal(_dataAsOf(null), null);
  assert.equal(_dataAsOf([{ collected_at: '2026-08-14T05:10:00Z' }, { collected_at: '2026-08-16T05:10:00Z' }, { collected_at: null }]),
    '2026-08-16T05:10:00Z');
  assert.equal(_dataAsOf([{ collected_at: '2026-08-14T05:10:00Z' }], [{ collected_at: '2026-08-15T05:20:00Z' }]),
    '2026-08-15T05:20:00Z', 'several row sets combine');
});

// A-18b — optional bounded concurrency for getDeviceCompleteDetails (opm_rest_concurrency,
// default '1' = today's sequential loop). Same rows, same device order, whatever the pool size.
test('opm_rest_concurrency=4 yields the same rows (and device order) as the sequential loop', async () => {
  const devs = range(1, 23);
  const delayed = (name) => new Promise(r => setTimeout(() => r({ availdata: { Up: 90 + (Number(name.split('-').pop()) % 10) } }), (37 * Number(name.split('-').pop())) % 11));
  async function run(conc) {
    const { deps, captured } = harness({ pages: (rows, page) => (page === 1 ? devs : []) });
    let inFlight = 0, peak = 0;
    const order = [];
    deps.opmanagerClient.getDeviceCompleteDetails = async ({ name }) => {
      inFlight++; peak = Math.max(peak, inFlight);
      try { const d = await delayed(name); order.push(name); return d; } finally { inFlight--; }
    };
    const cfg = await deps.getConfig();
    deps.getConfig = async () => ({ ...cfg, ...(conc == null ? {} : { opm_rest_concurrency: String(conc) }) });
    const r = await main(deps);
    return { r, rows: captured.upserts, peak };
  }
  const seq = await run(null);
  const par = await run(4);
  assert.equal(seq.peak, 1, 'default (no key) = sequential');
  assert.ok(par.peak > 1 && par.peak <= 4, `pool bounded by 4 (peak ${par.peak})`);
  assert.equal(par.r.devices, seq.r.devices);
  assert.deepEqual(par.rows, seq.rows);
  const big = await run(50);
  assert.ok(big.peak <= 8, 'pool capped at 8 whatever the setting');
  assert.deepEqual(big.rows, seq.rows);
  const one = await run(1);
  assert.equal(one.peak, 1);
});
