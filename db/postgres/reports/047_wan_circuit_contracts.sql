-- A-25 Part B — ISP contract terms + evidence per WAN circuit, with a four-eyes review.
-- circuit_key = 'site_id|sub_site|uplink' (composite text key, no surrogate id). A circuit's
-- credit amount is only CERTIFIED when its contract exists, was reviewed by a user other than
-- the one who entered it, and its MRC equals the MRC configured in sla_wan_config.
-- The evidence file lives in the blob store (module 'wan-contracts'), only its ref is stored.
-- reviewed_by is only ever written by a human super_admin session (POST .../review).
-- Manual rollback: db/postgres_rollback/047_wan_circuit_contracts_drop.sql. Idempotent.
CREATE TABLE IF NOT EXISTS wan_circuit_contracts (
  circuit_key       TEXT PRIMARY KEY,
  isp               TEXT,
  mrc_amount        NUMERIC,
  currency          TEXT,
  contract_ref      TEXT,
  evidence_blob_ref TEXT,
  evidence_name     TEXT,
  entered_by        TEXT NOT NULL,
  entered_at        TEXT NOT NULL,
  reviewed_by       TEXT,
  reviewed_at       TEXT
);
