-- Personal Roadmap Manager — a private, per-user, super_admin-only tool for the Service &
-- Support Manager to track manager objectives + deliverables. Composite PK (user_id, obj_key)
-- for objectives, stable uid PK for deliverables (no surrogate id → sqlite/pg parity).
-- updated_at is a TEXT ISO stamp (never SQL date math — the pg-strict trap). Idempotent.
CREATE TABLE IF NOT EXISTS roadmap_objectives (
  user_id      INTEGER NOT NULL,
  obj_key      TEXT NOT NULL,
  title        TEXT,
  weight       INTEGER,
  progress_pct INTEGER,
  status       TEXT,
  confidence   TEXT,
  evidence     TEXT,
  gap_note     TEXT,
  target_date  TEXT,
  sort_order   INTEGER,
  updated_at   TEXT,
  PRIMARY KEY (user_id, obj_key)
);

CREATE TABLE IF NOT EXISTS roadmap_deliverables (
  uid           TEXT NOT NULL,
  user_id       INTEGER NOT NULL,
  obj_key       TEXT,
  label         TEXT,
  delivery_date TEXT,
  status        TEXT,
  notes         TEXT,
  sort_order    INTEGER,
  updated_at    TEXT,
  PRIMARY KEY (uid)
);
