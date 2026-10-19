# V1b-A — Meraki WAN store + collector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) to implement task-by-task. Steps use `- [ ]` checkboxes.

**Goal:** Capture per-link (wan1/wan2) WAN **availability %** + **quality** (loss/latency/jitter) from the Meraki Dashboard API, derive `% Time Up`, and archive it **weekly + monthly** in a new `wan_link_snapshots` table — the foundation the report auto-fill (V1b-C) and the WAN dashboard (V1b-D) read.

**Architecture:** Isolated read-only acquisition. `services/merakiClient.js` (REST, injectable transport) → `tools/meraki/sync-wan.js` (config-gated, best-effort collector) → pure `services/merakiWanQuality.js` (derive % Time Up + averages) → `wan_link_snapshots` (dual sqlite/pg, composite PK, no surrogate id). Site key = Meraki network → `site_module_codes` module `'meraki'`, seeded by site name.

**Tech Stack:** Node/Express, better-sqlite3 + `services/pgDb.js` (`REPORTS_BACKEND` flag), axios 1.16.1, node:test.

**Spec:** `docs/superpowers/specs/2026-08-15-infra-wan-availability-quality-design.md` (§5.1, §6, §7, §8, §9, §13-A).

**Scope guard (do NOT in V1b-A):** no report auto-fill, no OpManager, no dashboard, no route beyond `POST /sync`. Those are V1b-B/C/D. `infra_metric_snapshots` (V1a) is untouched here.

---

## Task 1: Config keys + 3 secret touch-points

**Files:**
- Modify: `services/reportConfig.js` (DEFAULTS + blank-keep filter)
- Modify: `server.js` (GET redact list + super_admin PUT gate)
- Test: `tests/report-config-meraki.test.js`

- [ ] **Step 1: Write the failing test** — assert the 3 non-secret + 1 secret keys are in `DEFAULTS`, and that the secret is in the blank-keep set.

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const rc = require('../services/reportConfig');

test('meraki config keys are in DEFAULTS', () => {
  for (const k of ['meraki_api_key', 'meraki_org_id', 'meraki_base_url', 'meraki_missing_policy']) {
    assert.ok(Object.prototype.hasOwnProperty.call(rc.DEFAULTS, k), `${k} missing from DEFAULTS`);
  }
  assert.equal(rc.DEFAULTS.meraki_base_url, 'https://api.meraki.com/api/v1');
  assert.equal(rc.DEFAULTS.meraki_api_key, '');
  assert.equal(rc.DEFAULTS.meraki_missing_policy, 'down');   // calibration may flip to 'unknown'
});

