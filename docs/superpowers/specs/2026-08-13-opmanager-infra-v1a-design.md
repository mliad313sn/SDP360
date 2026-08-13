# OPManager Infra Availability — V1a (Read + Snapshots + API + Governance) — Design

**Date:** 2026-08-13
**Status:** Design (brainstorming output) — pending spec review + user approval
**Sub-project:** V1a of the OPManager→Analytics Plus→OPS infra-availability integration. Later: V1b (site-report auto-fill + manual override), V1c (WAN quality + governance polish).

---

## 1. Purpose

Bring **infrastructure availability KPIs** (LAN / WiFi / WAN / Servers) into OPS, sourced from **OPManager via ManageEngine Analytics Plus** — *without* OPS becoming a supervision tool. V1a delivers the **read-only foundation**: a normalized availability snapshot per site × KPI-family × period (week + month), an Analytics adapter + sync, read APIs, and a coverage/governance view. **V1a does NOT touch the weekly report or `infra_kpis`** — those snapshots are the source V1b will later auto-fill from.

## 2. Architecture (unchanged constraint)

```
OPManager (source of truth)
  → native integration (exists)
Analytics Plus (workspace 106803000000002012)
  → ONE prepared view: OPS_OPM_Device_Availability_Daily  (does ONLY the join)
OPS Dashboard
  → classify + aggregate (JS, unit-tested) → infra_metric_snapshots → read API / coverage
```

Hard rules (verbatim from the brief): OPS does **not** poll devices, **not** recreate alerts, **not** replace NOC dashboards, **not** use OPManager groups (V1), **not** include `Unknown` in KPIs, **not** confuse availability with quality, **not** break existing reports. Analytics is the only thing OPS talks to.

**Division of labour (decided):** Analytics does *only the join* it alone can do (it holds both the Availability History and the Inventory tables); **OPS owns classification + aggregation** (evolving business logic, unit-tested in JS). Confirmed by the raw exports: `Availability_History_of_Devices.csv` has the device + daily metrics but no site/family; `OPM_Inventory.csv` has site (Probe Name) + Type/Category but **no device key** — so the join is impossible in the raw exports and MUST be done in Analytics.

## 3. The Analytics contract (Phase-1 task, owned by the user)

**One view** OPS consumes: `OPS_OPM_Device_Availability_Daily` — **one row per device × day**, the Availability-History↔Inventory join done inside Analytics on a shared device key.

| Column (contract) | Source | Notes |
|---|---|---|
| `Device Key` | Resource ID / Device ID (preferred) | the join key; must be identical on both source tables |
| `Device Name` | Availability History | e.g. `burmadfs02.edv-ops.com.30000000001` |
| `Probe Name` | Inventory | = the site dimension (Sabodala, LAFIGUE, HOUNDE, Mana, Ity, Ouagadougou, ABJ, Tanda…) |
| `Type` | Inventory | e.g. `Windows 2022`, `Meraki MS Series`, `Unknown` |
| `Category` | Inventory | e.g. `Server`, `Meraki Switch`, `Meraki Radio`, `Meraki Security`, `Wireless`, `Unknown` |
| `Vendor` | Inventory | optional |
| `Day` | Availability History `Time Period` | a real date (the raw data is **daily**, e.g. `"May 28, 2026 12:00:00 AM"`) |
| `Uptime Percentage` | Availability History | `"95.8%"` string |
| `Uptime Duration` | Availability History | `"1 days 00 hrs 00 mins 00 secs"` string |
| `Downtime Duration` | Availability History | same format |
| `Maintenance Duration` | Availability History | same format |
| `Dependent Unavailability Duration` | Availability History | same format |
| `Unmonitored Duration` | Availability History | same format |
| `On Hold Duration` | Availability History | same format (optional) |

**Analytics does ONLY:** the join + carry the daily `Time Period` as a date. No classification, no weekly/monthly bucketing — OPS does those. The view id is **configuration** on the OPS side (`opm_availability_view_id`), not hard-coded. **Until this view exists, OPS builds and tests entirely against CSV fixtures** (the live path is one `fetchView(id)` call, pointed at the real view when Phase 1 lands).

*(Note: the PII scrubber in `fetchView` strips any `IP Address` column but keeps `Device Name`; the availability view needs no IP, so V1a is unaffected. If a future view needs IP, a scrubber allowlist is a separate change.)*

## 4. OPS components

### 4.1 `services/opmClassify.js` — pure classification
`classifyKpiFamily(type, category)` → `{ family: 'servers'|'lan'|'wifi'|'wan'|'excluded', reason: string }`. Case-insensitive, trimmed. **The family ORDER is authoritative — the rules are evaluated top-to-bottom and the first family whose (Category-equals OR Type-contains) test matches wins.** The order below (excluded → wan → wifi → lan → servers) is chosen so the one real conflict in the data resolves correctly: a `Type=Linux` device with `Category=Wireless` hits `wifi (3)` before `servers (5)` → WiFi. (It is *not* a blanket "all Category rules before all Type rules"; it is family precedence.)

