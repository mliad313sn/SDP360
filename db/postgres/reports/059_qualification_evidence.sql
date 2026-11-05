-- C-19 (G41 · PO decision R10) — qualification EVIDENCE. SDP360 records that a person showed evidence of a
-- qualification (an induction, an electrical authorisation…); it NEVER grants a physical authorisation.
--   qualification_kinds    editable list (seeded: site-induction, electrical-authorisation, working-at-height,
--                          confined-space). Issuer names are human data given by each site's HSE owner.
--   qualification_records  one piece of evidence: recorded by an admin-tier user, verified by someone who is
--                          neither the holder nor the recorder (services/sodPolicy.js 'qualification.verify').
--                          status recorded → verified | rejected; verified → revoked. Expiry is read from
--                          expires_on (an expired record is never "valid").
-- ADDITIVE and idempotent. Empty records table + qualification_check_enabled='0' = the behaviour until now.
CREATE TABLE IF NOT EXISTS qualification_kinds (
  key TEXT PRIMARY KEY,
  name_en TEXT NOT NULL, name_fr TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER, updated_at TEXT,
  CONSTRAINT qualification_kinds_key CHECK (key ~ '^[a-z0-9][a-z0-9-]{1,47}$'));
INSERT INTO qualification_kinds (key, name_en, name_fr, display_order) VALUES
  ('site-induction', 'Site induction', 'Induction de site', 1),
  ('electrical-authorisation', 'Electrical authorisation', 'Habilitation électrique', 2),
  ('working-at-height', 'Working at height', 'Travail en hauteur', 3),
  ('confined-space', 'Confined space', 'Espace confiné', 4)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS qualification_records (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  issuer TEXT,                               -- free text (HSE owner's naming)
  issued_on TEXT,                            -- YYYY-MM-DD
  expires_on TEXT,                           -- YYYY-MM-DD inclusive; NULL = no expiry
  evidence_ref TEXT,                         -- reference of the paper/scan (never the document itself)
  notes TEXT,
  recorded_by INTEGER NOT NULL, recorded_at TEXT NOT NULL,
  verified_by INTEGER, verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'recorded',
  status_by INTEGER, status_at TEXT, status_reason TEXT,
  CONSTRAINT qualification_records_status CHECK (status IN ('recorded', 'verified', 'rejected', 'revoked')),
  CONSTRAINT qualification_records_verifier CHECK (verified_by IS NULL OR (verified_by <> user_id AND verified_by <> recorded_by)));
CREATE INDEX IF NOT EXISTS idx_qualification_records_user ON qualification_records(user_id, kind, status);
