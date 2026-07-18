# Asset Sub-project C-2 (Software Licence Compliance) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Sync the SDP `software` catalog view and surface purchased-vs-installed licence compliance (Under/Over Licensed) on the Finance & Licences page — no 121k table, no money.

**Architecture:** Additive — one new synced `software` table (view `106803000000002070`, ~9 830 rows single-fetch), dual-backend compliance readers on `assets-db.js`, routes, a page section. Mirrors the C-v1 licence work.

**Tech Stack:** Node, better-sqlite3 + `services/pgDb.js`, Express, `node:test`, Chart.js (cdnjs 4.4.0), `services/tableExcel.js`.

**Spec:** `docs/superpowers/specs/2026-07-18-assets-software-compliance-design.md` — read §2 (data facts: trust `Compliance Type`, ~50 Managed titles) and §5 (risks).

**Branch:** `feat/assets-software-compliance` (created from `main`; `tests/fixtures/assets/Software.csv` already copied in).

---

## Ground rules
- `ASSETS_BACKEND=sqlite|postgres`, default sqlite; tests sqlite. New dual-backend readers dispatch `if (ASSETS_BACKEND==='postgres') return _fooPg(...)` first-statement; callers await (`tests/await-precedence.test.js` scans `assets-db.js`).
- **No money** anywhere in C-2 (count-based compliance). **Trust `Compliance Type`** as the verdict; raw Installations-vs-Allowed is supporting detail.
- Commit after every green step: `git commit --no-verify`. Tests: `node --test --test-force-exit tests/<file>.test.js`.

---

## Task 0: Schema + sync + integration test on the real CSV

**Files:** Modify `db/postgres/assets/001_init.sql`, `assets-sync.js`; Test extend `tests/assets-integration.test.js`.

- [ ] **Step 1 — failing test.** Extend `tests/assets-integration.test.js`. It loops `for (const def of ASSET_VIEWS) readCsvObjects(CSV_FOR[def.name])` over a hardcoded `CSV_FOR` map (~lines 59-65) — **you MUST add `software:'Software.csv'` to `CSV_FOR` (I4)**, else once `software` is in `ASSET_VIEWS` the loop does `readFileSync(path.join(FIX, undefined))` → throws for the WHOLE test file. Assert after load: `SELECT COUNT(*) FROM software` = **9830** (proves the BOM strip in the CSV-parse layer — see M2); the **`PIX4Dmapper`** title (Managed, Under Licensed, installations '24', installations_allowed '1' — NOT TeamViewer, which is UnIdentified/N/A per M1) has `compliance_type='Under Licensed'`; `SELECT COUNT(*) FROM software WHERE compliance_type='Under Licensed'` = **32**. Run → FAIL.
- [ ] **Step 2** FAIL. **Step 3 — implement:**
  - `001_init.sql`: `CREATE TABLE IF NOT EXISTS software ( software_id TEXT PRIMARY KEY, software_name TEXT, manufacturer TEXT, licensed_installations TEXT, installations TEXT, installations_allowed TEXT, available_for_allocation TEXT, allocated_to_downgrades TEXT, purchased TEXT, allocated TEXT, purchased_cal TEXT, compliance_type TEXT, software_category TEXT, software_type TEXT );` (a NEW table → CREATE IF NOT EXISTS suffices on BOTH backends; no ALTER needed).
  - `assets-sync.js` `ASSET_VIEWS`: add `{ name:'software', job:'assets_software', table:'software', viewId:'106803000000002070', pkCol:'software_id', columns:{ 'Software ID':'software_id', 'Software Name':'software_name', 'Manufacturer':'manufacturer', 'Licensed Installations':'licensed_installations', 'Installations':'installations', 'Installations Allowed':'installations_allowed', 'Available for Allocation':'available_for_allocation', 'Allocated to Downgrades':'allocated_to_downgrades', 'Purchased':'purchased', 'Allocated':'allocated', 'Purchased CAL':'purchased_cal', 'Compliance Type':'compliance_type', 'Software Category':'software_category', 'Software Type':'software_type' } }`. (DEFAULT_MAP strips the BOM already — confirm.)
  - **(I3 — REQUIRED, not conditional)** add `'software'` to `_ASSET_TABLES` (the `Set` at `assets-db.js:87` that guards `countRows`/`_assertTable`). The C1 empty-fetch wipe-guard in `syncAssetView` calls `await countRows('software')`; without registering the table, an empty software fetch throws `unknown table "software"` instead of the intended "refusing to wipe" guard — the data-loss protection is broken for this table.
  - **(I2 — REQUIRED)** add a `['software', [...the 14 columns...], ['software_id']]` entry to `tools/pg/copy-assets.js` `TABLES` (currently 5 entries). `tests/assets-integration.test.js` asserts `copy-assets.TABLES` tables === `ASSET_VIEWS` tables and that every copy column exists in schema + `_upsertSql` builds — adding `software` to `ASSET_VIEWS` WITHOUT this turns that assertion red.
