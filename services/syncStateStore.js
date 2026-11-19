'use strict';
// ─────────────────────────────────────────────────────────────────────────
// Sync-state store — stored-id listings and truncation-guard anchors for the Zoho syncs. Moved out of
// reports-db.js (P06 monolith budget); reports-db.js builds it with its PostgreSQL handle getter and
// re-exports every function under the same name (pinned by tests/p06-reports-db-surface.test.js).
// ─────────────────────────────────────────────────────────────────────────

// Whitelisted table → id column (P11 F-01 survey; round 2 N-01 requests + CAB).
const STORED_ID_COL = { survey_results: 'result_id', request_records: 'request_id', cab_approvals: 'approval_id' };

function createSyncStateStore({ handle }) {
  /** Ids already stored in one synced table — lets a sync re-insert live rows missing locally. */
  async function listStoredIds(table) {
    const col = STORED_ID_COL[table];
    if (!col) throw new Error(`listStoredIds: table not allowed: ${table}`);
    const rows = await handle().prepare(`SELECT ${col} AS id FROM ${table}`).all();
    return new Set(rows.map(r => String(r.id)));
  }
  async function listSurveyResultIds() { return listStoredIds('survey_results'); }

  /** Truncation-guard anchors (P11 round 2 N-02, db/postgres/sync/113_truncation_anchors.sql); null = never anchored. */
  async function getTruncationAnchor(key) {
    const row = await handle().prepare('SELECT anchor_count FROM sync_truncation_anchors WHERE guard_key = ?').get(key);
    return row ? Number(row.anchor_count) : null;
  }
  async function setTruncationAnchor(key, n) {
    const v = Number(n);
    if (!Number.isFinite(v)) throw new Error(`setTruncationAnchor: count must be a number for ${key}`);
    await handle().prepare(`INSERT INTO sync_truncation_anchors (guard_key, anchor_count, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (guard_key) DO UPDATE SET anchor_count = EXCLUDED.anchor_count, updated_at = EXCLUDED.updated_at`)
      .run(key, Math.max(0, Math.round(v)), new Date().toISOString());
  }
  const truncationAnchorStore = { get: getTruncationAnchor, set: setTruncationAnchor };

  return { listStoredIds, listSurveyResultIds, getTruncationAnchor, setTruncationAnchor, truncationAnchorStore };
}

module.exports = { createSyncStateStore, STORED_ID_COL };
