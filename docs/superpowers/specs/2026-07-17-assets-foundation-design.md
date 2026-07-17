# Asset & Software Module — Sub-project A (Foundation) — Design

**Date:** 2026-07-17
**Status:** Design — awaiting spec review + user approval
**Author:** brainstorming session

---

## 1. Why this module exists

ManageEngine ServiceDesk Plus discovers ~2 473 IT assets across the fleet
(laptops, desktops, access points) plus their components and installed software.
Today that data lives only in Analytics Plus and is exported by hand to CSV. The
dashboard has no asset visibility at all.

Three audiences want reporting on it:

- **Group IT — CMDB hygiene (the core).** How complete and trustworthy is the
  asset register? What's discovered-but-not-enrolled, never-scanned, missing
  cost / age / owner?
- **Finance / legal — software licence compliance.** Expired mining licences,
  under-licensed software, the inventory.
- **Site coordinators — hardware refresh.** Under-spec machines (low RAM, full
  disks), under-equipped desks (no second monitor).

## 2. Scope decisions (locked with the user)

**The whole module is too big for one spec.** It is decomposed into four
sub-projects, each with its own spec → plan → implementation cycle, each
independently deployable:

| # | Sub-project | Audience | Delivers |
|---|---|---|---|
| **A** | **Foundation** (this doc) | — (substrate) | schema · sync · join · Inventory page · Excel |
| B | Hygiene CMDB | Group IT (core) | exception reports (Discovered / no-cost / no-age / no-owner / never-scanned / ghost) + **scheduled email delivery** + dashboard |
| C | Licence compliance | Finance / legal | expired + under-licensed + inventory |
| D | Hardware refresh | Coordinators | RAM<8GB · full disks · monitor count |

**Order:** A first (everything depends on it), then B (the core), then C and D.

**This spec covers ONLY sub-project A.** B/C/D are described here only enough to
prove A prepares the ground for them without doing their work.

### Decisions taken during brainstorming

- **Storage:** a dedicated `assets.db` module, **PostgreSQL-ready from day one**
  via `services/pgDb.js` + an `ASSETS_BACKEND=sqlite|postgres` flag. Not folded
  into `reports.db` (already 348 KB of code and PG in prod — every new reader
  would need a dual-backend fork). Not sqlite-only (it would be the only non-PG
  module on an all-PG prod).
- **Tables in v1:** the **8 value-bearing** ones. The empty / noise tables
  (Mobile_Devices=0 rows, Keyboard/Mouse serial=0 %, Physical_Drives
  manufacturer=0 %, Printer_Info=virtual-printer noise, Hard_Disks=deferred) are
  excluded. The sync is config-driven, so adding one later is one config entry.
- **Scope of A:** backend + **one visible page** (filterable enriched-asset
  inventory + Excel export). Not backend-only — a page that shows the real
  synced assets is the only end-to-end proof the sync works (this codebase has
  been bitten twice by syncs that reported success while writing nothing).
- **Scheduled exception reports** (Discovered / no-cost / no-age …) live in
  **sub-project B**, reusing the existing send infra (`reportSchedule.js`,
  `mailer.js`, `reportSentLog.js`, `tableExcel.js`). A only exposes the fields B
  will filter on.

## 3. Verified facts about the data

Profiled from the 14 CSV exports the user provided (`~/Downloads/Assets/`).

**The join is the spine of the model — verified 100 %.** The 4 component tables
carry `Workstation ID`, which **is** `assets.Asset ID`:

```
Memory_Modules        2148/2149 distinct WID match Asset ID (100%)
Software_Installations 2160/2161 match (100%)
Network_Adapters       2374/2375 match (100%)
Monitors               2155/2156 match (100%)
```
(The one non-match per table is a stale component whose parent asset dropped —
a LEFT join keeps it visible as an orphan, never crashes.)

**Fill rates that shape the schema** (Assets table, 2 473 rows):

| Field | Fill | Consequence |
|---|---|---|
| Asset ID, Name, Product, Product Type, State, Site, Site ID | 100 % | keep |
| Manufacturer | 91 % · Serial | 64 % · Barcode | 70 % | keep |
| Last Successful Audit Time, Last Audit Status, Scan Source | 73–96 % | keep — scan freshness is a real signal |
| **Purchase Cost / Acquisition Date / Warranty** | **9 %** | keep (B filters on their ABSENCE) |
| **User / User email / Department** | **0.08 %** | keep column, but the CMDB has effectively no ownership |
| Location, Product Description, Expiry Date, Part No., Loan\*, Acknowledgement\* | 0 % | **drop** |

