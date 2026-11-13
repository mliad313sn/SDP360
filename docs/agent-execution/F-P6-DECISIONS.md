# F-P6 — Governance decisions (A5) and one front door (A6) — evidence

- **Bundle:** P6 of the goal programme (`docs/audits/2026-11-12-goal-programme/GAP-MATRIX.md` §6) · base `fe08c1c` ·
  branch `goal/p6-decisions` · **not pushed, not merged, not deployed.**
- **ADR:** `docs/ai-decisions/ADR-P6-decisions-and-breakglass.md`. Every behaviour change sits behind a
  `report_config` switch whose default is today's behaviour (rows in `docs/ops/pilot/PILOT-PROFILE.md`, register
  regenerated in `docs/ops/FLAG-REGISTER.md`). Enabling is a human decision.

## Clause by clause

| Goal / clause | Before | Now | Proof |
|---|---|---|---|
| A5 — motive on every transition | reason only on cancel / reopen / send-back | `decision_motive_required` ('0'): every status change needs a reason (400 `REASON_REQUIRED`), free and enforced modes; reason on the ledger row | `decision-lifecycle-p6` (pure), `p6-decisions-access.smoke` "A5 motive" |
| A5 — SoD: proposer ≠ confirmer | missing | `selfConfirmRefusal` in `governanceStore.updateDecision`: the person of the latest move into `awaiting_confirmation` gets 403 `SELF_CONFIRM` (even after gaining the committee role); withdrawal stays allowed. Gated de facto by `decision_lifecycle_enforced` (only state where it can happen) | `decision-lifecycle-p6`, smoke "A5 SoD" |
| A5 — named pending approver | state only | `GET /api/governance/decisions` → `pending_approver` {chair, secretary, cadence_name, confirmed_by:'committee', proposed_by, proposed_at}; cockpit shows it under the status | smoke "A5 SoD + pending approver" |
| A5 — cycle-time KPI | missing | `governance.decision_cycle_days` (DRAFT, F-DATA-11), reader `governance.decisions`, pure `services/decisionCycle.js`; null when nothing adopted | pure test + smoke parity recompute from `decisions` + `ppm_events` |
| A5 — soft delete reason + second person | reason optional, no second person | `soft_delete_two_person` ('0', with `soft_delete_enabled`): reason ≥ 10, request (202) → requester refused (409) → another authorised person confirms; ledger `delete_request:<kind>`; `GET /api/governance/delete-requests`; cockpit panel; portfolio page asks the reason | smoke "A5 two-person" (+ restore, ledger), "two-person off = today" |
| A6 — "My access" section | three separate places | `access.html` hub (sessions / deputies / emergency links), `/api/access/me` → `hub`; links only | smoke "A6 My access hub" |
| A6 — break-glass time-box + reason | audited, not time-boxed | `breakglass_timebox_enabled` ('0') + `breakglass_session_minutes` ('60'): reason required, on the risk event, session `expires_at` lowered, cookie matches; only for a break-glass use (SSO ≠ off) | pure test + smoke "A6 break-glass" |
| A6 — RBAC identical under SSO | missing | walk of the live router (`tools/agent/authz-walk.walkRoutes`), ≥ 20 guarded GET routes × 4 personas, password session vs `createSessionForUser` session → identical statuses (route-level 429 rate limits skipped) | smoke "A6 RBAC identical under SSO" |

## Tests run (throwaway PostgreSQL per file, swept with `tools/test/drop-test-dbs.js`)

- New: `tests/decision-lifecycle-p6.test.js` (6) + `tests/p6-decisions-access.smoke.test.js` (8) → **14 / 14 pass**.
- Neighbours (decision-lifecycle, governance*, soft-delete*, metric*, kpi-docs*, sso-*, emergency-access*,
  scoped-deputies, access-*, sod-policy, authz-route-matrix, flag-register, inventory-strict, await-precedence,
  server-size-budget, agent-inventory, uat-governance-users, switch-prereqs, report-config*, capability-registry,
  business-only-boundary, login*, obligations-decisions, workspace-profiles*) on `fe08c1c` → 473 / 474 (the 1 failure
  was `authz-matrix-json`, a known base failure since fixed on sdp-waves).
- **Final run after `git merge sdp-waves` (6a01d77, the green base with the 15 known failures fixed):** new tests +
  every neighbour above + every test file naming a touched file (cockpit / portfolio / access / login pages,
  PILOT-PROFILE, reportConfig, decisionLifecycle, metricRegistry, softDelete, governanceStore, routes/access) + the
  previously-known suites (authz-*, i18n*, brand-buttons, trust-label, readme-truth, portfolio-finance*, simplicity,
  limit-clamp, rbac-mutation, evidence-baseline, ui-design-ratchet) → **1492 / 1492 pass, 0 fail**.
- eslint clean on every touched JS file.

## Regenerated artefacts
`docs/ops/FLAG-REGISTER.md`, `docs/ops/AUTHZ-MATRIX.md` (new route `GET /api/governance/delete-requests`, committee),
`docs/ops/authz-matrix.json`, `docs/ux/METRIC-TRIAGE.json` (new metric added as `untriaged` — the committee triages), `docs/agent-execution/INVENTORY.{json,md}`, `INVENTORY-STRICT.md`, `docs/ops/METRIC-WIDGET-MAP.md`,
`docs/ops/METRIC-LINEAGE.md`, docs/kpi citations re-anchored (`kpi-docs-reanchor.js`). `server.js` +3 lines
(budget 6977) — break-glass logic lives in `services/breakglassGuard.js`.

## Observed on the way (not changed)
- A DELETE with a JSON body sent **chunked** (no content-length) is answered 400 with an empty body before reaching the
  route; browsers always send content-length, the smoke helper now does too. Worth a separate look.
- A `committee-member` with no site reads no site decisions in `GET /api/governance/decisions` (`scopeIds` keys on the
  admin tier only) — pre-existing, outside P6.

## Human decisions left
Turning on `decision_lifecycle_enforced` / `decision_motive_required` (governance chair); choosing the decision KPIs
(F-DATA-11 — the cycle metric is only a draft candidate); `soft_delete_enabled` + `soft_delete_two_person` and the
retention owner; naming the break-glass holder, its session length and turning on the time-box (security owner);
real Entra registration / secret / SSO cutover and retiring the shared `DASH_USER` account.
