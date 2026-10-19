# Asset Depreciation config + Admin Config-Console reorganization — Design

**Status:** approved to build (autonomous delivery, 2026-07-18). User decisions locked:
**(1) depreciation config granularity = global default + per-product-type** (no per-asset override — SDP owns that; our module is read-only from the sync). **(2) book value = computed by us** (4 methods, config-driven) shown as primary, with SDP's `Current Book Value($)` displayed alongside as a cross-check.

**Depends on:** merged Assets Foundation(A) + Hygiene(B) + Licence/Finance(C-v1). Reuses `assets` table (has `purchase_cost`, `acquisition_date`, `current_book_value`, `product_type`), `services/money.js`, `reportConfig`, and the `reports.html#admin` rail.
**Branch:** `feat/assets-depreciation-config`.
**Motivation:** the user's SDP "Configure Depreciation" screens — SDP supports Method (Straight Line / Declining Balance / Double Declining Balance / Sum Of The Years Digit), Useful Life (months) OR Decline Percent, Salvage Value, per-product-default OR per-asset. We can compute the same schedule ourselves from data we already sync. AND the user asked to reorganize the config console so scope (global vs module) is obvious.

---

## Part A — Depreciation (compute + config)

### A1. `services/depreciation.js` (NEW, PURE, currency-agnostic)
`computeDepreciation({ cost, salvage, method, usefulLifeMonths, declinePercent, acquisitionDate, asOf })` → `{ currentBookValue, accumulated, pctDepreciated, monthsElapsed, monthsRemaining, schedule:[{year, depreciation, accumulated, bookValue}] }`.
- Works on **numbers** (caller parses raw XOF strings via `money.parseAmount` first). Currency-agnostic — depreciation is linear in cost, so the Finance layer converts the results to USD via the rate afterward. `salvage` may be an absolute value or (config-level) a percent of cost — resolve to absolute before compute.
- `monthsElapsed` = whole months from `acquisitionDate` to `asOf` (default `asOf`=today), clamped `[0, usefulLifeMonths]` for book-value purposes (schedule extends to end of life).
- Four methods (standard accounting; annual schedule to match SDP's default "Anually" view; book value is as-of `asOf`):
  - **straight_line**: monthly = `(cost - salvage) / usefulLifeMonths`; accumulated = `min(monthsElapsed, usefulLifeMonths) × monthly`; bookValue = `max(salvage, cost - accumulated)`.
  - **declining_balance**: annual rate `d` = `declinePercent` (if given) else derived `1/usefulLifeYears`; monthly factor; bookValue = `max(salvage, cost × (1 - d/12)^monthsElapsed)`; never below salvage.
  - **double_declining**: rate = `2 / usefulLifeMonths` on the declining book value each month; bookValue = `max(salvage, cost × (1 - 2/usefulLifeMonths)^monthsElapsed)`.
  - **sum_of_years**: SYD over `usefulLifeYears` (=ceil(months/12)); `SYD = n(n+1)/2`; year-k depreciation = `(cost - salvage) × (n-k+1)/SYD`; accumulate to `asOf`.
- Guards: `usefulLifeMonths<=0` or `cost==null` → all-null result (never NaN/Infinity); `bookValue` floored at `salvage`, never negative; `pctDepreciated = cost>0 ? 1 - bookValue/cost : null`.
- Export `computeDepreciation` + `METHODS` (the 4 keys + labels).

### A2. Config store — `asset_depreciation_config` (JSON blob in `reportConfig`)
- One new `reportConfig.DEFAULTS` key `asset_depreciation_config` (a JSON string), edited whole. Shape:
  ```
  { default: { method:'straight_line', useful_life_months:48, salvage_pct:0 },
    by_type: { Laptop:{method:'straight_line',useful_life_months:36,salvage_pct:0},
               Desktop:{...36...}, Computer:{...36...}, Server:{...60...},
               Network:{...60...}, Smartphone:{...24...} } }
  ```
- A pure `parseDepreciationConfig(raw)` (in depreciation.js or a small helper): JSON.parse with a safe default on empty/garbage; `resolveForType(config, product_type)` → the effective `{method, useful_life_months, salvage_pct}` (by_type match case-insensitive/substring → else default). Salvage% resolved to absolute against each asset's cost at compute time.
- Default seeded value mirrors the product-type refresh cycles already used in `getFinanceSummary` (Laptop/Desktop/Computer 36, Server/Network 60, Smartphone 24, default 48).

### A3. Reader — `getAssetDepreciation(filters, { config, rate, asOf })` (dual-backend)
- Dispatch first-statement (`if (ASSETS_BACKEND==='postgres') return _...Pg(...)`) → SELECT `site, product_type, purchase_cost, acquisition_date, current_book_value` (filtered via `_assetWhere`) → shared JS pass: for each asset, `resolveForType(config, product_type)` + `computeDepreciation({cost:parseAmount(purchase_cost), salvage: cost×salvage_pct, method, usefulLifeMonths, acquisitionDate, asOf})`. Aggregate per site: Σ computed bookValue, Σ SDP current_book_value (cross-check), Σ purchase, avg pct_depreciated, asset_count. Multiply money by `rate` → USD. Return `{ by_site:[{site, asset_count, computed_book_value_usd, sdp_book_value_usd, purchase_cost_usd, pct_depreciated}], fleet:{...} }`.
- A second helper for the **schedule projection** per product-type (or fleet): `getDepreciationSchedule({config, rate, asOf})` → for each product-type a representative annual schedule scaled to the fleet's cost in that type (or simply expose the per-type config + a fleet accumulated/remaining curve). Keep v1 to a **fleet net-book-value-over-time** curve derived by summing per-asset schedules by year — enough for a chart. (If that's heavy, a per-type schedule table is the fallback.)

