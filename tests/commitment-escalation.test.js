'use strict';
// G-18 — A01 / A02 escalation dedup (pure diff + ledger on PostgreSQL) and the serious-commitment
// edit rule (an edit may not drop a high / critical commitment past `captured` back into A01 / A02 state).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'cmt-esc-'));
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../services/commitmentEscalation');
const { makeCommitmentStore } = require('../services/commitmentStore');

const TABLES = ['commitment_escalations', 'commitments', 'commitment_source_links', 'commitment_events', 'evidence_items', 'closure_verifications'];
const ed = { id: 1, username: 'it.editor', canEdit: true, isAdmin: false };

test('pure: A01 and A02 keys, the due date is part of the A02 key', () => {
  const rows = [
    { id: 1, site_id: 3, severity: 'high', status: 'captured', accountable_owner: null, due_date: '2026-12-01' },
    { id: 2, site_id: 3, severity: 'critical', status: 'in_progress', accountable_owner: 'x', due_date: '2026-10-01' },
    { id: 3, site_id: 3, severity: 'medium', status: 'in_progress', accountable_owner: null, due_date: '2026-10-01' },
    { id: 4, site_id: 3, severity: 'high', status: 'in_progress', accountable_owner: 'x', due_date: '2026-10-01', exception_approved_by: 'boss' },
    { id: 5, site_id: 3, severity: 'high', status: 'verified_closed', accountable_owner: null, due_date: '2026-10-01' },
  ];
  assert.deepEqual(E.conditions(rows, '2026-10-28').map((c) => c.key), ['A01:1', 'A02:2:2026-10-01']);
});

test('pure: diff opens once, keeps silently, clears, reopens', () => {
  const c = [{ key: 'A01:1' }, { key: 'A02:2:2026-10-01' }];
  let d = E.diff(c, []);
  assert.deepEqual([d.open.length, d.keep.length, d.clear.length, d.reopen.length], [2, 0, 0, 0]);
  d = E.diff(c, [{ key: 'A01:1', cleared_at: null }, { key: 'A02:2:2026-10-01', cleared_at: null }]);
  assert.deepEqual([d.open.length, d.keep.length, d.clear.length], [0, 2, 0], 'a persisting condition raises nothing');
  d = E.diff([{ key: 'A01:1' }], [{ key: 'A01:1', cleared_at: null }, { key: 'A02:2:2026-10-01', cleared_at: null }]);
  assert.deepEqual(d.clear, ['A02:2:2026-10-01']);
  d = E.diff([{ key: 'A01:1' }, { key: 'A01:1' }], [{ key: 'A01:1', cleared_at: '2026-10-20' }]);
  assert.equal(d.reopen.length, 1, 'the same condition back after clearing is one more episode, counted once');
});

test('ledger on PostgreSQL: one raise per episode, re-runs raise nothing, a moved and missed due date is new', async () => {
  let clock = '2026-10-28T08:00:00.000Z';
  const s = makeCommitmentStore(await require('./_pg-fresh').freshStore(TABLES), { now: () => clock }); await s.init();
  const a = (await s.create({ kind: 'issue', title: 'Server room flooded', site_id: 3, severity: 'critical' }, { user: ed })).commitment;
  const b = (await s.create({ kind: 'corrective_action', title: 'Replace UPS', site_id: 4, severity: 'high', accountable_owner: 'ana', due_date: '2026-10-01', treatment_plan: 'order' }, { user: ed })).commitment;
  let bb = await s.transition(b.id, 'committed', { actor: ed, expectedVersion: b.version });
  bb = await s.transition(b.id, 'in_progress', { actor: ed, expectedVersion: bb.version });

  let r = await s.escalate();
  assert.deepEqual(r.raised.map((x) => x.key).sort(), [`A01:${a.id}`, `A02:${b.id}:2026-10-01`]);
  for (let i = 0; i < 3; i++) { r = await s.escalate(); assert.equal(r.raised.length, 0, 'unchanged conditions raise nothing'); assert.equal(r.kept, 2); }

  // A01 clears when an owner is named
  await s.update(a.id, { accountable_owner: 'bob' }, { user: ed, expectedVersion: a.version });
  r = await s.escalate();
  assert.equal(r.raised.length, 0); assert.equal(r.cleared, 1);
  assert.deepEqual((await s.listEscalations({})).map((e) => e.key), [`A02:${b.id}:2026-10-01`]);

  // A02: due date moved (with reason) then missed again = a new key, the old one clears
  bb = await s.update(b.id, { due_date: '2026-10-20' }, { user: ed, expectedVersion: bb.version, reason: 'vendor delay' });
  r = await s.escalate();
  assert.deepEqual(r.raised.map((x) => x.key), [`A02:${b.id}:2026-10-20`]); assert.equal(r.cleared, 1);

  // owner removed again while still captured (allowed there) → the same A01 key reopens as episode 2
  const a2 = await s.getRaw(a.id);
  await s.update(a.id, { accountable_owner: '' }, { user: ed, expectedVersion: a2.version });
  clock = '2026-10-29T08:00:00.000Z';
  r = await s.escalate();
  assert.deepEqual(r.raised.map((x) => x.key), [`A01:${a.id}`]);
  const led = await s.listEscalations({ openOnly: false });
  assert.equal(led.find((e) => e.key === `A01:${a.id}`).episodes, 2);
  assert.equal(led.find((e) => e.key === `A01:${a.id}`).cleared_at, null);

  // scope: site 4 only sees its own
  assert.deepEqual((await s.listEscalations({ siteIds: [4] })).map((e) => e.site_id), [4]);
  assert.deepEqual(await s.listEscalations({ siteIds: [] }), []);
});

