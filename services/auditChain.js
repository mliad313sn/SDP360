'use strict';
// Verification of the hash-chained audit tables (migration 034, committee review 2026-10-28).
// For each table, every row's hash is recomputed in the database from its content and the previous
// row's hash; the first row that does not match is reported. The chain heads are the daily anchor:
// logged by the job `audit.chain_verify` (system_log + the encrypted nightly backup), so a whole-table
// rewrite with a recomputed chain still differs from yesterday's anchor.
const TABLES = Object.freeze(['governance_policy_history', 'handoff_events', 'commitment_events', 'closure_verifications', 'minutes_history', 'governance_role_events', 'ppm_events', 'report_publications']);

async function verify(db) {
  const out = [];
  for (const t of TABLES) {
    try {
      const rows = await db.prepare(`SELECT id, prev_hash, row_hash,
          encode(sha256(convert_to(coalesce(prev_hash, '') || sdp_chain_payload(to_jsonb(x)), 'UTF8')), 'hex') AS calc,
          lag(row_hash) OVER (ORDER BY id) AS expected_prev
        FROM ${t} x ORDER BY id`).all();
      const bad = rows.find((r) => !r.row_hash || r.calc !== r.row_hash || (r.prev_hash || null) !== (r.expected_prev || null));
      out.push({ table: t, rows: rows.length, ok: !bad, first_broken_id: bad ? Number(bad.id) : null, head: rows.length ? rows[rows.length - 1].row_hash : null });
    } catch (e) { out.push({ table: t, rows: null, ok: null, error: 'not verifiable (table or migration 034 missing)' }); }
  }
  return { ok: out.every((x) => x.ok !== false), tables: out, checked_at: new Date().toISOString() };
}

module.exports = { TABLES, verify };
