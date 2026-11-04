# Check F16–F30 + Annex B — against HEAD 367c309 (2026-11-04)

Checkout: /home/user/w/check (read only). Proof levels: V = read in code, T = test/probe run.
Tests run (PostgreSQL): `tests/dashboard-widgets.test.js`, `tests/dashboards-routes.smoke.test.js`,
`tests/chart-theme.test.js` → 16/16 pass. Probes (`node -e`) are quoted where used.

No traceability row in `docs/agent-execution/*` maps F16–F30 to a goal (G15 notes the "F01–F24 backlog" was
absent from the repo). Related goals found by content: A-21 (lean nav), A-22 (chart theme), A-14/A-27 (Gantt),
B-03 (trust label), G15 (dashboard CSV).

## Summary

| ID | Verdict | Evidence (current head) | Smallest fix | Size |
|---|---|---|---|---|
| F16 | OPEN + NEEDS-HUMAN | `public/_shell.js:227-229` — Executive Home, IT Review, Executive Scorecard still 3 sibling entries (Home and Scorecard even share `ICON_LIB.gauge`); no usage/data/owner matrix in `docs/` (V) | Write `docs/ux/EXEC-PAGES-MATRIX.md` (question answered, data source, owner, audience) + give Scorecard a distinct icon; consolidation is a human decision | S (+ decision) |
| F17 | OPEN | `public/dashboard-composer.html:79-84` raw `x/y/w/h` number inputs + free JSON textarea "Options (JSON…)"; `:143` JSON.parse of user text. Preview with real data exists (`:59`, `:165`) (V) | Presets per question + form fields per widget type (from `dashboardWidgets.WIDGET_TYPES[t].props`), JSON behind an "Advanced" `<details>` | M |
| F18 | PARTIAL | Dashboards: STALE/UNKNOWN colour withheld (`public/lib/dashboardRender.js:47,86`). Analytics keeps its own states: `public/analytics.html:95-97` freshness badge classes, `…:271-278` "…" placeholders, `…:423,426` `'—'` formatting; `public/lib/pageStates.js` only replaces stuck "Loading…" text and is loaded by `executive.html:1437` only (V) | One `public/lib/dataState.js` (LOADING/VALID/ZERO/NO_DATA/UNKNOWN/STALE/ERROR + label/class), used by dashboards first, then analytics; test the classifier | M |
| F19 | OPEN | Dashboard trend canvas has `role="img"` + spoken summary (`public/dashboards.html:158-159`) but no data table; Analytics 12 `<canvas>` with no aria/label/table (`public/analytics.html:284-400`); `public/lib/charts.js` has no table output (V) | Helper `ChartTable.render(container, labels, datasets)` emitting a `<details><table>` under each chart; wire to dashboards series first, then analytics | M |
| F20 | OPEN | Pages grew since the audit: `executive.html` 598 868 B, `reports.html` 540 474 B, `executive-report.html` 473 591 B (report: 449–567 KB). A-22 extracted chart helpers only (V) | Keep incremental: extract one cohesive block per page per goal (e.g. executive-report PPTX payload builder → `public/lib/execPayload.js` + unit test); add a size-budget test that fails on growth | L (staged S steps) |
| F21 | OPEN | `routes/dashboards.js:131` `as_of: now.toISOString()`; per-site/series widgets also `now` (`services/dashboardData.js:88,93`); page labels it **"Data as of"** (`public/dashboards.html:123`); source sync times only shown when stale (`:122,125`) (V) | Rename screen label to "Computed at"; return `sources:[{module,last_ok,state}]` always (already computed by `gate.freshness` at `routes/dashboards.js:129`, just unfiltered) and show "Last sync" per source; CSV gets a `last_sync` column | S |
| F22 | OPEN (unmeasured) | `services/dashboardData.js:69-90` nested `await` loops: per-site × per-window × previous-window, all sequential (V) | First measure (timer around `resolveWidgets`, log ms per widget); then `Promise.all` per widget over sites/windows with a small concurrency cap, scope unchanged | S (measure) / M |
| F23 | OPEN + NEEDS-HUMAN | `public/executive-report.html:7705` Standard = everything minus emergency/major (Normal folded in); top-8 truncations at `:5360, :5452, :6252, :7386`; `docs/EXEC_PPTX_CHART_AUDIT.md:55-115` still lists both notes (V) | Business decision (4th slice vs "Routine"; cap value), then add an "Other (n)" bucket so totals reconcile + a test that Σslices = total | S after decision |
| F24 | OPEN | Template declares `series:[…]` (`docs/sdp360/templates/DASHBOARD-DEFINITION-TEMPLATE.json:15`); validator lists `series` as a prop but does not check it (`services/dashboardWidgets.js:21`); resolver uses only `w.metric` (`services/dashboardData.js:83-88`). Probe: a trend with `series:['helpdesk.inbound','nope.metric']` validates `{"ok":true}` (T) | Either reject `series` (validator error "multi-series not supported") or resolve each series key with unit check (all units equal, else 400). Default: reject — today's rendering unchanged | S |
| F25 | OPEN | `public/dashboard-preview/data.js:1` "mock dataset"; `index.html:6` title "IT Activity Tracker — Executive Pulse", no DEMO banner; served (CSP override `server.js:190-196`). Not linked from nav (V) | Fixed "DEMO — fictitious data" banner + `<title>` prefix, or stop serving the folder in production (switch, default = serve) | S |
| F26 | PARTIAL | A-22 `public/lib/chartTheme.js` (token series + RAG) applied to Chart defaults. But `public/analytics.html:555-567` local `PALETTE` with off-token purple/pink and a `MULTI` list mixing status reds/greens as categorical colours; risk colours chosen by English substring (`:801`); `public/it-review.html:46-69` own colour scale (V) | Analytics: replace `PALETTE/MULTI` with `ChartTheme.read().series` / `.rag`; map statuses by code, not by position/text | S–M |
| F27 | PARTIAL | Dashboard screen and CSV share one resolver (`routes/dashboards.js:111`, G15 smoke test passes, T); site decks have a golden fingerprint (`tests/pptx-monthly-golden.test.js`). No screen↔PPTX reconciliation for the exec deck (browser builds the payload) and no screen↔export diff report (V) | Golden fixture: one dataset → JSON view, CSV and exec-pptx `build()` payload; assert identical figures per KPI; emit a diff report | M |
| F28 | PARTIAL | Portfolio: CSS timeline with legend, baseline, today line, per-row `role="img"` aria-label (`public/portfolio.html:103-116`), table view in `<details>` (`:55,123`). Project page: SVG Gantt + keyboard tablist (`public/project.html:34,218`). No keyboard focus/action inside the diagrams; not documented (V) | Document "the table is the keyboard path" in help + add a link "open project" per timeline row (focusable `<a>`); test the row anchors | S |
| F29 | PARTIAL + NEEDS-HUMAN | A-21 lean profile behind `ui_nav_profile` (default `'full'`, `services/reportConfig.js:11`; `_shell.js:77-80,275`). Usage logged only for `assets_viewed` (`server.js:2342`) and `dashboard_viewed` (`routes/dashboards.js:104`); 54 HTML pages, 49 `id:` entries in `_shell.js` (V) | Log a `page_viewed` event per shell mount (1/actor/page/day via `services/viewLog.js`) to measure before consolidating; the cut is a human decision | S |
| F30 | OPEN | `public/lib/dashboardRender.js:97-108` month series ends at the current month, week series at the last full week. Probe at 2026-11-04: months `['2026-09','2026-10','2026-11']`, weeks `['2026-W43','2026-W44']` (T). No "partial" flag anywhere in dashboards (grep, V); `previousWindow` compares a partial window to a full one (`services/dashboardData.js:78-79`) | Add `partial:true` to points/windows whose end > now; render "partial period" note + hatched last point; suppress the Δ vs previous when partial (or compare same number of days) | S |

