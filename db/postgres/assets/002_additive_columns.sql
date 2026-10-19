-- Step 2 (SDP-DASH-2.0) — PostgreSQL-only additive columns (formerly a loop over _ADDED_COLS in
-- initPgAssets). 001_init.sql is shared with sqlite and must stay ALTER-free; sqlite adds these
-- columns in getDB(). tests/schema-migrations.test.js keeps this file in step with _ADDED_COLS.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_tag TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS total_cost_of_ownership TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS operational_cost TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS current_book_value TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS months_since_acquisition TEXT;
ALTER TABLE software_licenses ADD COLUMN IF NOT EXISTS license_option TEXT;
ALTER TABLE software_licenses ADD COLUMN IF NOT EXISTS installations_allowed TEXT;
ALTER TABLE software_licenses ADD COLUMN IF NOT EXISTS acquisition_date TEXT;
ALTER TABLE software_licenses ADD COLUMN IF NOT EXISTS organization_license TEXT;
