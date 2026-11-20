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
  await assert.rejects(async () => s.create({ kind: 'nope', title: 'x' }), /kind must be/);
  await assert.rejects(async () => s.create({ kind: 'issue', title: 'x', source: { system: 'erp', id: '1' } }), /source_system/);
  const id = a.commitment.id;
  // optimistic version
  await assert.rejects(async () => s.update(id, { title: 'T2' }, { user: ed, expectedVersion: 7 }), (e) => e.status === 409);
  await assert.rejects(async () => s.update(id, { due_date: '2026-12-15' }, { user: ed, expectedVersion: 1 }), /reason is required/);
  let c = await s.update(id, { due_date: '2026-12-15' }, { user: ed, expectedVersion: 1, reason: 'vendor delay' });
  assert.equal(c.version, 2); assert.equal(c.due_date, '2026-12-15'); assert.equal(c.baseline_due_date, '2026-11-30', 'baseline kept');
  assert.ok(c.events.some((e) => e.action === 'due_date_changed' && e.details.reason === 'vendor delay'));
  // lifecycle
  c = await s.transition(id, 'committed', { actor: ed, expectedVersion: 2 });
  await assert.rejects(async () => s.transition(id, 'in_progress', { actor: ed, expectedVersion: 2 }), (e) => e.status === 409, 'stale version');
  c = await s.transition(id, 'in_progress', { actor: ed, expectedVersion: c.version });
  c = await s.transition(id, 'awaiting_verification', { actor: ed, expectedVersion: c.version });
  assert.ok(c.technical_completed_at); assert.equal(c.verified_at, null);
  await assert.rejects(async () => s.transition(id, 'verified_closed', { actor: ed, expectedVersion: c.version }), (e) => e.status === 403);
  c = await s.transition(id, 'rejected_for_rework', { actor: rv, expectedVersion: c.version, reason: 'no proof' });
  c = await s.transition(id, 'awaiting_verification', { actor: ed, expectedVersion: c.version });
  // evidence
  await assert.rejects(async () => s.addEvidence(id, { buffer: Buffer.from('MZ\0\0'), mime: 'application/x-msdownload' }, { user: ed }), (e) => e.status === 415);
  await assert.rejects(async () => s.addEvidence(id, { buffer: Buffer.from('not a pdf'), mime: 'application/pdf' }, { user: ed }), /does not match/);
  await assert.rejects(async () => s.addEvidence(id, { url: 'http://insecure' }, { user: ed }), /https/);
  const ev = await s.addEvidence(id, { buffer: PDF, mime: 'application/pdf', filename: 'pv.pdf' }, { user: ed });
  assert.equal(ev.sha256, crypto.createHash('sha256').update(PDF).digest('hex'));
  const f = await s.getEvidenceFile(id, ev.id); assert.ok(f.buffer.equals(PDF));
  const ev2 = await s.addEvidence(id, { buffer: PDF, mime: 'application/pdf', filename: 'pv-v2.pdf', supersedes: ev.id }, { user: ed });
  c = ev2.commitment; assert.equal(c.evidence.find((e) => e.id === ev.id).superseded_by, ev2.id); assert.equal(c.evidence.find((e) => e.id === ev2.id).version, 2);
  c = await s.transition(id, 'verified_closed', { actor: rv, expectedVersion: c.version });
  assert.equal(c.verified_by, 'biz.reviewer'); assert.deepEqual(c.verifications.map((v) => v.decision), ['rejected_for_rework', 'accepted']);
  await assert.rejects(async () => s.update(id, { title: 'x' }, { user: ed, expectedVersion: c.version }), /read-only/);
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
  await assert.rejects(async () => s.transition(id, 'committed', { actor: ed, expectedVersion: 1 }), /needs accountable_owner, due_date, treatment_plan/);
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
  await assert.rejects(async () => s.transition(id, 'verified_closed', { actor: { ...ed, username: 'it.owner' }, expectedVersion: c.version }), (e) => e.status === 403, 'owner cannot verify');
  c = await s.transition(id, 'verified_closed', { actor: rv, expectedVersion: c.version });
  assert.equal((await exp()).serious_open, 0);
  await assert.rejects(async () => s.transition(id, 'reopened', { actor: rv, expectedVersion: c.version }), /reason is required/);
  c = await s.transition(id, 'reopened', { actor: rv, expectedVersion: c.version, reason: 'bypassed again' });
  assert.equal(c.status, 'reopened'); assert.equal((await exp()).serious_open, 1, 'reopened exposure counted again');
  assert.deepEqual(c.events.filter((e) => e.action === 'transition').map((e) => e.to_status),
    ['committed', 'in_progress', 'awaiting_verification', 'rejected_for_rework', 'in_progress', 'awaiting_verification', 'verified_closed', 'reopened']);
  assert.deepEqual(c.verifications.map((v) => v.decision), ['rejected_for_rework', 'accepted']);
}


