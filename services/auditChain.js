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
//
// P11 round 7 (O-8 / F-32 / R7-A2, ADR docs/ai-decisions/ADR-P11-R7-anchor-kid-token-binding.md):
//  - each anchor row records the KEY IDENTIFIER (kid, migration 137) of the key that signed it. A row signed under ANOTHER
//    key (documented SDP_CONFIG_KEY rotation, or a dump restored on a server with another key) is "unverifiable (key
//    rotated)", never "forged"; its content still constrains the live chain (it can only ADD conditions, never lower the
//    baseline). The nightly job then records an audit_chain_key_rotated event and writes new anchors under the current
//    key, so the chain resumes instead of failing every night forever;
//  - signed anchors present but SDP_CONFIG_KEY absent → "unverifiable", never ok;
//  - the ledger schema is resolved strictly: SDP_LEDGER_SCHEMA, else current_schema() checked against the schema
//    recorded at migration time (audit_chain_meta 'ledger_schema'), and two schemas of the search path holding the
//    ledgers / anchors → unverifiable (a shadow schema with an empty anchor table no longer reads ok);
//  - the sig column missing although signed anchors were written (audit_chain_meta 'signed_anchors', a kid on a row,
//    or a nightly event) → unverifiable, never "advisory ok"; an empty anchor table is labelled 'none', not 'signed'.
//  The owner of an UNHARDENED database can still disable triggers and rewrite these facts: full protection needs
//  tools/pg/harden-audit-grants.sql (DBA / CAB step) and SDP_LEDGER_SCHEMA. That is stated, not claimed fixed.
//
// P11 round 8 (R8-A2 / O-11 / R8-4 / O-12, ADR docs/ai-decisions/ADR-P11-R8-anchor-rotation-resume.md):
//  - the nightly job resumes after a rotation only when every pending foreign kid is a KNOWN prior key (recorded in
//    audit_chain_meta 'kid:<kid>' when the job signed with it) — an unknown kid is "unverifiable", never resumed;
//  - with no anchor verified under the current key, the highest anchored position logged by the job in system_log
//    still constrains the ledger (a truncated ledger is "broken", never re-baselined);
//  - a database hardened before migration 137 (no kid column) names the remedy (re-run the hardening script).
//
// P11 round 9 (O-14 / R9-2 / O-16 / R9-A1, ADR docs/ai-decisions/ADR-P11-R9-signed-kid-history-anchor-events-request-origin.md):
//  - the kid history and the high-water mark are SIGNED (keys derived from SDP_CONFIG_KEY, outside the database): an
//    app-role row 'kid:<x>' or an unsigned / altered audit_chain_anchor event is ignored (reported in evidence_ignored);
//  - a rotation resumes with the previous key in SDP_CONFIG_KEY_OLD (old anchors checked with it) or after a human
//    holding the current key ran tools/pg/audit-chain-accept-rotation.js; migration 140 makes the audit_chain rows of
//    system_log append-only. The owner of an unhardened database can still erase evidence (stated residual).
const crypto = require('crypto');
const TABLES = Object.freeze(['governance_policy_history', 'handoff_events', 'commitment_events', 'closure_verifications', 'minutes_history', 'governance_role_events', 'ppm_events', 'report_publications', 'weekly_report_submissions', 'access_request_events', 'finance_certification_events', 'wan_sla_claim_events']);
const ANCHOR_TABLE = 'audit_chain_anchors';
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

async function ledgerSchema(db) { return (await resolveLedgerSchema(db)).schema; }
const qual = (s, t) => `"${s}"."${t}"`;
const META_TABLE = 'audit_chain_meta';

/** Read one audit_chain_meta value in `schema` (null when the table or the key is absent / unreadable). */
async function metaValue(db, schema, k) {
  try {
    const reg = await db.prepare('SELECT to_regclass(?) AS r').get(qual(schema, META_TABLE));
    if (!reg || !reg.r) return null;
    const r = await db.prepare(`SELECT v FROM ${qual(schema, META_TABLE)} WHERE k = ?`).get(k);
    return r && r.v != null ? String(r.v) : null;
  } catch (_) { return null; }
}

/**
 * P11 r7 R7-A2(a) — the ledger schema, resolved strictly. Returns { schema, problem } (problem = null when sound).
 * SDP_LEDGER_SCHEMA wins; otherwise current_schema(). Then:
 *  - without the env pin, two or more schemas of the search path holding a ledger or an anchor table → problem;
 *  - the schema recorded at migration time (audit_chain_meta 'ledger_schema') must name the resolved schema, and a
 *    meta table that exists somewhere in the database but not in the resolved schema → problem.
 */
