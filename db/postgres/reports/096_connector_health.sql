-- P4 (goals A2 + B9, 2026-11-12) — connector health fix tasks + weekly-report prefill provenance.
-- ADDITIVE and idempotent: two nullable columns on infra_kpis (existing rows read NULL = "provenance not
-- recorded", never "manual"), one new table. No existing row is rewritten.
--
-- infra_kpis.value_source        meraki | opmanager | manual | NULL — where the Current Value came from, as
--                                VERIFIED by the server at save time (a claimed auto source whose value does not
--                                match the snapshot is stored as 'manual').
-- infra_kpis.value_data_through  the data-through date of the snapshot behind an auto value (NULL otherwise).
ALTER TABLE infra_kpis ADD COLUMN IF NOT EXISTS value_source TEXT;
ALTER TABLE infra_kpis ADD COLUMN IF NOT EXISTS value_data_through TEXT;

-- A "—" (unknown) cell becomes a fix task with an owner. One OPEN task per connector × site × scope.
-- Timestamps are server-side (now()); closing is a separate audited gesture.
CREATE TABLE IF NOT EXISTS connector_fix_tasks (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  connector       TEXT NOT NULL,
  site_id         INTEGER,
  scope           TEXT NOT NULL DEFAULT '',
  cause           TEXT NOT NULL,
  owner_role      TEXT NOT NULL,
  owner_user_id   INTEGER,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  report_id       INTEGER,
  created_by      INTEGER,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by       INTEGER,
  closed_at       TIMESTAMPTZ,
  close_note      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_fix_tasks_open
  ON connector_fix_tasks (connector, COALESCE(site_id, 0), scope) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_connector_fix_tasks_site ON connector_fix_tasks (site_id, status);
