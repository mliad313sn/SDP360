'use strict';
// V1b-B Task 2 — read-only OpManager REST client. Injectable transport, no network.
const { test } = require('node:test');
const assert = require('node:assert');
const { makeOpmanagerClient, _pluck } = require('../services/opmanagerClient');

function fakeGet(calls, data) {
  return async (url, opts) => { calls.push({ url, opts }); return { data }; };
}

test('listDevices shapes the request (path, apiKey param, rows/page)', async () => {
  const calls = [];
  const c = makeOpmanagerClient({ apiKey: 'K', baseUrl: 'https://opm:8061', get: fakeGet(calls, { listDevices: [{ id: 1 }], records: 1 }) });
  await c.listDevices({ rows: 100, page: 2, category: 'Meraki Security' });
  const { url, opts } = calls[0];
  assert.match(url, /\/api\/json\/v2\/device\/listDevices$/);
  assert.equal(opts.params.apiKey, 'K');
  assert.equal(opts.params.rows, 100);
  assert.equal(opts.params.page, 2);
  assert.equal(opts.params.category, 'Meraki Security');
});

test('getDeviceCompleteDetails passes name', async () => {
  const calls = [];
  const c = makeOpmanagerClient({ apiKey: 'K', baseUrl: 'https://opm:8061', get: fakeGet(calls, { availdata: { Up: 99 } }) });
  await c.getDeviceCompleteDetails({ name: 'HGO-SW-01' });
  assert.match(calls[0].url, /\/api\/json\/v2\/device\/getDeviceCompleteDetails$/);
  assert.equal(calls[0].opts.params.name, 'HGO-SW-01');
});

test('tls-insecure attaches an https agent that rejects nothing', async () => {
  const calls = [];
  const c = makeOpmanagerClient({ apiKey: 'K', baseUrl: 'https://opm:8061', tlsInsecure: true, get: fakeGet(calls, {}) });
  await c.listDevices({});
  assert.ok(calls[0].opts.httpsAgent, 'httpsAgent attached for self-signed cert');
});

test('inert without apiKey/baseUrl (returns []/null, no call)', async () => {
  const calls = [];
  const c = makeOpmanagerClient({ apiKey: '', baseUrl: '', get: fakeGet(calls, {}) });
  assert.deepEqual(await c.listDevices({}), []);
  assert.strictEqual(await c.getDeviceCompleteDetails({ name: 'X' }), null);
  assert.equal(calls.length, 0);
});

test('_pluck returns the first array-valued property of the envelope', () => {
  assert.deepEqual(_pluck({ listDevices: [{ id: 1 }], records: 1 }), [{ id: 1 }]);
  assert.deepEqual(_pluck([{ id: 2 }]), [{ id: 2 }]);   // already an array
  assert.deepEqual(_pluck({ records: 0 }), []);          // no array property
  assert.deepEqual(_pluck(null), []);
});
