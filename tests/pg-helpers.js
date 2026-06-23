'use strict';
const { Client } = require('pg');
const ADMIN = process.env.PG_ADMIN_URL || 'postgres://postgres:devpass@localhost:5433/postgres';

// Returns a connection context for a fresh per-run DB, or null if Postgres is unreachable.
async function provisionTestDb() {
  let admin;
  try { admin = new Client({ connectionString: ADMIN }); await admin.connect(); }
  catch (_) { return null; }                       // Docker/PG down → caller test.skip()s
  const name = 'sdp_tracker_test_' + Math.random().toString(36).slice(2, 8);
  await admin.query(`CREATE DATABASE ${name}`);     // can't run inside a transaction — bare conn
  await admin.end();
  return { url: ADMIN.replace(/\/postgres$/, '/' + name), name, adminUrl: ADMIN };
}
async function dropTestDb(ctx) {
  if (!ctx) return;
  const admin = new Client({ connectionString: ctx.adminUrl }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${ctx.name} WITH (FORCE)`);
  await admin.end();
}
module.exports = { provisionTestDb, dropTestDb };
