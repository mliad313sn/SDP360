# Asset Module — Licence Compliance (C-v1) + Finance + Hygiene enrichment — Design

**Status:** approved to build (autonomous delivery, 2026-07-18). Two decisions locked by the user:
**(1) money is displayed in USD** — assets are XOF, converted via a configurable `xof_usd_rate`; licence costs are already USD. **(2) C-v1 = licences + Finance + B-enrichment now**; full purchased-vs-installed (needs the 121k `software_installations` table) is deferred to **C-2**.

**Depends on:** Foundation (A) + Hygiene (B), both merged to `main`. Reuses the `assets` + `software_licenses` tables and `HYGIENE_KINDS`/`ASSETS_BACKEND` substrate; extends them additively.
**Branch:** `feat/assets-licence-finance`.
**Sources exploited (user-provided):**
- `Formation_ITAM_Endeavour_ServiceDeskPlus_Projection_v2.pptx` — slide 14 defines the two report audiences (Coordinator IT vs **Finance Manager**) and the minimum indicators; slide 12 the replenishment cycles; slides 10-11 the licence-type families.
- `Guide_participant_Types_Licences_Software_SDP.docx` — the licence-type taxonomy + the SDP fields (`License Type`, `License Option`, `Installations Allowed`, `Allocated To Site`, `Expiry Date`, `Used by`, `Purchase Cost`).

---

## 1. What ships (three cohesive parts on one branch)

### Part F — Finance view (slide 14 "Vue Finance Manager"), money in USD
The **finance columns already live on the Assets view we sync** (Foundation dropped them). Capture them; show value per site **in USD**.
- **Currency**: raw amounts are strings with comma separators. Assets = **XOF** (a desktop at 2 250 000 XOF); `software_licenses.cost` = **USD**. A pure `services/money.js` parses (`parseAmount`: strip `$`, commas, spaces → Number|null) and converts (`toUsd(rawXof, rate)`). `xof_usd_rate` is a `reportConfig` key (admin-editable, default a documented sensible rate); **assets money is multiplied by the rate to USD; licence cost is USD as-is.** No amount is ever shown in its raw XOF form on a Finance surface — always USD, always labelled `USD (approx @ rate)`.
- **Depreciation**: the per-year schedule (method/useful-life/salvage) is **NOT in the SDP export** — only `Current Book Value($)` (the already-depreciated value) is. So Finance surfaces **book value per site (USD)** + a **% depreciated** = `1 - book_value/purchase_cost` (currency-independent ratio, computed per row then aggregated). The per-year schedule is noted as out-of-scope (would need a separate SDP depreciation view).
- **Readers** (`assets-db.js`, dual-backend): `getFinanceSummary(filters, rate=1)` → per-site `{site, asset_count, purchase_cost_usd, book_value_usd, tco_usd, operational_cost_usd, pct_depreciated}` + fleet totals. The `rate` multiplies the XOF SUMs to USD **inside the reader** (one conversion site; the route passes the configured rate; tests pass an explicit rate). `pct_depreciated` is rate-independent.
- **Refresh-cost estimate** (slide 14 "coût estimé du refresh"): from slide 12 replenishment cycles (Laptops 3y, Desktops 3y, Servers 5y, Network 5y, Smartphones 2y) — an asset past its cycle (by `months_since_acquisition` vs the product-type cycle) is "due for refresh"; estimated refresh cost = count × a configurable per-type replacement cost, OR simply the count of due assets per site (v1 = the count + book-value-remaining; a per-type price table is a config follow-up). Keep v1 to **"assets due for refresh" count per site**; the money estimate rides on the book-value column.