**State distribution** (why "In Store" is not deployment): `In Store 2245 ·
Discovered 156 · In Purchase 65 · In Preparation 3 · In Use 2 · Loan 1 ·
Disposed 1`. Only **2 assets** are "In Use" — this is a discovery dump, not an
owned register.

**Scan freshness** (a signal that IS populated): 677 never successfully scanned;
103 not scanned in 90+ days (ghost candidates); 1 080 within 7 days.

### Two traps recorded so the reviewer and the plan don't rediscover them

1. **The `$` label is a currency lie.** `Assets.Purchase Cost($)` holds **XOF**
   (an HP EliteBook 840 G10 at 1 250 000). `Software_Licenses.Cost($)` appears
   to hold **real USD** (Leapfrog Geo at 55 920 is plausible in USD, absurd in
   XOF). Same `$` label, two currencies. **The Foundation stores the raw number
   and displays NO money.** Currency is resolved in B/C, where money is shown.

2. **`Monitors` has no own key.** Its identity is `(Workstation ID, Monitor ID)`
   where Monitor ID is 1/2 (the monitor index on the workstation, not a global
   id). PK is composite. `Integrated Monitor` distinguishes a laptop's built-in
   panel from external monitors → external-screen count per workstation is
   derivable (a refresh + hygiene signal).

## 4. Architecture & files

A self-contained module, mirroring the `tracker`/`meetings`/`inspection`
pattern but PostgreSQL-native from the start.

```
assets-db.js               schema + readers + PG forks   (ASSETS_BACKEND flag)
assets-sync.js             the config-driven engine; receives _fetchView via init()
db/postgres/assets/001_init.sql   PG schema of the 8 tables
tools/pg/copy-assets.js    one-shot sqlite→PG copy (recipe identical to other modules)
public/assets.html         Inventory page (filterable list + Excel export)
tests/assets-sync.test.js
tests/assets-db.test.js
tests/assets-routes.smoke.test.js
```

**Reused verbatim, nothing new invented:**
- `fetchView(viewId, maxRows)` (server.js:710) — injected into `assets-sync` by
  `init()`, exactly as `zoho-sync.init(fetchView, VIEWS)` does (server.js:478).
- `services/pgDb.js` — the async PG adapter (the migration recipe).
- `sync_metadata` table + `markSyncSuccess`/`markSyncError` — one row per view,
  **with the `await` this codebase learned the hard way to never drop**
  (`tests/await-precedence.test.js` scans `assets-sync.js` from day one).
- `services/tableExcel.js` → `buildWorkbook(sheets)` for the export.
- the server.js hourly/daily `cron.schedule` block.

