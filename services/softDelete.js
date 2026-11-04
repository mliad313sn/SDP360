'use strict';
// A-19 — soft delete helper shared by inspections (A-19a), PVs (A-19b) and the portfolio / cadences (A-19c).
// ADR: docs/ai-decisions/ADR-A19-soft-delete.md.
//
// PROPOSED retention policy, switched OFF: with report_config soft_delete_enabled = '0' (default) every delete
// is the hard delete it always was. With '1' a delete stamps deleted_at / deleted_by / delete_reason; readers
// filter `deleted_at IS NULL` (always — a row stamped while the switch was on stays hidden after it is turned
// off, until restored or purged); the admin tier restores within soft_delete_retention_days; the
// softdelete.purge job hard-deletes older stamps only when soft_delete_purge_enabled = '1'.
const { typed } = require('./httpError');

const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 86400000;

// Table / id column names are interpolated into SQL — only these are accepted.
const TABLES = Object.freeze({
  insp_inspections: 'id', md_meetings: 'id',
  portfolio_programmes: 'id', portfolio_objectives: 'id', portfolio_projects: 'id', portfolio_tasks: 'id',
  portfolio_milestones: 'id', portfolio_deliverables: 'id', portfolio_risks: 'id', meeting_cadences: 'id',
});

const isEnabled = (cfg) => String((cfg && cfg.soft_delete_enabled) || '0') === '1';
const purgeEnabled = (cfg) => String((cfg && cfg.soft_delete_purge_enabled) || '0') === '1';
function retentionDays(cfg) {
  const n = Number(cfg && cfg.soft_delete_retention_days);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_RETENTION_DAYS;
}

/** report_config, or {} (→ switch off = today's hard delete) when it cannot be read. */
async function readConfig(rdb) {
  try { return (await require('./reportConfig').getConfig(rdb && rdb.db)) || {}; } catch (_) { return {}; }
}

function _table(table) {
  if (!Object.prototype.hasOwnProperty.call(TABLES, table)) throw new Error(`softDelete: table not allowed: ${table}`);
  return TABLES[table];
}
const _changed = (r) => Number(r && (r.changes != null ? r.changes : r.rowCount)) > 0;

/** Stamp a live row deleted. Returns true when a row was stamped (false: unknown or already deleted). */
async function stamp(H, table, id, { by = null, reason = null, now = new Date() } = {}) {
  const col = _table(table);
  const byId = by == null || by === '' || !Number.isFinite(Number(by)) ? null : Number(by);
  const why = reason == null || String(reason).trim() === '' ? null : String(reason).trim().slice(0, 500);
  return _changed(await H.prepare(`UPDATE ${table} SET deleted_at = ?, deleted_by = ?, delete_reason = ? WHERE ${col} = ? AND deleted_at IS NULL`)
    .run(now.toISOString(), byId, why, id));
}

/** Clear the stamp of a deleted row. Returns true when a row was restored. */
async function unstamp(H, table, id) {
  const col = _table(table);
  return _changed(await H.prepare(`UPDATE ${table} SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL WHERE ${col} = ? AND deleted_at IS NOT NULL`).run(id));
}

function withinRetention(row, days, now = new Date()) {
  if (!row || !row.deleted_at) return false;
  const t = Date.parse(row.deleted_at);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t <= days * DAY_MS;
}

/** ISO cut-off: a row whose deleted_at sorts before it is past the retention window. */
function cutoffIso(days, now = new Date()) { return new Date(now.getTime() - days * DAY_MS).toISOString(); }

/** Typed 409 for a save that would resurrect (or collide with) a deleted row. */
function deletedConflict(what, row) {
  const day = row && row.deleted_at ? String(row.deleted_at).slice(0, 10) : 'an earlier date';
  return typed('CONFLICT', `This ${what} was deleted on ${day} — ask an administrator to restore it`);
}

/**
 * Restore pre-checks shared by the restore routes. Throws a typed error (404 / 409) or returns the row.
 * row = the stored row INCLUDING deleted ones (null when unknown).
 */
function assertRestorable(row, cfg, { what = 'record', now = new Date() } = {}) {
  if (!row) throw typed('NOT_FOUND', 'Not found');
  if (!row.deleted_at) throw typed('CONFLICT', `This ${what} is not deleted`);
  const days = retentionDays(cfg);
  if (!withinRetention(row, days, now)) throw typed('CONFLICT', `This ${what} was deleted more than ${days} days ago — past the retention window, it can no longer be restored`);
  return row;
}

module.exports = {
  DEFAULT_RETENTION_DAYS, TABLES, isEnabled, purgeEnabled, retentionDays, readConfig,
  stamp, unstamp, withinRetention, cutoffIso, deletedConflict, assertRestorable,
};
