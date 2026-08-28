# Infrastructure Health — unified per-site availability, trend & governance — Design

**Date:** 2026-08-28
**Status:** Design (brainstorming output) — pending spec review + user approval
**Author:** brainstorming session

---

## 1. Goal

A single read-only **"Infrastructure Health"** page in the Infrastructure nav that presents the
**cumulated availability per site × KPI-family** — **WAN · LAN · WLAN · Servers** — with target/RAG,
month-over-month Δ, a long-term **trend** per family, and a **coverage/governance** panel.

The page **complements** OpManager (the live NOC/supervision tool); it must **not replace** it. The
value it adds — the "plus" OpManager does not give:

1. **Retention** — a long-term availability history that survives OpManager's / Meraki's purge window.
2. **Business roll-up** — device-grain availability rolled up to **site × family** with **targets + RAG**,
   the language of the monthly IT report / Mine IT Council.
3. **Cross-source unification** — Meraki (WAN) + OpManager (LAN/WLAN/Servers) in one per-site view.
4. **Measurement quality / governance** — which devices feed each family, which are excluded/unclassified,
   and how fresh the data is.

## 2. Non-goals (scope guardrails)

- **No live per-device status** (that is OpManager). No real-time polling, no alerting.
- **No device-level availability drill.** The lowest grain is site × family; the governance panel lists
  *coverage counts*, not per-device metrics.
- **No WAN uplink/quality/SLA detail** — that stays on the existing `wan-health.html` (specialist view).
  This page pulls only a **rolled-up WAN availability per site** for the matrix's WAN column.
- **No new persistent storage.** The data already exists (see §3); this is a read/compose layer.
- **No change** to `infra_metric_snapshots`, `wan_link_snapshots`, the sync jobs, the report auto-fill,
  or any PPTX/email/score.

## 3. Existing data this builds on (no new sync)

| Source | Table / endpoint | Grain | Carries |
|---|---|---|---|
| OpManager LAN/WLAN/Servers | `infra_metric_snapshots` via `GET /api/analytics/opmanager/availability` | site × family × period (week+month) | `metric_value`, `target`, `status_color`, `trend`, `stale`, `data_through`, `device_count`, `included_device_count` |
| OpManager governance | `GET /api/analytics/opmanager/coverage` | fleet | `total`, `included`, `excluded`, `by_family`, `unmapped_probes` |
| Meraki WAN | `wan_link_snapshots` via `GET /api/analytics/wan/summary` (`services/wanDashboard.latestPerSite`) | site × uplink × period | `availability_pct`, `status_color`, loss/latency/jitter |

The OpManager availability + coverage are **already flowing** (view `OPS_OPM_Device_Availability_Daily`
wired via `opm_availability_view_id`, async bulk-export). WAN Health already reads `wan_link_snapshots`.

## 4. Architecture

```
Browser: public/infra-health.html   (Infrastructure nav, sibling of WAN Health)
  ├─ GET /api/analytics/infra/summary?period=week|month
  │     → services/infraHealth.buildInfraMatrix(opmSites, wanSites, coverage)   [PURE]
  │        merges OpManager (lan/wifi/servers) + Meraki (wan) into ONE row per site,
  │        4 family cells {value, rag, target, trend, stale} + an overall infra rag + Δ
  └─ GET /api/analytics/infra/trend?site=CODE&months=12
        → services/infraHealth.buildInfraTrend(opmMonthly, wanMonthly)          [PURE]
           per-family monthly series (aligned month axis, null for gaps, never 0)

Server: routes/opmanager.js  (add the two /infra/* routes next to the existing opmanager/wan routes)
  - reuse resolveSiteParam (tolerant probe/code/name), getInfraSnapshots, wanDashboard, coverage reader
```

**Key design choice:** the merge + Δ + RAG live in a **pure `services/infraHealth.js`** (no I/O, `asOf`
injected), so it is unit-testable against fixtures. The routes only fetch + hand rows to the pure layer.

### 4.1 `services/infraHealth.js` (pure)

- `buildInfraMatrix({ opmSites, wanSites, targets, asOf })` → `{ sites: [ { site_id, site_name,
  overall_rag, overall_trend, families: { wan, lan, wifi, servers } } ], fleet: { by_family_counts,
  freshness } }`.
  - Each family cell = `{ value, rag, target, trend, stale, data_through, device_count }` or
    `{ value:null, rag:'na' }` when the site has no measured devices in that family.
  - **WAN cell** comes from `wanSites` (Meraki roll-up per site — mean/min across uplinks, decided in
    the plan); **lan/wifi/servers** come from `opmSites`.
  - **overall_rag** = the existing Site-Overview roll-up over non-na cells (green=2/amber=1/red=0,
    ≥0.75 green / ≥0.5 amber / else red). **overall_trend** = Δ over the same present-family subset.
  - **RAG per family** honours each family's target (opmSites already carry `status_color`; WAN uses
    the wan_link_snapshots band).
