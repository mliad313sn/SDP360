# 07 — Migration and rollback

| Change | Schema | Data | Feature flag | Rollback |
|---|---|---|---|---|
| P0-C test census (`645f940`) | none | none | — | revert commit |
| P0 security transplant (`efd92e9`) | none | none | — (behaviour change for site-scoped readers and business-only accounts) | revert commit; no data to restore |
| Dependency fixes (`9e7d5f1`) | none | none | — | revert `package.json` + lock; `npm ci` |
| DEC-03 (`6a556de`) | none | none | — | revert commit |
| PO-08 PostgreSQL only | none (schema already in `db/postgres/**`) | none — prod is already on PostgreSQL | — (the `*_BACKEND` variables are ignored) | revert the branch commits; an install that still ran a module on SQLite must migrate it first (that path no longer exists) |

**User-visible effect to communicate before any release:** a non-admin account **without a site** sees empty
meetings and inspection lists (previously every site); business-only accounts get 403 outside Site Awareness.
Accounts that need fleet visibility must hold `admin`/`executive` (PO-05) or `group-business` for Site Awareness.

Migrations: none added so far. The PG migrator was verified idempotent on an empty PG 16 database (27 → 0).

**PO-08 operator notes.** (1) The server now refuses to start without `PG_URL`. (2) `better-sqlite3` is gone from
`package.json`: the deploy ZIP must carry the new `package-lock.json` (step 4 rule — full `node_modules`, swap +
rollback on prod). (3) A *fresh* database is fully seeded by the application itself (admin, default sites,
tracker programme, dashboards/templates); an existing database is never re-seeded. (4) Recovery is a PostgreSQL
restore (`docs/DB_RECOVERY.md`); the per-module `.db` snapshot files and their CLI tools were deleted.
