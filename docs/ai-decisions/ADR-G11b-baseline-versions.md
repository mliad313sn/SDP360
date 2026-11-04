# ADR-G11b — versioned project baselines, gated re-baseline, portfolio deck / workbook, A11 PPM exceptions

Status: technical decision (AI) · 2026-11-04 · **governance policy PROPOSED, not approved** · every switch OFF by default

## Context
A project had a single baseline (`portfolio_projects.baseline_start/end`), frozen once the approval gate was passed
(`BASELINE_FROZEN`) with no way to move it, and task baselines were never frozen. The committee had no deck or
workbook of the portfolio, and catalogue rule A11 (late / blocked / unowned work) had no escalation nor Friday queue.
Who may re-baseline and the exception thresholds are a governance policy — a committee decision.

## Decision (technical)
- Migration `045_ppm_baselines.sql` (additive): `portfolio_baselines` (one row per version, `UNIQUE(project_id,
  version)`, payload = dates only, **append-only** through `sdp_append_only` — a project that has versions can no
  longer be deleted) and `ppm_alert_state` (dedup of the alert job).
- Pure `services/ppmBaseline.js`: `snapshotPayload`, `diffBaselines` (day shifts, null when a side is missing),
  `rebaselineCheck` (stage in_progress|on_hold → `STAGE`; owner via `portfolioAccess.ownerMatches` → `GATE_SOD`;
  reason ≥ 10 → `GATE_REASON`).
- `ppm_baseline_versions='1'`: `governanceStore.moveProjectStage` approval → in_progress writes version 1 **in the
  same transaction** as the stage move, fills empty task baselines from the plan (never overwrites one), ledger
  `baseline_captured`. The route passes the flag; the store reads no config.
- `ppm_rebaseline_enabled='1'`: `POST /api/governance/portfolio/project/:id/rebaseline` (committee; 404 while off).
  `governanceStore.rebaseline` is the only path that moves a frozen baseline; the ordinary edit keeps refusing it.
  It writes version n+1 with `approved_by`, ledger `rebaseline` (old / new baseline end + reason), one transaction.
- `GET …/project/:id/baselines` (readers of the project, A-15 scope) returns the versions with `diff_vs_current`;
  the project page draws the chosen version as the dashed baseline.
- `GET /api/governance/portfolio/deck.pptx|workbook.xlsx` (`services/portfolioDeck.js`): the readable portfolio,
  money only through `canSeeMoney` (else `stripMoney`), LAYOUT_WIDE canvas rules, null = “—”, ISO currency text.
- A11: pure `services/ppmAlerts.findExceptions`, `GET /api/governance/portfolio/exceptions` (cockpit panel, A-15
  scope), nightly `tools/governance/ppm-alerts.js` (jobs.js `governance.ppm_alerts`, 05:40) — dry run while
  `ppm_alerts_enabled != '1'`; armed: in-app to the owner + committee, `alert_firings` row per item, no re-notify
  within 7 days, cleared when gone; e-mail only when `alert_external_enabled='1'` and `notifications_stop!='1'`.

## Proof
`tests/ppm-baseline.test.js`, `tests/ppm-alerts.test.js`, `tests/portfolio-deck.test.js` (golden
`tests/__golden__/portfolio-deck-fingerprint.json`), `tests/ppm-alerts-cli.test.js`, `tests/ppm-baselines.smoke.test.js`.

## Rollback
Set the three switches back to '0'. Versions stay as history; task baselines filled at capture were empty before
and are the intended frozen plan (not reverted). Revert the commit for the code.

## Open (committee)
Re-baseline authority and the exception thresholds; capacity overload waits for A-13.
