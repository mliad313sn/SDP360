# Infra WAN Availability & Quality + Site-Report Auto-Fill — Design (V1b)

> **Status:** design, awaiting user review.
> **Supersedes the acquisition assumption of** `docs/superpowers/specs/2026-08-13-opmanager-infra-v1a-design.md`
> (V1a assumed a prepared Analytics daily view; discovery below proved that is neither
> the right nor the available source). V1a's downstream pipeline (classification, snapshot
> table, read API, governance) is reused where it fits.

---

## 1. Goal

Two linked deliverables:

1. **A WAN Availability & Quality module** — periodically capture, per site and per **link**
   (wan1/wan2), the **availability %** and **quality** (packet loss, latency, jitter) over a
   **week** and a **month**, **persist** them as weekly/monthly snapshots, and show trends.
   The persistence is the point: **Meraki keeps only ~60 days of link data**, so OPS archives
   the vendor's own numbers before they age out. This is read-only reporting/archival, **not**
   parallel supervision.

2. **Site-report auto-fill (V1b proper)** — when a coordinator opens a weekly report, the
   Infrastructure KPIs *Current Value* cells that we can measure are pre-filled; the editor
   overrides any cell; nothing persists until Save; unconfigured → silent no-op.

---

## 2. Discovery findings (hard-won — these drive the whole design)

| Finding | Consequence |
|---|---|
| Meraki MX firewalls have **0 SNMP interfaces** in OpManager | The OpManager interface API (`getInterfaces` / `getIntfAtAGlanceReportDetails`) is a **dead end for WAN**. |
| OpManager exposes wan1/wan2 only via an **undocumented internal "WAN Link" widget** endpoint | Rejected — undocumented, upgrade-fragile, against the read-only principle. |
| **Meraki Dashboard API is the authoritative WAN source** (OpManager merely mirrors it) | WAN data comes **directly from Meraki**, documented + supported. |
| Meraki `getOrganizationDevicesUplinksLossAndLatency` is **5-min window only** | Useless for weekly/monthly — not the endpoint to use. |
| Meraki **`getDeviceLossAndLatencyHistory`** = **timespan ≤ 31 days**, resolution 1 h/1 j, per `uplink`, returns lossPercent + latencyMs + **jitter** + goodput | **THE synthesis source** — one call = a full week/month of quality per link. |
| Meraki `getOrganizationUplinksStatuses` = **current** per-uplink state (active/failed + IP/gateway/publicIP) | V1b current-state fill + link identity + a real "up now" signal. |
| No Meraki endpoint returns a ready-made **"% Time Up"** | We **derive** it from lossPercent intervals and **calibrate** against Meraki's Summary Report (Ity: 99.86 / 97.87). |
| `getDeviceLossAndLatencyHistory` requires a destination **`ip`** | Discover it via the org loss/latency endpoint (it reports the monitored `ip` per uplink). |
| **Site = device-name prefix** (MANA/ITY/HGO/Dakar), **not the probe** | Dakar rides the *Sabodala* probe — never key the site off `probeName`. |
| OpManager `getDeviceCompleteDetails` returns an **`availdata`** object with `Up`/`Down`/`Dependent Unavailable`/`Not Monitored`/`On Hold`/`Parent Down`/`On Maintenance` percentages | Device-grain availability for **LAN/WLAN/Servers** (switches/servers *do* have interfaces). Window is default/recent (see risks). |
| Report weeks are **Zoho Sunday-anchored** (`weeks.start_date` = Sunday; W32 = 2026-08-09) | The Meraki weekly window and any snapshot `period_start` MUST use the **same Zoho week** or the report never joins its snapshot. |

---

## 3. Decisions locked (with user)

- **Piste 2** for the report fill: auto-fill from the **latest stored weekly snapshot** (or current
  state); the coordinator confirms/overrides. No heavy real-time sampler required for the fill.