test('pg: critical finding scenario (A01/A02, reject, verify, reopen)', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url; process.env.REPORTS_BACKEND = 'postgres';
  const rdb = require('../reports-db'); await rdb.initPgReports();
  await require('../db/migrate').migrateAtBoot({ log: () => {} });
  const s = makeCommitmentStore({ prepare: (sql) => rdb.pgHandle().prepare(sql) }, { isPg: true });
  try { await s.init(); await scenario2(s); } finally { await dropTestDb(ctx); }
});

// P11 AUD-1 — four-eyes bypass: the accountable owner, as site editor, re-points accountable_owner and
// reviewer while the commitment is awaiting verification, then verifies it himself. The identities at
// submission are recorded and checked; owner / reviewer changes keep their old and new values.
async function scenarioAud1(s) {
  const own = { id: 7, username: 'it.owner', canEdit: true, isAdmin: false };
  const a = await s.create({ kind: 'issue', title: 'Firewall rule review', site_id: 3, accountable_owner: 'it.owner', reviewer: 'biz.reviewer' }, { user: { id: 9, username: 'coord.x', canEdit: true } });
  const id = a.commitment.id;
  let c = await s.transition(id, 'committed', { actor: own, expectedVersion: 1 });
  c = await s.transition(id, 'in_progress', { actor: own, expectedVersion: c.version });
  c = await s.transition(id, 'awaiting_verification', { actor: own, expectedVersion: c.version });
  await assert.rejects(async () => s.transition(id, 'verified_closed', { actor: own, expectedVersion: c.version }), (e) => e.status === 403, 'self-verify refused');
  // the repro: re-point owner + reviewer, then verify
  let blocked = false;
  try { c = await s.update(id, { accountable_owner: 'someone.else', reviewer: 'it.owner' }, { user: own, expectedVersion: c.version }); }
  catch (e) { blocked = true; assert.ok(e.status === 400 || e.status === 403, 'refused with a client error'); }
  if (!blocked) await assert.rejects(async () => s.transition(id, 'verified_closed', { actor: own, expectedVersion: c.version }), (e) => e.status === 403, 'submitter cannot verify after re-pointing');
  c = await s.get(id);
  assert.notEqual(c.status, 'verified_closed');
  // a legitimate change of reviewer is allowed and logged with old and new values; the submitter still cannot verify
  c = await s.update(id, { reviewer: 'other.reviewer' }, { user: own, expectedVersion: c.version });
  const ev = c.events.filter((e) => e.action === 'updated').pop();
  assert.deepEqual(ev.details.changes.reviewer, { from: 'biz.reviewer', to: 'other.reviewer' });
  c = await s.update(id, { accountable_owner: 'someone.else' }, { user: own, expectedVersion: c.version });
  assert.deepEqual(c.events.filter((e) => e.action === 'updated').pop().details.changes.accountable_owner, { from: 'it.owner', to: 'someone.else', by: 'it.owner' });
  await assert.rejects(async () => s.transition(id, 'verified_closed', { actor: { ...own, username: 'it.owner' }, expectedVersion: c.version }), (e) => e.status === 403, 'owner at submission cannot verify');
  const sub = c.events.find((e) => e.to_status === 'awaiting_verification');
  assert.equal(sub.details.submission.submitted_by, 'it.owner');
  assert.equal(sub.details.submission.accountable_owner, 'it.owner');
  c = await s.transition(id, 'verified_closed', { actor: { id: 8, username: 'other.reviewer' }, expectedVersion: c.version });
  assert.equal(c.verified_by, 'other.reviewer');
}