- `buildInfraTrend({ opmMonthly, wanMonthly, months, asOf })` → `{ labels:[YYYY-MM…],
  series: { wan:[…], lan:[…], wifi:[…], servers:[…] } }` — **null for months with no snapshot** (never 0),
  aligned to a contiguous month axis ending at `asOf`.

### 4.2 Routes (in `routes/opmanager.js`)

- `GET /api/analytics/infra/summary?period=week|month` — group-scoped like the WAN/opmanager reads.
  Fetch OpManager availability (existing reader) + WAN summary (existing) + coverage; hand to
  `buildInfraMatrix`. Best-effort: any source that throws → that family degrades to `na`, never a 500.
- `GET /api/analytics/infra/trend?site=CODE&months=12` — resolve the site (tolerant), read the
  **monthly** `infra_metric_snapshots` rows for lan/wifi/servers + the monthly `wan_link_snapshots`
  roll-up, hand to `buildInfraTrend`. Empty/short history → a short/empty series (the UI shows a
  "collecting data" note), never a 500.

### 4.3 `public/infra-health.html`

Standalone page mounting the app shell (`#__shell`, `data-section="infrastructure"
data-current="infra-health"`), bilingual FR/EN (the `data-lng` + `T()` pattern), Chart.js (CDN, in CSP),
brand tokens + Lucide icons. Six blocks (top→bottom): **freshness banner · per-family KPI tiles ·
one-line read-out · site×family matrix (RAG + Δ chip + `périmé` tag, worst-first sort, red-row emphasis)
· trend line chart (per-family, on row-click) · coverage/governance panel**. Row-click swaps the trend +
governance to that site. Reuses the RAG-chip / worst-first-sort / read-out patterns already shipped on
`site-awareness.html` (Group View).

### 4.4 Navigation

Add a **"Infrastructure Health"** child to the **Infrastructure** nav group in `_shell.js` (alongside
Assets + WAN), icon `activity` (add the Lucide glyph to `brand/icons.js` if absent). URLs unchanged
elsewhere.

## 5. The trend-history decision (to finalise in the plan)

The trend depth depends on the monthly snapshot history. `infra_metric_snapshots` accumulates **going
forward** (like `asset_effort_history`), so early on the curve is short. Two options:

- **(a) Accumulate only** — the curve fills month by month. Simplest, zero backfill; honest "collecting
  data" state at first.
- **(b) Backfill from the Analytics view's daily history** — a one-off/periodic job that aggregates the
  daily `OPS_OPM_Device_Availability_Daily` rows into past monthly snapshots, so the curve is full
  immediately. Requires the view to actually hold history (today it is stale at ~May 2026 — a source
  refresh is a prerequisite).

**Recommendation: (a) now, with (b) as a fast-follow** once the Analytics-Plus → OpManager import is
refreshed. The page renders correctly under (a) with a "history is accumulating" note where series are
short; (b) only deepens the curve.

## 6. Error handling & honesty

- **Freshness is a headline, not a footnote.** Every family cell carries `stale` (from `data_through` vs
  `opm_stale_days`); the page shows a top **freshness banner** ("data through X · N sites stale") and a
  `périmé` tag on stale cells. This is load-bearing given the current stale (May) source data.
- **null ≠ 0.** A family with no measured devices reads `na`/"—" (never a false 0%); a month with no
  snapshot is a gap in the trend (`spanGaps:false`), never a 0.
- **Best-effort everywhere** — a failing source degrades that family/site, never 500s the page.

## 7. Testing

- `tests/infra-health.test.js` — pure `buildInfraMatrix` (merge opm+wan, overall roll-up, Δ, na handling,
  stale propagation) + `buildInfraTrend` (aligned axis, null gaps, short history).
- `tests/infra-health-routes.smoke.test.js` — `/infra/summary` returns a per-site matrix with the 4
  families + `overall_rag`/`overall_trend`; `/infra/trend` returns aligned series; both group-gated and
  never-500 on hostile input.
- No golden/PPTX impact (read-only page; touches no report/email/score).

## 8. Reuse & files

| File | Change |
|---|---|
| `services/infraHealth.js` | **new** — pure merge + trend |
| `routes/opmanager.js` | **+2 routes** `/api/analytics/infra/{summary,trend}` |
| `public/infra-health.html` | **new** — the page |
| `public/_shell.js` | **+1 nav child** under Infrastructure |
| `public/brand/icons.js` | `activity` glyph if absent |
| `server.js` | `_htmlCache` boot-load + `sendHtmlPage` route for the new page |
| `tests/infra-health*.test.js` | **new** |

Untouched: OpManager/WAN sync, `infra_metric_snapshots`, `wan_link_snapshots`, report auto-fill,
`wan-health.html`, PPTX/email/score.

## 9. Open items for the plan

1. WAN per-site roll-up rule (mean vs min across uplinks) for the matrix WAN cell.
2. Trend option (a) vs (b) — start (a).
3. Exact monthly readers for the trend (extend `getInfraSnapshots` to a multi-month read + a monthly
   WAN roll-up in `wanDashboard`).