- **WAN** ← Meraki API (per-link availability + quality). **LAN/WLAN/Servers** ← OpManager REST
  device availability. Two acquisition sources, one downstream store + fill.
- **Persist weekly + monthly** WAN synthesis (archival justified by Meraki's ~60-day retention).
- Read-only everywhere; OPS never polls a device directly, never creates an alert, never replaces
  the NOC dashboard.
- **`unmonitored` counts as unavailable**; **absence = `none`, never `0`** (carried from V1a).

---

## 4. Architecture

```
                 ┌─────────────────────────── ACQUISITION (isolated, swappable) ───────────────────────────┐
Meraki cloud ──► services/merakiClient.js ──► tools/meraki/sync-wan.js  ──►  wan_link_snapshots (NEW table)
 (api.meraki.com)   (read-only REST)            (weekly+monthly collector,      site×uplink×period
                                                 derives %TimeUp + quality)
OpManager    ──► services/opmanagerClient.js ─► tools/opmanager/sync-availability.js (reworked)
 (abj-spm:8061)     (read-only REST)            device availdata → classify → aggregate
                                                                          │
                                                                          ▼
                                                             infra_metric_snapshots (V1a table,
                                                              LAN/WLAN/Servers device-grain)
                 └─────────────────────────────────────────────────────────────────────────────────────────┘
                                                                          │
   report editor opens a week  ─►  GET /api/reports/:id/infra-auto  ──────┤  reads BOTH stores, maps to the
     (reports.html prefill,                                               │  7 infra rows for that site+week
      empty cells only, override)                                        ▼
                                                             services/opmReportFill.js (pure map)

   Insights ▸ WAN Health  ─►  GET /api/analytics/wan/{trend,summary}  ─►  wan_link_snapshots (trends dashboard)
```

**Principle:** the acquisition layer is isolated (as V1a intended). The collectors normalize
into the two stores; everything downstream (fill, dashboard, read API) is source-agnostic.

---

## 5. Data model

### 5.1 New table `wan_link_snapshots` (the archive)

Composite PK, **no surrogate id** (avoids the sqlite-AUTOINCREMENT / pg-IDENTITY divergence,
same discipline as `infra_metric_snapshots`). Dual sqlite/pg via one shared CREATE + a pg
`db/postgres/reports/008_wan_link_snapshots.sql`.

```
site_id           INTEGER   NOT NULL
uplink            TEXT      NOT NULL          -- 'wan1' | 'wan2' | 'wan3' | 'cellular'
period_type       TEXT      NOT NULL          -- 'week' | 'month'
period_start      TEXT      NOT NULL          -- Zoho-week Sunday (week) / month-01 (month)
period_end        TEXT
availability_pct  REAL                        -- DERIVED % Time Up (null if not computable → 'none')
status_color      TEXT                        -- green|orange|red|none vs opm_targets.wan
loss_pct_avg      REAL
latency_ms_avg    REAL
jitter_ms_avg     REAL
goodput_avg       REAL
status_current    TEXT                        -- active|failed|... at capture time
uplink_label      TEXT                        -- Meraki 'Internet 1'/'Internet 2' if present
device_serial     TEXT
network_id        TEXT
data_through      TEXT                        -- latest sample ts in the window
collected_at      TEXT
source            TEXT                        -- 'meraki_api'
raw_json          TEXT
PRIMARY KEY (site_id, uplink, period_type, period_start)
```

`ON CONFLICT (site_id,uplink,period_type,period_start) DO UPDATE` upsert — identical SQL on both
backends (pgDb `?`→`$N`).

### 5.2 Reuse `infra_metric_snapshots` (V1a) for LAN/WLAN/Servers

Device-grain families keep V1a's table + readers (`upsertInfraSnapshots` / `getInfraSnapshots` —
`_snapWhere` already filters by `period_start`). **WAN is NOT written here** — its PK
`(site,period_type,period_start,kpi_family,metric_name)` cannot hold wan1+wan2 as two `wan` rows;
per-link WAN lives in `wan_link_snapshots`. One **additive** column `basis TEXT` (`'window'`|`'recent'`,
see §10) is added to `infra_metric_snapshots` (backend-branched ALTER — sqlite PRAGMA-guarded, pg
`ADD COLUMN IF NOT EXISTS`, never in the shared CREATE) so the fill can label recent-vs-window.

