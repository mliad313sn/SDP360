-- G07 (programme 2026-10-29) — a published report is frozen in the DATABASE, not only in the application:
-- report_publications keeps the exact HTML, figures and analysis as released, with its SHA-256, in an
-- append-only, hash-chained table. A withdrawal keeps the publication; a correction is a NEW run that names the
-- run it supersedes. ADDITIVE and idempotent.
CREATE TABLE IF NOT EXISTS report_publications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id BIGINT NOT NULL, html TEXT NOT NULL, html_sha256 TEXT NOT NULL, figures TEXT, analysis TEXT,
  published_at TEXT NOT NULL, published_by INTEGER, override TEXT);
CREATE INDEX IF NOT EXISTS idx_report_publications_run ON report_publications(run_id, id);
ALTER TABLE report_publications ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE report_publications ADD COLUMN IF NOT EXISTS row_hash TEXT;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS supersedes_id BIGINT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'report_publications_append_only') THEN
    CREATE TRIGGER report_publications_append_only BEFORE UPDATE OR DELETE ON report_publications FOR EACH ROW EXECUTE FUNCTION sdp_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'report_publications_hash_chain') THEN
    CREATE TRIGGER report_publications_hash_chain BEFORE INSERT ON report_publications FOR EACH ROW EXECUTE FUNCTION sdp_hash_chain();
  END IF;
END $$;
