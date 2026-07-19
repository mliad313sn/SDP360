# Assets — Investment & Forecast — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A per-equipment-type **Investment** tab on the unified Assets module — a historical investment curve + a forward forecast (hardware replacement driven by depreciation useful life, software renewal driven by licence expiry) + **coverage-% transparency** on every forecast number.

**Architecture:** A new PURE `services/assetForecast.js` (three builders + tolerant date/number helpers) does all the logic; dual-backend readers on `assets-db.js` SELECT the columns and delegate to it; routes + one config knob (`asset_replacement_uplift_pct`); a 6th tab on `public/assets.html`. Readers exposed for later report embedding (not wired now).

**Tech Stack:** Node + Express + better-sqlite3 / PostgreSQL (dual-backend via `ASSETS_BACKEND`), `node --test`, `services/money.js` (XOF→USD), `services/depreciation.js` (`resolveForType`), Chart.js.

**Spec:** `docs/superpowers/specs/2026-07-19-assets-investment-forecast-design.md` (READ it — the builder shapes, bucket rules, and known-pitfall touchpoints are there).

**Branch:** `feat/assets-investment-forecast` (from `main`).

## Ground rules (every task)
- `ASSETS_BACKEND=sqlite|postgres`; tests run sqlite. New dual-backend readers dispatch `if (ASSETS_BACKEND==='postgres') return _fooPg(...)` as the LITERAL first statement; callers await. `tests/await-precedence.test.js` auto-covers them (must stay 5/5).
- ALL forecast logic lives in the PURE `services/assetForecast.js` (no DB, no `new Date()` inside — callers pass `asOf`), so it's unit-tested without a database.
- Money: XOF→USD only via `services/money.js`; never a SQL SUM/CAST on the raw `purchase_cost` text. No `$` glyph in db/export surfaces.
- Commit after every green step (`git commit --no-verify` — a post-commit hook prints deploy noise + harmless "failed to delete .git/worktrees" permission errors; IGNORE them, the commit succeeds; confirm with `git rev-parse --short HEAD`).
- Run one test file: `node --test --test-force-exit tests/<file>.test.js`.

---

## Task 0: The pure forecast engine (`services/assetForecast.js`)

**Files:**
- Create: `services/assetForecast.js`
- Test: `tests/asset-forecast.test.js`

