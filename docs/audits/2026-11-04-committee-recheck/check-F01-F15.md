# Check F01–F15 (graph engine / KPI findings) against HEAD 367c309

Checkout `/home/user/w/check` (read only). Proof: V = read in code, T = test/probe run.
T runs: `tests/vendor-libs.test.js`, `tests/dashboard-widgets.test.js`, `tests/chart-theme.test.js` → 14 pass / 0 fail (PG boot);
`node -e` probe of `widgetDataPlan`, `resolveWidgets` (trackerRag) and the analytics backlog/SLA expressions (outputs quoted below).

Note: `dashboardRender.js` lives at `public/lib/dashboardRender.js` (report cited `dashboardRender.js` without path).

| ID | Verdict | Evidence (HEAD) | Fix | Size |
|---|---|---|---|---|
| F01 | OPEN (V+T) | `services/dashboardWidgets.js:21-25` declares bar/table/heatmap/ragGrid; `public/lib/dashboardRender.js` `widgetDataPlan` maps all four to `{mode:'per-site'}` (probe confirmed); `public/dashboards.html` per-site branch draws one bar list for all; composer offers every `WIDGET_TYPES` key (`dashboard-composer.html:120`, catalogue `routes/dashboards.js:76`) | Mark types `rendered:true/false` in `WIDGET_TYPES`; catalogue/composer/`validateDashboard` only accept rendered types (bar/table/heatmap → error "not available yet" unless an alias to ragGrid is decided); keep existing seeds (all ragGrid) valid | S |
| F02 | PARTIAL (V+T) | Plan returns `mode:'tracker'`; `services/dashboardData.js` has no tracker branch → `{mode:'none'}` (probe: `{"t":{"mode":"none"}}`); viewer shows "Widget type trackerRag is not rendered yet." (honest, not a fake value) — but the type is still creatable/publishable | Same switch as F01: remove `trackerRag` from the creatable catalogue (validation error) until a resolver+renderer exist | S |
| F03 | OPEN (V+T) | `public/analytics.html:698` `d.total > 0 ? (d.backlog_count / d.open_count * 100)` — probe: open_count 0 → `NaN` / `Infinity` | Guard on `open_count > 0`, else show "—" and neutral class | S |
| F04 | OPEN (V+T) | `analytics.html:705` (SLA), `:777` (change success), `:834` (CAB), `:889/:893` (survey rate/avg) colour with `x >= t ? … : 'red'/'amber'`; probe: `null` → `red` | One helper `ragClass(v, g, a)` returning `'kpi na'` for null/non-finite; use at the 5 sites | S |
| F05 | OPEN (V) | `services/dashboardData.js` series branch: `R.windowSeries(plan.kind, plan.n, now)` — ignores `window`; single branch uses `window` | Anchor: if `window` is a `YYYY-Www`/`YYYY-MM` label, derive the anchor date from it and pass to `windowSeries`; return `window_end` in payload and show it under the chart | S |
| F06 | OPEN (V) | `targetFor(targets, …, now.toISOString())` in both single and series branches; `kpiTargets.list()` also only returns `ended_at IS NULL` rows, so ended target versions are never available | Evaluate at window end date; add `listAll()` (incl. ended rows, with `ended_at` honoured in `live`); series: per-point target | M |
| F07 | OPEN (V) | `analytics.html:~796-799` risk colour: very/high→red, medium→amber, everything else (incl. `'Unknown'`) → green | Explicit map {low:green, medium:amber, high/very high:red}, default slate/neutral; test on 'Unknown' | S |
| F08 | OPEN (V) | `analytics.html:~846` `doughnutChart('chartCabStatus', …, [green, red, amber, slate])` positional | Map normalised `approval_status` → colour (approved green, rejected red, pending amber, other slate) | S |
| F09 | OPEN (V) | `analytics.html:~747` `<td>${t.technician || '—'}</td>`, `:~862` `<td>${r.rule_type || '—'}</td>` inside innerHTML, no escaping (page has no `escapeHtml`) | Add local `esc()` (or DashboardRender.escapeHtml) on both cells; static test that every `${…}` inside these template rows is wrapped; adversarial fixture `<img onerror>` | S |
| F10 | OPEN (V) | `analytics.html:~726-730` bar counts + SLA % line on `pct` axis; `:~900-910` survey score + response rate on two axes. A-22 explicitly deferred analytics dual-axis (`docs/agent-execution/A-22.md` "Not done") | Reuse `public/lib/charts.js` TrendPanel (A-22) — two stacked panels, one axis each, shared x | M |
| F11 | OPEN (V) | `analytics.html:~931` `if (_loading) return;` — filter change during a load is dropped | Request generation counter: increment per `loadAll`, each loader checks it before writing DOM; if a load is in progress set `_pending=true` and rerun at end | S |
| F12 | OPEN (V) | Each loader `catch (e) { console.error(...) }` (`:~751,815,865,922`); no `r.ok` check; previous values stay | On error: set the section's KPI values to "—", add `.kpi error` + inline "Could not load — Retry" button, freshness badge "error" | S |
| F13 | PARTIAL (V+T) | CDN removed: all 17 pages load `vendor/chart.js/4.4.1/chart.umd.js` (B-01, commit 8822c0c; `vendor-libs.test.js` pass). Remaining: `dashboards.html:~160` `if (window.Chart)` still leaves an empty canvas when Chart fails; analytics/other pages have no fallback either | In `dashboards.html` series branch: if `!window.Chart` render a small `<table>` of label/value (also a11y alt) — reuse for F19 later | S |
| F14 | FIXED (V+T) | Single version 4.4.1 everywhere (grep: 17× `chart.js/4.4.1`), one theme `public/lib/chartTheme.js` on all Chart pages (A-22); `tests/vendor-libs.test.js` asserts one Chart.js version | — | — |
| F15 | OPEN / NEEDS-HUMAN (V) | `public/it-review.html:45-66` loads `_tokens.css` then redefines canonical names (`--color-bg`, `--color-text`, …) with "Modernist" values; `executive.html:22-40` aliases onto EDV tokens; A-12b/A-22 aligned contrast/primary-fill but not these | Decision (brand owner): keep it-review identity. Mechanical part: rename it-review's overrides to a `--mod-*` namespace scoped to `.it-review` root so canonical tokens aren't shadowed; no visual change | M + human |

