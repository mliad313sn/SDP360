'use strict';
// P11 round 6 R6-A2 — the chain verify no longer fails OPEN in the default (unhardened, no SDP_LEDGER_SCHEMA) state:
//  (a) a search_path shadow with empty copies of every ledger, and no anchor table in it → 'unverifiable', not ok;
//  (b) one ledger not verifiable → overall not ok;
//  (c) anchor rows are HMAC-signed with SDP_CONFIG_KEY: a row INSERTed by the application role (unsigned after the
//      first signed one, or with a wrong signature) is flagged, and cannot reset the baseline; without the key the
//      anchors are reported as advisory;
//  (d) the nightly job throws (→ sync alert) on an unverifiable result.
const { test } = require('node:test');
const assert = require('node:assert');

const KEY = 'unit-test-config-key-0123456789abcdef';

async function reset(n) {
  const rdb = require('../reports-db'); const db = rdb.pgHandle(); const AC = require('../services/auditChain');
  await db.exec('ALTER TABLE audit_chain_anchors DISABLE TRIGGER audit_chain_anchors_no_truncate');
  try { await require('./_pg-fresh').truncate(['minutes_history', 'audit_chain_anchors', 'system_log']); }
  finally { await db.exec('ALTER TABLE audit_chain_anchors ENABLE TRIGGER audit_chain_anchors_no_truncate'); }
  for (let i = 1; i <= n; i++) await db.prepare("INSERT INTO minutes_history (session_id, action, actor_id, at, reason) VALUES (1, 'accepted', 1, ?, ?)").run(`2026-11-0${i}T10:00:00Z`, 'x' + i);
  return { rdb, db, AC, real: (await db.prepare('SELECT current_schema() AS s').get()).s };
}
const mh = (v) => v.tables.find((x) => x.table === 'minutes_history');

test('R6-A2 (a): a search_path shadow of every ledger without the anchor table is UNVERIFIABLE, never ok', async () => {
  const { db, AC, real } = await reset(2);
  const v0 = await AC.verify(db, { key: null }); assert.equal(v0.ok, true); assert.equal(v0.status, 'ok');
  await AC.recordAnchors(db, v0, { key: null });
  const { Client } = require('pg');
  const sh = 'r6a2_shadow_' + process.pid;
  await db.exec(`CREATE SCHEMA ${sh}`);
  for (const t of AC.TABLES) await db.exec(`CREATE TABLE ${sh}.${t} (LIKE "${real}".${t} INCLUDING ALL)`);
  const c = new Client({ connectionString: process.env.PG_URL, options: `-c search_path=${sh},${real}` }); await c.connect();
  const saved = process.env.SDP_LEDGER_SCHEMA; delete process.env.SDP_LEDGER_SCHEMA;
  try {
    const cdb = { prepare: (sql) => { let i = 0; const q = sql.replace(/\?/g, () => '$' + (++i)); return {
      get: async (...p) => (await c.query(q, p)).rows[0], all: async (...p) => (await c.query(q, p)).rows, run: async (...p) => c.query(q, p) }; } };
    const v = await AC.verify(cdb, { key: null });
    assert.equal(v.schema, sh);
    assert.equal(v.anchors, false);
    assert.equal(v.ok, false, 'the shadow no longer verifies ok');
    assert.equal(v.status, 'unverifiable');
    assert.match(v.anchor_error, /anchors expected/);
    // (b) one ledger missing from the shadow: not verifiable → overall still not ok
    await db.exec(`DROP TABLE ${sh}.minutes_history`);
    const v2 = await AC.verify(cdb, { key: null });
    assert.equal(v2.ok, false);
    assert.notEqual(mh(v2).ok, true);
  } finally { await c.end(); await db.exec(`DROP SCHEMA ${sh} CASCADE`); if (saved !== undefined) process.env.SDP_LEDGER_SCHEMA = saved; }
});

test('R6-A2 (b): an unverifiable ledger makes the whole result not ok (status unverifiable)', async () => {
  const { db, AC } = await reset(1);
  const wrapped = { prepare: (sql) => {
    if (/FROM "[^"]+"\."minutes_history" x ORDER BY id/.test(sql)) return { all: async () => { throw new Error('permission denied'); }, get: async () => { throw new Error('permission denied'); } };
    return db.prepare(sql);
  } };
  const v = await AC.verify(wrapped, { key: null });
  assert.equal(mh(v).ok, null);
  assert.equal(v.ok, false);
  assert.equal(v.status, 'unverifiable');
});

