# SDP Dashboard — Current Database Architecture (as of 2026-08-06)

> Snapshot of the **live** data layer after the SQLite → PostgreSQL migration.
> For the exhaustive per-table column reference see `docs/DATA_ARCHITECTURE.md`
> (written pre-PG; table shapes are unchanged, only the storage engine moved).

## TL;DR

**One shared PostgreSQL database — `sdp_dashboard` — holds ALL the ops apps
except Assets**, which is still on SQLite. It is **not** a database-per-app; it
is **one database with per-module table namespaces** (prefixes).

```
                4MyPeople-managed PostgreSQL 17 cluster  (localhost:5432)
   ┌───────────────────────────────────────────────────────────────────────┐
   │  fmp_v2            → 4MyPeople appliance   (NEVER touched by SDP)        │
   │  postgres          → default/maintenance                                │
   │  sdp_dashboard_test→ automated tests                                    │
   │                                                                         │
   │  sdp_dashboard  ← THE SDP database (user sdp_app), 67 tables:           │
   │  ┌───────────────────────────────────────────────────────────────────┐ │
   │  │ Reports/Auth/Helpdesk : request_records, change_records, survey_*, │ │
   │  │                         users, user_roles, sessions, sites,        │ │
   │  │                         site_module_codes, weekly_/monthly_reports,│ │
   │  │                         weeks, lights, action_items, cab_approvals,│ │
   │  │                         infra_kpis, helpdesk_data, report_*, exec_*,│ │
   │  │                         audit_log, sync_metadata, …  (~31)          │ │
   │  │ Meetings              : md_*                          (18)          │ │
   │  │ Inspection            : insp_*                        (10)          │ │
   │  │ Activity Tracker      : tracker_*                     (8)           │ │
   │  └───────────────────────────────────────────────────────────────────┘ │
   └───────────────────────────────────────────────────────────────────────┘

   Assets (only exception) → SQLite file  <DATA_DIR>/assets.db
                             tables: assets, asset_*, software, software_licenses
```

## Backend selection

Each app is a `*-db.js` module whose storage engine is chosen by an env flag.
All PG-backed modules read the **same** `PG_URL` → the **same** database, so
consolidation is a property of the URL, not of separate configs.

| App (module) | Env flag | Prod value | Storage today | Table prefix |
|---|---|---|---|---|
| Reports / Auth / Helpdesk (`reports-db.js`) | `REPORTS_BACKEND` | `postgres` | `sdp_dashboard` | (mixed — see below) |
| Meetings (`meetings-db.js`) | `MEETINGS_BACKEND` | `postgres` | `sdp_dashboard` | `md_` |
| Inspection (`inspection-db.js`) | `INSPECTION_BACKEND` | `postgres` | `sdp_dashboard` | `insp_` |
| Activity Tracker (`tracker-db.js`) | `TRACKER_BACKEND` | `postgres` | `sdp_dashboard` | `tracker_` |
| **Assets** (`assets-db.js`) | `ASSETS_BACKEND` | **unset → `sqlite`** | **`data/assets.db`** | `assets`,`asset_`,`software` |

Connection string (redacted): `postgres://sdp_app:***@localhost:5432/sdp_dashboard`
(`PG_URL`, fallback `DATABASE_URL`). Pool via `services/pgDb.js`
(`PG_POOL_MAX`, default 10).

## The "Reports" namespace (no single prefix)

The Reports/Auth/Helpdesk module owns the widest set — it predates the prefixing
convention, so its tables are named by concern rather than a `rpt_` prefix:

- **Zoho-synced hot data**: `request_records` (tickets + Major Incidents via
  `template`/`request_type`), `change_records`, `survey_results`,
  `survey_answers`, `sync_metadata`.
- **Auth**: `users`, `user_roles`, `sessions`.
- **Sites / mapping**: `sites`, `site_module_codes` (the tracker↔meetings↔
  inspection↔risk code map), `rr_site_aliases`.
- **Weekly/monthly reports**: `weekly_reports`, `monthly_reports`, `weeks`,
  `infra_kpis`, `infra_kpi_catalog`, `lights`, `action_items`,
  `action_departments`, `annual_objectives`, `cab_approvals`, `helpdesk_data`.
- **Reporting suite config**: `report_config`, `report_recipients`,
  `report_schedules`, `report_sent_log`, `dashboard_preset_groups`.