## Sections per OPEN / PARTIAL item

### F01 — declared types without distinct render (OPEN)
Done: the viewer never fakes a chart. Remaining: composer/validator publish 4 types that all render as a bar list.
Fix: add `rendered` flag in `WIDGET_TYPES`; `validateDashboard` error for non-rendered types (switch `dashboard_allow_unrendered_types`, default `1` = today's behaviour if the PO wants zero change; recommended default `0` because seeds only use ragGrid/kpi/trend/actions/text — verify `dashboardSeeds.js` stays valid). Failing-first test: `dashboard-widgets.test.js` "bar widget is rejected as not rendered".

### F02 — trackerRag (PARTIAL)
Done: shows "not rendered yet" instead of an empty or fake tile. Remaining: still creatable. Fix with F01 (trackerRag `rendered:false`). Implementing a real tracker resolver is M and needs a contract (tracker key → RAG counts via `tracker-pptx` `ss`).

### F03 — backlog ratio denominator (OPEN)
`const bklPct = d.open_count > 0 ? Math.round(d.backlog_count / d.open_count * 100) : null;` render `null` as "—" with no class. Test: static extraction of the expression via `tests/_fn-source.js` or a small jsdom-free unit after moving it into a pure helper (`public/lib/analyticsKpi.js`).

### F04 — null coloured RED/AMBER (OPEN)
Pure helper `statusClass(v, green, amber)` → `'na'` for null/NaN; apply to sla_ok_pct, change_success_rate, cab_compliance_pct, response_rate_pct, avg_score. Test: helper(null)= 'na', helper(95)='green'.

### F05 — series not anchored on period (OPEN)
In `resolveWidgets` series branch compute `anchor = window ? windowEndDate(window) : now` (helper next to `previousWindow`), call `windowSeries(kind, n, anchor + 7d for weeks)` respecting that windowSeries subtracts one week. Return `anchor`. Test in `dashboard-data` unit: window '2026-W10' → last point label '2026-W10'.

### F06 — target at current date (OPEN)
Pass the window end date to `targetFor`; store `list()` must expose ended rows (with `ended_at`) and `live()` must check `ended_at > d`. Test: target 90 ended 2026-06-01, target 95 from 2026-06-01; window 2026-05 → 90.

### F07 / F08 — risk and approval colours (OPEN)
Explicit lookup tables keyed on normalised lowercase labels; unknown → `PALETTE.slate`. Test via a pure helper.

### F09 — innerHTML of API labels (OPEN)
Escape `technician` and `rule_type` (technician names come from SDP, rule types from CAB data). Add escaping helper to analytics; extend `csp-no-inline-handlers`-style static test that template rows in analytics use `esc(`.

### F10 — dual axis (OPEN)
Replace both composite charts with `TrendPanel` from `public/lib/charts.js` (as index/reports did in A-22). Visual-only; no KPI change.

### F11 — filter race (OPEN)
`let _gen = 0, _pending = false;` loadAll: if loading → `_pending = true; return`; at end, if `_pending` → rerun. Loaders take `gen` and bail if `gen !== _gen`.

### F12 — error states (OPEN)
Check `r.ok`; on failure, blank the section values ("—"), add `error` class and a Retry button calling the section loader; freshness badge text "Error".

### F13 — Chart missing fallback (PARTIAL)
CDN risk closed by B-01. Remaining fallback: when `!window.Chart` in `dashboards.html`, render a label/value table (doubles as F19's accessible alternative). Test: static check that the series branch has an else branch.

### F15 — competing local design systems (OPEN / NEEDS-HUMAN)
Brand owner decides whether IT Review keeps its "Modernist" look. Low-risk mechanical step regardless: stop shadowing canonical token names (rename to `--it-*`) so `_tokens.css` semantics are not silently overridden on that page; check `tests/review-render.test.js` and a browser look.