test('meraki_api_key is blank-kept on save (empty value keeps stored secret)', () => {
  // reportConfig exposes the blank-keep key set as _SECRET_BLANK_KEEP (see Step 3).
  assert.ok(rc._SECRET_BLANK_KEEP.has('meraki_api_key'), 'meraki_api_key must be blank-kept like smtp_pass');
});
```

- [ ] **Step 2: Run → FAIL.** `node --test --test-force-exit tests/report-config-meraki.test.js`  → Expected FAIL (keys absent).

- [ ] **Step 3: Implement.**
  - `services/reportConfig.js`: add to `DEFAULTS` → `meraki_api_key: '', meraki_org_id: '', meraki_base_url: 'https://api.meraki.com/api/v1', meraki_missing_policy: 'down'`. **`meraki_missing_policy` MUST be here** — Task 6 reads it and Task 7's calibration sets it; a key absent from DEFAULTS is silently dropped by `setConfig`'s `KEYS` filter, so the calibrated policy would be un-saveable (the whole gate's output lost). The blank-keep filter (~line 106) is an **inline hardcoded condition** — extract it to an exported `const _SECRET_BLANK_KEEP = new Set([...existing, 'meraki_api_key'])`, use it in the filter, AND add it to `module.exports`. Keep existing members.
  - `server.js`: add `meraki_api_key` to the **GET redact** blanking (~5121, beside `smtp_pass`) and to the **super_admin PUT gate** key set (~5140, the `MERIDIAN_KEYS`-style check — extend it or add `meraki_api_key` to a shared secret-keys array). `meraki_org_id` / `meraki_base_url` are non-secret (not redacted, not gated).

- [ ] **Step 4: Run → PASS.** `node --test --test-force-exit tests/report-config-meraki.test.js`

- [ ] **Step 5: Commit.**
```bash
git add services/reportConfig.js server.js tests/report-config-meraki.test.js
git commit --no-verify -m "feat(wan): V1b-A T1 — meraki config keys + secret touch-points"
```

---

## Task 2: `services/merakiClient.js` — read-only REST client (injectable transport)

**Files:**
- Create: `services/merakiClient.js`
- Test: `tests/meraki-client.test.js`

- [ ] **Step 1: Write the failing test** — inject a fake transport; assert URL, headers, and query shaping. No network.

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeMerakiClient } = require('../services/merakiClient');

function fakeGet(calls) {
  return async (url, opts) => { calls.push({ url, opts }); return { data: [] }; };
}

test('deviceLossLatencyHistory shapes the request (path, key header, params)', async () => {
  const calls = [];
  const c = makeMerakiClient({ apiKey: 'K', orgId: 'O', baseUrl: 'https://api.meraki.com/api/v1', get: fakeGet(calls) });
  await c.deviceLossLatencyHistory({ serial: 'Q2-AB', uplink: 'wan1', ip: '8.8.8.8', t0: '2026-08-09T00:00:00Z', t1: '2026-08-15T23:59:59Z', resolution: 3600 });
  const { url, opts } = calls[0];
  assert.match(url, /\/devices\/Q2-AB\/lossAndLatencyHistory$/);
  assert.equal(opts.headers['X-Cisco-Meraki-API-Key'], 'K');
  assert.equal(opts.params.uplink, 'wan1');
  assert.equal(opts.params.ip, '8.8.8.8');
  assert.equal(opts.params.resolution, 3600);
});

test('orgUplinkStatuses hits the org path with the org id', async () => {
  const calls = [];
  const c = makeMerakiClient({ apiKey: 'K', orgId: 'O', get: fakeGet(calls) });
  await c.orgUplinkStatuses({ networkIds: ['N1'] });
  assert.match(calls[0].url, /\/organizations\/O\/uplinks\/statuses$/);
  assert.deepEqual(calls[0].opts.params.networkIds, ['N1']);
});

test('client is inert without apiKey/orgId (returns [] , no call)', async () => {
  const calls = [];
  const c = makeMerakiClient({ apiKey: '', orgId: '', get: fakeGet(calls) });
  assert.deepEqual(await c.orgUplinkStatuses({}), []);
  assert.equal(calls.length, 0);
});
```

- [ ] **Step 2: Run → FAIL** (module absent).

