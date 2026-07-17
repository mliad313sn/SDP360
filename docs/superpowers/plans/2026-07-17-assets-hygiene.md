# Asset Module — Sub-project B (Hygiene CMDB) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A Group-IT CMDB-hygiene layer on top of the Foundation `assets` table: six exception reports, a completeness dashboard, Excel export, and a scheduled/armed email digest.

**Architecture:** Additive readers on `assets-db.js` (dual-backend, `ASSETS_BACKEND`), additive `/api/assets/hygiene/*` routes, a new dashboard page, a pure digest composer, and a `send-hygiene.js` CLI reusing the reporting-suite send infra (`mailer`, `reportSentLog`, `reportConfig`, `reportSchedule`, `tableExcel`). No new sync, no money displayed.

**Tech Stack:** Node, better-sqlite3 + `services/pgDb.js`, Express, `node:test`, Chart.js (CDN, already CSP-allowed), SheetJS via `services/tableExcel.js`.

**Spec:** `docs/superpowers/specs/2026-07-17-assets-hygiene-design.md` — read §2 (the six predicates + their traps) and §3 (completeness) before starting.

**Branch:** `feat/assets-hygiene` (already created from `main`).

---

## Ground rules (apply throughout)
- `ASSETS_BACKEND=sqlite|postgres`, default sqlite; tests run sqlite. Every dual-backend fn dispatches `if (ASSETS_BACKEND==='postgres') return _fooPg(...)` as its FIRST statement; every caller `await`s and never chains `.method()` onto the unawaited call. `tests/await-precedence.test.js` already scans `assets-db.js`.
- **No money anywhere.** Exception rows + Excel + digest carry identity/scan columns, never `purchase_cost` as a value.
- **The six predicates live in ONE place** (`HYGIENE_KINDS` in assets-db.js). Routes, Excel, and digest all consume it. Never re-write a predicate inline.
- Existing-module edits (server.js, reports.html, reportSchedule.js) are additive and flagged per task. Run `await-precedence` + the assets suite after each.
- Commit after every green step: `git commit --no-verify`. Tests: `node --test --test-force-exit tests/<file>.test.js`.

---

## Task 0: Hygiene readers (`assets-db.js`)

**Files:** Modify `assets-db.js`; Test `tests/assets-hygiene-readers.test.js`.

- [ ] **Step 1 — failing test.** Seed a throwaway sqlite `assets` table via `replaceTable('assets', cols, rows)` with a hand-built set that exercises every kind (a Discovered row; a row with `last_audit_status='Success'` + `days_since_scan='120'` → ghost; a `''`-audit row → never_scanned; a `purchase_cost='0.00'` row; an owned+costed+aged row that is in NO exception). Assert:
  - `getHygieneSummary({}).by_kind` has the right counts per kind (exact, small numbers).
  - `getHygieneSummary({}).by_site` completeness for a site with all-complete rows = 100 and mixes are the computed mean; a site with 0 rows is absent (or pct null).
  - `getHygieneExceptions('ghost', {})` returns only the >90d-AND-scanned row (not the never-scanned one).
  - `getHygieneExceptions('nonsense', {})` **throws**.
  - `getHygieneExceptions('no_cost', {})` count = the `'0.00'` rows (proves `IN` predicate, not `IS NULL`).

```javascript
// tests/assets-hygiene-readers.test.js  (skeleton — fill the seed rows)
'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
const os = require('os'), path = require('path'), fs = require('fs');
// assets-db.js honours SDP_DATA_DIR (NOT ASSETS_DB_PATH) and eager-opens
// <DATA_DIR>/assets.db AT REQUIRE TIME — so set this BEFORE the require, exactly
// like tests/assets-readers.test.js:7 and tests/assets-routes.smoke.test.js:9.
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hyg-'));
const test = require('node:test'); const assert = require('node:assert');
const adb = require('../assets-db');
// build cols to match assets schema; seed rows via adb.replaceTable('assets', cols, rows); then assert.
```
- Also assert the **disjointness boundary** (spec §2): a row with `last_audit_status='Failed'`, a populated `last_successful_audit_time`, and `days_since_scan='120'` appears in `never_scanned` ONLY, not `ghost`.
- Also **cross-check** the two encodings (M-4): `Σ_site by_site[k].<attr-missing>` reconciles with `by_kind[k]` for the four gap kinds on the seed — so the per-site `SUM(CASE …)` can't silently drift from the `HYGIENE_KINDS` predicate.

