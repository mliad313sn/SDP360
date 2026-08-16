# Infra WAN Sub-site (Exploration) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the multi-location **Exploration** report real per-sub-site Meraki WAN data — auto-fill its `WAN1 FETEKRO`-style lines and (second slice) show sub-site cards on the WAN Health dashboard — by adding a `sub_site` dimension, while every normal site stays byte-for-byte unchanged.

**Architecture:** `sub_site` (default `''`) joins the `wan_link_snapshots` primary key; a small editable `wan_subsite_networks` table maps a site's sub-site tokens to Meraki networks; the sync fans one network to multiple `{site_id, sub_site}` targets from a single fetch; a shared UMD matcher (`public/lib/wanLineMatch.js`, used by both server and browser) resolves a report line to `(family, sub_site)` **only against configured tokens** — so a site with no sub-site config behaves exactly as today.

**Tech Stack:** Node.js, Express, better-sqlite3 + `services/pgDb.js` postgres fork (`REPORTS_BACKEND`), node:test. Read-only Meraki Dashboard API. All changes config-gated + best-effort.

**Spec:** `docs/superpowers/specs/2026-08-16-infra-wan-subsite-exploration-design.md`

**Reference skills:** @superpowers:test-driven-development · @superpowers:verification-before-completion

---

## Conventions (read once)

- **Backend flag:** tests default to sqlite (`process.env.REPORTS_BACKEND='sqlite'`, plus `DASH_USER`/`DASH_PASS` ≥12 chars, `DASH_PASS` etc.) and set `SDP_DATA_DIR` to a temp dir — copy the header of `tests/wan-snapshots.test.js`.
- **Run one test file:** `DASH_USER=x DASH_PASS=xxxxxxxxxxxx node --test --test-force-exit tests/<file>.test.js`
- **Dual-backend rule:** every DB function is `function f(){ if (REPORTS_BACKEND==='postgres') return _fPg(); return _fSqlite(); }`. `tests/await-precedence.test.js` auto-discovers these and fails if a caller drops the `await` — run it after any reader/writer change.
- **`sub_site` is `''` for normal sites everywhere.** Never NULL. This is the invariant that keeps normal sites unchanged.
- **Commit after every task.** Do NOT push. Branch: `feat/wan-subsite-exploration`.

---

## Slice 1 — Report auto-fill (the visible red cells). Tasks 1–6.

### Task 1: `sub_site` on `wan_link_snapshots` + `wan_subsite_networks` table (schema + upsert)

**Files:**
- Modify: `reports-db.js` — sqlite CREATE `reports-db.js:125-146`; `_WAN_SNAP_COLS`/upsert/`_wanVals` `reports-db.js:2472-2483`; pg init (near the `basis` ALTER, `reports-db.js:~1212`).
- Modify: `db/postgres/reports/008_wan_link_snapshots.sql`
- Test: `tests/wan-snapshots.test.js` (extend)

- [ ] **Step 1: Write the failing test** — append to `tests/wan-snapshots.test.js`:

```js
test('sub_site is part of the key: FETEKRO and "" coexist for the same site/uplink/period', () => {
  rdb.upsertWanSnapshots([
    { site_id: 42, sub_site: '',        uplink: 'wan1', period_type: 'week', period_start: '2026-08-09', availability_pct: 99.9 },
    { site_id: 42, sub_site: 'FETEKRO', uplink: 'wan1', period_type: 'week', period_start: '2026-08-09', availability_pct: 88.8 },
  ]);
  const rows = rdb.getWanSnapshots({ site_id: 42, period_type: 'week' });
  const main = rows.find(r => r.sub_site === '' && r.uplink === 'wan1');
  const sub  = rows.find(r => r.sub_site === 'FETEKRO' && r.uplink === 'wan1');
  assert.equal(main.availability_pct, 99.9, 'main row survives');
  assert.equal(sub.availability_pct, 88.8, 'FETEKRO row coexists (not overwritten)');
});
test('a row that omits sub_site stores "" not NULL', () => {
  rdb.upsertWanSnapshots([{ site_id: 43, uplink: 'wan2', period_type: 'week', period_start: '2026-08-09', availability_pct: 50 }]);
  const r = rdb.getWanSnapshots({ site_id: 43 })[0];
  assert.equal(r.sub_site, '', 'undefined sub_site coerced to ""');
});
```

