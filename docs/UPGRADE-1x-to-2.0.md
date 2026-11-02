# Upgrading a 1.x installation to 2.0 — data still in SQLite

SDP360 2.0 reads **PostgreSQL only**. It ignores the `*_BACKEND` variables of 1.x, so a 1.x module that still
keeps its data in a SQLite file would start on an **empty** PostgreSQL schema after the upgrade — nothing would
warn you. Setup therefore checks this **before changing anything** (before the PostgreSQL minor upgrade, before
the dependencies, before the package copy).

## What Setup checks

For each module (`ASSETS`, `REPORTS`, `TRACKER`, `MEETINGS`, `INSPECTION`) it reads the variable
`<MODULE>_BACKEND` in the current `.env`:

| Value in `.env` | On a 1.x installation | On a 2.x installation |
|---|---|---|
| `postgres` | OK | OK |
| unset | **refused** (1.x defaulted to SQLite when unset) | OK (2.0 is PostgreSQL only) |
| `sqlite` (any case) or anything else | **refused** | **refused** |

The `.db` files are only evidence: `<SDP_DATA_DIR or data>\<module>.db`, and for tracker / meetings / inspection
also the old root path `<app>\<module>.db`.

- **Refusal** — `ASSETS still reads SQLite (ASSETS_BACKEND=unset, 1.x default sqlite) — data in C:\Apps\SDP-Dashboard\data\assets.db`.
  Setup stops with "Nothing was changed. See docs/UPGRADE-1x-to-2.0.md"; the error is in `logs\setup-last.json`
  and the full log in `logs\setup-<stamp>.log`. The previous version keeps running.
- **Warning** — `...\data\tracker.db is a frozen archive, kept, never read by 2.0`. Normal on a server whose
  module was moved to PostgreSQL in 2026-07: the file is kept as an archive, Setup carries on.

Most likely case in production: **ASSETS** (its cutover was never done), the four other modules being on
PostgreSQL with frozen archives.

Note: Inno Setup has already copied its own runtime files (`runtime\node`, `service`, `manager`) into the
application folder when the check runs; the application, its dependencies, `.env`, the data and the database
are untouched, and the running 1.x process does not use those folders.

## The procedure

1. **Back up first.** On 1.x: `_sdp_admin.cmd` option 5 (restore point with `pg_dump`), or
   `node tools\pg\dump-db.js`. Keep a copy of `data\assets.db` too (it is never modified, but copy it anyway).
2. Run the 2.0 Setup — it is refused (see above). Nothing changed.
3. Copy the SQLite data into PostgreSQL. The target tables must exist (created by the 2.0 migrator). Either:
   - **with 2.0's tool** (once the 2.0 files and migrations are available on the server, for example after
     installing 2.0 next to the 1.x folder, or with `/IGNORELEGACYSTORE=1` on a TEST copy), from the 2.0
     application folder:
     ```
     tools\pg\copy-legacy-sqlite.cmd --module assets --source C:\Apps\SDP-Dashboard\data\assets.db
     ```
     This is a **dry run**: it prints the source row counts, the target row counts and what `--apply` would do,
     and writes nothing. Read it, take a fresh `pg_dump`, then:
     ```
     tools\pg\copy-legacy-sqlite.cmd --module assets --source C:\Apps\SDP-Dashboard\data\assets.db --apply
     ```
     One transaction; rows with an empty primary key are skipped and counted; `asset_import_log` (no key) is
     copied only into an empty table; a second `--apply` is harmless. Exit 2 with "run db/migrate.js --apply
     first" means the schema is not there yet. Exit 3 means a target holds fewer rows than the source: stop and
     investigate.
   - **or with the 1.x tree's own tool, before upgrading**: `node tools\pg\copy-assets.js` from the 1.x folder
     (the 1.11 line still ships it with `better-sqlite3`; it applies the assets schema itself).
4. Set `ASSETS_BACKEND=postgres` in the 1.x `.env` (only after a successful copy). Optionally restart 1.x and
   check the Assets page and the Progress tab (effort trend) read from PostgreSQL.
5. Run the 2.0 Setup again: the check now passes (warnings only for the archived `.db` files).

`/IGNORELEGACYSTORE=1` (post-install: `--ignore-legacy-store`) skips the refusal and logs
"legacy store check overridden by the operator". Use it only when you have proven the copy is done, or knowingly
on a TEST server.

## Rollback

- The copy: restore the `pg_dump` taken just before `--apply` (`sdp-manager restore <dump> --confirm "RESTORE <yyyymmdd>"`
  on 2.0, or the 1.x restore point). The SQLite file is never modified (opened read-only), so 1.x keeps running
  on it as long as `ASSETS_BACKEND` stays unset.
- The check itself: none needed — a refusal changes nothing.