```
1. excluded : Category ∈ {Unknown, Meraki Controller}  OR  Type = Unknown
2. wan      : Category ∈ {Meraki Security}              OR  Type contains {Meraki MX, Meraki Z, Firewall, WAN}
3. wifi     : Category ∈ {Meraki Radio, Wireless}        OR  Type contains {Meraki MR, Access Point, AP, Wireless Access Point}
4. lan      : Category ∈ {Meraki Switch}                 OR  Type contains {Meraki MS, Switch}
5. servers  : Category ∈ {Server, DomainController}      OR  Type contains {Windows, Linux, ESXServer}
6. excluded (fallback) : reason = 'unclassified'
```
Rules are a declared table (data, not code branches) so V2 exceptions are a table edit. Validated against `OPM_Inventory.csv`: Servers (Windows/Linux/ESXServer/DomainController), LAN (Meraki MS), WiFi (Meraki MR + the Linux/Wireless case), WAN (Meraki MX/Z), and the large `Unknown/Unknown` + `Cyber Power System` (UPS, Category=Unknown) → excluded.

### 4.2 `services/opmAvailability.js` — pure aggregation
Helpers: `parsePercent('95.8%')→95.8`, `parseDuration('0 days 22 hrs 59 mins 34 secs')→82774` (seconds), both tolerant (null on garbage). Store raw / coerce here (mirrors the Assets module).