async function resolveLedgerSchema(db) {
  const env = String(process.env.SDP_LEDGER_SCHEMA || '').trim();
  if (env && !IDENT.test(env)) throw new Error('SDP_LEDGER_SCHEMA is not a plain schema name');
  const schema = env || (await db.prepare('SELECT current_schema() AS s').get()).s;
  const problems = [];
  if (!env) {
    try {
      const names = [...TABLES, ANCHOR_TABLE];
      const rows = await db.prepare(`SELECT DISTINCT n.nspname AS s FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p') AND c.relname = ANY(?::text[]) AND n.nspname = ANY(current_schemas(false)) ORDER BY 1`).all(names);
      const list = rows.map((r) => r.s);
      if (list.length > 1) problems.push(`audit ledgers or anchor tables exist in several schemas of the search path (${list.join(', ')}) — set SDP_LEDGER_SCHEMA to the real ledger schema`);
    } catch (_) { /* catalogue unreadable: the per-ledger shadow check still runs */ }
  }
  const recorded = await metaValue(db, schema, 'ledger_schema');
  if (recorded != null && recorded !== schema) problems.push(`the ledger schema recorded at migration time is ${recorded}, not ${schema} — shadowed or moved ledgers`);
  if (recorded == null) {
    try {
      const elsewhere = await db.prepare("SELECT 1 AS ok FROM pg_class WHERE relname = ? AND relkind IN ('r', 'p') LIMIT 1").get(META_TABLE);
      if (elsewhere) problems.push(`${schema}.${META_TABLE} (ledger schema recorded at migration time) is missing although the table exists in another schema — ${schema} is not the ledger schema`);
    } catch (_) { /* unknown */ }
  }
  return { schema, problem: problems.length ? problems.join('; ') : null };
}

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
async function hasColumn(db, schema, col) {
  try {
    return !!(await db.prepare('SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?').get(schema, ANCHOR_TABLE, col));
  } catch (_) { return false; }
}
const hasSigColumn = (db, schema) => hasColumn(db, schema, 'sig');
/** P11 r7 O-8 — key identifier of an anchor key (never the key): first 16 hex of HMAC(key, label). */
function anchorKid(key) {
  if (!key) return null;
  return crypto.createHmac('sha256', key).update('sdp-audit-chain-anchor-kid-v1').digest('hex').slice(0, 16);
}