test('edit rule: past captured, a serious commitment cannot lose its owner, plan or date, nor be raised to high without them', async () => {
  const s = makeCommitmentStore(await require('./_pg-fresh').freshStore(TABLES)); await s.init();
  let c = (await s.create({ kind: 'issue', title: 'Firewall end of support', site_id: 3, severity: 'high', accountable_owner: 'ana', due_date: '2026-12-01', treatment_plan: 'replace' }, { user: ed })).commitment;
  c = await s.transition(c.id, 'committed', { actor: ed, expectedVersion: c.version });
  for (const patch of [{ accountable_owner: '' }, { treatment_plan: '' }]) {
    await assert.rejects(async () => s.update(c.id, patch, { user: ed, expectedVersion: c.version }), (e) => e.status === 400 && /needs/.test(e.message), JSON.stringify(patch));
  }
  await assert.rejects(async () => s.update(c.id, { due_date: '' }, { user: ed, expectedVersion: c.version, reason: 'unknown' }), (e) => e.status === 400 && /needs due_date/.test(e.message));
  // a title edit on an already-compliant commitment still works
  c = await s.update(c.id, { title: 'Firewall EoS — HGO' }, { user: ed, expectedVersion: c.version });
  // medium in progress without owner → raising it to critical is refused
  let m = (await s.create({ kind: 'issue', title: 'Printer', site_id: 3 }, { user: ed })).commitment;
  m = await s.transition(m.id, 'committed', { actor: ed, expectedVersion: m.version });
  await assert.rejects(async () => s.update(m.id, { severity: 'critical' }, { user: ed, expectedVersion: m.version }), (e) => e.status === 400 && /critical commitment needs accountable_owner/.test(e.message));
  m = await s.update(m.id, { severity: 'critical', accountable_owner: 'bob', due_date: '2026-12-01', treatment_plan: 'fix' }, { user: ed, expectedVersion: m.version });
  assert.equal(m.severity, 'critical');
});

test('committee P1-1: muting a site leaves its open escalations open (not "cleared"); unmuting does not count a new episode', async () => {
  const s = makeCommitmentStore(await require('./_pg-fresh').freshStore(TABLES)); await s.init();
  const a = (await s.create({ kind: 'issue', title: 'Generator down', site_id: 3, severity: 'critical' }, { user: ed })).commitment;
  let muted = false;
  const policyFor = async (sid) => ({ 'commitments.escalation_enabled': !(muted && sid === 3) });
  assert.equal((await s.escalate({ policyFor })).raised.length, 1);
  muted = true;
  const r = await s.escalate({ policyFor });
  assert.equal(r.cleared, 0); assert.equal(r.muted, 1);
  assert.equal((await s.listEscalations({})).length, 1, 'still open');
  muted = false;
  const back = await s.escalate({ policyFor });
  assert.equal(back.raised.length, 0); assert.equal(back.kept, 1);
  assert.equal((await s.listEscalations({}))[0].episodes, 1);
  void a;
});
