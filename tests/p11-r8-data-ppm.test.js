'use strict';
// P11 round 8 (fix 34 — data / PPM / security seats) — pure regression pins. AI-written, not a human review.
//   PPM R8-2 / data R8-1  a known high risk beside an unscored one: the score is kept (a known high is never hidden) but
//                         carries partial:true; the RAG risk component says so.
//   data R8-2             a list holding only assumptions scores null (as an empty list), never 0 (green).
//   PPM R8-3 / data R8-3  raid.exposureTotals uses the shared case-insensitive isOpen.
//   PPM R8-4              the RAID writer normalises status / kind case like the generic writer.
//   PPM R8-1              readers never turn an unscored probability / impact into 0 (Number(null) === 0).
//   N-R8-1                an approved Policy Center request whose apply step fails is not left "approved".
//   N-R8-2                the operator-token comment states the .env residual honestly.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const RE = require('../services/ppm/riskExposure');
const RAID = require('../services/ppm/raid');
const RAG = require('../services/ppm/projectRag');
const KPI = require('../services/ppm/projectKpis');

test('R8-2 — known high + unscored sibling: score kept, partial:true; known-only: partial:false', () => {
  const d = RE.projectScoreDetail([{ kind: 'risk', status: 'open', probability: 2, impact: 3 }, { kind: 'risk', status: 'open', probability: null, impact: 3 }]);
  assert.deepStrictEqual(d, { score: 6, partial: true, unknown: 1 });
  assert.strictEqual(RE.projectScore([{ kind: 'risk', status: 'open', probability: 2, impact: 3 }, { kind: 'risk', status: 'open' }]), 6);
  const k = RE.projectScoreDetail([{ kind: 'risk', status: 'open', probability: 2, impact: 3 }]);
  assert.deepStrictEqual(k, { score: 6, partial: false, unknown: 0 });
  // below high with an unknown sibling stays UNKNOWN (null), and says partial
  assert.deepStrictEqual(RE.projectScoreDetail([{ status: 'open', probability: 1, impact: 2 }, { status: 'open' }]), { score: null, partial: true, unknown: 1 });
  // a known critical cannot be exceeded: score 9, not partial (nothing unknown can make it worse)
  assert.deepStrictEqual(RE.projectScoreDetail([{ status: 'open', probability: 3, impact: 3 }, { status: 'open' }]), { score: 9, partial: false, unknown: 1 });
});

test('R8-2 — the RAG risk component carries the partial marker', () => {
  const r = RAG.computeRag({ risk_score: 6, risk_score_partial: true }, null);
  assert.strictEqual(r.components.risk.rag, 'amber');
  assert.strictEqual(r.components.risk.partial, true);
  assert.strictEqual(RAG.computeRag({ risk_score: 6 }, null).components.risk.partial, false);
});

test('data R8-2 — only assumptions (or only deleted rows) score null like an empty list, never 0', () => {
  assert.strictEqual(RE.projectScore([{ kind: 'assumption', status: 'open', probability: 3, impact: 3 }]), null);
  assert.strictEqual(RE.projectScore([{ kind: 'risk', status: 'open', probability: 3, impact: 3, deleted_at: '2026-01-01' }]), null);
  assert.strictEqual(RE.projectScore([]), null);
  // a closed in-scope risk is a measured "nothing open" → 0
  assert.strictEqual(RE.projectScore([{ kind: 'risk', status: 'closed', probability: 3, impact: 3 }]), 0);
});

test('R8-3 — exposureTotals counts an "Open" (any case) entry', () => {
  const t = RAID.exposureTotals([{ status: 'Open', money_hidden: false, impact_currency: 'USD', exposure_amount: 50 }, { status: 'CLOSED', money_hidden: false, impact_currency: 'USD', exposure_amount: 999 }]);
  assert.deepStrictEqual(t, [{ currency: 'USD', exposure_amount: 50, entries: 1, unknown: 0 }]);
});

test('R8-4 — the RAID writer normalises status / kind case like the generic writer', () => {
  const n = RAID.normalise({ kind: ' Risk ', title: 'case test', status: ' Open ' });
  assert.strictEqual(n.row.status, 'open');
  assert.strictEqual(n.row.kind, 'risk');
  assert.strictEqual(RAID.normalise({ title: 'case test', status: 'CLOSED' }).row.status, 'closed');
  assert.throws(() => RAID.normalise({ title: 'case test', status: 'mitigated' }), /status must be/);
});

