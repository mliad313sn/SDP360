'use strict';
// V1b-A Task 2 — read-only Meraki REST client. Injectable transport (`get`) → no network
// in tests. Asserts URL shaping, the API-key header, query params, and inert-when-unconfigured.
const { test } = require('node:test');
const assert = require('node:assert');
const { makeMerakiClient } = require('../services/merakiClient');

function fakeGet(calls, data = []) {
  return async (url, opts) => { calls.push({ url, opts }); return { data }; };
}

test('deviceLossLatencyHistory shapes the request (path, key header, params)', async () => {
  const calls = [];
  const c = makeMerakiClient({ apiKey: 'K', orgId: 'O', baseUrl: 'https://api.meraki.com/api/v1', get: fakeGet(calls) });
  await c.deviceLossLatencyHistory({ serial: 'Q2-AB', uplink: 'wan1', ip: '8.8.8.8',
    t0: '2026-08-09T00:00:00Z', t1: '2026-08-15T23:59:59Z', resolution: 3600 });
  const { url, opts } = calls[0];
  assert.match(url, /\/devices\/Q2-AB\/lossAndLatencyHistory$/);
  assert.equal(opts.headers['X-Cisco-Meraki-API-Key'], 'K');
  assert.equal(opts.params.uplink, 'wan1');
  assert.equal(opts.params.ip, '8.8.8.8');
  assert.equal(opts.params.resolution, 3600);
  assert.equal(opts.params.t0, '2026-08-09T00:00:00Z');
  assert.ok(!('timespan' in opts.params), 'undefined params are dropped');
});

test('orgUplinkStatuses hits the MX appliance uplink path (v1), with org id + networkIds', async () => {
  const calls = [];
  const c = makeMerakiClient({ apiKey: 'K', orgId: 'O', get: fakeGet(calls) });
  await c.orgUplinkStatuses({ networkIds: ['N1'] });
  // Correct Meraki v1 endpoint is /appliance/uplink/statuses — the bare
  // /uplinks/statuses path 404s (regression: WAN sync failed 404 in prod).
  assert.match(calls[0].url, /\/organizations\/O\/appliance\/uplink\/statuses$/);
  assert.deepEqual(calls[0].opts.params.networkIds, ['N1']);
  assert.equal(calls[0].opts.params.perPage, 1000);
});

test('_get surfaces the failing path + HTTP status on error (404 diagnosis)', async () => {
  const c = makeMerakiClient({ apiKey: 'K', orgId: 'O', get: async () => { const e = new Error('Request failed with status code 404'); e.response = { status: 404 }; throw e; } });
  await assert.rejects(async () => c.orgUplinkStatuses({}), /Meraki GET \/organizations\/O\/appliance\/uplink\/statuses → HTTP 404/);
});

test('orgUplinksLossLatency hits the org devices path', async () => {
  const calls = [];
  const c = makeMerakiClient({ apiKey: 'K', orgId: 'O', get: fakeGet(calls) });
  await c.orgUplinksLossLatency({ serials: ['Q2-AB'] });
  assert.match(calls[0].url, /\/organizations\/O\/devices\/uplinksLossAndLatency$/);
  assert.deepEqual(calls[0].opts.params.serials, ['Q2-AB']);
});

test('returns res.data', async () => {
  const c = makeMerakiClient({ apiKey: 'K', orgId: 'O', get: fakeGet([], [{ serial: 'X' }]) });
  assert.deepEqual(await c.orgUplinkStatuses({}), [{ serial: 'X' }]);
});

test('networkConnectivityDestinations hits the network appliance path', async () => {
  const calls = [];
  const c = makeMerakiClient({ apiKey: 'K', orgId: 'O', get: fakeGet(calls, { destinations: [{ ip: '8.8.8.8', default: true }] }) });
  const r = await c.networkConnectivityDestinations({ networkId: 'N_1' });
  assert.match(calls[0].url, /\/networks\/N_1\/appliance\/connectivityMonitoringDestinations$/);
  assert.deepEqual(r.destinations, [{ ip: '8.8.8.8', default: true }]);
});

test('inert without apiKey/orgId (returns [], no call)', async () => {
  const calls = [];
  const c = makeMerakiClient({ apiKey: '', orgId: '', get: fakeGet(calls) });
  assert.deepEqual(await c.orgUplinkStatuses({}), []);
  assert.deepEqual(await c.deviceLossLatencyHistory({ serial: 'X', uplink: 'wan1', ip: '1.1.1.1' }), []);
  assert.equal(calls.length, 0);
});