test('pg: AUD-1 owner cannot re-point owner/reviewer and self-verify', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url; process.env.REPORTS_BACKEND = 'postgres';
  const rdb = require('../reports-db'); await rdb.initPgReports();
  await require('../db/migrate').migrateAtBoot({ log: () => {} });
  const s = makeCommitmentStore({ prepare: (sql) => rdb.pgHandle().prepare(sql) }, { isPg: true });
  try { await s.init(); await scenarioAud1(s); } finally { await dropTestDb(ctx); }
});

// P11 round 2 NEW-1 — the accountable owner re-points owner AND reviewer BEFORE submission (no submission
// snapshot exists yet), the executor submits normally, the former owner then verifies. Segregation of duties:
// nobody who has EVER been owner, executor, creator or submitter may verify / reject / accept the risk, and the
// reviewer may never be set to one of them, at any status. Older events carrying only field names count their
// actor as a past owner.
async function scenarioNew1(s, rawDb) {
  const coord = { id: 9, username: 'coord.x', canEdit: true, isAdmin: false };
  const own = { id: 7, username: 'it.owner', canEdit: true, isAdmin: false };
  const exe = { id: 6, username: 'it.exec', canEdit: true, isAdmin: false };
  const a = await s.create({ kind: 'issue', title: 'Firewall rule review (NEW-1)', site_id: 3, accountable_owner: 'it.owner', execution_owners: ['it.exec'], reviewer: 'biz.reviewer' }, { user: coord });
  const id = a.commitment.id;
  let c = await s.transition(id, 'committed', { actor: own, expectedVersion: 1 });
  c = await s.transition(id, 'in_progress', { actor: own, expectedVersion: c.version });
  // the exact NEW-1 set-up: before submission, re-point owner away and reviewer onto oneself
  await assert.rejects(async () => s.update(id, { accountable_owner: 'someone.else', reviewer: 'it.owner' }, { user: own, expectedVersion: c.version }),
    (e) => e.status === 403, 'reviewer may not be set to the (current or past) owner');
  // the two-step variant: first move ownership away (allowed, logged with from/to), then name oneself reviewer
  c = await s.update(id, { accountable_owner: 'someone.else' }, { user: own, expectedVersion: c.version });
  assert.deepEqual(c.events.filter((e) => e.action === 'updated').pop().details.changes.accountable_owner, { from: 'it.owner', to: 'someone.else', by: 'it.owner' });
  await assert.rejects(async () => s.update(id, { reviewer: 'it.owner' }, { user: own, expectedVersion: c.version }), (e) => e.status === 403, 'a former owner cannot become reviewer');
  await assert.rejects(async () => s.update(id, { reviewer: 'IT.Exec' }, { user: own, expectedVersion: c.version }), (e) => e.status === 403, 'an executor cannot become reviewer');
  await assert.rejects(async () => s.update(id, { reviewer: 'coord.x' }, { user: own, expectedVersion: c.version }), (e) => e.status === 403, 'the creator cannot become reviewer');
  // the executor submits normally; the former owner (as admin tier too) may not verify, reject or accept the risk
  c = await s.transition(id, 'awaiting_verification', { actor: exe, expectedVersion: c.version });
  for (const to of ['verified_closed', 'rejected_for_rework', 'accepted_risk_exception']) {
    await assert.rejects(async () => s.transition(id, to, { actor: own, expectedVersion: c.version, reason: 'x' }), (e) => e.status === 403, `former owner: ${to}`);
    await assert.rejects(async () => s.transition(id, to, { actor: { ...own, isAdmin: true }, expectedVersion: c.version, reason: 'x' }), (e) => e.status === 403, `former owner as admin: ${to}`);
  }
  await assert.rejects(async () => s.transition(id, 'verified_closed', { actor: { ...exe, isAdmin: true }, expectedVersion: c.version }), (e) => e.status === 403, 'submitter cannot verify');
  // a submitter, even after the round, can never be named reviewer
  await assert.rejects(async () => s.update(id, { reviewer: 'it.exec' }, { user: coord, expectedVersion: c.version }), (e) => e.status === 403);
  // an independent reviewer still closes it
  c = await s.transition(id, 'verified_closed', { actor: { id: 2, username: 'biz.reviewer' }, expectedVersion: c.version });
  assert.equal(c.status, 'verified_closed'); assert.equal(c.verified_by, 'biz.reviewer');

  // legacy: an owner change logged before {from,to} existed (fields only) — its actor counts as a past owner
  const b = await s.create({ kind: 'issue', title: 'Legacy re-point (NEW-1)', site_id: 3, accountable_owner: 'someone.else', reviewer: 'biz.reviewer' }, { user: coord });
  await rawDb.prepare("INSERT INTO commitment_events (commitment_id, at, actor, action, from_status, to_status, details) VALUES (?,?,?,?,?,?,?)")
    .run(b.commitment.id, '2026-10-01T00:00:00Z', 'legacy.owner', 'updated', 'captured', 'captured', JSON.stringify({ fields: ['accountable_owner'] }));
  await assert.rejects(async () => s.update(b.commitment.id, { reviewer: 'legacy.owner' }, { user: coord, expectedVersion: b.commitment.version }), (e) => e.status === 403);
  let d = await s.transition(b.commitment.id, 'committed', { actor: coord, expectedVersion: b.commitment.version });
  d = await s.transition(b.commitment.id, 'in_progress', { actor: coord, expectedVersion: d.version });
  d = await s.transition(b.commitment.id, 'awaiting_verification', { actor: { id: 11, username: 'it.tech' , canEdit: true }, expectedVersion: d.version });
  await assert.rejects(async () => s.transition(b.commitment.id, 'verified_closed', { actor: { id: 12, username: 'legacy.owner', isAdmin: true }, expectedVersion: d.version }), (e) => e.status === 403, 'legacy past owner cannot verify');
  // unrelated edits stay possible
  d = await s.update(b.commitment.id, { title: 'Legacy re-point (NEW-1) — renamed' }, { user: coord, expectedVersion: d.version });
  assert.equal(d.status, 'awaiting_verification');
}