- [ ] **Step 2** — run → FAIL (fns undefined).
- [ ] **Step 3 — implement** in `assets-db.js`:
  - `HYGIENE_KINDS` — an ordered object/array mapping `kind → { label, where, params(filters) }`. Each `where` is a parameterised SQL fragment on `assets` (see spec §2 predicates verbatim). `ghost` = `lower(last_audit_status) LIKE '%success%' AND CAST(NULLIF(days_since_scan,'') AS INTEGER) > 90` — the `LIKE '%success%'` gate makes `ghost` and `never_scanned` **disjoint** (a currently-failing stale row is `never_scanned`, not both). `never_scanned` = `last_successful_audit_time IS NULL OR last_successful_audit_time='' OR last_audit_status IS NULL OR lower(last_audit_status) NOT LIKE '%success%'`. Use `NULLIF` so pg's strict cast doesn't 500 on `''`.
  - `_hygieneWhere(kind, filters)` — validates `kind` ∈ HYGIENE_KINDS (throw otherwise), ANDs the kind predicate with the shared whitelisted filters (`site,state,product_type,manufacturer,q` — copy the exact whitelist + bind style from `getEnrichedAssets`).
  - `getHygieneSummary(filters)` — dual-backend. Runs COUNT(*) per kind + a per-site GROUP BY producing `total` and per-attribute "present" counts, computes the pct in JS (so `total=0 → null`, no divide-by-zero in SQL), plus a scan-freshness bucketed count and a `by_state` count. Coerce counts with `Number()`.
  - `getHygieneExceptions(kind, filters)` — dual-backend. `SELECT <identity cols> FROM assets WHERE <_hygieneWhere> ORDER BY site, asset_name`. No cost column.
  - Export all three (+ `HYGIENE_KINDS`) from `module.exports`.
  - PG forks `_getHygieneSummaryPg`/`_getHygieneExceptionsPg` are `async`, mirror the sqlite SQL through `pgHandle()`, same `NULLIF/CAST`, `?`→handled by pgDb. (No live PG needed to pass — sqlite is the test backbone; the fork just has to exist + be await-correct.)
- [ ] **Step 4** — run → PASS.
- [ ] **Step 5** — `node --test --test-force-exit tests/await-precedence.test.js` → 5/5 (the two new dispatchers are auto-detected + covered).
- [ ] **Step 6 — commit:** `feat(assets): hygiene readers — 6 exception kinds + completeness summary`.

---

## Task 1: Hygiene routes (`server.js`)

**Files:** Modify `server.js` (with the other `/api/assets/*`); Test `tests/assets-hygiene-routes.smoke.test.js`.

