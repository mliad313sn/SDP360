-- Personal Roadmap Manager — "Projet Intégrations" tab. Two private, per-user,
-- super_admin-only CRUD stores: actionable integration items + project resources.
-- Stable uid PK (no surrogate id → sqlite/pg parity). updated_at is a TEXT ISO stamp
-- (never SQL date math — the pg-strict trap). Lazy-seeded in reports-db.js. Idempotent.
CREATE TABLE IF NOT EXISTS roadmap_actions (
  uid         TEXT NOT NULL,
  user_id     INTEGER NOT NULL,
  workstream  TEXT,
  label       TEXT,
  owner       TEXT,
  target_date TEXT,
  effort      TEXT,
  status      TEXT,
  notes       TEXT,
  sort_order  INTEGER,
  updated_at  TEXT,
  PRIMARY KEY (uid)
);

CREATE TABLE IF NOT EXISTS roadmap_resources (
  uid        TEXT NOT NULL,
  user_id    INTEGER NOT NULL,
  name       TEXT,
  kind       TEXT,
  detail     TEXT,
  status     TEXT,
  sort_order INTEGER,
  updated_at TEXT,
  PRIMARY KEY (uid)
);
