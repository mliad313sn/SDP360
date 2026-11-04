-- A-24 (2026-11-04) — every SUBMISSION of a weekly report records the canonical figures as they
-- stood at that moment and their SHA-256, in an append-only, hash-chained table (same triggers as
-- report_publications, 040). The hash is integrity evidence ("did the figures change after
-- submission?"), never an approval or a signature. ADDITIVE and idempotent: no existing row of
-- weekly_reports is touched, past submissions get no hash (GET /integrity says so).
CREATE TABLE IF NOT EXISTS weekly_report_submissions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id INTEGER NOT NULL, site_id INTEGER, submitted_by INTEGER, submitted_at TEXT NOT NULL,
  figures_json TEXT NOT NULL, figures_sha256 TEXT NOT NULL,
  prev_hash TEXT, row_hash TEXT);
CREATE INDEX IF NOT EXISTS idx_weekly_report_submissions_report ON weekly_report_submissions(report_id, id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'weekly_report_submissions_append_only') THEN
    CREATE TRIGGER weekly_report_submissions_append_only BEFORE UPDATE OR DELETE ON weekly_report_submissions FOR EACH ROW EXECUTE FUNCTION sdp_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'weekly_report_submissions_hash_chain') THEN
    CREATE TRIGGER weekly_report_submissions_hash_chain BEFORE INSERT ON weekly_report_submissions FOR EACH ROW EXECUTE FUNCTION sdp_hash_chain();
  END IF;
END $$;
