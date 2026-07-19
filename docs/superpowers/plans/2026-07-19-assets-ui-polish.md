# Assets module UI polish — filters on charts · chart-click CSV · Inventory finance columns — Plan

**Goal (3 user asks on the deployed unified Assets module):**
1. **Filters bite the Finance charts** — State/Product-Type/Manufacturer currently don't apply to the Finance tab (only Site does), because FIN_PANE passes only `{site}` to the finance/depreciation endpoints. Make Finance + Depreciation pass the full shared filter.
2. **Click a chart segment → a CSV-export popup** — mirror the existing `_openTicketDrillModal` pattern (index.html): clicking a chart slice opens a modal listing the underlying rows + an Export CSV button.
3. **Inventory table + Excel gain columns** — Acquisition Date · Purchase Cost (USD) · Current Book Value (USD) · TCO (USD) · User · Department.

**Architecture:** Mostly front-end (`public/assets.html`) + a small inventory-route USD conversion + `services/assetExcel.js` columns. Backend readers already support the filters (`_assetWhere`) and already return the finance/owner columns (`getEnrichedAssets` = `SELECT a.*`).

**Branch:** `feat/assets-ui-polish` (from `main`).

**Facts (verified):** `window.__assetFilters()` in `assets.html` returns `{site,state,product_type,manufacturer,q}` (all 5). Hygiene + Hardware panes already pass the full filter (`qs(f)`); **FIN_PANE uses `siteVal()` = site only** (lines ~1260/1262/1359/1393/1607). `/api/assets/inventory` → `getEnrichedAssets(q)` = `_ENRICHED_SELECT` (`SELECT a.*` incl. `purchase_cost, acquisition_date, current_book_value, total_cost_of_ownership, user_name, department` — money RAW XOF). `_assetUsdRate()` (server.js) resolves the XOF→USD rate. `services/money.js` `toUsd(rawXof,rate)`/`fmtUsd`. `services/assetExcel.js` `buildAssetWorkbook(assetRows, softwareRows)` builds the inventory Excel.

---

## Task 0: Inventory route USD fields + Excel columns (backend)

**Files:** Modify `server.js` (`/api/assets/inventory`), `services/assetExcel.js`; Test `tests/assets-export.test.js` (+ a small inventory-route assertion in the finance/routes smoke or a new one).

- [ ] **Step 1 — failing test.** (a) Extend `tests/assets-export.test.js`: `buildAssetWorkbook([{asset_id:'A1', site:'MANA', acquisition_date:'14 May 2025', purchase_cost_usd:1650, book_value_usd:500, tco_usd:1700, user_name:'x', department:'IT', ram_total_gb:16}], [])` → the Assets sheet header includes `Acquisition Date`, `User`, `Department`, `Purchase (USD)`, `Book value (USD)`, `TCO (USD)` (read back via `XLSX.read`). (b) In a routes smoke (copy the finance-routes harness or extend it), assert `GET /api/assets/inventory` rows carry `purchase_cost_usd` (a converted number, not the raw XOF string) + `acquisition_date` + `user_name` + `department`. Run → FAIL.
- [ ] **Step 2** FAIL. **Step 3 — implement:**
  - `server.js` `/api/assets/inventory`: after `getEnrichedAssets(q)`, read `rate = await _assetUsdRate()` and map each row adding `purchase_cost_usd = money.toUsd(row.purchase_cost, rate)`, `book_value_usd = money.toUsd(row.current_book_value, rate)`, `tco_usd = money.toUsd(row.total_cost_of_ownership, rate)`, plus echo the applied `rate`. Keep the raw fields too (harmless). (`acquisition_date`/`user_name`/`department` already present.) Return `{ rows, rate }` OR keep returning the array + a header — SIMPLEST: return the array with the added per-row `*_usd` fields, and expose the rate via a separate lightweight field on the response — do NOT break the existing shape the Inventory pane consumes; if it consumes a bare array, add the `*_usd` fields to each row and drop the rate (the page can label "USD" generically) OR wrap — READ how INV_PANE consumes `/inventory` first and preserve its contract.
  - `services/assetExcel.js` `buildAssetWorkbook`: add the columns to the Assets-sheet projection — `Acquisition Date` (acquisition_date), `User` (user_name), `Department` (department), `Purchase (USD)` (purchase_cost_usd), `Book value (USD)` (book_value_usd), `TCO (USD)` (tco_usd). **No `$` glyph mandate here** — this is a spreadsheet cell, a number is fine; but keep it a number/USD, NOT raw XOF. The export route must pass USD-converted rows (the route already builds them for the JSON — reuse the same conversion for the xlsx rows).
- [ ] **Step 4** PASS. **Step 5** `await-precedence` 5/5 + `node -e "new Function(...server.js...)"` + the finance/export tests green. **Step 6 — commit:** `feat(assets): inventory route USD money fields + Excel finance/owner columns`.

## Task 1: Finance-tab full-filter fix + Inventory table columns (front-end)

**Files:** Modify `public/assets.html`. Browser-verify.

