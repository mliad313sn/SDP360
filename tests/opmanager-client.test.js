'use strict';
// V1b-B Task 2 — read-only OpManager REST client. Injectable transport, no network.
const { test } = require('node:test');
const assert = require('node:assert');
const { makeOpmanagerClient, _pluck } = require('../services/opmanagerClient');

function fakeGet(calls, data) {
  return async (url, opts) => { calls.push({ url, opts }); return { data }; };
}

test('listDevices shapes the request (path, apiKey HEADER not URL, rows/page)', async () => {
  const calls = [];
  const c = makeOpmanagerClient({ apiKey: 'K', baseUrl: 'https://opm:8061', get: fakeGet(calls, { listDevices: [{ id: 1 }], records: 1 }) });
  await c.listDevices({ rows: 100, page: 2, category: 'Meraki Security' });
  const { url, opts } = calls[0];
  assert.match(url, /\/api\/json\/v2\/device\/listDevices$/);
  assert.equal(opts.headers.apiKey, 'K', 'step 4: the key travels in a header');
  assert.equal(opts.params.apiKey, undefined, 'never in the URL');
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

test('tls-insecure attaches an https agent that rejects nothing — and warns', async () => {
  const calls = [], warned = [];
  const c = makeOpmanagerClient({ apiKey: 'K', baseUrl: 'https://opm:8061', tlsInsecure: true, get: fakeGet(calls, {}), warn: m => warned.push(m) });
  await c.listDevices({});
  assert.ok(calls[0].opts.httpsAgent && calls[0].opts.httpsAgent.options.rejectUnauthorized === false);
  assert.equal(warned.length, 1);
});

test('step 4: TLS is verified by default; the legacy query-string key is opt-in; config mapping', async () => {
  const { optionsFromConfig } = require('../services/opmanagerClient');
  const calls = [];
  const c = makeOpmanagerClient({ apiKey: 'K', baseUrl: 'https://opm:8061', get: fakeGet(calls, {}) });
  await c.listDevices({});
  assert.equal(calls[0].opts.httpsAgent, undefined, 'default agent = Node verification');
  const legacy = makeOpmanagerClient({ apiKey: 'K', baseUrl: 'https://opm:8061', keyInQuery: true, get: fakeGet(calls, {}) });
  await legacy.listDevices({});
  assert.equal(calls[1].opts.params.apiKey, 'K');
  assert.deepEqual(optionsFromConfig({ opmanager_api_key: 'K', opmanager_base_url: 'u', opmanager_tls_insecure: '0', opmanager_ca_file: 'ca.pem' }),
    { apiKey: 'K', baseUrl: 'u', tlsInsecure: false, caFile: 'ca.pem', keyInQuery: false });
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
