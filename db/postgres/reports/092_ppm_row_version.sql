-- W1-INTEGRITY / I-CONC-1 (PPM parity W0, P0) — optimistic concurrency on the plan rows that people edit at the same
-- time. ADDITIVE and idempotent: every existing row reads version 1 through the column default; no row changes meaning.
-- Every write of a project / task / milestone bumps version (services/governanceStore.updateRow); a write that SENDS the
-- version it read is refused with 409 STALE_VERSION when someone saved in between. A write without a version keeps
-- today's last-writer-wins behaviour (backward compatible). Rollback: db/postgres_rollback/092_ppm_row_version_drop.sql.
ALTER TABLE portfolio_projects   ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE portfolio_tasks      ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE portfolio_milestones ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
