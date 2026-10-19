'use strict';
// WAN SLA / ISP chargeback — nightly event-log INGESTER (tools/meraki/sync-wan-events.js).
// Reads the Meraki appliance event log, pairs down/up into outages, attributes them, and
// writes AUTHORITATIVE rows — reconciling any provisional open rows the poller left behind.
// Real sqlite via SDP_DATA_DIR temp so the reconcile UPDATE is genuinely exercised.
// Site/network names are deliberately UNIQUE (WANEVT-*) so they never collide with the
// default seed's real Meraki mappings (Ity/Mana/Hounde/Sabodala) and fan out unexpectedly.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_p.join(_os.tmpdir(), 'wanevt-'));
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'wanevt-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'wanevt-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');
const ingester = require('../tools/meraki/sync-wan-events');

// A site + its (unique) Meraki network name, so listSiteMerakiMap() maps the network to a target.
function seedSite(name, network) {
  const s = rdb.createSite({ name });
  rdb.setSiteMerakiCode(s.id, network);
  return s.id;
}

// A fake Meraki client: orgNetworks() only — events are injected via deps.fetchAllNetworkEvents
// so the backward-paging path (already covered elsewhere) isn't under test here.
function fakeClient(networks) {
  return { orgNetworks: async () => networks };
}

const CFG = { meraki_api_key: 'k', meraki_org_id: 'o' }; // sla_wan_config omitted → parsed defaults

test('down+up on a mapped network → one authoritative outage upserted (source=meraki_event, isp)', async () => {
  const siteId = seedSite('WANEVT Site A', 'WANEVT-NET-A');
  const events = {
    N1: [
      { type: 'wan_1_down', occurredAt: '2026-08-10T08:00:00Z', deviceSerial: 'Q2-AA' },
      { type: 'wan_1_up',   occurredAt: '2026-08-10T08:30:00Z', deviceSerial: 'Q2-AA' },
    ],
  };
  const res = await ingester.main({
    rdb,
    getConfig: async () => CFG,
    client: fakeClient([{ id: 'N1', name: 'WANEVT-NET-A' }]),
    fetchAllNetworkEvents: async (_c, { networkId }) => events[networkId] || [],
  });
  assert.equal(res.ok, true);
  assert.equal(res.outages, 1);
  assert.equal(res.reconciled, 0, 'nothing provisional to reconcile');
  const rows = await rdb.getWanOutages({ site_id: siteId });
  assert.equal(rows.length, 1);
  const o = rows[0];
  assert.equal(o.uplink, 'wan1');
  assert.equal(o.source, 'meraki_event');
  assert.equal(o.attribution, 'isp');
  assert.equal(o.detected_start, '2026-08-10T08:00:00Z');
  assert.equal(o.restored_end, '2026-08-10T08:30:00Z');
  assert.equal(o.duration_s, 1800, '30 min = 1800 s');
  assert.equal(o.network_id, 'N1');
  assert.equal(o.device_serial, 'Q2-AA');
});

test('a pre-existing open provisional row is reconciled in place (no dup, notified_at preserved)', async () => {
  const siteId = seedSite('WANEVT Site B', 'WANEVT-NET-B');
  // The poller left an OPEN provisional row (source meraki_status) with a notification stamp,
  // detected slightly before the event-log down (within the 60-min tolerance window).
  await rdb.upsertWanOutage({
    site_id: siteId, sub_site: '', uplink: 'wan1', source: 'meraki_status',
    detected_start: '2026-08-11T07:59:00Z', restored_end: null,
    notified_at: '2026-08-11T08:05:00Z',
  });
  const events = {
    N2: [
      { type: 'wan_1_down', occurredAt: '2026-08-11T08:00:00Z', deviceSerial: 'Q2-BB' },
      { type: 'wan_1_up',   occurredAt: '2026-08-11T08:45:00Z', deviceSerial: 'Q2-BB' },
    ],
  };
  const res = await ingester.main({
    rdb,
    getConfig: async () => CFG,
    client: fakeClient([{ id: 'N2', name: 'WANEVT-NET-B' }]),
    fetchAllNetworkEvents: async (_c, { networkId }) => events[networkId] || [],
  });
  assert.equal(res.ok, true);
  assert.equal(res.reconciled, 1, 'the provisional row was upgraded');
  const rows = await rdb.getWanOutages({ site_id: siteId });
  assert.equal(rows.length, 1, 'reconciled in place — NOT a second row');
  const o = rows[0];
  assert.equal(o.source, 'meraki_event', 'upgraded to authoritative');
  assert.equal(o.detected_start, '2026-08-11T08:00:00Z', 'PK detected_start upgraded to the event time');
  assert.equal(o.restored_end, '2026-08-11T08:45:00Z');
  assert.equal(o.duration_s, 2700, '45 min = 2700 s');
  assert.equal(o.notified_at, '2026-08-11T08:05:00Z', 'poller-owned notified_at preserved');
  // No longer open.
  const open = await rdb.listOpenWanOutages();
  assert.ok(!open.find(r => r.site_id === siteId), 'closed after reconcile');
});

test('unconfigured (no meraki_api_key) → {skipped:true}, nothing written', async () => {
  const siteId = seedSite('WANEVT Site C', 'WANEVT-NET-C');
  const res = await ingester.main({
    rdb,
    getConfig: async () => ({}),
    client: fakeClient([{ id: 'N3', name: 'WANEVT-NET-C' }]),
    fetchAllNetworkEvents: async () => [
      { type: 'wan_1_down', occurredAt: '2026-08-12T08:00:00Z' },
      { type: 'wan_1_up',   occurredAt: '2026-08-12T08:30:00Z' },
    ],
  });
  assert.equal(res.skipped, true);
  const rows = await rdb.getWanOutages({ site_id: siteId });
  assert.equal(rows.length, 0, 'skip wrote nothing');
});

test('a throwing client → {ok:false}, prior rows intact', async () => {
  const siteId = seedSite('WANEVT Site D', 'WANEVT-NET-D');
  // Seed a row that must survive the failed run untouched.
  await rdb.upsertWanOutage({
    site_id: siteId, sub_site: '', uplink: 'wan1', source: 'meraki_status',
    detected_start: '2026-08-13T08:00:00Z', restored_end: null, notified_at: '2026-08-13T08:01:00Z',
  });
  const res = await ingester.main({
    rdb,
    getConfig: async () => CFG,
    client: { orgNetworks: async () => { throw new Error('boom'); } },
    fetchAllNetworkEvents: async () => [],
  });
  assert.equal(res.ok, false);
  assert.ok(res.error, 'error surfaced');
  const rows = await rdb.getWanOutages({ site_id: siteId });
  assert.equal(rows.length, 1, 'prior row intact');
  assert.equal(rows[0].source, 'meraki_status', 'untouched — still provisional');
  assert.equal(rows[0].notified_at, '2026-08-13T08:01:00Z');
});
