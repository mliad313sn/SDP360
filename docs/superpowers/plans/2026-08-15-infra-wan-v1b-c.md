# V1b-C — Site-report Infrastructure KPIs auto-fill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** When a coordinator opens a weekly report, pre-fill the **empty** Infrastructure KPIs *Current Value* cells that we can measure — **WAN1/WAN2** from `wan_link_snapshots` (V1b-A), **LAN/WLAN/Servers** from `infra_metric_snapshots` (V1b-B). Editor overrides any cell; nothing persists until Save; unconfigured/no-snapshot → silent no-op (report behaves as today). **No schema change to `infra_kpis`. No PPTX/email/score impact.**

**Architecture:** pure `services/opmReportFill.js` (map service-name→fill key + build the fills from snapshots) → `GET /api/reports/:id/infra-auto` (resolve report → site_id + Zoho-Sunday `start_date` → read both stores → fills) → `public/reports.html` client (fill empty cells on open + a "⚡ Fill" button, banner + per-cell tooltip).

**Spec:** `docs/superpowers/specs/2026-08-15-infra-wan-availability-quality-design.md` §6, §10.

**Scope guard:** override = empty-cell-only (stateless, no flag); colour + trend come from the snapshot (single band, agrees with the WAN dashboard); Backup + Radio stay manual; the endpoint is best-effort.

---

## Task 1: pure `services/opmReportFill.js`

**Files:** Create `services/opmReportFill.js`. Test `tests/opm-report-fill.test.js`.

- [ ] **Step 1: failing test** —
  - `serviceToFill(name)` → `'wan1'|'wan2'|'lan'|'wifi'|'servers'|null` (normalize; **wlan/wifi/wireless before wan**; `lan` not matching `wlan`; Backup/Radio/custom → null; "WAN 1"/"WAN1"→wan1).
  - `buildFills({ wan, infra })` (wan = `wan_link_snapshots` rows, infra = `infra_metric_snapshots` rows) → array of `{ match, value, status_color, trend, stale, basis, source, data_through }`: a wan row (uplink wan1/wan2, metric availability) → `match=uplink`, `value=<availability_pct>%` (null → skipped), colour/trend from the row, `stale` from `data_through` vs a passed `staleDays`+`nowMs`; an infra row (family lan/wifi/servers) → `match=family`, `value=<metric_value>%`, `basis` from the row (`'recent'`), trend null. **A null metric_value/availability_pct → NO fill entry** (nothing to fill).

- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement (PURE)** — `serviceToFill`: lowercase+trim; `/wlan|wifi|wireless/`→`wifi`; `/wan\s*1/`→`wan1`; `/wan\s*2/`→`wan2`; `/\bserver/`→`servers`; `/\blan\b/` (after wlan) → `lan`; else null. `buildFills({wan,infra,staleDays,nowMs})`: map each source row to a fill entry, format `value = round1(x)+'%'`, skip when the metric is null. Export both + `serviceToFill`.
- [ ] **Step 4: run → PASS.** **Step 5: commit** `feat(wan): V1b-C T1 — pure opmReportFill (serviceToFill + buildFills)`.

---

## Task 2: `GET /api/reports/:id/infra-auto`

**Files:** Modify `server.js` (route near the other `/api/reports/:id/<word>` siblings). Test extend a reports route smoke OR a focused smoke `tests/infra-auto-route.smoke.test.js`.