- [ ] **Step 4** PASS (9830 + 32). **Step 5** — run the full assets suite (`tests/assets-*.test.js`) + `await-precedence` → green (new table; `assets-db-init` only asserts each table EXISTS, so `software` doesn't break it — the "5 tables" name just goes stale, optionally rename). **Step 6 — commit:** `feat(assets): sync software catalog view (002070) + schema`.

## Task 1: Compliance readers

**Files:** Modify `assets-db.js`; Test `tests/assets-software-readers.test.js`.

> **C1 — the count columns hold the literal string `'N/A'` (9 780 rows), NOT empty.** `CAST('N/A' AS INTEGER)` throws on pg (500) and returns 0 on sqlite (→ mass false positives). So **do ALL classification/comparison/tally in a shared JS pass — NO `CAST` in SQL at all** (exactly the `getLicenceSummary`/`_aggregateLicence` template at `assets-db.js:624-676`). Use a `toInt(v)` helper that returns `null` for any non-numeric incl. `'N/A'` (`const n = Number(String(v).replace(/,/g,'')); return Number.isFinite(n) ? n : null`).

- [ ] **Step 1 — failing test.** Seed `software` rows via `replaceTable('software',cols,rows)`: a Managed under-licensed (`software_type='Managed'`, `compliance_type='Under Licensed'`, installations '540', installations_allowed '1'), a Managed over-licensed (`Over Licensed`, inst '2' allowed '50'), a Managed compliant, and **(C1 sentinel row)** an unmetered (`software_type='UnIdentified'`, `compliance_type='N/A'`, `installations_allowed='N/A'`, `installations='500'`), across 2 manufacturers. Assert:
  - `classifySoftwareCompliance({compliance_type:'Under Licensed'})==='under_licensed'`, `'Over Licensed'→'over_licensed'`, `'Compliant'→'compliant'`, `'N/A'→'not_metered'`, `''→'not_metered'` (case-insensitive).
  - `getSoftwareComplianceSummary({}).by_compliance` counts per class; `.managed` = count of `software_type` case-insensitively 'managed'; `.by_manufacturer` per-mfr managed/under/over; `.installs_vs_allowed` = raw {under,over,ok} where **`under = installations > allowed`, `over = installations < allowed`, and unmetered (`allowed`→null via toInt) rows are in NONE (M3)**.
  - **(C1)** the sentinel row (`installations_allowed='N/A'`, `installations='500'`) is NOT in `getSoftwareComplianceExceptions('under_licensed',{})` and is in NEITHER `installs_vs_allowed.under/over/ok`.
  - `getSoftwareComplianceExceptions('under_licensed',{})` = the Under-Licensed rows **by `Compliance Type` only** (assert software_name); `'over_licensed'` the Over ones; `'managed'` all Managed; `'bad'` **throws**. Rows carry no cost. Manufacturer filter narrows.
- [ ] **Step 2** FAIL. **Step 3 — implement**: pure `classifySoftwareCompliance(row)` (lower-case `compliance_type` → under/over/compliant/not_metered; N/A/empty/unknown → not_metered). `getSoftwareComplianceSummary(filters)` + `getSoftwareComplianceExceptions(kind, filters)` dual-backend (dispatch first-statement; SELECT the text rows via a small whitelisted `_softwareWhere(filters)` on `manufacturer/software_type/q`, then **shared JS classify/tally with `toInt`** — no SQL CAST). **(I1) `under_licensed` exceptions = `classifySoftwareCompliance(row)==='under_licensed'` ONLY** — do NOT OR the raw `installations>allowed` in. On the real data the raw delta AGREES with `Compliance Type` (32/14/4), and SDP's verdict already accounts for CAL/downgrades — ORing the naive comparison would falsely flag downgrade-covered titles the spec tells you to trust as Compliant. Keep the raw `installs_vs_allowed` counts as supporting detail in the summary only. `SOFTWARE_KINDS` map (throw on unknown). Export `classifySoftwareCompliance, getSoftwareComplianceSummary, getSoftwareComplianceExceptions, SOFTWARE_KINDS`.
- [ ] **Step 4** PASS. **Step 5** `await-precedence` 5/5. **Step 6 — commit:** `feat(assets): software compliance readers (under/over-licensed, by manufacturer)`.

## Task 2: Routes

**Files:** Modify `server.js`; Test `tests/assets-software-routes.smoke.test.js`.

- [ ] **Step 1 — failing smoke** (copy the licence-routes smoke). Assert: `GET /api/assets/software/summary` → 200 with `by_compliance`+`managed`; `GET /api/assets/software/exceptions?kind=under_licensed` → 200 array; `?kind=bad` → **400**; `?kind=under_licensed&q=' OR 1=1` → 200 (hostile input safe); `GET /api/assets/software/export.xlsx?kind=all` → 200 PK-magic; no-session → 401/403.
- [ ] **Step 2** FAIL. **Step 3 — implement** the 3 routes next to `/api/assets/licences/*` (`requireReportSession`; unknown kind pre-validated → 400 before try/catch; `tableExcel.buildWorkbook` for export — one sheet per `SOFTWARE_KINDS` for `all`; whitelisted filters). No money.
- [ ] **Step 4** PASS. **Step 5** `await-precedence` 5/5 + `node -e "new Function(...server.js...)"` + the licence smoke still green. **Step 6 — commit:** `feat(assets): /api/assets/software/{summary,exceptions,export.xlsx}`.

## Task 3: Page section (Software compliance) + browser verify

**Files:** Modify `public/assets-finance.html`. Browser-verify.

- [ ] **Step 1** — add a **Software compliance** section to the Finance & Licences page (below Licences): tiles (Under Licensed = RISK red · Over Licensed = amber · Compliant = green · Managed total) from `/api/assets/software/summary`; a compliance **donut** (Chart.js); a **by-manufacturer** mini-table; clicking a tile loads `/software/exceptions?kind=` into a drill table; per-kind + **Export all** Excel buttons. Reuse the page's `usd()` NOT needed (no money — plain counts); reuse the manufacturer/site filter pattern (add a manufacturer filter or reuse the existing). Headline the **Under Licensed** count as the compliance risk.
- [ ] **Step 2 — VERIFY IN BROWSER (mandatory).** `preview_start` sdp-dashboard, mint an admin PG session, seed a handful of `software` rows (a Managed Under-Licensed, an Over, a Compliant, an unmetered) into the sqlite `assets.db`, **restart (stop+start, not reload — `_htmlCache`)**, load `/assets-finance.html`: confirm the Software compliance tiles show real counts (Under Licensed highlighted), the donut renders, the by-manufacturer table renders, a tile-click drill loads, Export points at the xlsx endpoint, **zero console errors**. Screenshot/DOM-read.
- [ ] **Step 3 — commit:** `feat(assets): Software compliance section on Finance & Licences page`.

## Task 4: Regression + docs + finish

- [ ] **Step 1 — full regression** `node --test --test-force-exit tests/` — the ~15 pre-existing dev-`.env` PG failures stay; nothing NEW red; `await-precedence` green; A/B/C-v1/depreciation suites green. The integration test now asserts 9830 software rows too.
- [ ] **Step 2 — CLAUDE.md** Current-State entry (2026-07-18, C-2) + Known-Pitfalls rows: the `software` catalog view (`002070`) already carries compliance aggregates → C-2 needs NO 121k table (that's C-3, the "which machines" drill-down); trust `Compliance Type` over the raw Installations-vs-Allowed delta (SDP factors CAL/downgrades); only ~50 `Managed` titles are metered; BOM on `﻿Software ID`. Point at the spec.
- [ ] **Step 3 — commit**, then finish-a-development-branch (merge is the controller's call).

---

## Done criteria
- [ ] `software` table synced from view `002070`; integration proves 9830 rows + 32 Under-Licensed on the real CSV.
- [ ] `getSoftwareComplianceSummary`/`getSoftwareComplianceExceptions`/`classifySoftwareCompliance` dual-backend, await-covered; unknown kind → 400.
- [ ] `/api/assets/software/*` — filters whitelisted, no 500 on hostile input, no money.
- [ ] Software compliance section on the Finance & Licences page (Under-Licensed headline), **browser-verified**.
- [ ] Full suite green; 121k installations drill-down deferred to C-3.