- [ ] **Step 1 — failing smoke test.** Boot the app (copy the harness from `tests/assets-routes.smoke.test.js` — it already stubs a session + sqlite assets). Assert: `/api/assets/hygiene/summary` → 200 JSON with `by_kind`; `/api/assets/hygiene/exceptions?kind=discovered` → 200 array; `?kind=nonsense` → **400** (not 500); `?kind=ghost&q=' OR 1=1` → 200 (hostile input parameter-bound, no crash); `/api/assets/hygiene/export.xlsx?kind=all` → 200 with the xlsx content-type + PK-magic body.
- [ ] **Step 2** — FAIL. **Step 3 — implement** three routes behind `requireReportSession`, next to the existing assets routes. **Pre-validate the kind BEFORE the try/catch** — `if (kind && !adb.HYGIENE_KINDS[kind]) return res.status(400).json({error:'unknown kind'})` — because the existing assets routes use a generic `catch → res.status(500)`, and `getHygieneExceptions` *throws* on an unknown kind, which would otherwise surface as 500 (failing the smoke's 400 assertion). `export.xlsx`: build `sheets` from `HYGIENE_KINDS` (kind=all → every kind; else one), each via `getHygieneExceptions`, hand to `tableExcel.buildWorkbook`, stream Buffer with `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` + `Content-Disposition`. Whitelist the same filter params as `/inventory`.
- [ ] **Step 4** — PASS. **Step 5** — `await-precedence` 5/5 (new `await adb.getHygiene*` callers covered). **Step 6 — commit:** `feat(assets): /api/assets/hygiene/{summary,exceptions,export.xlsx}`.

---

## Task 2: Hygiene dashboard (`public/assets-hygiene.html`)

**Files:** Create `public/assets-hygiene.html`; Modify `server.js` (`_htmlCache` list + `sendHtmlPage` route), `public/_shell.js` (nav child). Optional icon in `brand/icons.js` (prefer existing `shield-check`).

- [ ] **Step 1 — page** copying `public/assets.html`'s skeleton (session auth, shell mount, fetch pattern). **`assets.html` does NOT load Chart.js — add the `<script src="https://cdn.jsdelivr.net/npm/chart.js@4...">` include explicitly** (it's CSP-allowed but not on the copied page). Header band (fleet completeness % + total + freshness). Three worklist KPI tiles (Discovered / Never-scanned / Ghost) → click loads `/exceptions?kind=` into a drill table. Charts via Chart.js: completeness-by-site (bar), scan-freshness (donut), state (bar). Per-kind **Export Excel** + **Export all** buttons → `/export.xlsx?kind=`.
- [ ] **Step 2** — add `assets-hygiene.html` to the `_htmlCache` boot list + a `sendHtmlPage(res,'assets-hygiene.html',false,'Assets hygiene unavailable')` route.
- [ ] **Step 3** — `_shell.js`: a second Insights child `{ id:'assets-hygiene', label:'Assets — Hygiene', icon:ICON_LIB['shield-check'], href:'assets-hygiene.html', roles:['any'] }` after `assets`. If `shield-check` isn't in `ICON_LIB`, add the key (it exists in `brand/icons.js`).
- [ ] **Step 4 — VERIFY IN BROWSER (mandatory).** `preview_start` the `sdp-dashboard` server (port from `.claude/launch.json`), seed a few assets covering each kind into the sqlite `assets.db` (or reuse Task-5's seed from Foundation), **restart (stop+start, not reload — `_htmlCache`)**, mint a session as the Foundation Task-5 report did (note the dev `.env` runs `REPORTS_BACKEND=postgres` for sessions), load `/assets-hygiene.html`: confirm tiles show real counts, the three charts render, a drill table loads on tile click, Export points at `export.xlsx`, zero console errors. Screenshot.
- [ ] **Step 5 — commit:** `feat(assets): hygiene dashboard page + Insights nav`.

---

## Task 3: Digest composer (`services/assetHygieneReport.js`)

**Files:** Create `services/assetHygieneReport.js`; Test `tests/asset-hygiene-report.test.js`.

- [ ] **Step 1 — failing test.** `buildHygieneDigest(summary, { period:'2026-07', prev })` where `summary` is a hand-built object (including `summary.sync = { last_success:'2026-07-10', age_days:7 }`) + a small `exceptionsByKind` map. Assert: returns `{subject, html, attachments}`; `subject` contains the period; `html` is a string containing the fleet completeness %, each worklist count, and the **"register last synced … / 7 day" freshness line** (from `summary.sync`); `html` contains **no `$`/currency** and no `purchase_cost`; `attachments[0].content` is a **Buffer** and `XLSX.read` shows one sheet per kind; with `prev` given, the html shows a Δ for at least one worklist kind.
- [ ] **Step 2** — FAIL. **Step 3 — implement** a PURE composer: it receives the already-computed `summary` and a `{kind: rows[]}` map (fetched by the caller), builds a table-based Outlook-safe HTML (fleet + per-site completeness + 3 worklist counts with optional Δ + scan-freshness line + a "register last synced N days ago" line from `summary.sync`), and the `all`-kinds workbook via `tableExcel.buildWorkbook`. NO DB, NO SMTP inside. Export `buildHygieneDigest`.
- [ ] **Step 4** — PASS. **Step 5 — commit:** `feat(assets): pure hygiene digest composer (html + xlsx, no money)`.

---

## Task 4: Send CLI (`tools/reports/send-hygiene.js`)

**Files:** Create `tools/reports/send-hygiene.js`; Test `tests/send-hygiene.test.js`.

- [ ] **Step 1 — failing test** on the PURE core `decideHygieneSend(cfg)`:
  - `{}` → `{ send:false, reason:'disabled' }` (default off).
  - `{ hygiene_send_enabled:'1' }` (no recipients) → `{ send:false, reason:'no recipients' }`.
  - `{ hygiene_send_enabled:'1', hygiene_recipients:'a@x.com, b@x.com' }` → `{ send:true, recipients:['a@x.com','b@x.com'] }` (trimmed, split).
  Then a `main` test with injected deps (stub `loadSummary`, stub `loadExceptions`, stub `mailer.send` capturing the message, stub `reportSentLog`): armed + recipients → calls `mailer.send` once with the composed subject + a Buffer attachment; `--preview` → composes but `mailer.send` NOT called; dedup (`alreadySentToday` true) without `--force` → not called.
- [ ] **Step 2** — FAIL. **Step 3 — implement**, mirroring `tools/reports/send-reports.js` structure: **tolerant arg parse** (`Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')))` — the scheduler always passes `--type=hygiene --cadence=weekly`, so an extra `--type` must be harmlessly ignored, NOT rejected). `reportConfig.getConfig`, `decideHygieneSend`, dedup via `reportSentLog.alreadySentToday(db,'hygiene','GROUP',period)`, fetch summary + all-kind exceptions via `assets-db`, **read `assets_assets` last-success from `sync_metadata` and attach `summary.sync`** (grep reports-db for the sync-status reader; if none is exported, read the row directly via the same handle — the freshness line is R1's mitigation), compose via `assetHygieneReport`, send via `mailer.buildMailer(cfg).send`, `reportSentLog.record`. Guarded entrypoint (`if (require.main===module)`); export `{ decideHygieneSend, main }`. Honour `REPORTS_BACKEND==='postgres' → await initPgReports()` and `ASSETS_BACKEND==='postgres' → await initPgAssets()` at the top of main (mirror send-reports).
- [ ] **Step 4** — PASS. **Step 5 — commit:** `feat(assets): send-hygiene CLI — armed, deduped, previewable`.

---

## Task 5: Schedule + admin card + Send-now route (existing-module edits)

**Files:** Modify `services/reportSchedule.js`, `server.js`, `public/reports.html`; Test `tests/report-schedule-hygiene.test.js` + extend the routes smoke.

- [ ] **Step 1 — failing test** on `reportSchedule`. Note: when `runTask` is a stub, `_defaultRunTask` is bypassed and the stub receives only `{action,taskName,report_type,cadence,day,time}` — NO command string. So the CLI mapping must be a separately-exported pure helper `cliFor(report_type)`. Assert: `cliFor('hygiene')` ends with `send-hygiene.js`; `cliFor('coordinator')` ends with `send-reports.js`; AND `setSchedule(db,{report_type:'hygiene',cadence:'weekly',enabled:true,day:'MON',time:'07:00'}, user, {runTask:stub})` resolves and the stub receives `spec.report_type==='hygiene'` (this proves the TYPES gate accepts hygiene; `cliFor` proves the CLI mapping). Also add `hygiene_recipients`/`hygiene_send_enabled` round-trip to a reportConfig test (I-1 below).
- [ ] **Step 2** — FAIL. **Step 3 — implement:**
  - **`reportConfig.js`: add `hygiene_recipients: ''` and `hygiene_send_enabled: '0'` to `DEFAULTS`** — WITHOUT this, `setConfig`'s `KEYS.includes(k)` filter silently drops the admin card's writes and the digest is permanently inert (I-1). Add a round-trip test.
  - **`reportSchedule.js`:** add `'hygiene'` to `TYPES`; add an exported `cliFor(report_type)` returning the absolute path to `send-hygiene.js` for `'hygiene'` else `SEND_CLI` (send-reports.js); have `_defaultRunTask` build `tr` from `cliFor(spec.report_type)` instead of the hardcoded `SEND_CLI`. Purely additive — the coordinator `tr` is byte-identical.
- [ ] **Step 4 — Send-now route** in server.js: `POST /api/assets/hygiene/send?preview=1|0` (`requireReportSession` + `requireAdmin`) → shells `send-hygiene.js` (or calls its exported `main` with deps) and returns `{ok, previewed, recipients, reason?}`. Add a smoke assertion (preview path, no SMTP).
- [ ] **Step 5 — admin card** in `public/reports.html#admin` (admin+): "🛡 Assets Hygiene digest" — recipients textarea + arm toggle (writes `hygiene_recipients`/`hygiene_send_enabled` via the existing config PUT), schedule controls (reuse the existing schedule API with `report_type=hygiene`), and **Preview / Send now** buttons → the new route. Reuse existing card CSS/modal/toast. (No new auth mechanism.)
- [ ] **Step 6** — full assets + reports regression green; `await-precedence` 5/5. **Commit:** `feat(assets): hygiene schedule type + admin card + send-now route`.

---

## Task 6: Regression + docs + finish

**Files:** Modify `CLAUDE.md`.

- [ ] **Step 1 — full regression** `node --test --test-force-exit tests/` — the ~15 pre-existing dev-`.env` PG failures stay; nothing NEW red; `await-precedence` green.
- [ ] **Step 2 — CLAUDE.md** Current-State entry (2026-07-17, sub-project B) + Known-Pitfalls rows: the `no_cost = IN('0.00',…)` not `IS NULL` predicate; `ghost` requiring scanned-once to not overlap `never_scanned`; the `NULLIF+CAST` pg-strict-cast guard on `days_since_scan`; the default-OFF `hygiene_send_enabled` arm gate ("never send unattended to an unconfirmed list"). Point at the spec.
- [ ] **Step 3 — commit**, then finish-a-development-branch (merge is the controller's call per the autonomous-delivery grant).

---

## Done criteria (sub-project B)
- [ ] Six exception kinds defined once in `HYGIENE_KINDS`; `getHygieneSummary`/`getHygieneExceptions` dual-backend, await-covered; unknown kind throws/400.
- [ ] `no_cost` filters `IN ('0.00','0','')`; `ghost` excludes never-scanned; `days_since_scan` cast is pg-safe.
- [ ] `/api/assets/hygiene/{summary,exceptions,export.xlsx}` — filters whitelisted, no 500 on hostile input, no cost column.
- [ ] Dashboard renders tiles + 3 charts + drill + Excel; in Insights ▾; **browser-verified**.
- [ ] Pure digest composer (html + xlsx, no money, Δ vs prev); send CLI armed-by-default-OFF + deduped + previewable; schedule type + admin card + send-now route.
- [ ] Full suite green; **no money displayed anywhere**; no new sync.