- [ ] **Step 2: Run — expect FAIL** (`no column named sub_site` / coexist row overwritten).

Run: `DASH_USER=x DASH_PASS=xxxxxxxxxxxx node --test --test-force-exit tests/wan-snapshots.test.js`

- [ ] **Step 3: Implement.**
  - **sqlite inline CREATE** (`reports-db.js:125-146`): add `sub_site TEXT NOT NULL DEFAULT '',` after `site_id`, and change the PK to `PRIMARY KEY (site_id, sub_site, uplink, period_type, period_start)`.
  - **Guarded sqlite rebuild** — runs in the BOOT region (near the existing sqlite `basis` ALTER, `reports-db.js:~390`), so it **must NOT reference `_WAN_SNAP_COLS`** (that `const` is defined ~2000 lines later at `:2472` → referencing it at load = a temporal-dead-zone `ReferenceError`). **Hardcode the column list, and omit `sub_site` from the INSERT so its `DEFAULT ''` fills** (the table has no indexes/FKs, so nothing else to recreate):

```js
// V1b-E — add sub_site to the WAN PK. Guarded one-time rebuild (no indexes/FKs). Boot region.
const _wanCols = db.prepare(`PRAGMA table_info(wan_link_snapshots)`).all().map(c => c.name);
if (!_wanCols.includes('sub_site')) {
  db.exec(`ALTER TABLE wan_link_snapshots RENAME TO _wan_old;`);
  db.exec(_WAN_CREATE_SQL);   // the new CREATE (sub_site + 5-col PK), defined as a literal in the boot region
  db.exec(`INSERT INTO wan_link_snapshots
     (site_id,uplink,period_type,period_start,period_end,availability_pct,status_color,loss_pct_avg,latency_ms_avg,jitter_ms_avg,goodput_avg,status_current,uplink_label,device_serial,network_id,data_through,collected_at,source,raw_json)
   SELECT
     site_id,uplink,period_type,period_start,period_end,availability_pct,status_color,loss_pct_avg,latency_ms_avg,jitter_ms_avg,goodput_avg,status_current,uplink_label,device_serial,network_id,data_through,collected_at,source,raw_json
   FROM _wan_old;
   DROP TABLE _wan_old;`);
}
```
  > `_WAN_CREATE_SQL` is a plain string literal declared IN the boot region (not near `:2472`), used by both the initial `CREATE TABLE IF NOT EXISTS` and this rebuild. `sub_site` is intentionally absent from the INSERT/SELECT so its `DEFAULT ''` applies to migrated rows.
  - **`_WAN_SNAP_COLS`**: insert `'sub_site'` right after `'site_id'`.
  - **Upsert `ON CONFLICT`**: change to `ON CONFLICT(site_id,sub_site,uplink,period_type,period_start)`.
  - **`_wanVals`**: coerce sub_site → `''`:
    `const _wanVals = (r) => _WAN_SNAP_COLS.map(c => c === 'sub_site' ? (r.sub_site == null ? '' : r.sub_site) : (r[c] === undefined ? null : r[c]));`
  - **`008_wan_link_snapshots.sql`**: add `sub_site TEXT NOT NULL DEFAULT '',` after `site_id` and update the PK (for fresh installs).
  - **pg migration in `initPgReports`** (near the `basis` ALTER; the handle in this scope is **`_pg`**, NOT `H`): after `008` is applied, run the guarded add + PK swap:

```js
await _pg.exec(`ALTER TABLE wan_link_snapshots ADD COLUMN IF NOT EXISTS sub_site TEXT NOT NULL DEFAULT ''`);
await _pg.exec(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wan_link_snapshots_pkey'
                 AND conrelid='wan_link_snapshots'::regclass
                 AND array_length(conkey,1)=5) THEN
    ALTER TABLE wan_link_snapshots DROP CONSTRAINT IF EXISTS wan_link_snapshots_pkey;
    ALTER TABLE wan_link_snapshots ADD PRIMARY KEY (site_id, sub_site, uplink, period_type, period_start);
  END IF;
END $$;`);
```

- [ ] **Step 4: Run — expect PASS** (both new tests + the existing wan-snapshots tests still green).

- [ ] **Step 5: Commit** — `git add reports-db.js db/postgres/reports/008_wan_link_snapshots.sql tests/wan-snapshots.test.js && git commit -m "feat(wan): sub_site joins the wan_link_snapshots key (V1b-E T1)"`

---

### Task 2: `wan_subsite_networks` table + reader/writer

**Files:**
- Modify: `reports-db.js` — CREATE near the other config tables; add `listWanSubsiteNetworks`/`setWanSubsiteNetworks` next to `listSiteMerakiMap` (`reports-db.js:~1815`); export them; pg CREATE in `initPgReports`.
- Modify: `db/postgres/reports/008_wan_link_snapshots.sql` (add the CREATE).
- Test: `tests/wan-subsite-map.test.js` (new)

- [ ] **Step 1: Failing test** — round-trip + replace-all semantics:

```js
test('setWanSubsiteNetworks upserts + deletes (replace-all for the given set)', () => {
  rdb.setWanSubsiteNetworks([
    { site_id: 8, sub_site: 'FETEKRO', network: 'Exploration Fetekro' },
    { site_id: 8, sub_site: 'TANDA',   network: 'Exploration Tanda' },
  ]);
  let rows = rdb.listWanSubsiteNetworks().filter(r => r.site_id === 8);
  assert.equal(rows.length, 2);
  // Re-save without TANDA → it is removed for this site
  rdb.setWanSubsiteNetworks([{ site_id: 8, sub_site: 'FETEKRO', network: 'Exploration Fetekro X' }]);
  rows = rdb.listWanSubsiteNetworks().filter(r => r.site_id === 8);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].network, 'Exploration Fetekro X');
});
```

- [ ] **Step 2: Run — expect FAIL** (function not exported).
- [ ] **Step 3: Implement.**
  - CREATE (shared shape, in the sqlite inline schema block AND `008.sql` AND pg init):
    `CREATE TABLE IF NOT EXISTS wan_subsite_networks (site_id INTEGER NOT NULL, sub_site TEXT NOT NULL, network TEXT NOT NULL, PRIMARY KEY (site_id, sub_site));`
  - Dual-backend `listWanSubsiteNetworks()` → `SELECT wsn.site_id, wsn.sub_site, wsn.network, s.name AS site_name FROM wan_subsite_networks wsn JOIN sites s ON s.id=wsn.site_id ORDER BY s.name, wsn.sub_site`.
  - Dual-backend `setWanSubsiteNetworks(rows)`: **replace-all per touched site** — group `rows` by `site_id`; in a **real transaction**, for each touched site `DELETE … WHERE site_id=?`, then INSERT each `{sub_site, network}` where both are non-blank (trim). ⚠️ `_setSiteMerakiCodePg` is **NOT** transactional — do NOT copy it for the txn. Copy the transaction wrapper from the WAN upsert helpers instead: sqlite `db.transaction((rows)=>{…})`, pg `await pgHandle().runTransaction(async ()=>{…})` (see `_upsertWanSnapshotsSqlite`/`_upsertWanSnapshotsPg`, `reports-db.js:2496-2505`).
  - Export both from `module.exports`.
- [ ] **Step 4: Run — expect PASS.** Then `node --test … tests/await-precedence.test.js` (new dispatchers).
- [ ] **Step 5: Commit** — `"feat(wan): wan_subsite_networks store + reader/writer (V1b-E T2)"`

---

### Task 3: shared UMD matcher `wanLineMatch.js` (token-gated `(family, sub_site)`)

**Files:**
- Create: `public/lib/wanLineMatch.js` (UMD — Node `require` + browser `<script>`, like `public/lib/actionSimilarity.js`)
- Test: `tests/wan-line-match.test.js` (new)

- [ ] **Step 1: Failing test** — the normal-site invariant + token gating + multi-word + longest-token:

```js
const { parseServiceLine } = require('../public/lib/wanLineMatch');
test('no configured tokens → sub_site is always "" (normal sites unchanged)', () => {
  assert.deepEqual(parseServiceLine('WAN1 Primary', []), { family: 'wan1', sub_site: '' });
  assert.deepEqual(parseServiceLine('LAN Main', []),     { family: 'lan',  sub_site: '' });
  assert.deepEqual(parseServiceLine('WAN1', []),         { family: 'wan1', sub_site: '' });
});
test('configured token gates the sub_site; multi-word + case/accents', () => {
  const toks = ['FETEKRO', 'TANDA'];
  assert.deepEqual(parseServiceLine('WAN1 FETEKRO', toks),      { family: 'wan1', sub_site: 'FETEKRO' });
  assert.deepEqual(parseServiceLine('WAN1 Fetekro Explo', toks),{ family: 'wan1', sub_site: 'FETEKRO' });
  assert.deepEqual(parseServiceLine('LAN TANDA', toks),         { family: 'lan',  sub_site: 'TANDA' });
});
test('wlan before wan; backup/radio → family null', () => {
  assert.equal(parseServiceLine('WLAN FETEKRO', ['FETEKRO']).family, 'wifi');
  assert.equal(parseServiceLine('Backup FETEKRO', ['FETEKRO']).family, null);
});
test('longest token wins on overlap', () => {
  assert.equal(parseServiceLine('WAN1 MANA CAMP', ['MANA','MANA CAMP']).sub_site, 'MANA CAMP');
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing).
- [ ] **Step 3: Implement** `public/lib/wanLineMatch.js`:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WanLineMatch = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function normTok(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .trim().toLowerCase().replace(/\s+/g, ' ');
  }
  function family(n) {
    if (/wlan|wifi|wireless/.test(n)) return 'wifi';   // BEFORE wan
    if (/wan\s*1/.test(n)) return 'wan1';
    if (/wan\s*2/.test(n)) return 'wan2';
    if (/\bserver/.test(n)) return 'servers';
    if (/\blan\b/.test(n)) return 'lan';
    return null;                                        // backup / radio / custom
  }
  // tokens: array of configured sub-site tokens for this site (may be empty).
  function parseServiceLine(name, tokens) {
    const nn = normTok(name);
    const fam = family(nn);
    let sub = '';
    const toks = (tokens || []).map(t => ({ raw: t, n: normTok(t) })).filter(t => t.n)
      .sort((a, b) => b.n.length - a.n.length);        // longest first
    for (const t of toks) { if (nn.includes(t.n)) { sub = t.raw; break; } }
    return { family: fam, sub_site: sub };
  }
  return { normTok, parseServiceLine };
}));
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 4b: Single family source.** Make `services/opmReportFill.js` `serviceToFill(name)` **delegate** to the shared module: `serviceToFill = (name) => require('../public/lib/wanLineMatch').parseServiceLine(name, []).family` (so there is exactly ONE family classifier; no divergeable regex copies). Keep the export for back-compat. Its existing test in `tests/opm-report-fill.test.js` stays green.
- [ ] **Step 5: Commit** — `"feat(wan): shared UMD wan-line matcher, token-gated; serviceToFill delegates (V1b-E T3)"`

