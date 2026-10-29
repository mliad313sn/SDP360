'use strict';
// Rehearsal of tools/pg/harden-audit-grants.sql (the DBA step of committee #43) on the throwaway test
// database: after it, the application role can still read and append to the audit tables, but can no
// longer edit, delete, or switch their triggers off. Needs a superuser connection (CI's postgres service,
// a dev cluster); without one the test says why and skips.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const TABLES = ['governance_policy_history', 'handoff_events', 'commitment_events', 'closure_verifications', 'minutes_history', 'governance_role_events'];

test('harden-audit-grants.sql: the app role reads and appends, never edits, deletes or disables triggers', async (t) => {
  const url = process.env.PG_URL;
  const admin = new Client({ connectionString: url }); await admin.connect();
  try {
    const su = (await admin.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')).rows[0];
    if (!su || !su.rolsuper) { t.skip('needs a superuser connection (the DBA step runs as one)'); return; }
    const schema = (await admin.query('SELECT current_schema() AS s')).rows[0].s;
    const role = 'sdp_app_rehearsal_' + crypto.randomBytes(4).toString('hex'); const pass = crypto.randomBytes(12).toString('hex');
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${pass}'`);
    try {
      await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
      // today the app role OWNS its tables: reproduce that, then run the script as written for psql
      for (const tb of TABLES) await admin.query(`ALTER TABLE ${tb} OWNER TO ${role}`);
      const sql = fs.readFileSync(path.join(__dirname, '..', 'tools', 'pg', 'harden-audit-grants.sql'), 'utf8')
        .split('\n').filter((l) => !l.startsWith('\\')).join('\n').replace(/:'app_role'/g, `'${role}'`);
      await admin.query(sql);
      const owners = (await admin.query(`SELECT tablename, tableowner FROM pg_tables WHERE schemaname = $1 AND tablename = ANY($2)`, [schema, TABLES])).rows;
      assert.equal(owners.length, TABLES.length);
      assert.ok(owners.every((o) => o.tableowner === 'sdp_audit_owner'), JSON.stringify(owners));
      const u = new URL(url); u.username = role; u.password = pass;
      const app = new Client({ connectionString: u.toString(), options: `-c search_path=${schema}` }); await app.connect();
      try {
        await app.query("INSERT INTO minutes_history (session_id, action, actor_id, at, reason) VALUES (1, 'accepted', 1, '2026-10-29T00:00:00Z', 'rehearsal')");
        const n = (await app.query('SELECT COUNT(*)::int AS n FROM minutes_history')).rows[0].n; assert.ok(n >= 1, 'append + read');
        await assert.rejects(app.query("UPDATE minutes_history SET reason = 'x'"), /permission denied|append-only/);
        await assert.rejects(app.query('DELETE FROM minutes_history'), /permission denied|append-only/);
        await assert.rejects(app.query('ALTER TABLE minutes_history DISABLE TRIGGER minutes_history_append_only'), /must be owner|permission denied/);
        await assert.rejects(app.query('TRUNCATE governance_role_events'), /permission denied/);
      } finally { await app.end(); }
    } finally {
      for (const tb of TABLES) await admin.query(`ALTER TABLE ${tb} OWNER TO current_user`).catch(() => {});
      await admin.query(`REVOKE ALL ON SCHEMA ${schema} FROM ${role}`).catch(() => {});
      for (const tb of TABLES) await admin.query(`REVOKE ALL ON ${tb} FROM ${role}`).catch(() => {});
      await admin.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM ${role}`).catch(() => {});
      await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
    }
  } finally { await admin.end(); }
});
