'use strict';
// One-time PostgreSQL provisioning for the SDP Dashboard + connection pre-flight.
// Used by _sdp_admin.cmd (options C and P) and runnable standalone.
//
//   CHECK (pre-flight):   node tools/pg/provision-prod.js --check
//     Reads PG_URL (or DATABASE_URL) from the environment or from .env in the
//     app root, connects, prints server version + database name. Exit 0 = OK.
//
//   PROVISION (one-time, needs the cluster SUPERUSER):
//     set PG_SUPER_URL=postgres://postgres:<superuser-pass>@localhost:5432/postgres
//     set SDP_APP_PASSWORD=<new password for the sdp_app role>
//     node tools/pg/provision-prod.js
//     Creates role sdp_app (LOGIN) + database sdp_dashboard (OWNER sdp_app).
//     Idempotent: re-running on an existing role/db is a no-op (password NOT
//     reset on an existing role — use --reset-password to force it).
//     NEVER touches fmp_v2 or any 4MyPeople object.
const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  // Minimal .env reader (KEY=VALUE lines) — avoids a dotenv dependency here.
  const p = path.join(__dirname, '../../.env');
  const out = {};
  try {
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (_) { /* no .env — fine */ }
  return out;
}

async function main() {
  const { Pool } = require('pg');
  const dotenv = loadDotEnv();
  const args = process.argv.slice(2);

  if (args.includes('--check')) {
    const url = process.env.PG_URL || process.env.DATABASE_URL || dotenv.PG_URL || dotenv.DATABASE_URL;
    if (!url) {
      console.error('[check] No PG_URL / DATABASE_URL set (env or .env). Nothing to test.');
      console.error('[check] Expected e.g.  PG_URL=postgres://sdp_app:...@localhost:5432/sdp_dashboard');
      process.exit(2);
    }
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 8000 });
    try {
      const r = await pool.query('SELECT version() AS v, current_database() AS db, current_user AS u');
      console.log('[check] OK — connected to database "' + r.rows[0].db + '" as "' + r.rows[0].u + '"');
      console.log('[check] ' + r.rows[0].v.split(',')[0]);
      const flags = ['TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'REPORTS_BACKEND']
        .map(k => k + '=' + (process.env[k] || dotenv[k] || 'sqlite')).join('  ');
      console.log('[check] Backend flags: ' + flags);
      process.exit(0);
    } catch (e) {
      console.error('[check] FAILED — ' + e.message);
      process.exit(1);
    } finally { await pool.end().catch(() => {}); }
  }

  // ── provision mode ──
  const superUrl = process.env.PG_SUPER_URL;
  const appPass  = process.env.SDP_APP_PASSWORD;
  if (!superUrl || !appPass) {
    console.error('Provision mode needs PG_SUPER_URL (cluster superuser) + SDP_APP_PASSWORD (new sdp_app password).');
    process.exit(2);
  }
  const pool = new Pool({ connectionString: superUrl, max: 1, connectionTimeoutMillis: 8000 });
  try {
    const role = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'sdp_app'");
    if (role.rowCount === 0) {
      // Identifier is fixed ('sdp_app'); only the password is parameterized-ish —
      // escape single quotes since CREATE ROLE can't take bind params.
      await pool.query("CREATE ROLE sdp_app LOGIN PASSWORD '" + appPass.replace(/'/g, "''") + "'");
      console.log('[provision] role sdp_app created');
    } else if (args.includes('--reset-password')) {
      await pool.query("ALTER ROLE sdp_app PASSWORD '" + appPass.replace(/'/g, "''") + "'");
      console.log('[provision] role sdp_app exists — password RESET');
    } else {
      console.log('[provision] role sdp_app already exists (password unchanged; use --reset-password to force)');
    }
    const db = await pool.query("SELECT 1 FROM pg_database WHERE datname = 'sdp_dashboard'");
    if (db.rowCount === 0) {
      await pool.query('CREATE DATABASE sdp_dashboard OWNER sdp_app');
      console.log('[provision] database sdp_dashboard created (owner sdp_app)');
    } else {
      console.log('[provision] database sdp_dashboard already exists');
    }
    console.log('[provision] DONE. Add to .env:  PG_URL=postgres://sdp_app:<password>@localhost:5432/sdp_dashboard');
    console.log('[provision] fmp_v2 / 4MyPeople objects were NOT touched.');
    process.exit(0);
  } catch (e) {
    console.error('[provision] FAILED — ' + e.message);
    process.exit(1);
  } finally { await pool.end().catch(() => {}); }
}

main();
