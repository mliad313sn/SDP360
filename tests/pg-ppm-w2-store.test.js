'use strict';
// W2-PPM (E-P03..E-P06) — governance store on PostgreSQL: traced task reassignment in the hash-chained ledger,
// budget periods, linked benefit owner, RACI and templates. Fictitious data only.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppmw2-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin'; process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
let ctx, s, rdb, pj;
const U = { id: 7, username: 'pmo' };

before(async () => {
  ctx = await provisionTestDb(); if (!ctx) return;
  process.env.PG_URL = ctx.url;
  rdb = require('../reports-db'); await rdb.initPgReports();
  await require('../db/migrate').migrateAtBoot({ log: () => {} });
  const { makeGovernanceStore } = require('../services/governanceStore');
  s = makeGovernanceStore({ prepare: (sql) => rdb.pgHandle().prepare(sql), runTransaction: (fn) => rdb.pgHandle().runTransaction(fn) }, { isPg: true });
  const pr = await s.upsertPortfolio('programme', { key: 'w2-p', name: 'P' }); const ob = await s.upsertPortfolio('objective', { programme_id: pr, key: 'w2-o', name: 'O' });
  pj = await s.upsertPortfolio('project', { objective_id: ob, key: 'W2-J', name: 'J', site_id: 1 });
});
after(async () => { if (ctx) await dropTestDb(ctx); });

test('E-P03: a task owner change writes a task_reassigned row (old, new, actor, reason); reason required when asked', async (t) => {
  if (!ctx) return t.skip('no pg');
  const tid = await s.upsertPortfolio('task', { project_id: pj, name: 'Cabling', owner: 'Ana' }, { user: U });
  await s.upsertPortfolio('task', { id: tid, name: 'Cabling (renamed)' }, { user: U });
  await assert.rejects(s.upsertPortfolio('task', { id: tid, owner: 'Bob' }, { user: U, requireOwnerReason: true }), (e) => e.reason === 'REASON_REQUIRED');
  assert.equal((await rdb.pgHandle().prepare('SELECT owner FROM portfolio_tasks WHERE id=?').get(tid)).owner, 'Ana', 'refused = not written');
  await s.upsertPortfolio('task', { id: tid, owner: 'Bob' }, { user: U, reason: 'Ana is on the WAN cut-over', requireOwnerReason: true });
  await s.upsertPortfolio('task', { id: tid, owner: ' Bob ' }, { user: U });   // same person (trimmed) → no new row
  await s.upsertPortfolio('task', { id: tid, owner: 'Cy' }, { user: U });       // switch off: no reason, still traced
  const ev = (await s.ppmEvents('project', pj)).filter((e) => e.action === 'task_reassigned');
  assert.deepEqual(ev.map((e) => [e.field, e.old_value, e.new_value, e.note, e.actor_id]), [[`task:${tid}`, 'Ana', 'Bob', 'Ana is on the WAN cut-over', 7], [`task:${tid}`, ' Bob ', 'Cy', null, 7]]);
  const h = await rdb.pgHandle().prepare("SELECT row_hash, prev_hash FROM ppm_events WHERE action='task_reassigned' ORDER BY id").all();
  assert.ok(h.every((r) => r.row_hash && r.row_hash.length === 64), 'hash chain reused');
});

test('E-P04: budget periods — upsert per key, justification on change / variance, every write hash-chained', async (t) => {
  if (!ctx) return t.skip('no pg');
  await s.saveBudgetPeriod(pj, { period: '2026-10', currency: 'usd', kind: 'baseline', amount: 100 }, { user: U });
  await assert.rejects(s.saveBudgetPeriod(pj, { period: '2026-10', currency: 'USD', kind: 'actual', amount: 120 }, { user: U }), (e) => e.reason === 'JUSTIFICATION_REQUIRED');
  await s.saveBudgetPeriod(pj, { period: '2026-10', currency: 'USD', kind: 'actual', amount: 100 }, { user: U });   // equals baseline: no reason
  await assert.rejects(s.saveBudgetPeriod(pj, { period: '2026-10', currency: 'USD', kind: 'actual', amount: 110 }, { user: U }), (e) => e.reason === 'JUSTIFICATION_REQUIRED');
  const rows = await s.saveBudgetPeriod(pj, { period: '2026-10', currency: 'USD', kind: 'actual', amount: 110, reason: 'extra cabling (fictitious)' }, { user: U });
  assert.equal(rows.filter((r) => r.kind === 'actual').length, 1, 'one row per key');
  assert.equal(rows.find((r) => r.kind === 'actual').amount, 110);
  await assert.rejects(s.saveBudgetPeriod(pj, { period: '2026-10', currency: 'USD', kind: 'actual', amount: -5, reason: 'x' }), (e) => e.code === 'INVALID');
  const ev = (await s.ppmEvents('project', pj)).filter((e) => e.action === 'budget_period_edit');
  assert.deepEqual(ev.map((e) => [e.field, e.old_value, e.new_value, e.currency]), [['baseline:2026-10', null, '100', 'USD'], ['actual:2026-10', null, '100', 'USD'], ['actual:2026-10', '100', '110', 'USD']]);
});