- [ ] **Step 3: Implement `services/merakiClient.js`.** Factory `makeMerakiClient({ apiKey, orgId, baseUrl='https://api.meraki.com/api/v1', get })` where `get` defaults to an axios wrapper (`(url,opts)=>axios.get(url,opts)`). Methods return `res.data` (array/obj) or `[]` when `!apiKey || !orgId`:
  - `orgUplinkStatuses({ networkIds, serials })` → GET `${base}/organizations/${orgId}/uplinks/statuses`, params `{networkIds, serials, perPage:1000}`.
  - `orgUplinksLossLatency({ serials })` → GET `${base}/organizations/${orgId}/devices/uplinksLossAndLatency` (for `ip` discovery).
  - `deviceLossLatencyHistory({ serial, uplink, ip, t0, t1, timespan, resolution })` → GET `${base}/devices/${serial}/lossAndLatencyHistory`, params `{uplink, ip, t0, t1, timespan, resolution}` (drop undefined).
  - All send header `X-Cisco-Meraki-API-Key`. A tiny `_rateGuard` (serialize + optional sleep hook injectable) is enough — real backoff on 429 can be a later refinement; keep V1b-A simple (sequential calls, small fleet).

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(wan): V1b-A T2 — read-only Meraki REST client (injectable transport)`.

---

## Task 3: `services/merakiWanQuality.js` — PURE derive (% Time Up + averages)

**Files:**
- Create: `services/merakiWanQuality.js`
- Test: `tests/meraki-wan-quality.test.js`

- [ ] **Step 1: Write the failing test** — fixtures for every case, both `missing` policies.

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { deriveAvailability, statusColor } = require('../services/merakiWanQuality');

const S = (loss) => ({ startTime: '2026-08-09T00:00:00Z', endTime: '2026-08-09T01:00:00Z', lossPercent: loss, latencyMs: 20, jitter: 2, goodput: 1000 });

test('all up → 100', () => {
  const r = deriveAvailability([S(0), S(1.5), S(0)], { totalIntervals: 3, missing: 'down' });
  assert.equal(r.availability_pct, 100);
});
test('one loss=100 interval → 66.67 (down)', () => {
  const r = deriveAvailability([S(0), S(100), S(0)], { totalIntervals: 3, missing: 'down' });
  assert.equal(r.availability_pct, 66.67);
});
test("missing:'down' counts absent intervals as down", () => {
  const r = deriveAvailability([S(0)], { totalIntervals: 4, missing: 'down' });
  assert.equal(r.availability_pct, 25);
});
test("missing:'unknown' excludes absent intervals from the denominator", () => {
  const r = deriveAvailability([S(0), S(100)], { totalIntervals: 10, missing: 'unknown' });
  assert.equal(r.availability_pct, 50);            // 1 up / 2 counted, gaps excluded
});
test('empty → null (never 0)', () => {
  assert.strictEqual(deriveAvailability([], { totalIntervals: 5, missing: 'unknown' }).availability_pct, null);
});
test('averages ignore down/absent for latency but report loss avg over present', () => {
  const r = deriveAvailability([S(0), S(2)], { totalIntervals: 2, missing: 'down' });
  assert.equal(r.latency_ms_avg, 20);
  assert.equal(r.loss_pct_avg, 1);
});
test('statusColor uses the report band (>=t green, >=t*0.9 orange, else red, null none)', () => {
  assert.equal(statusColor(99, 98), 'green');
  assert.equal(statusColor(90, 98), 'orange');     // 90 >= 88.2
  assert.equal(statusColor(80, 98), 'red');
  assert.equal(statusColor(null, 98), 'none');
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `services/merakiWanQuality.js` (PURE, no I/O).**
  - `deriveAvailability(series, { totalIntervals, missing })`: `present = series.length`; `up = series.filter(s => s.lossPercent != null && s.lossPercent < 100).length`; `downPresent = present - up`. Denominator: `missing === 'down' ? totalIntervals : present`. If denominator `=== 0` → `availability_pct: null`. Else `availability_pct = round2(100 * (missing==='down' ? up : up) / denom)` — note when `missing==='down'`, absent intervals (`totalIntervals - present`) are implicitly down (denom is total, numerator is up). Returns `{ availability_pct, loss_pct_avg, latency_ms_avg, jitter_ms_avg, goodput_avg }` where the averages are over PRESENT samples (`round2`), null if none.
  - `statusColor(pct, target)`: `pct == null → 'none'`; `pct >= target → 'green'`; `pct >= target*0.90 → 'orange'`; else `'red'`.
  - `round2(x) = Math.round(x*100)/100`. Export both + `round2`.

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(wan): V1b-A T3 — pure WAN quality derive (% Time Up + averages)`.

---

## Task 4: `wan_link_snapshots` table + dual upsert/read + pg 008

**Files:**
- Modify: `reports-db.js` (sqlite CREATE in init block + `initPgReports` applies 008 + `_WAN_SNAP_*` cols/upsert/where + `upsertWanSnapshots`/`getWanSnapshots` dispatchers + exports)
- Create: `db/postgres/reports/008_wan_link_snapshots.sql`
- Test: `tests/wan-snapshots.test.js`

- [ ] **Step 1: Write the failing test** (sqlite, throwaway `SDP_DATA_DIR`).