- [ ] **Step 1 — write the failing test** (`tests/asset-forecast.test.js`). Require `../services/assetForecast`. Cover ALL three builders + helpers with hand-computed expectations. `asOf` is always passed explicitly (e.g. `'2026-07-01'`, currentYear 2026).

  **History** — `buildInvestmentHistory(assetRows, licenceRows, rate)`:
  - assetRows `[{acquisition_date:'2022-05-01', purchase_cost:'1,200.00'}, {acquisition_date:'2024-03-01', purchase_cost:'800.00'}, {acquisition_date:'', purchase_cost:'500'}, {acquisition_date:'2022-09-01', purchase_cost:'0.00'}]`, rate `1` (so USD==the number for easy asserts). licenceRows `[{acquisition_date:'2023-01-01', cost:'300'}]`.
  - Assert `years` gap-filled 2022..2024 ascending: 2022 hardware 1200, 2023 hardware 0 + software 300, 2024 hardware 800; `cumulative_usd` runs 1200,1500,2300. `coverage.hardware = {eligible:2, total:4, pct:50, excluded:{no_date:1, no_cost:1}}` (the `''`-date row → no_date; the `0.00` row → no_cost). `coverage.software={eligible:1,total:1,pct:100,...}`.

  **Hardware forecast** — `buildHardwareForecast(assetRows, {config, rate, upliftPct, horizonYears, asOf})` with a `config` whose `default` gives a 36-mo life and a per-type override for `Laptop` 60-mo (build a minimal config object matching `depreciation.parseDepreciationConfig` output — the test can construct `{default:{method:'straight_line', useful_life_months:36, salvage_pct:0}, types:{Laptop:{useful_life_months:60}}}` OR just pass `require('../services/depreciation').DEFAULT_DEPRECIATION_CONFIG` and pick product_types that resolve to known lives — inspect `resolveForType` output first and assert against what it actually returns):
  - past-life asset `{acquisition_date:'2022-01-01', purchase_cost:'1200', product_type:'Desktop'}` (36-mo life → 2025 ≤ 2026) → `due_now.count 1`, `due_now.replacement_usd 1200` (uplift exponent clamped 0), rate 1, uplift 0.
  - in-horizon future `{acquisition_date:'2024-01-01', purchase_cost:'1000', product_type:'Laptop'}` (60-mo → 2029; asOf 2026 horizon 5; years_until 3) with `upliftPct:0.03` → `years` has a 2029 entry `replacement_usd = round(1000×1.03^3)` count 1.
  - beyond-horizon `{acquisition_date:'2025-01-01', purchase_cost:'2000', product_type:'ServerLike'}` with a 120-mo life → 2035 → `beyond_horizon.count 1, usd 2000`(uplift 0 case), NOT in `years`, NOT in `total_forecast_usd`, but counted in `coverage.eligible`.
  - excluded: `{acquisition_date:'', purchase_cost:'900', product_type:'Desktop'}` → no_date; `{acquisition_date:'2023-01-01', purchase_cost:'0.00', product_type:'Desktop'}` → no_cost. Assert `excluded:{no_date:1,no_cost:1,no_life:0}` and these are NOT eligible.
  - `total===0` (empty array) → `coverage.pct 0` (no NaN), `years:[]`, `due_now.count 0`.
  - `total_forecast_usd === due_now.replacement_usd + sum(years[].replacement_usd)` (excludes beyond_horizon).

  **Software forecast** — `buildSoftwareForecast(licenceRows, {horizonYears, asOf})` asOf 2026 horizon 5:
  - single `{expiry_date:'30 Jun 2027', cost:'500', license_option:'Perpetual'}` → `years[2027].renewal_usd 500` count 1.
  - expired single `{expiry_date:'30 Jun 2024', cost:'400', license_option:'Perpetual'}` → `due_now`.
  - beyond-horizon single `{expiry_date:'30 Jun 2035', cost:'700', license_option:'Perpetual'}` → `beyond_horizon`.
  - recurring `{expiry_date:'30 Jun 2027', cost:'100', license_option:'Subscription'}` → one renewal in EACH of years 2027,2028,2029,2030,2031 (currentYear+1..+5) → each `years[y].renewal_usd` includes +100; `recurring_count` counts it. (NOT also in beyond_horizon.)
  - expired recurring `{expiry_date:'30 Jun 2024', cost:'200', license_option:'Annual'}` → `due_now` +200 AND each year 2027..2031 +200 (M1). Actually recurring adds to EACH currentYear+1..+horizon = 2027..2031; verify no double-count in any single year.
  - `volume` option `{expiry_date:'30 Jun 2027', cost:'50', license_option:'Volume'}` → treated as SINGLE (not recurring) → only `years[2027]`, `recurring_count` unchanged.
  - excluded: `{expiry_date:'', cost:'10',...}` → no_expiry; `{expiry_date:'30 Jun 2027', cost:'0.00',...}` → no_cost. `coverage.excluded:{no_expiry:1,no_cost:1}`.
  - `DD Mon YYYY` parsed via `new Date()` (assert the 2027 bucket lands correctly — the licence-date trap).

  Run → **FAIL** (module missing).

- [ ] **Step 2** run → confirm FAIL.

- [ ] **Step 3 — implement `services/assetForecast.js`:**
  - `require('./money')` for `parseAmount`/`toUsd`. Helpers: `_yearOf(s)` → `Number(String(s).slice(0,4))` if it parses to a 4-digit year from an ISO-ish string, else via `new Date(s)` fallback, else `null`; `_expiryYearOf(s)` → `const d=new Date(s); return isNaN(d)?null:d.getUTCFullYear()`; `_num(s)` → `money.parseAmount(s)` (returns a number or null; `'0.00'`→0). `_pct(elig,total)=> total>0?Math.round(100*elig/total):0`. `_curYear(asOf)=> new Date(asOf).getUTCFullYear()` (asOf is always passed).
  - `buildInvestmentHistory(assetRows, licenceRows, rate)`: tally hardware by `_yearOf(acquisition_date)` where a non-zero `toUsd(purchase_cost,rate)`; software by `_yearOf(acquisition_date)` where non-zero `_num(cost)` (already USD). Track eligible/excluded per the two gates (no_date first, then no_cost). Build a gap-filled `years` from min→max present year (hardware+software union; if none, `[]`). `cumulative_usd` a running total of `total_usd`.
  - `buildHardwareForecast(...)`: `const cur=_curYear(asOf); const up=Number(upliftPct)||0;` for each asset resolve `life = require('./depreciation').resolveForType(config, product_type).useful_life_months`. Eligible iff `_yearOf(acq)!=null && costUsd>0 && Number(life)>0`. `life_years=Math.ceil(life/12); ry=acqYear+life_years; yu=ry-cur; repl=Math.round(costUsd*Math.pow(1+up, Math.max(0,yu)))`. Bucket: `ry<=cur`→due_now(+repl with yu clamped 0); `cur<ry<=cur+horizon`→years[ry]; else beyond_horizon(+repl). excluded by first-failing gate (no_date→no_cost→no_life). Return the spec shape incl. `beyond_horizon`, `total_forecast_usd = due_now + Σyears`, `coverage`.
  - `buildSoftwareForecast(...)`: `const cur=_curYear(asOf); const RECUR=/subscription|annual|monthly|saas/i;` (NOT volume). Eligible iff `_expiryYearOf(expiry)!=null && costUsd>0` (cost already USD via `_num`). For a RECUR licence: add `cost` to EACH `years[y]` for `y in [cur+1 .. cur+horizon]`, `recurring_count++`; if `expiryYear<=cur` ALSO add to `due_now`. For a NON-recur licence: `ey<=cur`→due_now; `cur<ey<=cur+horizon`→years[ey]; else beyond_horizon. Return the spec shape.
  - Export `{ buildInvestmentHistory, buildHardwareForecast, buildSoftwareForecast, _yearOf, _expiryYearOf }`.

