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
- **Tables in v1: FIVE** (revised from 8 → 7 → 5 as review + live reconnaissance
  narrowed it). All five are small (< 5 000 rows live), so they fetch in one call
  with no paging concern. The sync is config-driven, so adding one later is one
  config entry.

  | Table | Analytics-Plus view id (verified live 2026-07-17) | live rows |
  |---|---|---|
  | `assets` | `106803000000002058` | 2 475 |
  | `asset_memory` | `106803000000002066` | 4 995 |
  | `asset_logical_drives` | `106803000000002064` | 3 621 |
  | `asset_monitors` | `106803000000002067` | 3 373 |
  | `software_licenses` | `106803000000002074` | ~19 |

- **`software` + `software_installations` moved to sub-project C (user decision
  2026-07-17).** `software_installations` is **121 097 rows and does NOT fetch in
  one call** — the AP endpoint ignores `maxRows` and returned all **121 117** rows
  in **13.6 min**, far past `fetchView`'s 120 s timeout (server.js:711). It belongs with
  licence compliance (C) anyway, where it needs a dedicated fetch strategy
  (paging, or a nightly extended-timeout job). Removing it from the Foundation
  **eliminates the module's single largest risk** (former §10.1). `software` (the
  ~9 830-title compliance table) goes with it — and its real view id is still
  unknown (the id the user first gave, `002061`, is **Physical Drives**, confirmed
  by its columns). C resolves that id.
