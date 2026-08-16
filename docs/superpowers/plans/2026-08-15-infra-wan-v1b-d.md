# V1b-D — WAN Health dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** A per-site **WAN availability + quality** dashboard reading `wan_link_snapshots` (V1b-A) — a summary (latest week, all sites, per uplink) + a trend view (weekly/monthly, per site) so the archived Meraki numbers are visible over time (Meraki keeps ~60d; OPS is the long-term record). Read-only; config-gated; no schema/score/PPTX impact.

**Architecture:** pure `services/wanDashboard.js` (shape snapshot rows → summary + trend) → routes `GET /api/analytics/wan/{summary,trend}` + `POST /api/analytics/wan/sync` (in `routes/opmanager.js`) → `public/wan-health.html` (Insights nav, Chart.js).

**Spec:** `docs/superpowers/specs/2026-08-15-infra-wan-availability-quality-design.md` §4, §6, §13-D.

**Scope guard:** reads only; no writes to Meraki; the sync POST just runs the existing `sync-wan.main`.

---

## Task 1: pure `services/wanDashboard.js`

**Files:** Create `services/wanDashboard.js`. Test `tests/wan-dashboard.test.js`.

- [ ] **Step 1: failing test** —
  - `latestPerSite(rows)` → for each (site_id, uplink) keep the row with the **max period_start**; return grouped by site: `[{ site_id, uplinks: [{uplink, availability_pct, status_color, loss_pct_avg, latency_ms_avg, jitter_ms_avg, period_start, data_through}] }]`, sites ordered by site_id.
  - `trendSeries(rows)` → per uplink, an ordered-by-period_start series `{uplink, points:[{period_start, availability_pct, status_color, loss_pct_avg, latency_ms_avg}]}`.
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement (PURE)** — group + max-period_start reducer for `latestPerSite`; group-by-uplink + sort for `trendSeries`. No I/O.
- [ ] **Step 4: run → PASS.** **Step 5: commit** `feat(wan): V1b-D T1 — pure wanDashboard (latestPerSite + trendSeries)`.

---

## Task 2: routes `GET /api/analytics/wan/{summary,trend}` + `POST /sync`

**Files:** Modify `routes/opmanager.js` (add the 3 routes). Test extend `tests/opm-routes.smoke.test.js`.

- [ ] **Step 1: failing smoke** — seed a `wan_link_snapshot` (week) for MGO; `GET /api/analytics/wan/summary?period=week` (token) → 200 `{period, sites:[…]}` with the seeded site+uplink; `GET /api/analytics/wan/trend?site=MGO&period=week` → 200 `{site_id, series:[…]}`; unknown/empty → 200 well-formed empty; no token → 401; `POST /api/analytics/wan/sync` requires admin.
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement** in `routes/opmanager.js`:
  - `GET /api/analytics/wan/summary` (requireReportSession): `period = week|month`; `rows = await getWanSnapshots({ period_type: period })`; `sites = latestPerSite(rows)`; enrich each site with `site_name` from `listSites`; `res.json({ period, as_of, sites })`. Best-effort.
  - `GET /api/analytics/wan/trend` (requireReportSession): resolve `site=` via the SAME tolerant `resolveSiteParam` used by opmanager availability (probe/opmanager code → meetings code → name); `rows = await getWanSnapshots({ site_id, period_type })`; `res.json({ site: code, site_id, site_name, period, series: trendSeries(rows) })`; unknown site → `{site_id:null, series:[]}`.
  - `POST /api/analytics/wan/sync` (requireAdmin): `await require('../tools/meraki/sync-wan').main({})` → return its result.
- [ ] **Step 4: run → PASS.** **Step 5: commit** `feat(wan): V1b-D T2 — /api/analytics/wan/{summary,trend,sync}`.

---

## Task 3: `public/wan-health.html` + nav

**Files:** Create `public/wan-health.html`. Modify `server.js` (`_htmlCache` boot-load + `sendHtmlPage` route), `public/_shell.js` (nav entry + ICON_LIB key if needed).

- [ ] **Step 1: implement** — a standalone page (loads `_shell.js`, brand tokens, Chart.js from the existing CDN allowlist) with: a **site selector** + **period toggle** (week/month); a **summary grid** (per site: wan1/wan2 availability% with RAG dot + loss/latency/jitter, "stale" flag); a **trend chart** (Chart.js line: availability% per uplink over time on the primary axis + loss% on a secondary axis) for the selected site; a **"⚡ Sync now"** button (admin, `POST /sync`); an empty/collecting-data state ("no WAN snapshots yet — set meraki_api_key + run the sync"). Reads `/api/analytics/wan/summary` + `/trend`. Reuse the destroy-on-refresh Chart pattern from the assets pages.
  - Nav: add a `wan-health` child under **Insights** in `_shell.js` NAV (icon e.g. `activity`/`trending-up` from ICON_LIB — reuse an existing key; add to ICON_LIB only if missing). `data-section=performance data-current=wan-health` on the page mount.
- [ ] **Step 2: wire server** — add `'wan-health.html'` to the `_htmlCache` boot-load list + a `sendHtmlPage` route (`injectApiKey=false`, session via cookie).
- [ ] **Step 3: verify** — `node -c server.js`; page HTML parses; **browser E2E behind session = user step** (a throwaway `_shell.js` NAV harness per-role if feasible). **Step 4: commit** `feat(wan): V1b-D T3 — wan-health.html page + Insights nav`.

---

## Task 4: Regression + docs

- [ ] **Step 1:**
```
node --test --test-force-exit tests/wan-dashboard.test.js tests/await-precedence.test.js
REPORTS_BACKEND=sqlite node --test --test-force-exit tests/opm-routes.smoke.test.js
node --test --test-force-exit tests/pptx-monthly-golden.test.js
```
Expected green; goldens unchanged.
- [ ] **Step 2: CLAUDE.md** — V1b-D Current-State block: WAN Health dashboard landed, reads wan_link_snapshots, inert until meraki_api_key set + snapshots exist; numbers trustworthy after the A calibration gate.
- [ ] **Step 3: nightly** — the sync-wan cron is already registered (V1b-A adds the collector; if the cron isn't wired in server.js yet, add `cron.schedule('20 5 * * *', …sync-wan.main…)` staggered after V1a's 05:10 — VERIFY at build whether it exists).
- [ ] **Step 4: commit** `feat(wan): V1b-D T4 — regression + docs (+cron if missing)`.

---

## Sequencing note
V1b-D visualizes A's store. The numbers are trustworthy once A's **calibration** passes; until then the page shows provisional values (the summary carries the same stale/basis cues as the report fill).
