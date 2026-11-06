-- E-S05 (audit S-08, X-SEC-02) — the PBKDF2 work factor each password hash was made with. NULL = 100000, the
-- count every hash before this column used (reports-db.js hashPassword). A successful login rehashes once when the
-- stored count is below report_config auth_pbkdf2_iterations (default '100000' = today, nothing rehashed).
-- ADDITIVE and idempotent; no existing row is touched; no password reset is forced.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_iterations INTEGER;