---

### Task 4: `buildFills` sub_site-aware (`opmReportFill.js`)

**Files:**
- Modify: `services/opmReportFill.js`
- Test: `tests/opm-report-fill.test.js` (extend)

- [ ] **Step 1: Failing test** — WAN matches by sub_site; infra-with-token → no fill; normal path unchanged:

```js
test('WAN sub-site fill matches by (uplink, sub_site) when a token is configured', () => {
  const wan = [
    { period_type:'week', uplink:'wan1', sub_site:'',        availability_pct:99, status_color:'green' },
    { period_type:'week', uplink:'wan1', sub_site:'FETEKRO', availability_pct:80, status_color:'red' },
  ];
  const fills = buildFills({ wan, tokens: ['FETEKRO'] });
  const f = fills.find(x => x.match === 'wan1' && x.sub_site === 'FETEKRO');
  assert.equal(f.value, '80%');
  assert.ok(fills.find(x => x.match === 'wan1' && x.sub_site === ''), 'main wan1 still emitted');
});
test('no tokens → only sub_site="" fills produced (normal site unchanged)', () => {
  const wan = [{ period_type:'week', uplink:'wan1', sub_site:'', availability_pct:99 }];
  const fills = buildFills({ wan, tokens: [] });
  assert.equal(fills.length, 1);
  assert.equal(fills[0].sub_site, '');
});
```
  > Note: `buildFills` now carries a `sub_site` field on each descriptor; the report line→fill match happens in the client using the same token list (Task 5). `buildFills` simply emits one descriptor per snapshot row it can fill.

