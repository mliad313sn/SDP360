'use strict';
// Freshness string + stale warning for the DB-backed API endpoints (from server.js, SDP-DASH-2.0 step 5).

/**
 * Build a human-readable freshness string and stale-data warning from a
 * sync_metadata row.  Used by all DB-backed API endpoints.
 */
function buildDataFreshness(syncMeta) {
  const syncedAt = syncMeta && syncMeta.last_sync_at ? syncMeta.last_sync_at : null;
  const ageMs    = syncedAt ? Date.now() - new Date(syncedAt).getTime() : null;
  const ageMin   = ageMs !== null ? Math.round(ageMs / 60000) : null;

  let freshness = 'never synced';
  let stale     = true;
  if (ageMin !== null) {
    if      (ageMin < 2)    { freshness = 'just now';                stale = false; }
    else if (ageMin < 60)   { freshness = `${ageMin} min ago`;       stale = false; }
    else if (ageMin < 1440) { freshness = `${Math.round(ageMin / 60)} hr ago`;   stale = ageMin > 480; }
    else                    { freshness = `${Math.round(ageMin / 1440)} day(s) ago`; stale = true; }
  }

  return {
    source:         'local_db',
    as_of:          syncedAt,
    data_freshness: freshness,
    stale_warning:  stale ? 'Data may be outdated — trigger /api/sync/trigger/change_cab to refresh' : null,
    sync_count:     syncMeta ? (syncMeta.sync_count || 0) : 0,
    last_error:     syncMeta ? (syncMeta.last_error || null) : null,
    deleted_last_run: syncMeta ? (syncMeta.deleted_count || 0) : 0,
  };
}

module.exports = { buildDataFreshness };
