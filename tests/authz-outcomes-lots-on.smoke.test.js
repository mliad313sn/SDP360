'use strict';
// P11 round 5 (security seat caveat) — tests/authz-outcomes.smoke.test.js arms every functional *_enabled switch except
// the ones FLAG_KEEP_OFF names, and leaves the non-"_enabled" lot switches at their default: part of the portfolio
// Lots 2–6 surface (ppm_alert_actions_enabled — "alert" is kept off —, ppm_dq_gate_enforced, the ui_* adoption
// switches) was therefore only ever seen as 404. This second pass turns EVERY switch of lots L14 / L15 / L16
// (docs/ops/switch-lots.json) on — outbound / kill-switch keys (ppm_alerts_enabled, alert_external_enabled, *_send_*,
// notifications…) stay off — and probes the governance / external-API / session-policy routes for all 23 personas:
//   1. invariants (anonymous / deactivated / revoked refused, business-only locked, role guards 403);
//   2. no amount sentinel in a non-reader's 2xx body (the recorded committee exception aside);
//   3. a GET cell refused with 401/403 in the baseline snapshot never becomes a pass with the lots on (a lot switch
//      may open a 404 route — its purpose — but never lifts a refusal);
//   4. outcomes equal docs/ops/authz-outcomes-lots-on.json (review, then AUTHZ_OUTCOMES_UPDATE=1 regenerates).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const core = require('./_rbac-matrix-core');

const SNAP = path.join(__dirname, '..', 'docs', 'ops', 'authz-outcomes-lots-on.json');
const LOTS = ['L14', 'L15', 'L16'];
const KEEP_OFF = /send|notify|cron|external|stop|purge|deprovision|sdp_api_write|teams_sla|meridian/;
const SCOPE = (r) => /^\/api\/(governance|v1|odata)\//.test(r.path) || r.path === '/api/reports/auth/me';
let w, out, lotKeys;

before(async () => {
  w = await core.bootWorld({ prefix: 'p05l', outcome: true });
  const lots = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'switch-lots.json'), 'utf8')).lots;
  lotKeys = lots.filter((l) => LOTS.includes(l.id)).flatMap((l) => l.switches || l.keys || []).filter((k) => !KEEP_OFF.test(k)).sort();
  const rc = require('../services/reportConfig');
  await rc.setConfig(w.rdb.db, Object.fromEntries(lotKeys.map((k) => [k, '1'])), 'p05-lots-on');
  const reads = await core.probeOutcomes(w, { filter: (r) => r.method === 'GET' && SCOPE(r) });
  const writes = await core.probeOutcomes(w, { filter: (r) => r.method !== 'GET' && SCOPE(r) });
  out = { ...reads, routes: { ...reads.routes, ...writes.routes }, money: [...reads.money, ...writes.money], moneyKnown: [...reads.moneyKnown, ...writes.moneyKnown].sort(),
    stats: { requests: reads.stats.requests + writes.stats.requests, ms: reads.stats.ms + writes.stats.ms, scanned: reads.stats.scanned, readerHits: reads.stats.readerHits } };
});
after(() => { try { w && w.close(); } catch {} });
const fmt = (v) => `${v.length} violation(s):\n` + v.slice(0, 80).join('\n');

test('every switch of lots L14 / L15 / L16 is armed (outbound / kill-switch keys aside) and the scope was probed', () => {
  console.log(`# lots-on probe: ${lotKeys.length} switches on (${lotKeys.join(', ')}); ${Object.keys(out.routes).length} rows, ${out.stats.requests} requests, ${out.stats.ms} ms`);
  for (const k of ['ppm_alert_actions_enabled', 'ppm_dq_gate_enforced', 'ui_role_landing_profiles', 'ppm_documents_enabled', 'ppm_portfolio_dashboard_v2_enabled']) assert.ok(lotKeys.includes(k), k);
  const api = w.matrix.routes.filter((r) => r.path.startsWith('/api') && SCOPE(r));
  for (const r of api) assert.ok(out.routes[r.key], 'not probed: ' + r.key);
});

test('lots on — outcome invariants hold', () => {
  const v = core.checkOutcomeInvariants(out, w.matrix);
  assert.equal(v.length, 0, fmt(v));
});

test('lots on — no amount sentinel in a non-reader 2xx body (committee exception aside)', () => {
  console.log(`# money scan (lots on): ${out.stats.scanned} non-reader bodies, ${out.stats.readerHits} reader hits, known: ${out.moneyKnown.join(' | ')}`);
  assert.equal(out.money.length, 0, fmt(out.money));
  assert.ok(out.stats.readerHits >= 1, 'positive control: a money reader sees a seeded amount');
});

test('lots on never lift a baseline 401/403 refusal on a GET route (a 404 → pass is the lot opening a route)', () => {
  const base = JSON.parse(fs.readFileSync(core.OUTCOMES_PATH, 'utf8'));
  const col = (p) => base.personas.indexOf(p);
  const lifted = [], opened = [];
  for (const [k, codes] of Object.entries(out.routes)) {
    if (!k.startsWith('GET ')) continue;
    const b = base.routes[k]; if (!b) continue;
    out.personas.forEach((p, i) => {
      const was = b[col(p)], now = codes[i];
      if (was === undefined || was === 'S' || now === 'S') return;
      if ((was === 'U' || was === 'F') && core.PASS.has(now)) lifted.push(`${k} as ${p}: ${was} → ${now}`);
      else if (was === 'N' && core.PASS.has(now)) opened.push(`${k} as ${p}`);
    });
  }
  if (opened.length) console.log(`# GET cells opened by the lots (404 → pass, review list): ${opened.length}\n# ` + opened.slice(0, 60).join('\n# '));
  assert.equal(lifted.length, 0, fmt(lifted));
});

test('lots-on outcomes equal docs/ops/authz-outcomes-lots-on.json (regenerate after review)', () => {
  const text = core.serializeOutcomes(out, { schema: 'sdp360.authz-outcomes-lots-on/1', generated_by: 'AUTHZ_OUTCOMES_UPDATE=1 node --test tests/authz-outcomes-lots-on.smoke.test.js',
    world: `bootWorld + every switch of ${LOTS.join('/')} on (${lotKeys.join(', ')}); outbound / kill-switch keys off; governance, /api/v1, /odata and /api/reports/auth/me routes only` });
  if (process.env.AUTHZ_OUTCOMES_UPDATE === '1') fs.writeFileSync(SNAP, text);
  assert.ok(fs.existsSync(SNAP), 'snapshot missing — AUTHZ_OUTCOMES_UPDATE=1');
  const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  assert.deepEqual(snap.personas, out.personas);
  const d = core.diffOutcomes(snap.routes, out.routes, out.personas);
  assert.equal(d.widen.length, 0, 'ACCESS WIDENED vs lots-on snapshot:\n' + d.widen.slice(0, 80).join('\n'));
  assert.deepStrictEqual({ narrow: d.narrow, added: d.added, removed: d.removed }, { narrow: [], added: [], removed: [] }, 'drift — review, then AUTHZ_OUTCOMES_UPDATE=1');
});
