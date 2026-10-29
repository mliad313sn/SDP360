-- Committee review 2026-10-28 (#49, architect): scope beyond the site. A site carries an optional
-- country and business unit; a governance policy can be set for a country or a business unit and is
-- resolved site → country → business unit → platform. NULL = not grouped (the behaviour until now).
-- ADDITIVE and idempotent.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS business_unit TEXT;
