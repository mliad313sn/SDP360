'use strict';
// G00 — the generated inventory (docs/agent-execution/INVENTORY.json) matches the code, ids are stable and
// unique, and the extractor recognises the route shapes used in this repository.
const test = require('node:test');
const assert = require('node:assert');
const inv = require('../tools/agent/inventory');
const committed = require('../docs/agent-execution/INVENTORY.json');

test('committed inventory is up to date with the code', () => {
  assert.strictEqual(inv.comparable(committed), inv.comparable(inv.build()), 'run node tools/agent/inventory.js and commit');
});

test('ids are unique per declaring file and derived from content, not position', () => {
  const keys = committed.routes.map((r) => r.id + '@' + r.file);
  assert.strictEqual(new Set(keys).size, keys.length);
  for (const p of committed.pages) assert.match(p.id, /^PG-[a-z0-9-]+$/);
  for (const r of committed.routes) assert.match(r.id, /^RT-(GET|POST|PUT|PATCH|DELETE)-[a-z0-9-]*$/);
});

test('literal prefix stops at the first parameter', () => {
  assert.strictEqual(inv.literalPrefix('/api/reports/:id/infra'), '/api/reports');
  assert.strictEqual(inv.literalPrefix('/api/sync/health'), '/api/sync/health');
});

test('every page declares a role, or is on the reviewed list of pages that need none', () => {
  // Reviewed 2026-10-29 (G00): redirect stubs, a server-gated planning page, and the site report whose own
  // API calls require the session (it deliberately loads no auth.js — see the comment in the page).
  const REVIEWED = {
    'public/assets-finance.html': 'redirect stub to assets.html#finance',
    'public/assets-hygiene.html': 'redirect stub to assets.html#hygiene',
    'public/wan-health.html': 'redirect stub to wan.html#health',
    'public/wan-sla.html': 'redirect stub to wan.html',
    'public/itsm-integrations-plan.html': 'server route redirects anonymous users to login',
    'public/site-report.html': 'data via /api/reports/site-data (session required)',
  };
  const unknown = committed.pages.filter((p) => p.requires[0] === 'UNKNOWN').map((p) => p.page).sort();
  assert.deepStrictEqual(unknown, Object.keys(REVIEWED).sort(), 'a new page must declare data-require or be reviewed here');
});
