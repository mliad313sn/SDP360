# Infrastructure Health — unified per-site availability, trend & governance — Design

**Date:** 2026-08-28
**Status:** Design (brainstorming output) — spec-review pass 1 applied — pending user approval
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
- **No WAN uplink/quality/SLA detail** — that stays on the existing **`wan.html`** (the "WAN Health"
  specialist page, the Infrastructure→WAN nav child). This page shows only a **rolled-up WAN availability
  per site** for the matrix's WAN column, computed on the SAME basis as `wan.html` (see §3.1) so the two
  never contradict.
- **No new persistent storage.** The data already exists (see §3); this is a read/compose layer.
- **No change** to `infra_metric_snapshots`, `wan_link_snapshots`, `wan_outages`, the sync/poller jobs,
  the report auto-fill, `wan.html`, or any PPTX/email/score.

## 3. Existing data this builds on (no new sync)

| Source | Reader / endpoint | Grain returned | Carries |
|---|---|---|---|
| OpManager LAN/WLAN/Servers | `GET /api/analytics/opmanager/availability` (reads `infra_metric_snapshots` via `getInfraSnapshots`) | site × family (per requested period) | `metric_value`, `target`, `status_color`, `trend`, `stale`, `data_through`, `device_count`, `included_device_count` |
| OpManager governance | `GET /api/analytics/opmanager/coverage` | fleet | `available`, `total`, `included`, `excluded`, `by_family`, `unmapped_probes` |
| OpManager monthly history | `getInfraSnapshots({ site_id, period_type:'month' })` | **all** monthly rows for the site (no range filter; ordered `period_start DESC`) | same columns per month |
| Meraki WAN (current) | `GET /api/analytics/wan/summary` → `wanDashboard.latestPerSite` | site × **uplink** (NOT rolled up) | per-uplink cells |
| Meraki WAN availability (event-based) | the event-based computation currently **inline in `routes/opmanager.js`** (`getWanOutagesOverlapping` over the window, gated on `wan_poll_last_run`) | site × uplink, current window only | the faithful "% up in service hours" |

### 3.1 WAN availability basis — the load-bearing decision (resolves review finding #1)

The project **retired** the loss-based `wan_link_snapshots.availability_pct` ("% Time Up") in favour of an
**event-based** availability (`services/wanEventAvailability.js` + `wan_outages`, gated on
`wan_poll_last_run`), computed **on-the-fly for the current window only** and **never archived per month**.
Two consequences drive the design:

- **Matrix WAN cell = the EVENT-BASED value**, the exact same figure `wan.html` shows — so the two pages
  can never disagree. This means the pure layer must be fed the event-based per-site roll-up, and the
  computation currently living inline in the route must first be **extracted** into a reusable helper (see
  §8). It must **not** read the retired `availability_pct` snapshot column.
- **WAN has NO event-based monthly history** → the **trend chart covers LAN / WLAN / Servers only** in v1.
  The WAN column shows its current cell + Δ, but no WAN line in the trend; a note links to `wan.html`
  ("WAN trend & uplink detail → WAN Health"). A future event-based monthly WAN roll-up is a fast-follow
  (§5), not part of v1.

## 4. Architecture

```
Browser: public/infra-health.html   (Infrastructure nav, sibling of wan.html)
  ├─ GET /api/analytics/infra/summary?period=week|month
  │     → services/infraHealth.buildInfraMatrix({opmSites, wanSites, coverage, asOf})  [PURE]
  │        merges OpManager (lan/wifi/servers) + Meraki event-based WAN into ONE row/site,
  │        4 family cells {value, rag, target, trend, stale} + overall infra rag + Δ
  └─ GET /api/analytics/infra/trend?site=CODE&months=12
        → services/infraHealth.buildInfraTrend({opmMonthly, months, asOf})             [PURE]
           per-family (LAN/WLAN/Servers) monthly series; aligned month axis, null for gaps

Server: routes/opmanager.js  (add the two /infra/* routes beside the existing opmanager/wan routes)
```

**Key design choice:** the merge + Δ + RAG live in a **pure `services/infraHealth.js`** (no I/O, `asOf`
injected), unit-testable against fixtures. The routes only fetch + hand rows to the pure layer.

### 4.1 `services/infraHealth.js` (pure)

- Copies the `rollupRag()` roll-up (green=2/amber=1/red=0, ≥0.75 green / ≥0.5 amber / else red, all-na→na)
  and the Δ/`trendOf` logic — currently **local functions in `routes/siteAwareness.js`** — into this
  shared service (the Group View patterns the page reuses).
- `buildInfraMatrix({ opmSites, wanSites, targets, asOf })` → `{ sites: [ { site_id, site_name,
  overall_rag, overall_trend, families: { wan, lan, wifi, servers } } ], fleet: { by_family_counts,
  freshness } }`.
  - Family cell = `{ value, rag, target, trend, stale, data_through, device_count }`, or
    `{ value:null, rag:'na' }` when the site has no measured devices in that family.
  - **lan/wifi/servers** come from `opmSites` (already carry value/rag/trend/stale). **WAN** comes from the
    event-based per-site roll-up derived from `wanSites` (see §3.1) — **not** the snapshot column.
  - **overall_rag/overall_trend** over the present (non-na) family subset.
- `buildInfraTrend({ opmMonthly, months, asOf })` → `{ labels:[YYYY-MM…], series: { lan:[…], wifi:[…],
  servers:[…] } }` — groups the monthly rows by `period_start`, **null for months with no snapshot**
  (never 0), aligned to a contiguous axis ending at `asOf`. **No WAN series in v1** (§3.1).

### 4.2 Routes (in `routes/opmanager.js`)

