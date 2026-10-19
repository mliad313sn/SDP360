# V1b-B — OpManager device availability (LAN/WLAN/Servers) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** Get **device-grain availability%** for **LAN / WLAN / Servers** from the OpManager **REST API** (`getDeviceCompleteDetails.availdata`) into V1a's `infra_metric_snapshots`, labelled honestly with a `basis` flag. WAN is NOT here (it's Meraki, V1b-A). Feeds V1b-C's report auto-fill for the non-WAN families.

**Architecture:** New read-only `services/opmanagerClient.js` (REST, TLS-insecure for the self-signed cert) + pure `services/opmanagerAvailability.js` (average `availdata.Up%` per site per family) → rework `tools/opmanager/sync-availability.js` to prefer the REST path when configured (Analytics path preserved) → `infra_metric_snapshots` (+ `basis` column) → re-point `/coverage` off Analytics onto the REST device list.

**Tech Stack:** Node/Express, axios, node:test. Mirrors V1b-A (`merakiClient`/`merakiWanQuality`/`sync-wan`) + V1a (`opmClassify`, `infra_metric_snapshots`).

**Spec:** `docs/superpowers/specs/2026-08-15-infra-wan-availability-quality-design.md` §5.2, §6, §13-B, §14.

**Scope guard (NOT in V1b-B):** no report auto-fill (V1b-C), no Meraki, no dashboard (V1b-D). `wan_link_snapshots` untouched. The Analytics `fetchView` path stays available (dormant), not deleted.