### 5.3 Site mapping

`site_module_codes` gains a `module='meraki'` row per site: the Meraki **network id** (or network
name) → `site_id`, resolved by **device-name prefix / network name** (never probe). Seeded like
V1a's `_OPM_PROBE_CODES`, resolved by site NAME (Ity→"Ity Gold Operations", Mana, Hounde, Dakar…).

---

## 6. Components

| File | Responsibility |
|---|---|
| `services/merakiClient.js` | Pure-ish read-only Meraki REST client. Header `X-Cisco-Meraki-API-Key`. Methods: `orgUplinkStatuses({networkIds})`, `orgUplinksLossLatency({serials})` (for `ip` discovery), `deviceLossLatencyHistory({serial,uplink,ip,t0,t1,resolution})`. Rate-limit aware (≤5 req/s, 429-backoff). Injectable `fetch` for tests. |
| `services/merakiWanQuality.js` | **Pure.** `deriveAvailability(timeSeries, window, {missing})` → `% Time Up` (see §7), + `avg(loss/latency/jitter/goodput)`. `statusColor(pct, target)` — **uses the report's own band** `≥target→green, ≥target×0.90→orange, else red, null→none` (NOT V1a's ±2 band). No I/O. |
| `tools/meraki/sync-wan.js` | Collector. Config-gated (`meraki_api_key`). For each mapped MX: discover uplinks + `ip` (org endpoints) → pull `deviceLossLatencyHistory` for the **current Zoho week** (t0=Sunday,t1=Saturday) and the **current month** → derive → upsert `wan_link_snapshots` (week+month). Best-effort (failure keeps prior snapshots). `require.main`-guarded. Pre-resolves a plain network→site_id map (await) before the pure derive. |
| `services/opmanagerClient.js` | Read-only OpManager REST client. `listDevices({rows})`, `getDeviceCompleteDetails({name})`. Self-signed TLS tolerated via `opmanager_tls_insecure`. Injectable `fetch`. |
| `tools/opmanager/sync-availability.js` (**reworked**) | Replace the Analytics `fetchView` acquisition with `opmanagerClient`: list devices → for each non-firewall device read `getDeviceCompleteDetails.availdata.Up` → classify family (`opmClassify` on OpManager `category`/`type`) → aggregate per site per family → upsert `infra_metric_snapshots`. Zoho-week + month buckets. WAN family **skipped here** (comes from Meraki). |
| `services/opmReportFill.js` | **Pure.** `serviceToFamily(name)` (normalized substring; wifi/wlan before wan; backup/radio→none) + `fillRows(seedRows, {wanByUplink, familyByName})` → per-row `{value, status_color, trend, stale, data_through, source}`; rows with no mapping left untouched. |
| `routes/wan.js` (or extend `routes/opmanager.js`) | `GET /api/analytics/wan/summary?site=&period=` + `/trend?site=&months=` (session-guarded) reading `wan_link_snapshots`; `POST /sync` (admin). |
| `GET /api/reports/:id/infra-auto` (server.js) | Resolve report → `site_id` + `start_date` (Zoho Sunday) → read `wan_link_snapshots(week, start_date)` + `infra_metric_snapshots(week, start_date)` (both readers filter by `period_start` — the PK/`_snapWhere` already support it) → `opmReportFill.fillRows` → `{week_label, rows:[…]}`. Best-effort (unconfigured/no snapshot → `{rows:[]}`, never 500). Editor-guarded. *(Two-segment path — `/api/reports/:id` matches one trailing segment and does NOT shadow it; register alongside the other `/:id/<word>` siblings.)* |
| `public/reports.html` | On opening an **editable** report, after `renderInfra()`, call `/infra-auto`; for each row whose Current Value is **empty** and whose service maps, set value + **status_color + trend from the snapshot** (NOT `autoInfraStatusTrend` — so the cell colour agrees with the WAN dashboard; both use the §6 band). Banner "⚡ N values auto-filled — override any cell" + per-cell "Auto · data through YYYY-MM-DD · basis: window/recent · provisional?" tooltip. A "⚡ Fill from OPManager/Meraki" button re-runs it. |
| `public/wan-health.html` | Insights ▸ WAN Health — per-site availability + quality trends (weekly/monthly) from `wan_link_snapshots`. Pattern = Assets effort-trend. |
| `db/postgres/reports/008_wan_link_snapshots.sql` | pg CREATE (composite PK, `DOUBLE PRECISION`). |