**`server.js` is touched in exactly four minimal places** (an existing module →
requires the user's approval at plan time, as always):
1. the 8 view IDs added to the `VIEWS` map,
2. `require('./assets-sync').init(fetchView, VIEWS)` + `require('./assets-db')`
   PG init at boot,
3. one `cron.schedule('30 4 * * *', …)` daily job,
4. the `/api/assets/*` route block + `POST /api/sync/trigger/assets`.

Config: `ASSETS_BACKEND` (default `sqlite`, prod `postgres`),
`ASSETS_VIEW_*` optional overrides for the 8 view IDs (defaults hardcoded from
the known workspace `106803000000002012`).

## 5. Schema (8 tables, `assets` the hub)

We store the value-bearing columns, not all 45. Types are the SQLite shapes;
`001_init.sql` mirrors them in PG (TEXT dates, NUMERIC costs kept as TEXT to
avoid the currency ambiguity leaking into a numeric type prematurely).

```
assets (asset_id PK)
  asset_name, product, product_type, manufacturer, state,
  serial_number, barcode, site, site_id,
  purchase_cost, acquisition_date, warranty_expiry,     -- raw strings; 9% filled
  user_name, department,                                -- ~0%; kept for B
  last_successful_audit_time, last_audit_status,
  days_since_scan, last_scan_source, created_time

asset_memory (memory_module_id PK)
  workstation_id → assets.asset_id, capacity_gb, socket_label, module_tag
asset_logical_drives (drive_id PK)
  workstation_id, drive_letter, capacity_gb, free_gb, free_pct, file_type
asset_monitors (workstation_id, monitor_id  COMPOSITE PK)
  monitor_type, manufacturer, serial_number
asset_network (network_id PK)
  workstation_id, ip_address, mac_address, nic, dhcp_server, gateway
software (software_id PK)
  software_name, manufacturer, category, compliance_type, installations
software_installations (software_info_id PK)
  workstation_id, software_id, version, installed_on, category
software_licenses (license_id PK)
  license_name, license_type, license_state, expiry_date, cost, site, vendor, software_id
```

Indexes: every component table on `workstation_id` (the join); `assets` on
`site`, `state`; `software_installations` on `software_id`;
`software_licenses` on `license_state`.

**Foreign keys are soft** (no enforced FK) — a component can legitimately
outlive/precede its parent asset in a discovery dump. The join is LEFT; orphans
are visible, never fatal.

### The substrate reader

`getEnrichedAsset(filters)` / `getEnrichedAssets(filters)` — `assets` LEFT
JOINed to its components, aggregated per workstation:

```
{ …asset fields…,
  ram_total_gb,          -- SUM(asset_memory.capacity_gb)
  disk_total_gb, disk_free_pct,  -- from the primary logical drive
  monitor_count, external_monitor_count,  -- COUNT(asset_monitors), minus Integrated
  primary_ip, primary_mac,
  software_count }        -- COUNT(software_installations)
```

This is the one brick B (hygiene filters) and D (refresh signals) consume. C
reads `software`/`software_licenses` directly.

## 6. The sync — `assets-sync.js`

**Config-driven** (one declarative array, one engine):

```js
const ASSET_VIEWS = [
  { name:'assets', job:'assets', viewId: VIEW.ASSETS, pk:'Asset ID',
    columns: { 'Asset ID':'asset_id', 'State':'state',
               'Purchase Cost($)':'purchase_cost', … },
    transform: null },
  { name:'software_licenses', job:'asset_licenses', viewId: VIEW.SW_LICENSES,
    pk:'License ID', columns:{…},
    transform: coerceLicence },   // the only non-trivial hook: dates + cost
  … 6 more
];
```

**Mechanism: full-replace per table, transactional** — dictated by the data, not
preference. These discovery views expose **no reliable modified-time signal**
(the scan regenerates rows), exactly the `change_cab` case in CLAUDE.md ("a
dataset with no modified-time signal can't be synced incrementally — full-upsert
it"). Per view:

1. `fetchView(viewId, maxRows)` → **all rows into memory first**. If the fetch
   throws, the table is **left untouched** (the frozen-sync lesson from
   2026-07-17: never let a failed fetch write emptiness).
2. transaction: `DELETE FROM <table>` then batched INSERT of the mapped rows.
3. `await markSyncSuccess(job, rowCount)` — **awaited**. A Promise written to the
   INTEGER row-count column throws (`[object Promise]`), and `assets-sync.js` is
   on the `await-precedence` scanner's list.

Full-replace over upsert-and-reconcile because the whole table is refetched
every run anyway — replace is simpler and cannot leave stale rows.

**Cadence: daily**, `cron.schedule('30 4 * * *', …)`. A discovery scan doesn't
run hourly, and 121 k software installations in an hourly full-replace is waste.
`POST /api/sync/trigger/assets[?view=<name>]` for a manual run.

**One `sync_metadata` job per view** (`assets`, `asset_memory`, … 8 rows) → per-
table status in `/api/sync/status`; a failure on one table doesn't stop the
others.

**Column mapping** is explicit per view (Zoho header → snake_case column). Rows
missing the PK are dropped (as the request sync drops rows missing Request ID).

## 7. API — `/api/assets/*`

All behind `requireReportSession` (session cookie + `x-report-token`), like every
other module route.

| Method · Path | Role | Purpose |
|---|---|---|
| `GET /api/assets/inventory?site=&state=&type=&mfr=&q=` | viewer+ | enriched assets, filtered — feeds the page |
| `GET /api/assets/lookups` | viewer+ | distinct sites / states / types / manufacturers for the filter dropdowns |
| `GET /api/assets/summary` | viewer+ | header counts (total, by state, sync freshness) |
| `GET /api/assets/export.xlsx?…` | viewer+ | the filtered view as a workbook |
| `POST /api/sync/trigger/assets` | admin+ | manual sync (reuses the existing trigger route shape) |

Every filter param is whitelisted before it reaches SQL (proven un-500-able on
path-traversal / SQLi-shaped input, the `it-review` route precedent).

## 8. The Inventory page — `public/assets.html`

One page, the `inspections.html`/`meetings.html` pattern (shell nav, session
cookie, filterable list). `_htmlCache`'d + `injectAssetVersion`'d like the others.

- **Header band:** total assets · a chip per State · sync freshness (from
  `sync_metadata`, so a stale sync is visible on the page, not just in logs).
- **Filters:** Site · State · Product Type · Manufacturer · text search.
- **Table:** the **enriched** asset — name, product, site, state, RAM total,
  disk (% free), screens, last scan. One row = one workstation, components
  aggregated by the join.
- **Excel export:** the current filtered view → `.xlsx` (`tableExcel`), two
  sheets (Assets + Installed Software). The export the user asked for, delivered
  in the Foundation.

**Nav:** an "Assets" entry under **Insights ▾** in `_shell.js`,
`roles:['any']`, reusing an existing `ICON_LIB` key (verified present — NOT
assumed; recall `ICON_LIB` is a curated subset of `brand/icons.js`).

**No money on this page** — inventory shows the fleet, not costs. The currency
trap is B/C's to resolve.

## 9. Tests

- **`assets-sync.test.js`** — the config-driven engine with a stubbed
  `fetchView`: full-replace replaces; a throwing fetch **leaves the table
  intact** (not emptied); the `coerceLicence` transform coerces dates + cost;
  `markSyncSuccess` is awaited (a Promise row-count would throw).
- **`assets-db.test.js`** — `getEnrichedAsset` joins correctly (asset + summed
  RAM + counted screens + primary drive); an orphan component (workstation_id
  with no asset) does not break the LEFT join; `external_monitor_count` excludes
  `Integrated Monitor`.
- **`assets-routes.smoke.test.js`** — routes respond; filters whitelisted (no
  500 on hostile input).
- **`await-precedence.test.js`** — `assets-sync.js` added to `CALLER_FILES`; the
  guard covers the new module from day one.
- **Integration against the real CSVs** — load the 8 provided exports into a
  throwaway PG (or sqlite), prove all 2 473 assets + the Workstation-ID join
  hold on the actual data, and that `getEnrichedAsset` produces sane RAM/disk/
  screen aggregates.

## 10. Risks & open questions

1. **`software_installations` is 121 097 rows — larger than any current sync**
   (requests fetches ~47 k at `maxRows 50000`). `fetchView` passes `maxRows` to
   the Zoho API, which **truncates** (no auto-paging), with a 120 s timeout above
   10 k rows. **Decision for the plan:** try a single `maxRows≈150000` fetch
   first; if the API truncates or times out, add `startRow`/`fromIndex` paging in
   `assets-sync` (fetch in 50 k pages, concat). The engine must detect truncation
   (returned rows == maxRows) and page rather than silently store a partial
   table. **This is the one place the "simple" path may not hold — flagged for
   the reviewer.**
2. **Currency.** Confirmed ambiguous (§3). A stores raw strings and shows no
   money; the decision (per-table currency, or a `currency` column) is deferred
   to B/C. Noted so it isn't rediscovered.
3. **`stripPiiColumns` runs inside `fetchView`** and drops any `/email/i` column
   → `Assets.User email` is stripped. It's 0 % filled, so v1 loses nothing; but
   if a future sub-project needs owner email, it needs a non-stripping fetch
   path. Out of scope for A.
4. **PG-first with no sqlite prod precedent for this module.** Every other module
   started sqlite and migrated. Doing PG from the start means the sqlite path
   exists only for tests/dev. Accepted — it's the point (no migration debt), and
   `pgDb.js` is proven across four modules.

## 11. Explicitly OUT of scope for A

- The exception reports themselves (Discovered / no-cost / no-age / no-owner /
  never-scanned / ghost) and their **scheduled email delivery** → **B**.
- Any hygiene/compliance/refresh **dashboard** with charts → B/C/D.
- Software licence compliance logic (expired, under-licensed) → **C**.
- Hardware refresh signals (RAM<8GB, full disks, monitor gaps) → **D**.
- Any **monetary** display or currency normalisation → B/C.
- The 5 excluded tables (Mobile_Devices, Keyboard, Mouse, Physical_Drives,
  Printer_Info) and Hard_Disks → later config entries when a report needs them.

## 12. Definition of done (sub-project A)

- `assets.db` with 8 tables; `001_init.sql` PG mirror; `ASSETS_BACKEND` selects
  the backend.
- `assets-sync.js` full-replaces all 8 views daily; a manual trigger works;
  every write is awaited; a failed fetch never empties a table.
- `getEnrichedAsset` joins the fleet by `Workstation ID = Asset ID`.
- `/api/assets/*` serves inventory / lookups / summary / export, filters
  whitelisted.
- `public/assets.html` renders the filterable enriched inventory + Excel export;
  reachable from Insights ▾; **verified in the browser against real synced data**
  (a page that shows real assets is the proof the sync isn't silently empty).
- Full test suite green, including the real-CSV integration test; `assets-sync.js`
  covered by the await-precedence guard.
- No monetary display anywhere in A.