**Discovery dependency (like V1b-A's calibration):** the REST `availdata` window (today/default vs configurable), the exact `type`/`category` strings vs `opmClassify`'s rule table, and whether site resolves by **probeName** (V1a seed) or **device-name prefix** (Dakar rides Sabodala's probe) — all need the user's OpManager key. T7 ships a discovery harness; the pure code is built + tested with fixtures and the site-resolver is **injected** so the strategy is a config decision, not a code rewrite.

---

## Task 1: OpManager REST config keys + secret touch-points

**Files:** Modify `services/reportConfig.js` (DEFAULTS + `_SECRET_BLANK_KEEP`), `server.js` (redact + super_admin gate). Test `tests/report-config-opmanager.test.js`.

- [ ] **Step 1: failing test** — assert `opmanager_base_url`/`opmanager_api_key`/`opmanager_tls_insecure` in DEFAULTS + `opmanager_api_key` in `_SECRET_BLANK_KEEP`.
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement** — DEFAULTS: `opmanager_base_url:'', opmanager_api_key:'', opmanager_tls_insecure:'1'`. Add `opmanager_api_key` to `_SECRET_BLANK_KEEP`. `server.js`: redact `opmanager_api_key` on GET (beside `meraki_api_key`) + add an `OPMANAGER_KEYS` super_admin gate (mirror `MERAKI_KEYS`).
- [ ] **Step 4: run → PASS.** **Step 5: commit** `feat(wan): V1b-B T1 — opmanager REST config keys + secret touch-points`.

---

## Task 2: `services/opmanagerClient.js` — read-only REST client

**Files:** Create `services/opmanagerClient.js`. Test `tests/opmanager-client.test.js`.

- [ ] **Step 1: failing test** (inject transport; assert path, apiKey param, TLS agent honoured, inert without key/base).

```js
const { makeOpmanagerClient } = require('../services/opmanagerClient');
// listDevices → /api/json/v2/device/listDevices?apiKey=&rows=&page=
// getDeviceCompleteDetails → /api/json/v2/device/getDeviceCompleteDetails?apiKey=&name=
```

- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement** — factory `makeOpmanagerClient({ apiKey, baseUrl, tlsInsecure, get })`. Methods return `res.data` or `[]`/`null` when `!apiKey || !baseUrl`. `listDevices({rows=1000,page=1,category})` → GET `${base}/api/json/v2/device/listDevices` params `{apiKey, rows, page, category}`. `getDeviceCompleteDetails({name})` → GET `${base}/api/json/v2/device/getDeviceCompleteDetails` params `{apiKey, name}`. `tlsInsecure` (default true) → pass an `https.Agent({rejectUnauthorized:false})` to axios (self-signed cert on `abj-spm-000`). Injectable `get`. **The OpManager list response is enveloped** (array under a key + `records` sibling, per V1a discovery) — expose a small `_pluck(res)` that returns the first array-valued property, so callers get the device array regardless of the wrapper key.
- [ ] **Step 4: run → PASS.** **Step 5: commit** `feat(wan): V1b-B T2 — read-only OpManager REST client`.

---

## Task 3: `services/opmanagerAvailability.js` — PURE device-availability aggregate

**Files:** Create `services/opmanagerAvailability.js`. Test `tests/opmanager-availability.test.js`.

- [ ] **Step 1: failing test** — per (site, family) average of `availdata.Up`; excluded + `wan` skipped; empty family → null; basis='recent'.

```js
const { aggregateDeviceAvail } = require('../services/opmanagerAvailability');
// devices: [{ name, type, category, probeName, availUp }]  (availUp = availdata.Up %)
// deviceToSite(device) → site_id | null ; classify(type,category) → {family}
```

- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement (PURE, no I/O)** — `aggregateDeviceAvail(devices, { classify, deviceToSite, targets, period })`:
  - for each device: `family = classify(type,category).family`; **skip `excluded` AND `wan`** (WAN = Meraki); `site_id = deviceToSite(device)` (skip if null); collect `availUp` (a number; null/absent → skip that device from the family average, not counted as 0).
  - per (site_id, family): `metric_value = round2(mean(availUp))` or **null** if no device had a reading; `device_count`, `included_device_count`; `status_color = statusColor(metric_value, targets[family])` (report band `≥t/≥t*0.9/else`, reuse `merakiWanQuality.statusColor` or a local copy); `basis = 'recent'` (the availdata window is not the exact period — §10/§14).
  - emit `infra_metric_snapshots`-shaped rows: `{ site_id, period_type: period.period_type, period_start, period_end, kpi_family, metric_name:'availability', metric_value, target_value, status_color, trend:null, source:'opmanager_rest', data_through:period.period_end, device_count, included_device_count, collected_at, basis, raw_json:null }` (collected_at/period injected). Families emitted: `lan`, `wifi`, `servers` only.
- [ ] **Step 4: run → PASS.** **Step 5: commit** `feat(wan): V1b-B T3 — pure OpManager device-availability aggregate`.

---

## Task 4: `basis` column on `infra_metric_snapshots` (additive)

**Files:** Modify `reports-db.js` (sqlite ALTER guard + `initPgReports` ALTER + `_INFRA_SNAP_COLS`/upsert). Test `tests/infra-basis.test.js`.

- [ ] **Step 1: failing test** — upsert a row with `basis:'recent'`, read it back.
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement** — additive `basis TEXT` column, **backend-branched, NOT in the shared CREATE**: sqlite PRAGMA-guarded `ALTER TABLE infra_metric_snapshots ADD COLUMN basis TEXT` in `getDB` (mirror any existing PRAGMA-guarded ALTER); pg `ALTER TABLE infra_metric_snapshots ADD COLUMN IF NOT EXISTS basis TEXT` in `initPgReports`. Append `'basis'` to `_INFRA_SNAP_COLS` (so `_snapVals` + the shared upsert carry it) AND to the `ON CONFLICT DO UPDATE SET` list (`basis=excluded.basis`). Existing V1a callers that don't set `basis` → `_snapVals` maps undefined→null (safe).
- [ ] **Step 4: run → PASS.** + `node --test tests/opm-snapshots.test.js` (V1a still green). **Step 5: commit** `feat(wan): V1b-B T4 — additive basis column on infra_metric_snapshots`.

---

## Task 5: Rework `sync-availability.js` — REST branch

**Files:** Modify `tools/opmanager/sync-availability.js`. Test extend `tests/opm-sync.test.js` (a REST-path case).

- [ ] **Step 1: failing test** — inject an `opmanagerClient` + config with `opmanager_api_key`/`opmanager_base_url`; assert it acquires via REST (listDevices + getDeviceCompleteDetails), aggregates device-grain, upserts `infra_metric_snapshots` with `source:'opmanager_rest'`, `basis:'recent'`, families lan/wifi/servers (NO wan), best-effort on failure. Keep the existing Analytics-path tests green (that branch unchanged).
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement** — in `main(deps)`, after `getConfig`: **if `cfg.opmanager_api_key && cfg.opmanager_base_url`** → REST branch: build `opmanagerClient` (injected or from config); `listDevices` (optionally filtered to relevant categories); for each **non-firewall** device (skip `F/W`/MerakiSecurity — WAN is Meraki) fetch `getDeviceCompleteDetails` → read `availdata.Up`; pre-resolve `deviceToSite` (probe→site via the existing `opmanager` seed, awaited into a plain map — **the probe-vs-name strategy is the discovery decision, injected as `deps.deviceToSite`**); `aggregateDeviceAvail(devices, {classify: classifyKpiFamily, deviceToSite, targets, period: week})` + month → `upsertInfraSnapshots(all)`. **Else** → the existing Analytics `readDailyRows` path (unchanged, config-gated on `opm_availability_view_id`). Both best-effort. Zoho-week window (`getPreviousWeek`→`getWeekRange`) + current month.
- [ ] **Step 4: run → PASS** (`tests/opm-sync.test.js` all cases). **Step 5: commit** `feat(wan): V1b-B T5 — sync-availability REST branch (device-grain LAN/WLAN/Servers)`.

---

## Task 6: Re-point `/coverage` governance route onto the REST device list

**Files:** Modify `routes/opmanager.js`. Test extend `tests/opm-routes.smoke.test.js`.

- [ ] **Step 1: failing test** — with `opmanager_api_key` set (inject client), `/coverage` returns `{available:true, total, included, excluded, by_family, unmapped}` derived from the REST device list (not Analytics); unconfigured → `{available:false}` (unchanged).
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement** — in the `/coverage` handler: **if `opmanager_api_key && opmanager_base_url`** → build the client (pass it in via the router factory deps), `listDevices`, classify each via `classifyKpiFamily`, resolve site via the opmanager seed → the same `coverageSummary` shape (total/included/excluded/by_family/unmapped_probes) computed over REST devices. **Else** fall back to the existing Analytics path (dormant). Never 500.
- [ ] **Step 4: run → PASS.** **Step 5: commit** `feat(wan): V1b-B T6 — coverage route on REST device list`.

---

## Task 7: Discovery harness + regression + docs (discovery gate)

**Files:** Create `tools/opmanager/discover.js` (operator-run). Modify `CLAUDE.md`.

- [ ] **Step 1: discovery harness** — given `OPMANAGER_API_KEY`/`OPMANAGER_BASE_URL` in ENV (never CLI, never printed): `listDevices` a sample, print distinct `category`/`type` strings (to confirm they match `opmClassify`'s rule table), print a few devices' `probeName` vs name-prefix (to decide the site-resolution strategy), and `getDeviceCompleteDetails` for one device → print the `availdata` keys + values + whether a `todayTimeAvail`/period field indicates the window. Paste-back = the printed strings only.
- [ ] **Step 2: regression:**
```
node --test --test-force-exit tests/report-config-opmanager.test.js tests/opmanager-client.test.js tests/opmanager-availability.test.js tests/infra-basis.test.js tests/opm-sync.test.js tests/opm-routes.smoke.test.js
node --test --test-force-exit tests/opm-snapshots.test.js tests/await-precedence.test.js tests/pptx-monthly-golden.test.js
```
Expected green; V1a snapshots + goldens unchanged.
- [ ] **Step 3: pg smoke** — `initPgReports` applies the `basis` ALTER; upsert-with-basis round-trips on pg.
- [ ] **Step 4: CLAUDE.md** — V1b-B Current-State block + pitfalls: (a) WAN skipped in the REST path (Meraki owns it); (b) `availdata` window is recent → `basis='recent'`, never presented as the week's; (c) site-resolution strategy (probe vs name-prefix) is the discovery decision, injected; (d) per-device getDeviceCompleteDetails is N calls (on-prem, sequential, tolerable).
- [ ] **Step 5: discovery-gate checkpoint (user step)** — confirm type/category strings, availdata window, site strategy with the real key before V1b-C reads these snapshots as "recent availability". Surface to user.
- [ ] **Step 6: commit** `feat(wan): V1b-B T7 — discovery harness + regression + docs`.

---

## Sequencing
V1b-B is independent of V1b-A's calibration. **V1b-C** (report auto-fill) reads BOTH `wan_link_snapshots` (A) and `infra_metric_snapshots` (B) — start it only after both A's calibration and B's discovery are confirmed, or it surfaces un-validated numbers.
