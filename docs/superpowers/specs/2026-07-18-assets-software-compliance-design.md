# Asset Module — Sub-project C-2 (Software Licence Compliance) — Design

**Status:** approved to build (autonomous delivery, 2026-07-18).
**Depends on:** merged Assets A + B + C-v1 + Depreciation. Reuses the `assets-db.js`/`assets-sync.js`/`ASSETS_BACKEND` substrate + the Finance & Licences page.
**Branch:** `feat/assets-software-compliance`.

## 1. The reframe (why C-2 is small, not the 121k monster)
The Foundation deferred `software` + `software_installations` (121k rows) to C. **Live reconnaissance (2026-07-18) found the `software` catalog view already carries the aggregated compliance columns** — so the purchased-vs-installed answer needs the **catalog view alone (~9 830 rows, single fetch)**, NOT the 121k installations table. The 121k `software_installations` table is only needed for the "which machines run title X" drill-down, which stays **deferred to C-3**.

**Confirmed view id (recon):** `software` catalog = **`106803000000002070`** (Table). (Distinct from `002074` Software Licenses and `002075` Software Installations.)

## 2. Verified data facts (`Software.csv`, 9 830 rows, profiled 2026-07-18)
Columns: `Software ID` (BOM on the first header — `﻿Software ID`, strip it), `Software Name`, `Manufacturer`, `Licensed Installations`, `Installations` (detected installs), `Installations Allowed` (purchased/allowed count), `Available for Allocation`, `Allocated to Downgrades`, `Purchased`, `Allocated`, `Purchased CAL`, `Compliance Type`, `Software Category`, `Software Type`.

- **`Compliance Type`** (SDP's own verdict — the PRIMARY signal): `N/A` 9 780 · **`Under Licensed` 32** · **`Over Licensed` 14** · `Compliant` 4.
- **`Software Type`**: `UnIdentified` 9 779 · **`Managed` 50** · `Shareware` 1. Only the ~50 **Managed** titles are licence-metered; the rest are `N/A`/unmetered. **Managed is the actionable universe.**
- Raw `Installations` vs `Installations Allowed`: on this data the raw delta **agrees exactly** with `Compliance Type` (all 32 Under have installs>allowed, all 14 Over have installs<allowed, all 4 Compliant equal). The **9 780 unmetered rows carry the literal string `'N/A'`** in `Installations Allowed` (and the other count columns) — NOT empty. So any numeric compare MUST treat `'N/A'` as null (compute in JS via `toInt`, never `CAST` in SQL — `CAST('N/A' AS INTEGER)` 500s on pg / returns 0 on sqlite). **Trust `Compliance Type` as the verdict** (SDP factors CAL/downgrades — so an ORed raw comparison would falsely flag downgrade-covered titles); show the raw `installs_vs_allowed` counts as supporting detail only.
- **No cost column** on this view (cost lives on `software_licenses`, USD). C-2 compliance is **count-based, no money** — no currency question here.

## 3. Deliverables (all additive)

### 3a. Sync + schema
- New `software` table (all TEXT): `software_id` (pk), `software_name, manufacturer, licensed_installations, installations, installations_allowed, available_for_allocation, allocated_to_downgrades, purchased, allocated, purchased_cal, compliance_type, software_category, software_type`.
- Add to `assets-sync.js` `ASSET_VIEWS`: `{ name:'software', job:'assets_software', table:'software', viewId:'106803000000002070', pkCol:'software_id', columns:{...} }`. Single-fetch (9 830 rows ≪ fetchView's cap). Full-replace like the others. The C1 empty-fetch-wipe guard already protects it.
- Schema added to the shared `001_init.sql` CREATE (both backends) — a new CREATE TABLE, so no ALTER needed (only added columns to EXISTING tables need the JS-side ALTER; a brand-new table's CREATE IF NOT EXISTS suffices).

### 3b. Compliance readers (`assets-db.js`, dual-backend)
- `classifySoftwareCompliance(row)` — normalises `Compliance Type` to `under_licensed` / `over_licensed` / `compliant` / `not_metered` (N/A/empty). Pure.
- `getSoftwareComplianceSummary(filters)` → `{ total, managed, by_compliance:{under_licensed,over_licensed,compliant,not_metered}, by_manufacturer:[{manufacturer, managed, under, over}], installs_vs_allowed:{under,over,ok} }`. Managed = `software_type` case-insensitively 'managed'. Dual-backend (SELECT then shared JS classify/tally — the numbers are small).
- `getSoftwareComplianceExceptions(kind, filters)` → identity rows for one kind. **Kinds**: `under_licensed` (RISK worklist — `installations` > `installations_allowed` OR compliance_type='Under Licensed'), `over_licensed` (waste), `managed` (all metered titles). Rows: software_name, manufacturer, installations, installations_allowed, licensed_installations, compliance_type, software_category. Unknown kind throws.
- Whitelisted filters: `manufacturer`, `software_type`, `q` (name/manufacturer LIKE). Parameter-bound.

### 3c. Routes (`server.js`, `requireReportSession`)
- `GET /api/assets/software/summary`, `GET /api/assets/software/exceptions?kind=` (unknown kind pre-validated → 400), `GET /api/assets/software/export.xlsx?kind=all|<kind>`. Mirror the licence routes exactly (kind pre-validate before try/catch, `tableExcel.buildWorkbook`, whitelisted filters).

### 3d. Page (`public/assets-finance.html`, additive section)
- A **Software compliance** section on the existing Finance & Licences page: tiles (Under Licensed = RISK red · Over Licensed = amber · Compliant = green · Managed total), a by-manufacturer mini-table, a compliance donut (Chart.js), a per-kind drill table + Excel. **The Under-Licensed list is the headline** (audit/legal exposure). No money. Manufacturer filter reuses the page's filter pattern.

### 3e. Digest enrichment (optional, additive)
- The hygiene digest's Licence snapshot gains a one-line **software compliance** figure (Under Licensed count) when `opts.software` is passed — backward-compatible. Low effort; keep it a single line.

## 4. What C-2 does NOT do
- **No `software_installations` (121k) sync / no "which machines" drill-down** — deferred to C-3 (needs a dedicated long-timeout fetch; the catalog aggregates suffice for compliance).
- **No cost/spend** on software compliance (no cost column on the view; licence USD cost is already on the C-v1 licences surface).
- No per-site software breakdown (the catalog view is fleet-wide; a per-site view `Software Per Site` 002148/001256265 exists but is a separate Pivot/QueryTable — deferred).

## 5. Risks
- **R1 — the `'N/A'` sentinel + the temptation to OR the raw comparison.** The count columns hold literal `'N/A'` on 9 780 rows → any SQL `CAST` throws on pg / mis-buckets on sqlite; **do all classification in JS with a `toInt`→null helper (no SQL CAST)**. And the `under_licensed` verdict is `Compliance Type` ONLY — do NOT OR the raw `installations>allowed` (on this data it agrees exactly, and SDP's verdict already accounts for CAL/downgrades, so an OR would falsely flag downgrade-covered titles). Raw `installs_vs_allowed` counts are supporting detail only.
- **R2 — BOM on `﻿Software ID`.** Same trap as Assets.csv — the integration test asserts 9 830 rows land (proves the strip). The BOM strip lives in the **CSV-parse layer** (the test harness parser; prod `fetchView`), NOT `DEFAULT_MAP` — don't "fix" DEFAULT_MAP. Prod coverage holds by the same `fetchView` precedent that lands 2 473 Assets.
- **R3 — view id wrong → wrong data.** Mitigated: recon-confirmed `002070` = the "Software" Table view whose columns match the profiled CSV exactly.
