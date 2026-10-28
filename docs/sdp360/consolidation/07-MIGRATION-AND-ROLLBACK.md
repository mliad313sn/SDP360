# 07 — Migration and rollback

| Change | Schema | Data | Feature flag | Rollback |
|---|---|---|---|---|
| P0-C test census (`645f940`) | none | none | — | revert commit |
| P0 security transplant (`efd92e9`) | none | none | — (behaviour change for site-scoped readers and business-only accounts) | revert commit; no data to restore |
| Dependency fixes (`9e7d5f1`) | none | none | — | revert `package.json` + lock; `npm ci` |
| DEC-03 (`6a556de`) | none | none | — | revert commit |

**User-visible effect to communicate before any release:** a non-admin account **without a site** sees empty
meetings and inspection lists (previously every site); business-only accounts get 403 outside Site Awareness.
Accounts that need fleet visibility must hold `admin`/`executive` (PO-05) or `group-business` for Site Awareness.

Migrations: none added so far. The PG migrator was verified idempotent on an empty PG 16 database (27 → 0).
