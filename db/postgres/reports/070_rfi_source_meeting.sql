-- E-I04 (audit I-04, P-07 link half) — an RFI can be raised FROM a Business Incubation session: one RFI per
-- session (unique where not null), so the lineage session → RFI → project (portfolio_projects.rfi_id) is one
-- continuous id chain. NULL = an RFI typed on the RFI page (today). Used only while report_config
-- incubation_rfi_link_enabled = '1' (default '0'). ADDITIVE and idempotent.
ALTER TABLE rfi_requests ADD COLUMN IF NOT EXISTS source_meeting_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rfi_source_meeting ON rfi_requests(source_meeting_id) WHERE source_meeting_id IS NOT NULL;
