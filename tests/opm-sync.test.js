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