- [ ] **Step 4** run `node --test --test-force-exit tests/asset-forecast.test.js` → **PASS** (all cases). Syntax: `node -e "require('./services/assetForecast')"`.

- [ ] **Step 5 — commit:** `feat(assets): pure investment/forecast engine (history + hardware CAPEX + software renewal + coverage)`.

---

## Task 1: Config knob `asset_replacement_uplift_pct` + admin field

**Files:**
- Modify: `services/reportConfig.js` (DEFAULTS)
- Modify: `public/reports.html` (the `#ap-assets-deprec` panel — add the input + its save + load lines)
- Test: `tests/report-config-uplift.test.js` (tiny)

- [ ] **Step 1 — failing test.** In `tests/report-config-uplift.test.js`: require `../services/reportConfig`, assert `DEFAULTS.asset_replacement_uplift_pct === '0'` and `KEYS.includes('asset_replacement_uplift_pct')` (KEYS derives from DEFAULTS — confirm how, mirror the existing `xof_usd_rate` assertions in `tests/report-config-rate.test.js` if present). Run → FAIL.

- [ ] **Step 2** FAIL. **Step 3 — implement:**
  - `services/reportConfig.js`: add `asset_replacement_uplift_pct: '0',` to `DEFAULTS` (near `xof_usd_rate` / `asset_depreciation_config`). (`KEYS`/`setConfig` filter auto-include it — this is the documented "must be in DEFAULTS or writes are silently dropped" trap.)
  - `public/reports.html` `#ap-assets-deprec` panel: add an input `<input id="deprec-uplift-pct" ...>` labelled "Annual replacement price uplift (%) — 0 = like-for-like". READ the panel to copy the exact save/load idiom used by the depreciation config + `xof_usd_rate` (find where `xof_usd_rate` is read on save and written on load — mirror it EXACTLY). Add BOTH: the LOAD line (`document.getElementById('deprec-uplift-pct').value = cfg.asset_replacement_uplift_pct ?? '0';`) AND the SAVE line (include `asset_replacement_uplift_pct: document.getElementById('deprec-uplift-pct').value` in the PUT payload). **Both are mandatory — an input with no save-read throws `null.value` and bricks the whole inline-JS console** (documented trap). Confirm the PUT route accepts arbitrary DEFAULTS keys (the existing config-save path already writes `asset_depreciation_config`/`xof_usd_rate`, so the new key rides the same path).

- [ ] **Step 4** PASS. Syntax on reports.html isn't node-checkable, but grep to confirm BOTH `deprec-uplift-pct` occurrences exist (save + load). **Step 5 — commit:** `feat(assets): asset_replacement_uplift_pct config + admin field (depreciation panel)`.

---

## Task 2: Dual-backend readers (`getInvestmentSummary` / `getInvestmentForecast`)

**Files:**
- Modify: `assets-db.js`
- Test: `tests/assets-investment-readers.test.js`