Counts: OPEN 8 (F17, F19, F20, F21, F22, F24, F25, F30) · OPEN + NEEDS-HUMAN 2 (F16, F23) · PARTIAL 5 (F18, F26, F27, F28, F29 — F29 also needs a human decision) · FIXED 0 · WRONG 0.

---

## Per item (OPEN / PARTIAL)

### F16 — Executive pages overlap (OPEN + NEEDS-HUMAN)
Three entries remain (`_shell.js:227-229`). A-21 only trims the menu per role; it does not merge or document the
three pages. Fix: a one-page matrix (question / data / owner / audience / last reviewer) and a distinct icon for the
Scorecard. Test: none needed for the doc; a shell test can pin distinct icons per sibling. Merge only after the
owners sign the matrix.

### F17 — Composer too technical (OPEN)
Raw grid coordinates and a JSON textarea (`dashboard-composer.html:79-84,143`). Fix: generate fields from
`WIDGET_TYPES[type].props`, offer 3–4 presets ("weekly site ops", "exec KPI row"), keep JSON in an
`Advanced` `<details>`. Failing test first: a static test asserting the JSON textarea is inside `details.advanced`
and that a preset produces a definition `validateDashboard` accepts. No switch needed (UI only).

### F18 — Data-quality states heterogeneous (PARTIAL)
Done: dashboards withhold colour on STALE/UNKNOWN, `pageStates.js` stops eternal "Loading…" on one page,
`trustLabel.js` gives "date inconnue". Remaining: no shared state contract; Analytics uses its own badge classes and
"—". Fix: `public/lib/dataState.js` with a pure `classify({value, error, freshness, loading})`; unit test the 7
states (ZERO ≠ NO_DATA ≠ UNKNOWN).