- [ ] **Step 2: Run — expect FAIL** (`sub_site` undefined on descriptors).
- [ ] **Step 3: Implement.** In `buildFills({ wan, infra, staleDays, nowMs })` (do NOT add a `tokens` param — it would be dead; the token gating lives in the client match in Task 6 where the line name is known): for each WAN row emit `sub_site: r.sub_site || ''` on the descriptor (keep `match: r.uplink`, value/status/trend/stale/basis as-is). Infra descriptors keep `sub_site: ''` (OpManager has no sub-site source). buildFills is purely row-driven — it emits one descriptor per fillable snapshot row and carries `sub_site` through; it does NOT decide which report line consumes it.
- [ ] **Step 4: Run — expect PASS** + existing opm-report-fill tests green.
- [ ] **Step 5: Commit** — `"feat(wan): buildFills carries sub_site per descriptor (V1b-E T4)"`

---

### Task 5: sync fan-out — `siteByNet` → `netToTargets` (`tools/meraki/sync-wan.js`)

**Files:**
- Modify: `tools/meraki/sync-wan.js`
- Test: `tests/meraki-sync.test.js` (extend)

- [ ] **Step 1: Failing test** — a shared network resolves to two targets from one fetch:

```js
test('a network in BOTH the main map and a sub-site map fans to two rows from one fetch', async () => {
  const { deps, cap } = stub({
    rdb: {
      listSiteModuleCodes: async (m) => (m === 'meraki' ? [{ code: 'Massawa Gold Operations', site_id: 5, module: 'meraki' }] : []),
      listWanSubsiteNetworks: async () => [{ site_id: 9, sub_site: 'MASSAWA', network: 'Massawa Gold Operations' }],
    },
    networkNameById: () => 'Massawa Gold Operations',
  });
  const r = await main(deps);
  assert.equal(r.ok, true);
  const wk = cap.upserts.filter(u => u.period_type === 'week' && u.uplink === 'wan1');
  assert.ok(wk.find(u => u.site_id === 5 && u.sub_site === ''),        'Massawa mine row');
  assert.ok(wk.find(u => u.site_id === 9 && u.sub_site === 'MASSAWA'), 'Exploration MASSAWA row');
});
```
  > Extend the `stub()` helper so `rdb` includes a default `listWanSubsiteNetworks: async () => []`.

- [ ] **Step 2: Run — expect FAIL** (only one target today).
- [ ] **Step 3: Implement** in `tools/meraki/sync-wan.js`:
  - Build `netToTargets`: `Map(normNet(network) → [{site_id, sub_site}...])` merged from `listSiteModuleCodes('meraki')` (`sub_site:''`) and `listWanSubsiteNetworks()` (`sub_site: r.sub_site`). Both awaited before the loop. **Guard the sub-site call** so it doesn't break callers/tests that inject a minimal `rdb` without it (e.g. `tests/meraki-sync.test.js:84` builds `rdb` inline): `const subs = (typeof rdb.listWanSubsiteNetworks === 'function' ? await rdb.listWanSubsiteNetworks() : []) || [];` (also matches the best-effort ethos if the fn is ever absent in prod).
  - In the device loop: `const targets = netToTargets.get(_normNet(netName)) || [];` if empty → `unmapped.add(netName); continue;`. Derive `q` once per uplink/period (unchanged), then `for (const t of targets) rows.push({ site_id: t.site_id, sub_site: t.sub_site, uplink: up.interface, ...q fields... })`.
