# Asset Depreciation config + Admin Config-Console IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A config-driven depreciation feature (compute our own book value + schedule, 4 methods, global-default + per-product-type) and a reorganized admin config console that groups every setting by scope (Global vs module) with clear badges.

**Architecture:** New pure `services/depreciation.js` (currency-agnostic math) + a JSON-blob config key in `reportConfig` + a dual-backend reader on `assets-db.js` + routes + Finance-page surfacing. Plus an IA refactor of the `reports.html#admin` rail into scoped groups, extracting SMTP into a Global panel and `xof_usd_rate` into an Assets-Finance panel, and adding a Depreciation config panel.

**Tech Stack:** Node, better-sqlite3 + `services/pgDb.js`, Express, `node:test`, Chart.js (cdnjs 4.4.0), `services/money.js`.

**Spec:** `docs/superpowers/specs/2026-07-18-assets-depreciation-and-config-ia-design.md` — read Part A (math + config) and Part B (rail reorg + the 3 new panels + the 2 relocations).

**Branch:** `feat/assets-depreciation-config` (created from `main`).

---

## Ground rules
- `ASSETS_BACKEND=sqlite|postgres`, default sqlite; tests sqlite. New dual-backend reader dispatches `if (ASSETS_BACKEND==='postgres') return _fooPg(...)` first-statement; every caller awaits (`tests/await-precedence.test.js` scans `assets-db.js`).
- Money in USD via the `xof_usd_rate` reader arg (from `reportConfig`); depreciation math is currency-agnostic (raw numbers), converted for display. Reuse `money.parseAmount`/`fmtUsd` — never a `$` glyph in a digest.
- The admin reorg keeps every panel's id + logic; only rail grouping/labels/badges + two field relocations + three new panels change. Browser-verify the console (it's THE config surface).
- Commit after every green step: `git commit --no-verify`. Tests: `node --test --test-force-exit tests/<file>.test.js`.

---

## Task 0: `services/depreciation.js` — pure compute (4 methods) + config parse

**Files:** Create `services/depreciation.js`; Test `tests/depreciation.test.js`.

