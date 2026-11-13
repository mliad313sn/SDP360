# F-p10-sustain — D1 flag register & decisions · D2 value scoreboard · D3 exec pack / Exec View quality

Branch `goal/p10-sustain` from `222ab4b`. Migration **104** (+ rollback). Every behaviour change is behind a
report_config switch defaulting to today's behaviour (PILOT-PROFILE rows added).

## D1 — flag register & enablement runbook
- `tools/agent/flag-register.js` now also writes `docs/ops/FLAG-REGISTER.json` (machine-readable: report_config,
  planned, governance policies, env, pseudo-rows, dark list with decision fields) and `docs/ops/FLAG-DECISIONS-GAPS.md`
  (each dark switch × missing decision fields). `--check` covers the three files; `--stale [--today=] [--fail]` reports
  passed expiries, passed decision deadlines and sidecar entries naming a switch that no longer exists.
- Sidecar `docs/ops/flag-decisions.json` (hand-maintained, empty `items`): fields owner (named person), risk,
  dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry. **Nothing filled by the agent.**
- Pseudo-rows: `frozen:tracker_green_band_90` (437a80f), `frozen:tracker_weighted_donut` (b681083),
  `frozen:installer_safety_parity` (f6f0b12) — from CLAUDE.md because `tools/deploy/frozen-lots.json` is absent on this
  branch — and nested arm `sla_wan_config.notify.enabled` (default read from the code: false).
- Dark list today: 128 rows (report_config `'0'` defaults incl. P2 finance, P4 connectors, P5 queue/bundles/aging, P6
  decisions/break-glass, P7 portfolio/timesheets/CR/publication, P8 claims; P3 `sla_headline_definition`; the 3 new D2/D3
  switches; pseudo-rows). P9 export policy: no key on this branch. 0 rows complete — expected, owners/dates are human.
- Test: `tests/flag-decisions.test.js` (6).

## D2 — value scoreboard
- `services/valueScoreboard.js` (pure), `services/valueScoreboardData.js` (readers), `routes/valueScoreboard.js`,
  `public/value-scoreboard.html` + `lib/value-scoreboard-page.js` (EN/FR from the shell), migration
  `104_value_scoreboard_snapshots` (+ `db/postgres_rollback/104_…_drop.sql`, added to `ppm-rollback-scripts`).
- Switch `value_scoreboard_enabled` ('0' → every route 404). GET admin tier; site rows = reader's sites below
  super_admin. Snapshot POST = super_admin (stores fleet values). Menu entry (Configure) via policy
  `value_scoreboard_page`, lean-hidden → default menu unchanged (simplicity-budget green).
- Metrics: report on-time % (UNKNOWN until `weekly_report_due_days` is decided), report completion median, open-action
  median age / % overdue, asset cost coverage (+ unknown %), repeat-finding rate (needs `insp_repeat_findings` + window),
  decision cycle (90 d), % plans updated < 30 d, WAU by role tier, CSAT last complete month, WAN SLA credits recovered
  (USD indicative, needs `wan_sla_claims_enabled`). Unknown ≠ 0 everywhere.
- Tests: `tests/value-scoreboard.test.js` (5), `tests/value-scoreboard-routes.smoke.test.js` (3 — 404 off, 403 editor,
  perimeter, every reader's SQL runs on the real schema, snapshots + rollouts).

## D3 — board pack & Exec View
- AI default: `tests/exec-view-quality.test.js` asserts every `process.env.AI_PROVIDER || '…'` read defaults to `off`.
- Portfolio slide: `services/execPackPortfolio.js` + `reportPayload.build(…, {user})` + render.py slide "Portfolio
  Highlights" behind `exec_pack_portfolio_slide` ('0'). Money masked unless admin tier / finance-viewer; portfolio site
  scope respected. Goldens not regenerated (no key → no slide). Test `tests/exec-pack-portfolio.test.js` (6, incl. a real
  render.py run: +1 slide with the key, none without).
- Exec View: `exec_view_min_cell` ('0' off) small-cell suppression in `buildExecSummary`; tests prove off = identical
  payload and on = the suppressed site name appears nowhere (sites, titles, RCA/CA, codes).

## Tests run (all green)
New 24 tests + neighbours: authz-*, rbac-*, ui-policy*, cross-site-*, flag-register, inventory-strict, i18n-coverage,
error-shape, await-precedence, server-size-budget, readme-truth, simplicity-budget, ppm-rollback-scripts, exec-*,
pptx-monthly-golden, shell-navigation, business-only-boundary, capability-registry, connector-register (338/338) +
figure/home/kpi/sla/state/url/ux/connector/wan-claims/page/a11y (162/162). `npx eslint .` clean. Artefacts regenerated
(inventory, inventory --strict, flag register, AUTHZ-MATRIX + authz-matrix.json, suite manifest 5156).

## Human decisions (not taken)
- Every dark switch: owner, canary site, rollback trigger, success metric, deadline, expiry (fill the sidecar).
- Whether the public Exec View may keep naming sites (`exec_view_min_cell`); on-time rule (`weekly_report_due_days`);
  value contract with the committee for the scoreboard; whether the portfolio slide belongs in the monthly pack.
