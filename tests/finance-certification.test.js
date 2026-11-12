'use strict';
// A1 — Finance verifier, pure rules: who may certify, separation of duties, hash invalidation, badge.
const { test } = require('node:test');
const assert = require('node:assert');
const FC = require('../services/financeCertification');

const hasRole = (u, r) => { const H = ['super_admin', 'executive', 'admin', 'editor', 'viewer']; if (u.roles.includes(r)) return true; const i = H.indexOf(r); return i >= 0 && u.roles.some((x) => H.indexOf(x) >= 0 && H.indexOf(x) <= i); };
const U = (roles, id = 7) => ({ id, roles });

test('mayCertify: only an EXACT finance-verifier holder who may also read money', () => {
  assert.deepEqual(FC.mayCertify(U(['viewer', 'finance-verifier', 'finance-viewer']), hasRole), { ok: true, reason: null });
  assert.equal(FC.mayCertify(U(['viewer', 'finance-viewer']), hasRole).reason, 'VERIFIER_ROLE', 'a finance-viewer can never certify');
  assert.equal(FC.mayCertify(U(['super_admin']), hasRole).reason, 'VERIFIER_ROLE', 'no tier implies the verifier role');
  assert.equal(FC.mayCertify(U(['viewer', 'finance-verifier']), hasRole).reason, 'MONEY_SCOPE', 'a verifier who cannot read amounts cannot certify them');
  assert.equal(FC.mayCertify(U(['admin', 'finance-verifier']), hasRole).ok, true);
  assert.equal(FC.mayCertify(null, hasRole).reason, 'VERIFIER_ROLE');
});

test('separation of duties: the last editor of the figures cannot certify them', () => {
  assert.equal(FC.sodProblem(7, [3, 7]), 'SELF_REVIEW');
  assert.equal(FC.sodProblem(7, [3, null]), null);
  assert.equal(FC.sodProblem(7, []), null, 'unknowable editor (synced data) = no SoD refusal');
});

test('figuresHash: stable under key order, changes when a figure changes', () => {
  const a = FC.figuresHash({ rows: [{ id: 'A', cost: '10.00' }], cfg: { rate: 0.00165, map: { x: 1, y: 2 } } });
  const b = FC.figuresHash({ cfg: { map: { y: 2, x: 1 }, rate: 0.00165 }, rows: [{ cost: '10.00', id: 'A' }] });
  assert.equal(a, b); assert.match(a, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(a, FC.figuresHash({ rows: [{ id: 'A', cost: '10.01' }], cfg: { rate: 0.00165, map: { x: 1, y: 2 } } }));
});

test('state + badge: certified only while the hash matches; stale and revoked read "Non certifié"', () => {
  const c = { id: 1, status: 'verified', figures_hash: 'sha256:aa', certified_by_name: 'Fin', certified_at: '2026-11-12T10:00:00Z' };
  assert.equal(FC.state(c, 'sha256:aa'), 'verified');
  assert.equal(FC.state(c, 'sha256:bb'), 'stale');
  assert.equal(FC.state(null, 'sha256:aa'), 'uncertified');
  assert.equal(FC.state({ ...c, status: 'revoked' }, 'sha256:aa'), 'uncertified');
  assert.equal(FC.badge('verified', c).certified, true);
  assert.match(FC.badge('verified', c).label, /Certifié par Fin/);
  for (const s of ['stale', 'uncertified']) { assert.equal(FC.badge(s, c).certified, false); assert.match(FC.badge(s, c).label, /^Non certifié/); }
});

test('validate: scope / scope key / period / evidence / source / link', () => {
  const ok = { scope: 'asset_finance', scope_key: 'fleet', period: '2026-11', evidence: 'Pronto GL tie-out 11/2026', source: 'Pronto GL', evidence_link: 'https://intranet.example/x' };
  assert.equal(FC.validate(ok), null);
  assert.equal(FC.validate({ ...ok, scope: 'x' }).code, 'SCOPE');
  assert.equal(FC.validate({ ...ok, scope_key: 'project:3' }).code, 'SCOPE_KEY');
  assert.equal(FC.validate({ ...ok, scope: 'project_actuals', scope_key: 'project:3' }), null);
  assert.equal(FC.validate({ ...ok, scope: 'project_actuals', scope_key: 'fleet' }).code, 'SCOPE_KEY');
  assert.equal(FC.validate({ ...ok, scope_key: 'site:Hounde' }), null);
  assert.equal(FC.validate({ ...ok, period: '2026-13' }).code, 'PERIOD');
  assert.equal(FC.validate({ ...ok, evidence: ' ' }).code, 'EVIDENCE');
  assert.equal(FC.validate({ ...ok, source: '' }).code, 'SOURCE');
  assert.equal(FC.validate({ ...ok, evidence_link: 'javascript:alert(1)' }).code, 'EVIDENCE_LINK');
});

test('exportRow: names who/when for a certified figure, says "Non certifié" otherwise — never an amount', () => {
  const r = FC.exportRow({ scope: 'asset_finance', scope_key: 'fleet', period: '2026-11' }, 'verified', { certified_by_name: 'Fin', certified_at: '2026-11-12T10:00:00Z', source: 'Pronto', evidence: 'tie-out' });
  assert.equal(r['Certified by'], 'Fin'); assert.equal(r.State, 'Certifié');
  const n = FC.exportRow({ scope: 'asset_finance', scope_key: 'fleet', period: '2026-11' }, 'uncertified', null);
  assert.equal(n.State, 'Non certifié'); assert.equal(n['Certified by'], '—');
});