- [ ] **Step 1 — failing test.** Copy the harness from `tests/assets-hygiene-readers.test.js` (env `ASSETS_BACKEND=sqlite`, throwaway `SDP_DATA_DIR`, `replaceTable`). Seed `assets` (with `acquisition_date`, `purchase_cost`, `product_type`, `site`, `manufacturer`, `state`) + `software_licenses` (with `acquisition_date`, `expiry_date`, `cost`, `license_option`, `site`, `license_state`, `license_name`, `vendor`) across 2 sites + 2 product_types. Assert:
  - `getInvestmentSummary({}, {rate:0.00165})` returns `{years, coverage}` with hardware USD converted (a raw XOF `'1,000,000.00'` → ~1650 USD) and software USD as-is. Coverage % present.
  - `getInvestmentSummary({product_type:'Laptop'}, {rate})` narrows the hardware side (fewer eligible) — proves `_assetWhere` wired.
  - `getInvestmentForecast({}, {config, rate, upliftPct:0, horizonYears:5, asOf:'2026-07-01'})` returns `{hardware:{years,due_now,beyond_horizon,total_forecast_usd,coverage}, software:{...}}` (pass `config = require('../services/depreciation').DEFAULT_DEPRECIATION_CONFIG`). A past-life seeded asset lands in `hardware.due_now`.
  - `getInvestmentForecast({site:'MANA'}, {...})` narrows hardware via `_assetWhere` AND software via `_licenceWhere` (site applies to BOTH — `software_licenses` has a `site` column).
  - Empty DB → empty-but-valid shapes, no throw.
  Run → FAIL.

- [ ] **Step 2** FAIL. **Step 3 — implement in `assets-db.js`** (READ `getFinanceSummary`/`getAssetDepreciation` + `_assetWhere` + `_licenceWhere` first — copy their dual-backend + param-bound style):
  - `getInvestmentSummary(filters, {rate})`: `if (ASSETS_BACKEND==='postgres') return _getInvestmentSummaryPg(filters,{rate});` then sqlite: `SELECT acquisition_date, purchase_cost FROM assets ${_assetWhere(filters)}` + `SELECT acquisition_date, cost FROM software_licenses ${_licenceWhere(filters)}` → `assetForecast.buildInvestmentHistory(aRows, lRows, rate)`.
  - `getInvestmentForecast(filters, {config, rate, upliftPct, horizonYears, asOf})`: dispatch first-statement; sqlite `SELECT acquisition_date, purchase_cost, product_type FROM assets ${_assetWhere(filters)}` + `SELECT expiry_date, cost, license_option FROM software_licenses ${_licenceWhere(filters)}` → `{ hardware: buildHardwareForecast(aRows,{config,rate,upliftPct,horizonYears,asOf}), software: buildSoftwareForecast(lRows,{horizonYears,asOf}) }`.
  - Both `*Pg` forks: identical SELECTs via `pgHandle()` + `await h.prepare(sql).all(params)` (the `?`→`$N` translation is automatic), same builders. `require('./services/assetForecast')` at top-of-function or module scope (match how the file requires `depreciation`/`money`). Export `getInvestmentSummary, getInvestmentForecast`.

- [ ] **Step 4** PASS + `node --test --test-force-exit tests/await-precedence.test.js` → 5/5 + `tests/assets-hygiene-readers.test.js` still green + `node -e "new Function(require('fs').readFileSync('assets-db.js','utf8'))"`. **Step 5 — commit:** `feat(assets): investment history + forecast readers (dual-backend)`.

---

## Task 3: Routes `/api/assets/investment/{history,forecast,export.xlsx}`

**Files:**
- Modify: `server.js`
- Test: `tests/assets-investment-routes.smoke.test.js`

- [ ] **Step 1 — failing smoke.** Copy `tests/assets-hardware-routes.smoke.test.js` harness (app boot, admin PG session / report token). Assert: `GET /api/assets/investment/history` → 200 `{years,coverage}`; `GET /api/assets/investment/forecast` → 200 `{hardware,software}`; `?horizon=abc` → 200 (default 5, no crash); `?horizon=99` → 200 (clamped); `?q=' OR 1=1` → 200; `GET /api/assets/investment/export.xlsx?horizon=5` → 200 PK-magic; no-session → 401/403. Run → FAIL (404s).

