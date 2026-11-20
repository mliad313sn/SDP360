# ADR-PORTFOLIO-LOT4 — Decision agenda + actionable management alerts (MVP)

- **Status:** accepted for engineering (AI decision, reversible, sandbox). Every alert rule, severity, recommended
  action, the decision outcome list and the agenda ordering are **PROPOSED** — nothing here is a PMO approval.
- **Date:** 2026-11-20 · **Author:** Claude (AI) · **Review:** AI self-review only — not an independent review.
- **Context:** `docs/sdp360/portfolio-spec/IT-PORTFOLIO-RECONSTRUCTION-SPEC.md` §14, §22, §31.9 and
  `docs/sdp360/portfolio-spec/PORTFOLIO-SPEC-GAP.md` (Lot 4). Builds on Lots 1–3 (intake fields, data quality,
  register). Evidence: `docs/agent-execution/PORTFOLIO-LOT-4.md`.
- **Switches** (report_config, `'0'` = today, every route 404s): `ppm_decision_agenda_enabled`,
  `ppm_alert_actions_enabled`; threshold `ppm_alert_decision_age_days` (`''` = off).
- **Migration:** `db/postgres/reports/121_ppm_decision_agenda_alerts.sql` (additive nullable columns; manual rollback
  `db/postgres_rollback/121_ppm_decision_agenda_alerts_drop.sql`). Number range 121–124 reserved for Lot 4.

## Decisions

1. **No parallel decision store.** A project decision is a row of the existing `decisions` register (DEC-YYYY-NNN,
   lifecycle, hash-chained ledger) with four new nullable columns: `project_id` (no FK, no cascade — a decision
   outlives the project row), `authority`, `outcome`, `decided_at`; `source_kind = 'project'`. Status keeps moving
   only through `services/decisionLifecycle`; recording an outcome does not change the status. Old → new of each
   record field goes to `ppm_events` (entity `decision`, visible in the existing history route).
2. **Today's decision payloads are unchanged.** The store strips the four columns from every decision row except the
   agenda reader (`listDecisions({ withRecord: true })`, `getDecisionRecord`).
3. **Agenda = pure function** `services/ppm/decisionAgenda.js` over the projects the reader may read (`viewFor`) and
   the decisions the reader may see (`visibleDecisions`, intersected). Required-but-not-recorded first, then overdue,
   then next due. Intake switch off → `unknown_reason: INTAKE_DISABLED`, never an empty "all clear".
4. **Alerts = the existing finder, extended.** `services/ppmAlerts.js` gains `MANAGEMENT_KINDS` (critical_risk,
   high_risk, unfunded, decision_bottleneck, missing_delivery_lead, schedule_error), `findManagementAlerts` and
   `managementCoverage`. `findExceptions` only adds them when the caller passes `management` → today's A11 list is
   byte-identical while the switch is off. **No second formula:** high risk = the Lot 3 register rule
   (declared or open high-severity risk via `portfolioEvidence.riskView`), unfunded = `portfolioRegister.UNFUNDED`,
   missing lead and schedule error = the Lot 2 data-quality checks `delivery_lead_missing` / `dates_invalid`.
   A null due date is never overdue; unknown inputs report `INTAKE_DISABLED` / `MONEY_HIDDEN` / `DECISIONS_UNKNOWN`.
5. **Lifecycle by promotion, not a new alert workflow.** `POST …/alerts/promote` turns one alert into ONE commitment of
   the existing register (new source system `ppm_alert`, source id = the `ppm_alert_state` key; the unique origin
   link makes it idempotent). Assign = owner (+ due date); follow / escalate / verify / close = the commitment
   lifecycle and the existing A01 / A02 escalation ledger. `ppm_alert_state` stays the dedup key and keeps
   `commitment_uid`, `severity`, `recommended_action`.
6. **A cleared alert never closes a commitment.** The nightly tool only stamps `cleared_at`; it has no commitment store.
   Closure is a human verification (reviewer ≠ owner, existing rule).
7. **Nothing outbound by default.** Promotion writes no notification and sends nothing. The nightly tool includes the
   management kinds only with `ppm_alert_actions_enabled = '1'`, still records/sends nothing while
   `ppm_alerts_enabled = '0'`, still e-mails only with `alert_external_enabled = '1'`. `unfunded` is never notified
   (owners may not read amounts). Teams and the weekly PPM digest are **not built** in this lot.
8. **Money rule:** `unfunded` (budget status is money-adjacent) is computed only for an amount reader
   (`canSeeMoney` and not a W4 client), reported `MONEY_HIDDEN` otherwise.

## Consequences / reversibility

Switches off = today. Rollback = switches to `'0'`; the schema rollback is manual and drops only the new columns.
Commitments created by promotion stay (they are business records with their own lifecycle).

## Human decisions left

Alert rules and severities, recommended actions, the outcome vocabulary, the agenda order, the bottleneck age, who may
promote (today: committee), arming both switches, a Teams channel / weekly digest, browser E2E.
