'use strict';
// P11 round 2 N-03 — /ready answered 200 on a READ-ONLY database (standby replica / default_transaction_read_only)
// while login returned 500. /ready gates sdp-manager auto-rollback and restore, so it must report 503 then.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const fetch = require('./_http-fetch');

function stubRdb({ rec = false, ro = 'off' } = {}) {
  return {
    getSyncStatus: async () => [],
    pgHandle: () => ({ prepare: (sql) => ({ get: async () => (/pg_is_in_recovery/.test(sql) ? { rec, ro } : { ok: 1 }) }) }),
  };
}
async function probe(rdb) {
  const app = express();
  app.use(require('../routes/health')({ express, getRdb: () => rdb, requireReportSession: (q, r, n) => n(),
    sync: { ensureReady: async () => {}, getStore: () => ({}) } }));
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/ready`);
    return { status: res.status, json: await res.json() };
  } finally { server.close(); }
}

test('writable primary: 200 with the unchanged public shape', async () => {
  const r = await probe(stubRdb());
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['db', 'last_job_at', 'ok']);
});

test('default_transaction_read_only=on: 503, writable:false', async () => {
  const r = await probe(stubRdb({ ro: 'on' }));
  assert.equal(r.status, 503);
  assert.equal(r.json.ok, false); assert.equal(r.json.db, true); assert.equal(r.json.writable, false); assert.equal(r.json.error, 'read_only');
});

test('standby in recovery: 503', async () => {
  assert.equal((await probe(stubRdb({ rec: true }))).status, 503);
  assert.equal((await probe(stubRdb({ rec: 't' }))).status, 503);
});

test('real PostgreSQL: the check query runs and a read-only transaction setting is detected', async () => {
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  const row = await rdb.pgHandle().prepare("SELECT pg_is_in_recovery() AS rec, current_setting('transaction_read_only') AS ro").get();
  assert.equal(row.rec, false); assert.equal(row.ro, 'off');
  assert.equal((await probe(rdb)).status, 200, 'a writable test database is ready');
});

test('real PostgreSQL: a database set default_transaction_read_only=on makes /ready 503', async () => {
  const { Client } = require('pg');
  const admin = new Client({ connectionString: process.env.PG_URL }); await admin.connect();
  const dbName = (await admin.query('SELECT current_database() AS d')).rows[0].d;
  await admin.query(`ALTER DATABASE "${dbName}" SET default_transaction_read_only = on`);
  const fresh = new Client({ connectionString: process.env.PG_URL }); await fresh.connect();   // picks up the setting
  try {
    const roRdb = { getSyncStatus: async () => [], pgHandle: () => ({ prepare: (sql) => ({ get: async () => (await fresh.query(sql)).rows[0] }) }) };
    const r = await probe(roRdb);
    assert.equal(r.status, 503); assert.equal(r.json.writable, false);
  } finally {
    await fresh.end();
    await admin.query(`ALTER DATABASE "${dbName}" RESET default_transaction_read_only`); await admin.end();
  }
});
