'use strict';
// WAN SLA / ISP chargeback — the 5-min OPEN-OUTAGE poller (tools/meraki/poll-wan-outages.js).
// Detects currently-down WAN uplinks via Meraki orgUplinkStatuses (current state), opens
// provisional wan_outages rows, closes recovered / stale-open rows, and fires the 15-min ISP
// auto-notification — ARMED-OFF by default. Real sqlite rdb via SDP_DATA_DIR temp; fake Meraki
// client + injected mailer spy + injected `now` drive every branch without network/clock.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_p.join(_os.tmpdir(), 'wanpoll-'));
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'wanpoll-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'wanpoll-pass-0000';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');
const { main } = require('../tools/meraki/poll-wan-outages');

// Fresh outage state per test — the recovery sweep is org-wide (any open row not
// currently down is closed), so leftover open rows from a prior test would be
// spuriously closed. Isolate by wiping the outage table before each.
beforeEach(() => { rdb.db.exec('DELETE FROM wan_outages'); });

let _seq = 0;
function seedSite() {
  _seq++;
  const name = `PollSite${_seq}`, network = `PollNet${_seq}`, networkId = `PN${_seq}`;
  const siteId = Number(rdb.db.prepare('INSERT INTO sites (name, active) VALUES (?, 1)').run(name).lastInsertRowid);
  rdb.setSiteMerakiCode(siteId, network);
  return { siteId, network, networkId };
}

// A fake Meraki client reporting ONE device on this site's network with wan1 at `status`.
function makeClient(site, status) {
  return {
    orgNetworks: async () => [{ id: site.networkId, name: site.network }],
    orgUplinkStatuses: async () => [{
      networkId: site.networkId, serial: 'Q2-POLL-0001',
      uplinks: [{ interface: 'wan1', status, label: 'ISP1' }],
    }],
  };
}

function makeMailer() {
  const calls = [];
  return { calls, send: async (msg) => { calls.push(msg); return { ok: true, messageId: 'm' }; } };
}

// getConfig returning a meraki-configured + sla_wan_config blob binding this site's
// wan1 circuit to an ISP with a notify contact.
function getConfig(siteId, { notifyEnabled = false, staleHours = 24 } = {}) {
  const sla = {
    notify: { enabled: notifyEnabled, trigger_minutes: 15 },
    ingest: { stale_open_hours: staleHours },
    tiers: { SILVER: {} },
    circuits: [{
      site_id: siteId, sub_site: '', uplink: 'wan1', tier: 'SILVER',
      isp: 'Orange', circuit_id: 'CID-1', isp_notify_email: 'noc@orange.example',
    }],
  };
  return async () => ({ meraki_api_key: 'k', sla_wan_config: JSON.stringify(sla) });
}

const poll = (site, now, opts, mailer) => main({
  rdb, getConfig: getConfig(site.siteId, opts), client: makeClient(site, opts.status),
  mailer, now,
});

// Warm-spare / dual-MX: two appliances in the SAME network (a master + a warm spare whose
// uplinks read 'not connected'). A (site,uplink) is DOWN only if NO appliance reports it up.
function makeClientTwoDev(site, s1, s2) {
  return {
    orgNetworks: async () => [{ id: site.networkId, name: site.network }],
    orgUplinkStatuses: async () => [
      { networkId: site.networkId, serial: 'Q2-MASTER-01', uplinks: [{ interface: 'wan1', status: s1 }] },
      { networkId: site.networkId, serial: 'Q2-SPARE-02', uplinks: [{ interface: 'wan1', status: s2 }] },
    ],
  };
}

test('warm-spare: master wan1 up + spare wan1 not-connected → NO false outage', async () => {
  const s = seedSite();
  await main({ rdb, getConfig: getConfig(s.siteId, {}), client: makeClientTwoDev(s, 'active', 'not connected'), mailer: makeMailer(), now: '2026-08-10T08:00:00Z' });
  const rows = await rdb.getWanOutages({ site_id: s.siteId });
  assert.equal(rows.length, 0, 'the site uplink is UP because the master reports it up — no outage from the spare');
});

