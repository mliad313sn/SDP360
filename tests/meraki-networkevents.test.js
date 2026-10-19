'use strict';
// V1b WAN-SLA — merakiClient.networkEvents (paginated) + fetchAllNetworkEvents cursor helper.
// Unlike the other 5 read methods (which return a bare array), /networks/{id}/events returns a
// PAGINATED OBJECT { events:[...], pageStartAt, pageEndAt }. The cursor helper walks it backward.
const test = require('node:test');
const assert = require('node:assert');
const { makeMerakiClient, fetchAllNetworkEvents } = require('../services/merakiClient');

// A stubbed transport that returns pre-canned responses per call.
function stubGet(pages) {
  let i = 0;
  return async () => {
    const data = i < pages.length ? pages[i] : { events: [], pageStartAt: null };
    i += 1;
    return { data };
  };
}

test('networkEvents returns the paginated object wrapper (not a bare array)', async () => {
  const client = makeMerakiClient({
    apiKey: 'k', orgId: 'o',
    get: stubGet([{ events: [{ id: 1 }, { id: 2 }], pageStartAt: '2026-08-01T00:00:00Z', pageEndAt: '2026-08-02T00:00:00Z' }]),
  });
  const res = await client.networkEvents({ networkId: 'N_1' });
  assert.ok(res && typeof res === 'object' && !Array.isArray(res), 'result is an object wrapper, not an array');
  assert.ok(Array.isArray(res.events), 'wrapper carries an events array');
  assert.strictEqual(res.events.length, 2);
});

test('fetchAllNetworkEvents pages through 2 pages + empty → concatenated events, stops', async () => {
  const pages = [
    { events: [{ id: 1 }, { id: 2 }], pageStartAt: '2026-08-05T00:00:00Z' },
    { events: [{ id: 3 }, { id: 4 }], pageStartAt: '2026-08-03T00:00:00Z' },
    { events: [], pageStartAt: '2026-08-03T00:00:00Z' },
  ];
  const client = makeMerakiClient({ apiKey: 'k', orgId: 'o', get: stubGet(pages) });
  const all = await fetchAllNetworkEvents(client, { networkId: 'N_1' });
  assert.strictEqual(all.length, 4, 'concatenated all events across both non-empty pages');
  assert.deepStrictEqual(all.map((e) => e.id), [1, 2, 3, 4]);
});

test('unconfigured client (no apiKey) → fetchAllNetworkEvents returns [] without throwing', async () => {
  const client = makeMerakiClient({}); // inert: _get returns []
  const all = await fetchAllNetworkEvents(client, { networkId: 'N_1' });
  assert.deepStrictEqual(all, [], 'empty guard: falsy/array page → [] not a throw');
});