- **Exec surfaces**: `exec_report_editorial`, `exec_view_editorial`,
  `exec_mi_summary`.
- **Audit**: `audit_log`. (`system_log` lands here once `feat/system-logs`
  merges.)
- **Assets history (in PG, not the assets module itself)**:
  `asset_effort_history`, `asset_import_log`, `asset_reconcile_history` live in
  `reports.db`/PG because they are report-side capture tables.

## Frozen SQLite archives (rollback only)

The pre-cutover `.db` files in `<DATA_DIR>` are **no longer written** — kept for
per-module rollback (`git`-untracked, not deployed): `tracker.db`, `meetings.db`,
`inspection.db`, `reports.db` (+ `helpdesk.db` legacy, `reports-backup-*.db`).
Rollback a module = unset its `*_BACKEND` flag + `pm2 stop`/`start` (post-flip
writes stay in PG). `assets.db` is the ONLY one still live (Assets = sqlite).

## Why one database, not one-per-app

- **Cross-module joins & shared identity**: `sites` / `site_module_codes` are
  read by every module; auth (`users`/`sessions`) gates all of them. One DB
  keeps these first-class instead of cross-DB glue.
- **One backup unit**: `_sdp_admin.cmd` option 5 does a single `pg_dump` of
  `sdp_dashboard` (`tools/pg/dump-db.js`).
- **Cohabitation guarantee**: the SDP DB is a peer of `fmp_v2` on the same
  cluster; 4MyPeople's destructive ops are scoped to `fmp_*`, never
  `sdp_dashboard`.

## Open item — Assets → PostgreSQL cutover (runbook)

The code is PG-ready (`initPgAssets()` applies the schema on boot) and
`tools/pg/copy-assets.js` was hardened (2026-08-06): it now (a) **skips NULL/empty
primary-key rows** instead of aborting the whole transaction, and (b) copies the
**irreplaceable append-only tables** — `asset_effort_history`,
`asset_reconcile_history`, `asset_reconcile_decisions`, `asset_external_devices`,
`asset_import_log` — which a re-sync **cannot** rebuild (a dry-run proved
`asset_effort_history` was previously being dropped). The 6 AP-synced tables
(`assets`, `asset_memory`, `asset_logical_drives`, `asset_monitors`,
`software_licenses`, `software`) are re-syncable, so they're a warm start.

**Prod runbook** (in `C:\Apps\SDP-Dashboard`):
1. Backup PG first — `_sdp_admin.cmd` option 5 (`pg_dump`).
2. Copy the SQLite data into PG (preserves the history):
   `node tools\pg\copy-assets.js`  → check the printed counts; a large
   `skipped … NULL-PK` count on REAL data means a malformed export, investigate.
3. Parity check (sqlite `data\assets.db` vs pg): `assets` ≈ 2473,
   `asset_effort_history` = every captured snapshot.
4. `.env` → `ASSETS_BACKEND=postgres`.
5. Restart: `pm2 stop` → `timeout /t 5` → `pm2 start` (NOT reload).
6. Verify: Assets page loads, counts match, **Progress tab shows the effort
   trend** (proves the history survived). Optionally
   `POST /api/sync/trigger/assets` to confirm the sync writes to PG.
7. Rollback = unset `ASSETS_BACKEND` + restart (data written post-flip stays in
   PG). After success, **all** ops apps share `sdp_dashboard`.

> Caveat: the local `data/assets.db` is a test fixture (0 assets, NULL-PK child
> rows). A meaningful **parity dry-run must run against prod's real `assets.db`**;
> the copy-script *mechanics* are validated by `tests/copy-assets-nullpk.test.js`.

## Where the code lives

| Concern | File |
|---|---|
| PG adapter (better-sqlite3-shaped async surface, `?`→`$N`) | `services/pgDb.js` |
| Per-module dual-backend readers/writers | `tracker-db.js`, `meetings-db.js`, `inspection-db.js`, `reports-db.js`, `assets-db.js` |
| PG schema DDL | `db/postgres/<module>/*.sql` |
| One-shot SQLite→PG copy | `tools/pg/copy-*.js` |
| KPI reconciliation (sqlite vs pg) | `tools/pg/verify-*.js` |
| Backups / dump | `tools/pg/dump-db.js`, `_sdp_admin.cmd` |