---

## 7. The % Time Up derivation (the crux)

`getDeviceLossAndLatencyHistory` returns loss/latency samples to **one monitored destination `ip`**,
**not** uptime. Deriving uptime is genuinely uncertain and must be **calibrated, not assumed**:

- Query the exact window (Zoho week = Sunday→Saturday; or the month) at **hourly resolution**
  (`resolution=3600`) per uplink. Discover the destination `ip`(s) via the org loss/latency
  endpoint; if an uplink monitors **multiple destinations**, a link is "down" for an interval only
  if **all** its destinations are down (a single destination unreachable ≠ link down — Google
  outage, blocked host).
- **Down signal = `lossPercent == 100` across the interval.** A **missing interval** is
  **ambiguous** — it can mean the link was down (Meraki drops samples) OR an API/collection gap.
  The pure `deriveAvailability(series, window, {missing})` is **parameterized** on how to treat a
  missing interval — `'down'` or `'unknown'` (excluded from the denominator). **Which one is
  correct is LOCKED BY CALIBRATION, not chosen up front.**
- `availability_pct = 100 × up_intervals / counted_intervals`. Rounded to 2 dp.
- If the whole window has **no counted intervals** → `availability_pct = null` → status `none`
  (never 0).

**Calibration is a HARD GATE — V1b-A is not "done" until it passes:**
1. Run against **ITY-F/W-01** and reconcile the derived % to Meraki's Summary Report (99.86 / 97.87)
   **within a small tolerance**; whichever `missing` policy reconciles is the one we ship.
   Control for **timezone** — `getWeekRange` is **UTC** while Meraki's org/report may use a local
   tz; align the window or the numbers won't match.
2. Run against **MANA-F/W-02/03** ("Critical" — a real down case) and confirm a low %.
3. **Cross-check every derived interval against `getOrganizationUplinksStatuses`** (the real
   active/failed signal the collector already fetches) so a destination-only outage isn't scored
   as a link outage.

Until the gate passes, the collector may store `availability_pct` but the fill/dashboard must
**label it provisional**. `deriveAvailability` is a **pure function unit-tested with fixtures**
(all-up, all-down, partial-loss, missing→down, missing→unknown, empty→null).

---

## 8. Config keys (all in `reportConfig.DEFAULTS`)

| Key | Secret? | Default | Purpose |
|---|---|---|---|
| `meraki_api_key` | **yes** (redact/blank-keep/super_admin, like `smtp_pass`) | `''` | Meraki Dashboard API key |
| `meraki_org_id` | no | `''` | Meraki organization id |
| `meraki_base_url` | no | `https://api.meraki.com/api/v1` | override for regional shards |
| `opmanager_base_url` | no | `''` | e.g. `https://abj-spm-000:8061` |
| `opmanager_api_key` | **yes** | `''` | OpManager REST API key |
| `opmanager_tls_insecure` | no | `'1'` | tolerate the self-signed cert |
| `opm_targets`, `opm_stale_days` | no | (V1a) | reused |

