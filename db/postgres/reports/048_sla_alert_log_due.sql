-- A-23 (2026-11-04) — Teams SLA alerts: remember the deadline an alert was sent for, so the
-- optional dedup_mode 'per_due' (teams_sla_rules) can alert again when SDP re-plans a due date.
-- Additive and nullable: existing rows keep NULL and count as already sent (no flood after
-- deploy). The primary key (request_id, kind) is unchanged. Default mode 'once' = today.
-- Manual rollback: db/postgres_rollback/048_sla_alert_log_due_drop.sql
ALTER TABLE sla_alert_log ADD COLUMN IF NOT EXISTS due_ms BIGINT;
