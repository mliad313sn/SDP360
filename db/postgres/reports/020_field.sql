-- Step 10 — offline field outbox (idempotency ledger) + chunked photo uploads. Idempotent.
-- Mirrors: services/fieldStore.js SQLITE_DDL.

CREATE TABLE IF NOT EXISTS field_outbox (
  uuid TEXT PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, payload_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'received',
  result TEXT, client_ts TEXT, device TEXT, received_at TEXT, applied_at TEXT);
CREATE INDEX IF NOT EXISTS idx_field_outbox_user ON field_outbox(user_id, received_at);
CREATE TABLE IF NOT EXISTS field_uploads (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id INTEGER NOT NULL, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL, chunk_bytes INTEGER NOT NULL, chunks_total INTEGER NOT NULL, received TEXT NOT NULL DEFAULT '[]', ref TEXT, status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT, completed_at TEXT);
CREATE TABLE IF NOT EXISTS field_chunks (upload_id BIGINT NOT NULL REFERENCES field_uploads(id) ON DELETE CASCADE, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (upload_id, idx));
