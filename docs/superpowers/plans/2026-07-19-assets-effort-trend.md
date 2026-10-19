# Assets — Asset-manager effort trend dashboard — Plan

**Goal:** A per-site **effort-over-time** dashboard so sites are visibly comparable in meetings (nobody wants to be the site making no effort) — a composite **effort score** per site + its **Δ vs the previous period**, a leaderboard, and trend charts. Data captured going forward via a nightly snapshot (the current tables have no history — full-replaced each night). Reader exposed so weekly/monthly reports can embed a slice later.

**User decisions:** effort = **current level % + progression (Δ)**; a **composite effort score** per site (simple **unweighted** mean of the six good-state percentages) with per-component detail on click.

**Architecture:** New append-only `asset_effort_history` table + a `snapshotEffort()` job (piggybacks the nightly assets sync + a manual trigger). Trend/leaderboard readers on `assets-db.js` (dual-backend). A **5th "Progress" tab** on the unified `public/assets.html`. Backend reuses `HYGIENE_KINDS` predicates for the per-site counts.

**Branch:** `feat/assets-effort-trend` (from `main`).

## The effort score (locked)
Per site with `total>0`, six **good-state percentages** (= 1 − worklist/total, clamped [0,1]):
`cost_pct`, `age_pct`, `owner_pct`, `scan_pct` (= 1 − never_scanned/total), `tag_pct` (= 1 − no_asset_tag/total), `enrolled_pct` (= 1 − discovered/total).
**`effort_score = round(100 × mean(the 6))`** (simple mean, no weights). `total=0` → score null (site excluded). Each pct is `SUM(CASE…)/total` so it is inherently in [0,1] — the clamp is defensive only, never reached. Ghost stored as detail (scan-freshness), NOT in the score (avoids double-counting scan — `scan_pct` uses `never_scanned`, never `ghost`).

**Δ is a LOOKBACK delta, not day-over-day** (review I4): snapshots are nightly and the fleet barely changes night-to-night, so `latest − second-latest` would read ≈0 in exactly the meeting this exists for. **`Δ = latest_score − baseline_score`, where baseline = the snapshot on/nearest-before ~30 days prior to `asOf`** (fall back to the EARLIEST snapshot in the trend window if none is that old). This makes "effort made" visible over the arc, not the night. A site with only its first snapshot → baseline/Δ null.

**Site NULL-safety (review C1 — load-bearing):** `site` is nullable in `assets` (the enriched rollups use `COALESCE(a.site,'')`). The snapshot's `GROUP BY` MUST be over `COALESCE(site,'')` so a NULL-site asset lands in the `''` bucket — else a NULL group is inserted into `site TEXT NOT NULL PK`, the snapshot throws, Task 1's try/catch swallows it, and the dashboard is silently empty forever.

---

## Ground rules
- `ASSETS_BACKEND=sqlite|postgres`; tests sqlite. New dual-backend readers dispatch first-statement; callers await. Reuse `_assetWhere` + `HYGIENE_KINDS` predicates.
- Snapshot is **idempotent per day** — one row per (snapshot_date, site); re-running the same day upserts (no dupes). Append-only across days.
- Commit after every green step. Tests: `node --test --test-force-exit tests/<file>.test.js`.

---

## Task 0: History table + `snapshotEffort()` + wiring

**Files:** Modify `db/postgres/assets/001_init.sql`, `assets-db.js`; Test `tests/assets-effort-snapshot.test.js`.

