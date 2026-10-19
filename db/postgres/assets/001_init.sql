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

-- Journal des imports — APPEND-ONLY, une ligne par dépôt. Distinct de la table
-- des appareils (remplacée à chaque import) : celle-ci ne se vide jamais, donc
-- elle répond à « quand AD/Entra/Defender a-t-il été rafraîchi ? » sur la durée.
-- dated_count = lignes portant une date exploitable (le seul chiffre qui rende
-- le sens inverse applicable).
-- Pas de clé surrogate : un AUTOINCREMENT casserait sur pg (le même schéma
-- s'exécute sur les deux backends). C'est un log en lecture seule, lu par
-- ORDER BY imported_at DESC — aucune PK nécessaire.
CREATE TABLE IF NOT EXISTS asset_import_log (
  source      TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  row_count   INTEGER,
  dated_count INTEGER,
  imported_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_ail_at ON asset_import_log(imported_at);

-- Historique de la réconciliation — UNE LIGNE PAR JOUR, le point de courbe FIGÉ.
-- On ne peut pas le reconstituer après coup : le nombre d'écarts dépend de la
-- fenêtre ancrée à « aujourd'hui » et les sources sont remplacées. Il faut donc
-- capturer au fil de l'eau (même patron qu'asset_effort_history).
--
-- retirement_candidates est NULL quand non applicable (aucune observation
-- datée) — un 0 dessinerait une fausse chute. by_site_json porte le détail par
-- site pour qu'une équipe voie SA courbe, pas seulement le total flotte.
CREATE TABLE IF NOT EXISTS asset_reconcile_history (
  snapshot_date          TEXT NOT NULL,
  gaps_open              INTEGER,
  gaps_decided           INTEGER,
  sites_touched          INTEGER,
  ous_touched            INTEGER,
  retirement_candidates  INTEGER,
  retirement_applicable  INTEGER,
  sources_present        TEXT,
  by_site_json           TEXT,
  captured_by            TEXT,
  PRIMARY KEY (snapshot_date)
);

-- Asset engagement (2026-09-18) — first sighting of each asset id. The assets
-- tables are full-replaced nightly, so "new hardware" can only be detected by
-- remembering which ids we have already seen. `baseline = 1` marks the ids that
-- were present on the very first run (never reported as new). Rows are never
-- updated; `site` is the site at first sighting, for information only.
CREATE TABLE IF NOT EXISTS asset_first_seen (
  asset_id        TEXT PRIMARY KEY,
  site            TEXT NOT NULL DEFAULT '',
  first_seen_date TEXT NOT NULL,
  baseline        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_asset_first_seen_date ON asset_first_seen (first_seen_date);