test('R6-A2 (c): signed anchors — an app-role INSERT (unsigned or wrong signature) is flagged and cannot reset the baseline', async () => {
  const { db, AC, real } = await reset(3);
  const key = AC.anchorKey({ SDP_CONFIG_KEY: KEY });
  const v = await AC.verify(db, { key }); assert.equal(v.ok, true);
  assert.ok(await AC.recordAnchors(db, v, { key }) >= 1);
  const signed = await db.prepare("SELECT sig FROM audit_chain_anchors WHERE table_name = 'minutes_history'").get();
  assert.match(signed.sig, /^[0-9a-f]{64}$/);
  assert.equal((await AC.verify(db, { key })).anchor_integrity, 'signed');
  // round 6 attack: baseline reset to 0 rows by a direct INSERT (unsigned)
  await db.prepare('INSERT INTO audit_chain_anchors (table_name, schema_name, last_id, head, row_count) VALUES (\'minutes_history\', ?, NULL, NULL, 0)').run(real);
  let r = await AC.verify(db, { key });
  assert.equal(r.ok, false); assert.equal(r.status, 'broken');
  assert.match(mh(r).anchor_error, /not signed by the nightly job/);
  // a row with a made-up signature
  await db.exec('ALTER TABLE audit_chain_anchors DISABLE TRIGGER audit_chain_anchors_no_truncate');
  try { await db.exec('TRUNCATE audit_chain_anchors'); } finally { await db.exec('ALTER TABLE audit_chain_anchors ENABLE TRIGGER audit_chain_anchors_no_truncate'); }
  await AC.recordAnchors(db, await AC.verify(db, { key, anchors: false }).then((x) => ({ ...x, anchors: true })), { key });
  await db.prepare('INSERT INTO audit_chain_anchors (table_name, schema_name, last_id, head, row_count, sig) VALUES (\'minutes_history\', ?, NULL, NULL, 999, ?)').run(real, 'f'.repeat(64));
  r = await AC.verify(db, { key });
  assert.equal(r.ok, false); assert.match(mh(r).anchor_error, /forged or altered/);
  // without the key, signed anchors cannot be checked: unverifiable, never ok (P11 r7 F-32 — was "advisory" and ok)
  const adv = await AC.verify(db, { key: null });
  assert.match(adv.anchor_integrity, /unverifiable \(signed anchors present, no SDP_CONFIG_KEY\)/);
  assert.equal(adv.ok, false);
});

test('R6-A2 (c): replaying an OLDER signed anchor row cannot lower the baseline', async () => {
  const { db, AC } = await reset(2);
  const key = AC.anchorKey({ SDP_CONFIG_KEY: KEY });
  await AC.recordAnchors(db, await AC.verify(db, { key }), { key });
  const old = await db.prepare("SELECT table_name, schema_name, last_id, head, row_count, sig FROM audit_chain_anchors WHERE table_name = 'minutes_history'").get();
  await db.prepare("INSERT INTO minutes_history (session_id, action, actor_id, at, reason) VALUES (1, 'accepted', 1, '2026-11-08T10:00:00Z', 'x3')").run();
  await AC.recordAnchors(db, await AC.verify(db, { key }), { key });
  // copy of the older (validly signed) row re-inserted last
  await db.prepare('INSERT INTO audit_chain_anchors (table_name, schema_name, last_id, head, row_count, sig) VALUES (?, ?, ?, ?, ?, ?)').run(old.table_name, old.schema_name, old.last_id, old.head, old.row_count, old.sig);
  const t = mh(await AC.verify(db, { key }));
  assert.equal(t.ok, true);
  assert.equal(t.anchor.row_count, 3, 'the baseline stays the highest signed anchor');
  // and a tail delete is still caught against it
  await db.exec('ALTER TABLE minutes_history DISABLE TRIGGER minutes_history_append_only');
  try {
    await db.exec('DELETE FROM minutes_history WHERE id = (SELECT max(id) FROM minutes_history)');
    assert.equal(mh(await AC.verify(db, { key })).ok, false);
  } finally { await db.exec('ALTER TABLE minutes_history ENABLE TRIGGER minutes_history_append_only'); }
});

test('R6-A2 (c) pure: legacy unsigned rows before the first signed one are tolerated, later ones are forged', () => {
  const AC = require('../services/auditChain');
  const key = AC.anchorKey({ SDP_CONFIG_KEY: KEY });
  const row = (id, n, signed) => { const r = { id, table_name: 't', schema_name: 's', last_id: n, head: 'h' + n, row_count: n }; if (signed) r.sig = AC.anchorSig(key, r); return r; };
  let c = AC.chooseAnchor([row(1, 1, false), row(2, 2, true), row(3, 3, true)], { key, sigColumn: true });
  assert.deepEqual(c.forged, []); assert.equal(c.anchor.id, 3); assert.equal(c.integrity, 'signed');
  c = AC.chooseAnchor([row(1, 1, false), row(2, 2, true), row(3, 0, false)], { key, sigColumn: true });
  assert.deepEqual(c.forged, [3]); assert.equal(c.anchor.id, 2);
  c = AC.chooseAnchor([row(1, 1, false)], { key: null, sigColumn: true });
  assert.match(c.integrity, /advisory/);
  assert.equal(AC.anchorKey({}), null);
});

test('R6-A2 (d): the nightly job throws on an unverifiable result (the sync runner alerts)', async () => {
  const { rdb, db, AC } = await reset(1);
  const wrapped = { prepare: (sql) => (/FROM "[^"]+"\."minutes_history" x ORDER BY id/.test(sql) ? { all: async () => { throw new Error('denied'); } } : db.prepare(sql)) };
  const events = [];
  await assert.rejects(AC.nightly({ pgHandle: () => wrapped, logEvent: async (ev) => { events.push(ev); } }), /audit chain unverifiable/);
  assert.equal(events[0].action, 'audit_chain_unverifiable');
  assert.ok(rdb);
});
