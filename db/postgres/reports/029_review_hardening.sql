-- Committee review 2026-10-28 — hardening after the six-seat review. ADDITIVE and idempotent.
-- Handoffs: an overdue handoff is escalated ONCE per due date (QA P1-2): escalated_for_due remembers it.
ALTER TABLE handoffs ADD COLUMN IF NOT EXISTS escalated_for_due TEXT;
-- Handoff references come from a sequence (architect P2-2 / QA P1-3): no MAX()+1 race on a UNIQUE column.
CREATE SEQUENCE IF NOT EXISTS handoff_ref_seq;
-- Commitments: one ORIGIN commitment per source record (QA P1-4) — a concurrent create returns the first.
CREATE UNIQUE INDEX IF NOT EXISTS ux_commitment_links_origin ON commitment_source_links(source_system, source_id) WHERE relation = 'origin';
-- Meeting sessions: optimistic version so two runners cannot both close (QA P2).
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