// ---- P11 r9 O-14 / R9-2 / O-16 (ADR docs/ai-decisions/ADR-P11-R9-signed-kid-history-anchor-events-request-origin.md) --
// The kid history and the system_log high-water mark were plain rows the application database login can write. Both are
// now SIGNED with a key derived from SDP_CONFIG_KEY (never stored in the database):
//  - kid attestation: audit_chain_meta key 'kidatt:<attested kid>:<attester kid>:<hmac>'; the hmac is keyed from the
//    ATTESTER's key, so it verifies only with the current key or the previous one (SDP_CONFIG_KEY_OLD). The job writes a
//    self-attestation of the key it signs with every night, and on a resume re-attests every kid it trusted under the
//    current key (a chain of rotation entries: A→B attested by B, then B→C re-attests A and B under C). The signature is
//    part of the meta KEY, so an INSERT made beforehand can never pre-empt the job's row (append-only table).
//  - anchor event: the nightly audit_chain_anchor event carries hwm_sig = hmac over (schema, kid, the logged positions);
//    an event without a valid signature never feeds the high-water mark (it is counted in evidence_ignored.log_events).
// Residual (stated, not fixed): whoever holds SDP_CONFIG_KEY AND the database can still forge both (gate G01 / HD-S04).
const KIDATT = 'kidatt:';
function kidHistKey(key) { return key ? crypto.createHmac('sha256', key).update('sdp-audit-chain-kid-history-v1').digest() : null; }
function kidAttestSig(key, attested, attester) {
  return crypto.createHmac('sha256', kidHistKey(key)).update(JSON.stringify(['kid-attest-v1', String(attested), String(attester)])).digest('hex');
}
/** meta key of an attestation of `attested` by the holder of `key` (whose kid is the attester). */
function kidAttestation(key, attested) { const by = anchorKid(key); return `${KIDATT}${attested}:${by}:${kidAttestSig(key, attested, by)}`; }
/** The previous anchor key (SDP_CONFIG_KEY_OLD — the documented rotation variable), null when unset. */
function oldAnchorKey(env = process.env) { return env.SDP_CONFIG_KEY_OLD ? anchorKey({ SDP_CONFIG_KEY: env.SDP_CONFIG_KEY_OLD }) : null; }
function hwmPayload(schema, kid, tables) {
  return JSON.stringify(['hwm-v1', String(schema == null ? '' : schema), String(kid || ''), (tables || []).filter((x) => x && x.ok === true && x.rows != null)
    .map((x) => [String(x.table), String(Number(x.rows)), x.last_id == null ? null : String(Number(x.last_id)), x.head == null ? null : String(x.head)])]);
}
function hwmSig(key, schema, kid, tables) { return crypto.createHmac('sha256', crypto.createHmac('sha256', key).update('sdp-audit-chain-hwm-v1').digest()).update(hwmPayload(schema, kid, tables)).digest('hex'); }
/** Pure: which kids are attested by a key we hold (current / previous)? Returns { known:Set, ignored:n }. */
function trustedKids(metaKeys, keys) {
  const known = new Set(); let ignored = 0;
  const holders = (keys || []).filter(Boolean).map((k) => ({ k, kid: anchorKid(k) }));
  for (const h of holders) known.add(h.kid);
  for (const raw of metaKeys || []) {
    const k = String(raw);
    if (k.startsWith('kid:')) { ignored++; continue; }   // legacy unsigned kid history (before fix 39): never trusted
    if (!k.startsWith(KIDATT)) continue;
    const [attested, by, sig] = k.slice(KIDATT.length).split(':');
    const h = holders.find((x) => x.kid === by);
    if (h && attested && sig && _sigEq(sig, kidAttestSig(h.k, attested, by))) known.add(attested); else ignored++;
  }
  return { known, ignored };
}
/**
 * Pure: classify the anchor rows of ONE ledger (ordered by id) and choose the comparison baseline.
 * Returns { anchor, forged:[ids], foreign:[ids], constraints:[rows], keyRotated, foreignKids:[], unverifiable, integrity }.
 *  - valid     : signed by the CURRENT key (kid = current kid, or no kid column / legacy row whose signature matches);
 *  - forged    : kid = current kid but a wrong signature, a kid-less signed row written after kid-bearing rows whose
 *                signature does not match, or an unsigned row written after the first signed one;
 *  - foreign   : signed under ANOTHER key (another kid, or a legacy kid-less row that predates kids and does not match):
 *                cannot be verified, so it never becomes the baseline, but its content still constrains the chain
 *                (`constraints`: it can only add conditions). Foreign rows after the last valid row = key rotated.
 */
