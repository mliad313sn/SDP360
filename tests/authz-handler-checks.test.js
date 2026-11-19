'use strict';
// P02 — the declared in-handler decision of every session-gated route without a role guard
// (docs/ops/authz-handler-checks.json, merged into docs/ops/authz-matrix.json as `handler_check`) is held to evidence:
//   1. coverage: every such route is declared, no stale declaration, every class is known, a 'none' carries a reason;
//   2. static evidence: a route whose handler chain (incl. path wrappers) shows a role / site / ownership / switch
//      signal may not be declared 'none' (tools/agent/authz-handler-classify.js);
//   3. runtime evidence: a route declared 'none' gives the SAME outcome class (refusal vs pass) to every active
//      signed-in non-business persona in the committed outcome snapshot docs/ops/authz-outcomes.json.
// Regenerate the draft for new routes: node tools/agent/authz-handler-classify.js --write, then review the entries.
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const walker = require('../tools/agent/authz-walk');
const cls = require('../tools/agent/authz-handler-classify');

let app;
function boot() { if (!app) { const log = console.log; console.log = () => {}; try { app = require('../server').app; } finally { console.log = log; } } return app; }
const decl = () => cls.load();

test('coverage: every session-gated route without a role guard is declared; no stale entry; reasons for none', () => {
  const routes = cls.inScope(boot(), walker).map((r) => r.key);
  const d = decl();
  assert.equal(d.schema, 'sdp360.authz-handler-checks/1');
  assert.deepEqual(routes.filter((k) => !d.routes[k]), [], 'undeclared — run node tools/agent/authz-handler-classify.js --write and review');
  assert.deepEqual(Object.keys(d.routes).filter((k) => !routes.includes(k)), [], 'stale declarations');
  for (const [k, v] of Object.entries(d.routes)) {
    for (const c of v.checks) assert.ok(cls.CLASSES.includes(c), `${k}: unknown class ${c}`);
    if (!v.checks.length) assert.ok(v.reviewed && String(v.note || '').length >= 20, `${k}: 'none' needs a reviewed one-line justification`);
  }
  const m = JSON.parse(fs.readFileSync(walker.MATRIX_JSON_PATH, 'utf8'));
  assert.deepEqual(m.routes.filter((r) => (r.handler_check || []).includes('UNDECLARED')).map((r) => r.key), []);
  assert.equal(m.routes.filter((r) => r.handler_check).length, routes.length, 'matrix carries handler_check for every in-scope route');
});

test('static evidence: no route with a role / site / ownership / switch signal is declared none', () => {
  const d = decl();
  const bad = [];
  for (const r of cls.inScope(boot(), walker)) {
    const sig = cls.staticSignals(r, walker, boot());
    const e = d.routes[r.key];
    if (e && !e.checks.length && sig.length) bad.push(`${r.key}: declared none but handler shows ${sig.join('+')}`);
    if (e && e.checks.length && !e.reviewed) for (const c of sig) if (!e.checks.includes(c)) bad.push(`${r.key}: unreviewed entry misses static signal ${c}`);
  }
  assert.deepEqual(bad, []);
});

test('runtime evidence: a route declared none treats every active signed-in non-business persona alike', () => {
  const snap = JSON.parse(fs.readFileSync(require('./_rbac-matrix-core').OUTCOMES_PATH, 'utf8'));
  const refusal = new Set(['U', 'F', 'N']);
  const cols = snap.personas.map((p, i) => [p, i]).filter(([p]) => !['anon', 'deact', 'revoked', 'sbizA', 'gbiz'].includes(p));
  const bad = [];
  let checked = 0;
  for (const [k, v] of Object.entries(decl().routes)) {
    if (v.checks.length) continue;
    for (const key of [k, k + ' [B]']) {
      const codes = snap.routes[key]; if (!codes) continue;
      const classes = new Set(cols.map(([, i]) => codes[i]).filter((c) => c !== 'S').map((c) => (refusal.has(c) ? 'refuse' : 'pass')));
      checked++;
      if (classes.size > 1) bad.push(`${key}: declared none but outcomes differ by persona (${cols.map(([p, i]) => p + '=' + codes[i]).join(' ')})`);
    }
  }
  assert.ok(checked >= 50, 'not vacuous: ' + checked);
  assert.deepEqual(bad, []);
});