- [ ] **Step 1: failing smoke** (boot app sqlite; seed a report for a site + a wan_link_snapshot + an infra_metric_snapshot at the report's `start_date`): `GET /api/reports/<id>/infra-auto` (editor token) → 200 `{week_label, fills:[…]}` with a `wan1` fill + a `lan` fill; a report with no snapshots → `{fills:[]}`; unknown id → 404/`{fills:[]}` not 500; no token → 401.
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement** — `app.get('/api/reports/:id/infra-auto', requireReportSession, async (req,res) => {…})` (register beside `/open-changes`/`/active-incidents`/`/infra`): `getReport(id)` → 404 if absent; `site_id = report.site_id`, `start = report.start_date` (Zoho Sunday); `cfg = await getConfig`; `staleDays = parseInt(cfg.opm_stale_days)||9`; `wan = await getWanSnapshots({site_id, period_type:'week', period_start:start})`; `infra = await getInfraSnapshots({site_id, period_type:'week', period_start:start})`; `fills = buildFills({wan, infra, staleDays, nowMs: Date.now()})`; `res.json({ week_label: report.week_label, fills })`. Wrap in try/catch → `res.json({fills:[]})` (best-effort, never 500). **All rdb calls awaited** (pg Promises).
- [ ] **Step 4: run → PASS.** **Step 5: commit** `feat(wan): V1b-C T2 — GET /api/reports/:id/infra-auto`.

---

## Task 3: `public/reports.html` — client prefill + override + button

**Files:** Modify `public/reports.html`.

- [ ] **Step 1: implement** — after `renderInfra()` on opening an **editable** report (status not `submitted`), call `maybeAutoFillInfra()`:
  - fetch `/api/reports/${currentReport.id}/infra-auto`; if `fills.length`, for each rendered infra row: `key = _serviceToFill(serviceInputValue)` (small inline mirror of `serviceToFill`, commented); `f = fills.find(x=>x.match===key)`; if `f` AND the Current Value input is **empty** → set the value input to `f.value`, set the status `<select>` to `f.status_color`, set the trend `<select>` to `f.trend||'stable'`, and mark the row (subtle background + `title` = "Auto · <source> · data through <data_through> · basis <basis>" or "stale").
  - show a banner "⚡ N values auto-filled from OPManager/Meraki (week <week_label>) — override any cell" (dismissible), and add a "⚡ Fill from OPManager/Meraki" button next to "Copy from Previous Week" that re-runs `maybeAutoFillInfra()` (empty cells only).
  - Never clobber a non-empty cell. Never touch Backup/Radio (serviceToFill → null).
- [ ] **Step 2: verify** — `node -e "new Function(require('fs').readFileSync('public/reports.html','utf8').match(/maybeAutoFillInfra[\s\S]*?\n}/)[0])"` sanity (best-effort) + full-page load in a throwaway harness if feasible. **Browser E2E is the user's step** (editor behind session). **Step 3: commit** `feat(wan): V1b-C T3 — reports.html infra auto-fill (empty-cell override) + button`.

---

## Task 4: Regression + docs

- [ ] **Step 1:**
```
node --test --test-force-exit tests/opm-report-fill.test.js
REPORTS_BACKEND=sqlite node --test --test-force-exit tests/infra-auto-route.smoke.test.js
node --test --test-force-exit tests/report-template-weekly.test.js tests/site-report-helpdesk-weekly.test.js tests/pptx-monthly-golden.test.js tests/await-precedence.test.js
```
Expected green; **weekly-report/`infra_kpis` goldens unchanged** (V1b-C only prefills the editor's draft; saved rows are ordinary `infra_kpis`).
- [ ] **Step 2: CLAUDE.md** — V1b-C Current-State block + pitfalls: (a) fill is empty-cell-only, stateless, no `infra_kpis` schema change; (b) colour/trend from the snapshot (single band), not `autoInfraStatusTrend`; (c) LAN/WLAN/Servers show `basis:'recent'` in the tooltip (not the exact week — V1b-B); (d) the `_serviceToFill` client mirror must track `services/opmReportFill.js`.
- [ ] **Step 3: commit** `feat(wan): V1b-C T4 — regression + docs`.

---

## Sequencing note
V1b-C reads A + B. Numbers are only trustworthy after A's **calibration** + B's **discovery** gates pass; until then the fill surfaces provisional values (the tooltip says so). V1b-D (WAN Health dashboard) is independent of C.