```js
'use strict';
const _os=require('os'),_fs=require('fs'),_p=require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_p.join(_os.tmpdir(),'wansnap-'));
process.env.REPORTS_BACKEND='sqlite';
const { test } = require('node:test'); const assert = require('node:assert');
const rdb = require('../reports-db');

test('upsert + read round-trips; ON CONFLICT updates by composite PK', async () => {
  const row = { site_id:1, uplink:'wan1', period_type:'week', period_start:'2026-08-09', period_end:'2026-08-15',
    availability_pct:99.86, status_color:'green', loss_pct_avg:0.08, latency_ms_avg:26.1, jitter_ms_avg:2.17,
    goodput_avg:1000, status_current:'active', uplink_label:'Internet 1', device_serial:'Q2-AB', network_id:'N1',
    data_through:'2026-08-15', collected_at:'2026-08-16T05:20:00Z', source:'meraki_api', raw_json:null };
  await rdb.upsertWanSnapshots([row]);
  let got = await rdb.getWanSnapshots({ site_id:1, period_type:'week', period_start:'2026-08-09' });
  assert.equal(got.length,1); assert.equal(got[0].availability_pct,99.86); assert.equal(got[0].uplink,'wan1');
  await rdb.upsertWanSnapshots([{ ...row, availability_pct:97.5, status_color:'orange' }]);
  got = await rdb.getWanSnapshots({ site_id:1, uplink:'wan1', period_type:'week', period_start:'2026-08-09' });
  assert.equal(got.length,1); assert.equal(got[0].availability_pct,97.5); assert.equal(got[0].status_color,'orange');
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** mirroring the V1a `_INFRA_SNAP_*` block (`reports-db.js` ~2317-2362):
  - Add the sqlite `CREATE TABLE IF NOT EXISTS wan_link_snapshots (...)` to the init SQL block (composite PK `(site_id, uplink, period_type, period_start)`, columns per spec §5.1, REAL for the numerics).
  - `db/postgres/reports/008_wan_link_snapshots.sql`: pg CREATE (`DOUBLE PRECISION` numerics, same PK); apply it in `initPgReports` right after 007.
  - `_WAN_SNAP_COLS` (the full column list), `_WAN_SNAP_UPSERT` (`INSERT … ON CONFLICT(site_id,uplink,period_type,period_start) DO UPDATE SET …` — every non-PK column), `_wanVals(r)`, `_wanWhere(f)` (site_id/uplink/period_type/period_start), `upsertWanSnapshots`/`getWanSnapshots` dual dispatchers (`if (REPORTS_BACKEND==='postgres') return _xPg(); return _xSqlite()`), exported next to `upsertInfraSnapshots`.

- [ ] **Step 4: Run → PASS.** Then `node --test --test-force-exit tests/await-precedence.test.js` (auto-covers the new dispatchers) → PASS.
- [ ] **Step 5: Commit** `feat(wan): V1b-A T4 — wan_link_snapshots table + dual upsert/read (+pg 008)`.

---

## Task 5: Meraki network → site seed (`site_module_codes` module `'meraki'`)

**Files:**
- Modify: `reports-db.js` (module-level `_MERAKI_NETWORK_CODES` + augment BOTH `_SITE_MODULE_CODES_SEED` and the pg `SEED` literal, mirroring `_OPM_PROBE_CODES` at ~630 and ~1178)
- Test: `tests/meraki-seed.test.js`

- [ ] **Step 1: Write the failing test** — resolve a seeded Meraki code to a site_id (sqlite).

```js
'use strict';
const _os=require('os'),_fs=require('fs'),_p=require('path');
process.env.SDP_DATA_DIR=_fs.mkdtempSync(_p.join(_os.tmpdir(),'mrkseed-'));
process.env.REPORTS_BACKEND='sqlite';
const { test } = require('node:test'); const assert = require('node:assert');
const rdb = require('../reports-db');
test('Ity Meraki network code resolves to a site_id via module=meraki', async () => {
  const r = await rdb.getSiteIdByModuleCode('meraki', 'Ity Gold Operations');
  assert.ok(r && r.site_id, 'meraki code resolves to a site');
});
```

> The seed keys are the Meraki **network names** per site (confirmed from the dashboard: Ity→"Ity Gold Operations", Mana→"Mana Gold Operations"). The final list of network names is confirmed with the user during calibration (Task 7); seed the known ones now, resolved by site NAME (never probe), exactly like `_OPM_PROBE_CODES`.

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `const _MERAKI_NETWORK_CODES = { Ity:'Ity Gold Operations', Mana:'Mana Gold Operations', Hounde:'…', Sabodala:'…', Lafigue:'…', Ouagadougou:'…', Abidjan:'…', Tanda:'…' }` (placeholders where unknown — filled at calibration). Two loops (`.meraki = code`) augmenting `_SITE_MODULE_CODES_SEED` AND the pg `SEED` literal, mirroring the `_OPM_PROBE_CODES` loops. **Store the Meraki network NAME directly** — `site_module_codes.code` has **no CHECK constraint** on either backend (verified: `'OUAGA OFF1'` with a space is already seeded), and resolution is case-insensitive equality, so `"Ity Gold Operations"` stores + resolves cleanly. No network-id fallback needed.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(wan): V1b-A T5 — meraki network→site seed (site_module_codes)`.