- [ ] **Step 1 — failing test.** Seed `assets` (+ memory/drives/monitors as needed) across 2 sites with varied owner/cost/age/tag/state/scan so the 6 components differ. Call `snapshotEffort({ asOf:'2026-07-19' })` then read `asset_effort_history`: assert one row per site for that date, with `total`, the 6 counts (`no_cost`/`no_age`/`no_owner`/`never_scanned`/`no_asset_tag`/`discovered`), `ghost`, the 6 pcts, and `effort_score` = round(100×mean(6 pcts)) (hand-compute one site). Re-run `snapshotEffort({asOf:'2026-07-19'})` → still ONE row per site (idempotent upsert, not doubled). A second date `snapshotEffort({asOf:'2026-07-20'})` → a second row per site. Run → FAIL.
- [ ] **Step 2** FAIL. **Step 3 — implement:**
  - `001_init.sql`: `CREATE TABLE IF NOT EXISTS asset_effort_history ( snapshot_date TEXT NOT NULL, site TEXT NOT NULL, total INTEGER, no_cost INTEGER, no_age INTEGER, no_owner INTEGER, never_scanned INTEGER, no_asset_tag INTEGER, discovered INTEGER, ghost INTEGER, cost_pct REAL, age_pct REAL, owner_pct REAL, scan_pct REAL, tag_pct REAL, enrolled_pct REAL, effort_score REAL, PRIMARY KEY (snapshot_date, site) );` (new table → CREATE-IF-NOT-EXISTS on both backends, no ALTER). Add `'asset_effort_history'` to `_ASSET_TABLES` (assets-db.js). (Do NOT add it to `assets-sync.js ASSET_VIEWS` — it's NOT synced from AP; and NOT to `copy-assets.js TABLES` unless you want it copied — it's history, leave it out of the AP-view parity, but if the integration test asserts ASSET_VIEWS===copy-assets tables that's unaffected since this table isn't an ASSET_VIEW.)
  - `snapshotEffort({asOf})` dual-backend (`if (ASSETS_BACKEND==='postgres') return _snapshotEffortPg(...)`). Compute per-site counts via `GROUP BY COALESCE(site,'')` (**C1** — never bare `GROUP BY site`; NULL site → `''` bucket, not a NULL PK insert) using the `HYGIENE_KINDS` predicate strings (`SUM(CASE WHEN (<pred>) THEN 1 ELSE 0 END)` for no_cost/no_age/no_owner/never_scanned/no_asset_tag/discovered/ghost) + `COUNT(*) total`. In JS: derive the 6 pcts (guard total=0 → skip the site) + `effort_score`. UPSERT each site's row for `asOf` (sqlite `INSERT OR REPLACE`; pg `ON CONFLICT (snapshot_date,site) DO UPDATE`). `asOf` default = today (`new Date().toISOString().slice(0,10)`) — resolve BEFORE the query (do not pass undefined). Return `{date, sites: n}`.
  - Add a test row with `site=NULL` and assert the snapshot does NOT throw and produces a `''`-site row (the C1 regression guard).
  - Export `snapshotEffort`.
- [ ] **Step 4** PASS (idempotent + 2-date). **Step 5** `await-precedence` 5/5 + assets suite green. **Step 6 — commit:** `feat(assets): effort-history table + snapshotEffort (idempotent per day)`.

## Task 1: Wire the snapshot to the nightly sync + manual trigger

**Files:** Modify `server.js`. Test: extend the existing assets sync-trigger smoke or a tiny route smoke.