### A4. Routes (`server.js`, `requireReportSession`; config write `requireAdmin`)
- `GET /api/assets/depreciation/summary` — reads config + rate, returns `getAssetDepreciation`.
- `GET /api/assets/depreciation/schedule` — the projection curve.
- `GET /api/assets/depreciation-config` (admin) → the parsed config; `PUT /api/assets/depreciation-config` (admin) → validate + persist the JSON blob via `reportConfig.setConfig`.

### A5. Finance page surfacing (`public/assets-finance.html`)
- Add a **computed book value (USD)** column to the per-site finance table (primary), keep SDP's book value as a labelled **cross-check** column. Add a small **depreciation schedule chart** (fleet net book value over years) + a note stating the config (method/life) in effect and `asOf`.
- No raw XOF; USD via the rate; SDP cross-check clearly labelled "SDP".

---

## Part B — Admin Config-Console reorganization (scope-clear IA)

The `reports.html#admin` rail is a flat historical list. Reorganize it into **scoped groups** so every item's scope is obvious, WITHOUT changing what each panel does (panels keep their ids + logic; only the rail grouping, labels, badges, and two config relocations change).

### B1. Grouped rail (visual + IA)
Insert non-clickable **group headers** into `#admin-rail` and reorder the existing `.admin-rail__item` buttons under them; add a small **scope badge** to each item (`Global` grey vs `Assets`/`Reports`/`Risk` coloured):
```
⚙ GLOBAL
   Users · Active Sessions · Sites · Email transport (SMTP)* · Backups(super)
📊 REPORTS
   Report delivery (recipients+schedule+group)* · Departments · Exec View
💻 ASSETS
   Finance & currency (XOF→USD)** · Depreciation(NEW) · Hygiene digest
🛡 RISK REGISTER
   Site code aliases
```
`*` **Email transport (SMTP)** is EXTRACTED from the Automated Reports panel's "Delivery settings" tab into its own Global panel (the SMTP/from/transport keys are app-wide infra; the recipients/schedule stay under Reports). `**` **Finance & currency** is a NEW small Assets panel that hosts `xof_usd_rate` (moved out of the Hygiene panel where it was mislabeled).

### B2. Mechanics (reports.html)
- Rail markup: wrap items in group `<div class="admin-rail__group">` with a `<div class="admin-rail__grouphdr">⚙ Global</div>`; add `<span class="ar-scope ar-scope--global|assets|reports|risk">` badge markup + CSS.
- New panels: `#ap-email` (Global — SMTP/transport/from/reply_to/default_domain, moved from the autoreports Delivery tab), `#ap-assets-finance` (Assets — `xof_usd_rate`), `#ap-assets-deprec` (Assets — depreciation config editor: default + per-type table, method dropdown with the 4 methods, useful-life months, salvage %). Register all three in `_ADMIN_PANEL_IDS`, the hash allowlist (line 4631), and the role-gating block (4610-4618: email=admin, assets-finance/deprec=admin, keep backups/risk/autoreports super-only).
- The Automated Reports panel keeps Recipients + Schedule + Group settings; its "Delivery settings" (SMTP) tab is removed (moved to `#ap-email`). The Hygiene panel keeps recipients+arm+schedule; its `xof_usd_rate` field moves to `#ap-assets-finance`.
- Keep every existing edit route + store unchanged — this is an IA/labelling refactor + two field relocations, NOT a backend change (except the new depreciation config route in A4).
- **Module-local config stays local** (Meetings `meetings-setup.html`, Deck Builder presets) — out of scope; optionally add a one-line "managed on the module's page →" pointer in the rail, but do not move them.

### B3. Browser-verify (mandatory)
The admin console is THE config surface — a broken inline-JS edit kills it. After the reorg: load `reports.html#admin`, confirm every group header + badge renders, each rail item opens its panel, the moved SMTP + xof_usd_rate fields load/save from their new panels, the new Depreciation config saves + round-trips, deep-links (`#admin/<panel>`) work, zero console errors.

---

## What this does NOT do
- No per-asset depreciation override (SDP owns it).
- No move of Meetings/Deck-Builder module-local config into the central console (keep module-owned).
- No change to the 4 depreciation methods' accounting beyond the standard formulas; SDP's exact rounding may differ by cents — our schedule is a faithful projection, labelled as computed, with SDP's book value shown alongside.
- C-2 (purchased-vs-installed) still deferred.

## Risks
- **R1 — depreciation math wrong → misstated book value.** Mitigated: pure `depreciation.js` unit-tested per method against hand-computed values (incl. the SDP screenshot case: cost 2,250,000, straight-line, 36mo, salvage 0 → 62,500/mo, matching SDP's 2022 partial-year 62,500 / full-year 750,000); book value floored at salvage, never negative/NaN.
- **R2 — the admin-console reorg breaks the whole panel (inline JS).** Mitigated: additive rail restructure, panels keep ids/logic, `_ADMIN_PANEL_IDS`+allowlist+role-gating updated together, mandatory browser verify.
- **R3 — relocating SMTP / xof_usd_rate loses the field.** Both keep the SAME `report_config` keys + `/api/reports/config` route — only the DOM location of the input moves; load/save wiring re-pointed + verified in the browser.
- **R4 — config JSON blob corruption.** `parseDepreciationConfig` returns a safe default on empty/garbage; `PUT` validates shape before persist.
