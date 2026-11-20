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
//
// P11 round 6 (R6-A2):
//  - a ledger that cannot be verified counts as NOT ok (status 'unverifiable'), never as ok;
//  - once anchors are expected (migration 131 recorded in schema_migrations, or an audit_chain_anchors table exists in
//    any schema of the database) and the anchor table cannot be resolved in the ledger schema, the whole result is
//    'unverifiable' (ok:false) — the nightly job then fails and the sync runner alerts;
//  - each anchor row carries an HMAC-SHA256 signature keyed from SDP_CONFIG_KEY (migration 135, column sig). With the
//    key set, an unsigned row written after the first signed one, or a row whose signature does not match, is flagged as
//    forged (ok:false), and the comparison baseline is taken only from correctly signed rows (the one with the highest
//    anchored id: replaying an older signed row cannot lower the baseline). Without the key, and without
//    tools/pg/harden-audit-grants.sql, the anchors are ADVISORY: verify says so in `anchor_integrity`.
const crypto = require('crypto');
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

// ---- R6-A2: anchor signatures ---------------------------------------------------------------------------------------
/** The HMAC key for anchor rows, derived from SDP_CONFIG_KEY (null when it is not set: anchors are then advisory). */
function anchorKey(env = process.env) {
  const k = String(env.SDP_CONFIG_KEY || '');
  if (!k) return null;
  return crypto.createHmac('sha256', k).update('sdp-audit-chain-anchor-v1').digest();
}
/** Signature of one anchor row (what the nightly job wrote: ledger, schema, last id, head hash, row count). */
function anchorSig(key, a) {
  const payload = JSON.stringify([String(a.table_name), String(a.schema_name), a.last_id == null ? null : String(Number(a.last_id)), a.head == null ? null : String(a.head), String(Number(a.row_count))]);
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}
const _sigEq = (a, b) => { const x = Buffer.from(String(a || ''), 'utf8'); const y = Buffer.from(String(b || ''), 'utf8'); return x.length === y.length && crypto.timingSafeEqual(x, y); };
async function hasSigColumn(db, schema) {
  try {
    return !!(await db.prepare("SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = 'sig'").get(schema, ANCHOR_TABLE));
  } catch (_) { return false; }
}
/**
 * Pure: classify the anchor rows of ONE ledger (ordered by id) and choose the comparison baseline.
 * Returns { anchor, forged:[ids], integrity }.
 */
function chooseAnchor(rows, { key, sigColumn }) {
  if (!rows || !rows.length) return { anchor: null, forged: [], integrity: key && sigColumn ? 'signed' : 'advisory' };
  if (!key || !sigColumn) return { anchor: rows[rows.length - 1], forged: [], integrity: !key ? 'advisory (no SDP_CONFIG_KEY)' : 'advisory (anchor sig column missing — re-run the hardening script)' };
  const valid = []; const forged = []; let firstSigned = null;
  for (const r of rows) {
    if (r.sig) {
      if (_sigEq(r.sig, anchorSig(key, r))) { valid.push(r); if (firstSigned == null) firstSigned = Number(r.id); } else forged.push(Number(r.id));
    }
  }
  // an unsigned row written after the first signed one did not come from the nightly job
  for (const r of rows) if (!r.sig && firstSigned != null && Number(r.id) > firstSigned) forged.push(Number(r.id));
  forged.sort((a, b) => a - b);
  if (!valid.length) return { anchor: rows.filter((r) => !r.sig).pop() || null, forged, integrity: 'unsigned (legacy rows written before SDP_CONFIG_KEY)' };
  const best = valid.reduce((m, r) => {
    const li = r.last_id == null ? -1 : Number(r.last_id); const mi = m.last_id == null ? -1 : Number(m.last_id);
    return li > mi || (li === mi && Number(r.row_count) > Number(m.row_count)) ? r : m;
  });
  return { anchor: best, forged, integrity: 'signed' };
}
/** Were anchors EXPECTED (migration 131 recorded, or an anchor table exists somewhere in this database)? */
async function anchorsExpected(db, schema) {
  const tries = [
    [`SELECT 1 AS ok FROM ${qual(schema, 'schema_migrations')} WHERE id = 'reports/131_audit_chain_anchor.sql'`],
    ["SELECT 1 AS ok FROM schema_migrations WHERE id = 'reports/131_audit_chain_anchor.sql'"],
    ["SELECT 1 AS ok FROM pg_class WHERE relname = 'audit_chain_anchors' AND relkind IN ('r', 'p') LIMIT 1"],
  ];
  for (const [sql] of tries) { try { if (await db.prepare(sql).get()) return true; } catch (_) { /* next source */ } }
  return false;
}