test('pg: NEW-1 a former owner cannot become reviewer nor verify (owner re-pointed before submission)', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url; process.env.REPORTS_BACKEND = 'postgres';
  const rdb = require('../reports-db'); await rdb.initPgReports();
  await require('../db/migrate').migrateAtBoot({ log: () => {} });
  const h = { prepare: (sql) => rdb.pgHandle().prepare(sql) };
  const s = makeCommitmentStore(h, { isPg: true });
  try { await s.init(); await scenarioNew1(s, h); } finally { await dropTestDb(ctx); }
});

// P11 round 3 N-R3-1 + four-eyes alias (P3) — (a) whoever re-points the owner / executors is recorded in the event
// and counts as a past owner / executor: Alice setting the owner to a look-alike she controls ("alice<ZWSP>",
// "al<Cyrillic i>ce") cannot then verify; (b) a reviewer value that NAMES an account (its e-mail alias) is resolved
// to that account, so a former owner cannot be named reviewer through their e-mail.
async function scenarioR3(s, rawDb) {
  await rawDb.prepare("INSERT INTO users (username, full_name, password_hash, salt, role, active, email) VALUES ('it.owner','Ivo Owner','x','x','editor',1,'it.owner@corp.example')").run();
  const coord = { id: 9, username: 'coord.x', canEdit: true, isAdmin: false };
  const alice = { id: 21, username: 'alice', full_name: 'Alice A', email: 'alice@corp.example', canEdit: true, isAdmin: true };
  const exe = { id: 6, username: 'it.exec', canEdit: true, isAdmin: false };
  for (const look of ['alice​', 'alіce', 'Bob B']) {
    const a = await s.create({ kind: 'issue', title: `Look-alike ${JSON.stringify(look)}`, site_id: 3, accountable_owner: 'bob', execution_owners: ['it.exec'], reviewer: 'alice' }, { user: coord });
    let c = await s.update(a.commitment.id, { accountable_owner: look }, { user: alice, expectedVersion: 1 });
    const ev = c.events.filter((e) => e.action === 'updated').pop();
    assert.equal(ev.details.changes.accountable_owner.by, 'alice', 'the actor of an owner change is recorded');
    c = await s.transition(c.id, 'committed', { actor: exe, expectedVersion: c.version });
    c = await s.transition(c.id, 'in_progress', { actor: exe, expectedVersion: c.version });
    c = await s.transition(c.id, 'awaiting_verification', { actor: exe, expectedVersion: c.version });
    await assert.rejects(async () => s.transition(c.id, 'verified_closed', { actor: alice, expectedVersion: c.version }), (e) => e.status === 403, `re-pointer cannot verify (${JSON.stringify(look)})`);
  }
  // executors re-pointed by the actor count too
  const b = await s.create({ kind: 'issue', title: 'Executor re-point', site_id: 3, accountable_owner: 'bob', execution_owners: ['it.exec'], reviewer: 'alice' }, { user: coord });
  let d = await s.update(b.commitment.id, { execution_owners: ['alіce'] }, { user: alice, expectedVersion: 1 });
  d = await s.transition(d.id, 'committed', { actor: exe, expectedVersion: d.version });
  d = await s.transition(d.id, 'in_progress', { actor: exe, expectedVersion: d.version });
  d = await s.transition(d.id, 'awaiting_verification', { actor: exe, expectedVersion: d.version });
  await assert.rejects(async () => s.transition(d.id, 'verified_closed', { actor: alice, expectedVersion: d.version }), (e) => e.status === 403);
  // alias: the former owner it.owner cannot be named reviewer through the account's e-mail
  const a2 = await s.create({ kind: 'issue', title: 'Alias reviewer', site_id: 3, accountable_owner: 'it.owner', reviewer: 'biz.reviewer' }, { user: coord });
  let e2 = await s.update(a2.commitment.id, { accountable_owner: 'someone.else' }, { user: coord, expectedVersion: 1 });
  await assert.rejects(async () => s.update(e2.id, { reviewer: 'IT.Owner@corp.example' }, { user: coord, expectedVersion: e2.version }), (e) => e.status === 403, 'e-mail alias of a former owner refused');
  await assert.rejects(async () => s.update(e2.id, { reviewer: 'it.owner​@corp.example' }, { user: coord, expectedVersion: e2.version }), (e) => e.status === 403, 'look-alike alias refused');
  e2 = await s.update(e2.id, { reviewer: 'biz.other' }, { user: coord, expectedVersion: e2.version });
  assert.equal(e2.reviewer, 'biz.other', 'an unrelated reviewer is still accepted');
}

test('pg: N-R3-1 look-alike owner set by the verifier, and a former owner\'s e-mail alias as reviewer, are refused', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url; process.env.REPORTS_BACKEND = 'postgres';
  const rdb = require('../reports-db'); await rdb.initPgReports();
  await require('../db/migrate').migrateAtBoot({ log: () => {} });
  const h = { prepare: (sql) => rdb.pgHandle().prepare(sql) };
  const s = makeCommitmentStore(h, { isPg: true });
  try { await s.init(); await scenarioR3(s, h); } finally { await dropTestDb(ctx); }
});