test('dual-MX: BOTH appliances report wan1 down → exactly one real outage', async () => {
  const s = seedSite();
  await main({ rdb, getConfig: getConfig(s.siteId, {}), client: makeClientTwoDev(s, 'failed', 'not connected'), mailer: makeMailer(), now: '2026-08-10T08:00:00Z' });
  const rows = await rdb.getWanOutages({ site_id: s.siteId });
  assert.equal(rows.length, 1, 'a real outage opens only when NO appliance reports the uplink up');
});

test('a down uplink opens exactly ONE provisional row; a 2nd poll while still down opens no second', async () => {
  const s = seedSite();
  const T0 = '2026-08-10T08:00:00Z';
  await poll(s, T0, { status: 'failed' }, makeMailer());
  let rows = await rdb.getWanOutages({ site_id: s.siteId });
  assert.equal(rows.length, 1, 'one provisional row opened');
  assert.equal(rows[0].source, 'meraki_status', 'source is meraki_status');
  assert.equal(rows[0].detected_start, T0, 'detected_start = now');
  assert.equal(rows[0].restored_end, null, 'row is open');
  assert.equal(rows[0].uplink, 'wan1');

  const T1 = '2026-08-10T08:05:00Z';
  await poll(s, T1, { status: 'failed' }, makeMailer());
  rows = await rdb.getWanOutages({ site_id: s.siteId });
  assert.equal(rows.length, 1, 'invariant: no second open row for the same uplink');
  assert.equal(rows[0].detected_start, T0, 'the original detected_start is preserved');
});

test('armed + open ≥15min + contact set → mailer.send once + notified_at stamped; a 2nd poll does NOT re-send', async () => {
  const s = seedSite();
  const T0 = '2026-08-10T08:00:00Z';
  const m0 = makeMailer();
  await poll(s, T0, { status: 'failed', notifyEnabled: true }, m0);
  assert.equal(m0.calls.length, 0, 'no notification at detection (age 0 < 15min)');

  const T1 = '2026-08-10T08:16:00Z';
  const m1 = makeMailer();
  await poll(s, T1, { status: 'failed', notifyEnabled: true }, m1);
  assert.equal(m1.calls.length, 1, 'exactly one notification once continuously down ≥ 15 min');
  assert.equal(m1.calls[0].to, 'noc@orange.example', 'sent to the circuit ISP contact');
  const row = (await rdb.getWanOutages({ site_id: s.siteId }))[0];
  assert.equal(row.notified_at, T1, 'notified_at stamped with now');

  const T2 = '2026-08-10T08:30:00Z';
  const m2 = makeMailer();
  await poll(s, T2, { status: 'failed', notifyEnabled: true }, m2);
  assert.equal(m2.calls.length, 0, 'not re-sent once notified_at is set');
});

test('disarmed (notify.enabled=false) → mailer NEVER called even past 15 min', async () => {
  const s = seedSite();
  const T0 = '2026-08-10T08:00:00Z';
  await poll(s, T0, { status: 'failed', notifyEnabled: false }, makeMailer());
  const T1 = '2026-08-10T09:00:00Z'; // 60 min later
  const m = makeMailer();
  await poll(s, T1, { status: 'failed', notifyEnabled: false }, m);
  assert.equal(m.calls.length, 0, 'armed-OFF default: no send even at 60 min down');
  const row = (await rdb.getWanOutages({ site_id: s.siteId }))[0];
  assert.equal(row.notified_at, null, 'notified_at never stamped when disarmed');
});