/** P11 r6 — were anchors ever written for this ledger? Read from the anchor table's identity sequence (anchors were
 *  written at all) and from the system_log 'audit_chain_anchor' events (this ledger was anchored ok). A TRUNCATE of the
 *  anchors (possible before tools/pg/harden-audit-grants.sql, now also refused by migration 132's trigger) therefore no
 *  longer leaves a chain check that compares nothing and passes. Best-effort: an unreadable source counts as "unknown",
 *  never as "anchored". */
async function anchorHistory(db, schema) {
  const out = { written: false, tables: new Set() };
  try {
    const r = await db.prepare(`SELECT pg_sequence_last_value(pg_get_serial_sequence(?, 'id')::regclass) AS v`).get(qual(schema, ANCHOR_TABLE));
    out.written = r && r.v != null;
  } catch (_) { /* no privilege / no sequence: unknown */ }
  try {
    const rows = await db.prepare(`SELECT details FROM ${qual(schema, 'system_log')} WHERE action = 'audit_chain_anchor' ORDER BY id DESC LIMIT 400`).all();
    for (const row of rows) {
      let d = null; try { d = typeof row.details === 'string' ? JSON.parse(row.details) : row.details; } catch (_) { d = null; }
      if (!d || !(Number(d.anchored) > 0) || !Array.isArray(d.tables)) continue;
      for (const x of d.tables) if (x && x.ok === true && x.rows != null) out.tables.add(x.table);
    }
  } catch (_) { /* no system_log: unknown */ }
  return out;
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
  const history = hasAnchors ? await anchorHistory(db, schema) : { written: false, tables: new Set() };
  let anchorRows = null;
  if (hasAnchors) { try { anchorRows = Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${qual(schema, ANCHOR_TABLE)}`).get()).n); } catch (_) { anchorRows = null; } }
  // R6-A2: anchors expected but the anchor table is not in the ledger schema → unverifiable, never ok
  const expected = useAnchors && !hasAnchors ? await anchorsExpected(db, schema) : false;
  const key = opts.key !== undefined ? opts.key : anchorKey();
  const sigColumn = hasAnchors ? await hasSigColumn(db, schema) : false;
  const integrity = new Set();
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
      let anchor = null; let forged = [];
      if (hasAnchors) {
        const arows = await db.prepare(`SELECT id, table_name, schema_name, last_id, head, row_count${sigColumn ? ', sig' : ''} FROM ${qual(schema, ANCHOR_TABLE)} WHERE table_name = ? ORDER BY id`).all(t);
        const c = chooseAnchor(arows, { key, sigColumn });
        anchor = c.anchor; forged = c.forged; integrity.add(c.integrity);
      }
      let brk = forged.length ? `anchor row(s) #${forged.join(', #')} not signed by the nightly job (forged or altered anchor)` : null;
      if (!brk) brk = anchorBreak(rows, anchor);
      // P11 r6 — no anchor for a ledger that holds rows, while anchors were written before (the whole anchor table is
      // empty although its sequence moved, or this ledger was logged as anchored): the anchor history is missing.
      if (!brk && !anchor && rows.length && (history.tables.has(t) || (history.written && anchorRows === 0))) {
        brk = 'anchor history missing — anchors were written before and none is left for this ledger (anchor table emptied?)';
      }
      const last = rows.length ? rows[rows.length - 1] : null;
      out.push({ table: t, rows: rows.length, ok: !bad && !brk, first_broken_id: bad ? Number(bad.id) : null,
        head: last ? last.row_hash : null, last_id: last ? Number(last.id) : null,
        anchor: anchor ? { last_id: anchor.last_id == null ? null : Number(anchor.last_id), row_count: Number(anchor.row_count) } : null,
        ...(brk ? { anchor_error: brk } : {}) });
    } catch (e) { out.push({ table: t, rows: null, ok: null, error: 'not verifiable (table or migration 034 missing)' }); }
  }
  const broken = out.some((x) => x.ok === false);
  const unverifiable = out.some((x) => x.ok !== true && x.ok !== false) || expected;
  const status = broken ? 'broken' : (unverifiable ? 'unverifiable' : 'ok');
  const anchorIntegrity = !hasAnchors ? (expected ? 'missing' : 'none')
    : (integrity.has('signed') && integrity.size === 1 ? 'signed' : [...integrity].filter((x) => x !== 'signed').join('; ') || (key && sigColumn ? 'signed' : 'advisory'));
  return { ok: status === 'ok', status, schema, anchors: hasAnchors, anchor_integrity: anchorIntegrity,
    ...(expected ? { anchor_error: `anchors expected (migration 131 recorded or an anchor table exists) but ${schema}.${ANCHOR_TABLE} cannot be resolved — unverifiable` } : {}),
    tables: out, checked_at: new Date().toISOString() };
}

