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

// P11 round 3 R3-A1 — the list is derived from the code (services/auditChain.js), never re-typed here: the script
// once covered 6 of the 12 hash-chained tables and this test pinned the same 6.
const TABLES = [...require('../services/auditChain').TABLES];
// minimal pgDb-shaped adapter over a raw pg Client (? → $n), so services/auditChain.verify runs AS the app role
const clientDb = (c) => ({ prepare: (sql) => { let i = 0; const q = sql.replace(/\?/g, () => '$' + (++i)); return {
  get: async (...p) => (await c.query(q, p)).rows[0], all: async (...p) => (await c.query(q, p)).rows, run: async (...p) => c.query(q, p) }; } });
const SCRIPT = path.join(__dirname, '..', 'tools', 'pg', 'harden-audit-grants.sql');
const scriptTables = () => {
  const m = fs.readFileSync(SCRIPT, 'utf8').match(/set_config\('sdp\.audit_tables',\s*'([^']*)'/);
  return m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : [];
};

test('harden-audit-grants.sql covers exactly the hash-chained audit tables of services/auditChain.js', () => {
  assert.deepEqual([...scriptTables()].sort(), [...TABLES].sort());
  // no table list may be hard-coded elsewhere in the script (one list, read through sdp.audit_tables)
  assert.ok(!/ARRAY\['/.test(fs.readFileSync(SCRIPT, 'utf8')), 'the script iterates sdp.audit_tables, not a literal array');
});

test('every hash-chained table in the migrated schema is in auditChain.TABLES and is append-only', async () => {
  const c = new Client({ connectionString: process.env.PG_URL }); await c.connect();
  try {
    const sch = (await c.query('SELECT current_schema() AS s')).rows[0].s;
    const trig = (await c.query(`SELECT c.relname AS t, tg.tgname AS g FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND NOT tg.tgisinternal`, [sch])).rows;
    const chained = [...new Set(trig.filter((r) => r.g === r.t + '_hash_chain').map((r) => r.t))].sort();
    assert.deepEqual(chained, [...TABLES].sort(), 'hash-chained tables in the schema = auditChain.TABLES');
    for (const t of TABLES) assert.ok(trig.some((r) => r.t === t && r.g === t + '_append_only'), `${t} is append-only`);
  } finally { await c.end(); }
});

test('harden-audit-grants.sql: the app role reads and appends, never edits, deletes or disables triggers', async (t) => {
  const url = process.env.PG_URL;
  const admin = new Client({ connectionString: url }); await admin.connect();
  try {
    const su = (await admin.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')).rows[0];
    if (!su || !su.rolsuper) { t.skip('needs a superuser connection (the DBA step runs as one)'); return; }
    const schema = (await admin.query('SELECT current_schema() AS s')).rows[0].s;
    const role = 'sdp_app_rehearsal_' + crypto.randomBytes(4).toString('hex'); const pass = crypto.randomBytes(12).toString('hex');
    const dbName = (await admin.query('SELECT current_database() AS d')).rows[0].d;
    let datOwner = null; let nspOwner = null;
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${pass}'`);
    try {
      await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
      // today the app role OWNS its tables: reproduce that, then run the script as written for psql
      for (const tb of TABLES) await admin.query(`ALTER TABLE ${tb} OWNER TO ${role}`);
      // P11 r4 R4-A1 — and, as in production, it owns the DATABASE (so `public`, owned by pg_database_owner, is its
      // schema) — or, in the schema fallback, the schema itself. A schema owner may DROP any table in it.
      ({ datOwner, nspOwner } = (await admin.query(`SELECT pg_get_userbyid(d.datdba) AS "datOwner", pg_get_userbyid(n.nspowner) AS "nspOwner"
        FROM pg_database d, pg_namespace n WHERE d.datname = current_database() AND n.nspname = $1`, [schema])).rows[0]);
      await admin.query(`ALTER DATABASE "${dbName}" OWNER TO ${role}`);
      if (nspOwner !== 'pg_database_owner') await admin.query(`ALTER SCHEMA ${schema} OWNER TO ${role}`);
      const sql = fs.readFileSync(SCRIPT, 'utf8')
        .split('\n').filter((l) => !l.startsWith('\\')).join('\n').replace(/:'app_role'/g, `'${role}'`);
      await admin.query(sql);
      const owners = (await admin.query(`SELECT tablename, tableowner FROM pg_tables WHERE schemaname = $1 AND tablename = ANY($2)`, [schema, TABLES])).rows;
      assert.equal(owners.length, TABLES.length);
      assert.ok(owners.every((o) => o.tableowner === 'sdp_audit_owner'), JSON.stringify(owners));
      const fns = (await admin.query("SELECT p.proname, r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname IN ('sdp_append_only', 'sdp_hash_chain', 'sdp_chain_payload')")).rows;
      assert.ok(fns.length >= 3 && fns.every((f) => f.rolname === 'sdp_audit_owner'), JSON.stringify(fns));
      const u = new URL(url); u.username = role; u.password = pass;
      const app = new Client({ connectionString: u.toString(), options: `-c search_path=${schema}` }); await app.connect();
      try {
        await app.query("INSERT INTO minutes_history (session_id, action, actor_id, at, reason) VALUES (1, 'accepted', 1, '2026-10-29T00:00:00Z', 'rehearsal')");
        const n = (await app.query('SELECT COUNT(*)::int AS n FROM minutes_history')).rows[0].n; assert.ok(n >= 1, 'append + read');
        await assert.rejects(app.query("UPDATE minutes_history SET reason = 'x'"), /permission denied|append-only/);
        await assert.rejects(app.query('DELETE FROM minutes_history'), /permission denied|append-only/);
        await assert.rejects(app.query('ALTER TABLE minutes_history DISABLE TRIGGER minutes_history_append_only'), /must be owner|permission denied/);
        await assert.rejects(app.query('TRUNCATE governance_role_events'), /permission denied/);
        // R3-A1 — the ledgers the script used to miss
        for (const tb of ['ppm_events', 'report_publications', 'weekly_report_submissions', 'access_request_events', 'finance_certification_events', 'wan_sla_claim_events']) {
          await assert.rejects(app.query(`TRUNCATE ${tb}`), /permission denied/, `TRUNCATE ${tb}`);
          await assert.rejects(app.query(`ALTER TABLE ${tb} DISABLE TRIGGER ${tb}_append_only`), /must be owner|permission denied/, `DISABLE TRIGGER ${tb}`);
        }
        // R4-A1 — the app role owns the database, yet no ledger can be dropped or renamed (schema handed to the owner)
        const sOwner = (await admin.query('SELECT pg_get_userbyid(nspowner) AS o FROM pg_namespace WHERE nspname = $1', [schema])).rows[0].o;
        assert.equal(sOwner, 'sdp_audit_owner', 'the schema holding the ledgers left the database owner');
        for (const tb of TABLES) {
          await assert.rejects(app.query(`DROP TABLE ${tb}`), /must be owner|permission denied/, `DROP ${tb}`);
          await assert.rejects(app.query(`TRUNCATE ${tb}`), /permission denied/, `TRUNCATE ${tb}`);
          await assert.rejects(app.query(`UPDATE ${tb} SET id = DEFAULT WHERE false`), /permission denied|append-only/, `UPDATE ${tb}`);
          await assert.rejects(app.query(`DELETE FROM ${tb}`), /permission denied|append-only/, `DELETE ${tb}`);
        }
        await assert.rejects(app.query('ALTER TABLE ppm_events RENAME TO ppm_events_gone'), /must be owner|permission denied/);
        await assert.rejects(app.query(`ALTER SCHEMA ${schema} OWNER TO ${role}`), /must be owner|permission denied/);
        // the migrator (app role) still creates, alters and drops ITS OWN tables in the schema
        await app.query('CREATE TABLE r4_app_owned (id int)');
        await app.query('ALTER TABLE r4_app_owned ADD COLUMN x text');
        await app.query('DROP TABLE r4_app_owned');
        // P11 r5 R5-A3 — no shadow ledger: the app role can no longer create a schema (the database left it), nor plant
        // a copy in another schema, and a fresh session lands on the ledger schema (role search_path pinned)
        const dOwner = (await admin.query('SELECT pg_get_userbyid(datdba) AS o FROM pg_database WHERE datname = current_database()')).rows[0].o;
        assert.equal(dOwner, 'sdp_audit_owner', 'the database left the application role');
        await assert.rejects(app.query('CREATE SCHEMA r5_shadow'), /permission denied/, 'CREATE SCHEMA refused');
        await assert.rejects(app.query(`ALTER DATABASE "${dbName}" OWNER TO ${role}`), /must be owner|permission denied/);
        await app.query(`GRANT CREATE ON DATABASE "${dbName}" TO ${role}`).catch(() => {}); // a non-holder's GRANT only warns
        assert.equal((await admin.query('SELECT has_database_privilege($1, current_database(), \'CREATE\') AS c', [role])).rows[0].c, false, 'no CREATE on the database');
        const bare = new Client({ connectionString: u.toString() }); await bare.connect();
        try { assert.equal((await bare.query('SELECT current_schema() AS s')).rows[0].s, schema, 'search_path pinned to the ledger schema'); } finally { await bare.end(); }
        // the anchor table: append + read only
        await app.query("INSERT INTO audit_chain_anchors (table_name, schema_name, last_id, head, row_count) VALUES ('minutes_history', 'x', NULL, NULL, 0)");
        await assert.rejects(app.query('DELETE FROM audit_chain_anchors'), /permission denied|append-only/);
        await assert.rejects(app.query('TRUNCATE audit_chain_anchors'), /permission denied/);
        // the one place left (pg_temp, session-local) is reported by the verify: a temp copy of ppm_events shadows the name
        await app.query('CREATE TEMP TABLE ppm_events (LIKE ' + schema + '.ppm_events INCLUDING ALL)');
        const AC = require('../services/auditChain');
        const v = await AC.verify(clientDb(app));
        const pe = v.tables.find((x) => x.table === 'ppm_events');
        assert.equal(pe.ok, false); assert.equal(pe.shadowed, true); assert.equal(v.ok, false);
        assert.equal(v.schema, schema);
        await app.query('DROP TABLE pg_temp.ppm_events');
        // security review: the trigger functions are not the app role's to replace either
        await assert.rejects(app.query("CREATE OR REPLACE FUNCTION sdp_append_only() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$"), /must be owner|permission denied/);
        await assert.rejects(app.query("CREATE OR REPLACE FUNCTION sdp_hash_chain() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$"), /must be owner|permission denied/);
      } finally { await app.end(); }
    } finally {
      await admin.query(`ALTER ROLE ${role} IN DATABASE "${dbName}" RESET ALL`).catch(() => {});
      await admin.query(`REVOKE ALL ON DATABASE "${dbName}" FROM ${role}`).catch(() => {});
      await admin.query('ALTER TABLE audit_chain_anchors OWNER TO current_user').catch(() => {});
      if (datOwner) await admin.query(`ALTER DATABASE "${dbName}" OWNER TO "${datOwner}"`).catch(() => {});
      if (nspOwner) await admin.query(`ALTER SCHEMA ${schema} OWNER TO "${nspOwner}"`).catch(() => {});
      await admin.query(`DROP TABLE IF EXISTS r4_app_owned`).catch(() => {});
      for (const tb of TABLES) await admin.query(`ALTER TABLE ${tb} OWNER TO current_user`).catch(() => {});
      for (const fn of ['sdp_append_only()', 'sdp_hash_chain()', 'sdp_chain_payload(jsonb)']) await admin.query(`ALTER FUNCTION ${fn} OWNER TO current_user`).catch(() => {});
      await admin.query(`REVOKE ALL ON SCHEMA ${schema} FROM ${role}`).catch(() => {});
      for (const tb of TABLES) await admin.query(`REVOKE ALL ON ${tb} FROM ${role}`).catch(() => {});
      await admin.query(`REVOKE ALL ON audit_chain_anchors FROM ${role}`).catch(() => {});
      await admin.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM ${role}`).catch(() => {});
      await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
    }
  } finally { await admin.end(); }
});