- [ ] **Step 1 — filter fix.** In `FIN_PANE`, change the finance + depreciation fetches (and the finance Excel href) from `qs({site: siteVal()})` to `qs(window.__assetFilters())` (the FULL filter — site/state/product_type/manufacturer/q; the finance/depreciation readers apply all via `_assetWhere`). LEAVE the licences fetches on `{site}` + their own family/expiry controls, and software on its own manufacturer/q (product_type/state don't map to a software catalog). Confirm `refresh(f)` re-runs the finance+depreciation fetches on ANY shared-filter change.
- [ ] **Step 2 — Inventory columns.** In `INV_PANE`'s table render, add columns after the existing ones: **Acquisition Date** (`acquisition_date`, or `—`), **User** (`user_name`), **Department** (`department`), **Purchase (USD)** (`purchase_cost_usd` via a `usd()`-style formatter → `$` + thousands, `—` if null), **Book value (USD)** (`book_value_usd`), **TCO (USD)** (`tco_usd`). Update the table header row to match. The Export Excel button already points at `/export.xlsx` (Task 0 makes that carry the columns).
- [ ] **Step 3 — VERIFY IN BROWSER (mandatory).** `preview_start` sdp-dashboard, admin PG session, seed a few assets with acquisition_date/purchase_cost/current_book_value/tco/user_name/department + varied product_type/manufacturer, set `xof_usd_rate`, **restart**. Then:
  - **Finance tab**: set Product Type / Manufacturer → the **Fleet finance band + book-value chart re-fetch and narrow** (the bug is fixed — e.g. Manufacturer=Dell drops the fleet value/count). Site still works; State/Product-Type/Manufacturer now bite. (Licences/Software unaffected — note that's intended.)
  - **Inventory tab**: the 6 new columns render (Acquisition Date, User, Department, Purchase USD, Book value USD, TCO USD) with real values; Export Excel downloads a file whose Assets sheet has those columns.
  - Zero console errors. Screenshot/DOM-read.
- [ ] **Step 4 — commit:** `feat(assets): Finance charts honour all filters + Inventory finance/owner columns`.

## Task 2: Chart-click → CSV-export drill popup (front-end)

**Files:** Modify `public/assets.html`. Browser-verify.

- [ ] **Step 1 — a shared drill+CSV modal.** Add a small module-level helper `openAssetDrill({title, subtitle, columns, rows, filename})` to `assets.html`: renders a modal (reuse the page's modal/overlay CSS if present, else a simple fixed overlay) showing `rows` in a table + an **Export CSV** button that builds a UTF-8 CSV (BOM + CRLF, quote-escaped) of `rows` and triggers a download (`Blob` + `a.download=filename`). Mirror `index.html`'s `exportCSV` escaping. Esc/backdrop closes.
- [ ] **Step 2 — wire chart onClicks.** Add `onClick:(evt,els)=>{...}` to the Assets Chart.js charts so clicking a slice opens `openAssetDrill` with that slice's rows:
  - **Finance book-value-by-site** (bar): click a site → fetch `/api/assets/finance/summary` is per-site aggregate; instead fetch the per-asset rows for that site via `/api/assets/inventory?site=<clicked>&<current filters>` (which now carries the USD money) → modal of that site's assets with the finance columns → CSV.
  - **Hygiene charts** (completeness-by-site bar / freshness donut / state bar): click → the matching `/api/assets/hygiene/exceptions?kind=` (or filter by the clicked site/state) → modal + CSV.
  - **Hardware by-kind** chart: click a kind → `/api/assets/hardware/exceptions?kind=<clicked>` → modal + CSV.
  - **Licence family / expiry donuts** + **Software compliance donut**: click a slice → the matching `/exceptions?kind=` (map the slice label → kind) → modal + CSV.
  Keep it pragmatic: for a slice that maps cleanly to an existing `exceptions?kind=`, reuse that endpoint; for the by-site charts, use `/inventory?site=`. Every modal has the Export CSV button (that's the user's core ask).
- [ ] **Step 3 — VERIFY IN BROWSER (mandatory).** With the seeded data: click a bar/slice on each chart (finance book-value-by-site, a hygiene chart, the hardware chart, a licence donut, the software donut) → confirm a modal opens listing the rows and the **Export CSV** button downloads a correct CSV. Zero console errors. Screenshot.
- [ ] **Step 4 — commit:** `feat(assets): click a chart segment → drill modal with CSV export`.

## Task 3: Regression + CLAUDE.md + finish

- [ ] **Step 1 — regression** `node --test --test-force-exit tests/assets-*.test.js tests/await-precedence.test.js` → green.
- [ ] **Step 2 — CLAUDE.md** Current-State entry (2026-07-19): Finance tab now honours all shared filters (was site-only — FIN_PANE passed only `{site}`); Inventory table + Excel gained Acquisition Date/User/Department/Purchase-USD/Book-USD/TCO-USD (inventory route converts XOF→USD via the config rate); every Assets chart segment is clickable → a drill modal with CSV export (mirrors `_openTicketDrillModal`). Point at this plan.
- [ ] **Step 3 — commit**, then finish-a-development-branch.

---

## Done criteria
- [ ] Finance/Depreciation charts re-fetch + narrow on State/Product-Type/Manufacturer (not just Site); browser-verified.
- [ ] Inventory table + Excel show Acquisition Date/User/Department + Purchase/Book/TCO in USD; browser-verified.
- [ ] Every Assets chart segment opens a drill modal with a working Export CSV; browser-verified.
- [ ] Full assets suite green.
