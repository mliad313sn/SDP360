# ADR — W3-GOVERNANCE: executive view and governance of the native PPM tool

- **Status:** accepted for the sandbox (engineering choices); every business threshold and policy below is **PROPOSED**, not approved.
- **Date:** 2026-11-13 · **Branch:** `goal/w3-governance` · **Migration:** 110 (rollback `db/postgres_rollback/110_ppm_governance_w3_drop.sql`)

## Context
PPM parity wave W3 (README §5): simplified ↔ expert view, KPI cards and phase strip reconciled to the engines, configurable gate
checklists with multi-approver sign-off, composite RAG with hysteresis, RAID with exposure, DCMA 14-point check, scheduled reports
and a paginated Gantt print. Change-request simulation was already done (B5, `services/ppm/crSimulation.js`) and is reused, not rebuilt.
W2 (links/constraints/resources/baselines) runs in parallel: W3 reads those fields defensively.

## Decisions
1. **Pure engines, thin routes.** `services/ppm/{projectRag,dcma,gateChecklist,raid,projectKpis,projectReport}.js` are pure (no I/O,
   no clock); `governanceW3Store.js` holds the SQL; `w3Context.js` gathers one project for the routes and the scheduled CLI.
   Routes live in `routes/governanceW3.js`, registered from `governancePpm.js` with the same helpers (A-15 read scope, committee,
   plan-write rule). No schedule-engine or Gantt file is edited.
2. **Hysteresis = per-metric enter/exit thresholds with stored memory** (`ppm_project_rag_state`). The composite is the worst
   component; it is **null** unless schedule or cost is measured (an empty risk register never makes a project green). The memory is
   written by `GET …/rag` while the RAG switch is on (a read with a side effect, documented; a colour change is a ledger row).
3. **Gate checklists are per project × target stage**, versioned; sign-offs and evidence are **append-only** and scoped to a
   **cycle** (id of the latest stage ledger row) and the checklist **version** — moving the project or redefining the checklist
   asks for fresh sign-offs. One person fills one slot; the owner never signs; a reject needs a reason; any standing reject blocks
   (PROPOSED). The stage route refuses (409) while a defined checklist is incomplete; nothing moves a stage automatically.
   A sign-off is a recorded approval (session identity, server time), **not** a legal / identity-based signature.
4. **RAID details in a side table** (`ppm_raid_details`) so no existing reader of `portfolio_risks` (which spreads `...row`) can
   leak an amount. Amounts follow invariant 2 strictly (admin tier + finance-viewer) — not the wider committee rule — and are never
   written to `ppm_events`. The 1..3 probability score is not converted to a percentage (that mapping is a business decision).
5. **DCMA points that need data the plan does not hold are null** (`pass: null` + basis), never pass and never 0: link types/lags
   need `dependency_links`, hard constraints need the `constraint_type` field, resources need `assignments` / `resource_ids`
   (W2 pool), missed tasks / BEI need baseline finishes, CPLI needs a deadline. They light up when the data exists.
6. **Phase strip mapping is PROPOSED**: Initiation = proposal, Planning = approval, Execution = in_progress/on_hold,
   Closure = closure/closed. No feasibility phase is invented.
7. **Scheduled report carries no amounts** (a distribution list is not a finance reader); on-demand reports go through the export
   policy (`governance.project_report`, amounts masked unless admin tier + finance-viewer).
8. **Print:** the SVG Gantt is sliced into page-sized `viewBox` windows with header + legend on each page (no new rendering);
   the W2 Gantt is printed by CSS (`lib/ppmGovernanceW3.css`) after its split box is expanded so every row is painted.

## Switches (all default '0' = today)
`ppm_simplified_view_enabled`, `ppm_project_rag_enabled` (+ `ppm_rag_thresholds`), `ppm_dcma_enabled`, `ppm_gate_checklist_enabled`,
`ppm_raid_enabled`, `ppm_project_report_enabled`, `ppm_report_send_enabled` (+ `ppm_report_recipients`).

## Consequences / open
- Thresholds, phase model, gate approvers, report recipients: human decisions (PMO, Finance).
- Residual P×I (G3), per-critical-milestone slip (G2 names it), an admin card for the scheduled report, drill-down from the cards
  and a browser check of the toggle and of the print are not done.
