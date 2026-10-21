-- 2027 Goal 02 — canonical business commitment + verified closure. ADDITIVE and idempotent:
-- five new tables, no change to any existing table. Mirror: services/commitmentStore.js SQLITE_DDL.
-- Rollback: feature flag commitments_enabled='0' (no behaviour change); to remove the data entirely
-- run db/postgres_rollback/021_commitments_drop.sql by hand (never applied by the migrator).

CREATE TABLE IF NOT EXISTS commitments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, uid TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
  site_id INTEGER, department TEXT, process TEXT, impact_dimension TEXT, priority TEXT, severity TEXT NOT NULL DEFAULT 'medium',
  accountable_owner TEXT, execution_owners TEXT, reviewer TEXT, due_date TEXT, baseline_due_date TEXT,
  exception_approved_by TEXT, exception_approved_at TEXT, exception_reason TEXT, treatment_plan TEXT,
  status TEXT NOT NULL DEFAULT 'captured', technical_completed_at TEXT, verified_at TEXT, verified_by TEXT,
  version INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_commitments_site_status ON commitments(site_id, status);
CREATE TABLE IF NOT EXISTS commitment_source_links (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, commitment_id BIGINT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL, source_id TEXT NOT NULL, relation TEXT NOT NULL DEFAULT 'origin', created_by TEXT, created_at TEXT,
  UNIQUE (commitment_id, source_system, source_id));
CREATE INDEX IF NOT EXISTS idx_commitment_links_source ON commitment_source_links(source_system, source_id);
CREATE TABLE IF NOT EXISTS commitment_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, commitment_id BIGINT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  at TEXT NOT NULL, actor TEXT, action TEXT NOT NULL, from_status TEXT, to_status TEXT, details TEXT);
CREATE INDEX IF NOT EXISTS idx_commitment_events_c ON commitment_events(commitment_id, id);
CREATE TABLE IF NOT EXISTS evidence_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, commitment_id BIGINT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'document', file_ref TEXT, url TEXT, filename TEXT, sha256 TEXT, size_bytes INTEGER, mime TEXT,
  uploaded_by TEXT, uploaded_at TEXT, site_id INTEGER, retention_class TEXT NOT NULL DEFAULT 'standard', version INTEGER NOT NULL DEFAULT 1, superseded_by BIGINT);
CREATE TABLE IF NOT EXISTS closure_verifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, commitment_id BIGINT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL, reviewer TEXT NOT NULL, decision TEXT NOT NULL, reason TEXT, at TEXT NOT NULL);
