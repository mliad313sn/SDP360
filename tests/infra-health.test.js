const { test } = require('node:test'); const assert = require('node:assert');
const { buildInfraMatrix } = require('../services/infraHealth');

test('buildInfraMatrix merges opm families + WAN roll-up, normalizes vocab, computes overall + na', () => {
  const opmSites = [{ site_id: 1, site_name: 'Sabodala', families: [
    { kpi_family: 'lan', metric_value: 79.1, target: 99, status_color: 'red',    trend: 'no_change', stale: true },
    { kpi_family: 'wifi', metric_value: null, status_color: 'none' },
    { kpi_family: 'servers', metric_value: 98, target: 99, status_color: 'orange', trend: 'up', stale: true },
  ]}];
  // Given out of order (wan2 before wan1) to prove wanRollup sorts by label ascending.
  const wanSites = [{ site_id: 1, uplinks: [ { uplink: 'wan2', availability_pct: 80 }, { uplink: 'wan1', availability_pct: 66.7 } ]}];
  const out = buildInfraMatrix({ opmSites, wanSites, wanTarget: 98, asOf: '2026-08-28' });
  const s = out.sites[0];
  assert.equal(s.families.wan.value, 66.7);              // MIN across uplinks
  assert.equal(s.families.wan.rag, 'red');               // RAG on the worst uplink
  // WAN cell now carries BOTH uplinks, sorted WAN1 before WAN2, labels uppercased.
  assert.deepEqual(s.families.wan.uplinks, [{ label: 'WAN1', value: 66.7 }, { label: 'WAN2', value: 80 }]);
  assert.equal(s.families.wifi.rag, 'na');
  assert.equal(s.families.servers.rag, 'amber');   // orange normalized
  assert.equal(s.families.lan.value, 79.1);
  assert.equal(s.overall_rag, 'red');
});

test('site with empty families and no WAN entry rolls up to overall_rag na (all-na branch)', () => {
  const opmSites = [{ site_id: 99, site_name: 'Empty', families: [] }];
  const out = buildInfraMatrix({ opmSites, wanSites: [], wanTarget: 98 });
  const s = out.sites[0];
  assert.equal(s.overall_rag, 'na');
  // every family cell is na
  assert.deepEqual(s.families.wan, { value: null, rag: 'na', target: 98, trend: null, stale: false, uplinks: [] });
  assert.deepEqual(s.families.lan, { value: null, rag: 'na' });
  assert.deepEqual(s.families.wifi, { value: null, rag: 'na' });
  assert.deepEqual(s.families.servers, { value: null, rag: 'na' });
});

test('data_through_max is null when no family carries data_through; missing-family cell is exactly {value:null,rag:na}', () => {
  const opmSites = [{ site_id: 7, site_name: 'S7', families: [
    { kpi_family: 'lan', metric_value: 99, target: 99, status_color: 'green', trend: 'up', stale: false },
    // wifi and servers absent -> missing-family cells
  ]}];
  const out = buildInfraMatrix({ opmSites, wanSites: [{ site_id: 7, uplinks: [ { availability_pct: 99 } ] }], wanTarget: 98 });
  assert.equal(out.fleet.freshness.data_through_max, null);
  const s = out.sites[0];
  assert.deepEqual(s.families.wifi, { value: null, rag: 'na' });
  assert.deepEqual(s.families.servers, { value: null, rag: 'na' });
});

test('WAN na when site has no wanSites entry and when no uplink has a value', () => {
  const opmSites = [
    { site_id: 10, site_name: 'NoWan', families: [
      { kpi_family: 'lan', metric_value: 99.9, target: 99, status_color: 'green', trend: 'up', stale: false },
    ]},
    { site_id: 11, site_name: 'EmptyUplinks', families: [
      { kpi_family: 'lan', metric_value: 99.9, target: 99, status_color: 'green', trend: 'no_change', stale: false },
    ]},
  ];
  const wanSites = [{ site_id: 11, uplinks: [ { availability_pct: null }, { availability_pct: null } ] }];
  const out = buildInfraMatrix({ opmSites, wanSites, wanTarget: 98 });
  const noWan = out.sites.find(x => x.site_id === 10);
  const empty = out.sites.find(x => x.site_id === 11);
  assert.equal(noWan.families.wan.value, null);
  assert.equal(noWan.families.wan.rag, 'na');
  assert.equal(empty.families.wan.value, null);
  assert.equal(empty.families.wan.rag, 'na');
});

test('WAN amber band uses wanTarget*0.9', () => {
  // wanTarget 98 -> amber threshold 88.2
  const opmSites = [{ site_id: 5, site_name: 'S5', families: [] }];
  const wanSites = [{ site_id: 5, uplinks: [ { availability_pct: 90 } ] }];
  const out = buildInfraMatrix({ opmSites, wanSites, wanTarget: 98 });
  const s = out.sites[0];
  assert.equal(s.families.wan.value, 90);
  assert.equal(s.families.wan.rag, 'amber');
  assert.equal(s.families.wan.target, 98);
  assert.equal(s.families.wan.trend, null);
  assert.equal(s.families.wan.stale, false);
});

