-- D-07 (AMDEC AM-08 / DAT-06) — optional IANA time zone per site, used ONLY when report_config
-- site_local_calendar = '1' (default '0' = every calendar stays UTC, today's behaviour). NULL = derive it from the
-- site's country (services/siteTimeZone.js) or UTC when the country is unknown. Existing rows are defaulted from
-- their country where it is known; nothing else reads this column yet. ADDITIVE and idempotent.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS time_zone TEXT;
UPDATE sites SET time_zone = CASE UPPER(country)
    WHEN 'SN' THEN 'Africa/Dakar' WHEN 'BF' THEN 'Africa/Ouagadougou' WHEN 'CI' THEN 'Africa/Abidjan'
    WHEN 'ML' THEN 'Africa/Bamako' WHEN 'GB' THEN 'Europe/London' END
  WHERE time_zone IS NULL AND country IS NOT NULL
    AND UPPER(country) IN ('SN', 'BF', 'CI', 'ML', 'GB');