`aggregate(dailyRows, { probeToSite, classify, targets, periodType, asOf })` → array of snapshot-shaped rows. Steps:
1. Classify each row (`family`); drop `excluded` from KPI math (kept for coverage).
2. Resolve `site_id` = `probeToSite(probe)`; a row whose probe is unmapped is dropped from KPI math (kept for coverage as `unmapped_probe`).
3. Bucket `Day` → **ISO week** (Monday-anchored `{period_start, period_end}`) for `periodType:'week'`, or calendar **month** for `periodType:'month'`. **The month helper `_monthBounds` is already exported from `siteReportDeps.js`; the week helper is NOT** — `_isoWeek` is unexported and `_lastIsoWeeks(asOf,n)` returns a *trailing window* with `{from,to}`, not a "bucket this date" function. So the plan extracts a small **exported pure `weekOf(date) → {period_start, period_end}`** (Monday-anchored — the inline Monday logic already lives at `siteReportDeps.js:271-272` over `_isoWeek:256`) and reuses it here and in the rest of the suite. (Field names `period_start`/`period_end` are this feature's own; `_monthBounds`/`weekOf` return them or are adapted.)
4. Group by `(site_id, family, period_start)`. Per group:
   - **Availability %** = `100 × Σ(uptime_sec) / Σ(uptime + downtime + dependent + unmonitored)_sec`. Per the brief's formula: `maintenance` + `on_hold` are **excluded** from the denominator (planned/paused ≠ unavailable), while **`unmonitored` IS counted as unavailable** (a monitoring gap is treated as down — a deliberate, conservative choice; flagged in §10 for confirmation since it materially moves the %). **Fallback** = `mean(uptime_pct)` when durations are unparseable for the group.
   - `device_count` (distinct devices seen), `included_device_count` (distinct with usable data).
   - `status_color`, `trend` (§4.5, §4.6).

Pure, `asOf` injected, no DB, no `Date.now()` — fully unit-testable against fixtures.

### 4.3 Probe → site mapping (existing table, no schema change)
Store in `site_module_codes` with `module='opmanager'`, `code=<Probe Name>`, pointing at the **`sites.id`** primary key — the same `site_id` the rest of the reporting suite resolves via `getSiteIdByModuleCode`. Resolve with the existing `getSiteIdByModuleCode('opmanager', probe)` (case-insensitive) → `{site_id, name, zoho_group}`.

**Site identity is `site_id` throughout** (snapshots key on it; the API resolves its `site=` param to it — §4.8). This avoids the two-code confusion: `sites` has no short-code column (columns are `id, name, zoho_group, active, sort_order`); the short codes (`HGO`, `MGO`, …) live per-module in `site_module_codes`, so they are a *URL alias*, never the storage key.

Seed the observed probes → the correct `site_id` for each: `Sabodala, LAFIGUE, HOUNDE, Mana, Ity, Ouagadougou, ABJ, Tanda` (case-insensitive; the seed resolves each probe name to its site's `id`, it does NOT invent a new code). A probe with no mapping → **never guessed**; it surfaces in the coverage report so the operator adds it. (Editing the mapping via the admin UI is V1b/governance; V1a ships the seed + read path + the coverage signal.)

### 4.4 `infra_metric_snapshots` table (dual sqlite/pg, in reports.db)
The automated history, **separate from `infra_kpis`** (raw measurement ≠ per-report row):

```sql
CREATE TABLE infra_metric_snapshots (
  site_id             <site key>,         -- = sites.id (the reporting-suite site key)
  period_type         TEXT NOT NULL,      -- 'week' | 'month'
  period_start        TEXT NOT NULL,      -- ISO date (Mon for week / 1st for month)
  period_end          TEXT NOT NULL,
  kpi_family          TEXT NOT NULL,      -- 'lan' | 'wifi' | 'wan' | 'servers'
  metric_name         TEXT NOT NULL,      -- 'availability' (V1a); WAN quality metrics = V1c
  metric_value        REAL,               -- the % (null = no data, NEVER 0-as-absence)
  target_value        REAL,
  status_color        TEXT,               -- green | orange | red | none
  trend               TEXT,               -- up | down | stable | no_change
  source              TEXT,               -- 'analytics_opmanager'
  source_view         TEXT,               -- the Analytics view id
  data_through        TEXT,               -- newest Day present in the fetched data (freshness signal, OPS-derived)
  device_count        INTEGER,
  included_device_count INTEGER,
  collected_at        TEXT NOT NULL,      -- when OPS successfully ran the sync
  raw_json            TEXT,               -- durations + counts for audit/debug
  PRIMARY KEY (site_id, period_type, period_start, kpi_family, metric_name)
);
```
**No surrogate `id`** — the composite `(site_id, period_type, period_start, kpi_family, metric_name)` IS the primary key + the idempotency key (avoids the sqlite-`AUTOINCREMENT`-vs-pg-`IDENTITY` divergence documented for `system_log`). `site_id` typed to match `sites.id`. Idempotent upsert on the PK (sqlite `INSERT … ON CONFLICT DO UPDATE`; pg the same via `pgDb`). Mirrors the Assets dual-backend + `tools/pg/copy-*` parity; added to `initPgReports` + a copy script.

**Freshness (fix for "no refresh timestamp"):** the Analytics contract exposes no view-refresh time and `fetchView` returns rows only, so OPS derives freshness itself: `collected_at` = when OPS last synced (always set); `data_through` = `MAX(Day)` across the fetched rows for that site = the newest data OPManager/Analytics actually holds. `stale` (§4.8) is derived from these, no contract change needed.

### 4.5 Status (existing vocabulary — `orange`, never `amber`)
`green` if `value ≥ target`; `orange` if `value ≥ target − 2`; `red` if `value < target − 2`; **`none` if `value` is null (no data)**. Targets per family from config `opm_targets` (JSON, default `{lan:99, wifi:98, wan:98, servers:99}`).

### 4.6 Trend
Compared to the same family/site's **previous period** snapshot: `up` if higher, `down` if lower, `stable` within ±0.1pp; `no_change`/`stable` when no prior snapshot exists (never fabricated).

### 4.7 `services/opmAnalytics.js` (adapter) + `tools/opmanager/sync-availability.js` (sync)
- Adapter: `readDailyRows({ fetchView, viewId })` → array of contract rows (parsed from the CSV `fetchView` returns). Injectable `fetchView` for tests.
- Sync `main(deps)`: config-gated (skip if `opm_availability_view_id` unset) → `readDailyRows` → `aggregate(week)` + `aggregate(month)` → upsert into `infra_metric_snapshots` (per period_type). **Best-effort**: a fetch/parse failure writes **nothing** and keeps prior snapshots (a Meridian-style non-blocking `.catch` that logs). `require.main`-guarded, deps injectable (mirrors the Assets/Meridian sync scaffolds).
- Scheduling: nightly `cron.schedule` (after the assets sync window) + on-demand `POST /api/analytics/opmanager/sync` (admin).

### 4.8 Read API (session-guarded)
- `GET /api/analytics/opmanager/availability?site=<code>&period=week|month` → normalized rows:
  `{ site_id, site_name, period_type, period_start, period_end, kpi_family, metric_name, metric_value, target, status_color, trend, source, data_through, collected_at, stale }`. The `site=` param is the **meetings module code** (`HGO`/`MGO`/… — same key the Site Actions hub uses), resolved to `site_id` via `getSiteIdByModuleCode('meetings', code)`; no site → all sites. `stale` = `data_through` (or `collected_at` if absent) older than `opm_stale_days`. **Absent data → the family row is `metric_value:null, status_color:'none'` ("No data"), NEVER `0`.**
- `GET /api/analytics/opmanager/coverage` → governance: per site + overall — `included`, `excluded` (by family + Unknown), `unclassified` device count, `unmapped_probes` (probe names with no site mapping), `stale` snapshots, `last_sync_at`. This is the "Unclassified Devices / cleanup" surface (progressive cleanup, per the brief).

## 5. Config (reportConfig.DEFAULTS — must be there or setConfig drops them)
`opm_availability_view_id` (''), `opm_targets` (JSON string, default above), `opm_stale_days` ('9'). No secrets (the OAuth token is the shared Analytics one already in `server.js`). Optionally an admin card is V1b; V1a can set these via the generic config PUT.

## 6. Error handling / posture
- Analytics unreachable / view unset / parse fails → sync writes nothing, **existing snapshots preserved**, cron `.catch` logs. Never a partial/empty replace of a populated period.
- API with no snapshot for a (site, family, period) → `none` / "No data", never `0%` (acceptance criterion #6).
- Unmapped probe / unclassified device → excluded from KPI, listed in coverage. Never guessed.
- All numeric coercion tolerant (null on garbage) — a single bad row never zeroes a group.

## 7. Testing (CSV fixtures — buildable NOW)
- `tests/fixtures/opmanager/OPM_Inventory.csv` + `Availability_History_of_Devices.csv` (the two real exports) + a small **synthesized** `OPS_OPM_Device_Availability_Daily.csv` matching the §3 contract (multi-site, multi-family, a down week, an Unknown device, an unmapped probe).
- `tests/opm-classify.test.js` — every family + the Linux/Wireless precedence + Unknown/UPS → excluded, driven off the real Inventory rows.
- `tests/opm-availability.test.js` — duration/percent parsing; week + month bucketing; the SUM-durations formula + the AVG-fallback; null-not-zero on absent data; excluded/unmapped kept out of KPI but counted in coverage; `asOf`-anchored.
- `tests/opm-snapshots.test.js` — dual-backend upsert round-trip + idempotency (re-sync = no dup).
- `tests/opm-routes.smoke.test.js` — availability + coverage routes (auth gate, shape, no-data→none not 0).
- `tests/opm-sync.test.js` — `main` with injected `fetchView` (compose→upsert) + config-gated no-op + fetch-failure writes nothing.
- await-precedence guard auto-covers the new dual-backend readers.

## 8. Boundaries — NOT in V1a (by design)
- No change to `infra_kpis`, the weekly report, its email or PPTX (that is **V1b** — auto-fill + manual override + provenance columns).
- No WAN **quality** (Packet Loss / Response Time from Performance Details) — that is **V1c** (no Performance CSV on disk yet).
- No admin editor for the probe→site mapping or targets (seed + config PUT only in V1a; UI in V1b).
- No OPManager groups (V2).

## 9. Acceptance criteria (V1a subset of the brief)
1. For a site (e.g. Mana, meetings code `MGO`), `GET …/availability?site=MGO&period=week` returns LAN / WiFi / WAN / Servers availability rows (and `period=month` the monthly).
2. Values derive from the Analytics view (OPManager-sourced), via `fetchView`.
3. Each row carries `source` + `collected_at` + `data_through` (+ `stale`).
4. `Unknown` devices are excluded from KPIs and listed in `…/coverage`; unmapped probes too.
5. Existing reports keep working — V1a touches none of the report code.
6. Analytics unavailability produces **"No data" / `none`, never `0%`**.
7. Tests run on fixtures based on `OPM_Inventory.csv` + `Availability_History_of_Devices.csv` + the synthesized daily contract fixture.
8. `status_color ∈ {green, orange, red, none}` (never `amber`).

## 10. Open items / risks
1. **Join key (Phase 1, blocking for LIVE data only, not for build/test):** Analytics must expose the same `Device Key` on Availability History + Inventory. OPS is buildable/testable against fixtures before this lands; it just can't show live numbers until the view exists.
2. **Tanda site code** to confirm for the probe seed (others are known).
3. **Availability denominator — confirm two modelling choices:** (a) `maintenance` + `on_hold` are excluded (planned/paused ≠ downtime); (b) **`unmonitored` is counted as unavailable** (a monitoring gap = down). Both follow the brief's stated formula, but `unmonitored` materially moves the % — confirm it should count as down rather than be excluded like maintenance. On-Hold/UnManaged devices surface in coverage regardless.
4. **Daily granularity assumption:** the sample is per-device-per-day; if the real view is a different granularity, `aggregate` buckets by whatever `Day` resolves to — but the contract asks for daily.
5. Whether the OPManager availability view is truly in workspace `106803000000002012` (the assets one) — the brief says so; confirm the view id at Phase-1 time.