### F19 — No table alternative for charts (OPEN)
Fix: a tiny helper that renders a `<details><summary>Data table</summary><table>` from the same labels/datasets
passed to Chart.js; add to dashboards series widgets and Analytics' 12 canvases; give each canvas `role="img"` +
summary. Test: DOM test that every `<canvas>` in `dashboards.html` output has a sibling table with the same row count.

### F20 — Monolithic pages (OPEN)
Sizes increased. Fix staged: a size-budget test (fail if any of the three pages grows above today's size) then
one extraction per goal. Do not rewrite.

### F21 — Computed time shown as data time (OPEN)
`as_of` = response time, labelled "Data as of". Fix (S): label "Computed at …", always return per-source
`last_ok` from the existing `gate.freshness` call, show "Last sync: helpdesk 2 h ago…". Failing test first: smoke
test asserting `sources` present on a fresh dashboard and that the page string no longer says "Data as of" next to
`as_of`.

### F22 — Sequential resolution (OPEN, not measured)
Measure first (`console.time`/log per widget in `resolveWidgets`), then parallelise per widget with a cap of ~4,
keeping `site`/`sites` scoping identical. Test: existing smoke tests must stay green; add a timing log assertion only
if a budget is agreed.

### F23 — PPTX chart parity (OPEN + NEEDS-HUMAN)
Normal folded into Standard (`executive-report.html:7705`), several top-8 cuts. Decision needed (D-xx). Then: an
"Other (n)" slice/bar so the chart total equals the KPI total; test Σ parts = total on a fixture.

### F24 — Multi-series declared but ignored (OPEN)
Probe proves an unknown metric in `series` validates. Smallest fix: validator rejects `series` with a clear message
(template updated to drop it) — default keeps today's rendering. Later, real multi-series with unit check.
Failing test: `validateDashboard` with `series:[…,'nope.metric']` must return `ok:false`.

### F25 — Preview on fictitious data (OPEN)
Add a fixed DEMO banner and `<title>` prefix in `public/dashboard-preview/index.html`; optionally a switch
`SDP_SERVE_DEV_PREVIEWS` (default 1 = today) to stop serving it in prod. Test: static test that the page contains
the banner text.

### F26 — Palette by position (PARTIAL)
Theme exists (A-22) but Analytics/IT Review keep local palettes. Replace `PALETTE`/`MULTI` in `analytics.html`
with `ChartTheme.read()`; map risk/status by code. Test: static test that `analytics.html` contains no hex literal
outside the tokens fallback.

### F27 — Multi-format equivalence (PARTIAL)
Screen = CSV (shared resolver) is proven; exec deck is not reconciled with any screen. Golden fixture covering
JSON/CSV/`reportPayload.build()` for the same dataset, with a printed diff. M.

### F28 — Gantt keyboard (PARTIAL)
Table and legend exist; diagrams are not keyboard-operable. Make each timeline row label a focusable link to
`project.html?id=`, and say in help that the table is the keyboard/screen-reader path. S.

### F29 — Nav footprint (PARTIAL + NEEDS-HUMAN)
Lean profile shipped (off). Usage is measured for two modules only. Add a deduplicated `page_viewed` event per
shell mount, report per role after 30 days, then the owners decide. S.

### F30 — Partial periods (OPEN)
Current month included without a flag; week series uses full weeks — inconsistent, proven by probe. Add a
`partial` flag (pure function in `dashboardRender.js`, unit-tested with a fixed `now`), render a note, and suppress or
day-align the Δ vs previous. S.

---

## Annex B — closure criteria (status at 367c309)

| # | Criterion (short) | Status | Evidence |
|---|---|---|---|
| 1 | KPI traceable; no number without scope, unit, period | PARTIAL | Registry with formula/unit/window (`services/metricRegistry.js`), trust label (`public/lib/trustLabel.js`); dashboards show window + scope note. Legacy pages (analytics/executive) still print bare figures |
| 2 | No unsupported widget publishable; every type has a text/table alternative | NOT MET | Probe: `trackerRag` validates `ok:true`; viewer renders "Widget type … is not rendered yet." (`public/dashboards.html:183`); `bar/table/heatmap` silently render as RAG lines (`dashboardRender.js:123`); charts have no table (F19) |
| 3 | Series, target and quality share one reference date or show the gap | NOT MET | `as_of` = now for series/per-site (F21); target picked at `now` (`dashboardData.js:76,87`) |
| 4 | Null/unknown/stale never shown as success or failure | PARTIAL | Dashboards withhold colour and show "Not measured" (`dashboards.html:140,152`, `dashboardRender.js:47`); legacy pages not proven (F18) |
| 5 | Risk/approval statuses stable when order or language changes | PARTIAL (not fully assessed here) | Analytics colours risk by English substring (`analytics.html:801`) — breaks on FR labels; other modules not re-checked by this pass |
| 6 | Filters show scope; no stale late response overwrites a newer one | PARTIAL | Scope note shown (`dashboards.html:120`); `loadData` has no request sequence/abort guard (`:106-126`) — a late response wins |
| 7 | Reference screens tested with real users/roles; removals have redirects | NEEDS-HUMAN | `docs/ops/USABILITY-TEST-PROTOCOL.md`: "No session has been run"; redirect stubs exist for old Assets pages |
| 8 | Nav, charts, tables keyboard-accessible + documented screen-reader test | PARTIAL / NEEDS-HUMAN | Tablist keyboard on `project.html:218`; B-05 browser journeys; screen-reader pass listed as owner task (`docs/agent-execution/G17.md:29,43`) |
| 9 | Screen and exports reconciled on same datasets | PARTIAL | F27 |
| 10 | Security, performance, a11y, tests and business pilot results; pending stays pending | PARTIAL / NEEDS-HUMAN | `docs/security/THREAT-MODEL.md`, CI suite; no perf/a11y/pilot results recorded |
| 11 | Capabilities cumulative only after per-action/site/duration validation | NOT ASSESSED in depth | Deputies capped `DEPUTY_MAX_DAYS=120` (`services/governanceRoles.js:24`); no per-action capability grant model found |
| 12 | Access model copies no password/session/cert/signature/approval | PARTIAL (not fully assessed) | Deputy model names a person per role (data), no credential copy seen; not proven by test here |
| 13 | New shift team receives open tasks in a shared queue, keeping owner and due | NOT MET (not assessed in depth) | Handoffs are interdepartmental (`services/handoffLifecycle.js:1-12`), no shift-queue concept found |
| 14 | Unauthorised technician sees reason + escalation, cannot run sensitive action | NOT ASSESSED | Server 403s exist; reason+escalation path on the field app not verified in this pass |
| 15 | Absence/inactivation never leaves an action without queue owner and escalation | PARTIAL | Deputies + escalation targets + coverage gaps (`services/governanceRoles.js:8,22`); "empty tables = escalations recorded without a target" — gap remains until data is filled |
| — | Study status: recommendations only, nothing certified | Unchanged | — |
