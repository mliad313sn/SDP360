'use strict';
// SDP-DASH-2.0 step 5 — server.js is being split into routes/*.js (target < 3,000 lines).
// This ratchet keeps the size from creeping back up: a new route goes in a routes/ module,
// never in server.js. When an extraction lands, LOWER the ceiling to the new size.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CEILING = 2700;   // 2026-10-22: 5,346 → 2,665 (lot 5.4: survey, zohoData, ai, tracker) — study target < 3,000 reached
const TARGET  = 3000;   // study SDP-DASH-2.0 §6.3 step 5, acceptance criterion

test('server.js does not grow back (routes go in routes/*.js)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').replace(/\r\n/g, '\n');
  const lines = src.split('\n').length;
  assert.ok(lines <= CEILING, `server.js has ${lines} lines, ceiling ${CEILING} — put new routes in routes/*.js`);
  if (lines < CEILING - 300) console.log(`[server-size] ${lines} lines: lower CEILING in this test (target ${TARGET}).`);
});

test('every routes/*.js module is mounted by server.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const mods = fs.readdirSync(path.join(__dirname, '..', 'routes')).filter(f => f.endsWith('.js'));
  for (const f of mods) {
    const name = f.replace(/\.js$/, '');
    assert.ok(src.includes(`require('./routes/${name}')`), `routes/${f} is never mounted in server.js`);
  }
});
