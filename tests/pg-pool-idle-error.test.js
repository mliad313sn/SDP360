'use strict';
// A terminated IDLE pooled connection must not crash the process (node-pg emits 'error' on the pool;
// with no listener it is an uncaught exception). Found by the B-05 browser journeys in CI: a test
// database dropped WITH (FORCE) while a pooled client sat idle killed the journey.
const test = require('node:test');
const assert = require('node:assert');
const { Client } = require('pg');
const { makePgDb } = require('../services/pgDb');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('an idle pooled client killed by the server is logged, not thrown, and the pool recovers', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) { t.skip('no PostgreSQL'); return; }
  const db = makePgDb(ctx.url);
  await db.connect();
  const before = await db.prepare('SELECT pg_backend_pid() AS pid').get();
  const uncaught = [];
  const onUncaught = (e) => uncaught.push(e);
  process.on('uncaughtException', onUncaught);
  const origErr = console.error; const logged = []; console.error = (...a) => logged.push(a.join(' '));
  try {
    const admin = new Client({ connectionString: ctx.url }); await admin.connect();
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()');
    await admin.end();
    await new Promise((r) => setTimeout(r, 300));
    assert.deepStrictEqual(uncaught.map((e) => e && e.code), [], 'no uncaught exception');
    assert.ok(logged.some((l) => l.includes('[pgDb] idle PostgreSQL client lost')), 'the loss is logged');
    const after = await db.prepare('SELECT pg_backend_pid() AS pid').get();
    assert.ok(after.pid && after.pid !== before.pid, 'the pool opened a fresh connection');
  } finally {
    console.error = origErr;
    process.removeListener('uncaughtException', onUncaught);
    await db.close();
    await dropTestDb(ctx);
  }
});
