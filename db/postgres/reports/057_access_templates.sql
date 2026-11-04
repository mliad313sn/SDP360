-- C-18 (G38 / A02) — access templates: a NAMED bundle of roles (and a site rule) that a request can be filed
-- from. A template never grants anything by itself: a request built from it still needs an approval bound to
-- one user × role × site × dates (058). A template is versioned; a PUBLISHED version is immutable (trigger
-- below) — a change is a new version, and existing grants keep the version they were approved from.
-- ADDITIVE and idempotent. Empty tables = the behaviour until now.
CREATE TABLE IF NOT EXISTS access_templates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,                 -- e.g. site-coordinator
  title_en TEXT NOT NULL, title_fr TEXT NOT NULL,
  intended_position TEXT,                   -- free text: who this bundle is meant for
  owner_user_id INTEGER,
  created_by INTEGER, created_at TEXT NOT NULL,
  retired_by INTEGER, retired_at TEXT);

CREATE TABLE IF NOT EXISTS access_template_versions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES access_templates(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',     -- draft | published
  payload TEXT NOT NULL,                    -- JSON {roles[], site_rule: primary|listed, max_days}
  created_by INTEGER, created_at TEXT NOT NULL,
  published_by INTEGER, published_at TEXT,
  CONSTRAINT access_template_versions_status CHECK (status IN ('draft', 'published')),
  CONSTRAINT access_template_versions_uniq UNIQUE (template_id, version));
CREATE INDEX IF NOT EXISTS idx_access_template_versions_tpl ON access_template_versions(template_id, version);

-- A published version is frozen: no UPDATE, no DELETE (publishing itself is the draft → published UPDATE).
CREATE OR REPLACE FUNCTION sdp_access_template_version_frozen() RETURNS trigger AS $fn$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'access template version % is published and immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $fn$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'access_template_versions_frozen') THEN
    CREATE TRIGGER access_template_versions_frozen BEFORE UPDATE OR DELETE ON access_template_versions FOR EACH ROW EXECUTE FUNCTION sdp_access_template_version_frozen();
  END IF;
END $$;