- [ ] **Step 4: Run — expect PASS** + existing meraki-sync tests green.
- [ ] **Step 5: Commit** — `"feat(wan): sync fans one network to many targets (V1b-E T5)"`

---

### Task 6a: routes — `mappings` subsites + `infra-auto` tokens

**Files:**
- Modify: `routes/opmanager.js` — `mappings` GET/PUT carry `subsites`.
- Modify: `server.js:~6449` — `infra-auto` payload adds the site's `tokens` list.
- Test: `tests/opm-routes.smoke.test.js` (extend), `tests/infra-auto-route.smoke.test.js` (extend)

- [ ] **Step 1: Failing route test** — `mappings` round-trips subsites (super_admin):

```js
test('mappings PUT/GET round-trips subsites (super_admin)', async () => {
  const res = await put('/api/analytics/wan/mappings',   // NB: result var is `res`, NOT `put` (would shadow the helper)
    { mappings: [], subsites: [{ site_id: mgoSiteId, sub_site: 'FETEKRO', network: 'Exploration Fetekro' }] }, superToken);
  assert.equal(res.status, 200);
  const got = await get('/api/analytics/wan/mappings', superToken);
  assert.ok((got.body.subsites || []).find(s => s.sub_site === 'FETEKRO'));
});
```
  (Add a `put()` body-capable helper + a super_admin token to the smoke harness as in `tests/admin-superadmin-gate.smoke.test.js`.)

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.**
  - `routes/opmanager.js`: `GET /api/analytics/wan/mappings` also returns `subsites: (await rdb.listWanSubsiteNetworks()) || []`. `PUT` also calls `await rdb.setWanSubsiteNetworks(req.body.subsites || [])`.
  - `infra-auto` route (`server.js`): after resolving `site_id`, add `tokens: ((await rdb.listWanSubsiteNetworks()) || []).filter(r => r.site_id === site_id).map(r => r.sub_site)` to the JSON response. (Do NOT pass `tokens` into `buildFills` — buildFills is row-driven; tokens are for the client match only.)
- [ ] **Step 4: Run** the two smoke suites + `await-precedence`; green.
- [ ] **Step 5: Commit** — `"feat(wan): mappings carries subsites + infra-auto carries tokens (V1b-E T6a)"`

### Task 6b: editor UI + client match, then Slice-1 regression

**Files:**
- Modify: `public/reports.html` — sub-site editor table; load `public/lib/wanLineMatch.js`; the auto-fill uses `WanLineMatch.parseServiceLine` + the payload tokens.
- Test: browser E2E behind login = user step; regression suites.

- [ ] **Step 1: Implement.**
  - Add `<script src="lib/wanLineMatch.js"></script>` in `<head>` (the boot `injectAssetVersion` appends `?v=`).
  - Add the "Exploration sub-sites" editor table under the existing mapping editor (Site `<select>` + token input + network input + ✕ + "Add sub-site"), loaded/saved via the extended `mappings` GET/PUT (extend `loadWanMap`/`saveWanMap` to also read/write `subsites`).
  - **Replace the collapsing `byMatch` map** (`reports.html:~2760` `Object.fromEntries(fills.map(f=>[f.match,f]))` and its `byMatch[key]` lookup at `~2769`) — it would collapse `wan1('')` and `wan1('FETEKRO')` into one. Instead, per rendered infra row: `const { family, sub_site } = WanLineMatch.parseServiceLine(serviceName, data.tokens || []);` then `const fill = fills.find(f => f.match === family && (f.sub_site||'') === sub_site);`. Fills only empty cells (unchanged).
