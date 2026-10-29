-- UAT 2026-10-29 (users seat F-02): a PV signature records WHO stamped it, and whether it was stamped
-- on behalf of the named person (with the reason). Additive, idempotent.
ALTER TABLE md_meetings ADD COLUMN IF NOT EXISTS dept_head_signed_by TEXT;
ALTER TABLE md_meetings ADD COLUMN IF NOT EXISTS dept_head_signed_on_behalf TEXT;
ALTER TABLE md_meetings ADD COLUMN IF NOT EXISTS site_it_signed_by TEXT;
ALTER TABLE md_meetings ADD COLUMN IF NOT EXISTS site_it_signed_on_behalf TEXT;