test('overall_trend prefers down, then up, then no_change', () => {
  const mk = (id, trends) => ({
    site_id: id, site_name: 'S' + id,
    families: [
      { kpi_family: 'lan', metric_value: 99, target: 99, status_color: 'green', trend: trends[0], stale: false },
      { kpi_family: 'servers', metric_value: 99, target: 99, status_color: 'green', trend: trends[1], stale: false },
    ],
  });
  const out = buildInfraMatrix({
    opmSites: [
      mk(1, ['up', 'down']),
      mk(2, ['up', 'no_change']),
      mk(3, ['no_change', null]),
    ],
    wanSites: [],
  });
  assert.equal(out.sites.find(x => x.site_id === 1).overall_trend, 'down');
  assert.equal(out.sites.find(x => x.site_id === 2).overall_trend, 'up');
  assert.equal(out.sites.find(x => x.site_id === 3).overall_trend, 'no_change');
});

test('fleet by_family_counts + freshness aggregate correctly', () => {
  const opmSites = [
    { site_id: 1, site_name: 'A', families: [
      { kpi_family: 'lan', metric_value: 99, target: 99, status_color: 'green', trend: 'up', stale: false, data_through: '2026-08-20' },
      { kpi_family: 'wifi', metric_value: 80, target: 98, status_color: 'orange', trend: 'down', stale: true, data_through: '2026-08-25' },
      { kpi_family: 'servers', metric_value: 50, target: 99, status_color: 'red', trend: 'down', stale: false, data_through: '2026-08-10' },
    ]},
    { site_id: 2, site_name: 'B', families: [
      { kpi_family: 'lan', metric_value: 99, target: 99, status_color: 'green', trend: 'up', stale: false, data_through: '2026-08-28' },
    ]},
  ];
  const wanSites = [{ site_id: 1, uplinks: [ { availability_pct: 99 } ] }];
  const out = buildInfraMatrix({ opmSites, wanSites, wanTarget: 98 });

  assert.deepEqual(out.fleet.by_family_counts.lan, { green: 2, amber: 0, red: 0, na: 0 });
  assert.deepEqual(out.fleet.by_family_counts.wifi, { green: 0, amber: 1, red: 0, na: 1 });
  assert.deepEqual(out.fleet.by_family_counts.servers, { green: 0, amber: 0, red: 1, na: 1 });
  assert.deepEqual(out.fleet.by_family_counts.wan, { green: 1, amber: 0, red: 0, na: 1 });

  assert.equal(out.fleet.freshness.stale_count, 1);          // only site A has a stale cell
  assert.equal(out.fleet.freshness.data_through_max, '2026-08-28');
});

test('buildInfraTrend: contiguous axis, null gaps, filters metric_name, no WAN series', () => {
  const { buildInfraTrend } = require('../services/infraHealth');
  const opmMonthly = [
    { kpi_family:'lan',     metric_name:'availability', metric_value: 99.5, period_start:'2026-06-01' },
    { kpi_family:'servers', metric_name:'availability', metric_value: 88,   period_start:'2026-08-01' },
    { kpi_family:'lan',     metric_name:'device_count', metric_value: 40,   period_start:'2026-08-01' }, // filtered out
    { kpi_family:'wan',     metric_name:'availability', metric_value: 100,  period_start:'2026-08-01' }, // WAN ignored
  ];
  const out = buildInfraTrend({ opmMonthly, months: 4, asOf: '2026-08-28' });
  assert.deepEqual(out.labels, ['2026-05','2026-06','2026-07','2026-08']);
  assert.equal(out.series.lan[1], 99.5);
  assert.equal(out.series.lan[3], null);       // device_count row filtered -> no lan availability in Aug
  assert.equal(out.series.servers[3], 88);
  assert.equal(out.series.servers[0], null);
  assert.ok(!('wan' in out.series));           // no WAN series in v1
});

test('buildInfraTrend: axis crosses year boundary; wifi key present, gaps null', () => {
  const { buildInfraTrend } = require('../services/infraHealth');
  const opmMonthly = [
    { kpi_family:'wifi', metric_name:'availability', metric_value: 97, period_start:'2025-12-01' },
    { kpi_family:'wifi', metric_name:'availability', metric_value: 95, period_start:'2026-01-01' },
  ];
  const out = buildInfraTrend({ opmMonthly, months: 3, asOf: '2026-01-15' });
  assert.deepEqual(out.labels, ['2025-11','2025-12','2026-01']);
  assert.equal(out.series.wifi[0], null);
  assert.equal(out.series.wifi[1], 97);
  assert.equal(out.series.wifi[2], 95);
  assert.deepEqual(Object.keys(out.series).sort(), ['lan','servers','wifi']);
});
