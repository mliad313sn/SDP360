# Assets — Licence Compliance (C-v1) + Finance + Hygiene enrichment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Capture the Assets-view finance columns + extra licence fields, show value per site in USD (rate-configurable), a licence-compliance view (guide taxonomy + expiry), and two new hygiene worklists — a Finance page + enriched digest.

**Architecture:** Additive on the merged Foundation+Hygiene substrate. New pure `services/money.js` (parse + XOF→USD). New readers on `assets-db.js` (finance + licences, dual-backend). Two new `HYGIENE_KINDS`. New routes + one Finance page + digest enrichment. No new sync job; the existing assets sync gains columns.

**Tech Stack:** Node, better-sqlite3 + `services/pgDb.js`, Express, `node:test`, Chart.js (cdnjs 4.4.0, CSP-allowed), `services/tableExcel.js`.

**Spec:** `docs/superpowers/specs/2026-07-18-assets-licence-finance-design.md` — read §1 (three parts), §2 (schema), §5 (risks). Decisions: **money in USD via `xof_usd_rate`**; **C-v1 = licences+finance+B-enrichment** (purchased-vs-installed deferred to C-2).

**Branch:** `feat/assets-licence-finance` (created from `main`).

---

## Ground rules
- `ASSETS_BACKEND=sqlite|postgres`, default sqlite; tests sqlite. New dual-backend readers dispatch `if (ASSETS_BACKEND==='postgres') return _fooPg(...)` as the LITERAL first statement; every caller awaits. `tests/await-precedence.test.js` scans `assets-db.js`.
- **All money on a Finance surface is USD**, labelled `USD (approx @ rate)`. Never render raw XOF. Conversion lives ONLY in `services/money.js` + the reader's `rate` arg. `software_licenses.cost` is already USD (rate not applied).
- Schema changes are **additive TEXT columns** + idempotent ALTER (§2). Full-replace sync backfills; old rows read NULL → surfaces show `—`.
- Commit after every green step: `git commit --no-verify`. Tests: `node --test --test-force-exit tests/<file>.test.js`.

---

## Task 0: Currency infra — `services/money.js` + `xof_usd_rate` config + admin field

**Files:** Create `services/money.js`; Modify `services/reportConfig.js`, `public/reports.html`; Test `tests/money.test.js`, `tests/report-config-rate.test.js`.

- [ ] **Step 1 — failing test** `tests/money.test.js`:
  - `parseAmount('2,250,000.00')===2250000`; `parseAmount('55 920.00')===55920`; `parseAmount('$1,250')===1250`; `parseAmount('')===null`; `parseAmount('0.00')===0`; `parseAmount(null)===null`; `parseAmount('abc')===null`.
  - `toUsd('2,250,000.00', 0.00165)` ≈ `3712.5` (assert within 0.01); `toUsd('', rate)===null`; `toUsd('0.00', rate)===0`.
  - `fmtUsd(3712.5)` → a string like `'3,712.50'` (or `'$3,712.50'` — pick one, assert it).
- [ ] **Step 2** FAIL. **Step 3 — implement** `services/money.js` PURE: `parseAmount(raw)` (String, strip `$`,`,`,whitespace → `Number()`, NaN→null, ''→null but keep 0), `toUsd(rawXof, rate)` (`parseAmount`×rate, null-safe), `fmtUsd(n)` (thousands-separated 2dp, null→'—'). Export all three. Run → PASS.
- [ ] **Step 4 — config key**: add `xof_usd_rate: '0.00165'` to `reportConfig.DEFAULTS` (KEYS derives from it). Test `tests/report-config-rate.test.js`: `setConfig(db,{xof_usd_rate:'0.0017'})` then `getConfig` returns it (round-trip). (Mirror `tests/report-config-hygiene.test.js`.)
- [ ] **Step 5 — admin field**: in `public/reports.html`, add an `xof_usd_rate` number input to the existing "🛡 Assets Hygiene" admin card (or the delivery-config card) → saved via `PUT /api/reports/config`, loaded via `GET`. Reuse the card's existing `api()`/`toast()`. (No browser check needed here — Task 6 verifies the Finance page which shows the effect.)
- [ ] **Step 6 — commit:** `feat(assets): money.js (XOF→USD) + xof_usd_rate config + admin field`.

