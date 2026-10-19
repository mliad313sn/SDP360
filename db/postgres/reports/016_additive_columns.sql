-- Step 2 (SDP-DASH-2.0) — the additive DDL that used to live inline in initPgReports(),
-- moved verbatim so db/migrate.js is the only path that changes the schema. Idempotent.

-- SP1b / SP1b-lignée / 2026-10-16 — action_items stable uid, merge link, lineage, status date.
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS uid TEXT;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS origin_id INTEGER;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS lineage TEXT;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS status_changed_at TEXT;

-- V1b-E — sub_site on wan_link_snapshots + the 5-column primary key (guarded: runs once on
-- databases created before V1b-E; fresh installs already have it from 008).
ALTER TABLE wan_link_snapshots ADD COLUMN IF NOT EXISTS sub_site TEXT NOT NULL DEFAULT '';
ALTER TABLE wan_link_snapshots ADD COLUMN IF NOT EXISTS avail_quality_pct DOUBLE PRECISION;
ALTER TABLE wan_link_snapshots ADD COLUMN IF NOT EXISTS loss_pct_max DOUBLE PRECISION;
ALTER TABLE wan_link_snapshots ADD COLUMN IF NOT EXISTS latency_ms_max DOUBLE PRECISION;
ALTER TABLE wan_link_snapshots ADD COLUMN IF NOT EXISTS avail_samples INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wan_link_snapshots_pkey'
                 AND conrelid='wan_link_snapshots'::regclass
                 AND array_length(conkey,1)=5) THEN
    ALTER TABLE wan_link_snapshots DROP CONSTRAINT IF EXISTS wan_link_snapshots_pkey;
    ALTER TABLE wan_link_snapshots ADD PRIMARY KEY (site_id, sub_site, uplink, period_type, period_start);
  END IF;
END $$;

-- V1b-E — editable sub-site → Meraki network map (Exploration). Seeded by initPgReports().
CREATE TABLE IF NOT EXISTS wan_subsite_networks (
  site_id  INTEGER NOT NULL,
  sub_site TEXT NOT NULL,
  network  TEXT NOT NULL,
  PRIMARY KEY (site_id, sub_site)
);

-- V1b-B — recent-vs-window label on infra_metric_snapshots.
ALTER TABLE infra_metric_snapshots ADD COLUMN IF NOT EXISTS basis TEXT;

-- Asset engagement — per-site asset manager contact on the recipients directory.
ALTER TABLE report_recipients ADD COLUMN IF NOT EXISTS asset_manager_name TEXT;
ALTER TABLE report_recipients ADD COLUMN IF NOT EXISTS asset_manager_email TEXT;
ALTER TABLE report_recipients ADD COLUMN IF NOT EXISTS asset_manager_email_confirmed INTEGER DEFAULT 0;
