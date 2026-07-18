-- Postgres schema for the Assets module (Task 0 — Foundation).
-- Mirrors the tracker/meetings/inspection module pattern but PostgreSQL-ready
-- from day one. Plain portable DDL: every column TEXT (no currency coercion —
-- purchase_cost / cost stay TEXT), composite PK on asset_monitors, and an index
-- on the join key (workstation_id) for every component table. All statements are
-- CREATE ... IF NOT EXISTS so this ONE file is valid on BOTH sqlite and Postgres
-- and can be applied idempotently on either backend.

CREATE TABLE IF NOT EXISTS assets (
  asset_id TEXT PRIMARY KEY,
  asset_name TEXT,
  product TEXT,
  product_type TEXT,
  manufacturer TEXT,
  state TEXT,
  serial_number TEXT,
  barcode TEXT,
  site TEXT,
  site_id TEXT,
  asset_tag TEXT,
  purchase_cost TEXT,
  total_cost_of_ownership TEXT,
  operational_cost TEXT,
  current_book_value TEXT,
  months_since_acquisition TEXT,
  acquisition_date TEXT,
  warranty_expiry TEXT,
  user_name TEXT,
  department TEXT,
  last_successful_audit_time TEXT,
  last_audit_status TEXT,
  days_since_scan TEXT,
  last_scan_source TEXT,
  created_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_assets_site ON assets (site);
CREATE INDEX IF NOT EXISTS idx_assets_state ON assets (state);

CREATE TABLE IF NOT EXISTS asset_memory (
  memory_module_id TEXT PRIMARY KEY,
  workstation_id TEXT,
  capacity_gb TEXT,
  socket_label TEXT,
  module_tag TEXT
);
CREATE INDEX IF NOT EXISTS idx_asset_memory_ws ON asset_memory (workstation_id);

CREATE TABLE IF NOT EXISTS asset_logical_drives (
  drive_id TEXT PRIMARY KEY,
  workstation_id TEXT,
  drive_letter TEXT,
  capacity_gb TEXT,
  free_gb TEXT,
  free_pct TEXT,
  file_type TEXT
);
CREATE INDEX IF NOT EXISTS idx_asset_logical_drives_ws ON asset_logical_drives (workstation_id);

CREATE TABLE IF NOT EXISTS asset_monitors (
  workstation_id TEXT NOT NULL,
  monitor_id TEXT NOT NULL,
  monitor_type TEXT,
  manufacturer TEXT,
  serial_number TEXT,
  PRIMARY KEY (workstation_id, monitor_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_monitors_ws ON asset_monitors (workstation_id);

CREATE TABLE IF NOT EXISTS software_licenses (
  license_id TEXT PRIMARY KEY,
  license_name TEXT,
  license_type TEXT,
  license_state TEXT,
  expiry_date TEXT,
  cost TEXT,
  site TEXT,
  vendor TEXT,
  software_id TEXT,
  license_option TEXT,
  installations_allowed TEXT,
  acquisition_date TEXT,
  organization_license TEXT
);
CREATE INDEX IF NOT EXISTS idx_software_licenses_state ON software_licenses (license_state);

CREATE TABLE IF NOT EXISTS software (
  software_id TEXT PRIMARY KEY,
  software_name TEXT,
  manufacturer TEXT,
  licensed_installations TEXT,
  installations TEXT,
  installations_allowed TEXT,
  available_for_allocation TEXT,
  allocated_to_downgrades TEXT,
  purchased TEXT,
  allocated TEXT,
  purchased_cal TEXT,
  compliance_type TEXT,
  software_category TEXT,
  software_type TEXT
);
CREATE INDEX IF NOT EXISTS idx_software_compliance_type ON software (compliance_type);
