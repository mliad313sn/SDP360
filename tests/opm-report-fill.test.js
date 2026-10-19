'use strict';
// V1b-C Task 1 — pure report-fill mapping. serviceToFill maps an infra-row service name to a
// snapshot key; buildFills turns wan_link_snapshots + infra_metric_snapshots rows into per-cell
// fill descriptors (value + colour + trend + stale/basis), skipping null metrics.
const { test } = require('node:test');
const assert = require('node:assert');
const { serviceToFill, buildFills } = require('../services/opmReportFill');

test('serviceToFill maps the report rows (wlan before wan; backup/radio → null)', () => {
  assert.equal(serviceToFill('WAN1'), 'wan1');
  assert.equal(serviceToFill('WAN 2'), 'wan2');
  assert.equal(serviceToFill('WLAN'), 'wifi');
  assert.equal(serviceToFill('Wireless'), 'wifi');
  assert.equal(serviceToFill('LAN'), 'lan');
  assert.equal(serviceToFill('Servers'), 'servers');
  assert.strictEqual(serviceToFill('Backup'), null);
  assert.strictEqual(serviceToFill('Radio'), null);
  assert.strictEqual(serviceToFill('Some custom KPI'), null);
});

const NOW = Date.parse('2026-08-16T00:00:00Z');

test('buildFills: wan rows → wan1/wan2 fills with value/colour/trend/stale', () => {
  const wan = [
    { uplink: 'wan1', period_type: 'week', availability_pct: 99.86, status_color: 'green', trend: 'up', data_through: '2026-08-15' },
    { uplink: 'wan2', period_type: 'week', availability_pct: 97.87, status_color: 'orange', trend: 'down', data_through: '2026-08-01' },
  ];
  const fills = buildFills({ wan, infra: [], staleDays: 9, nowMs: NOW });
  const by = Object.fromEntries(fills.map(f => [f.match, f]));
  assert.equal(by.wan1.value, '99.9%');
  assert.equal(by.wan1.status_color, 'green');
  assert.equal(by.wan1.trend, 'up');
  assert.equal(by.wan1.source, 'meraki');
  assert.equal(by.wan1.stale, false);            // 15 Aug, within 9d of 16 Aug
  assert.equal(by.wan2.stale, true);             // 1 Aug, > 9d before 16 Aug
});

test('buildFills: infra rows → lan/wifi/servers fills with basis', () => {
  const infra = [
    { kpi_family: 'lan', metric_name: 'availability', metric_value: 98, status_color: 'orange', basis: 'recent' },
    { kpi_family: 'servers', metric_name: 'availability', metric_value: 100, status_color: 'green', basis: 'recent' },
  ];
  const fills = buildFills({ wan: [], infra, staleDays: 9, nowMs: NOW });
  const by = Object.fromEntries(fills.map(f => [f.match, f]));
  assert.equal(by.lan.value, '98%');
  assert.equal(by.lan.status_color, 'orange');
  assert.equal(by.lan.basis, 'recent');
  assert.equal(by.lan.source, 'opmanager');
  assert.equal(by.servers.value, '100%');
});

test('buildFills: null metric → NO fill entry (nothing to fill)', () => {
  const wan = [{ uplink: 'wan1', period_type: 'week', availability_pct: null, status_color: 'none' }];
  const infra = [{ kpi_family: 'lan', metric_name: 'availability', metric_value: null, status_color: 'none' }];
  const fills = buildFills({ wan, infra, staleDays: 9, nowMs: NOW });
  assert.equal(fills.length, 0);
});

test('buildFills: only week-period wan rows are used', () => {
  const wan = [{ uplink: 'wan1', period_type: 'month', availability_pct: 90, status_color: 'red' }];
  const fills = buildFills({ wan, infra: [], staleDays: 9, nowMs: NOW });
  assert.equal(fills.length, 0);
});

test('WAN sub-site fill matches by (uplink, sub_site) when a token is configured', () => {
  const wan = [
    { period_type:'week', uplink:'wan1', sub_site:'',        availability_pct:99, status_color:'green' },
    { period_type:'week', uplink:'wan1', sub_site:'FETEKRO', availability_pct:80, status_color:'red' },
  ];
  const fills = buildFills({ wan, tokens: ['FETEKRO'] });
  const f = fills.find(x => x.match === 'wan1' && x.sub_site === 'FETEKRO');
  assert.equal(f.value, '80%');
  assert.ok(fills.find(x => x.match === 'wan1' && x.sub_site === ''), 'main wan1 still emitted');
});

test('no tokens → only sub_site="" fills produced (normal site unchanged)', () => {
  const wan = [{ period_type:'week', uplink:'wan1', sub_site:'', availability_pct:99 }];
  const fills = buildFills({ wan, tokens: [] });
  assert.equal(fills.length, 1);
  assert.equal(fills[0].sub_site, '');
});
