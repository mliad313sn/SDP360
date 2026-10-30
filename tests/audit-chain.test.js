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
