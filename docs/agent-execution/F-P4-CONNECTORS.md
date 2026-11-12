# F-P4-CONNECTORS — Connector Health (A2) + weekly report effort (B9)

Branch `goal/p4-connectors`, base `fc5cd2d`. Sandbox evidence only: nothing here is deployed, armed, or approved.
No call to a real external API was made (every test injects runs/snapshots into a throwaway PostgreSQL database).

## Gap matrix

| Item | Status | Evidence | Fix |
|---|---|---|---|
| A2 · one place that says, per connector, whether it works | DONE | `public/connector-health.html`, `GET /api/connector-health` (admin tier) | `services/connectorHealth.js` (pure) + `services/connectorReadings.js` (reads this server's own DB only) + `routes/connectorHealth.js`; nav entry *Configure ▸ Connector health* (admin) |
| A2 · per connector: last success, last failure + plain cause, latency, coverage %, failing scope, freshness vs cadence | DONE | `tests/connector-health.test.js` (6), `tests/connector-health-routes.smoke.test.js` (4) | 4 cards: SDP / Analytics (C01), Meraki (C07), OpManager (C08), SDP Cloud (C03). Latency = duration of the last finished run (sync run log). Coverage = sites expected by `site_module_codes` vs sites with a snapshot for the newest week (Meraki, OpManager) / Zoho groups seen in 14 days (Analytics). Freshness = `FRESHNESS_HOURS` of the job registry |
| A2 · a disarmed connector reads "désarmé" with the human step — never an error, never 0 | DONE | `connector-health.test.js` "SDP Cloud armed with a token follows its job; disarmed … human decision" | state `disarmed`, label `désarmé`, `next_step` names the human gesture; excluded from `connectors_ok_pct` |
| A2 · injected failure = UNKNOWN, never 0 | DONE | routes smoke: a failed `meraki.wan` run injected through the sync store → state `error`, cause "did not answer in time", `last_success: null`, coverage `pct: null` | `coverageOf` returns `pct: null` when nothing is expected/measured; no reader turns an exception into a zero |
| A2 · every "—" becomes a fix task with an owner | DONE | routes smoke (open idempotent, perimeter, viewer 403, dismiss needs a reason, admin close, assign → owner closes) | table `connector_fix_tasks` (migration 096). **Mechanism choice:** a dedicated list, not `action_items` (frozen inside ONE report week), not the commitments ledger (dark, `commitments_enabled='0'`), not the home queue (it only aggregates). A data fix belongs to the CONNECTOR owner and must outlive any week. Owner role read from `CONNECTOR-REGISTER.csv`, never from the client. One open task per connector × site × scope |
| A2 · "—" in the weekly report infra prefill → same fix task | DONE | `reports.html` `_infraOpenFixTask` (button "— inconnu"); browser test shows the badge | the measurable-but-unfilled cell posts `{connector, site_id, scope: family, report_id}` |
| A2 · where Meraki config loads at runtime | DOCUMENTED | `connectorReadings.readConfig` → `meraki.runtime_source` | `report_config` in PostgreSQL, read by `reportConfig.getConfig` at **each job run** (`sync-wan`, `poll-wan-outages`, `sync-wan-events`). There is **no `.env` fallback** for the jobs (only diagnostic tools read `MERAKI_API_KEY`). A stored key that decrypts empty (wrong/missing `SDP_CONFIG_KEY`) is shown as `db_unreadable`, not as "not configured" |
| A2 · OpManager blocking step as a plain cause | DONE | `connector-health.test.js` | the FIRST blocking step: not configured → stale Analytics view (data-through older than `opm_stale_days`) → "none landed on a site: the device → site mapping (discovery) is not done" — each with the human step (`tools/opmanager/discover.js`) |
| B9 · visible provenance badge (source · data-through · "manuel") | DONE | `tests/infra-prefill.test.js` (5), `tests/infra-prefill-browser.test.js` (Chromium) | `public/lib/infraPrefill.js` (one rule, browser + server): badge "Meraki · 2026-11-07", "OpManager · …", "manuel", "— inconnu" next to every Current Value (not a tooltip) |
| B9 · never overwrite a typed value (incl. reload + autosave race) | DONE | browser test: value typed while the prefill request is in flight survives; smoke: PUT then reload keeps provenance; **negative control**: removing the `keep` rule makes both tests fail | plan computed on response, value re-checked at write time; server `verifyInfraProvenance` keeps a Meraki/OpManager claim only if the value equals the snapshot (a forged or edited value is stored `manual`) |
| B9 · frozen submitted report immutable | PINNED (extended) | `weekly-report-assist.smoke` "frozen: a submitted report refuses an infra write from its editor" + existing `audit-report-write-auth.smoke` | unchanged rule `_authorizeReportWrite` |
| B9 · asset counts server-recomputed | PINNED (existing) | `asset-review-routes.smoke` "PUT asset-review: server freezes counts (client counts ignored)" | none needed |
| B9 · autosave exists | PINNED (existing) | `reports-editor-asset-tab` "autosave wires section-4"; `pg-reports-reports` concurrent saves never double rows | none needed |
| B9 · mobile editing at 360 px | CHECKED | browser test asserts no horizontal scroll at 360 px with the badge; `a11y-legacy-ratchet`, `ui-design-ratchet` green | badge `max-width:100%`, `overflow-wrap:anywhere`; `aria-live` on the badge; value input has an `aria-label` |
| B9 · submission nudges, deduped, never unarmed | DONE (armed OFF) | `tests/weekly-report-nudges.test.js` (4) | `services/weeklyReportNudges.js`, job `engagement.weekly_report_nudges` (daily 06:40, optional). Reuses `scheduleReminders.coordinatorsOf`, `engagementStore.notify`, notifications as dedupe log (`WR:<site>:<week>:<kind>`). Gated on `weekly_report_nudges_enabled='1'` **and** `weekly_report_due_days` set **and** not `notifications_stop` |
| B9 · time-to-complete telemetry, server-side, median by site | DONE | `tests/weekly-report-value.test.js` (3), assist smoke | first `edited_%` → first `submitted` in `audit_log` (server `now()`), median overall + per site |
| D2 · value metrics read API | DONE | assist smoke + routes smoke | `GET /api/value-metrics/weekly-report` (median completion, % on-time, % KPI auto-prefilled, minutes saved) and `GET /api/value-metrics/connectors` (% connectors ok, coverage, open tasks). Perimeter: admin tier = all sites; editor = own sites; site-less = none |

## Changes (commits)

`3444594` migration 096 + shared prefill rule · `700dd11` weekly-report assist router (infra-auto moved out of
`server.js`, server-verified provenance, value metrics) · `a5e70ae` Connector Health page + fix tasks · `3cdc323`
weekly report badges / manual marking / "— inconnu" buttons + browser proof · `d65382f` nudges + pilot profile +
flag register · `e2bdd37` provenance columns idempotent at init, `fail()` shape, assign test, inventories.

Schema: `db/postgres/reports/096_connector_health.sql` (2 nullable columns on `infra_kpis`, table
`connector_fix_tasks`), rollback `db/postgres_rollback/096_connector_health_drop.sql`, `pg-migrate-096-rollback` test.
The two columns are also added idempotently in `initPgReports` so a save never fails if the boot migration did not run.

Switches (all default = today's behaviour; rows in `docs/ops/pilot/PILOT-PROFILE.md`, `FLAG-REGISTER.md` regenerated):
`weekly_report_nudges_enabled` `'0'`, `weekly_report_due_days` empty (no deadline invented → on-time UNKNOWN),
`weekly_report_minutes_per_kpi_cell` empty (→ minutes saved UNKNOWN). Connector Health has no switch: it is a
read-only admin page and fix tasks are created only by a person's click.

No source system is written; no connector added; `services/sync/{syncStore,syncRunner,manualTrigger}.js` untouched
(read through `store.health()` / `recentRuns()`).

## Tests

New: infra-prefill 5 · infra-prefill-browser 1 (Chromium) · pg-migrate-096-rollback 1 · weekly-report-value 3 ·
weekly-report-assist.smoke 4 · connector-health 6 · connector-health-routes.smoke 4 · weekly-report-nudges 4 = **28**.
Guards re-run green: authz-route-matrix, server-size-budget, error-shape, await-precedence, pg-migrate*, flag-register,
readme-truth, ui-design-ratchet, a11y-legacy-ratchet, i18n-coverage, inventory-strict, agent-inventory,
inventory-reachability, connector-register, test-runner-guard, report-figures-*, audit-report-write-auth.smoke,
asset-review smokes, infra-auto-route.smoke, pg-reports-reports, sync-routes.smoke. ESLint clean on touched files.

Honesty note: the tests were written alongside the code, not strictly red first. Two **negative controls** were run
after the fact: removing the prefill `keep` rule fails the browser test and the unit test; removing the server
provenance verification fails two assist smoke tests. Both reverted.

## Rollout note (proposal — needs a human operator)

- **Canary site:** Hounde (proposal — has a Meraki network and an OpManager probe seeded; confirm on the Connector Health coverage line before choosing).
- **Steps:** deploy (migration 096 applies at boot; additive) → admin opens Connector Health and checks each card's
  cause against reality → coordinator of Hounde fills one week: badges visible, typing turns a cell "manuel" →
  measure once with a stopwatch the minutes to look up one infra value by hand → set
  `weekly_report_minutes_per_kpi_cell`. Nudges stay OFF until the Service & Support Manager decides
  `weekly_report_due_days`; then arm `weekly_report_nudges_enabled` for the pilot.
- **Rollback trigger:** any report save failing on `infra_kpis` (HTTP 500 on `PUT /api/reports/:id/infra`), a typed
  value replaced by a prefill, or a nudge sent to a non-coordinator. Rollback = disarm the nudge key; for the schema,
  the rollback SQL (columns are nullable; nothing reads them besides the new code).
- **Owner:** Service & Support Manager (weekly report + nudges); Infrastructure owner (Meraki/OpManager tasks);
  Platform owner (Analytics tasks).

## Value metric — before / after

| Metric | Before | After (instrumented) |
|---|---|---|
| % infra KPI cells auto-prefilled | not measurable (no provenance stored) | `prefill.auto_pct` per week/site; UNKNOWN until reports are saved with the new client |
| Minutes saved | not measurable | `auto × weekly_report_minutes_per_kpi_cell`; UNKNOWN until the stopwatch baseline is entered |
| Median time-to-complete a weekly report | not measured | median of first edit → submit (audit_log, server time), by site — computable on existing history from day one |
| % reports on time | not defined | UNKNOWN until `weekly_report_due_days` is decided |
| % connectors healthy | not visible | `connectors_ok_pct` (disarmed excluded) |

No production number is quoted here: the sandbox has no production data.

## Residual gaps / human steps

1. OpManager discovery (`tools/opmanager/discover.js`) still a human step; until then the OpManager card says so.
2. SDP Cloud token + arming (`teams_sla_enabled`) — human; the card shows "désarmé".
3. Weekly report deadline policy (`weekly_report_due_days`) — business decision, not proposed.
4. Stopwatch baseline for minutes saved — one measurement on the canary site.
5. Fix tasks are not yet a source of the home queue (goal A3) — the table is ready to be read.
6. Fix tasks send no notification by design; assignment is manual (admin tier).
7. Browser E2E on the real login-gated pages (Connector Health, editor) remains a user step; the browser test here
   runs the shared prefill rule in Chromium on a fixture.
