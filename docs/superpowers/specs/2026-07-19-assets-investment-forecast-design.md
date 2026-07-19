# Assets — Investment & Forecast — Design Spec

**Date:** 2026-07-19
**Status:** Approved (design) — pending spec review + user review before planning.
**Branch (impl):** `feat/assets-investment-forecast` (from `main`).

## Goal

A per-equipment-type **investment picture** the IT team can take to the business:
1. **Historical investment curve** — what has been spent on hardware + software, by year.
2. **Forward investment forecast** — what will be needed, by year, driven by equipment **age / depreciation** (hardware) and **licence renewal / expiry** (software).
3. **Coverage transparency as a headline** — every forecast number states the exact **% of equipment it is based on**, and why the rest is excluded, so a partial dataset is never mistaken for a complete one.

All views are filterable by the shared Assets filter bar (**equipment type** = `product_type`, plus site / state / manufacturer / search) so the numbers can be sliced for a business conversation.

## User decisions (locked)

- **Hardware replacement trigger** = **depreciation useful life** (per product type, from the existing `asset_depreciation_config`). An asset is forecast for replacement the year it passes end-of-life. Chosen for finance/CAPEX consistency with the book-value model already shown.
- **Replacement cost basis** = **original purchase cost (USD) × (1 + uplift%)^years-to-replacement**, where `uplift%` is an admin config knob **defaulting to 0%** (pure like-for-like until set).
- **Software** = **historical spend curve + a forward renewal forecast from licence expiry dates**, explicitly **labelled partial** with a coverage %. Software is NOT depreciated (perpetual licences aren't amortized in SDP; subscriptions are recurring OPEX) — the forward number is a **renewal** forecast, a different engine from hardware depreciation.

## Controller's design calls (approved)

- Each asset is forecast for its **next** replacement within the horizon only (one cycle, not repeated re-replacements) — standard for a 3–5yr CAPEX plan; avoids compounding speculative cycles.
- **Horizon** is a **UI selector** (3 / 5 / 10 yr, default 5); **uplift%** is the **config knob**.
- Delivery = a **new interactive "Investment" tab** on the unified module + **Excel export**; readers **exposed for later** weekly/monthly report embedding but NOT wired into reports now (the effort-trend "intégrer plus tard" pattern).

---

## Substrate (verified)

- **`assets`** rows carry `acquisition_date`, `purchase_cost` (RAW XOF text, e.g. `'2,250,000.00'` / `'0.00'`), `product_type`, `site`, `state`, `manufacturer`, `months_since_acquisition`. Money → USD via `_assetUsdRate()` + `services/money.js` `parseAmount`/`toUsd` (never a SQL SUM/CAST — the raw text has commas; sqlite-lenient/pg-500 trap).
- **Depreciation policy**: `services/depreciation.js` `resolveForType(config, product_type)` → `{ method, useful_life_months, salvage, decline_percent }`. `config` = the `asset_depreciation_config` JSON blob in `reportConfig` (global default + per-product-type overrides). This is the single source of the hardware replacement life.
- **`software_licenses`** rows carry `cost` (RAW USD text via the sync transform), `expiry_date` (**`DD Mon YYYY`**, e.g. `'30 Jun 2025'` — parse with `new Date()`, NEVER `substr`/lexical/SQL-date, same trap as the licence readers), `license_option`, `installations_allowed`, `acquisition_date`, `organization_license`, `license_state`.
- `_assetWhere(filters)` whitelists site/state/product_type/manufacturer/q on `assets`. **`software_licenses` is a SEPARATE table filtered by `_licenceWhere` (assets-db.js) — it whitelists `site`, `state`(→`license_state`), and `q`(→`license_name`/`vendor`); it has NO `manufacturer` or `product_type` column.** So the software forecast reuses `_licenceWhere` and honours **site / state / search** (NOT manufacturer, NOT product_type — the inverse of the `software` *catalog* used by Software-compliance). The UI note reads: "Software honours site / state / search only — the licence table has no product type or manufacturer."
- `ASSETS_BACKEND=sqlite|postgres`; dual-backend readers dispatch first-statement; `tests/await-precedence.test.js` auto-covers them. New pure logic lives OUTSIDE the readers (in `assetForecast.js`) so it's unit-testable without a DB.

---

## Architecture

```
Browser: Assets module → "Investment" tab (INV_FORECAST_PANE / prog-style)
  ├─ GET /api/assets/investment/history?<filters>            → historical curve + coverage
  ├─ GET /api/assets/investment/forecast?<filters>&horizon=&asOf=  → forward CAPEX + renewals + coverage
  └─ GET /api/assets/investment/export.xlsx?<filters>&horizon=

server.js  (requireReportSession; whitelisted filters; _assetUsdRate; depreciation config; uplift config)
  └─ assets-db.js  getInvestmentSummary(filters,{rate}) · getInvestmentForecast(filters,{config,rate,upliftPct,horizonYears,asOf})
       └─ SELECT the needed columns → aggregate IN JS via services/assetForecast.js (PURE)
            ├─ buildInvestmentHistory(assetRows, licenceRows, rate)
            ├─ buildHardwareForecast(assetRows, {config, rate, upliftPct, horizonYears, asOf})
            └─ buildSoftwareForecast(licenceRows, {horizonYears, asOf})
```

### New pure module: `services/assetForecast.js`

All logic is here — pure, currency handled by passing already-parsed numbers or by delegating to `money.js`. No DB, no `Date.now()` surprises (callers pass `asOf`).

**Date/number helpers (tolerant):**
- `_yearOf(dateStr)` → the 4-digit year of an ISO-ish acquisition_date, or `null` if unparseable/empty.
- `_expiryYearOf(dateStr)` → year via `new Date('DD Mon YYYY')` (licence format), `null` if invalid.
- Money parsing via `money.parseAmount` (assets XOF) / already-USD for licences.

**A. `buildInvestmentHistory(assetRows, licenceRows, rate)` →**
```
{
  years: [ { year, hardware_usd, software_usd, total_usd, cumulative_usd } ],  // ascending, gap-filled between min+max year
  coverage: {
    hardware: { eligible, total, pct, excluded: { no_date, no_cost } },
    software: { eligible, total, pct, excluded: { no_date, no_cost } },
  }
}
```
- Hardware eligible = row with a parseable acquisition year AND a non-zero parsed cost. Sum `toUsd(purchase_cost, rate)` per year.
- Software eligible = licence with a parseable acquisition year AND non-zero cost. Sum `cost` (USD) per year.
- `years` gap-filled (a year with no spend is `0`, not skipped) so the curve reads honestly.

**B. `buildHardwareForecast(assetRows, {config, rate, upliftPct, horizonYears, asOf})` →**
```
{
  years: [ { year, replacement_usd, count } ],     // currentYear+1 … currentYear+horizon (see below)
  due_now: { replacement_usd, count },             // assets already past end-of-life (replacement_year <= currentYear)
  beyond_horizon: { count, usd },                  // eligible assets whose replacement lands AFTER the horizon (I3 — surfaced, never dropped)
  total_forecast_usd,                              // due_now + Σyears  (NOT beyond_horizon)
  coverage: { eligible, total, pct, excluded: { no_date, no_cost, no_life } },
}
```
Per asset:
- Eligible iff parseable acquisition year AND non-zero parsed cost AND a resolvable `useful_life_months > 0` (from `resolveForType(config, product_type)`). Eligibility is date+cost+life ONLY — it does NOT depend on the horizon (so `coverage.eligible` counts due_now + in-horizon + beyond_horizon assets).
- `life_years = ceil(useful_life_months / 12)`; `replacement_year = acquisition_year + life_years`.
- `years_until = replacement_year - currentYear(asOf)`.
- `cost_usd = toUsd(purchase_cost, rate)`; `replacement_usd = cost_usd × (1 + upliftPct)^max(0, years_until)`.
- **Three mutually-exclusive buckets** (an asset is in exactly one): `replacement_year <= currentYear` → **`due_now`** (uplift exponent clamped to 0 — no compounding into the past). Else `currentYear < replacement_year <= currentYear + horizonYears` → **`years[replacement_year]`**. Else (`> currentYear + horizonYears`) → **`beyond_horizon`**. Because due_now absorbs `replacement_year == currentYear`, the `years[]` range is effectively **`currentYear+1 … currentYear+horizon`** (a currentYear column would always be empty — the UI shows a separate "Due now / overdue" column, so this is not a rendering defect).
- **`coverage.eligible` is a superset of the $ shown**: it counts every date+cost+life asset (incl. beyond_horizon); `total_forecast_usd` only sums due_now + years. The coverage banner must read "% of equipment the forecast is BASED ON", never "% of the $ shown", and surface `beyond_horizon.count` explicitly so nothing looks dropped.
- `excluded` counts INELIGIBLE assets by their FIRST failing gate (no_date → no_cost → no_life precedence) so `excluded.*` sum to `total − eligible` with no double-count.

**C. `buildSoftwareForecast(licenceRows, {horizonYears, asOf})` →**
```
{
  years: [ { year, renewal_usd, count } ],         // currentYear+1 … currentYear+horizon
  due_now: { renewal_usd, count },                 // licences already expired (expiry_year <= current)
  beyond_horizon: { count, usd },                  // single-renewal licences expiring after the horizon
  total_forecast_usd,                              // due_now + Σyears
  recurring_count,                                  // how many licences were treated as recurring subscriptions
  coverage: { eligible, total, pct, excluded: { no_expiry, no_cost } },
}
```
Per licence:
- Eligible iff parseable expiry year AND non-zero cost.
- **Recurring vs single** by `license_option` regex `/subscription|annual|monthly|saas/i` (pragmatic, tunable — `volume` deliberately EXCLUDED: volume licensing is typically perpetual, not an annual sub; the regex is documented as a first pass to tune against real SDP option values).
- **Single (non-recurring) licence:** `expiry_year <= currentYear` → `due_now`; `currentYear < expiry_year <= currentYear+horizon` → `years[expiry_year]`; else → `beyond_horizon`.
- **Recurring (subscription) licence** — an annual cost through the horizon: it contributes ONE renewal to EACH year in `currentYear+1 … currentYear+horizon` (regardless of the exact expiry date — a live subscription renews every year). If ALREADY expired (`expiry_year <= currentYear`) it ALSO contributes its overdue renewal to `due_now` (the M1 interaction: expired sub = due_now once + each horizon year once — no double-count within a single year, because due_now is the current-year slot and `years[]` starts at currentYear+1). `recurring_count` states how many were treated this way.
- Labelled **partial** everywhere via the coverage %.

`upliftPct` is a fraction (e.g. `0.03`), parsed from the config percent string once in the reader (`Number(pctStr)/100`; blank/garbage → 0).

### Config

- `reportConfig.DEFAULTS` gains **`asset_replacement_uplift_pct`** = `'0'` (string, percent value e.g. `'3'` = 3%/yr). MUST be added to `DEFAULTS` or `setConfig`'s `KEYS.includes` filter silently drops writes (documented trap). Admin-editable in the **`#ap-assets-deprec`** panel (the replacement/life-driven knob belongs with depreciation), input id **`deprec-uplift-pct`** following the `xof_usd_rate` precedent. **Both the `getElementById('deprec-uplift-pct')` SAVE and LOAD lines must be added in the same edit** — an input with no save-read throws `null.value` and bricks the entire inline-JS console (documented trap). The reader parses it → fraction; blank/garbage → 0 (never NaN).
- Routes read config via **`(await reportConfig.getConfig(rdb.db))`** (the folded DEFAULTS+overrides object — there is NO `reportConfig.get`; mirror `_deprecConfig` at server.js ~2709). `.asset_depreciation_config` → `depreciation.parseDepreciationConfig(...)`; `.asset_replacement_uplift_pct` → fraction.
- Horizon is NOT config — it's a UI selector passed as `?horizon=` (validated server-side to an int in [1,15], default 5).

### Readers on `assets-db.js` (dual-backend, additive)

- `getInvestmentSummary(filters, { rate })` → `buildInvestmentHistory(...)`. SELECTs `acquisition_date, purchase_cost` from `assets` (with `_assetWhere`) + `acquisition_date, cost` from `software_licenses` (manufacturer/q only).
- `getInvestmentForecast(filters, { config, rate, upliftPct, horizonYears, asOf })` → `{ hardware: buildHardwareForecast(...), software: buildSoftwareForecast(...) }`. SELECTs `acquisition_date, purchase_cost, product_type` from `assets` + `expiry_date, cost, license_option` from `software_licenses`.
- Both dispatch `if (ASSETS_BACKEND==='postgres') return _fooPg(...)` first-statement; the pg fork runs the SAME SELECTs (parameter-bound, `?`→`$N`) and calls the SAME pure builders. `asOf` resolved to a real date in the reader before the builder.
- Export both.

### Routes (server.js)

- `GET /api/assets/investment/history` (`requireReportSession`) — `_assetInvestmentFilters(req)` (site/state/product_type/manufacturer/q whitelist); `rate = await _assetUsdRate()`; try/catch→500.
- `GET /api/assets/investment/forecast` (`requireReportSession`) — same filters + `config = await reportConfig.get('asset_depreciation_config')` parsed via `depreciation.parseDepreciationConfig`, `upliftPct` from `asset_replacement_uplift_pct` (→fraction), `horizonYears` from `?horizon=` (int [1,15] default 5), `asOf` resolved (default today) BEFORE the reader; try/catch→500.
- `GET /api/assets/investment/export.xlsx` (`requireReportSession`) — `tableExcel.buildWorkbook` with two/three sheets (History, Hardware Forecast, Software Forecast); same filters/horizon.
- Whitelisted, parameter-bound → no 500 on hostile input.

### UI — new "Investment" tab (6th) on `public/assets.html`

The four tab-framework edits (`TABS` += `'investment'` / `PANE` += `investment:'INVEST_PANE'` / `inited` += `investment:false` + button + `<section id="pane-investment">`), a self-contained `INVEST_PANE` IIFE (own `authHeaders`/`escapeHtml`/`qs`/`upsertChart`, `invf-` ids to avoid collision with Inventory's `inv-`, lazy-init, reads shared `filters()`):

- **Coverage banners (headline)**: two prominent notes stating hardware forecast coverage (`X% of assets — N of M — have acquisition date + cost + a lifecycle policy`) and software renewal coverage (`Y% of licences carry expiry + cost`), each with the excluded-reason breakdown on hover/expand. This is the user's core ask, elevated.
- **Historical investment curve** (line/area): hardware vs software per year + cumulative line.
- **Forward forecast** (stacked bar per year over the selected horizon): hardware replacement + software renewal, with a leading **"Due now / overdue"** column. Horizon selector (3/5/10 yr). The uplift% in force is labelled ("prices grown 0%/yr" or "3%/yr").
- **Filter note for software**: "Software honours site / state / search only — the licence table has no product type or manufacturer." (The software forecast uses `_licenceWhere`, NOT `_assetWhere`.)
- Chart-click → `openAssetDrill` to the underlying rows (a year's replaced/renewing assets) with CSV export.
- **Excel export** button → `/investment/export.xlsx`.
- **Empty/insufficient-data state** when coverage is 0 (e.g. no dated+costed assets): a clear "not enough dated/costed records to forecast — see the Hygiene tab" rather than a blank chart.
- Browser-verified.

### Report hook

`getInvestmentSummary`/`getInvestmentForecast` exported + documented for later weekly/monthly report embedding. NOT wired into reports in this sub-project.

---

## Testing

- **`tests/asset-forecast.test.js`** (pure `assetForecast.js`) — pinned cases:
  - Hardware: asset acquired `2022`, product_type with 36-mo life, cost `1200`, uplift 0, asOf 2026 → past life → `due_now` count 1, replacement_usd 1200. A FUTURE due within horizon (acquired 2024, 60-mo life → 2029; asOf 2026 horizon 5; years_until 3 → `years[2029].replacement_usd = 1200×1.03^3` with uplift 0.03). A due-beyond-horizon asset (acquired 2025, 120-mo life → 2035) → `beyond_horizon.count 1`, NOT in `years`, NOT in `total_forecast_usd`, but IS in `coverage.eligible`. Coverage: a no-date + a no-cost + a no-life asset each land in the right excluded bucket (first-failing-gate) and are NOT eligible; `total===0` → pct 0 no NaN.
  - Software: single licence expiry `'30 Jun 2027'` cost `500` → `years[2027].renewal_usd 500`; an expired single `'30 Jun 2024'` → `due_now`; a single expiring beyond horizon → `beyond_horizon`. A **recurring** subscription (`license_option='Subscription'`) contributes ONE renewal to EACH `years[currentYear+1..horizon]`; if that sub is already expired it ALSO adds to `due_now` (M1). A `volume` option is NOT treated as recurring. A no-expiry / no-cost licence excluded. `DD Mon YYYY` parsed correctly via `new Date()` (the licence-date trap).
  - History: gap-filled years; cumulative correct; coverage %.
- **`tests/assets-investment-readers.test.js`** — dual-backend readers over a seeded `assets` + `software_licenses` (sqlite), asserting the reader wires the config/rate/uplift/horizon through to the pure builders and applies `_assetWhere` (product_type filter narrows hardware; manufacturer narrows software).
- **`tests/assets-investment-routes.smoke.test.js`** — the 3 routes: 200 + shape; hostile `?horizon=abc`/`?q=' OR 1=1` safe; export PK-magic; no-session → 401/403.
- **`tests/await-precedence.test.js`** 5/5 (auto-covers the 2 new dispatchers).
- **Browser-verify** the Investment tab (curve, forecast bars, coverage banners, horizon selector, type filter narrows, drill+CSV, export, empty-state; zero console errors).
- Full assets suite green; `report-config` test extended for the new `asset_replacement_uplift_pct` key (in DEFAULTS).

## Error handling / edge cases

- **Coverage `pct = total > 0 ? round(100 × eligible/total) : 0`** — guard `total === 0` (no rows at all) so it never NaNs; pct can never exceed 100 (eligible ≤ total by construction).
- **Data-reality expectation (set it with the user).** Hardware eligibility needs BOTH `acquisition_date` (~91% empty on the real export) AND a non-zero `purchase_cost` (~90% are `'0.00'`), so the hardware forecast may rest on a **single-digit %** of the fleet today. That is exactly why coverage is a headline + the empty-state exists — the deliverable is honest-partial, and it sharpens as the site/office asset managers fill in acquisition dates + costs. Do NOT present it as comprehensive; the coverage banner IS the guardrail.
- Zero eligible rows → empty-but-valid shapes (`years:[]`, coverage pct 0) → UI empty-state, never a crash or a misleading 0-curve read as "we spent nothing".
- Unparseable dates/costs → excluded + counted (never a NaN into a sum). `_yearOf`/`_expiryYearOf` return null on garbage.
- `upliftPct` blank/garbage → 0. `horizonYears` out of range → clamped. `asOf` default today, resolved before the builder (the depreciation-asOf trap).
- No depreciation policy for a product_type → `resolveForType` falls back to the global default (never null life) — but if the global default is somehow absent, that asset is `no_life`-excluded, not crashed.
- Money: XOF→USD only in `money.js`; rate blank/0 → DEFAULT rate (never 1); no `$` glyph in any exported/db surface (label "USD").

## Non-goals (YAGNI)

- No repeated replacement cycles (only the next replacement per asset in the horizon).
- No per-product-type standard-cost table (the user chose original-cost×uplift).
- No wiring into weekly/monthly reports yet (readers exposed only).
- No live software-installations data (C-3 remains blocked); the software forecast rides on `software_licenses` expiry/cost.
- No new depreciation methods (reuses the 4 in `services/depreciation.js`).

## Known-pitfall touchpoints (carry into the plan)

- `software_licenses.expiry_date` is `DD Mon YYYY` → `new Date()`, never substr/lexical/SQL-date.
- Money is raw XOF text with commas → parse/sum IN JS via `money.js`, no SQL SUM/CAST.
- `asset_replacement_uplift_pct` MUST be in `reportConfig.DEFAULTS` or `setConfig` drops it.
- `asOf` resolved before the builder (0-months / 0% trap).
- Dual-backend dispatch first-statement + await-covered; software honours manufacturer/q only.
- New pure logic OUTSIDE the readers so it's unit-tested without a DB.
