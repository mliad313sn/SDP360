# E-W1-VIZ — dashboard chain (E-V01, E-V02, E-V03, E-V06, E-V09, E-K02)

Bundle W1-VIZ of plan E (expert audit of 5 Nov 2026). Branch `goal/w1-viz`, one commit per goal. No migration.
Every behaviour change is behind a `report_config` switch that defaults to today's behaviour; defects ship on.
PostgreSQL only (tests on throwaway PG databases).

| Goal | Audit action | Verdict | Proof |
|---|---|---|---|
| E-V01 | V-01 measure the visual debt | FIXED | `tools/agent/ui-inventory.js` → `docs/ux/CHART-INVENTORY.md` (generated — do not edit): 98 files, hex literals, `<style>`, `new Chart(` (44), chart types, dual axes (27), doughnut/pie (29), chartTheme/ChartTable/pageStates loaded |
| E-V01 | V-04 / X-V-02 no-growth guard | FIXED | `tests/ui-design-ratchet.test.js` — per-page budgets for hex / `yAxisID` / doughnut, can only go down; fixture page with one extra hex fails with "use a token / see CHART-INVENTORY.md" |
| E-V01 | V-05 / §5.2 catalogue | PARTIAL | "Substitution to consider" column = proposal wording from §5.2 (small multiples instead of dual axis, ordered bars instead of doughnut). Choosing a substitution = person |
| E-V01 | §5.4 / X-V-05 triage column | FIXED (column) / DEFERRED (triage) | `docs/ux/METRIC-TRIAGE.json` (52 metrics, all `untriaged`), Triage column in `METRIC-WIDGET-MAP.md`, `metric-map.js --check` fails on a metric missing from the JSON (test in the ratchet file). No triage decided |
| E-V02 | X-V-01 `stacked` not rendered (defect) | FIXED | `public/lib/chartContract.js`: stacked refused on any NEW bar; `bar` no longer offers `stacked`; a stored stacked widget kept identical still saves; submit/publish (`allowRetired`) unchanged — `tests/dashboard-widgets.test.js` |
| E-V02 | V-02 / X-V-04 server = composer | FIXED | one UMD rule table used by `composerGuide.fitError` and `validateDashboard`: stacked rate, ragGrid without RAG policy, bar of a rank, trend of a snapshot; parity test "server verdict = composer verdict"; route smoke PUT → 400 (`tests/dashboards-routes.smoke.test.js`) |
| E-V02 | seed dashboards flagged | none | test "no shipped seed dashboard is flagged by the new rules" |
| E-V03 | §5.3 ten state components / X-V-03 | FIXED (library) / DEFERRED (adoption) | `public/lib/stateBadge.js`: loading, no-data, not-measured, stale (+never synced), unmonitored, error, no-right, uncertified, export-in-progress, publication-blocked — symbol + text + aria; French in `public/lib/i18n/dashboards.fr.js`. `dashboardRender` / `kpiCard` use it, existing texts pinned byte-identical (`tests/state-badge.test.js`). Adoption by legacy pages (pageStates on 1 page of 57) = later goal |
| E-V03 | V-03 base population | PARTIAL | `metricRegistry.resolve` returns `base {n,label}` only where the reader returns the denominator: closure rate (tickets created), inspection conformity (applicable findings), asset completeness (assets in register). **Resolution and first-reply SLA stay `base: null`** — `getCalendarMonthlyHelpdesk` (reports-db.js, not this bundle) computes but does not return their denominators. Shown only with `ui_kpi_base_line`='1' |
| E-V03 | V-03 cause / action link | FIXED | optional kpi prop `action_href` (relative only, validated; unsafe → 400 / not rendered) → "→ act" |
| E-V06 | V-06 residual (dashboards) | FIXED — no mismatch | `tests/dashboard-figure-parity.test.js`: one fictitious fixture (kpi + ragGrid + trend) → same figures, period label and population in the viewer render, ChartTable rows (built like the viewer's chart spec), report-pack CSV + XLSX rows; diff report on failure. **No mismatch found** |
| E-V09 | V-09 small multiples | FIXED (behind switch) | widget type `multiples` (2-6 metrics, own unit/axis per panel, one window, one shared ChartTable, nulls = gaps, no dual axis); not creatable while `ui_small_multiples`='0' (catalogue shows `creatable:false`); viewer, CSV export and report pack carry the panels; composer offers it for intent "compare" — `tests/dashboard-multiples.test.js` |
| E-K02 | K-04 sample size / low sample | FIXED (behind switch) | `n` on kpi tiles, ragGrid cells and series points (= the base above); `min_sample` / `low_sample` only from an ADOPTED (or retired-in-force) `kpi_policies` version via `inForce`; proposed/none → no warning. `ui_kpi_sample_size`='1' shows "n = …" / "low sample — not comparable" and drops the delta; '0' byte-identical — `tests/dashboard-sample-size.test.js` |

## Switches added (all default to today; PILOT-PROFILE rows + FLAG-REGISTER regenerated)

| Key | Default | Effect when `1` |
|---|---|---|
| `ui_kpi_base_line` | `0` | KPI tile shows "n = 142 tickets created" or "base not measured" |
| `ui_kpi_sample_size` | `0` | "n = …" on tiles / grid cells; low-sample warning (only with an adopted `min_sample`), no delta |
| `ui_small_multiples` | `0` | the `multiples` widget type is creatable |

## Tests

New: `ui-design-ratchet` (5), `state-badge` (6), `dashboard-figure-parity` (1), `dashboard-multiples` (3),
`dashboard-sample-size` (3); extended: `dashboard-widgets` (+5), `dashboards-routes.smoke` (+1), `ui-policy`,
`ui-policy-me.smoke`. Neighbour run (53 dashboard/composer/kpi/chart/report/metric/ui files + report-figures-parity,
evidence-baseline, rbac-ui-gates, a11y-static, charts-static): **366 pass / 0 fail / 0 skip**. flag-register,
readme-truth, server-size-budget, authz-route-matrix, await-precedence, i18n-coverage, html-pages-before-static: green.

## Deviations

- E-V01: the ratchet test does NOT assert byte-freshness of `CHART-INVENTORY.md` (page byte counts move with every
  unrelated edit); it checks the file exists, is marked generated and lists every scanned file. Run
  `node tools/agent/ui-inventory.js --check` before a release. A NEW page with hex literals breaches its (zero)
  budget — intended (no growth); other bundles adding pages will need to record a budget at merge.
- E-V02: a ragGrid is also accepted when the widget sets its own `rag` (the metric then needs no `rag_policy`).
- E-V03: the 11 pages that load `dashboardRender.js` now load `stateBadge.js` first (pinned by a test);
  `dashboardRender` throws if the library is missing rather than render wrong words silently.
- E-K02: `n` = the same base as E-V03 (only three metrics today) — helpdesk SLA denominators need reports-db.js.

## Left for a person

- Browser review of every surface and the substitution choices for dual axes / doughnuts (CHART-INVENTORY.md).
- KPI-committee triage of the 52 metrics (`docs/ux/METRIC-TRIAGE.json`) and adoption of any `min_sample`.
- Deciding the three UI switches on the TEST instance (proposals only in PILOT-PROFILE.md).
- Returning `slaClosed` / `rplyTotal` from `getCalendarMonthlyHelpdesk` (reports-db.js owner) so the SLA KPIs get a base.
- Adoption of `stateBadge` on legacy pages (later goal; not reports.html / index.html).