**Everything config-gated:** no `meraki_api_key` → the WAN collector self-skips and `/infra-auto`
serves no WAN rows; no `opmanager_*` → LAN/WLAN/Servers empty; both unset → the report behaves
exactly as today.

**The two secrets must be wired at all THREE concrete touch-points** (miss one → leak or wipe-on-save):
1. **GET redact** — add `meraki_api_key` + `opmanager_api_key` to the blank-on-GET list (`server.js`
   ~5121, beside `smtp_pass`/`entra_client_secret`/`meridian_*_key`).
2. **Blank-keep on save** — add both to the blank-kept filter (`services/reportConfig.js` ~106).
3. **super_admin PUT gate** — add both to a secret-keys gate (new `INFRA_SECRET_KEYS` array or extend
   the existing `MERIDIAN_KEYS`-style check, `server.js` ~5140) → non-super_admin PUT = 403.
Both keys (and all non-secret keys above) MUST also be in `reportConfig.DEFAULTS` or `setConfig`
silently drops them.

---

## 9. Scheduling

- Nightly cron (staggered after V1a's 05:10, e.g. **05:20**): `sync-wan.js` captures the **current
  Zoho week** (rolling, refreshed each night as the week fills) + the **current month**, upserts
  week+month snapshots. The completed week's snapshot naturally freezes once the week ends.
- The reworked OpManager availability sync keeps its **05:10** slot.
- Both best-effort + config-gated. `POST …/sync` for on-demand.
- **No past-week backfill** (§9 captures only the current rolling window): a week during which the
  collector never ran leaves no snapshot → that report week gets a silent no-op fill (behaves as
  today). Acceptable; stated so it isn't read as a bug. On-demand `POST …/sync` can capture a still-
  in-retention week if run before Meraki purges (~60 d).
- `wan_link_snapshots` also stores `cellular`/`wan3`/`wan4` uplinks when present — **dashboard-only**;
  the report surfaces only `wan1`/`wan2`.

---

## 10. Report auto-fill (V1b) semantics

- **Override = stateless, no schema.** Auto-fill only ever writes **empty** Current Value cells;
  a typed/saved value is never clobbered; clear + reopen re-fills. No "was auto-filled" flag.
- **Week anchoring resolved:** the collector stores WAN snapshots keyed to the **Zoho week**
  (`period_start == weeks.start_date`), so `/infra-auto` joins by `report.start_date` directly.
- **Row mapping:** WAN1→`wan1`, WAN2→`wan2`, LAN→lan, WLAN→wifi, Servers→servers; **Backup + Radio
  stay manual** (no source). Value = availability_pct + '%'; **colour + trend come from the snapshot**
  (single canonical band, §6) so the report cell and WAN dashboard never show different colours for
  the same number.
- **LAN/WLAN/Servers basis honesty:** because OpManager `availdata` may be a *recent/default* window
  rather than the exact Sun–Sat week, each `infra_metric_snapshots` row carries a **`basis`**
  (`'window'` if the source truly covers the period, `'recent'` otherwise) that the fill tooltip and
  the dashboard **display** — never present a recent number as "the week's" silently. If the build
  confirms `availdata` is today-only and no windowed device-availability source exists, LAN/WLAN/
  Servers auto-fill is labelled "recent availability" (still better than blank; coordinator overrides).
- **Does NOT touch the scored path:** prefill is client-side on the editor's draft; once saved they
  are ordinary `infra_kpis` rows. PPTX / email / site-score read `infra_kpis` unchanged → **no
  golden changes, no score-logic change.** Only server addition is one READ endpoint.

---

## 11. Testing strategy

- **Pure units:** `merakiWanQuality.deriveAvailability` (up/down/partial/missing/empty),
  `opmReportFill` (mapping incl. wlan-vs-wan, backup/radio untouched, empty-snapshot→no fill),
  `merakiClient`/`opmanagerClient` request shaping (injected `fetch`, no network).
- **Dual-backend readers:** `wan_link_snapshots` upsert/read (await-precedence auto-covers the
  dispatchers) + pg `008` applies on boot.
- **Route smokes:** `/infra-auto` (report→week-keyed snapshot→rows; unconfigured→empty; unknown
  report→empty not 500), `/api/analytics/wan/*` (auth-gated; empty degrade).
- **Collector:** `sync-wan.js main()` fully injected (fetch + rdb), config-gated skip, week/month
  compose, best-effort failure.
- **Regression:** weekly-report goldens **unchanged** (V1b touches no PPTX/email); await-precedence.
- **Calibration (manual, user-run with the key):** derived % vs Meraki Summary on Ity + a Mana down case.

---

## 12. Security & principles

Read-only. Meraki = a cloud read of the vendor's own computed data (not device polling); OpManager
= a REST read. No alerts, no writes, no NOC replacement. Secrets handled like `smtp_pass`.
Archival of weekly/monthly synthesis is justified by Meraki's ~60-day retention — OPS is the
long-term book of record, not a second monitor.

---

## 13. Decomposition & sequencing (sub-projects, each independently shippable)

1. **V1b-A — Meraki WAN store + collector** (foundation): `merakiClient` + config (all 3 secret
   touch-points) + `wan_link_snapshots` (+pg 008) + **the `module='meraki'` network→site seed**
   (in scope here — the collector needs it or snapshots have no `site_id`) + `merakiWanQuality`
   (pure derive) + `sync-wan.js` (week+month) + tests. **Calibration gate (§7) must pass before A ships.**
2. **V1b-B — OpManager device availability**: `opmanagerClient` + rework `sync-availability.js`
   (Analytics→REST) → `infra_metric_snapshots` for LAN/WLAN/Servers, **including re-pointing the
   live `/api/analytics/opmanager/coverage` governance route off `fetchView`/Analytics onto the REST
   device list** (else coverage goes stale) + **confirming the REST `type`/`category` strings match
   `opmClassify`'s rule table** (validated against Analytics CSV, not REST) + the `basis` column.
   (Parallelizable with A.)
3. **V1b-C — Report auto-fill**: `opmReportFill` + `/api/reports/:id/infra-auto` + `reports.html`
   prefill/override. (Reads A + B.)
4. **V1b-D — WAN Health dashboard**: `/api/analytics/wan/*` + `wan-health.html` + nav. (Reads A.)

Each sub-project gets its own plan → TDD → finish.

---

## 14. Risks / open items

- **OpManager `availdata` window** may be default/today, not a configurable period — **resolved** by
  the `basis` column + labelling (§5.2/§10): a recent figure is stored as `basis='recent'` and shown
  as "recent availability", never silently presented as the week's. Confirm the actual window at build.
- **% Time Up derivation** is **not trusted until the §7 calibration gate passes** (Ity reconciliation,
  Mana down-case, status cross-check, timezone control). The `missing`-interval policy is chosen by
  that gate, not assumed. This is a hard dependency inside V1b-A, not a post-hoc check.
- **`ip` discovery** for `deviceLossLatencyHistory` — via the org loss/latency endpoint; if an uplink
  reports multiple destinations, aggregate across them.
- **Meraki rate limit** (5 req/s per org) — fleet is small (~8 MX × 2 uplinks); sequential with backoff.
- **Network→site seed** must be created (like V1a's probe seed) or WAN snapshots have no `site_id`.
- **V1a's Analytics `fetchView` path** becomes unused for OPManager availability; keep it dormant
  (no deletion needed) — the acquisition layer was designed swappable.

---

## 15. Out of scope

Real-time alerting; writing to Meraki/OpManager; per-client usage stats; the undocumented OpManager
Meraki widget endpoint; a 15-min high-frequency sampler (the ≤31-day history call makes it
unnecessary); changing the site score or any PPTX/email golden.
