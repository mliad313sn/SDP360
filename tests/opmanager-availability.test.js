'use strict';
// V1b-B Task 3 — pure device-availability aggregate: average availdata.Up% per site per
// family; excluded + wan skipped (wan = Meraki); empty family → null (never 0); basis='recent'.
const { test } = require('node:test');
const assert = require('node:assert');
const { aggregateDeviceAvail } = require('../services/opmanagerAvailability');
const { classifyKpiFamily } = require('../services/opmClassify');

const period = { period_type: 'week', period_start: '2026-08-09', period_end: '2026-08-15' };
const D = (name, type, category, availUp) => ({ name, type, category, availUp });

// deviceToSite: everything → site 1 (single-site fixture)
const toSite = () => 1;

test('averages availdata.Up per (site, family); wan skipped; basis recent', () => {
  const devices = [
    D('HGO-SW-01', 'Meraki MS Series', 'Meraki Switch', 99.0),   // lan
    D('HGO-SW-02', 'Meraki MS Series', 'Meraki Switch', 97.0),   // lan
    D('HGO-AP-01', 'Meraki MR Series', 'Meraki Radio', 100.0),   // wifi
    D('HGO-SRV-01', 'Windows 2022', 'Server', 95.0),             // servers
    D('HGO-F/W-01', 'Meraki MX Series', 'Meraki Security', 100), // wan → skipped
    D('HGO-UPS-01', 'UPS', 'UPS', 100),                          // excluded → skipped
  ];
  const rows = aggregateDeviceAvail(devices, { classify: classifyKpiFamily, deviceToSite: toSite,
    targets: { lan: 99, wifi: 98, servers: 99 }, period, collected_at: '2026-08-16T05:10:00Z' });

  const byFam = Object.fromEntries(rows.map(r => [r.kpi_family, r]));
  assert.deepEqual(Object.keys(byFam).sort(), ['lan', 'servers', 'wifi']);   // NO wan, NO excluded
  assert.equal(byFam.lan.metric_value, 98);           // mean(99,97)
  assert.equal(byFam.lan.included_device_count, 2);
  assert.equal(byFam.lan.status_color, 'orange');     // 98 < 99, >= 99*0.9
  assert.equal(byFam.wifi.metric_value, 100);
  assert.equal(byFam.wifi.status_color, 'green');
  assert.equal(byFam.servers.metric_value, 95);
  assert.equal(byFam.lan.basis, 'recent');
  assert.equal(byFam.lan.source, 'opmanager_rest');
  assert.equal(byFam.lan.period_start, '2026-08-09');
  assert.equal(byFam.lan.metric_name, 'availability');
});

test('device with null/absent availUp is not counted as 0 (excluded from the mean)', () => {
  const devices = [
    D('SW1', 'Meraki MS Series', 'Meraki Switch', 100),
    D('SW2', 'Meraki MS Series', 'Meraki Switch', null),
  ];
  const rows = aggregateDeviceAvail(devices, { classify: classifyKpiFamily, deviceToSite: toSite,
    targets: { lan: 99 }, period, collected_at: 'x' });
  const lan = rows.find(r => r.kpi_family === 'lan');
  assert.equal(lan.metric_value, 100);           // only SW1 counted
  assert.equal(lan.included_device_count, 1);
  assert.equal(lan.device_count, 2);
});

test('family with no readable device → null metric (never 0), status none', () => {
  const devices = [D('SW1', 'Meraki MS Series', 'Meraki Switch', null)];
  const rows = aggregateDeviceAvail(devices, { classify: classifyKpiFamily, deviceToSite: toSite,
    targets: { lan: 99 }, period, collected_at: 'x' });
  const lan = rows.find(r => r.kpi_family === 'lan');
  assert.strictEqual(lan.metric_value, null);
  assert.equal(lan.status_color, 'none');
});

test('devices with no resolvable site are skipped', () => {
  const rows = aggregateDeviceAvail([D('SW1', 'Meraki MS Series', 'Meraki Switch', 99)],
    { classify: classifyKpiFamily, deviceToSite: () => null, targets: { lan: 99 }, period, collected_at: 'x' });
  assert.equal(rows.length, 0);
});
