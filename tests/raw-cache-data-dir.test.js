'use strict';
// C-27 follow-up — the raw ticket cache file honours SDP_DATA_DIR like every other data file.
// Before: server.js hard-coded <repo>/data/raw_cache.json, so a browser journey booted on its own
// throwaway SDP_DATA_DIR read another run's cached tickets (U3/U4 showed 3 tickets instead of 27).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('server.js resolves raw_cache.json under SDP_DATA_DIR (fallback <repo>/data)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').replace(/\r\n/g, '\n');
  const line = src.split('\n').find((l) => /const _RAW_CACHE_FILE\s*=/.test(l));
  assert.ok(line, '_RAW_CACHE_FILE declaration found');
  assert.match(line, /process\.env\.SDP_DATA_DIR/, 'the cache path reads SDP_DATA_DIR');
  assert.match(line, /path\.join\(__dirname, 'data'\)/, 'fallback stays <repo>/data in production');
});
