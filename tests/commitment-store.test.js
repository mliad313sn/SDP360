'use strict';
// 2027 Goal 02 — commitment store on sqlite AND PostgreSQL (same scenario on both backends):
// idempotent create on the source key, optimistic version (stale → CONFLICT), due-date change keeps
// the baseline + needs a reason, transitions + closure_verifications, evidence checksum / mime /
// magic bytes / supersede, site-scoped list (site-less non-admin sees nothing), hub links.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'cmt-store-'));
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { makeCommitmentStore } = require('../services/commitmentStore');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

const ed = { id: 1, username: 'it.editor', canEdit: true, isAdmin: false };
const rv = { id: 2, username: 'biz.reviewer', canEdit: false, isAdmin: false };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function scenario(s) {
  const a = await s.create({ kind: 'business_need', title: 'Laptops for geology', site_id: 3, accountable_owner: 'it.owner', reviewer: 'biz.reviewer', due_date: '2026-11-30', source: { system: 'meetings', id: '41' } }, { user: ed });
  assert.equal(a.created, true); assert.equal(a.commitment.status, 'captured'); assert.equal(a.commitment.version, 1);
  assert.equal(a.commitment.baseline_due_date, '2026-11-30'); assert.equal(a.commitment.links.length, 1);
  const again = await s.create({ kind: 'business_need', title: 'dup', site_id: 3, source: { system: 'meetings', id: '41' } }, { user: ed });
  assert.equal(again.created, false); assert.equal(again.commitment.id, a.commitment.id, 'idempotent on the source key');
  await assert.rejects(() => s.create({ kind: 'nope', title: 'x' }), /kind must be/);
  await assert.rejects(() => s.create({ kind: 'issue', title: 'x', source: { system: 'erp', id: '1' } }), /source_system/);
  const id = a.commitment.id;
  // optimistic version
  await assert.rejects(() => s.update(id, { title: 'T2' }, { user: ed, expectedVersion: 7 }), (e) => e.status === 409);
  await assert.rejects(() => s.update(id, { due_date: '2026-12-15' }, { user: ed, expectedVersion: 1 }), /reason is required/);
  let c = await s.update(id, { due_date: '2026-12-15' }, { user: ed, expectedVersion: 1, reason: 'vendor delay' });
  assert.equal(c.version, 2); assert.equal(c.due_date, '2026-12-15'); assert.equal(c.baseline_due_date, '2026-11-30', 'baseline kept');
  assert.ok(c.events.some((e) => e.action === 'due_date_changed' && e.details.reason === 'vendor delay'));
  // lifecycle
  c = await s.transition(id, 'committed', { actor: ed, expectedVersion: 2 });
  await assert.rejects(() => s.transition(id, 'in_progress', { actor: ed, expectedVersion: 2 }), (e) => e.status === 409, 'stale version');
  c = await s.transition(id, 'in_progress', { actor: ed, expectedVersion: c.version });
  c = await s.transition(id, 'awaiting_verification', { actor: ed, expectedVersion: c.version });
  assert.ok(c.technical_completed_at); assert.equal(c.verified_at, null);
  await assert.rejects(() => s.transition(id, 'verified_closed', { actor: ed, expectedVersion: c.version }), (e) => e.status === 403);
  c = await s.transition(id, 'rejected_for_rework', { actor: rv, expectedVersion: c.version, reason: 'no proof' });
  c = await s.transition(id, 'awaiting_verification', { actor: ed, expectedVersion: c.version });
  // evidence
  await assert.rejects(() => s.addEvidence(id, { buffer: Buffer.from('MZ\0\0'), mime: 'application/x-msdownload' }, { user: ed }), (e) => e.status === 415);
  await assert.rejects(() => s.addEvidence(id, { buffer: Buffer.from('not a pdf'), mime: 'application/pdf' }, { user: ed }), /does not match/);
  await assert.rejects(() => s.addEvidence(id, { url: 'http://insecure' }, { user: ed }), /https/);
  const ev = await s.addEvidence(id, { buffer: PDF, mime: 'application/pdf', filename: 'pv.pdf' }, { user: ed });
  assert.equal(ev.sha256, crypto.createHash('sha256').update(PDF).digest('hex'));
  const f = await s.getEvidenceFile(id, ev.id); assert.ok(f.buffer.equals(PDF));
  const ev2 = await s.addEvidence(id, { buffer: PDF, mime: 'application/pdf', filename: 'pv-v2.pdf', supersedes: ev.id }, { user: ed });
  c = ev2.commitment; assert.equal(c.evidence.find((e) => e.id === ev.id).superseded_by, ev2.id); assert.equal(c.evidence.find((e) => e.id === ev2.id).version, 2);
  c = await s.transition(id, 'verified_closed', { actor: rv, expectedVersion: c.version });
  assert.equal(c.verified_by, 'biz.reviewer'); assert.deepEqual(c.verifications.map((v) => v.decision), ['rejected_for_rework', 'accepted']);
  await assert.rejects(() => s.update(id, { title: 'x' }, { user: ed, expectedVersion: c.version }), /read-only/);
  // scoping + hub links
  await s.create({ kind: 'issue', title: 'Other site', site_id: 9 }, { user: ed });
  assert.equal((await s.list({ siteIds: [3] })).length, 1);
  assert.equal((await s.list({ siteIds: [] })).length, 0, 'site-less non-admin sees nothing');
  assert.equal((await s.list({ siteIds: [], named: ['BIZ.REVIEWER'] })).length, 1, 'a named reviewer sees their item');
  assert.equal((await s.list({ siteIds: null })).length, 2);
  const m = await s.linksFor([{ system: 'meetings', id: '41' }, { system: 'meetings', id: '999' }]);
  assert.equal(m.get('meetings:41').status, 'verified_closed'); assert.equal(m.has('meetings:999'), false);
  const rows = await s.metricRows({ siteIds: [3] }); assert.equal(rows.length, 1);
}