### Part L — Licence compliance (C-v1) on `software_licenses` (guide taxonomy)
- **Capture the extra columns** the guide flags: extend the `software_licenses` sync mapping with `license_option`, `installations_allowed`, `acquisition_date`, `organization_license` (raw TEXT; NOT `License Key` — that's a secret, never stored/shown).
- **Type classification** — a pure `classifyLicenceType(raw)` mapping the raw `license_type` string to the guide's families: **User** (Named User, Concurrent) · **Machine** (Individual, Node Locked, OEM) · **Enterprise** (Volume, Enterprise Perpetual, Enterprise Subscription) · **Server** (CAL) · **Special** (Trial, Free). Unknown → `Other`.
- **Readers** (dual-backend): `getLicenceSummary(filters)` → `{total, by_family:{...}, by_state, by_site, expiry:{expired,expiring_90,ok,no_expiry}}`; `getLicenceExceptions(kind, filters)` — kinds: `expired` (`expiry_date` < today), `expiring_soon` (today..+90d), `no_expiry` (subscription/trial family with empty expiry — a data gap), `no_site` (empty `site`). Cost shown in **USD** (native).
- **Purchased-vs-installed (sur/sous-licensing) is C-2** — it needs `Installations Allowed` (have it) vs the INSTALLED count from `software_installations` (121k, deferred). `installations_allowed` is captured now so C-2 only adds the installed side.

### Part B+ — Hygiene enrichment (slide 6 + slide 14 "Vue Coordinateur IT")
Two new `HYGIENE_KINDS`, purely additive (they flow into the existing hygiene dashboard, exceptions route, Excel, and digest because those all read `HYGIENE_KINDS`):
- `no_asset_tag` — `(asset_tag IS NULL OR asset_tag='') AND (barcode IS NULL OR barcode='')` — the deck's "aucun asset sans asset tag et QR code". (Requires capturing `asset_tag` on the assets view — currently only `barcode` is mapped.)
- `lifecycle_exception` — `state IN ('In Repair','Expired','Lost/Stolen','Lost','Stolen')` — the deck's "assets en réparation, expirés ou perdus".
**Completeness % is NOT changed** — the shipped B score stays on its original four attributes (cost/age/owner/scan); the two new kinds are worklists/gaps surfaced as tiles + digest lines, not folded into the score (avoids regressing B's pinned numbers).

---

## 2. Schema additions (additive; full-replace sync repopulates)
> **NB (schema mechanism):** `assets-db.js` reads the single `db/postgres/assets/001_init.sql` and `.exec()`s it on BOTH backends — there is **no separate sqlite `_initSchema`**. New columns go in that shared file's `CREATE TABLE IF NOT EXISTS` (valid on both). For EXISTING tables the migration is **JS-side, backend-branched**: sqlite `PRAGMA table_info` + plain `ALTER TABLE … ADD COLUMN` in `getDB()`; pg `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in `initPgAssets()`. **Never put `ALTER` in the shared SQL** — sqlite has no `ADD COLUMN IF NOT EXISTS` and would crash at require.
- `assets`: `asset_tag`, `total_cost_of_ownership`, `operational_cost`, `current_book_value`, `months_since_acquisition` — all TEXT (raw, like `purchase_cost`).
- `software_licenses`: `license_option`, `installations_allowed`, `acquisition_date`, `organization_license` — all TEXT.
- Mapping (`assets-sync.js`): add the Assets-view columns (`Asset Tag`, `Total Cost of Ownership($)`, `Operational Cost($)`, `Current Book Value($)`, `Months Since Acquisition`) and the Software_Licenses-view columns (`License Option`, `Installations Allowed`, `Acquisition Date`, `Organization License`).
- The real-CSV integration test extends to assert the new columns land (e.g. a known machine's book value parses; the licence rows carry a family).

---

## 3. Surfaces
- **Routes** (`server.js`, additive, `requireReportSession`): `GET /api/assets/finance/{summary,export.xlsx}`, `GET /api/assets/licences/{summary,exceptions,export.xlsx}` (unknown kind → 400). The finance routes read `xof_usd_rate` from `reportConfig` and pass it to the reader. Filters whitelisted + parameter-bound.
- **Page** `public/assets-finance.html` (Insights ▾, icon `dollar-sign`/`wallet` — add to `icons.js`+`ICON_LIB` if absent): two sections — **Finance** (value/book-value/TCO per site in USD, % depreciated, assets-due-for-refresh, a Chart.js bar of value-by-site) + **Licences** (by-family donut, expiry buckets, expired/expiring drill + Excel). Money labelled `USD (approx @ <rate>)`. Session-cookie auth (copy `assets.html`). `_htmlCache` + `sendHtmlPage`. **Browser-verified.**
- **Report enrichment** (`services/assetHygieneReport.js`): the digest gains a **Finance snapshot** (fleet value USD + top sites by value) + a **Licence snapshot** (expired + expiring-soon counts). This satisfies "enrichir les rapports" without a second scheduled sender; a dedicated Finance-Manager digest is a noted follow-up. No money shown in XOF — USD only, rate stated.
- **Admin**: the hygiene admin card (or the delivery config) gains an **`xof_usd_rate`** field (admin+), written via the existing `PUT /api/reports/config`.

---

## 4. What this delivery does NOT do
- **Purchased-vs-installed / sur-licensing (C-2)** — needs the 121k `software_installations` fetch strategy + the `software` catalog view id (live recon). `installations_allowed` is captured now so C-2 is additive.
- **Per-year depreciation schedule** — not in the SDP export; would need a separate view. v1 shows Current Book Value + % depreciated.
- **A dedicated Finance-Manager scheduled digest** — v1 enriches the existing hygiene digest; a separate sender is a follow-up.
- **A per-type replacement-cost price table** — v1 shows assets-due-for-refresh counts; a priced estimate is a config follow-up.

## 5. Risks
- **R1 — wrong rate misstates every USD figure.** Mitigated: the rate is a single admin-editable config key, stated on every surface (`USD (approx @ rate)`), and conversion lives in ONE pure `money.js` used by reader + page + report. Default rate documented; changing it is one field.
- **R2 — parsing XOF strings with commas.** `parseAmount` strips `,`/`$`/spaces before `Number()`; empty/`'0.00'`→ handled (0 or null); the SQL SUM uses `CAST(NULLIF(REPLACE(col,',',''),'') AS REAL)` so pg's strict cast doesn't 500 on `''`.
- **R3 — adding `HYGIENE_KINDS` keys breaks B's pinned tests.** The B readers test asserts per-kind counts (not a whole-object deepEqual); adding keys is additive. If any test does a strict shape check, update it (adding kinds is expected) and DO NOT fold the new kinds into the completeness `_PRESENT_SELECT` (keep the score stable).
- **R4 — schema ALTER on existing prod tables.** Use `ADD COLUMN IF NOT EXISTS` (pg) / a guarded `PRAGMA`-checked ALTER (sqlite); the full-replace sync then backfills the new columns on next run. Old rows read NULL until the next sync — the page/report tolerate NULL (show `—`).