function chooseAnchor(rows, { key, sigColumn, kidColumn = false }) {
  const none = { anchor: null, forged: [], foreign: [], constraints: [], keyRotated: false, foreignKids: [], unverifiable: null };
  if (!rows || !rows.length) return { ...none, integrity: 'none' };
  const signedRows = rows.filter((r) => r.sig);
  if (!sigColumn) return { ...none, anchor: rows[rows.length - 1], integrity: !key ? 'advisory (no SDP_CONFIG_KEY)' : 'advisory (anchor sig column missing — re-run the hardening script)' };
  if (!key) {
    if (signedRows.length) {
      return { ...none, foreign: signedRows.map((r) => Number(r.id)), constraints: rows, unverifiable: 'signed anchors are present but SDP_CONFIG_KEY is not set — their signatures cannot be checked (unverifiable, never ok)',
        integrity: 'unverifiable (signed anchors present, no SDP_CONFIG_KEY)' };
    }
    return { ...none, anchor: rows[rows.length - 1], integrity: 'advisory (no SDP_CONFIG_KEY)' };
  }
  const kid = anchorKid(key);
  const firstKid = kidColumn ? (rows.find((r) => r.kid) || null) : null;
  const firstKidId = firstKid ? Number(firstKid.id) : null;
  const valid = []; const forged = []; const foreign = [];
  for (const r of signedRows) {
    const id = Number(r.id);
    const matches = _sigEq(r.sig, anchorSig(key, r));
    if (kidColumn && r.kid) {
      if (r.kid === kid) (matches ? valid : forged).push(matches ? r : id);
      else foreign.push(r);
    } else if (matches) valid.push(r);
    else if (firstKidId != null && id > firstKidId) forged.push(id);
    else foreign.push(r);
  }
  // an unsigned row written after the first signed one did not come from the nightly job
  const firstSigned = signedRows.length ? Number(signedRows[0].id) : null;
  for (const r of rows) if (!r.sig && firstSigned != null && Number(r.id) > firstSigned) forged.push(Number(r.id));
  forged.sort((a, b) => a - b);
  const lastValid = valid.length ? Math.max(...valid.map((r) => Number(r.id))) : -Infinity;
  const pending = foreign.filter((r) => Number(r.id) > lastValid);
  const foreignKids = [...new Set(pending.map((r) => r.kid || 'legacy'))];
  const base = { forged, foreign: foreign.map((r) => Number(r.id)), constraints: foreign, keyRotated: pending.length > 0, foreignKids };
  const bestValid = valid.length ? valid.reduce((m, r) => {
    const li = r.last_id == null ? -1 : Number(r.last_id); const mi = m.last_id == null ? -1 : Number(m.last_id);
    return li > mi || (li === mi && Number(r.row_count) > Number(m.row_count)) ? r : m;
  }) : null;
  if (pending.length) {
    // the last row signed by the CURRENT key (if any) still is the verified baseline: a "rotation" never lowers it
    return { ...base, anchor: bestValid, unverifiable: `key rotated: anchor row(s) #${pending.map((r) => r.id).join(', #')} were signed under another SDP_CONFIG_KEY (kid ${foreignKids.join(', ')}; current ${kid}) — unverifiable, not forged; the nightly job re-anchors under the current key`,
      integrity: 'unverifiable (key rotated)' };
  }
  if (!valid.length) return { ...base, anchor: rows.filter((r) => !r.sig).pop() || null, unverifiable: null, integrity: 'unsigned (legacy rows written before SDP_CONFIG_KEY)' };
  return { ...base, anchor: bestValid, unverifiable: null, integrity: 'signed' };
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
async function anchorHistory(db, schema, opts = {}) {
  // P11 r8 (R8-A2 / O-11 / R8-4, ADR docs/ai-decisions/ADR-P11-R8-anchor-rotation-resume.md): also collect
  //  - hwm: per ledger, the highest position the nightly job logged as anchored ok (rows, last id, head) — an unsigned
  //    copy of the anchor stream that survives a deletion of the anchor rows;
  //  - knownKids: the key identifiers attested by a key this server holds (P11 r9: signed 'kidatt:' rows written by
  //    recordAnchors or tools/pg/audit-chain-accept-rotation.js; plain 'kid:' rows are ignored). Outside it = "unknown".
  const out = { written: false, tables: new Set(), signed: false, hwm: new Map(), knownKids: new Set(), ignoredEvents: 0, ignoredKidRows: 0 };
  // P11 r9 O-16 / O-14 — only evidence signed with a key we hold (current, or SDP_CONFIG_KEY_OLD) is trusted
  const key = opts.key !== undefined ? opts.key : anchorKey();
  const oldKey = opts.oldKey !== undefined ? opts.oldKey : oldAnchorKey();
  const holders = [key, oldKey].filter(Boolean).map((k) => ({ k, kid: anchorKid(k) }));
  for (const h of holders) out.knownKids.add(h.kid);
  try {
    const r = await db.prepare(`SELECT pg_sequence_last_value(pg_get_serial_sequence(?, 'id')::regclass) AS v`).get(qual(schema, ANCHOR_TABLE));
    out.written = r && r.v != null;
  } catch (_) { /* no privilege / no sequence: unknown */ }
  try {
    const rows = await db.prepare(`SELECT details FROM ${qual(schema, 'system_log')} WHERE action IN ('audit_chain_anchor', 'audit_chain_key_rotated') ORDER BY id DESC LIMIT 400`).all();
    for (const row of rows) {
      let d = null; try { d = typeof row.details === 'string' ? JSON.parse(row.details) : row.details; } catch (_) { d = null; }
      if (d && (Number(d.signed_written) > 0 || (d.anchor_integrity === 'signed' && Number(d.anchored) > 0))) out.signed = true;
      if (!d || !(Number(d.anchored) > 0) || !Array.isArray(d.tables)) continue;
      // P11 r9 O-16 — a high-water mark only from an event the job signed (kid we hold + valid hwm_sig over the figures)
      //  (no key at all on this server: nothing can be signed — anchors are advisory and events are read as before)
      const h = d.kid ? holders.find((x) => x.kid === d.kid) : null;
      if (holders.length && !(h && d.hwm_sig && _sigEq(d.hwm_sig, hwmSig(h.k, d.schema, d.kid, d.tables)))) { out.ignoredEvents++; continue; }
      const sameSchema = d.schema == null || d.schema === schema;
      for (const x of d.tables) {
        if (!(x && x.ok === true && x.rows != null)) continue;
        out.tables.add(x.table);
        if (!sameSchema) continue;
        const cur = out.hwm.get(x.table);
        if (!cur || Number(x.rows) > Number(cur.row_count)) out.hwm.set(x.table, { row_count: Number(x.rows), last_id: x.last_id == null ? null : Number(x.last_id), head: x.head == null ? null : String(x.head) });
      }
    }
  } catch (_) { /* no system_log: unknown */ }
  if ((await metaValue(db, schema, 'signed_anchors')) != null) out.signed = true;
  try {
    const reg = await db.prepare('SELECT to_regclass(?) AS r').get(qual(schema, META_TABLE));
    if (reg && reg.r) {
      const t = trustedKids((await db.prepare(`SELECT k FROM ${qual(schema, META_TABLE)} WHERE k LIKE 'kid%'`).all()).map((r) => r.k), holders.map((x) => x.k));
      out.knownKids = t.known; out.ignoredKidRows = t.ignored;
    }
  } catch (_) { /* no meta table: no kid is known */ }
  try { if (await db.prepare(`SELECT 1 AS ok FROM ${qual(schema, ANCHOR_TABLE)} WHERE kid IS NOT NULL LIMIT 1`).get()) out.signed = true; } catch (_) { /* no kid column */ }
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
  const resolved = await resolveLedgerSchema(db);
  const schema = resolved.schema;
  const useAnchors = opts.anchors !== false;
  let hasAnchors = false;
  if (useAnchors) {
    try { hasAnchors = !!(await db.prepare('SELECT to_regclass(?) AS r').get(qual(schema, ANCHOR_TABLE))).r; } catch (_) { hasAnchors = false; }
  }
  const out = [];
  const key = opts.key !== undefined ? opts.key : anchorKey();
  const oldKey = opts.oldKey !== undefined ? opts.oldKey : oldAnchorKey();
  const oldKid = oldKey ? anchorKid(oldKey) : null;
  const history = hasAnchors ? await anchorHistory(db, schema, { key, oldKey }) : { written: false, tables: new Set(), signed: false, hwm: new Map(), knownKids: new Set(), ignoredEvents: 0, ignoredKidRows: 0 };
  let anchorRows = null;
  if (hasAnchors) { try { anchorRows = Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${qual(schema, ANCHOR_TABLE)}`).get()).n); } catch (_) { anchorRows = null; } }
  // R6-A2: anchors expected but the anchor table is not in the ledger schema → unverifiable, never ok
  const expected = useAnchors && !hasAnchors ? await anchorsExpected(db, schema) : false;
  const sigColumn = hasAnchors ? await hasSigColumn(db, schema) : false;
  const kidColumn = hasAnchors ? await hasColumn(db, schema, 'kid') : false;
  // P11 r7 R7-A2(b) — the sig column is gone although signed anchors were written: never "advisory ok"
  const sigGone = useAnchors && hasAnchors && !sigColumn && history.signed;
  const schemaProblem = useAnchors ? resolved.problem : null;
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
      let c = { anchor: null, forged: [], constraints: [], keyRotated: false, foreignKids: [], unverifiable: null };
      if (hasAnchors) {
        const arows = await db.prepare(`SELECT id, table_name, schema_name, last_id, head, row_count${sigColumn ? ', sig' : ''}${kidColumn ? ', kid' : ''} FROM ${qual(schema, ANCHOR_TABLE)} WHERE table_name = ? ORDER BY id`).all(t);
        c = chooseAnchor(arows, { key, sigColumn, kidColumn });
        integrity.add(c.integrity);
      }
      const anchor = c.anchor;
      // P11 r9 O-14 — with the previous key at hand (SDP_CONFIG_KEY_OLD), a row claiming the previous kid must carry a
      // signature that verifies under it; otherwise it is forged, never a "rotation"
      if (oldKey && kidColumn && sigColumn) for (const f of c.constraints || []) if (f.kid === oldKid && f.sig && !_sigEq(f.sig, anchorSig(oldKey, f))) c.forged = [...c.forged, Number(f.id)].sort((a, b) => a - b);
      let brk = c.forged.length ? `anchor row(s) #${c.forged.join(', #')} not signed by the nightly job (forged or altered anchor)` : null;
      if (!brk) brk = anchorBreak(rows, anchor);
      // P11 r7 — an anchor that cannot be verified (other key, or no key) still constrains the chain: it can only add
      // conditions, so a forged "other key" row never lowers the baseline
      if (!brk) for (const f of c.constraints || []) { const b = anchorBreak(rows, f); if (b) { brk = `${b} (anchor #${f.id}, signature not verifiable with the current key)`; break; } }
      // P11 r6 — no anchor for a ledger that holds rows, while anchors were written before (the whole anchor table is
      // empty although its sequence moved, or this ledger was logged as anchored): the anchor history is missing.
      if (!brk && !anchor && !(c.constraints || []).length && rows.length && (history.tables.has(t) || (history.written && anchorRows === 0))) {
        brk = 'anchor history missing — anchors were written before and none is left for this ledger (anchor table emptied?)';
      }
      // P11 r8 R8-A2 — with no anchor verified under the current key (anchors deleted, or a rotation pending), the
      // highest position the nightly job logged as anchored still constrains the chain: a truncated ledger can never
      // be re-baselined by a "rotation" resume.
      const hw = history.hwm.get(t);
      if (!brk && hw && (!anchor || c.keyRotated)) { const b = anchorBreak(rows, hw); if (b) brk = `${b} (highest position the nightly job logged as anchored in system_log)`; }
      // P11 r8 R8-A2 / O-11 — a pending anchor under a key id this deployment never signed with is not a rotation
      const unknownKids = c.keyRotated && kidColumn ? (c.foreignKids || []).filter((k) => !history.knownKids.has(k)) : [];
      if (unknownKids.length && c.unverifiable) {
        c = { ...c, unverifiable: `unknown key id: anchor row(s) signed under kid ${unknownKids.join(', ')}, for which no attestation signed with a key this server holds exists — unverifiable, the job does NOT resume; investigate (possible forged anchor). A documented rotation resumes when the previous key is set as SDP_CONFIG_KEY_OLD for one nightly run, or after an operator holding SDP_CONFIG_KEY confirms it: node tools/pg/audit-chain-accept-rotation.js --kid=${unknownKids[0]} --i-confirm-documented-rotation (a plain INSERT into audit_chain_meta is NOT enough: kid history rows are signed)` };
      }
      const last = rows.length ? rows[rows.length - 1] : null;
      const broken = !!bad || !!brk;
      out.push({ table: t, rows: rows.length, ok: broken ? false : (c.unverifiable ? null : true), first_broken_id: bad ? Number(bad.id) : null,
        head: last ? last.row_hash : null, last_id: last ? Number(last.id) : null,
        anchor: anchor ? { last_id: anchor.last_id == null ? null : Number(anchor.last_id), row_count: Number(anchor.row_count) } : null,
        ...(brk ? { anchor_error: brk } : {}),
        ...(!broken && c.unverifiable ? { error: c.unverifiable, ...(c.keyRotated ? { key_rotated: true, foreign_kids: c.foreignKids, ...(unknownKids.length ? { unknown_kids: unknownKids } : {}) } : {}) } : {}) });
    } catch (e) { out.push({ table: t, rows: null, ok: null, error: 'not verifiable (table or migration 034 missing)' }); }
  }
  const broken = out.some((x) => x.ok === false);
  const unverifiable = out.some((x) => x.ok !== true && x.ok !== false) || expected || !!schemaProblem || sigGone;
  const status = broken ? 'broken' : (unverifiable ? 'unverifiable' : 'ok');
  const anchorIntegrity = sigGone ? 'unverifiable (signature column removed although signed anchors were written)'
    : !hasAnchors ? (expected ? 'missing' : 'none')
      : anchorRows === 0 ? 'none'
        : (integrity.has('signed') && integrity.size === 1 ? 'signed' : [...integrity].filter((x) => x !== 'signed' && x !== 'none').join('; ') || (integrity.has('signed') ? 'signed' : 'none'));
  // P11 r7 O-8 — the ONLY reason for "unverifiable" is a key rotation: the nightly job may resume the chain
  const rotatedOnly = status === 'unverifiable' && !expected && !schemaProblem && !sigGone && !!key && sigColumn && kidColumn
    && out.every((x) => x.ok === true || (x.key_rotated === true && !(x.unknown_kids || []).length)) && out.some((x) => x.key_rotated === true);
  // P11 r8 O-12 — a database hardened before migration 137 has no kid column: a rotation can never resume until the DBA
  // re-runs the hardening script (which adds it)
  const noKidRemedy = hasAnchors && !!key && sigColumn && !kidColumn && out.some((x) => x.key_rotated === true);
  const anchorErrors = [];
  if (expected) anchorErrors.push(`anchors expected (migration 131 recorded or an anchor table exists) but ${schema}.${ANCHOR_TABLE} cannot be resolved — unverifiable`);
  if (schemaProblem) anchorErrors.push(`ledger schema not trustworthy — ${schemaProblem}`);
  if (noKidRemedy) anchorErrors.push(`${schema}.${ANCHOR_TABLE} has no kid column (database hardened before migration 137): anchors signed under another key cannot be classified and the nightly job cannot resume — re-run tools/pg/harden-audit-grants.sql as the DBA (it adds the kid column), then the next nightly run resumes`);
  if (sigGone) anchorErrors.push(`${schema}.${ANCHOR_TABLE} has no sig column although signed anchors were written — signatures removed (unverifiable)`);
  return { ok: status === 'ok', status, schema, anchors: hasAnchors, anchor_integrity: anchorIntegrity,
    ...(anchorErrors.length ? { anchor_error: anchorErrors.join('; ') } : {}),
    known_kids: [...history.knownKids],
    evidence_ignored: { kid_rows: history.ignoredKidRows || 0, log_events: history.ignoredEvents || 0 },
    ...(rotatedOnly ? { key_rotated: true, key_rotation: { from_kids: [...new Set(out.flatMap((x) => x.foreign_kids || []))], to_kid: anchorKid(key) } } : {}),
    tables: out, checked_at: new Date().toISOString() };
}

/** Persist today's anchor for every ledger that verified ok (never over a broken chain: the last good anchor stays).
 *  opts.resume (P11 r7 O-8): also anchor ledgers whose only problem is a key rotation (chain intact, constraints from
 *  the old-key anchors held). Returns the number of rows written; `.signed` on the result object when signed. */
async function recordAnchors(db, result, opts = {}) {
  if (!result || !result.anchors) return 0;
  const key = opts.key !== undefined ? opts.key : anchorKey();
  const sigColumn = key ? await hasSigColumn(db, result.schema) : false;
  const kidColumn = key && sigColumn ? await hasColumn(db, result.schema, 'kid') : false;
  const kid = anchorKid(key);
  let n = 0;
  for (const x of result.tables) {
    const eligible = x.ok === true || (opts.resume === true && x.key_rotated === true && x.ok === null);
    if (!eligible || x.rows == null) continue;
    if (key && sigColumn) {
      const sig = anchorSig(key, { table_name: x.table, schema_name: result.schema, last_id: x.last_id, head: x.head, row_count: x.rows });
      if (kidColumn) {
        await db.prepare(`INSERT INTO ${qual(result.schema, ANCHOR_TABLE)} (table_name, schema_name, last_id, head, row_count, sig, kid) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(x.table, result.schema, x.last_id, x.head, x.rows, sig, kid);
      } else {
        await db.prepare(`INSERT INTO ${qual(result.schema, ANCHOR_TABLE)} (table_name, schema_name, last_id, head, row_count, sig) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(x.table, result.schema, x.last_id, x.head, x.rows, sig);
      }
    } else {
      await db.prepare(`INSERT INTO ${qual(result.schema, ANCHOR_TABLE)} (table_name, schema_name, last_id, head, row_count) VALUES (?, ?, ?, ?, ?)`)
        .run(x.table, result.schema, x.last_id, x.head, x.rows);
    }
    n++;
  }
  // P11 r7 R7-A2(b) — remember that signed anchors exist (a later missing sig column then reads "unverifiable")
  if (n && key && sigColumn) {
    try { await db.prepare(`INSERT INTO ${qual(result.schema, META_TABLE)} (k, v) VALUES ('signed_anchors', ?) ON CONFLICT (k) DO NOTHING`).run(new Date().toISOString()); } catch (_) { /* no meta table (migration 137 not applied): the kid / nightly events still say it */ }
    // P11 r8 R8-A2 / O-11 — kid history: this deployment's job signed with this key id (only the job, which holds the
    // key, writes it; a later anchor under a kid absent from this list is "unknown", never a resumable rotation)
    // P11 r9 O-14 — the kid history is SIGNED (kidAttestation): a self-attestation of the key the job signs with, plus,
    // on a resume, a re-attestation under the current key of every kid this run trusted (opts.attest) — the rotation chain
    if (kidColumn) {
      for (const k of new Set([kid, ...(opts.attest || [])])) {
        try { await db.prepare(`INSERT INTO ${qual(result.schema, META_TABLE)} (k, v) VALUES (?, ?) ON CONFLICT (k) DO NOTHING`).run(kidAttestation(key, k), (k === kid ? 'signed by the nightly job ' : `attested by the nightly job (kid ${kid}) `) + new Date().toISOString()); } catch (_) { /* no meta table */ }
      }
    }
  }
  return n;
}

/** The nightly job body (services/sync/jobs.js audit.chain_verify): verify, log, anchor; a broken chain throws.
 *  P11 r7 O-8 — when the only problem is a key rotation (SDP_CONFIG_KEY rotated, or a restore on a server with another
 *  key) the job records an audit_chain_key_rotated event and re-anchors under the current key, so the chain resumes. */
async function nightly(rdb) {
  const db = rdb.pgHandle ? rdb.pgHandle() : rdb.db;
  let r = await verify(db);
  let rotated = null;
  if (!r.ok && r.key_rotated) {
    const n = await recordAnchors(db, r, { resume: true, attest: [...(r.known_kids || []), ...r.key_rotation.from_kids] });
    rotated = { from_kids: r.key_rotation.from_kids, to_kid: r.key_rotation.to_kid, tables: r.tables.filter((x) => x.key_rotated).map((x) => x.table), anchored: n };
    await rdb.logEvent({ category: 'governance', action: 'audit_chain_key_rotated', target: 'audit',
      details: { schema: r.schema, ...rotated, signed_written: n, note: 'anchors signed under another SDP_CONFIG_KEY could not be verified; the chain was checked against their content and re-anchored under the current key' }, risk: 1 });
    r = await verify(db);
  }
  const anchored = r.ok ? await recordAnchors(db, r) : 0;
  const signedWritten = anchored && anchorKey() && (await hasSigColumn(db, r.schema)) ? anchored : 0;
  await rdb.logEvent({ category: 'governance', action: r.ok ? 'audit_chain_anchor' : (r.status === 'unverifiable' ? 'audit_chain_unverifiable' : 'audit_chain_broken'), target: 'audit',
    details: { schema: r.schema, anchored, signed_written: signedWritten, ...(signedWritten ? { kid: anchorKid(anchorKey()), hwm_sig: hwmSig(anchorKey(), r.schema, anchorKid(anchorKey()), r.tables) } : {}), status: r.status, anchor_integrity: r.anchor_integrity, ...(rotated ? { key_rotated: rotated } : {}), ...(r.anchor_error ? { anchor_error: r.anchor_error } : {}), tables: r.tables.map((x) => ({ table: x.table, rows: x.rows, ok: x.ok, head: x.head, last_id: x.last_id == null ? null : x.last_id, first_broken_id: x.first_broken_id, ...(x.anchor_error ? { anchor_error: x.anchor_error } : {}), ...(x.error && x.ok !== true ? { error: x.error } : {}), ...(x.shadowed ? { shadowed: true } : {}) })) }, risk: r.ok ? 0 : 1 });
  if (!r.ok) {
    const bad = r.tables.filter((x) => x.ok !== true).map((x) => `${x.table}#${x.first_broken_id != null ? x.first_broken_id : (x.anchor_error || x.error || '?')}`);
    if (r.anchor_error) bad.unshift(r.anchor_error);
    throw new Error(`audit chain ${r.status}: ` + bad.join(', '));
  }
  return { rows: r.tables.reduce((n, x) => n + (x.rows || 0), 0), anchored, ...(rotated ? { key_rotated: rotated } : {}) };
}

module.exports = { TABLES, ANCHOR_TABLE, META_TABLE, verify, recordAnchors, anchorBreak, anchorHistory, ledgerSchema, resolveLedgerSchema, nightly, anchorKey, anchorKid, anchorSig, chooseAnchor, anchorsExpected, oldAnchorKey, kidAttestation, kidAttestSig, trustedKids, hwmSig };
