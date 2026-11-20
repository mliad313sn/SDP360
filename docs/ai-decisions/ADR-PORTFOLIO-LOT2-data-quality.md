# ADR-PORTFOLIO-LOT2 — Data-quality engine, field guidance, submission checklist

- **Status:** accepted for engineering (AI decision, reversible, sandbox). Every rule that defines "good data" is
  **PROPOSED** — nothing here is a PMO approval.
- **Date:** 2026-11-20 · **Author:** Claude (AI) · **Review:** AI self-review only — not an independent review.
- **Context:** `docs/sdp360/portfolio-spec/IT-PORTFOLIO-RECONSTRUCTION-SPEC.md` §4, §4.3, §20 and
  `docs/sdp360/portfolio-spec/PORTFOLIO-SPEC-GAP.md` (Lot 2). Builds on ADR-PORTFOLIO-LOT1. Evidence:
  `docs/agent-execution/PORTFOLIO-LOT-2.md`.
- **Switches:** `ppm_data_quality_enabled` (shadow) and `ppm_dq_gate_enforced` (gate), report_config, both `'0'`.
  No migration: computed on read.

## Decisions

1. **One pure engine** `services/ppm/dataQuality.js` (no I/O): 19 checks of §20 — 18 field checks that count in the score
   and one validity check (`dates_invalid`) that only blocks. Score = completed ÷ required × 100, **floored** (17/18 = 94,
   never rounded up to 100).
2. **Value states are read, not collapsed** (Lot 1 convention): blank, zero, `tbc` and the list code `tbc` are NOT
   complete; `na` and `none_known` are complete (they answer the question) — except `na` on the accountable IT owner.
   A zero budget is incomplete unless its status is `not_budgeted`; zero average + peak FTE is incomplete.
3. **Unknown is null:** a column absent from the row (intake switch off) → that check `unavailable`, score `null`,
   RAG `NA`. Blocking checks on base columns (owner, dates) are still evaluated.
4. **Blocking** = invalid schedule + missing IT owner (the two examples of §20.2); a blocking error forces RED.
5. **Site score** = Σ completed ÷ Σ required over the site's scored projects (never a mean of percentages); unscored
   projects counted separately; site RAG from the score only (blocking projects counted, not overriding).
6. **Money rule:** a reader who may not see money gets the two budget checks left out (scope `without_budget`, 16
   required) so neither the amount nor its emptiness leaks; the score is labelled with its scope.
7. **RAG bands** in `public/lib/kpiRag.js` policy `ppm-data-quality` (points 100 / 80) marked `status: 'PROPOSED'`.
8. **Field guidance** `services/ppm/fieldGuide.js` extends Lot 1's `intakeFields.GUIDE` (entries reused, not copied)
   with the 7 existing project fields; served as `dq_guide` in the intake catalogue while the shadow switch is on.
9. **Gate:** route-level refusal (like the W3 checklist gate) on `proposal → approval` only, 409 `GATE_DATA_QUALITY`,
   also shown in the project page dry run. Independent of the shadow switch so the PMO can shadow first and enforce later.

## Rejected
- A `ppm_dq_snapshots` table for trends (not MVP).
- Hooking `projectSchedule.stageGate` directly (pure, no config) — the route already hosts the W3 gate; same pattern.

## Human decisions left (PROPOSED)
Required field set, blocking checks, value-state counting (`na`/`tbc`), zero-budget rule, DQ RAG bands, site RAG rule,
whether to arm either switch.