- `GET /api/analytics/infra/summary?period=week|month` — group-scoped like the WAN/opmanager reads.
  Fetch OpManager availability (existing reader), the WAN per-site event-based roll-up (extracted helper,
  §8), and coverage; hand to `buildInfraMatrix`. Best-effort: any source that throws → that family
  degrades to `na`, never a 500.
- `GET /api/analytics/infra/trend?site=CODE&months=12` — resolve the site (tolerant `resolveSiteParam`),
  read `getInfraSnapshots({site_id, period_type:'month'})` (**already returns full monthly history — no
  reader change needed**), hand to `buildInfraTrend`. Empty/short history → a short/empty series (the UI
  shows a "collecting data" note), never a 500.

### 4.3 `public/infra-health.html`

Standalone page mounting the app shell (`#__shell`, `data-section="infrastructure"
data-current="infra-health"`), bilingual FR/EN (`data-lng` + `T()`), Chart.js (CDN, in CSP), brand
tokens + Lucide icons. Six blocks (top→bottom): **freshness banner · per-family KPI tiles · one-line
read-out · site×family matrix (RAG + Δ chip + `stale` tag, worst-first sort, red-row emphasis) ·
trend line chart (LAN/WLAN/Servers, on row-click) · coverage/governance panel**. Row-click swaps the
trend + governance to that site. Reuses the RAG-chip / worst-first-sort / read-out / red-row patterns
already shipped in `public/site-awareness.html` Group View.

### 4.4 Navigation

Add an **"Infrastructure Health"** child to the **Infrastructure** nav group in `_shell.js` (alongside
Assets + WAN=`wan.html`). Icon: add an **`activity`** Lucide glyph to **BOTH** `brand/icons.js` (a real
path — it is absent today) **AND** `_shell.js`'s hand-curated `ICON_LIB` subset (or reuse an existing
`ICON_LIB` key to avoid an empty-icon span — the documented pitfall). `server.js` gets the `_htmlCache`
boot-load + a `sendHtmlPage` route for the new page.

## 5. The trend-history decision (finalise in the plan)

The trend depth depends on the monthly snapshot history. `infra_metric_snapshots` accumulates **going
forward** (like `asset_effort_history`), so early on the LAN/WLAN/Servers curves are short. Options:

- **(a) Accumulate only** — the curve fills month by month. Simplest, zero backfill; honest "collecting
  data" state at first. **Chosen for v1.**
- **(b) Backfill from the Analytics view's daily history** (fast-follow) — aggregate the daily
  `OPS_OPM_Device_Availability_Daily` rows into past monthly snapshots for a full curve immediately;
  requires the Analytics-Plus → OpManager import to be refreshed first (today it is stale ~May 2026).
- **WAN monthly trend** (separate fast-follow) — an event-based monthly WAN roll-up would let WAN join the
  trend; out of scope for v1 (§3.1).

## 6. Error handling & honesty

- **Freshness is a headline, not a footnote.** Each family cell carries `stale` (`data_through` vs
  `opm_stale_days`); the page shows a top **freshness banner** and a `stale` tag on stale cells.
  Load-bearing given today's stale (May) OpManager source.
- **Coverage may be entirely unavailable, not just stale.** `/opmanager/coverage` returns
  `{available:false}` when neither OpManager REST nor `opm_availability_view_id` is configured. The
  governance panel must render a **"coverage not configured"** state, distinct from stale-but-present.
- **null ≠ 0.** A family with no measured devices → `na`/"—" (never a false 0%); a month with no snapshot
  → a gap in the trend (`spanGaps:false`), never 0.
- **Best-effort everywhere** — a failing source degrades that family/site, never 500s the page.

## 7. Testing

- `tests/infra-health.test.js` — pure `buildInfraMatrix` (merge opm+event-based WAN, overall roll-up, Δ,
  na handling, stale propagation) + `buildInfraTrend` (aligned axis, null gaps, short history, no WAN
  series).
- `tests/infra-health-routes.smoke.test.js` — `/infra/summary` returns a per-site matrix with the 4
  families + `overall_rag`/`overall_trend`; `/infra/trend` returns aligned LAN/WLAN/Servers series; both
  group-gated and never-500 on hostile input; coverage-unavailable path handled.
- No golden/PPTX impact (read-only page; touches no report/email/score).

## 8. Reuse & files

| File | Change |
|---|---|
| `services/infraHealth.js` | **new** — pure merge + trend + copied `rollupRag`/`trendOf` |
| `routes/opmanager.js` | **+2 routes** `/api/analytics/infra/{summary,trend}`; **extract** the inline event-based WAN per-site availability into a reusable helper (used by both the existing WAN route and the new summary route) |
| `public/infra-health.html` | **new** — the page |
| `public/_shell.js` | **+1 nav child** under Infrastructure; **+`activity`** in `ICON_LIB` (or reuse a present key) |
| `public/brand/icons.js` | add the `activity` glyph path (absent today) if not reusing |
| `server.js` | `_htmlCache` boot-load + `sendHtmlPage` route |
| `tests/infra-health*.test.js` | **new** |

Untouched: OpManager/WAN sync + poller, `infra_metric_snapshots`, `wan_link_snapshots`, `wan_outages`,
report auto-fill, `wan.html`, PPTX/email/score.

## 9. Open items for the plan

1. **WAN per-site event-based roll-up rule** — mean vs min across a site's uplinks, using the extracted
   event-based helper (NOT the retired loss-based column). Basis decision itself is settled (§3.1).
2. Trend option **(a)** for v1 (accumulate); (b) + WAN-monthly are fast-follows.
3. Whether to add a real `activity` glyph or reuse an existing `ICON_LIB` key for the nav.