- **`Network_Adapters` dropped (spec-review finding #1).** Its two valuable
  columns — `IP Address`, `MAC Address` — both match `PII_BLOCKED_PATTERNS`'s
  `/\baddress\b/i` (server.js:69) and are deleted by `stripPiiColumns` **inside**
  `fetchView` (server.js:741). What survives serves none of the three audiences.
  Re-add via a dedicated non-stripping fetch the day a network need appears.
- **Excluded/noise tables** (Mobile_Devices=0 rows, Keyboard/Mouse serial=0 %,
  Physical_Drives, Printer_Info, Hard_Disks) stay out; each is one config entry
  when a report needs it.
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

**The join is the spine of the model — verified 100 %.** The component tables
carry `Workstation ID`, which **is** `assets.Asset ID`:

```
Memory_Modules        2148/2149 distinct WID match Asset ID (100%)
Software_Installations 2160/2161 match (100%)
Monitors               2155/2156 match (100%)
Logical_Drives         2156/2157 match (100%)
```
(The one non-match per table is a stale component whose parent asset dropped —
a LEFT join keeps it visible as an orphan, never crashes.)

**Fill rates that shape the schema** (Assets table, 2 473 rows):

| Field | Fill | Consequence |
|---|---|---|
| Asset ID, Name, Product, Product Type, State, Site, Site ID | 100 % | keep |
| Manufacturer | 91 % · Serial | 64 % · Barcode | 70 % | keep |
| Last Successful Audit Time, Last Audit Status, Scan Source | 73–96 % | keep — scan freshness is a real signal |
| **Acquisition Date / Warranty Expiry** | **9 %** (227) | keep (B filters on their ABSENCE — genuinely empty) |
| **Purchase Cost** | **100 % present** — 227 real, **2 246 as the string `0.00`** | keep. **NOT a 9 % field, and never NULL.** See below. |
| **User / User email / Department** | **0.08 %** | keep column, but the CMDB has effectively no ownership |
| Location, Product Description, Expiry Date, Part No., Loan\*, Acknowledgement\* | 0 % | **drop** |

**⚠ `Purchase Cost($)` is present-as-`0.00`, not empty (spec-review finding #3).**
The field is filled on 2 473/2 473 rows; 2 246 hold the literal string `0.00` and
only 227 carry a real amount. So B's "assets with no cost" report must filter
`purchase_cost IN ('0.00','0','')`, **NOT `IS NULL`** (which returns zero). A
stores the raw string (`0.00` survives), so it's recoverable — this note exists
so B's plan doesn't write the wrong predicate. Costs carry comma separators
(`1,250,000.00`); any later numeric parse strips commas first. (Acquisition Date
and Warranty ARE genuinely empty at 91 %, so `IS NULL`/`= ''` is correct for
those.)

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

2. **`Monitors` has no own key AND its `Monitor Type` is polluted with
   non-monitors (spec-review finding #2).** Identity is `(Workstation ID,
   Monitor ID)` where Monitor ID runs **1–6** (the device index, not a global
   id) → composite PK. Crucially, **`Integrated Monitor` is a VALUE of the
   `Monitor Type` column, not a column of its own**, and that column is polluted:
   `Intel(R) AVStream Camera` (124), `Integrated Webcam` (31), `HyperVMonitor`,
   `Parallels Vu`, `No Monitor`. So a raw `COUNT(asset_monitors)` overcounts
   screens (cameras included), and any "external monitor" split needs a
   camera/virtual denylist. **The Foundation stores the raw `monitor_type` and
   exposes only a raw `monitor_count`; the trustworthy external-screen count
   (with the denylist) is D's job, not A's.** A does not promise
   `external_monitor_count`.

## 4. Architecture & files

A self-contained module, mirroring the `tracker`/`meetings`/`inspection`
pattern but PostgreSQL-native from the start.

```
assets-db.js               schema + readers + PG forks   (ASSETS_BACKEND flag)
assets-sync.js             the config-driven engine; receives _fetchView via init()
db/postgres/assets/001_init.sql   PG schema of the 5 tables
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
  **with the `await` this codebase learned the hard way to never drop**. The
  guard needs TWO edits (spec-review finding #4): add `assets-sync.js` to
  `CALLER_FILES` (so its calls into reports-db are scanned) AND add
  `assets-db.js` to `DB_MODULES` (so `assets-db`'s OWN dual-backend readers —
  `getEnrichedAssets` etc. — are discovered as dispatchers, and any
  `(await reader()).map(...)` bug in a route is caught). `DB_MODULES` is a hardcoded list (no auto-walk), so a new dispatcher module
  must be added by name; `CALLER_FILES` likewise. Both edits are required.
  Note: `sync_metadata` lives in **reports.db**, so the 5 asset jobs are seeded
  there and surface via `/api/sync/status` — the same cross-module coupling
  every existing sync already has.
- `services/tableExcel.js` → `buildWorkbook(sheets)` for the export.
- the server.js hourly/daily `cron.schedule` block.

**`server.js` is touched in exactly four minimal places** (an existing module →
requires the user's approval at plan time, as always):
1. the 5 view IDs added to the `VIEWS` map,
2. `require('./assets-sync').init(fetchView, VIEWS)` + `require('./assets-db')`
   PG init at boot,
3. one `cron.schedule('30 4 * * *', …)` daily job,
4. the `/api/assets/*` route block + `POST /api/sync/trigger/assets`.

Config: `ASSETS_BACKEND` (default `sqlite`, prod `postgres`),
`ASSETS_VIEW_*` optional overrides for the 5 view IDs (defaults hardcoded from
the known workspace `106803000000002012`).

## 5. Schema (5 tables, `assets` the hub)

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
  monitor_type, manufacturer, serial_number   -- monitor_type raw (polluted; D denylists)
software_licenses (license_id PK)
  license_name, license_type, license_state, expiry_date, cost, site, vendor, software_id
```

Indexes: every component table on `workstation_id` (the join); `assets` on
`site`, `state`; `software_licenses` on `license_state`.

**5 tables:** `assets`, `asset_memory`, `asset_logical_drives`, `asset_monitors`,
`software_licenses`. (`software`+`software_installations`→C; `asset_network`
deferred — §2.)

**Foreign keys are soft** (no enforced FK) — a component can legitimately
outlive/precede its parent asset in a discovery dump. The join is LEFT; orphans
are visible, never fatal.

### The substrate reader

`getEnrichedAsset(filters)` / `getEnrichedAssets(filters)` — `assets` LEFT
JOINed to its components, aggregated per workstation:

```
{ …asset fields…,
  ram_total_gb,          -- SUM(asset_memory.capacity_gb)
  system_disk_gb, system_disk_free_pct,  -- the C: drive (WHERE drive_letter='C:')
  monitor_count }        -- raw COUNT(asset_monitors) — see below
```
(No `software_count` — `software_installations` is C's table, not A's.)

- **`system_disk_*` is the `C:` drive**, not "primary" (spec-review finding #7 —
  there is no primary flag; machines average ~1.7 logical drives). C: is the OS
  volume and the meaningful refresh signal; D refines if needed.
- **`monitor_count` is a RAW count** including the camera/virtual pollution
  (§3 trap 2). It is deliberately NOT called "screens" and A does not split
  external vs integrated — that needs D's denylist. The Inventory table labels
  it "Monitors (raw)" so no one reads it as a trustworthy screen count.
- **No `primary_ip` / `primary_mac`** — `asset_network` is deferred (§2).

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
  … 5 more
];
```

**Mechanism: full-replace per table, transactional** — dictated by the data, not
preference. These discovery views expose **no reliable modified-time signal**
(the scan regenerates rows), exactly the `change_cab` case in CLAUDE.md ("a
dataset with no modified-time signal can't be synced incrementally — full-upsert
it"). Per view:

1. `fetchAll(viewId)` → **all rows into memory first** (see the paging design
   below — this is NOT the shared `fetchAllViewRows`, which caps at 5 000). If the
   fetch throws, the table is **left untouched** (the frozen-sync lesson from
   2026-07-17: never let a failed fetch write emptiness).
2. transaction: `DELETE FROM <table>` then batched INSERT of the mapped rows.
3. `await markSyncSuccess(job, rowCount)` — **awaited** (its PG fork returns a
   Promise that must be awaited to surface write errors and keep ordering; an
   unawaited call is the frozen-sync bug that hit this repo on 2026-07-17).
   `assets-sync.js` is on the `await-precedence` scanner's list.

Full-replace over upsert-and-reconcile because the whole table is refetched
every run anyway — replace is simpler and cannot leave stale rows.

**No paging needed in A (the 121 k risk left with `software_installations`).**
All 5 Foundation views are < 5 000 rows live (largest: `asset_memory` at 4 995),
so each fetches in a single `fetchView(viewId, maxRows)` call. **Recon fact: the
AP `/data` endpoint IGNORES `maxRows`** — asked for 10 000 it returned all 121 117
`software_installations` rows. So the API never truncates; it returns the whole
view or **times out** (`software_installations` took 13.6 min, past `fetchView`'s
120 s cap — which is why it moved to C). `fetchAll` therefore has **no truncation
guard** (there's nothing to truncate) — only a data-gone-wrong sanity cap. The
real protection against a silent partial is `fetchView`'s timeout on an over-large
view (it throws) plus the sync engine's "table survives a failed fetch" order.

**Read consistency during sync (spec-review finding #6).** The 5 views are 5
independent `DELETE`+`INSERT` transactions (so one table's failure doesn't stop
the others). A page load *during* the 04:30 sync can see `assets` already
replaced while another table is mid-replace → transiently inconsistent aggregates
(wrong, not corrupt). Accepted for A: the daily off-hours cadence makes a
mid-sync page load rare, and the Inventory page's sync-freshness band shows the
last-completed time per table, so a stale/mid-run state is visible rather than
silently wrong. (With all 5 tables now small, each replace is sub-second, so the
window is tiny.)

**Cadence: daily**, `cron.schedule('30 4 * * *', …)`. A discovery scan doesn't
run hourly. `POST /api/sync/trigger/assets[?view=<name>]` for a manual run.

**One `sync_metadata` job per view** (`assets`, `asset_memory`, … 5 rows) → per-
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

**Nav:** an "Assets" entry under **Insights ▾** in `_shell.js`, `roles:['any']`.
**`ICON_LIB` has no hardware/asset icon** (its 11 keys are headset, file-text,
trending-up, gauge, line-chart, target, presentation, sliders, book-open,
clipboard-check, bar-chart-3 — spec-review finding #8). So the plan adds one key
to `ICON_LIB` from `brand/icons.js` (pick a box/server/monitor glyph that exists
there; verify it renders — recall `ICON_LIB` is a curated SUBSET, and a key
absent from it renders an empty span with no error). Do NOT reuse
`clipboard-check` (Inspections/Meetings) or `bar-chart-3` (reserved for the IT
Review link).

**No money on this page** — inventory shows the fleet, not costs. The currency
trap is B/C's to resolve.

## 9. Tests

- **`assets-sync.test.js`** — the config-driven engine with a stubbed
  `fetchView`: full-replace replaces; a throwing fetch **leaves the table
  intact** (not emptied); the `coerceLicence` transform coerces dates + cost;
  `markSyncSuccess` is awaited (a Promise row-count would throw).
- **`assets-db.test.js`** — `getEnrichedAsset` joins correctly (asset + summed
  RAM + **raw** `monitor_count` + the **C:** drive); an orphan component
  (workstation_id with no asset) does not break the LEFT join. It does **not**
  assert an external-vs-integrated split — that's D's denylist, not A's.
- **`assets-sync` paging test** — a stubbed `fetchView` returning full pages then
  a short page proves `fetchAll` concatenates and stops correctly; a stub that
  keeps returning full pages must not loop forever (a page cap); a stub that
  can't page must make `fetchAll` **throw**, not store a partial table.
- **`assets-routes.smoke.test.js`** — routes respond; filters whitelisted (no
  500 on hostile input).
- **`await-precedence.test.js`** — `assets-sync.js` added to `CALLER_FILES` **and
  `assets-db.js` added to `DB_MODULES`** (finding #4), so both the sync's calls
  and assets-db's own PG-forked readers are covered from day one.
- **Integration against the real CSVs** — load the **7** in-scope exports into a
  throwaway PG (or sqlite), prove all 2 473 assets + the Workstation-ID join hold
  on the actual data, that `no-cost` filters on `'0.00'` returns 2 246 (not 0),
  and that `getEnrichedAsset` produces sane RAM / C:-disk / raw-monitor
  aggregates.

## 10. Risks & open questions

1. **~~Paging (`software_installations`, 121 k)~~ — RESOLVED by moving it to C
   (2026-07-17).** Live reconnaissance confirmed a single fetch of the 121 k view
   runs > 7 min (past `fetchView`'s 120 s timeout), so it left A for C. All 5
   Foundation views are < 5 000 rows and fetch in one call. Recon also showed the
   AP endpoint **ignores `maxRows`** (returns the whole view or times out), so
   `fetchAll` has no truncation guard — just a data-gone-wrong sanity cap; the
   real silent-partial protection is `fetchView`'s timeout. **A has no paging risk.**
2. **Currency.** Confirmed ambiguous (§3 trap 1). A stores raw strings and shows
   no money; the decision (per-table currency, or a `currency` column) is
   deferred to B/C. Noted so it isn't rediscovered.
3. **`stripPiiColumns` strips more than email.** It runs inside `fetchView` and
   drops any column matching `/\baddress\b/i` or `/email/i` → `IP Address`,
   `MAC Address` (why `asset_network` is deferred, §2) and `Assets.User email`
   (0 % filled, no loss). Any future sub-project needing those fields needs a
   non-stripping fetch path decided at that time. Out of scope for A.
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
- The 6 excluded tables (Mobile_Devices, Keyboard, Mouse, Physical_Drives,
  Printer_Info, **Network_Adapters**) and Hard_Disks → later config entries when
  a report needs them (Network_Adapters also needs a non-stripping fetch, §2).
- The trustworthy external-vs-integrated **screen count** (needs a camera/virtual
  denylist over the polluted `Monitor Type`) → **D**. A stores raw + a raw count.

## 12. Definition of done (sub-project A)

- `assets.db` with 5 tables; `001_init.sql` PG mirror; `ASSETS_BACKEND` selects
  the backend.
- `assets-sync.js` full-replaces all 5 views daily; a manual trigger works;
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
