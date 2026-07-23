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

-- Append-only daily effort-snapshot history (asset-manager effort trend).
-- The source tables are full-replaced each night, so this is the ONLY source of
-- the trend. One row per (snapshot_date, site); the six *_pct are good-state
-- percentages (1 - worklist/total), effort_score = round(100 * mean of the six).
-- `ghost` is stored as a detail column but is NOT part of the score.
CREATE TABLE IF NOT EXISTS asset_effort_history (
  snapshot_date TEXT NOT NULL,
  site          TEXT NOT NULL,
  total         INTEGER,
  no_cost       INTEGER,
  no_age        INTEGER,
  no_owner      INTEGER,
  never_scanned INTEGER,
  no_asset_tag  INTEGER,
  discovered    INTEGER,
  ghost         INTEGER,
  cost_pct      REAL,
  age_pct       REAL,
  owner_pct     REAL,
  scan_pct      REAL,
  tag_pct       REAL,
  enrolled_pct  REAL,
  effort_score  REAL,
  PRIMARY KEY (snapshot_date, site)
);

-- ── Réconciliation SDP × Active Directory × Entra ID ────────────────────────
-- L'inventaire externe de référence : la DERNIÈRE photo par source, jamais un
-- historique. Ce qui compte est « AD d'aujourd'hui contre SDP d'aujourd'hui » ;
-- conserver l'import rend le rapport reproductible et permet d'afficher sa date.
--
-- device_key est la clé NORMALISÉE (majuscules, FQDN coupé, $ final ôté) —
-- device_name garde la forme d'origine pour l'affichage. La PK porte la source
-- pour qu'un remplacement d'AD ne touche jamais Entra.
--
-- raw_json conserve VERBATIM la ligne source. Tant que les noms de colonnes
-- réels d'AD et d'Entra ne sont pas figés, c'est ce qui permettra de remapper
-- sans imposer un ré-import complet.
CREATE TABLE IF NOT EXISTS asset_external_devices (
  source      TEXT NOT NULL,
  device_key  TEXT NOT NULL,
  device_name TEXT NOT NULL,
  dns_name    TEXT,
  os          TEXT,
  os_version  TEXT,
  last_seen   TEXT,
  enabled     INTEGER DEFAULT 1,
  join_type   TEXT,
  ou_dn       TEXT,
  model       TEXT,
  raw_json    TEXT,
  import_id   TEXT,
  imported_at TEXT,
  PRIMARY KEY (source, device_key)
);
CREATE INDEX IF NOT EXISTS idx_aed_name ON asset_external_devices(device_name);
CREATE INDEX IF NOT EXISTS idx_aed_seen ON asset_external_devices(last_seen);

-- La décision d'un coordonnateur sur un écart. Sans état, les mêmes machines
-- reviennent à chaque import et la liste perd sa crédibilité en deux itérations.
-- Clé = device_key : une machine renommée perd sa décision, limite assumée
-- (aucune source externe ne fournit de numéro de série pour recouper).
CREATE TABLE IF NOT EXISTS asset_reconcile_decisions (
  device_key TEXT PRIMARY KEY,
  decision   TEXT NOT NULL,
  reason     TEXT,
  decided_by TEXT,
  decided_at TEXT
);
