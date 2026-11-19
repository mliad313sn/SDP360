'use strict';
// P02 — authorization OUTCOME assurance. The route × role sweep (tests/rbac-matrix.smoke.test.js) proves routes whose
// rule is a guard; ~460 session-gated routes decide inside the handler. This file probes EVERY method of EVERY /api
// route for 23 personas (anonymous, deactivated, revoked, viewer A, editor A / A+B / site-less, each feature role
// alone, business-only, admin, executive, super_admin) plus site-B object ids for site-A personas, then:
//   1. checks invariants that hold whatever the snapshot says (anonymous / deactivated / revoked refused, business-only
//      locked, role guards refuse with 403, no amount sentinel in a non-reader's 2xx body);
//   2. compares the outcome map with the committed docs/ops/authz-outcomes.json: a refusal that becomes a pass is a
//      WIDENING and fails; a pass that becomes a refusal fails too (review it, then regenerate):
//        AUTHZ_OUTCOMES_UPDATE=1 node --test tests/authz-outcomes.smoke.test.js   → review git diff docs/ops/authz-outcomes.json
// Harness: tests/_rbac-matrix-core.js (probeOutcomes, diffOutcomes, checkOutcomeInvariants).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const core = require('./_rbac-matrix-core');

let w, out, swRead, swWrite;
// AUTHZ_OUTCOMES_ONLY=<regexp on the route key> narrows the probe (mutation control, local triage). Coverage, switch
// and completeness assertions are skipped then; the snapshot comparison covers the probed rows only (widenings only).
const ONLY = process.env.AUTHZ_OUTCOMES_ONLY ? new RegExp(process.env.AUTHZ_OUTCOMES_ONLY) : null;
const inOnly = (r) => !ONLY || ONLY.test(r.key);
before(async () => {
  w = await core.bootWorld({ prefix: 'p02o', outcome: true });
  // Fixed order (deterministic snapshot): GET baseline → read-phase switches → write-phase switches (no DELETE) →
  // write baseline (DELETE last). Switch outcomes are compared with the baseline afterwards.
  const reads = await core.probeOutcomes(w, { filter: (r) => r.method === 'GET' && inOnly(r) });
  const readRuns = ONLY ? [] : await core.runSwitches(w, 'read');
  const writeRuns = ONLY ? [] : await core.runSwitches(w, 'write');
  const writes = await core.probeOutcomes(w, { filter: (r) => r.method !== 'GET' && inOnly(r) });
  out = { ...reads, routes: { ...reads.routes, ...writes.routes }, money: [...reads.money, ...writes.money], moneyKeys: reads.moneyKeys, moneyKnown: [...reads.moneyKnown, ...writes.moneyKnown].sort(),
    unscanned: [...reads.unscanned, ...writes.unscanned],
    stats: { requests: reads.stats.requests + writes.stats.requests, retries: reads.stats.retries + writes.stats.retries, ms: reads.stats.ms + writes.stats.ms, scanned: reads.stats.scanned, readerHits: reads.stats.readerHits } };
  swRead = core.compareSwitches(out, readRuns);
  swWrite = core.compareSwitches(out, writeRuns);
});
after(() => { try { w && w.close(); } catch {} });

const fmt = (v) => `${v.length} violation(s):\n` + v.slice(0, 80).join('\n');

test('probe covers every method of every /api route for all 23 personas', () => {
  const api = w.matrix.routes.filter((r) => r.path.startsWith('/api'));
  console.log(`# outcome probe: ${Object.keys(out.routes).length} rows (${api.length} routes + site-B rows), ${out.personas.length} personas, ${out.stats.requests} requests (${out.stats.retries} transport retries), ${out.stats.ms} ms`);
  assert.equal(out.personas.length, 23);
  if (ONLY) return;
  for (const r of api) assert.ok(out.routes[r.key], 'not probed: ' + r.key);
  assert.ok(Object.keys(out.routes).some((k) => k.endsWith(' [B]')), 'site-B object rows present');
});

test('outcome invariants: anonymous / deactivated / revoked refused, business-only locked, role guards answer 403', () => {
  const v = core.checkOutcomeInvariants(out, w.matrix);
  assert.equal(v.length, 0, fmt(v));
});

test('amounts: no amount sentinel in a 2xx body (JSON, xlsx, pptx) served to a non-money persona (known committee exception aside)', () => {
  if (out.unscanned.length) console.log('# unscanned binary 2xx bodies: ' + out.unscanned.join(', '));
  console.log(`# money scan: ${out.stats.scanned} non-reader 2xx bodies scanned, ${out.stats.readerHits} reader bodies carry a sentinel (positive control), known exception hits: ${out.moneyKnown.join(' | ')}`);
  if (out.moneyKeys.length) console.log('# money-named keys with a non-zero value in non-reader 2xx JSON (review list): ' + out.moneyKeys.join(' | '));
  assert.equal(out.money.length, 0, fmt(out.money));
  if (ONLY) return;
  assert.ok(out.stats.readerHits >= 5, 'positive control: money readers must see the seeded amounts (scan not vacuous)');
  // the recorded committee exception still reproduces — when the policy is decided, update KNOWN_OUTCOME_MONEY
  assert.ok(out.moneyKnown.some((x) => /committee-member/.test(x)), 'committee money exception no longer reproduces — policy decided? update KNOWN_OUTCOME_MONEY + docs');
});

test('outcomes equal the committed snapshot docs/ops/authz-outcomes.json (a widening fails; regenerate after review)', () => {
  const text = core.serializeOutcomes(out);
  if (process.env.AUTHZ_OUTCOMES_UPDATE === '1' && !ONLY) fs.writeFileSync(core.OUTCOMES_PATH, text);
  const snap = JSON.parse(fs.readFileSync(core.OUTCOMES_PATH, 'utf8'));
  assert.deepEqual(snap.personas, out.personas, 'persona columns changed — regenerate');
  const base = ONLY ? Object.fromEntries(Object.entries(snap.routes).filter(([k]) => k in out.routes)) : snap.routes;
  if (ONLY && process.env.AUTHZ_OUTCOMES_UPDATE === '1') throw new Error('AUTHZ_OUTCOMES_UPDATE needs the full probe (unset AUTHZ_OUTCOMES_ONLY)');
  const d = core.diffOutcomes(base, out.routes, out.personas);
  assert.equal(d.widen.length, 0, 'ACCESS WIDENED vs snapshot:\n' + d.widen.slice(0, 80).join('\n'));
  if (ONLY) { if (d.narrow.length) console.log('# narrowed (state of a partial run, not failing): ' + d.narrow.length); return; }
  assert.deepEqual({ narrow: d.narrow, added: d.added, removed: d.removed }, { narrow: [], added: [], removed: [] }, 'outcome drift — review, then AUTHZ_OUTCOMES_UPDATE=1');
});

test('step 4 — each authorization switch narrows access or leaves it; it never widens it (declared purposes aside)', () => {
  if (ONLY) return;
  const report = [...swRead.report, ...swWrite.report];
  console.log('# switches: ' + JSON.stringify(report));
  assert.equal(report.length, core.AUTHZ_SWITCHES.length, 'every authorization switch was run');
  for (const r of report) assert.ok(r.rows > 0 && r.requests > 0, 'switch run not vacuous: ' + r.switch);
  const v = [...swRead, ...swWrite];
  assert.equal(v.length, 0, fmt(v));
});