---

## Task 6: `tools/meraki/sync-wan.js` — collector (config-gated, best-effort, week+month)

**Files:**
- Create: `tools/meraki/sync-wan.js`
- Test: `tests/meraki-sync.test.js`

- [ ] **Step 1: Write the failing test** — everything injected (client + rdb + config); assert config-gate, week+month compose, upsert shape, best-effort.

```js
'use strict';
const { test } = require('node:test'); const assert = require('node:assert');
const { main } = require('../tools/meraki/sync-wan');

function stub(over={}) {
  const cap = { upserts: [] };
  const client = {
    orgUplinkStatuses: async () => [{ networkId:'N1', serial:'Q2-AB', uplinks:[{interface:'wan1',status:'active'},{interface:'wan2',status:'active'}] }],
    orgUplinksLossLatency: async () => [{ serial:'Q2-AB', uplink:'wan1', ip:'8.8.8.8' }, { serial:'Q2-AB', uplink:'wan2', ip:'8.8.4.4' }],
    deviceLossLatencyHistory: async () => Array.from({length:168}, () => ({ lossPercent:0, latencyMs:20, jitter:2, goodput:1000 })),
    ...over.client,
  };
  const rdb = {
    listSiteModuleCodes: async (m) => (m==='meraki' ? [{ code:'Ity Gold Operations', site_id:7, module:'meraki' }] : []),
    upsertWanSnapshots: async (rows) => { cap.upserts.push(...rows); },
    ...over.rdb,
  };
  const deps = { client, rdb,
    getConfig: over.getConfig || (async () => ({ meraki_api_key:'K', meraki_org_id:'O', opm_targets: JSON.stringify({wan:98}) })),
    networkNameById: over.networkNameById || (id => 'Ity Gold Operations'),
    now: '2026-08-16T05:20:00Z', asOfWeek: { period_start:'2026-08-09', period_end:'2026-08-15' },
    asOfMonth:{ period_start:'2026-08-01', period_end:'2026-08-31' }, log: () => {} };
  return { deps, cap };
}

test('armed → composes week + month per uplink and upserts', async () => {
  const { deps, cap } = stub();
  const r = await main(deps);
  assert.equal(r.ok, true);
  // 2 uplinks × 2 periods = 4
  assert.equal(cap.upserts.length, 4);
  const wk1 = cap.upserts.find(u => u.period_type==='week' && u.uplink==='wan1');
  assert.equal(wk1.site_id, 7); assert.equal(wk1.availability_pct, 100); assert.equal(wk1.status_color, 'green');
  assert.equal(wk1.source, 'meraki_api');
});
test('config-gated: no api key → skips, no upsert', async () => {
  const { deps, cap } = stub({ getConfig: async () => ({ meraki_api_key:'' }) });
  assert.equal((await main(deps)).skipped, true); assert.equal(cap.upserts.length, 0);
});
test('fetch failure → best-effort {ok:false}, no upsert, no throw', async () => {
  const { deps, cap } = stub({ client: { deviceLossLatencyHistory: async () => { throw new Error('meraki down'); } } });
  const r = await main(deps);
  assert.equal(r.ok, false); assert.match(r.error, /meraki down/); assert.equal(cap.upserts.length, 0);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `tools/meraki/sync-wan.js`** (mirror `tools/opmanager/sync-availability.js`): `main(deps)` — `await getConfig`; gate on `meraki_api_key` (empty → `{skipped:true}`); build the client (injected or from config); resolve `await rdb.listSiteModuleCodes('meraki')` → plain map `networkCode→site_id`; `orgUplinkStatuses` → per device/uplink current status; `orgUplinksLossLatency` → per-(serial,uplink) destination `ip`; for each uplink, `deviceLossLatencyHistory` for the **week window** (t0=period_start 00:00Z, t1=period_end 23:59Z, resolution 3600) and the **month window** → `deriveAvailability(series, {totalIntervals, missing})` + `statusColor(pct, targets.wan)` → build rows → `upsertWanSnapshots(all)`. **`totalIntervals` is computed from the WINDOW, not `series.length`**: `Math.round((Date.parse(t1) − Date.parse(t0)) / (resolution*1000))` — else `missing:'down'` degenerates to `'unknown'`. `missing` policy from config `meraki_missing_policy` (default `'down'`; **calibrated value locked in Task 7**). Wrap the whole body in try/catch → `{ok:false, error}` (best-effort; prior snapshots kept). Pre-resolve the network→site map with awaited calls BEFORE the pure derive. `require.main`-guard: the **cron/entrypoint computes `asOfWeek` via the Zoho-week helper (`getWeekRange`, UTC) so `period_start === weeks.start_date`** (the report join key AND the tz control the calibration needs); `asOfMonth` = current month bounds. Export `{ main }`.
- [ ] **Step 4: Run → PASS.** Then `node -c tools/meraki/sync-wan.js`.
- [ ] **Step 5: Commit** `feat(wan): V1b-A T6 — sync-wan collector (config-gated, best-effort, week+month)`.

---

## Task 7: Calibration harness + regression + docs (the HARD GATE)

**Files:**
- Create: `tools/meraki/calibrate.js` (dev-only, user-run with the key)
- Modify: `CLAUDE.md` (Current-State V1b-A block + 2 pitfalls)

- [ ] **Step 1: Calibration harness** — a small script that, given `MERAKI_API_KEY`/`MERAKI_ORG_ID` in env (never a CLI arg), pulls `deviceLossLatencyHistory` for **ITY-F/W-01** wan1+wan2 over the last completed Zoho week, runs `deriveAvailability` with **both** `missing` policies, and prints the two derived %s next to a prompt to compare against Meraki's Summary Report (99.86 / 97.87). It also fetches `orgUplinkStatuses` and prints current state for the cross-check. **Prints NO key.** This is the artefact the user runs; they paste back the two derived numbers.

- [ ] **Step 2: Full regression:**
```
node --test --test-force-exit tests/report-config-meraki.test.js tests/meraki-client.test.js tests/meraki-wan-quality.test.js tests/wan-snapshots.test.js tests/meraki-seed.test.js tests/meraki-sync.test.js
node --test --test-force-exit tests/await-precedence.test.js tests/report-config-opm.test.js tests/opm-classify.test.js
node --test --test-force-exit tests/pptx-monthly-golden.test.js
```
Expected all green; V1a suites unaffected; **PPTX goldens unchanged** (cheap insurance — V1b-A writes nothing to the scored/PPTX path).

- [ ] **Step 3: pg smoke** (local PG) — `initPgReports()` applies `008`, `upsertWanSnapshots`/`getWanSnapshots` round-trip + ON CONFLICT idempotent on postgres (same one-off pattern used for V1a's `007`). Clean up the seeded row.

- [ ] **Step 4: CLAUDE.md** — Current-State V1b-A block (Meraki WAN store landed, inert until `meraki_api_key`+seed set + calibration locked) + Known-Pitfalls rows: (a) Meraki gives loss/latency not uptime → `% Time Up` is DERIVED + calibration-gated, `missing`-policy config-locked; (b) WAN is per-link in `wan_link_snapshots`, NOT `infra_metric_snapshots` (PK can't hold wan1+wan2); (c) site key = Meraki network name via `site_module_codes` module `'meraki'`, seeded by site NAME.

- [ ] **Step 5: HARD-GATE checkpoint (user step).** V1b-A is **not "done"** until the user runs the calibration harness and confirms which `missing` policy reconciles to 99.86/97.87 (± tolerance) on Ity + a low % on Mana-Critical. Set `meraki_missing_policy` accordingly (config default). **Surface this to the user; do not mark A shipped before it.**

- [ ] **Step 6: Commit** `feat(wan): V1b-A T7 — calibration harness + regression + docs`.

---

## Sequencing note
V1b-A is the foundation. **V1b-C (report auto-fill) and V1b-D (dashboard) READ `wan_link_snapshots`** — do not start them until A's calibration gate passes, or they'll surface an un-calibrated %. **V1b-B (OpManager device availability)** is independent and can proceed in parallel.