test('sqlite: commitment store scenario', async () => {
  const s = makeCommitmentStore(new Database(':memory:')); await s.init();
  await scenario(s);
});

test('pg: commitment store scenario (migration reports/021)', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url; process.env.REPORTS_BACKEND = 'postgres';
  const rdb = require('../reports-db'); await rdb.initPgReports();
  await require('../db/migrate').migrateAtBoot({ log: () => {} });
  const s = makeCommitmentStore({ prepare: (sql) => rdb.pgHandle().prepare(sql) }, { isPg: true });
  try { await s.init(); await scenario(s); } finally { await dropTestDb(ctx); }
});

// Consolidation scenario 2 on BOTH backends: critical inspection finding → A01 (unowned) → owner/date/plan →
// A02 (overdue, no exception) → evidence → rejected → rework → verified by an independent reviewer → reopened.
async function scenario2(s) {
  const { seriousExposure } = require('../services/commitmentMetrics');
  const alerts = require('../services/alertEngine');
  const fires = (k, v) => alerts.evaluate([{ key: k, metric: k, op: 'gt', threshold: 0 }], [{ rule_key: k, site_id: 5, value: v }]).firings.length;
  const exp = async () => seriousExposure(await s.metricRows({ siteIds: [5] }), '2026-10-28');
  const a = await s.create({ kind: 'inspection_finding', severity: 'critical', title: 'UPS bypassed', site_id: 5, reviewer: 'biz.reviewer', source: { system: 'inspection', id: '77' } }, { user: ed });
  const id = a.commitment.id;
  let x = await exp(); assert.equal(x.serious_unowned, 1); assert.equal(fires('A01', x.serious_unowned), 1);
  await assert.rejects(() => s.transition(id, 'committed', { actor: ed, expectedVersion: 1 }), /needs accountable_owner, due_date, treatment_plan/);
  let c = await s.update(id, { accountable_owner: 'it.owner', due_date: '2026-01-15', treatment_plan: 'restore UPS inline' }, { user: ed, expectedVersion: 1, reason: 'initial' });
  c = await s.transition(id, 'committed', { actor: ed, expectedVersion: c.version });
  c = await s.transition(id, 'in_progress', { actor: ed, expectedVersion: c.version });
  x = await exp(); assert.equal(x.serious_unowned, 0); assert.deepEqual(x.overdue_ids.map(Number), [Number(id)]); assert.equal(fires('A02', x.serious_overdue), 1);
  const ev = await s.addEvidence(id, { buffer: PDF, mime: 'application/pdf', filename: 'ups.pdf' }, { user: ed });
  c = await s.transition(id, 'awaiting_verification', { actor: ed, expectedVersion: ev.commitment.version });
  assert.equal((await exp()).serious_overdue, 0, 'awaiting verification is not overdue');
  c = await s.transition(id, 'rejected_for_rework', { actor: rv, expectedVersion: c.version, reason: 'transfer not witnessed' });
  c = await s.transition(id, 'in_progress', { actor: ed, expectedVersion: c.version });
  c = await s.transition(id, 'awaiting_verification', { actor: ed, expectedVersion: c.version });
  await assert.rejects(() => s.transition(id, 'verified_closed', { actor: { ...ed, username: 'it.owner' }, expectedVersion: c.version }), (e) => e.status === 403, 'owner cannot verify');
  c = await s.transition(id, 'verified_closed', { actor: rv, expectedVersion: c.version });
  assert.equal((await exp()).serious_open, 0);
  await assert.rejects(() => s.transition(id, 'reopened', { actor: rv, expectedVersion: c.version }), /reason is required/);
  c = await s.transition(id, 'reopened', { actor: rv, expectedVersion: c.version, reason: 'bypassed again' });
  assert.equal(c.status, 'reopened'); assert.equal((await exp()).serious_open, 1, 'reopened exposure counted again');
  assert.deepEqual(c.events.filter((e) => e.action === 'transition').map((e) => e.to_status),
    ['committed', 'in_progress', 'awaiting_verification', 'rejected_for_rework', 'in_progress', 'awaiting_verification', 'verified_closed', 'reopened']);
  assert.deepEqual(c.verifications.map((v) => v.decision), ['rejected_for_rework', 'accepted']);
}

test('sqlite: critical finding scenario (A01/A02, reject, verify, reopen)', async () => {
  const s = makeCommitmentStore(new Database(':memory:')); await s.init();
  await scenario2(s);
});

test('pg: critical finding scenario (A01/A02, reject, verify, reopen)', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url; process.env.REPORTS_BACKEND = 'postgres';
  const rdb = require('../reports-db'); await rdb.initPgReports();
  await require('../db/migrate').migrateAtBoot({ log: () => {} });
  const s = makeCommitmentStore({ prepare: (sql) => rdb.pgHandle().prepare(sql) }, { isPg: true });
  try { await s.init(); await scenario2(s); } finally { await dropTestDb(ctx); }
});