test('recovery: an open row whose uplink is now up → closed (restored_end set); mailer NOT called after restore', async () => {
  const s = seedSite();
  const T0 = '2026-08-10T08:00:00Z';
  await poll(s, T0, { status: 'failed', notifyEnabled: true }, makeMailer());
  // 20 min later the uplink is back up — past the 15-min trigger, but a restored row must NEVER notify.
  const T1 = '2026-08-10T08:20:00Z';
  const m = makeMailer();
  await poll(s, T1, { status: 'active', notifyEnabled: true }, m);
  const row = (await rdb.getWanOutages({ site_id: s.siteId }))[0];
  assert.equal(row.restored_end, T1, 'restored_end set on recovery');
  assert.equal(row.duration_s, 1200, '20 min → 1200 s (computed in JS by closeWanOutage)');
  assert.equal(m.calls.length, 0, 'never notify after restore');
  const open = await rdb.listOpenWanOutages();
  assert.ok(!open.find(r => r.site_id === s.siteId), 'recovered outage is no longer open');
});

test('B: an open outage whose device DROPPED from the poll (MX offline) stays OPEN — no false recovery', async () => {
  const s = seedSite();
  const T0 = '2026-08-10T08:00:00Z';
  await poll(s, T0, { status: 'failed' }, makeMailer());              // open
  assert.equal((await rdb.getWanOutages({ site_id: s.siteId }))[0].restored_end, null, 'opened');

  // T1: the appliance is GONE from the org status response (power outage → dropped out entirely).
  const T1 = '2026-08-10T08:05:00Z';
  const goneClient = { orgNetworks: async () => [{ id: s.networkId, name: s.network }], orgUplinkStatuses: async () => [] };
  await main({ rdb, getConfig: getConfig(s.siteId, {}), client: goneClient, mailer: makeMailer(), now: T1 });
  const mid = (await rdb.getWanOutages({ site_id: s.siteId }))[0];
  assert.equal(mid.restored_end, null, 'an UNSEEN uplink is NOT closed — closing on absence would fake a recovery');
  assert.equal(mid.detected_start, T0, 'the original outage is preserved');

  // T2: the uplink is explicitly back up → NOW it closes.
  const T2 = '2026-08-10T08:20:00Z';
  await poll(s, T2, { status: 'active' }, makeMailer());
  const done = (await rdb.getWanOutages({ site_id: s.siteId }))[0];
  assert.equal(done.restored_end, T2, 'closes only on an explicit up reading');
  assert.equal(done.duration_s, 1200, '08:00 → 08:20 = 1200s');
});

test('stale-open guard: a 25h-open still-down row is closed with source "stale_open", and a fresh outage then opens', async () => {
  const s = seedSite();
  const T0 = '2026-08-10T08:00:00Z';
  await poll(s, T0, { status: 'failed' }, makeMailer());
  const T1 = '2026-08-11T09:00:00Z'; // 25h after T0, still down
  await poll(s, T1, { status: 'failed' }, makeMailer());

  const rows = await rdb.getWanOutages({ site_id: s.siteId });
  const stale = rows.find(r => r.detected_start === T0);
  const fresh = rows.find(r => r.detected_start === T1);
  assert.ok(stale, 'the original row is retained (not deleted)');
  assert.equal(stale.source, 'stale_open', 'stale row re-sourced to stale_open');
  assert.equal(stale.restored_end, T1, 'stale row closed so the one-open-row invariant cannot block forever');
  assert.ok(fresh, 'a fresh outage opened for the same uplink after the stale close');
  assert.equal(fresh.source, 'meraki_status');
  assert.equal(fresh.restored_end, null, 'the fresh outage is open');

  const openForSite = (await rdb.listOpenWanOutages()).filter(r => r.site_id === s.siteId);
  assert.equal(openForSite.length, 1, 'exactly one open row — the fresh one');
  assert.equal(openForSite[0].detected_start, T1);
});

test('heartbeat: a successful poll stamps wan_poll_last_run via setConfig (now)', async () => {
  const s = seedSite();
  const stamped = [];
  await main({ rdb, getConfig: getConfig(s.siteId, {}), client: makeClient(s, 'active'), mailer: makeMailer(),
    now: '2026-08-10T08:00:00Z', setConfig: async (kv) => stamped.push(kv) });
  assert.deepEqual(stamped, [{ wan_poll_last_run: '2026-08-10T08:00:00Z' }]);
});
