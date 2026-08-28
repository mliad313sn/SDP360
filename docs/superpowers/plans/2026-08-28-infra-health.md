# Infrastructure Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only "Infrastructure Health" page (Infrastructure nav) showing per-site × family (WAN/LAN/WLAN/Servers) availability with target/RAG + MoM Δ, a LAN/WLAN/Servers trend chart, and a coverage/governance panel — complementing OpManager, not replacing it.

**Architecture:** A pure `services/infraHealth.js` merges the existing OpManager availability (LAN/WLAN/Servers) with a per-site WAN roll-up (Meraki) into one matrix + computes the roll-up/Δ; two thin routes `/api/analytics/infra/{summary,trend}` in `routes/opmanager.js` feed a bilingual page that reuses the Group View patterns from `site-awareness.html`. No new storage, no sync change.

**Tech Stack:** Node/Express, dual-backend sqlite/postgres (readers return a Promise on pg — await everything), `node --test`, vanilla-JS page + Chart.js (CDN), Lucide icons.

**Spec:** `docs/superpowers/specs/2026-08-28-infra-health-design.md`

---

## Architecture note — WAN basis (refines spec §3.1 after reading the code)

Reading `routes/opmanager.js:210-224`: the **WAN summary route's PRIMARY `availability_pct` is the snapshot "% Time Up"** (restored at `:220`); the event-based figure is only the **secondary** `avail_event_pct`. `wanDashboard.latestPerSite` returns that same stored `availability_pct`. Therefore the matrix WAN cell = **`latestPerSite`'s `availability_pct` rolled up per site (min across uplinks)** is **identical to what `wan.html` shows as its headline**, by construction — no contradiction, and **no extraction of the inline event logic is needed** (spec review finding #4 is avoided; finding #1's premise — that the snapshot value would disagree with wan.html — does not hold against `:220`). QA in Task 7 verifies matrix WAN % == wan.html WAN headline for a sample site. The event-based value is wan.html's own secondary concern and stays there.

## File structure

| File | Responsibility |
|---|---|
| `services/infraHealth.js` (new) | PURE: `rollupRag`, `trendOf`, `buildInfraMatrix`, `buildInfraTrend`, `wanRollup`. No I/O, `asOf` injected. |
| `routes/opmanager.js` (modify) | +2 routes `/api/analytics/infra/{summary,trend}` beside the existing opmanager/wan routes. |
| `public/infra-health.html` (new) | The page: bilingual, 6 blocks, reuses Group View render patterns. |
| `public/_shell.js` (modify) | +1 Infrastructure nav child + `activity` in `ICON_LIB`. |
| `public/brand/icons.js` (modify) | +`activity` Lucide glyph. |
| `server.js` (modify) | `_htmlCache` boot-load + `sendHtmlPage` route for the page. |
| `tests/infra-health.test.js` (new) | Pure merge + trend unit tests. |
| `tests/infra-health-routes.smoke.test.js` (new) | Route smoke tests (dual-backend sqlite). |

---

## Task 1: Pure `buildInfraMatrix` + roll-up helpers

**Files:**
- Create: `services/infraHealth.js`
- Test: `tests/infra-health.test.js`

Copy `rollupRag` (green=2/amber=1/red=0, ≥.75 green / ≥.5 amber / else red, all-na→na) and `ragOrd`/`trendOf` from `routes/siteAwareness.js:82-89`. **Status-vocab normalization (review #3):** opm `status_color` is `'orange'`/`'none'` (`fillFamilies`, `opmanager.js:62-74`) and the WAN band yields `'orange'`; `rollupRag`/`ragOrd`/the page helpers expect **green/amber/red/na** — so `buildInfraMatrix` MUST map `orange→amber`, `none→na` on every cell before rollup + output. **WAN target (review #2):** `latestPerSite` uplinks carry **no `target`** — pass `wanTarget` in (default 98, from `cfg.opm_targets.wan`, threaded by Task 3). `wanRollup(uplinks, wanTarget)` = min of non-null `availability_pct` (worst uplink), band `≥target green / ≥target×0.9 amber / else red`, na when none. **`overall_trend` (review #7):** derive from the present family trends (down if any family `down`, else up if any `up`, else `no_change`) — do NOT fetch a prior period.

- [ ] **Step 1: Write the failing test**

```js
const { test } = require('node:test'); const assert = require('node:assert');
const { buildInfraMatrix } = require('../services/infraHealth');

test('buildInfraMatrix merges opm families + WAN roll-up, normalizes vocab, computes overall + na', () => {
  const opmSites = [{ site_id: 1, site_name: 'Sabodala', families: [
    { kpi_family: 'lan', metric_value: 79.1, target: 99, status_color: 'red',    trend: 'no_change', stale: true },
    { kpi_family: 'wifi', metric_value: null, status_color: 'none' },
    { kpi_family: 'servers', metric_value: 98, target: 99, status_color: 'orange', trend: 'up', stale: true },
  ]}];
  const wanSites = [{ site_id: 1, uplinks: [ { availability_pct: 66.7 }, { availability_pct: 80 } ]}]; // NO target on uplinks
  const out = buildInfraMatrix({ opmSites, wanSites, wanTarget: 98, asOf: '2026-08-28' });
  const s = out.sites[0];
  assert.equal(s.families.wan.value, 66.7);            // min across uplinks
  assert.equal(s.families.wan.rag, 'red');
  assert.equal(s.families.wifi.rag, 'na');             // 'none' → na, not red
  assert.equal(s.families.servers.rag, 'amber');       // 'orange' normalized → amber
  assert.equal(s.families.lan.value, 79.1);
  assert.equal(s.overall_rag, 'red');                  // red+amber+na → red
});
```

- [ ] **Step 2: Run it — expect FAIL** `node --test --test-force-exit tests/infra-health.test.js`
- [ ] **Step 3: Implement `services/infraHealth.js`** — `rollupRag`, `ragOrd`, `trendOf`, `_normRag(c)` (`orange→amber`, `none→na`), `wanRollup(uplinks, wanTarget)`, `_cell`, `buildInfraMatrix({opmSites, wanSites, wanTarget, targets, asOf})` merging normalized opm families {lan,wifi,servers} + `wanRollup` → `{sites:[{site_id, site_name, overall_rag, overall_trend, families:{wan,lan,wifi,servers}}], fleet:{by_family_counts, freshness}}`. Missing family → na. `module.exports`.
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** `git add services/infraHealth.js tests/infra-health.test.js && git commit -m "feat(infra-health): pure buildInfraMatrix + WAN roll-up"`

## Task 2: Pure `buildInfraTrend`

**Files:** Modify `services/infraHealth.js`; Test `tests/infra-health.test.js`

`buildInfraTrend({ opmMonthly, months, asOf })` → `{ labels:[YYYY-MM…contiguous ending at asOf], series:{ lan:[], wifi:[], servers:[] } }`. **Filter `metric_name === 'availability'` first (review #6)** — `getInfraSnapshots` is `SELECT *` across all metric_names (`reports-db.js:2685`); `fillFamilies` filters the same way (`opmanager.js:62`). Then group by `period_start` (YYYY-MM) × family; **null for months with no snapshot** (never 0). No WAN series (v1).

- [ ] **Step 1: Failing test** — feed opmMonthly rows for 2 non-contiguous months + assert the axis is contiguous, gaps are `null`, and a family present only some months has `null` elsewhere.
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement** `buildInfraTrend` (build the month axis from `asOf` back `months`; index rows by `substr(period_start,1,7)` × family).
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** `git commit -am "feat(infra-health): pure buildInfraTrend (LAN/WLAN/Servers, null gaps)"`

## Task 3: Route `GET /api/analytics/infra/summary`

**Files:** Modify `routes/opmanager.js` (add near the opmanager `/availability` route); Test `tests/infra-health-routes.smoke.test.js`

Guard: **`requireReportSession` only** (review #5 — match the sibling opmanager/wan routes + the `roles:['any']` nav child; NOT group-scoped). Fetch: OpManager availability (same code the `/opmanager/availability` route uses — `getInfraSnapshots` + `fillFamilies`), WAN via `wanDashboard.latestPerSite(await rdb.getWanSnapshots({period_type}))`, **`cfg.opm_targets.wan`** (default 98, parse like `opmanager.js:181`) threaded as `wanTarget`, and coverage. **Coverage is the BODY of the `/opmanager/coverage` route (`opmanager.js:119-145`), not a one-line reader (review #4)** — extract a `_coverage(cfg)` helper (config gate → REST `listDevices` OR analytics `fetchView` → `coverageSummary`; returns `{available, source, total, included, excluded, by_family, unmapped_probes}`) and call it from BOTH the existing coverage route and here. Hand opm+wan+wanTarget to `buildInfraMatrix`; attach `coverage` (incl. `available:false`). Best-effort: any source throwing → that family na / coverage `{available:false}`, never 500. Return `{ period, as_of, sites, fleet, coverage }`.

- [ ] **Step 1: Smoke test** (mirror `tests/site-awareness-routes.smoke.test.js` `call()` using core `http`, NOT fetch): assert 200, `sites[]`, each site has `families.{wan,lan,wifi,servers}` + `overall_rag`, and `coverage` present. Seed a throwaway sqlite via `SDP_DATA_DIR`.
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement the route.** Await all readers (pg-Promise). Reuse `resolveSiteParam`/`fillFamilies` already in the file.
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** `git commit -am "feat(infra-health): GET /api/analytics/infra/summary"`

## Task 4: Route `GET /api/analytics/infra/trend`

**Files:** Modify `routes/opmanager.js`; Test `tests/infra-health-routes.smoke.test.js`

Resolve site (`resolveSiteParam`, tolerant). Read `getInfraSnapshots({ site_id, period_type: 'month' })` (**already returns full monthly history — no reader change**). Hand to `buildInfraTrend`. Empty history → `{ labels:[], series:{} }`, never 500.

- [ ] **Step 1: Smoke test** — `/infra/trend?site=<code>` returns 200 with `labels`/`series`; unknown site → empty, not 500.
- [ ] **Step 2: Run — FAIL**  → **Step 3: Implement**  → **Step 4: Run — PASS**
- [ ] **Step 5: Commit** `git commit -am "feat(infra-health): GET /api/analytics/infra/trend"`

## Task 5: Nav entry + `activity` icon

**Files:** Modify `public/brand/icons.js`, `public/_shell.js`

Add `activity` Lucide glyph to `brand/icons.js` LIB: `'activity': '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'`. Add `activity: ICONS.html('activity')` to `_shell.js` `ICON_LIB` (the hand-curated subset — REQUIRED or the icon renders empty). Add the nav child to the Infrastructure group in `_shell.js`: `{ id: 'infra-health', label: 'Infrastructure Health', icon: ICON_LIB.activity, href: 'infra-health.html', roles: ['any'] }`.

- [ ] **Step 1:** Add the glyph + ICON_LIB key + nav child.
- [ ] **Step 2:** `node --check public/_shell.js && node --check public/brand/icons.js` → OK; `node -e "const I=require('./public/brand/icons.js');console.log(!!I.html('activity'))"` → `true`.
- [ ] **Step 3: Commit** `git commit -am "feat(infra-health): Infrastructure Health nav entry + activity icon"`

## Task 6: The page `public/infra-health.html` + server wiring

**Files:** Create `public/infra-health.html`; Modify `server.js`

Standalone page: `#__shell data-section="infrastructure" data-current="infra-health"`, loads `_tokens.css`/`brand/*`/`_shell.js` (nonce), Chart.js CDN, Google Fonts. Bilingual (`data-lng` + `I18N`/`T()` + `sa_lang_v1`-style toggle). Fetch `/api/analytics/infra/summary?period=` then render the 6 blocks; on row-click fetch `/api/analytics/infra/trend?site=` + render Chart.js line (spanGaps:false) + governance from the summary's `coverage`. **Reuse the Group View patterns verbatim** from `site-awareness.html`: RAG cell, `trendChip` (▲/▼), worst-first `sevScore` sort, red-row emphasis, KPI strip, one-line read-out. Governance handles `coverage.available===false` → "coverage not configured". `server.js`: add `'infra-health.html'` to the `_htmlCache` boot-load list + a `sendHtmlPage(res, 'infra-health.html', false, …)` route (mirror `site-awareness.html`).

- [ ] **Step 1:** Build the page (copy Group View render helpers; adapt columns to WAN/LAN/WLAN/Servers/Global; add trend + governance panels; freshness banner from `fleet.freshness`/`stale`).
- [ ] **Step 2:** Verify: extract the main `<script>` and `new Function(src)` it (parse OK); grep the mount `data-section="infrastructure"`.
- [ ] **Step 3:** Wire `server.js` (boot-load + route). `node --check server.js`.
- [ ] **Step 4: Browser QA** (served mockup-style or via dev session): matrix renders 4 families + Global + Δ chips + worst-first; row-click swaps trend + governance; freshness banner shows; na cells "—"; `coverage:false` state; bilingual toggle; zero console errors.
- [ ] **Step 5: Commit** `git commit -am "feat(infra-health): Infrastructure Health page + server route"`

## Task 7: Integration QA + regression + WAN-consistency check

**Files:** none (verification)

- [ ] **Step 1:** `node --test --test-force-exit tests/infra-health.test.js tests/infra-health-routes.smoke.test.js` → all pass.
- [ ] **Step 2:** `node --test --test-force-exit tests/await-precedence.test.js` (covers the new dual-backend route dispatchers) + the wan/opmanager route smokes → green (no regression).
- [ ] **Step 3: WAN-consistency QA** — for one site+period, confirm the matrix WAN % equals the `wan.html` WAN headline (`/api/analytics/wan/summary` primary `availability_pct`, min across uplinks). Document the check.
- [ ] **Step 4:** Confirm `pptx-monthly-golden` + report suites are **untouched** (this feature adds no report/email/score path) — run the golden once to be sure.
- [ ] **Step 5: Final commit** (if any doc/checklist) + package note: `server.js` + `_shell.js` + `infra-health.html` are server/`_htmlCache` surfaces → deploy needs pm2 stop→wait→start.

---

## Notes / pitfalls (from CLAUDE.md)
- **Dual-backend:** every `rdb.*` reader is a Promise on pg — `await` before `.map`/`.find`. The pure `services/infraHealth.js` takes already-awaited arrays.
- **null ≠ 0:** a family with no devices → na/"—"; a trend month with no snapshot → null gap (`spanGaps:false`). Never 0.
- **ICON_LIB is a subset:** `activity` MUST be in BOTH `icons.js` and `_shell.js` ICON_LIB or the nav icon is empty (no error).
- **Smoke tests use core `http`**, not fetch (undici keep-alive breaks `--test-force-exit`) — copy `tests/site-awareness-routes.smoke.test.js`'s `call()`.
- **`_htmlCache`:** the page is boot-cached → prod deploy needs a pm2 restart, not reload.
