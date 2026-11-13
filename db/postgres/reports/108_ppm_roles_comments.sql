-- PPM parity W4 (enterprise) — finer project roles + comments with @mentions. ADDITIVE and idempotent: one new column,
-- one new table; no existing row changes meaning. Both are read and written only while their PROPOSED report_config
-- switch is '1' (ppm_project_roles_enabled, ppm_comments_enabled — '0' = today: the routes answer 404 / the rules ignore
-- the column). Rollback: db/postgres_rollback/108_ppm_roles_comments_drop.sql.

-- W4-ROLES — a per-project role on a team member that is linked to a user account (ppm_project_members.user_id). NULL =
-- no project role (today's rules apply). The free-text `role` column (job title) is untouched.
ALTER TABLE ppm_project_members ADD COLUMN IF NOT EXISTS ppm_role TEXT
  CHECK (ppm_role IS NULL OR ppm_role IN ('pm', 'scheduler', 'resource_manager', 'contributor', 'client'));

-- W4-COMMENTS — comments on a project or one of its tasks. APPEND-ONLY: an UPDATE raises (a comment is never edited;
-- a correction is a new comment). Removing the project or the task (hard purge) removes its comments with it.
-- mentions_json holds the user ids the server resolved among the people who may read the project, never the others.
CREATE TABLE IF NOT EXISTS ppm_comments (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id    BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  task_id       BIGINT REFERENCES portfolio_tasks(id) ON DELETE CASCADE,
  body          TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  author_id     INTEGER,
  author_name   TEXT,
  mentions_json TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ppm_comments_project ON ppm_comments(project_id, id);
CREATE INDEX IF NOT EXISTS idx_ppm_comments_task ON ppm_comments(task_id, id);
CREATE OR REPLACE FUNCTION sdp_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only table %: % refused', TG_TABLE_NAME, TG_OP; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ppm_comments_append_only') THEN
    CREATE TRIGGER ppm_comments_append_only BEFORE UPDATE ON ppm_comments FOR EACH ROW EXECUTE FUNCTION sdp_append_only();
  END IF;
END $$;
