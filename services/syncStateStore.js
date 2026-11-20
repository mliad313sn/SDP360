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
  async function setTruncationAnchor(key, n) { return setTruncationAnchorState(key, { anchor: n, pending: null, agree: 0 }); }
  // Full guard state (anchor + pending lower candidate, P11 r3 F-14, db/postgres/sync/114_*.sql).
  async function getTruncationAnchorState(key) {
    const row = await handle().prepare('SELECT anchor_count, pending_count, pending_agree FROM sync_truncation_anchors WHERE guard_key = ?').get(key);
    if (!row) return null;
    return { anchor: Number(row.anchor_count), pending: row.pending_count == null ? null : Number(row.pending_count), agree: Number(row.pending_agree) || 0 };
  }
  async function setTruncationAnchorState(key, state) {
    const st = (state != null && typeof state === 'object') ? state : { anchor: state, pending: null, agree: 0 };
    const v = Number(st.anchor);
    if (!Number.isFinite(v)) throw new Error(`setTruncationAnchor: count must be a number for ${key}`);
    const pend = st.pending == null || !Number.isFinite(Number(st.pending)) ? null : Math.max(0, Math.round(Number(st.pending)));
    const agree = pend == null ? 0 : Math.max(0, Math.round(Number(st.agree) || 0));
    await handle().prepare(`INSERT INTO sync_truncation_anchors (guard_key, anchor_count, pending_count, pending_agree, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (guard_key) DO UPDATE SET anchor_count = EXCLUDED.anchor_count, pending_count = EXCLUDED.pending_count,
        pending_agree = EXCLUDED.pending_agree, updated_at = EXCLUDED.updated_at`)
      .run(key, Math.max(0, Math.round(v)), pend, agree, new Date().toISOString());
  }
  const truncationAnchorStore = { get: getTruncationAnchorState, set: setTruncationAnchorState };

  return { listStoredIds, listSurveyResultIds, getTruncationAnchor, setTruncationAnchor, truncationAnchorStore };
}

module.exports = { createSyncStateStore, STORED_ID_COL };
