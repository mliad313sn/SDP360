'use strict';
// Verification of the hash-chained audit tables (migration 034, committee review 2026-10-28).
// For each table, every row's hash is recomputed in the database from its content and the previous
// row's hash; the first row that does not match is reported.
//
// P11 round 5 (R5-A3 + AUD-2, ADR docs/ai-decisions/ADR-P11-R5-audit-chain-anchor.md):
//  - every ledger read is SCHEMA-QUALIFIED with the ledger schema (SDP_LEDGER_SCHEMA in .env, else the session's
//    current_schema()), so a same-named table in pg_temp or earlier on a role's search_path is never what we verify;
//    and if the UNQUALIFIED name (what the application's writers use) resolves to a different table, the ledger is
//    reported as shadowed (ok:false).
//  - the chain heads are anchored DAILY in audit_chain_anchors (migration 131, append-only, SELECT+INSERT for the app
//    role once hardened): each run compares the live chain with the last anchor — the anchored row must still exist
//    with the same hash and the row count may not shrink. A tail delete, a TRUNCATE, a rewrite with a recomputed chain
//    or a swap for an empty shadow copy no longer verifies as ok.
const TABLES = Object.freeze(['governance_policy_history', 'handoff_events', 'commitment_events', 'closure_verifications', 'minutes_history', 'governance_role_events', 'ppm_events', 'report_publications', 'weekly_report_submissions', 'access_request_events', 'finance_certification_events', 'wan_sla_claim_events']);
const ANCHOR_TABLE = 'audit_chain_anchors';
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

async function ledgerSchema(db) {
  const env = String(process.env.SDP_LEDGER_SCHEMA || '').trim();
  if (env) {
    if (!IDENT.test(env)) throw new Error('SDP_LEDGER_SCHEMA is not a plain schema name');
    return env;
  }
  return (await db.prepare('SELECT current_schema() AS s').get()).s;
}
const qual = (s, t) => `"${s}"."${t}"`;

async function lastAnchor(db, schema, table) {
  return db.prepare(`SELECT last_id, head, row_count, anchored_at FROM ${qual(schema, ANCHOR_TABLE)} WHERE table_name = ? ORDER BY id DESC LIMIT 1`).get(table);
}

/** Compare the live rows with the last anchor; returns null when the chain extends it, else the reason. */
function anchorBreak(rows, anchor) {
  if (!anchor) return null;
  const n = Number(anchor.row_count);
  if (rows.length < n) return `row count shrank from ${n} (last anchor) to ${rows.length} — tail delete, truncate or substituted table`;
  if (anchor.last_id != null) {
    const r = rows.find((x) => Number(x.id) === Number(anchor.last_id));
    if (!r) return `anchored row #${anchor.last_id} is gone — tail delete, truncate or substituted table`;
    if (r.row_hash !== anchor.head) return `anchored row #${anchor.last_id} no longer carries the anchored hash — chain rewritten`;
  }
  return null;
}

async function verify(db, opts = {}) {
  const schema = await ledgerSchema(db);
  const useAnchors = opts.anchors !== false;
  let hasAnchors = false;
  if (useAnchors) {
    try { hasAnchors = !!(await db.prepare('SELECT to_regclass(?) AS r').get(qual(schema, ANCHOR_TABLE))).r; } catch (_) { hasAnchors = false; }
  }
  const out = [];
  for (const t of TABLES) {
    try {
      const res = await db.prepare('SELECT to_regclass(?)::oid::text AS q, to_regclass(?)::oid::text AS u').get(qual(schema, t), t);
      if (!res || !res.q) { out.push({ table: t, rows: null, ok: null, error: 'not verifiable (table or migration 034 missing)' }); continue; }
      if (res.u !== res.q) {
        out.push({ table: t, rows: null, ok: false, first_broken_id: null, head: null, shadowed: true,
          error: `the unqualified name ${t} resolves to another table than ${schema}.${t} — shadowed on the search path` });
        continue;
      }
      const rows = await db.prepare(`SELECT id, prev_hash, row_hash,
          encode(sha256(convert_to(coalesce(prev_hash, '') || sdp_chain_payload(to_jsonb(x)), 'UTF8')), 'hex') AS calc,
          lag(row_hash) OVER (ORDER BY id) AS expected_prev
        FROM ${qual(schema, t)} x ORDER BY id`).all();
      const bad = rows.find((r) => !r.row_hash || r.calc !== r.row_hash || (r.prev_hash || null) !== (r.expected_prev || null));
      const anchor = hasAnchors ? await lastAnchor(db, schema, t) : null;
      const brk = anchorBreak(rows, anchor);
      const last = rows.length ? rows[rows.length - 1] : null;
      out.push({ table: t, rows: rows.length, ok: !bad && !brk, first_broken_id: bad ? Number(bad.id) : null,
        head: last ? last.row_hash : null, last_id: last ? Number(last.id) : null,
        anchor: anchor ? { last_id: anchor.last_id == null ? null : Number(anchor.last_id), row_count: Number(anchor.row_count) } : null,
        ...(brk ? { anchor_error: brk } : {}) });
    } catch (e) { out.push({ table: t, rows: null, ok: null, error: 'not verifiable (table or migration 034 missing)' }); }
  }
  return { ok: out.every((x) => x.ok !== false), schema, anchors: hasAnchors, tables: out, checked_at: new Date().toISOString() };
}

/** Persist today's anchor for every ledger that verified ok (never over a broken chain: the last good anchor stays). */
async function recordAnchors(db, result) {
  if (!result || !result.anchors) return 0;
  let n = 0;
  for (const x of result.tables) {
    if (x.ok !== true || x.rows == null) continue;
    await db.prepare(`INSERT INTO ${qual(result.schema, ANCHOR_TABLE)} (table_name, schema_name, last_id, head, row_count) VALUES (?, ?, ?, ?, ?)`)
      .run(x.table, result.schema, x.last_id, x.head, x.rows);
    n++;
  }
  return n;
}

/** The nightly job body (services/sync/jobs.js audit.chain_verify): verify, log, anchor; a broken chain throws. */
async function nightly(rdb) {
  const db = rdb.pgHandle ? rdb.pgHandle() : rdb.db;
  const r = await verify(db);
  const anchored = r.ok ? await recordAnchors(db, r) : 0;
  await rdb.logEvent({ category: 'governance', action: r.ok ? 'audit_chain_anchor' : 'audit_chain_broken', target: 'audit',
    details: { schema: r.schema, anchored, tables: r.tables.map((x) => ({ table: x.table, rows: x.rows, ok: x.ok, head: x.head, last_id: x.last_id == null ? null : x.last_id, first_broken_id: x.first_broken_id, ...(x.anchor_error ? { anchor_error: x.anchor_error } : {}), ...(x.shadowed ? { shadowed: true } : {}) })) }, risk: r.ok ? 0 : 1 });
  if (!r.ok) throw new Error('audit chain broken: ' + r.tables.filter((x) => x.ok === false).map((x) => `${x.table}#${x.first_broken_id != null ? x.first_broken_id : (x.anchor_error || x.error || '?')}`).join(', '));
  return { rows: r.tables.reduce((n, x) => n + (x.rows || 0), 0), anchored };
}

module.exports = { TABLES, ANCHOR_TABLE, verify, recordAnchors, anchorBreak, ledgerSchema, nightly };