/** Persist today's anchor for every ledger that verified ok (never over a broken chain: the last good anchor stays). */
async function recordAnchors(db, result, opts = {}) {
  if (!result || !result.anchors) return 0;
  const key = opts.key !== undefined ? opts.key : anchorKey();
  const sigColumn = key ? await hasSigColumn(db, result.schema) : false;
  let n = 0;
  for (const x of result.tables) {
    if (x.ok !== true || x.rows == null) continue;
    if (key && sigColumn) {
      const sig = anchorSig(key, { table_name: x.table, schema_name: result.schema, last_id: x.last_id, head: x.head, row_count: x.rows });
      await db.prepare(`INSERT INTO ${qual(result.schema, ANCHOR_TABLE)} (table_name, schema_name, last_id, head, row_count, sig) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(x.table, result.schema, x.last_id, x.head, x.rows, sig);
    } else {
      await db.prepare(`INSERT INTO ${qual(result.schema, ANCHOR_TABLE)} (table_name, schema_name, last_id, head, row_count) VALUES (?, ?, ?, ?, ?)`)
        .run(x.table, result.schema, x.last_id, x.head, x.rows);
    }
    n++;
  }
  return n;
}

/** The nightly job body (services/sync/jobs.js audit.chain_verify): verify, log, anchor; a broken chain throws. */
async function nightly(rdb) {
  const db = rdb.pgHandle ? rdb.pgHandle() : rdb.db;
  const r = await verify(db);
  const anchored = r.ok ? await recordAnchors(db, r) : 0;
  await rdb.logEvent({ category: 'governance', action: r.ok ? 'audit_chain_anchor' : (r.status === 'unverifiable' ? 'audit_chain_unverifiable' : 'audit_chain_broken'), target: 'audit',
    details: { schema: r.schema, anchored, status: r.status, anchor_integrity: r.anchor_integrity, ...(r.anchor_error ? { anchor_error: r.anchor_error } : {}), tables: r.tables.map((x) => ({ table: x.table, rows: x.rows, ok: x.ok, head: x.head, last_id: x.last_id == null ? null : x.last_id, first_broken_id: x.first_broken_id, ...(x.anchor_error ? { anchor_error: x.anchor_error } : {}), ...(x.shadowed ? { shadowed: true } : {}) })) }, risk: r.ok ? 0 : 1 });
  if (!r.ok) {
    const bad = r.tables.filter((x) => x.ok !== true).map((x) => `${x.table}#${x.first_broken_id != null ? x.first_broken_id : (x.anchor_error || x.error || '?')}`);
    if (r.anchor_error) bad.unshift(r.anchor_error);
    throw new Error(`audit chain ${r.status}: ` + bad.join(', '));
  }
  return { rows: r.tables.reduce((n, x) => n + (x.rows || 0), 0), anchored };
}

module.exports = { TABLES, ANCHOR_TABLE, verify, recordAnchors, anchorBreak, anchorHistory, ledgerSchema, nightly, anchorKey, anchorSig, chooseAnchor, anchorsExpected };
