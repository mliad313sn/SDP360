'use strict';
// Tamper evidence on the audit tables (migration 034): new rows are chained; editing or deleting a row
// behind the application (here: with the append-only trigger disabled, as a table owner could) is detected.
const { test } = require('node:test');
const assert = require('node:assert');

test('hash chain: new rows chain, a doctored row and a deleted row are both detected', async () => {
  await require('./_pg-fresh').truncate(['minutes_history']);
  const rdb = require('../reports-db'); const db = rdb.pgHandle();
  const AC = require('../services/auditChain');
  for (let i = 1; i <= 4; i++) await db.prepare("INSERT INTO minutes_history (session_id, action, actor_id, at, reason) VALUES (?, 'accepted', 1, ?, ?)").run(7, `2026-10-2${i}T10:00:00Z`, 'r' + i);
  let v = await AC.verify(db); let t = v.tables.find((x) => x.table === 'minutes_history');
  assert.equal(t.ok, true); assert.equal(t.rows, 4); assert.match(t.head, /^[0-9a-f]{64}$/);
  const rows = await db.prepare('SELECT id, prev_hash, row_hash FROM minutes_history ORDER BY id').all();
  assert.equal(rows[0].prev_hash, null); assert.equal(rows[1].prev_hash, rows[0].row_hash, 'each row points at the previous one');
  // the application cannot edit it
  await assert.rejects(async () => db.prepare("UPDATE minutes_history SET reason='x' WHERE id=?").run(rows[1].id), /append-only/);
  // a table owner pauses the guard and edits a row → the chain breaks at that row
  await db.exec('ALTER TABLE minutes_history DISABLE TRIGGER minutes_history_append_only');
  try {
    await db.prepare("UPDATE minutes_history SET reason='rewritten' WHERE id=?").run(rows[1].id);
    v = await AC.verify(db); t = v.tables.find((x) => x.table === 'minutes_history');
    assert.equal(t.ok, false); assert.equal(t.first_broken_id, Number(rows[1].id)); assert.equal(v.ok, false);
    await db.prepare("UPDATE minutes_history SET reason='r2' WHERE id=?").run(rows[1].id);
    assert.equal((await AC.verify(db)).tables.find((x) => x.table === 'minutes_history').ok, true, 'restored content verifies again');
    // deleting a row in the middle breaks the link of the next one
    await db.prepare('DELETE FROM minutes_history WHERE id=?').run(rows[2].id);
    t = (await AC.verify(db)).tables.find((x) => x.table === 'minutes_history');
    assert.equal(t.ok, false); assert.equal(t.first_broken_id, Number(rows[3].id));
  } finally { await db.exec('ALTER TABLE minutes_history ENABLE TRIGGER minutes_history_append_only'); }
});

test('the nightly job is registered, mandatory and fails on a broken chain', () => {
  const jobs = require('../services/sync/jobs');
  assert.equal(jobs.FRESHNESS_HOURS['audit.chain_verify'], 30);
  assert.ok(!jobs.OPTIONAL.has('audit.chain_verify'));
});

// P11 round 5 AUD-2 — the nightly verify compares the chain with the previous day's anchor (migration 131).
async function seedAnchored(n) {
  await require('./_pg-fresh').truncate(['minutes_history', 'audit_chain_anchors']);
  const rdb = require('../reports-db'); const db = rdb.pgHandle(); const AC = require('../services/auditChain');
  for (let i = 1; i <= n; i++) await db.prepare("INSERT INTO minutes_history (session_id, action, actor_id, at, reason) VALUES (?, 'accepted', 1, ?, ?)").run(9, `2026-11-0${i}T10:00:00Z`, 'a' + i);
  const v = await AC.verify(db); assert.equal(v.ok, true); assert.equal(v.anchors, true);
  assert.ok((await AC.recordAnchors(db, v)) >= 1);
  return { db, AC, rows: await db.prepare('SELECT id FROM minutes_history ORDER BY id').all() };
}

test('anchor: a TAIL delete leaves a valid chain but no longer extends the anchor → broken', async () => {
  const { db, AC, rows } = await seedAnchored(4);
  await db.exec('ALTER TABLE minutes_history DISABLE TRIGGER minutes_history_append_only');
  try {
    await db.prepare('DELETE FROM minutes_history WHERE id=?').run(rows[3].id);
    const v0 = await AC.verify(db, { anchors: false });
    assert.equal(v0.tables.find((x) => x.table === 'minutes_history').ok, true, 'without the anchor the shorter chain still verifies (the old blind spot)');
    const t = (await AC.verify(db)).tables.find((x) => x.table === 'minutes_history');
    assert.equal(t.ok, false); assert.match(t.anchor_error, /shrank|gone/);
    // appending a new row after the tail delete does not hide it: the anchored row is still missing
    await db.prepare("INSERT INTO minutes_history (session_id, action, actor_id, at, reason) VALUES (9, 'accepted', 1, '2026-11-09T10:00:00Z', 'refill')").run();
    const t2 = (await AC.verify(db)).tables.find((x) => x.table === 'minutes_history');
    assert.equal(t2.ok, false); assert.match(t2.anchor_error, new RegExp(`#${rows[3].id} is gone`));
  } finally { await db.exec('ALTER TABLE minutes_history ENABLE TRIGGER minutes_history_append_only'); }
});

