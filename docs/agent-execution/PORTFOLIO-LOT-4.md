# PORTFOLIO LOT 4 — decision agenda + actionable management alerts (evidence)

> **AI evidence.** Author: Claude (AI). Reviews here are AI self-review, not an independent review, not a PMO sign-off.
> Nothing in this lot is approved policy: the six alert rules, their severities and recommended actions, the decision
> outcome list, the agenda ordering and the bottleneck age are PROPOSED.

- **Scope:** IT portfolio reconstruction spec §14 (decision management), §22 (management alert engine), §31.9
  (non-actionable alerts) — Lot 4 of `docs/sdp360/portfolio-spec/PORTFOLIO-SPEC-GAP.md` (MVP).
- **Branch:** `feat/portfolio-lot4` (worktree `/home/user/w/portfolio-lot4`). Not pushed, not merged.
- **Decision record:** `docs/ai-decisions/ADR-PORTFOLIO-LOT4-decision-agenda-alerts.md`.
- **Switches** (report_config, PROPOSED, default `'0'` = today, every Lot 4 route 404s): `ppm_decision_agenda_enabled`,
  `ppm_alert_actions_enabled` — lot **L14** in `docs/ops/switch-lots.json` (soft dependencies on `ppm_alerts_enabled` /
  `alert_external_enabled` recorded: they are mentioned as "unchanged", not prerequisites). Threshold
  `ppm_alert_decision_age_days` (`''` = off). All three catalogued in `docs/ops/policy-catalogue.json`, rows in
  `docs/ops/pilot/PILOT-PROFILE.md`.
- **Migration:** `db/postgres/reports/121_ppm_decision_agenda_alerts.sql` (Lot 4 range 121–124 per coordination):
  `decisions` + `project_id`, `authority`, `outcome`, `decided_at` (nullable, no FK, no cascade) + partial index;
  `ppm_alert_state` + `commitment_uid`, `severity`, `recommended_action`. Manual rollback
  `db/postgres_rollback/121_ppm_decision_agenda_alerts_drop.sql`, listed in `tests/ppm-rollback-scripts.test.js`
  (reverse-order round trip green).

## What was built

| Item | Where |
|---|---|
| Six spec alert kinds + coverage (unknown reasons) + alert → commitment mapping; `findExceptions` unchanged unless `management` is passed | `services/ppmAlerts.js` |
| Pure decision agenda + record normaliser (outcome needs a decision date) | `services/ppm/decisionAgenda.js` |
| Project decisions in the existing DEC register; record fields stripped from every other decision payload; old → new in `ppm_events`; alert → commitment link | `services/governanceStore.js` |
| New commitment source system `ppm_alert` | `services/commitmentLifecycle.js` |
| 5 routes on the governance router (own `viewFor` / `visibleDecisions` / `canSeeMoney`) | `routes/governanceDecisionAgenda.js`, 1 line in `routes/governance.js` |
| Feature flags `decision_agenda`, `alert_actions` | `routes/governancePpm.js` |
| Nightly tool: management kinds only with the switch; `unfunded` never notified; no commitment store | `tools/governance/ppm-alerts.js` |
| Page: strict CSP (built-in `STRICT_PAGES`), no inline script, tokens only, EN/FR from the shell, labelled inputs | `public/portfolio-decisions.html`, `public/lib/portfolioDecisionsPage.js`, page lists in `server.js` (no line added) |
| Link from the portfolio page (hidden unless a flag is on) + FR string | `public/portfolio.html`, `public/lib/i18n/portfolio.fr.js` |

No second formula: high risk = Lot 3 register rule (`portfolioEvidence.riskView`), unfunded = `portfolioRegister.UNFUNDED`,
missing delivery lead / schedule error = Lot 2 checks `delivery_lead_missing` / `dates_invalid`, escalation = the existing
A01 / A02 commitment ledger. No new RAG band, no metric registered.

## Invariants and how they are tested

| Invariant | Test |
|---|---|
| Each new kind fires on its rule; null due date never overdue; tbc is not a bottleneck; decisions unknown → nothing guessed | `portfolio-lot4-pure` |
| Intake switch off → intake kinds UNKNOWN (`INTAKE_DISABLED`), agenda `unknown_reason`, never "all clear" | `portfolio-lot4-pure` |
| Today's A11 list unchanged without the `management` option; nightly list unchanged with the switch off | `portfolio-lot4-pure`, `portfolio-lot4-alerts-cli`, `ppm-alerts-cli` |
| Promotion idempotent: one commitment per alert key (origin link), second call `created: false` same id | `portfolio-lot4.smoke` |
| Promotion sends no notification (notifications row count unchanged); nightly armed off records/sends nothing; e-mail only with `alert_external_enabled` | `portfolio-lot4.smoke`, `portfolio-lot4-alerts-cli` |
| A cleared alert does not close the commitment (state keeps `commitment_uid`, tool has no commitment store) | `portfolio-lot4-alerts-cli` |
| Escalation follows the matrix: a critical promoted alert past its due date raises A02 | `portfolio-lot4.smoke` |
| Money: a non-amount reader never sees `unfunded` / `not_budgeted`; coverage `MONEY_HIDDEN` | `portfolio-lot4.smoke` |
| Writes committee-only (403 for viewer, before the switch so role guards answer 403); outcome without date 400; unknown outcome 400 | `portfolio-lot4.smoke`, `authz-outcomes.smoke` |
| Decision register payload unchanged (no `project_id` / `outcome` keys); history carries the outcome change | `portfolio-lot4.smoke` |
| Strict CSP / a11y shape / EN = FR keys | `portfolio-lot4-page`, CSP journey report |

