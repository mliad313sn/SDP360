# ADR-A19 — soft delete for inspections, PVs, portfolio nodes and cadences (switched OFF)

Status: accepted as an AI technical decision · 2026-11-04 · **not** reviewed by the named human owners · the
30-day retention is a PROPOSED policy (not a D-item, not approved) · enabling it is an owner act.

## Context
Deleting an inspection (`DELETE FROM insp_inspections` + blobs), a PV (`DELETE FROM md_meetings`, children by FK
CASCADE), a portfolio node (`DELETE FROM portfolio_*`, cascading down the tree) or a cadence (cascading to its
sessions and their actions) is immediate and irreversible. A mistaken delete can only be recovered from a dump.

## Decision
- Three additive nullable columns on each deletable table: `deleted_at TEXT` (ISO), `deleted_by INTEGER`,
  `delete_reason TEXT` (migrations `inspection/049`, `meetings/051`, `reports/052`). No existing row changes.
- One switch, `report_config soft_delete_enabled` (default `'0'` = today's hard delete, byte-for-byte). With `'1'`
  the delete functions stamp the row instead (blobs kept); the admin tier restores it within
  `soft_delete_retention_days` (default `30`); `softdelete.purge` (nightly, optional) hard-deletes older stamps only
  when `soft_delete_purge_enabled = '1'` (default `'0'`). `tools/pg/purge-soft-deleted.js` is the dry run.
- **Readers always filter `deleted_at IS NULL`**, whatever the switch: a row stamped while the switch was on stays
  hidden if it is turned off again, until restored or purged. Children of a deleted parent disappear through the
  parent join (PV issues/actions, inspection findings/actions, portfolio subtree, cadence sessions).
- Saves cannot resurrect: a save that would update a soft-deleted inspection (client-generated id, offline replay)
  or PV (by id, reference or month fallback) is refused with a typed `CONFLICT` (409) naming the restore path.
- `tests/soft-delete-readers.test.js` scans the module SQL: every read of a guarded table filters `deleted_at` or is
  on an allowlist with its reason. `services/restoreDrill.js` is deliberately NOT filtered (raw table counts).
- Delete / restore / purge write `system_log` events; `*_purged` are risk events.

## Rejected alternative
Rename each table and expose a filtered view under the old name. Auto-updatable views do not support
`INSERT … ON CONFLICT` (used by the upsert paths), foreign keys cannot reference a view, and every migration that
`ALTER`s the table would have to target the renamed one — a large, risky change for a reversible policy.

## Rollback
Set `soft_delete_enabled = '0'` and `soft_delete_purge_enabled = '0'` (already-stamped rows stay hidden until
restored or purged). The columns are harmless and can stay; a rollback script may drop them only once no row has
`deleted_at` set.
