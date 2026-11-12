-- A1 (goal programme 2026-11-12) — Finance verifier: a HUMAN certification of a money figure.
-- ADDITIVE and idempotent; no existing row changes meaning. Used only while report_config
-- finance_certification_enabled = '1' (default '0' = today: nothing reads or writes these tables).
--
-- One certification = scope × scope_key × period, stamped with the SHA-256 of the figures as they stood when the
-- holder of the feature role `finance-verifier` certified them (who, when, evidence, source). The figures are
-- recomputed on every read: a different hash = "changed since certification" = NOT certified (the badge comes back).
-- The automatic coverage threshold (services/moneyCoverage.js) stays a separate COVERAGE indicator, never a certification.
--   scope      asset_finance | licences | investment | depreciation | project_benefits | project_actuals
--   scope_key  fleet | site:<asset site label> (asset scopes) · project:<id> (project scopes)
--   status     verified (current) | superseded (re-certified later) | revoked (withdrawn, with a reason)
-- At most ONE `verified` row per (scope, scope_key, period) — partial unique index.
CREATE TABLE IF NOT EXISTS finance_certifications (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope             TEXT NOT NULL CHECK (scope IN ('asset_finance', 'licences', 'investment', 'depreciation', 'project_benefits', 'project_actuals')),
  scope_key         TEXT NOT NULL,
  period            TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  figures_hash      TEXT NOT NULL,
  figures_summary   TEXT,
  evidence          TEXT NOT NULL,
  evidence_link     TEXT,
  source            TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'superseded', 'revoked')),
  certified_by      INTEGER NOT NULL,
  certified_by_name TEXT,
  certified_at      TEXT NOT NULL,
  revoked_by        INTEGER,
  revoked_by_name   TEXT,
  revoked_at        TEXT,
  revoke_reason     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_cert_active ON finance_certifications (scope, scope_key, period) WHERE status = 'verified';
CREATE INDEX IF NOT EXISTS idx_finance_cert_lookup ON finance_certifications (scope, scope_key, period, id);

-- Every certification act (certified / superseded / revoked) — append-only and hash-chained (same triggers as 034/054),
-- verified nightly by services/auditChain.js. This is the audit ledger the exports and the register read.
CREATE TABLE IF NOT EXISTS finance_certification_events (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  certification_id BIGINT NOT NULL,
  event            TEXT NOT NULL CHECK (event IN ('certified', 'superseded', 'revoked')),
  scope            TEXT NOT NULL,
  scope_key        TEXT NOT NULL,
  period           TEXT NOT NULL,
  figures_hash     TEXT,
  actor_id         INTEGER,
  actor_name       TEXT,
  at               TEXT NOT NULL,
  note             TEXT,
  prev_hash        TEXT,
  row_hash         TEXT
);
CREATE INDEX IF NOT EXISTS idx_finance_cert_events_cert ON finance_certification_events (certification_id, id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'finance_certification_events_append_only') THEN
    CREATE TRIGGER finance_certification_events_append_only BEFORE UPDATE OR DELETE ON finance_certification_events FOR EACH ROW EXECUTE FUNCTION sdp_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'finance_certification_events_hash_chain') THEN
    CREATE TRIGGER finance_certification_events_hash_chain BEFORE INSERT ON finance_certification_events FOR EACH ROW EXECUTE FUNCTION sdp_hash_chain();
  END IF;
END $$;