- [ ] **Step 2: Verify** — inline-script parse-check `public/reports.html` (`new Function` over the single inline block); browser E2E is the user's step.
- [ ] **Step 3: Slice-1 regression** — run: `wan-snapshots`, `wan-subsite-map`, `wan-line-match`, `opm-report-fill`, `meraki-sync`, `opm-routes.smoke`, `infra-auto-route.smoke`, `await-precedence`, and **`pptx-monthly-golden` (must stay unchanged)**. Update CLAUDE.md with a V1b-E slice-1 block.
- [ ] **Step 4: Commit + checkpoint ZIP** — `"feat(wan): V1b-E slice 1 — Exploration sub-site editor + client match (T6b)"`; mention a deploy ZIP is available.

---

## Slice 2 — WAN Health dashboard sub-site view. Tasks 7–8.

### Task 7: `wanDashboard.js` sub_site grouping

**Files:**
- Modify: `services/wanDashboard.js`
- Test: `tests/wan-dashboard.test.js` (extend)

- [ ] **Step 1: Failing test** — `latestPerSite` keeps sub_site on cells; `trendSeries` keys on `(sub_site, uplink)`:

```js
test('latestPerSite carries sub_site on each uplink cell', () => {
  const out = latestPerSite([
    { site_id: 9, sub_site: 'FETEKRO', uplink: 'wan1', period_start: '2026-08-09', availability_pct: 80 },
    { site_id: 9, sub_site: 'TANDA',   uplink: 'wan1', period_start: '2026-08-09', availability_pct: 90 },
  ]);
  const site = out.find(s => s.site_id === 9);
  assert.ok(site.uplinks.find(u => u.sub_site === 'FETEKRO'));
  assert.ok(site.uplinks.find(u => u.sub_site === 'TANDA'));
});
test('trendSeries separates the same uplink by sub_site', () => {
  const s = trendSeries([
    { sub_site: 'FETEKRO', uplink: 'wan1', period_start: '2026-08-09', availability_pct: 80 },
    { sub_site: 'TANDA',   uplink: 'wan1', period_start: '2026-08-09', availability_pct: 90 },
  ]);
  assert.equal(s.length, 2, 'one series per (sub_site, uplink)');
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** `_cell` includes `sub_site: r.sub_site || ''`. `latestPerSite` keys the "latest" map on `${site}|${sub_site}|${uplink}` and sorts uplinks by `(sub_site, uplink)`. `trendSeries` keys on `${sub_site}||${uplink}`; each series object carries `{ uplink, sub_site, points }`.
- [ ] **Step 4: Run — expect PASS** + existing wan-dashboard tests green (normal rows have `sub_site:''` → identical grouping).
- [ ] **Step 5: Commit** — `"feat(wan): wanDashboard groups by sub_site (V1b-E T7)"`

### Task 8: `wan-health.html` sub-site view + finish

**Files:**
- Modify: `public/wan-health.html`
- Test: browser E2E = user step (page behind login).

- [ ] **Step 1:** In the summary card, when a site has any `sub_site !== ''` cells, render sub-site sub-headers (`FETEKRO`, `TANDA`, …) each with its wan1/wan2 dots; normal sites (all `''`) render exactly as now.
- [ ] **Step 2:** In the trend chart, label each series `<sub_site> <uplink> availability %` when `sub_site` is set (else `<uplink> …`).
- [ ] **Step 3: Verify** — `node -c`/inline-script parse-check `public/wan-health.html`; note browser E2E is the user's step.
- [ ] **Step 4: Full regression** — the Slice-1 list + `wan-dashboard`; **`pptx-monthly-golden` unchanged**. Update CLAUDE.md V1b-E block (mark dashboard slice done).
- [ ] **Step 5: Commit + finish** — `"feat(wan): V1b-E slice 2 — WAN Health sub-site cards"`. Announce the finishing-a-development-branch step (merge decision is the user's) + build the deploy ZIP.

---

## Non-goals (do NOT build)
Per-sub-site LAN/WLAN/Servers auto-fill (needs an OpManager sub-site source); making multi-sub-site general beyond Exploration; any PPTX/email/score change. Normal sites must stay byte-for-byte unchanged — the token-gating in Task 3/4/6 is the guarantee; the golden + the "no tokens" tests are the proof.
