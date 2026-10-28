-- Committee review 2026-10-28 (audit P2-11): reopening accepted minutes used to overwrite the previous
-- acceptance. Every acceptance and every reopening is now appended here (append-only in the database).
CREATE TABLE IF NOT EXISTS minutes_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id BIGINT NOT NULL, action TEXT NOT NULL, actor_id INTEGER, at TEXT NOT NULL, reason TEXT);
CREATE INDEX IF NOT EXISTS idx_minutes_history_session ON minutes_history(session_id, id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'minutes_history_append_only') THEN
    CREATE TRIGGER minutes_history_append_only BEFORE UPDATE OR DELETE ON minutes_history FOR EACH ROW EXECUTE FUNCTION sdp_append_only();
  END IF;
END $$;
