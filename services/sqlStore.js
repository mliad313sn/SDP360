'use strict';
// Stores of SDP-Dashboard 2.0 (steps 8 onwards) keep ONE schema: their migration file db/postgres/reports/NNN_*.sql.
// PostgreSQL gets it from the migrator (db/migrate.js); SQLite (tests, development) executes the same file once per
// database here — SQLite accepts the same DDL. handle(file) → { H, isPg } where H has the better-sqlite3-shaped
// prepare(sql).get/all/run (async on PostgreSQL, see services/pgDb.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const done = new WeakMap();
function handle(file) {
  const rdb = require('../reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
  const H = rdb.db;
  const set = done.get(H) || new Set();
  if (!set.has(file)) { H.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'postgres', 'reports', file), 'utf8')); set.add(file); done.set(H, set); }
  return { H, isPg: false };
}
const newId = (p) => p + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const now = () => new Date().toISOString();
const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch (_) { return d; } };

module.exports = { handle, newId, now, parse };