- [ ] **Step 1 (review I2 — CHAIN after the sync resolves, don't fire alongside).** Both existing call-sites are fire-and-forget (`cron.schedule('30 4 * * *', … syncAllAssets().catch(...))` + the manual `POST /api/sync/trigger/assets` which `res.json()`s then `syncAllAssets().catch(...)`). Restructure BOTH to `syncAllAssets().then(() => require('./assets-db').snapshotEffort({})).catch(e => console.error('[snapshotEffort]', e && e.message))` — so the snapshot runs against the JUST-REPLACED data, never the previous night's / an empty table / mid-transaction. The `.catch` MUST **log** (never silently swallow — C1's failure mode), and must not break the sync. **A snapshot on the very first run seeds the baseline** so the dashboard isn't empty.
- [ ] **Step 2** — a small smoke: `POST /api/sync/trigger/assets` still 200s (the snapshot is chained after the async sync, errors caught+logged). `await-precedence` 5/5. **Step 3 — commit:** `feat(assets): snapshot effort after nightly + manual assets sync`.

## Task 2: Trend + leaderboard readers

**Files:** Modify `assets-db.js`; Test `tests/assets-effort-readers.test.js`.

- [ ] **Step 1 — failing test.** Seed `asset_effort_history` directly (via `replaceTable('asset_effort_history',cols,rows)`) with 2-3 dates × 2 sites of known scores. Assert:
  - `getEffortLeaderboard({asOf})` → per-site `{site, effort_score (latest ≤ asOf), baseline_score (on/nearest-before ~30d prior, else earliest in window), delta, rank}` sorted by score desc; plus `most_improved` (the site with the max POSITIVE delta — **null** when no site has a positive delta or all deltas are null, review M6) + `needs_attention` (the lowest-scoring site with `effort_score < 50` AND `delta ≤ 0` — concrete `<50` cutoff, review M5). A site with only its first snapshot → `baseline_score`/`delta` null (not a crash). ZERO history rows → empty-but-valid (`[]`, most_improved/needs_attention null).
  - `getEffortTrend(filters, {months})` → `{ dates:[...], sites:[{site, scores:[...aligned to dates...], components?:{...latest...}}] }` — the per-site effort_score time series over the window. **A site absent on a given date emits `null` at that index (review M7 — a gap = "no snapshot", NOT a false drop to 0).** Site filter narrows to one site + returns its 6-component series for the detail-on-click.
  - Unknown/no data → empty-but-valid shape (no throw).
- [ ] **Step 2** FAIL. **Step 3 — implement** both readers dual-backend (dispatch first-statement; SELECT from `asset_effort_history`, aggregate in JS — small table). Leaderboard: latest row per site ≤ asOf; baseline = the row on/nearest-before `asOf−30d`, else the earliest row in the window; delta = latest−baseline (null when no baseline). Trend: rows within the last `months`, grouped by site, scores aligned to the sorted distinct dates with `null` for missing (M7). Export `getEffortLeaderboard, getEffortTrend`.
- [ ] **Step 4** PASS. **Step 5** `await-precedence` 5/5. **Step 6 — commit:** `feat(assets): effort leaderboard + trend readers (score + Δ)`.

## Task 3: Routes

**Files:** Modify `server.js`; Test `tests/assets-effort-routes.smoke.test.js`.

- [ ] **Step 1 — failing smoke.** `GET /api/assets/progress/leaderboard` → 200 with an array + most_improved/needs_attention; `GET /api/assets/progress/trend[?site=&months=]` → 200 with dates+sites; `POST /api/assets/progress/snapshot` (admin) → 200 (runs `snapshotEffort` now — a manual "capture a point" for demos/first baseline); no-session → 401/403; hostile input safe.
- [ ] **Step 2** FAIL. **Step 3 — implement** the routes (`requireReportSession`; snapshot POST `requireAdmin`), whitelisted filters. **Step 4** PASS. **Step 5** await-precedence 5/5 + syntax + prior route smokes green. **Step 6 — commit:** `feat(assets): /api/assets/progress/{leaderboard,trend,snapshot}`.

## Task 4: "Progress" tab on the unified module + browser verify

**Files:** Modify `public/assets.html`. Browser-verify.

- [ ] **Step 1** — add a **5th tab "Progress"** (the 4-edit tab pattern: `TABS` += `'progress'`, `PANE` += `progress:'PROG_PANE'`, `inited` += `progress:false`, the `<button class="tabbtn" data-tab="progress">Progress</button>` + `<section id="pane-progress" class="tabpane">` — **id MUST be `pane-progress`**, matching `activate()`'s `getElementById('pane-'+t)`, review N10). A `PROG_PANE` module (`prog-` ids, own Chart canvas, reuse the existing `upsertChart(...)` destroy-on-refresh helper, lazy-init, reads shared `filters()`):
  - A **leaderboard table**: Site · Effort score · Δ (green ▲ / red ▼ badge, "—" when null) · Rank — sortable by score or by Δ (a small toggle). Clicking a site row → the per-component detail (the 6 good-state pcts, latest) + that site's trend.
  - **"Most improved"** + **"Needs attention"** callouts from the leaderboard (hide gracefully when null).
  - A **multi-line trend chart** (effort score per site over time) from `/progress/trend`.
  - An **empty/collecting-data state** when there are < 2 snapshots ("Effort trends build up as nightly snapshots accumulate — check back after a few days"), plus a **"Capture a snapshot now"** button (admin) → `POST /api/assets/progress/snapshot` then refresh (so a demo/baseline can be seeded immediately).
  - **(review I3 — filter note)** Effort is a **per-site** metric (the history table is site-grained). Only the shared **Site** filter applies on this tab; State/Product-Type/Manufacturer do NOT recompute the score. Add a small "site filter only" note (mirror the Software tab's "site filter N/A" precedent). Site filter = **highlight the matching row + focus the trend on that site**, NOT collapse the leaderboard to one row (a one-row leaderboard is pointless).
  - A one-line note: "Composite effort score = mean of six good-state rates (cost · age · owner · scan · tag · enrolled). Δ vs ~30 days ago = effort made."
- [ ] **Step 2 — VERIFY IN BROWSER (mandatory).** `preview_start`, admin PG session, seed a couple of assets + **two `asset_effort_history` dates** (so the trend + Δ render), **restart**. Load `/assets.html`, click **Progress**: leaderboard renders with scores + Δ badges, most-improved/needs-attention show, the trend chart renders, clicking a site shows its components, the "Capture snapshot now" button works, the empty-state shows when history is cleared. Shared Site filter narrows. Zero console errors. Screenshot/DOM-read.
- [ ] **Step 3 — commit:** `feat(assets): Progress tab — per-site effort score, Δ, leaderboard + trend`.

## Task 5: Regression + CLAUDE.md + finish (+ report hook)

- [ ] **Step 1 — regression** `node --test --test-force-exit tests/assets-*.test.js tests/await-precedence.test.js` → green.
- [ ] **Step 2 — CLAUDE.md** Current-State entry (2026-07-19): a per-site effort-trend dashboard (composite score = mean of 6 good-state rates + Δ) on a new Progress tab; a nightly `snapshotEffort()` into append-only `asset_effort_history` (no backfill — trends start from first snapshot) after the assets sync; readers `getEffortLeaderboard`/`getEffortTrend` exposed for later weekly/monthly report integration. Point at this plan. Add a pitfall row: the effort dashboard has NO history until snapshots accumulate (tables are full-replaced nightly) — the snapshot job is the ONLY source of the trend; seed a baseline via the manual snapshot on deploy.
- [ ] **Step 3 — report hook (note, not build):** leave `getEffortLeaderboard`/`getEffortTrend` exported + documented so the coordinator/hygiene digest can embed a per-site effort line later (the user said "intégrer plus tard"). Do NOT wire it into the weekly/monthly reports now.
- [ ] **Step 4 — commit**, then finish-a-development-branch.

---

## Done criteria
- [ ] Append-only `asset_effort_history` + idempotent-per-day `snapshotEffort()`, wired to the nightly + manual sync; baseline seeds on first run.
- [ ] Composite effort score (mean of 6 good-state rates) + Δ; leaderboard (score/Δ/rank + most-improved/needs-attention) + trend readers, dual-backend, await-covered.
- [ ] `/api/assets/progress/{leaderboard,trend,snapshot}` — safe, admin-gated snapshot.
- [ ] Progress tab (leaderboard + callouts + trend chart + component detail + empty-state + capture-now), shared filter, **browser-verified**.
- [ ] Full assets suite green; readers exposed for later report integration; no-backfill reality documented.