- [ ] **Step 1 — failing test.** Assert against hand-computed values, INCLUDING the SDP screenshot case:
  - **straight_line**, cost 2250000, salvage 0, usefulLifeMonths 36, acquisitionDate '2022-11-21', asOf '2025-11-21' (36 mo elapsed) → `currentBookValue` ≈ 0, `accumulated` ≈ 2250000, monthly = 62500; asOf '2023-11-21' (12 mo) → bookValue ≈ 1500000, accumulated ≈ 750000 (matches SDP's 2023 full-year 750000). asOf before end, monthsElapsed clamped; bookValue floored at salvage.
  - **declining_balance**, cost 1000, salvage 100, declinePercent 0.5 (50%/yr), 12 mo → bookValue ≈ 1000×(1-0.5/12)^12 (assert within 1), floored at 100.
  - **double_declining**, cost 1000, salvage 0, usefulLifeMonths 24, 12 mo → bookValue ≈ 1000×(1-2/24)^12, never <salvage.
  - **sum_of_years**, cost 1300, salvage 100, usefulLifeMonths 36 (3 yr), asOf after 1 yr → year-1 dep = (1300-100)×3/6 = 600; bookValue ≈ 700.
  - Guards: `usefulLifeMonths:0` → all-null (no NaN/Infinity); `cost:null` → null; bookValue never negative; `pctDepreciated` = 1-bv/cost or null.
  - `schedule` is an array of `{year, depreciation, accumulated, bookValue}` covering the useful life. **(I-1 — internal consistency)** each `schedule[k].bookValue` MUST be the SAME book-value function evaluated at `k×12` months (a downsample of the monthly curve), NOT an independent annual-compounded value — otherwise the annual schedule and the monthly `currentBookValue` disagree at year boundaries for declining/DDB and read as a bug. Add a test: when `asOf` lands exactly on year-end `k`, `currentBookValue === schedule[k].bookValue` (within a cent) for ALL four methods.
  - **(I-1) pin a PARTIAL-YEAR SYD case**: `sum_of_years`, cost 1300, salvage 100, 36mo, `asOf` = acquisition + 18 months → assert the accumulated is year-1 full (600) + half of year-2 (year-2 factor 2/6 × 1200 = 400, half = 200) = 800, bookValue = 1300 - 800 = 500. (State the SYD proration rule: accumulate whole elapsed years fully + the fractional current year pro-rata by elapsed-months-in-year/12.)
  - `parseDepreciationConfig('')` → the safe default object; `parseDepreciationConfig('garbage')` → default; `resolveForType(cfg,'Laptop')` → the by_type entry; `resolveForType(cfg,'Unknown')` → the default entry.
- [ ] **Step 2** FAIL. **Step 3 — implement** per spec A1+A2. `computeDepreciation({cost,salvage,method,usefulLifeMonths,declinePercent,acquisitionDate,asOf})` (asOf default = a passed value; the test always passes an explicit asOf for determinism — do NOT call `new Date()` inside if `asOf` given). `monthsElapsed` = whole months between two ISO/`DD Mon YYYY`/Date inputs (parse via `new Date`). Implement the 4 method branches (floor at salvage, never negative, no NaN). `schedule` = annual rows. `parseDepreciationConfig(raw)` (JSON.parse, safe default) + `resolveForType(config, product_type)` (case-insensitive substring on by_type keys → default). Export `computeDepreciation, parseDepreciationConfig, resolveForType, METHODS, DEFAULT_DEPRECIATION_CONFIG`.
- [ ] **Step 4** PASS. **Step 5 — commit:** `feat(assets): depreciation.js — 4 methods + config parse (pure)`.

## Task 1: config key + depreciation reader

**Files:** Modify `services/reportConfig.js` (add `asset_depreciation_config` to DEFAULTS = `JSON.stringify(DEFAULT_DEPRECIATION_CONFIG)`), `assets-db.js`; Test `tests/assets-depreciation-readers.test.js`, extend `tests/report-config-rate.test.js` (or a new config test) for the round-trip.

- [ ] **Step 1 — failing test.** Seed assets across 2 sites/types (Laptop cost '1,000,000.00' acq '2022-01-01', Server cost '5,000,000.00' acq '2020-01-01', a no-cost row). Call `getAssetDepreciation({}, { config: DEFAULT_DEPRECIATION_CONFIG, rate: 0.00165, asOf:'2025-01-01' })`. Assert: per-site `computed_book_value_usd` = Σ(computeDepreciation per asset)×rate (hand-check one site); `sdp_book_value_usd` = Σ(parse current_book_value)×rate (cross-check column present); `pct_depreciated` sane 0..1; a no-cost asset contributes 0/null without NaN; `fleet` = sum; `{site:'X'}` narrows. Also assert `reportConfig.DEFAULTS.asset_depreciation_config` round-trips through set/getConfig.
- [ ] **Step 2** FAIL. **Step 3 — implement** `getAssetDepreciation(filters, {config, rate=1, asOf})` dual-backend (spec A3): SELECT `site, product_type, purchase_cost, acquisition_date, current_book_value` via `_assetWhere`, shared JS pass using `require('./services/depreciation')` `resolveForType`+`computeDepreciation` and `money.parseAmount`; aggregate per site (+fleet); ×rate for USD. **(M-5) `pct_depreciated` = `1 - Σ(computed_book)/Σ(purchase)` per site** (NOT an average of per-asset pcts — match the existing `_aggregateFinance` convention; guard Σpurchase=0→null). **(M-4) `resolveForType` must coalesce a missing `salvage_pct`→0 and `useful_life_months`→the default's** so a by_type entry lacking a field can't yield NaN. Export `getAssetDepreciation`. Add `getDepreciationSchedule({config,rate,asOf})` returning a fleet net-book-value-by-year curve — sum per-asset `schedule[].bookValue` by year, ×rate — **name the exact shape** `{ years:[...], book_value_usd:[...] }` so Task 4's Chart.js consumer matches (M-3).
- [ ] **Step 4** PASS. **Step 5** `await-precedence` 5/5 + existing assets/finance tests green. **Step 6 — commit:** `feat(assets): depreciation reader (computed book value per site, USD) + config key`.

## Task 2: routes — depreciation summary/schedule + config

**Files:** Modify `server.js`; Test `tests/assets-depreciation-routes.smoke.test.js`.

- [ ] **Step 1 — failing smoke** (copy the finance-routes smoke harness). Assert: `GET /api/assets/depreciation/summary` → 200 with `by_site`+`fleet` and a CONVERTED `computed_book_value_usd` (rate applied) + `sdp_book_value_usd`; `GET /api/assets/depreciation/schedule` → 200 (curve/array); `GET /api/assets/depreciation-config` → 200 the parsed config; `PUT /api/assets/depreciation-config` with a valid body → 200 + round-trips on the next GET; `PUT` with garbage → 400 (validate shape); no-session → 401/403; config write requires admin.
- [ ] **Step 2** FAIL. **Step 3 — implement** the routes next to `/api/assets/finance/*` (`requireReportSession`; config `PUT` `requireAdmin`). Summary/schedule resolve `rate` via the existing `_assetUsdRate()` and `config` via `parseDepreciationConfig((await reportConfig.getConfig(rdb.db)).asset_depreciation_config)`. **(M-1) `asOf` is an optional `?asOf=YYYY-MM-DD` query param defaulting to today**, passed through to the reader. `PUT /api/assets/depreciation-config` validates (method ∈ METHODS, useful_life_months>0, salvage_pct 0..1 for default + each by_type) → `reportConfig.setConfig(rdb.db, {asset_depreciation_config: JSON.stringify(clean)}, user)`; invalid → 400.
- [ ] **Step 4** PASS. **Step 5** `await-precedence` 5/5 + `node -e "new Function(...server.js...)"` + finance smoke still green. **Step 6 — commit:** `feat(assets): /api/assets/depreciation/{summary,schedule} + depreciation-config routes`.

## Task 3: Admin config-console reorganization (rail groups + badges + 2 relocations + 3 new panels)

**Files:** Modify `public/reports.html` (rail markup + CSS + `_ADMIN_PANEL_IDS` + hash allowlist + role-gating + the panel moves) — the big IA task. Browser-verify.

> **HARD RULE (I-2/I-3): keep EVERY element `id` identical when relocating a DOM subtree.** `getElementById` is document-wide, so a shared `saveReportConfig`/`loadReportConfig`/`saveHygieneConfig` keeps working no matter which panel an input physically lives in. Move the `<div>`/`<label>`/`<input>` markup between panels **without renaming any id**, and do NOT delete a field's save/load read unless you also delete its input. This is the lowest-risk path and sidesteps the dangling-handler class that bricks the whole console.

- [ ] **Step 1 — rail grouping + badges.** Wrap `#admin-rail` items in `.admin-rail__group` blocks with `.admin-rail__grouphdr` headers (⚙ Global / 📊 Reports / 💻 Assets / 🛡 Risk Register) in the spec-B1 order; add a `.ar-scope` badge span to each item + CSS (grey Global; coloured Assets/Reports/Risk). Under 880px the groups stack; keep it usable.
- [ ] **Step 2 — extract SMTP → new Global panel `#ap-email`.** Move ONLY the SMTP-infra inputs (ids for smtp host/port/secure/user/pass, from, reply_to, default_email_domain, transport, formats, never_send_unconfirmed) out of the Automated Reports "Delivery settings" tab into a new `#ap-email` panel — **KEEP THEIR IDS UNCHANGED** so the existing `saveReportConfig`/`loadReportConfig` (reports.html ~5592-5614) keep reading them regardless of panel. **(I-3) The `group_report_to/cc/confirmed` inputs STAY under Reports** (`#ap-autoreports`) — do NOT drag them into the Global email panel. If the current markup interleaves SMTP and group_report_* in one tab, split the markup by moving only the SMTP `<div>`s; the shared save handler still works because ids are unchanged. Remove the now-empty "Delivery settings" inner tab button from `#ap-autoreports` (keep Recipients + Schedule + the group_report_* fields — relocate the group_report_* block to the Recipients or a small "Group report" sub-block under autoreports).
- [ ] **Step 3 — move `xof_usd_rate` → new Assets panel `#ap-assets-finance`.** New panel hosting only the XOF→USD rate input. **(I-2) You MUST also remove the rate read from `saveHygieneConfig` (reports.html ~5675, the UNGUARDED `getElementById('hyg-xof-usd-rate').value` that will throw `null.value` and kill the Hygiene Save button) AND the populate in `loadHygieneCard` (~5641-5642).** Give `#ap-assets-finance` its OWN small load (`GET /api/reports/config` → set the input) + save (`PUT /api/reports/config` `{xof_usd_rate}`) using the page's `api()` — or reuse `saveReportConfig` if the input keeps a shared id. The Hygiene panel then no longer references the rate at all.
- [ ] **Step 4 — new `#ap-assets-deprec` panel.** A depreciation config editor: a **default** row (method dropdown = the 4 METHODS, useful-life months, salvage %) + a **per-type** table (add/edit/remove type rows). Load via `GET /api/assets/depreciation-config`, save via `PUT`. Reuse the page's `api()`/`toast()`/`esc()`.
- [ ] **Step 5 — wire ALL FOUR role/routing surfaces together (I-4).** Add `email`, `assets-finance`, `assets-deprec` to: (a) `_ADMIN_PANEL_IDS` (line ~4572) → `ap-email`/`ap-assets-finance`/`ap-assets-deprec`; (b) the hash allowlist (line ~4631) — **also add the missing `'backups'` while here (N-1)**; (c) the rail `display:none` gating block (~4610-4618); AND (d) **the JS super-gate at line ~4575** (`if ((name==='risk'||name==='backups'||name==='autoreports') && role!=='super_admin') name='users'`) — this is the THIRD gate the review flagged as easy to miss. **Decision: `email`/`assets-finance`/`assets-deprec` are ADMIN-visible** (not super-only): don't add them to the 4575 guard or a `display:none`; keep backups/risk/autoreports super-only. (Server routes are already `requireAdmin`, so admin-visible email aligns UI with enforcement.) Verify `showAdminPanel` + deep-link still work.
- [ ] **Step 6 — VERIFY IN BROWSER (mandatory).** `preview_start` sdp-dashboard, mint an admin PG session (dev `.env` `REPORTS_BACKEND=postgres`), **restart (not reload — `_htmlCache`)**, load `reports.html#admin`: confirm the 4 group headers + badges render; each rail item opens its panel; the moved **SMTP** panel + **XOF→USD** panel load their values and Save round-trips; **the Hygiene panel's OWN "Save recipients & arm" button still works (I-2 regression — click it, expect success not a console throw)**; the **group_report_* fields still save from under Reports (I-3)**; the new **Depreciation** panel saves + reloads; deep-links (`#admin/email`, `#admin/assets-deprec`, `#admin/backups`) land right; **zero console errors** (a broken inline-JS edit shows as an Uncaught error and kills the console). Screenshot.
- [ ] **Step 7 — commit:** `feat(admin): reorganize config console by scope (Global vs module) + Assets Finance/Depreciation panels`.

## Task 4: Finance page — computed book value + schedule display

**Files:** Modify `public/assets-finance.html`. Browser-verify.

- [ ] **Step 1** — add to the Finance section: a **Computed book value (USD)** column (primary, from `/api/assets/depreciation/summary` `computed_book_value_usd`) next to the existing SDP book value column, clearly labelled "SDP" on the cross-check; a small **depreciation schedule chart** (Chart.js line, fleet net book value over years from `/api/assets/depreciation/schedule`); a note stating the config in effect (method/life) + `asOf`. USD only, rate labelled.
- [ ] **Step 2 — VERIFY IN BROWSER.** Reload the Finance page (seed a few assets with acquisition_date + purchase_cost), confirm the computed book value column shows converted USD (differs sensibly from SDP's), the schedule chart renders, zero console errors. Screenshot.
- [ ] **Step 3 — commit:** `feat(assets): Finance page — computed book value + depreciation schedule`.

## Task 5: Regression + CLAUDE.md + finish

- [ ] **Step 1 — full regression** `node --test --test-force-exit tests/` — the ~15 pre-existing dev-`.env` PG failures stay; nothing NEW red; `await-precedence` green; Foundation/B/C suites green.
- [ ] **Step 2 — CLAUDE.md** Current-State entry (2026-07-18) + Known-Pitfalls rows: depreciation computed by us (4 methods, `services/depreciation.js`, currency-agnostic → convert after), config is a JSON blob in `reportConfig` (`asset_depreciation_config`), global-default+per-type (no per-asset), SDP book value shown as cross-check; the admin console is now scope-grouped (Global vs module) — SMTP moved to `#ap-email`, `xof_usd_rate` to `#ap-assets-finance`, new `#ap-assets-deprec`. **Adding/gating an admin panel touches FOUR surfaces that must move together: `_ADMIN_PANEL_IDS` (~4572) + the hash allowlist (~4631) + the rail `display:none` gate (~4610-4618) + the JS super-gate at ~4575.** And: relocating a config field between panels is safe ONLY if its `id` is kept identical (shared `getElementById`-based save/load); renaming/removing an input without removing its save-read throws `null.value` and kills the whole inline-JS console. Point at the spec.
- [ ] **Step 3 — commit**, then finish-a-development-branch (merge is the controller's call per the autonomous grant).

---

## Done criteria
- [ ] `depreciation.js` 4 methods pinned to hand values incl. the SDP 2,250,000/36mo case; config parse safe-defaults.
- [ ] `getAssetDepreciation` dual-backend, USD, computed vs SDP cross-check, await-covered.
- [ ] `/api/assets/depreciation/{summary,schedule}` + config GET/PUT (validate→400).
- [ ] Admin console grouped by scope with badges; SMTP + xof_usd_rate relocated; Depreciation config panel; **browser-verified, zero console errors**.
- [ ] Finance page shows computed book value + schedule (USD); **browser-verified**.
- [ ] Full suite green; no per-asset override; no raw XOF on a Finance surface.