- [ ] **Step 2** FAIL. **Step 3 — implement** in the `/api/assets/*` region (READ the hardware + depreciation route blocks + `_assetUsdRate` + `_deprecConfig`(~2709) first):
  - Add `_assetInvestmentFilters(req)` = the site/state/product_type/manufacturer/q whitelist (copy `_assetHardwareFilters`).
  - `GET /api/assets/investment/history` (`requireReportSession`, async, try/catch→500): `rate = await _assetUsdRate()`; `res.json(await require('./assets-db').getInvestmentSummary(_assetInvestmentFilters(req), {rate}))`.
  - `GET /api/assets/investment/forecast` (`requireReportSession`, async, try/catch→500): `const cfg = await reportConfig.getConfig(rdb.db);` `const config = require('./services/depreciation').parseDepreciationConfig(cfg.asset_depreciation_config);` `const upliftPct = (Number(cfg.asset_replacement_uplift_pct)/100) || 0;` `let horizon = parseInt(req.query.horizon,10); if(!Number.isFinite(horizon)||horizon<1) horizon=5; if(horizon>15) horizon=15;` `const asOf = new Date().toISOString().slice(0,10);` `const rate = await _assetUsdRate();` `res.json(await adb.getInvestmentForecast(_assetInvestmentFilters(req), {config, rate, upliftPct, horizonYears:horizon, asOf}))`. (Confirm `reportConfig` + `rdb` are in scope in server.js — they are, used by the depreciation route; mirror exactly.)
  - `GET /api/assets/investment/export.xlsx` (`requireReportSession`): build both (history + forecast), `tableExcel.buildWorkbook([{name:'History',rows:...},{name:'Hardware forecast',rows:...},{name:'Software forecast',rows:...}])` — flatten each into row objects (year → columns). Content-Type xlsx + attachment.
  - Section comment `// ── ASSETS · INVESTMENT & FORECAST ──`.

- [ ] **Step 4** PASS + `node -e "new Function(require('fs').readFileSync('server.js','utf8'))"` + await-precedence 5/5 + `tests/assets-hardware-routes.smoke.test.js` green + `grep -n "investment/history\|investment/forecast\|investment/export" server.js` → 3. **Step 5 — commit:** `feat(assets): /api/assets/investment/{history,forecast,export.xlsx}`.

---

## Task 4: "Investment" tab (6th) on the unified module + browser verify

**Files:**
- Modify: `public/assets.html`
- Browser-verify.

- [ ] **Step 1 — the 4 framework edits + the pane** (READ `public/assets.html` — the `TABS`/`PANE`/`inited` triple, the tab buttons, the `pane-*` sections, and mirror an existing pane IIFE e.g. `HW_PANE`/`PROG_PANE` for the self-contained pattern):
  1. `TABS` += `'investment'`; `PANE` += `investment:'INVEST_PANE'`; `inited` += `investment:false`.
  2. Tab button `<button class="tabbtn" role="tab" data-tab="investment" aria-selected="false">Investment</button>` after the Progress button.
  3. `<section id="pane-investment" class="tabpane"> … </section>` (id MUST be `pane-investment`), after the progress section.
  4. `INVEST_PANE` IIFE (own `authHeaders`/`escapeHtml`/`qs`/`upsertChart`, `invf-` ids, `charts={}`, lazy-init, `window.INVEST_PANE={init,refresh}`):
     - **Coverage banners (headline)**: two `.count-note`-style blocks: hardware `"Forecast based on N of M assets (X%) — those with acquisition date + cost + a lifecycle policy"` + the excluded breakdown; software `"Renewal based on N of M licences (Y%) with expiry + cost"`. From the `coverage` objects.
     - **Historical curve**: a Chart.js line (`invf-chartHistory`): hardware vs software per `years[].year` + a cumulative line.
     - **Forecast**: a Chart.js stacked bar (`invf-chartForecast`): a leading "Due now" column + one column per horizon year, hardware replacement + software renewal stacked. Show `beyond_horizon` as a labelled note ("+ N assets / $X due beyond the horizon"). A **horizon selector** (`<select>` 3/5/10, default 5) → refetch `/forecast?horizon=`. Label the uplift in force (read from the forecast response OR a small `/config`-less note — simplest: the forecast doesn't echo uplift; add a static note "prices per the configured uplift" OR have the route echo `upliftPct` in the response and label it — RECOMMENDED: echo `uplift_pct` in the forecast response and show "prices grown X%/yr").
     - **Software filter note**: "Software honours site / state / search only — the licence table has no product type or manufacturer."
     - **Method note**: "Hardware forecast = each asset replaced at its depreciation end-of-life, budgeted at original cost × uplift. Software = licence renewals at expiry."
     - **Empty/insufficient state** when hardware `coverage.eligible===0` AND software too: "Not enough dated/costed records to forecast yet — fill acquisition date + cost on the Inventory/Hygiene tabs." (Not a blank chart.)
     - Chart-click on a forecast year → `window.openAssetDrill` with that year's assets (fetch `/api/assets/inventory?...` for the site/type — pragmatic: reuse inventory rows filtered; if a clean per-year row set isn't available, skip the drill for the forecast chart and keep it for the history chart, OR omit drills — the CSV drill is nice-to-have here, not the core ask).
     - **Excel export** button → `/api/assets/investment/export.xlsx` + current filters + horizon.
     - `refresh(f)`: fetch history (`_assetInvestmentFilters` = full shared filter) + forecast (with horizon); render all; toggle empty-state. Guard fetches (offline → empty-but-valid).
  - **If you echo `uplift_pct`**: add it to the forecast route response in Task 3's handler (a one-line addition — do it here if not already, and note it).

