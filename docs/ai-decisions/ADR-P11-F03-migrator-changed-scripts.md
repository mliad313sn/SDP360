# ADR-P11-F03 — Applied migration scripts whose bytes changed

**Status:** accepted (AI technical decision, reversible). **Date:** 2026-11-20. **Finding:** P11 data-kpi F-03 (P2).

## Context
`db/migrate.js` re-executed any applied script whose checksum changed. Scripts are written idempotent for DDL, but
some carry one-shot data backfills (`reports/039_native_ppm.sql` resets `stage` from `status`; `reports/066_site_time_zone.sql`
defaults `time_zone` from the country). A comment-only edit therefore re-ran those backfills at the next boot,
over values users had changed since (e.g. a time zone deliberately cleared to NULL = "derive").

## Options
1. Refuse every changed applied script (freeze). Safest for data, but the history shows DDL-only files that were
   extended by append after they shipped (`reports/085`, `sync/001`, `reports/081`, `reports/071`): a freeze would
   silently drop such a change on any database that had applied the earlier version, and a missing column is an outage.
2. Guard only 039/066 with run-once markers. Fixes today's two files; the next backfill author can forget.
3. **Chosen:** classify by content. A changed script that **writes data** (INSERT INTO, UPDATE … SET, DELETE FROM,
   TRUNCATE, MERGE INTO, COPY … FROM — also inside a DO block or an EXECUTE string; comments stripped; conservative, any match counts) is **not re-executed**: it is
   reported in `changed`/`notReapplied`, stays `changed` in `--status`, and logs a warning on every run. A DDL-only
   script keeps the historical contract (re-applied once, journal checksum updated). Line markers override the
   detection: `-- migrate:rerun-on-change` (a reviewed, idempotent data seed) and `-- migrate:run-once`.

## Consequences
- 9 scripts in the repo currently classify as data scripts (reports/015, 034, 039, 041, 059, 061, 066, 082, tracker/001). An edit to
  one of them no longer reaches an existing database: the change belongs in a new file (ADR-002 rule unchanged).
- `tests/pg-migrate-changed.test.js` pins the behaviour, including that 039 and 066 never re-run and that 085 / sync/001
  keep re-applying.
- Rollback: revert `db/migrate.js` (no schema or data change involved).
