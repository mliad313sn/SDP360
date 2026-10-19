# 04 — Functional Specification: Custom Tracker & Dynamic Dashboard Engine

*Module id: `engine`. Implemented core: `services/kpiRag.js`, `services/trackerDefinitions.js`, `services/dashboardWidgets.js`; storage `db/postgres/tracker/002_tracker_definitions.sql`, `db/postgres/reports/016_dashboard_definitions.sql`. This spec covers the builder UIs, runtime, metric API and exports still to build (roadmap P2).*

## 1. Goals and non-goals

**Goals**
- A site manager or committee member creates a tracker or a dashboard in under 30 minutes without a developer.
- One definition drives screen, PPTX, Excel and e-mail; one scorer; one RAG registry.
- Every definition is validated, versioned, reviewed (RFI) and published; a published score is reproducible against the definition version that was live.

**Non-goals**
- Free-form SQL or formula authoring by users (metrics are registered by the Data Engineer).
- Replacing SDP's own reports for ticket-level analysis.
- A generic BI tool; the widget catalogue is deliberately small and opinionated.

## 2. Concepts

| Term | Definition |
|---|---|
| **Metric** | a registered, named measure (`metric_registry.key`) computed by a server-side *reader* for a `(unit, window)`; has a formula text, unit, window kind, RAG policy, owner |
| **RAG policy** | named thresholds `{green, amber, scale}` in `kpi_rag_policies`; `scale` = `ratio` (1.0 = target) or `points` (0–100) |
| **Tracker** | a periodic scorecard: *units* (sites/teams) × *items* grouped in weighted *groups*, scored per *period slot* against targets |
| **Item source** | optional binding of a tracker item to a metric so its value is computed, not typed |
| **Dashboard** | a grid of *widgets* bound to metrics (or to a tracker) for an *audience* |
| **Definition** | the JSON document of a tracker or dashboard; lifecycle `draft → review → published → retired`, versioned |

## 3. Tracker Builder (UI: `public/tracker-builder.html`)

### 3.1 Workflow
1. **Start**: blank, from template (`docs/sdp360/templates/TRACKER-DEFINITION-TEMPLATE.json`), or **import legacy** (`fromLegacyInit`).
2. **Period**: kind `monthly | weekly | quarterly`, start (`2027`, `2027-01`, `2027-W01`), count (≤ periods in a year).
3. **Units**: pick from canonical `sites` (multi-select) or declare teams; each unit gets code, name, colour.
4. **Groups & items**: add group (code, name, weight — live sum shown, must equal 1); add items (code, name, KPI type from `kpiRag.KPI_TYPES`, weight, target, start/end slot, shared flag, **source** picker listing metrics whose `module` matches).
5. **RAG policy**: pick from registry; preview bands.
6. **Validate**: inline errors from `trackerDefinitions.validate` keyed by path; save as `draft` only when `ok`.
7. **Dry run**: paste or import sample entries → `score()` → preview per unit/group/item.
8. **Submit for review** → creates/links an RFI (kind `tracker`), status `review`.
9. **Publish** (committee role `tracker-admin` or Chair): writes `tracker_definition_versions`, sets `published_at`, snapshot in `system_log`.

### 3.2 Validation rules (implemented)
Codes `^[A-Z0-9][A-Z0-9_-]{0,31}$`; unique unit/group/item codes; group weights Σ = 1 ± 0.001; item weight > 0; KPI type ∈ registry; `1 ≤ start ≤ end ≤ period.count`; numeric target; `source` needs `{module, metric}`; RAG policy known or `{green > amber}`.

### 3.3 Permissions
| Action | Roles |
|---|---|
| create/edit draft | `tracker-editor`, `tracker-admin`, admin tier |
| submit for review | same |
| publish / retire | `tracker-admin`, super_admin |
| enter values | `tracker-editor` for own units (`userSites.hasSite`), `field-tech` (P3) for own units |
| edit closed slots | super_admin only (month lock, `trackerMonthLock.GRACE_DAY`) |

## 4. Tracker Runtime

