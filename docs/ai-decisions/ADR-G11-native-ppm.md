# ADR-G11 — Native PPM on the existing portfolio tables

Status: accepted (technical) · 2026-10-29 · reviewers: PPM architect + data architect personas

Decision: extend `portfolio_*` (migration 039) with stage gates, charter, baseline/forecast/actual, WBS tasks and one
append-only hash-chained ledger `ppm_events` (gate passages, financial edits, RFI decisions). Scheduling rules are pure
(`services/projectSchedule.js`). Alternatives rejected: a separate PPM module (duplicates the portfolio, forbidden by
the boundaries); an external PPM connector (forbidden). Rollback: the migration is additive; new columns and tables can
be ignored; existing projects keep their status, `stage` is derived from it once.
