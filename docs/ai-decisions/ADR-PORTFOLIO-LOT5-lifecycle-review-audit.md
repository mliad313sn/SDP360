# ADR-PORTFOLIO-LOT5 — extended lifecycle, review workflow, field audit, business-case freeze

- **Status:** PROPOSED (AI decision record, engineering choices only). No business policy here is approved.
- **Date:** 2026-11-20 · **Author:** Claude (AI) · **Scope:** portfolio reconstruction spec §15, §26, §27, §28 —
  Lot 5 of `docs/sdp360/portfolio-spec/PORTFOLIO-SPEC-GAP.md`.

## Context
The spec asks for a longer project lifecycle, a review workflow with request-information / return-for-correction /
assign-reviewer actions, a role catalogue, a field-level audit trail and "approved data must never change silently".
The repository already has stage gates (`services/projectSchedule.stageGate`, owner ≠ approver), W3 gate checklists
with multi-approver sign-off, the hash-chained append-only `ppm_events` ledger, W4 project roles, change requests, and
the four-eyes approver-provenance check (`services/approverProvenance`) built for the Policy Center.

## Decisions (engineering)
1. **Map onto today's gates, do not replace them.** `EXT_STAGES` / `EXT_GATES` sit beside `STAGES` / `GATES`;
   `stageGate(…, {extended})` is used only while `ppm_extended_lifecycle_enabled = '1'`. Spec "Planned" = `proposal`,
   "Submitted" = `approval`, "Approved → Delivery" = the existing approval → in_progress gate. Added: idea, assessment,
   handover, benefits_review, exits deferred (reversible), rejected and cancelled (terminal). Every rule of today's
   gates is kept; added rules: IT owner before planning, open tasks block handover, the sponsor may not decide, every
   exit and every backward move needs a reason. `STATUS_FOR` keeps "the status follows the stage".
   `portfolio_projects.stage` stays TEXT without CHECK. New projects start as `idea` only with the switch on.
2. **No new audit table.** Review actions (`review_assign`, `info_request`, `info_response`, `review_return`), field
   changes (`field_edit`) and business-case changes (`business_case_change`) are rows of `ppm_events` (append-only,
   hash-chained, already covered by `tools/pg/harden-audit-grants.sql`). Review state is derived from the ledger.
3. **Self-approval refusal reuses existing identity machinery, fail closed.** The requester of a review cycle = the
   actor of the latest stage move, else `created_by`. A decision out of `approval` (approve / reject / defer) and an
   approval sign-off on a W3 checklist are refused when the decider: has the requester's user id; matches the
   requester, the owner or the sponsor by `commitmentLifecycle.skeletonKey` (case, accents, confusables folded); or
   fails `approverProvenance.checkIndependent` (created / promoted by the requester, chain, fresh account of unknown
   provenance). Unknown requester, requester without a user id, unreadable journal → refused.
4. **Review steps = one W3 checklist template** (six `check` items, role slots `committee-member` + `executive`, rule
   `all`) applied on demand to the decision gate (entering `in_progress`). No parallel approval engine.
5. **Field audit** writes one `field_edit` row per changed project column that has no audit row of its own (finance,
   owner / sponsor and intake decision fields keep theirs); `created_by` / `updated_by` (migration 125) are written
   only while the field-audit or review switch is on.
6. **Business-case freeze** (`ppm_business_case_freeze_enabled`): after the approval gate, a change to a PROPOSED list
   of fields needs an `approved` / `applied` change request of the same project named in the write (`change_request_id`),
   else 409 `BUSINESS_CASE_FROZEN`. Reuses `ppm_change_requests`.
7. **Role catalogue** (§27) is a read-only mapping onto existing roles + project roles; no new authorisation system.
   Contributor project creation is NOT built (access-policy owner decision).
8. **Migration 125** is additive: two nullable columns, and the `ppm_gate_checklists.gate_to` CHECK widened in place
   (drop + add of the same named constraint). Manual rollback restores the narrow CHECK (fails while an extended-stage
   checklist exists).

## Consequences / risks
- Turning `ppm_extended_lifecycle_enabled` back to `'0'` leaves a project in an extended stage unable to move (its
  stage has no gate in the six-stage table) — documented, stop-and-report before doing so.
- With the review switch on, a legacy project already in `approval` without a recorded move cannot be decided until it
  is returned and resubmitted (fail closed, by design).
- A brand-new committee account with no named creator in the identity journal is refused as an approver for 7 days
  (approverProvenance rule 3) — intended four-eyes behaviour, may surprise a pilot.
- History (field audit) stays readable by the money readers only, as today.

## Human decisions left
Lifecycle mapping and its rules, review steps and their role slots, frozen field list, role mapping, who may assign
reviewers, contributor creation, and arming each of the four switches.