test('anchor: TRUNCATE is detected; a rewritten chain is detected; a growing chain extends it', async () => {
  let { db, AC } = await seedAnchored(3);
  await db.prepare("INSERT INTO minutes_history (session_id, action, actor_id, at, reason) VALUES (9, 'accepted', 1, '2026-11-08T10:00:00Z', 'next day')").run();
  assert.equal((await AC.verify(db)).ok, true, 'appending extends the anchor');
  await db.exec('TRUNCATE minutes_history');
  const t = (await AC.verify(db)).tables.find((x) => x.table === 'minutes_history');
  assert.equal(t.ok, false); assert.match(t.anchor_error, /shrank from 3 .* to 0/);
  // rewrite: delete everything and re-insert the same number of rows (a fresh, internally valid chain)
  ({ db, AC } = await seedAnchored(2));
  await db.exec('ALTER TABLE minutes_history DISABLE TRIGGER minutes_history_append_only');
  try {
    await db.exec('DELETE FROM minutes_history');
    for (let i = 1; i <= 2; i++) await db.prepare("INSERT INTO minutes_history (session_id, action, actor_id, at, reason) VALUES (9, 'accepted', 1, ?, 'forged')").run(`2026-11-0${i}T10:00:00Z`);
    const r = (await AC.verify(db)).tables.find((x) => x.table === 'minutes_history');
    assert.equal(r.ok, false); assert.match(r.anchor_error, /gone|rewritten/);
  } finally { await db.exec('ALTER TABLE minutes_history ENABLE TRIGGER minutes_history_append_only'); }
});

test('nightly(): anchors a good chain, refuses to anchor (and throws on) a broken one', async () => {
  const { db, AC } = await seedAnchored(2);
  const rdb = require('../reports-db');
  const before = Number((await db.prepare("SELECT COUNT(*) AS n FROM audit_chain_anchors WHERE table_name='minutes_history'").get()).n);
  const r = await AC.nightly(rdb); assert.ok(r.anchored >= 1);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM audit_chain_anchors WHERE table_name='minutes_history'").get()).n), before + 1);
  await db.exec('TRUNCATE minutes_history');
  await assert.rejects(AC.nightly(rdb), /audit chain broken: .*minutes_history/);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM audit_chain_anchors WHERE table_name='minutes_history'").get()).n), before + 1, 'no anchor over a broken chain');
});

test('R5-A3: a shadow ledger earlier on the search_path is reported (reads are schema-qualified)', async () => {
  const { Client } = require('pg');
  const rdb = require('../reports-db'); const db = rdb.pgHandle(); const AC = require('../services/auditChain');
  const real = (await db.prepare('SELECT current_schema() AS s').get()).s;
  const sh = 'r5_shadow_' + process.pid;
  await db.exec(`CREATE SCHEMA ${sh}`);
  await db.exec(`CREATE TABLE ${sh}.ppm_events (LIKE ${real}.ppm_events INCLUDING ALL)`);
  const c = new Client({ connectionString: process.env.PG_URL, options: `-c search_path=${sh},${real}` }); await c.connect();
  const prev = process.env.SDP_LEDGER_SCHEMA;
  try {
    const cdb = { prepare: (sql) => { let i = 0; const q = sql.replace(/\?/g, () => '$' + (++i)); return {
      get: async (...p) => (await c.query(q, p)).rows[0], all: async (...p) => (await c.query(q, p)).rows, run: async (...p) => c.query(q, p) }; } };
    process.env.SDP_LEDGER_SCHEMA = real;
    const v = await AC.verify(cdb);
    assert.equal(v.schema, real);
    const pe = v.tables.find((x) => x.table === 'ppm_events');
    assert.equal(pe.ok, false); assert.equal(pe.shadowed, true); assert.equal(v.ok, false);
    assert.equal(v.tables.find((x) => x.table === 'minutes_history').shadowed, undefined, 'unshadowed ledgers verify as usual');
    process.env.SDP_LEDGER_SCHEMA = 'bad name;';
    await assert.rejects(AC.verify(cdb), /plain schema name/);
  } finally {
    if (prev === undefined) delete process.env.SDP_LEDGER_SCHEMA; else process.env.SDP_LEDGER_SCHEMA = prev;
    await c.end(); await db.exec(`DROP SCHEMA ${sh} CASCADE`);
  }
});