---

## Task 1: Schema + sync extension (finance cols + asset_tag + licence extras) + integration

**Files:** Modify `assets-db.js` (sqlite `_initSchema` + idempotent ALTER), `db/postgres/assets/001_init.sql`, `assets-sync.js`; Test extend `tests/assets-integration.test.js` (+ a schema test if one exists).

- [ ] **Step 1 — failing test.** Extend `tests/assets-integration.test.js`: after loading the real CSVs through the sync, assert the new columns are populated — a known machine has a non-empty `current_book_value` and `total_cost_of_ownership`; the `software_licenses` rows carry `installations_allowed`/`license_option`. (Read the current integration test's structure first; it drives the committed `tests/fixtures/assets/*.csv`. If the fixtures lack the finance columns, they're the OLD export — the Assets.csv fixture DOES have them per the live header: `Total Cost of Ownership($)`, `Operational Cost($)`, `Current Book Value($)`, `Months Since Acquisition`, `Asset Tag`. Verify the fixture header; if missing, refresh the `Assets.csv` fixture from `C:\Users\Admin\Downloads\Assets\Assets.csv` and `Software_Licenses.csv` similarly — they're the source of truth.)
- [ ] **Step 2** FAIL. **Step 3 — implement:**
  - `assets` schema: add `asset_tag, total_cost_of_ownership, operational_cost, current_book_value, months_since_acquisition` (TEXT) to the sqlite `_initSchema` CREATE and `db/postgres/assets/001_init.sql`. Add an **idempotent migration** for existing tables: sqlite — check `PRAGMA table_info(assets)` and `ALTER TABLE assets ADD COLUMN` each missing one; pg — `ALTER TABLE assets ADD COLUMN IF NOT EXISTS ...` in the init SQL (or a guarded block). Same for `software_licenses`: `license_option, installations_allowed, acquisition_date, organization_license`.
  - `assets-sync.js` mapping: add to the `assets` view columns — `'Asset Tag':'asset_tag', 'Total Cost of Ownership($)':'total_cost_of_ownership', 'Operational Cost($)':'operational_cost', 'Current Book Value($)':'current_book_value', 'Months Since Acquisition':'months_since_acquisition'`; to `software_licenses` — `'License Option':'license_option', 'Installations Allowed':'installations_allowed', 'Acquisition Date':'acquisition_date', 'Organization License':'organization_license'`.
- [ ] **Step 4** PASS. **Step 5** — run existing `tests/assets-*.test.js` + `tests/await-precedence.test.js` → all green (schema wider, nothing else changes). **Step 6 — commit:** `feat(assets): capture finance columns + asset_tag + licence extras`.

---

## Task 2: Finance readers (USD-converted)

**Files:** Modify `assets-db.js`; Test `tests/assets-finance-readers.test.js`.

- [ ] **Step 1 — failing test.** Seed (via `replaceTable('assets',cols,rows)`) a few assets across 2 sites with `purchase_cost`/`current_book_value`/`total_cost_of_ownership`/`operational_cost`/`months_since_acquisition`/`product_type`/`state`. Assert on `getFinanceSummary({}, 0.00165)`:
  - per-site `purchase_cost_usd` = Σ(parse(purchase_cost))×rate (within 0.01);
  - `book_value_usd`, `tco_usd`, `operational_cost_usd` likewise;
  - `pct_depreciated` = `1 - Σbook/Σpurchase` per site (rate-independent; assert a hand value);
  - fleet totals = sum across sites;
  - `getFinanceSummary({site:'MANA'}, rate)` narrows;
  - a site with all-empty costs → USD fields 0 or null (no NaN), `pct_depreciated` null.
  - Also assert `getFinanceSummary({}, 1)` returns raw XOF sums (rate=1 default path).
- [ ] **Step 2** FAIL. **Step 3 — implement** `getFinanceSummary(filters, rate=1)` dual-backend. SQL sums use `SUM(CAST(NULLIF(REPLACE(<col>,',',''),'') AS REAL))` (pg-safe) grouped by site; multiply the asset-money sums by `rate` in JS (licence cost is separate — not here). `pct_depreciated` from Σbook/Σpurchase (guard Σpurchase=0→null). Coerce with Number(); total=0 guards. Return `{ by_site:[...], fleet:{...} }`. PG fork mirrors. Add a **refresh-due** count per site: `months_since_acquisition` (parsed int) ≥ the product-type cycle in months (Laptop/Desktop 36, Server/Network 60, Smartphone 24; default 48) → count per site as `refresh_due`. Keep it a COUNT (no price). Export `getFinanceSummary`.
- [ ] **Step 4** PASS. **Step 5** `await-precedence` 5/5. **Step 6 — commit:** `feat(assets): finance readers — value/book/TCO per site in USD + refresh-due`.

---

## Task 3: Licence readers + type classification

**Files:** Modify `assets-db.js`; Test `tests/assets-licence-readers.test.js`.

- [ ] **Step 1 — failing test.** Seed `software_licenses` rows with varied `license_type` (`Named User`, `Concurrent`, `OEM`, `Node Locked`, `Volume`, `Enterprise Subscription`, `CAL`, `Trial`, `Free`, `Weird`), `expiry_date` (past, within 90d, far, empty), `site`, `cost`. Assert:
  - `classifyLicenceType('Named User')==='User'`, `'OEM'==='Machine'`, `'Enterprise Subscription'==='Enterprise'`, `'Client Access License'==='Server'`/`'CAL'==='Server'`, `'Trial'==='Special'`, `'Weird'==='Other'` (case-insensitive, tolerant of substrings).
  - `getLicenceSummary({}).by_family` counts per family; `.expiry` = {expired, expiring_90, ok, no_expiry} with correct bucketing (use a fixed `today` injected or `date('now')`; for the test, seed dates relative to a fixed reference and assert).
  - `getLicenceExceptions('expired',{})` returns only past-expiry rows; `getLicenceExceptions('expiring_soon',{})` the ≤90d ones; `getLicenceExceptions('no_expiry',{})` the subscription/trial-family rows with empty expiry; `getLicenceExceptions('no_site',{})` empty-site rows; `getLicenceExceptions('bad',{})` **throws**.
  - Exception/summary rows include `cost` as USD (native) but the test just checks presence; no XOF conversion applied to licences.
- [ ] **Step 2** FAIL. **Step 3 — implement**: pure `classifyLicenceType(raw)` (regex/substring map to User/Machine/Enterprise/Server/Special/Other). `getLicenceSummary(filters)` dual-backend (`by_family` via classify in JS over the rows or a CASE; `by_state`,`by_site` GROUP BY; `expiry` buckets via `substr(expiry_date,1,10)` compared to today — use `date('now')` sqlite / `current_date` pg, or compute in JS from fetched rows for backend-parity simplicity). `getLicenceExceptions(kind, filters)` with a `LICENCE_KINDS` map (throw on unknown). Whitelisted filters (`site`,`family`,`state`,`q`). Export `classifyLicenceType, getLicenceSummary, getLicenceExceptions, LICENCE_KINDS`.
- [ ] **Step 4** PASS. **Step 5** `await-precedence` 5/5. **Step 6 — commit:** `feat(assets): licence readers — type families + expiry exceptions (guide taxonomy)`.

---

## Task 4: Hygiene enrichment — two new kinds

**Files:** Modify `assets-db.js` (`HYGIENE_KINDS`); Test extend `tests/assets-hygiene-readers.test.js`.

- [ ] **Step 1 — failing test.** Add to the hygiene readers test: seed a `no_asset_tag` row (`asset_tag=''` AND `barcode=''`) and a `lifecycle_exception` row (`state='In Repair'`). Assert `getHygieneSummary({}).by_kind.no_asset_tag` and `.lifecycle_exception` count them; `getHygieneExceptions('lifecycle_exception',{})` returns the In-Repair row; a tagged row is NOT in `no_asset_tag`. Confirm the EXISTING assertions still hold (the new kinds don't disturb discovered/ghost/etc counts). **Do NOT fold the new kinds into completeness** — assert `by_site` completeness is unchanged by their presence.
- [ ] **Step 2** FAIL. **Step 3 — implement**: add to `HYGIENE_KINDS`:
  - `no_asset_tag: { label:'No asset tag / QR', where:"(asset_tag IS NULL OR asset_tag='') AND (barcode IS NULL OR barcode='')" }`
  - `lifecycle_exception: { label:'In repair / expired / lost', where:"state IN ('In Repair','Expired','Lost/Stolen','Lost','Stolen')" }`
  Leave `_PRESENT_SELECT` (completeness) untouched. If any existing test did a whole-object deepEqual on `by_kind`, update it to include the new keys (adding kinds is expected).
- [ ] **Step 4** PASS. **Step 5** run the hygiene ROUTES smoke + `await-precedence` → green (the new kinds flow through the existing routes/export automatically). **Step 6 — commit:** `feat(assets): hygiene enrichment — no_asset_tag + lifecycle_exception (from ITAM training)`.

---

## Task 5: Routes — finance + licences

**Files:** Modify `server.js`; Test `tests/assets-finance-routes.smoke.test.js`.

- [ ] **Step 1 — failing smoke** (copy the hygiene-routes smoke harness). Seed assets + licences. Assert: `GET /api/assets/finance/summary` → 200 JSON with `by_site` + `fleet` and USD fields (the route reads `xof_usd_rate` from config and applies it — assert a converted number, not the raw XOF); `GET /api/assets/finance/export.xlsx` → 200 PK-magic; `GET /api/assets/licences/summary` → 200 with `by_family`; `GET /api/assets/licences/exceptions?kind=expired` → 200 array; `?kind=bad` → **400**; `?kind=expired&q=' OR 1=1` → 200 (no crash); `GET /api/assets/licences/export.xlsx?kind=all` → 200 PK-magic.
- [ ] **Step 2** FAIL. **Step 3 — implement** the routes next to the other `/api/assets/*` (all `requireReportSession`): finance summary/export read `const rate = parseFloat((await reportConfig.getConfig(rdb.db)).xof_usd_rate)||1` and pass it to `getFinanceSummary`; licence exceptions/export pre-validate kind → 400 before the try/catch (the hygiene-route pattern). Export routes stream `tableExcel.buildWorkbook` Buffers (finance = one sheet per-site rows; licences = one sheet per kind for `all`). Whitelist filters. **Finance Excel/JSON show USD numbers**, no raw XOF.
- [ ] **Step 4** PASS. **Step 5** `await-precedence` 5/5 + `node -e "new Function(...server.js...)"` syntax. **Step 6 — commit:** `feat(assets): /api/assets/{finance,licences}/* routes (USD, kind→400)`.

---

## Task 6: Finance + Licences page + nav + browser verify

**Files:** Create `public/assets-finance.html`; Modify `server.js` (`_htmlCache`+route), `public/_shell.js` (nav), `public/brand/icons.js` (a `wallet`/`dollar-sign` glyph if absent).

- [ ] **Step 1 — page** copying `public/assets.html` skeleton (session auth) + Chart.js (`cdnjs 4.4.0`, as `assets-hygiene.html` does). TWO sections:
  - **Finance**: header (fleet value USD `@ rate`), a per-site table (assets, purchase USD, book value USD, TCO USD, % depreciated, refresh-due), a Chart.js bar of book-value-by-site, an **Export Excel** button. Every money cell labelled/positioned as USD; show the active rate.
  - **Licences**: by-family donut, expiry buckets (expired/expiring/ok/no-expiry) as tiles, a drill table on `/licences/exceptions?kind=` + per-kind + all Excel.
  - Filter bar (site) applied to both.
- [ ] **Step 2** — `_htmlCache` + `sendHtmlPage(res,'assets-finance.html',false,'Assets finance unavailable')` route.
- [ ] **Step 3** — `_shell.js`: Insights child `{ id:'assets-finance', label:'Assets — Finance & Licences', icon:ICON_LIB['wallet'], href:'assets-finance.html', roles:['any'] }` after `assets-hygiene`. Add `wallet` (or reuse an existing money-ish glyph) to `brand/icons.js` + `ICON_LIB`.
- [ ] **Step 4 — VERIFY IN BROWSER (mandatory).** `preview_start` sdp-dashboard (port from `.claude/launch.json`), seed a few assets (with finance cols) + licences into the sqlite `assets.db`, set `xof_usd_rate` in config, **restart (stop+start, not reload — `_htmlCache`)**, mint an admin PG session (dev `.env` = `REPORTS_BACKEND=postgres`, as prior browser checks did). Load `/assets-finance.html`: confirm the Finance table shows USD values (not raw XOF), the rate is displayed, the book-value chart renders, the Licence donut + expiry tiles render, a licence drill loads, Export points at export.xlsx, ZERO console errors. Screenshot.
- [ ] **Step 5 — commit:** `feat(assets): Finance & Licences dashboard + Insights nav`.

---

## Task 7: Enrich the hygiene digest with Finance + Licence snapshots

**Files:** Modify `services/assetHygieneReport.js`, `tools/reports/send-hygiene.js`; Test extend `tests/asset-hygiene-report.test.js`.

- [ ] **Step 1 — failing test.** Extend `tests/asset-hygiene-report.test.js`: pass `opts.finance = { fleet:{book_value_usd:123456, ...}, by_site:[...] }` and `opts.licences = { expiry:{expired:3, expiring_90:5}, by_family:{...} }` to `buildHygieneDigest`. Assert the html contains a **Finance snapshot** (the USD fleet value, labelled USD/rate) and a **Licence snapshot** (expired=3, expiring=5); still NO raw `$`-as-XOF confusion (USD only); the existing assertions still pass; with `finance`/`licences` absent the digest still builds (backward-compatible).
- [ ] **Step 2** FAIL. **Step 3 — implement**: `buildHygieneDigest(summary, opts)` reads optional `opts.finance` + `opts.licences` and appends two table blocks (Finance: fleet value USD + top sites by value; Licences: expired/expiring counts + by-family line). Guard absent → skip the block (backward-compatible). Then `send-hygiene.js` `main()` fetches `getFinanceSummary({}, rate)` + `getLicenceSummary({})` and passes them as `opts.finance`/`opts.licences` (rate from cfg). Keep the armed-off gate + dedup unchanged.
- [ ] **Step 4** PASS (report + send-hygiene tests). **Step 5** `await-precedence` 5/5. **Step 6 — commit:** `feat(assets): enrich hygiene digest with Finance + Licence snapshots (USD)`.

---

## Task 8: Regression + CLAUDE.md + finish

- [ ] **Step 1 — full regression** `node --test --test-force-exit tests/` — the ~15 pre-existing dev-`.env` PG failures stay; nothing NEW red; `await-precedence` green; the Foundation + B suites green.
- [ ] **Step 2 — CLAUDE.md** Current-State entry (2026-07-18) + Known-Pitfalls rows: money is USD via `xof_usd_rate` (assets XOF×rate, licences native USD) + conversion only in `money.js`; the finance SUM uses `CAST(NULLIF(REPLACE(col,',',''),'') AS REAL)`; the two new hygiene kinds are NOT in the completeness score; depreciation schedule not in the SDP export (Current Book Value only); C-2 (purchased-vs-installed, 121k) still deferred. Point at the spec.
- [ ] **Step 3 — commit**, then finish-a-development-branch (merge is the controller's call per the autonomous grant).

---

## Done criteria
- [ ] `money.js` (parse+USD) pure + tested; `xof_usd_rate` config + admin field.
- [ ] Finance + licence columns captured; integration test green on real CSVs.
- [ ] `getFinanceSummary` (USD, per-site, % depreciated, refresh-due) + `getLicenceSummary`/`getLicenceExceptions` (families, expiry) dual-backend, await-covered.
- [ ] Two new hygiene kinds, completeness UNCHANGED.
- [ ] `/api/assets/{finance,licences}/*` — USD, kind→400, hostile-input-safe.
- [ ] Finance & Licences page in Insights ▾, **browser-verified showing USD**; digest enriched.
- [ ] Full suite green; no raw XOF shown on any Finance surface; C-2 deferred.
