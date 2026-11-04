-- A-14 (2026-11) — project record page (public/project.html). ADDITIVE and idempotent; no existing row changes
-- except that every existing risk reads kind = 'risk' through the column default (today's meaning).
--   portfolio_tasks.progress_pct   percent complete of a task (0..100, null = not reported)
--   portfolio_tasks.effort_hours   work estimate in hours (>= 0, null = unknown) — used later by capacity (A-13)
--   portfolio_milestones.owner     who answers for the milestone (free text, like every PPM owner)
--   portfolio_risks.kind           RAID kind: risk | issue | assumption. Only kind = 'risk' counts toward the
--                                  closure gate GATE_OPEN_RISKS (services/governanceStore.moveProjectStage).
ALTER TABLE portfolio_tasks ADD COLUMN IF NOT EXISTS progress_pct NUMERIC;
ALTER TABLE portfolio_tasks ADD COLUMN IF NOT EXISTS effort_hours NUMERIC;
ALTER TABLE portfolio_milestones ADD COLUMN IF NOT EXISTS owner TEXT;
ALTER TABLE portfolio_risks ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'risk';