TDD note (honest): the pure tests were written before `findManagementAlerts` / `decisionAgenda`; the smoke failed first on
a real gap (an outcome saved without any decision date when the stored date was null) and passed after the fix; the
authz outcome invariant failed first (the switch answered 404 before the committee guard) and passed after moving the
role guard ahead of the switch.

## Tests run (targeted; full suite NOT run)

Command: `NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>` with the sandbox `PG_ADMIN_URL`.

| Files | Result |
|---|---|
| New: `portfolio-lot4-pure` (11), `portfolio-lot4-alerts-cli` (3), `portfolio-lot4-page` (3), `portfolio-lot4.smoke` (3) | 20 pass |
| `authz-matrix-json`, `authz-route-matrix`, `authz-outcomes.smoke`, `authz-handler-checks`, `authz-enforce` (with `AUTHZ_MATRIX_UPDATE=1 AUTHZ_OUTCOMES_UPDATE=1`) | 25 / 25 pass; +5 routes, no existing row changed |
| error-shape, soft-delete-readers, kpi-unknown-sweep, limit-clamp, csv-guard-coverage, simplicity-budget, i18n-coverage, a11y-legacy-ratchet, a11y-static, csp-journey-report, csp-no-inline-handlers-new-pages, csp-strict-pages-config, policy-center-catalogue, switch-lots, switch-lots-rollback, flag-register, monolith-ratchet, agent-inventory, readme-truth + the new pure/page/cli + ppm-alerts-cli | 199 / 201 before the inventory regeneration (the 2 = inventory / README out of date, expected); green after |
| ppm-rollback-scripts, pg-migrate, pg-migrate-changed, pg-migrate-destructive, export-policy-routes.smoke, csp-candidate-pages.smoke, csp-headers.smoke, inventory-reachability, inventory-strict, agent-inventory, readme-truth, governance-routes.smoke, every `portfolio-*` and `ppm-*` file, the Lot 4 smoke | 473 / 473 pass |
| all `commitment*` files, test-runner-guard, monolith-ratchet, await-precedence, capability-registry, server-size-budget, report-config, ui-design-ratchet, csp-report.smoke | 105 / 105 pass |

`npx eslint .` clean.

Authz: +5 routes — `GET …/portfolio/decision-agenda` (`UUUAAAAAAAAAAAAAAAFFAAA`, session + viewFor), `GET …/portfolio/alerts`
(`UUUNNN…`, 404 while off), `POST …/project/:id/decisions`, `PUT …/decisions/:id/record`, `POST …/alerts/promote`
(`requireCommittee`, 403 for non-committee). Handler-check declarations added for the two GET routes (AI, not reviewed).
Generated: authz matrix + outcomes + handler checks, FLAG-REGISTER, FLAG-DECISIONS-GAPS, SWITCH-LOTS, RACI-TEMPLATE
(unchanged), CHART-INVENTORY, P09-PAGE-INVENTORY, CSP-JOURNEYS, INVENTORY*, README block, `tests/.suite-manifest.json` (+20),
EVIDENCE-MANIFEST.

## Not built (MVP scope)

- Teams notification and the weekly PPM digest of the gap note (spec §22 channels) — outbound stays armed off; no new channel.
- Alert "escalation level" as a field: escalation is the commitment's A01 / A02 ledger, not a column of the alert.
- Promotion by anyone but the committee; per-site promotion rules.

## Human decisions left (PROPOSED, not approved)

- The six alert rules and their severities / recommended actions (`services/ppmAlerts.js`), the decision outcome list
  and the agenda order (`services/ppm/decisionAgenda.js`), the bottleneck age (`ppm_alert_decision_age_days`, proposed 14).
- Who may record decisions and promote alerts (today: committee + admin tier).
- Arming `ppm_decision_agenda_enabled` then `ppm_alert_actions_enabled` (after `ppm_intake_register_enabled`).
- Browser E2E of the page (not run by the agent). Independent review of this lot.
