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

// ── E4 (remediation 2026-10-20) — verified TLS by default, CA bundle honoured, key redacted ──
const { redactUrl, optionsFromConfig } = require('../services/opmanagerClient');

test('E4: TLS verification is ON by default (no insecure agent attached)', async () => {
  const calls = [];
  const c = makeOpmanagerClient({ apiKey: 'K', baseUrl: 'https://opm:8061', get: fakeGet(calls, {}) });
  await c.listDevices({});
  assert.equal(calls[0].opts.httpsAgent, undefined, 'default must not relax certificate checks');
  assert.equal(c.tlsInsecure, false);
  assert.equal(optionsFromConfig({}).tlsInsecure, false, 'an absent config key is verified, never insecure');
  assert.equal(optionsFromConfig({ opmanager_tls_insecure: '1' }).tlsInsecure, true);
});

test('E4: the CA bundle is passed as `ca` on the https agent, with rejectUnauthorized untouched', async () => {
  const calls = [];
  const pem = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n';
  const c = makeOpmanagerClient({ apiKey: 'K', baseUrl: 'https://opm:8061', caBundle: pem, get: fakeGet(calls, {}) });
  await c.listDevices({});
  const agent = calls[0].opts.httpsAgent;
  assert.ok(agent, 'an agent carries the CA');
  assert.equal(agent.options.ca, pem);
  assert.notEqual(agent.options.rejectUnauthorized, false, 'a CA bundle never disables verification');
  assert.equal(c.hasCaBundle, true);
});

test('E4: a transport failure never leaks the API key (message, stack, config)', async () => {
  const KEY = 'sup3r-s3cret-k3y';
  const boom = async (url) => {
    const e = new Error(`Request failed: GET ${url}?apiKey=${KEY}&rows=1000 → 401 (key ${KEY} rejected)`);
    e.config = { url: `${url}?apiKey=${KEY}` }; e.request = { path: `/x?apiKey=${KEY}` }; e.response = { status: 401, config: e.config };
    throw e;
  };
  const c = makeOpmanagerClient({ apiKey: KEY, baseUrl: 'https://opm:8061', get: boom });
  await assert.rejects(async () => c.listDevices({}), (e) => {
    assert.ok(!e.message.includes(KEY), 'key must not be in e.message');
    assert.ok(e.message.includes('<key>'), 'the key is replaced by <key>, not just dropped');
    assert.ok(!String(e.stack).includes(KEY), 'nor in the stack');
    assert.equal(e.config, undefined); assert.equal(e.request, undefined);
    assert.equal(e.status, 401);
    return true;
  });
});

test('E4: redactUrl masks apiKey params (plain or URL-encoded) and the raw key value', () => {
  assert.equal(redactUrl('https://o/api?apiKey=abc&rows=5'), 'https://o/api?apiKey=<key>&rows=5');
  assert.equal(redactUrl('https://o/api?rows=5&api_key=abc'), 'https://o/api?rows=5&api_key=<key>');
  assert.equal(redactUrl('token a b/c failed', 'a b/c'), 'token <key> failed');
  assert.equal(redactUrl('token a%20b%2Fc failed', 'a b/c'), 'token <key> failed');
  assert.equal(redactUrl(null, 'x'), null);
});
