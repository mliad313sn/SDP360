'use strict';
// A0 — SAFETY NET: site perimeter, frozen periods and server-side timestamps, on real objects of two sites
// (A = Hounde/HGO, B = Sabodala/SGO). Harness: tests/_rbac-matrix-core.js (shared with the mutation test).
//   1 editor writes / reads only its own site's reports, follow-ups, PVs, issues, actions, inspections, portfolio
//     plans and tracker cells; the admin tier is unscoped; a site-less editor is NOT global;
//   5 a submitted report is frozen below super_admin; closed tracker months keep their stored value;
//   6 a PV signature timestamp is the server's, never the client's.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const core = require('./_rbac-matrix-core');

let w;
before(async () => { w = await core.bootWorld({ prefix: 'a0s' }); });
after(() => { try { w && w.close(); } catch {} });
const fmt = (v) => `${v.length} violation(s):\n` + v.join('\n');

test('invariant 1 — site perimeter: cross-site writes/reads refused on every module; admin tier unscoped; site-less editor not global', async () => {
  const v = await core.checkSitePerimeter(w);
  assert.equal(v.length, 0, fmt(v));
});

test('invariant 5 — frozen periods: submitted report (super_admin only) and closed tracker months', async () => {
  const v = await core.checkFrozen(w);
  assert.equal(v.length, 0, fmt(v));
});

test('invariant 6 — server-side timestamps: a client-supplied signature time is never stored', async () => {
  const v = await core.checkServerTimestamps(w);
  assert.equal(v.length, 0, fmt(v));
});
