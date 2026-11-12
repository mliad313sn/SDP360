-- P8 / goal B1 (SLA credits: from "due" to "recovered"). ADDITIVE and idempotent: two NEW tables, no existing row or
-- column changes meaning.
--   wan_sla_claims        one claim per circuit × month (UNIQUE circuit_key + period — no duplicate claim). Status
--                         due → claimed → credited | disputed | written_off (services/wanSlaClaims.js, the only place
--                         the transitions are decided). The due amount, the engine output and the contract parameters
--                         are FROZEN on the claim (calc_json) together with evidence_hash = sha256(outage set +
--                         parameters); a later outage edit makes the claim "stale vs evidence" (computed on read).
--                         Amounts keep their currency and are never summed across currencies. NULL amount = unknown,
--                         never 0. Amounts are served only to the admin tier and finance-viewer.
--   wan_sla_claim_events  every state change, edit and notification step: who, when, why (append-only + hash chain,
--                         verified by the nightly audit.chain_verify job).
-- Read and written only while report_config wan_sla_claims_enabled = '1' (the routes answer 404 while '0' = today).
-- Rollback: db/postgres_rollback/098_wan_sla_claims_drop.sql (manual).
CREATE TABLE IF NOT EXISTS wan_sla_claims (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  circuit_key   TEXT NOT NULL,                            -- site_id|sub_site|uplink (rdb.wanCircuitKey)
  site_id       INTEGER NOT NULL,
  sub_site      TEXT NOT NULL DEFAULT '',
  uplink        TEXT NOT NULL,
  period        TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status        TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'claimed', 'credited', 'disputed', 'written_off')),
  isp           TEXT,
  circuit_id    TEXT,
  owner_user_id INTEGER,
  owner_name    TEXT,
  currency      TEXT CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  due_amount     NUMERIC CHECK (due_amount IS NULL OR due_amount >= 0),       -- frozen engine figure; NULL = unknown
  claimed_amount NUMERIC CHECK (claimed_amount IS NULL OR claimed_amount >= 0),
  credited_amount NUMERIC CHECK (credited_amount IS NULL OR credited_amount >= 0),
  due_credit_pct NUMERIC,
  availability_pct NUMERIC,
  calc_json     TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  frozen_at     TEXT NOT NULL,
  claimed_at TEXT, credited_at TEXT, disputed_at TEXT, written_off_at TEXT,
  evidence_links TEXT,                                    -- JSON [{label, url}]
  notes         TEXT,
  notify_state  TEXT NOT NULL DEFAULT 'none' CHECK (notify_state IN ('none', 'requested', 'approved', 'sent', 'failed')),
  notify_requested_by INTEGER, notify_requested_at TEXT,
  notify_approved_by INTEGER, notify_approved_at TEXT,
  notify_sent_at TEXT, notify_to TEXT, notify_error TEXT,
  created_by INTEGER, created_at TEXT NOT NULL,
  updated_by INTEGER, updated_at TEXT NOT NULL,
  CONSTRAINT wan_sla_claims_circuit_period UNIQUE (circuit_key, period),
  CONSTRAINT wan_sla_claims_amount_currency CHECK ((due_amount IS NULL AND claimed_amount IS NULL AND credited_amount IS NULL) OR currency IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_wan_sla_claims_period ON wan_sla_claims(period, status);
CREATE INDEX IF NOT EXISTS idx_wan_sla_claims_site ON wan_sla_claims(site_id);

CREATE TABLE IF NOT EXISTS wan_sla_claim_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  claim_id    BIGINT NOT NULL,
  action      TEXT NOT NULL,                              -- created · transition · reopen · edit · notify_requested · …
  from_status TEXT,
  to_status   TEXT,
  motive      TEXT,
  actor_id    INTEGER,
  actor_name  TEXT,
  at          TEXT NOT NULL,
  details     TEXT,                                       -- JSON (amounts are written here — the table is not served raw)
  prev_hash TEXT, row_hash TEXT);
CREATE INDEX IF NOT EXISTS idx_wan_sla_claim_events_claim ON wan_sla_claim_events(claim_id, id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'wan_sla_claim_events_append_only') THEN
    CREATE TRIGGER wan_sla_claim_events_append_only BEFORE UPDATE OR DELETE ON wan_sla_claim_events FOR EACH ROW EXECUTE FUNCTION sdp_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'wan_sla_claim_events_hash_chain') THEN
    CREATE TRIGGER wan_sla_claim_events_hash_chain BEFORE INSERT ON wan_sla_claim_events FOR EACH ROW EXECUTE FUNCTION sdp_hash_chain();
  END IF;
END $$;
