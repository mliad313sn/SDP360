// tests/assets-fetchall.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fetchAll } = require('../assets-sync');

// The API returns ALL rows, ignoring maxRows (recon fact). The stub models that.
const makeFetch = (total) => async () => ({
  rows: Array.from({ length: total }, (_, i) => ({ id: i })),
});

test('returns every row the API sends (maxRows is not a ceiling the API honours)', async () => {
  const rows = await fetchAll('v', makeFetch(4995), { hardCap: 50000 });
  assert.strictEqual(rows.length, 4995);
});

test('throws only if a view blows past the hard sanity cap (data-gone-wrong)', async () => {
  await assert.rejects(() => fetchAll('v', makeFetch(60000), { hardCap: 50000 }),
    /hard cap|unexpectedly large/i);
});

test('propagates a fetch error (never swallows it — a timeout must NOT store a partial)', async () => {
  await assert.rejects(() => fetchAll('v', async () => { throw new Error('zoho timeout'); }),
    /zoho timeout/);
});