- [ ] **Step 2 — VERIFY IN BROWSER (mandatory).** `preview_start` the dev server (sqlite ASSETS_BACKEND), mint an admin PG session token, seed a handful of `assets` (varied acquisition_date/purchase_cost/product_type — include a past-life one + a future one + a no-date one) + a few `software_licenses` (varied expiry_date/cost/license_option) into the sqlite DBs, set `xof_usd_rate`, **restart (stop+start — `_htmlCache`)**. Load `/assets.html`, click **Investment**:
  - The 6 tabs render; the other 5 still work (no regression).
  - Coverage banners show real N/M/% for hardware + software.
  - History curve draws; forecast stacked bar draws with a Due-now column + horizon years; beyond-horizon note shows.
  - Horizon selector 3/5/10 refetches + redraws.
  - The **product_type filter narrows the hardware forecast** (the business ask); site narrows both; the software filter note is visible.
  - Excel export downloads.
  - Empty-state shows when coverage is 0 (test by filtering to a type with no dated/costed assets).
  - **Zero console errors** (read_console_messages). Screenshot.

- [ ] **Step 3 — commit:** `feat(assets): Investment tab — historical curve + forecast + coverage%`.

---

## Task 5: Regression + CLAUDE.md + finish (+ report hook)

- [ ] **Step 1 — regression** `node --test --test-force-exit tests/assets-*.test.js tests/asset-forecast.test.js tests/report-config-uplift.test.js tests/await-precedence.test.js` → green.
- [ ] **Step 2 — CLAUDE.md** Current-State entry (2026-07-19): the Investment tab (historical curve + forward forecast + coverage%); hardware replacement driven by depreciation useful life, budgeted original cost × config uplift (`asset_replacement_uplift_pct`, default 0); software = renewal from licence expiry (no depreciation), partial + coverage-labelled; `services/assetForecast.js` is the pure engine; readers `getInvestmentSummary`/`getInvestmentForecast` exposed for later report embedding. Add pitfall rows: (a) the software forecast uses `_licenceWhere` (site/state/q) — `software_licenses` has NO manufacturer/product_type (the inverse of the software catalog); (b) coverage is a HEADLINE not a footnote — hardware eligibility needs acquisition_date (~91% empty) AND non-zero cost (~90% `'0.00'`), so the forecast may rest on a single-digit % of the fleet today, and the coverage banner is the guardrail; (c) `asset_replacement_uplift_pct` MUST be in `reportConfig.DEFAULTS` (setConfig KEYS filter) and its admin input needs BOTH save+load lines. Point at this plan + spec.
- [ ] **Step 3 — report hook (note, not build):** `getInvestmentSummary`/`getInvestmentForecast` stay exported + documented for later weekly/monthly report embedding ("intégrer plus tard"). Do NOT wire into reports now.
- [ ] **Step 4 — commit**, then finish-a-development-branch (merge to `main`).

---

## Done criteria
- [ ] Pure `services/assetForecast.js` (3 builders + coverage + beyond_horizon), unit-tested incl. the recurring-sub × due_now + beyond-horizon + exclusion cases.
- [ ] Dual-backend readers await-covered; software uses `_licenceWhere`; hardware uses `_assetWhere`.
- [ ] `/api/assets/investment/{history,forecast,export.xlsx}` — filters whitelisted, horizon clamped, hostile input safe.
- [ ] `asset_replacement_uplift_pct` config + admin field (save+load).
- [ ] Investment tab: coverage banners + historical curve + forecast bars + horizon selector + type filter narrows + export + empty-state, **browser-verified**, zero console errors.
- [ ] Full assets suite green; readers exposed for later report integration; coverage-% transparency is a headline.