### 4.1 Entry grid (`public/tracker.html?key=`)
- Rows = items grouped; columns = period slots up to the current one; one unit at a time (selector limited to the user's units).
- Cell types by KPI type: BOOLEAN toggle (0 / 0.5 / 1), COUNT integer, PERCENT 0–100, MILESTONE phase picker, CURRENCY amount, RATING 1–5, DURATION hours.
- Bound items are read-only, show the computed value with a "from meetings / inspections / helpdesk" badge and a link to the source list; a manual override requires a note (stored in `tracker_entries.note`, `source='manual-override'`).
- Autosave 1.5 s debounced (inherited behaviour); closed slots greyed with banner; server re-applies `mergeClosed`.
- Import from xlsx: template downloaded from the grid, same validation, preview with per-row reasons before commit.

### 4.2 Scoring (implemented: `trackerDefinitions.score`)
- Period value per item = `kpiRag.aggregate(series[0..current], type)`; shared items take the best unit.
- Attainment = `kpiRag.attainment(value, target, type, {elapsed, span})`; COUNT targets pro-rated by elapsed slots; not-started → `NA`; zero target → `NA`.
- Item RAG by the tracker's policy; non-COUNT items below amber but not yet past `end` → `AMBER` (not overdue).
- Group score = weighted mean of capped attainments; unit score = Σ effective weights (group weight × normalised item weight over *active* items); unit RAG via the executive policy (to be converged, 02 §6.5).
- Fleet: mean, SD, best, worst, attainment (share GREEN).

### 4.3 API
```
GET  /api/trackers                          list (status filter)             session
GET  /api/trackers/:key                     definition (published version)   session
POST /api/trackers                          create draft                     tracker-editor+
PUT  /api/trackers/:key                     update draft (validates)         tracker-editor+
POST /api/trackers/:key/validate            dry validate                      tracker-editor+
POST /api/trackers/:key/submit              → review (+RFI)                   tracker-editor+
POST /api/trackers/:key/publish             → published, new version          tracker-admin
GET  /api/trackers/:key/entries?unit=&upto= entries for a unit                session (scope)
PUT  /api/trackers/:key/entries             bulk upsert [{unit,item,slot,value,note}]  scope + month lock
GET  /api/trackers/:key/score?upto=         scored result (all units in scope) session
GET  /api/trackers/:key/export.xlsx|.pptx   exports from the same score       session
```
Errors: `400 {errors:[{path,msg}]}` on validation; `409 closed_blocked` on locked slots (inherited contract); `403` on scope.

## 5. Metric Registry & Readers

### 5.1 Registry row (`metric_registry`)
`key, name, module, unit, formula, window_kind, rag_policy, reader, owner_role, rfi_ref, status`.

### 5.2 Reader contract (`services/metrics/readers/<module>.js`)
```js
module.exports = {
  'helpdesk.resolution_sla_pct': async ({ siteIds, window, db }) => ({
    value: 93.2, numerator: 412, denominator: 442, asOf: '2026-10-19T08:45:00Z', na: false }),
};
```
- Receives canonical `siteIds` (never names) and a resolved window `{from, to, kind}`.
- Returns counters with the value so fleet roll-ups re-sum (G4) and tooltips show the fraction.
- `na: true` with a `reason` when the denominator is 0 or the source never synced (G5).
- Readers are pure over `db`; cached per `(key, siteIds, window)` for the metric's cadence.

### 5.3 API
```
GET /api/metrics/registry                       published rows (+ RAG policy details)
GET /api/metrics/:key?site=SGO,HGO&window=rolling13w&series=1   value(s), counters, rag, asOf
GET /api/metrics/:key/definition                formula text, owner, RFI, tests
```
Initial registry (P1-11): `helpdesk.inbound`, `helpdesk.closed`, `helpdesk.resolution_sla_pct` (D1), `helpdesk.first_reply_sla_pct` (D3), `helpdesk.reopen_rate_pct` (D2), `helpdesk.ageing_buckets`, `change.success_pct` (D4), `survey.csat_pct`, `wan.availability_pct`, `wan.outage_minutes`, `infra.device_availability_pct`, `meetings.held_count`, `meetings.signoff_pct`, `inspections.count`, `inspections.critical_major_open`, `actions.open_count`, `actions.overdue_count`, `assets.hygiene_score`, `tracker.<key>.unit_score`.

## 6. Dashboard Builder & Renderer

### 6.1 Widget catalogue (implemented in `dashboardWidgets.WIDGET_TYPES`)
| Type | Needs metric | Min size | Props | Field profile |
|---|---|---|---|---|
| `kpi` | yes | 2×2 | `rag`, `format`, `compare` (prev window) | ✔ |
| `trend` | yes | 4×3 | `series`, `window` | ≥ 6 cols |
| `bar` | yes | 4×3 | `groupBy`, `stacked` | ≥ 6 cols |
| `table` | yes | 4×3 | `columns`, `pageSize` | `pageSize ≤ 10` |
| `heatmap` | yes | 6×3 | `rows`, `cols`, `rag` | ✘ (use `ragGrid`) |
| `ragGrid` | yes | 4×3 | `rag` | ✔ |
| `trackerRag` | tracker key | 4×3 | `tracker` | ✔ |
| `text` | no | 2×1 | `markdown` | ✔ |
| `actions` | no | 4×3 | `sources`, `onlyOverdue` | ✔ |

### 6.2 Builder (`public/dashboard-builder.html`)
- 12-column grid (configurable 1–24), drag/resize, collision and overflow prevented live with the same validator the server runs.
- Widget inspector: metric picker (search registry by module), title/subtitle auto-filled with formula and window, RAG policy, filters binding (`site`, `window`, `month`, `week`, `group`, `department`, `text`).
- Audience switch with device preview (desktop 1366 / tablet 1024 / phone 360); `field` audience runs `fieldReadiness` and blocks publish on issues.
- Save draft → submit (RFI kind `widget` or `dashboard`) → publish (versioned). Max 40 widgets.

### 6.3 Renderer (`public/dashboard.html?key=`)
- Reads the published definition, resolves filters from the URL/user scope, fetches `/api/metrics/:key` per widget with request coalescing (same key+window → one call), renders with Chart.js on the shared shell and brand tokens.
- Every KPI tile shows: value, RAG chip, subtitle "formula · window", "as of" stamp, counters on hover; `NA` renders as a grey "n/a — reason".
- Field mode: no images, single column stacking, cached payload with stamp when offline.
- Exports: "Download PPTX" composes slides from the same widget data via `reports-pptx-shared.js` primitives; "Schedule" hands over to `report_schedules` (P4-2).

### 6.4 API
```
GET  /api/dashboards?audience=            published list in scope
GET  /api/dashboards/:key                 definition
POST /api/dashboards · PUT /api/dashboards/:key · POST …/validate · POST …/submit · POST …/publish
GET  /api/dashboards/:key/data?site=&window=     resolved payload for all widgets (server-side coalesced)
```

## 7. RFI integration
`POST /api/rfi` (any session) creates `rfi_requests`; builders attach `rfi_ref`; status changes by Committee roles only; the Help page lists the user's RFIs with status. Scoring fields `impact/effort/data_risk` editable by Committee at triage.

## 8. Exports share the engine
`tracker-pptx.js`, `reports-*-pptx.js`, `tableExcel.js` must consume `score()` output and `/api/metrics` payloads; any formula found in an export file is a defect (P2-10). The golden PPTX fingerprint test extends to the new tracker deck.

## 9. Acceptance tests (automated)
- Validators: all rules in §3.2 and §6.1 (done: `tests/tracker-definitions.test.js`, `tests/dashboard-widgets.test.js`).
- Scorer parity: `it-activity-2026` scored by legacy `engine.js` vs `trackerDefinitions.score` over a frozen fixture → equal ±0.001.
- Route smoke: each endpoint 401/403/400/409 paths; scope enforcement with multi-site editors (reuse `multi-site-editor.smoke` pattern).
- Field readiness: a `field` dashboard with a heatmap fails publish.
- Reproducibility: scoring a past month against version N after publishing version N+1 returns the N result.
