-- C-31 — KPI Policy Builder for the KPI committee. A policy = one VERSION of a metric's definition, built from safe
-- blocks (services/kpiPolicyEngine.js — never free code / SQL text), stored as JSON and validated before every write.
--   draft → proposed (by its author) → adopted (by a kpi-committee member who is NOT the author, with a committee
--   reference) → retired. A rejected proposal goes back to draft. Adopted / retired versions are IMMUTABLE (trigger):
--   only their effective_to may be closed when a newer version supersedes them / they are retired.
-- Nothing is adopted by seed or by code: the rules in force today are seeded as 'proposed' (origin imported_from_code).
-- Behind report_config kpi_policy_enforced (default '0' = screens compute as today). ADDITIVE and idempotent.
CREATE TABLE IF NOT EXISTS kpi_policies (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metric_key TEXT NOT NULL,                  -- metric registry key (services/metricRegistry.js)
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  definition_json TEXT NOT NULL,             -- validated building blocks (kpiPolicyEngine.validate)
  effective_from TEXT,                       -- YYYY-MM-DD; set at adoption when empty
  effective_to TEXT,                         -- exclusive; set when superseded / retired
  owner TEXT,                                -- accountable owner (free text, e.g. a committee role)
  rationale TEXT,
  origin TEXT NOT NULL DEFAULT 'committee',  -- committee | imported_from_code
  created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  proposed_by INTEGER, proposed_at TEXT,
  adopted_by INTEGER, adopted_at TEXT,
  CONSTRAINT kpi_policies_status CHECK (status IN ('draft', 'proposed', 'adopted', 'retired')),
  CONSTRAINT kpi_policies_origin CHECK (origin IN ('committee', 'imported_from_code')),
  CONSTRAINT kpi_policies_adopted_has_decider CHECK (status NOT IN ('adopted', 'retired') OR adopted_by IS NOT NULL),
  CONSTRAINT uq_kpi_policies_version UNIQUE (metric_key, version));
CREATE INDEX IF NOT EXISTS idx_kpi_policies_metric ON kpi_policies(metric_key, status, effective_from);

CREATE TABLE IF NOT EXISTS kpi_policy_decisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  policy_id BIGINT NOT NULL REFERENCES kpi_policies(id),
  decision TEXT NOT NULL,
  decided_by INTEGER NOT NULL,               -- the human committee member (session user id)
  decided_at TEXT NOT NULL,
  committee_ref TEXT NOT NULL,               -- committee session / PV reference
  minutes TEXT,
  CONSTRAINT kpi_policy_decisions_kind CHECK (decision IN ('adopt', 'reject', 'retire')),
  CONSTRAINT kpi_policy_decisions_ref CHECK (length(trim(committee_ref)) > 0));
CREATE INDEX IF NOT EXISTS idx_kpi_policy_decisions_policy ON kpi_policy_decisions(policy_id);

CREATE TABLE IF NOT EXISTS kpi_policy_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  policy_id BIGINT NOT NULL REFERENCES kpi_policies(id),
  action TEXT NOT NULL,                      -- created | edited | proposed | adopted | rejected | retired | superseded | imported
  actor_id INTEGER,
  at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS idx_kpi_policy_history_policy ON kpi_policy_history(policy_id, id);

-- An adopted / retired version is frozen: its definition and identity never change, it is never deleted.
CREATE OR REPLACE FUNCTION sdp_kpi_policy_frozen() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('adopted', 'retired') THEN
      RAISE EXCEPTION 'kpi policy % is % and cannot be deleted', OLD.id, OLD.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('adopted', 'retired') AND (
       NEW.definition_json IS DISTINCT FROM OLD.definition_json OR NEW.metric_key IS DISTINCT FROM OLD.metric_key
    OR NEW.version IS DISTINCT FROM OLD.version OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
    OR NEW.title IS DISTINCT FROM OLD.title OR NEW.rationale IS DISTINCT FROM OLD.rationale
    OR NEW.adopted_by IS DISTINCT FROM OLD.adopted_by OR NEW.adopted_at IS DISTINCT FROM OLD.adopted_at
    OR NEW.status NOT IN ('adopted', 'retired') OR (OLD.status = 'retired' AND NEW.status <> 'retired')) THEN
    RAISE EXCEPTION 'kpi policy % is % and immutable', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $fn$ LANGUAGE plpgsql;

-- Decisions and history are append-only.
CREATE OR REPLACE FUNCTION sdp_kpi_policy_append_only() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $fn$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'kpi_policies_frozen') THEN
    CREATE TRIGGER kpi_policies_frozen BEFORE UPDATE OR DELETE ON kpi_policies FOR EACH ROW EXECUTE FUNCTION sdp_kpi_policy_frozen();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'kpi_policy_decisions_append_only') THEN
    CREATE TRIGGER kpi_policy_decisions_append_only BEFORE UPDATE OR DELETE ON kpi_policy_decisions FOR EACH ROW EXECUTE FUNCTION sdp_kpi_policy_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'kpi_policy_history_append_only') THEN
    CREATE TRIGGER kpi_policy_history_append_only BEFORE UPDATE OR DELETE ON kpi_policy_history FOR EACH ROW EXECUTE FUNCTION sdp_kpi_policy_append_only();
  END IF;
END $$;