test('R8-1 — readers never read an unscored probability / impact as 0', () => {
  const s = KPI.projectSummary({ project: { stage: 'in_progress' }, tasks: [], milestones: [], risks: [{ id: 1, kind: 'risk', status: 'open', title: 'u', probability: null, impact: null }, { id: 2, kind: 'risk', status: 'open', title: 'k', probability: 2, impact: 3 }], schedule: null, evm: null, rag: null, gates: null, today: '2026-11-21' });
  for (const r of s.top_risks) assert.ok(r.probability == null || r.probability > 0, 'no 0 probability');
  const v = RAID.view({ id: 1, project_id: 1, kind: 'risk', title: 'u', probability: null, impact: null, status: 'open' }, {}, { today: '2026-11-21', money: false });
  assert.strictEqual(v.score, null); assert.strictEqual(v.severity, null);
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'governanceStore.js'), 'utf8');
  assert.ok(!/probability:\s*Number\(r\.probability\)/.test(src), 'governanceStore.riskRow must not turn a null probability into 0');
});

test('R8-1 — no writer defaults an unscored risk to 2 × 2; migration 139 drops the column default', () => {
  const w3 = fs.readFileSync(path.join(__dirname, '..', 'services', 'ppm', 'governanceW3Store.js'), 'utf8');
  assert.ok(!/probability == null \? 2/.test(w3) && !/impact == null \? 2/.test(w3), 'RAID writer must not default to 2');
  assert.ok(!/SELECT MAX\(id\) AS id FROM portfolio_risks/.test(w3), 'R8-5 — RAID create reads its id with RETURNING, not MAX(id)');
  const m = fs.readFileSync(path.join(__dirname, '..', 'db', 'postgres', 'reports', '139_portfolio_risk_unscored_default.sql'), 'utf8');
  assert.match(m, /ALTER COLUMN probability DROP DEFAULT/);
  assert.match(m, /ALTER COLUMN impact DROP DEFAULT/);
  assert.ok(!/\bUPDATE\b/i.test(m.replace(/^--.*$/gm, '')), 'existing rows are never rewritten');
});

test('N-R8-1 — an apply failure marks the request failed, never leaves it "approved"', async () => {
  const { makePolicyChangeStore } = require('../services/policyChangeStore');
  const rows = new Map(); let seq = 0;
  const handle = () => ({ prepare: (sql) => ({
    run: async (...a) => {
      if (/^INSERT/.test(sql)) { seq += 1; rows.set(seq, { id: seq, key: a[0], scope: a[1], old_value: a[2], new_value: a[3], reason: a[4], requested_by: a[5], requested_by_name: a[6], status: 'pending', expires_at: '2999-01-01' }); return { lastID: seq }; }
      if (/SET status=\?, decided_by/.test(sql)) { const r = rows.get(a[5]); if (!r || r.status !== 'pending') return {}; Object.assign(r, { status: a[0], decided_by: a[1], decided_by_name: a[2], decision_reason: a[4] }); return { lastID: r.id }; }
      if (/SET status='failed'/.test(sql)) { const r = rows.get(a[1]); if (r && r.status === 'approved') Object.assign(r, { status: 'failed', decision_reason: a[0] }); return {}; }
      return {};
    },
    get: async (...a) => { if (/WHERE id = \?/.test(sql)) return rows.get(Number(a[0])) || null; return null; },
    all: async () => [...rows.values()],
  }) });
  const store = makePolicyChangeStore(handle);
  const rq = await store.create({ key: 'auth_pbkdf2_iterations', oldValue: '100000', newValue: '10000000', reason: 'legacy pending request', actor: { id: 1, username: 's1' } });
  await assert.rejects(store.decide(rq.id, 'approve', { actor: { id: 2, username: 's2', isSuper: true }, reason: 'approve', currentValue: async () => '100000', apply: async () => { throw Object.assign(new Error('maximum 5000000'), { status: 400 }); } }),
    (e) => e.status === 400 && e.policyRequest && e.policyRequest.status === 'failed');
  const after = rows.get(rq.id);
  assert.strictEqual(after.status, 'failed');
  assert.match(after.decision_reason, /apply failed: maximum 5000000/);
  assert.ok(require('../services/policyChangeStore').STATUSES.includes('failed'));
});

test('N-R8-2 — the operator-token comment names the .env residual (key + DB = can forge; G01 human decision)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'operatorTokens.js'), 'utf8');
  assert.ok(!/is the control/.test(src), 'no claim that the key alone "is the control"');
  assert.match(src, /SDP_CONFIG_KEY[\s\S]{0,400}forge/);
  assert.match(src, /G01/);
});
