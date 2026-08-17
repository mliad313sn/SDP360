# WAN SLA / ISP Chargeback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes. TDD (red→green→commit), dual-backend, config-gated, best-effort. **Normal sites / WAN Health / report decks unchanged** (`pptx-monthly-golden` must stay green).

**Goal:** A defensible, contract-aware WAN SLA / ISP-chargeback instrument: Meraki event-log outages → availability within per-site service hours → credit tier + due + gap + amount, with a 15-min auto-notification to the ISP.

**Architecture:** Pure SLA engine (`services/wanSla.js`) + a `wan_outages` store (dual-backend, PG in prod) + a nightly event-log ingester + a 5-min open-outage poller (notifications) + routes + admin card + a standalone SLA view. Separate from WAN Health; touches nothing in `wan_link_snapshots` or the decks.

**Tech Stack:** Node/Express, better-sqlite3 + Postgres fork (`REPORTS_BACKEND`), node-cron, `services/mailer.js`, node:test.

**Spec:** `docs/superpowers/specs/2026-08-17-wan-sla-isp-chargeback-design.md` — read §7 (engine), §4 (data), §5/§6 (jobs) before starting.

---

## File structure
- `services/wanSla.js` — PURE engine: `serviceSecondsBetween`, `clipToService`, `pairEvents`, `attributeOutages`, `computeCircuitSla`. No I/O.
- `services/slaWanConfig.js` — config resolver (circuit → effective tier defaults + overrides). Pure-ish (takes the blob).
- `reports-db.js` — `wan_outages` schema (sqlite boot + `initPgReports`) + dual-backend readers. `db/postgres/reports/009_wan_outages.sql`.
- `services/reportConfig.js` — add `sla_wan_config` to `DEFAULTS`.
- `services/merakiClient.js` — add `networkEvents` (paginated).
- `tools/meraki/sync-wan-events.js` — nightly ingester. `tools/meraki/poll-wan-outages.js` — 5-min poller.
- `routes/opmanager.js` (or a new `routes/wanSla.js` mounted alike) — the 5 SLA routes. `server.js` — cron wiring + mount.
- `public/reports.html` — admin card "SLA WAN". `public/wan-sla.html` — the view. `public/_shell.js` — Insights nav entry.
- Tests: `tests/wan-sla-engine.test.js`, `tests/wan-outages-store.test.js`, `tests/wan-sla-config.test.js`, `tests/wan-event-pairing.test.js`, `tests/meraki-networkevents.test.js`, `tests/wan-events-ingest.test.js`, `tests/wan-outage-poller.test.js`, `tests/wan-sla-routes.smoke.test.js`.

---

## SLICE 1 — pure engine + storage (no UI)

### Task 1: service-hours calendar helpers (`wanSla.js`) + shared fixtures
**Files:** Create `services/wanSla.js`; Create `tests/_wanSlaFixtures.js`; Test `tests/wan-sla-engine.test.js`.
- [ ] **Step 0 — shared fixtures** (`tests/_wanSlaFixtures.js`, derived from spec §4.2, reused by every engine/route test so nothing drifts): export `SILVER` (the full tier object: `availability_target_pct:97`, `min_outage_minutes:15`, `credit_schedule:[{min:97,credit:0},{min:95,credit:10},{min:90,credit:25},{min:0,credit:50}]`, `credit_cap_pct:100`, `credit_model:'tiered'`, `response:{resolution_h:{crit1:12,crit2:24,crit3:48}}`, `hours_default`), `SILVER_OFFICE` (Mon–Fri 08-13/14-17), `SILVER_MINE` (Mon–Sun 08-13/14-17), and `AUG1`/`SEP1` month-boundary ms constants.
- [ ] **Step 1 — failing test.** A calendar `cal = {mon:[['08:00','13:00'],['14:00','17:00']], …fri same, sat:[], sun:[]}`.
```js
const { serviceSecondsBetween, clipToService } = require('../services/wanSla');
// A full SILVER office week (Mon–Fri 8h/day) = 40h.
test('serviceSecondsBetween counts only in-window time', () => {
  const from = Date.parse('2026-08-10T00:00:00Z'); // Mon
  const to   = Date.parse('2026-08-17T00:00:00Z'); // next Mon
  assert.equal(serviceSecondsBetween(SILVER_OFFICE, from, to), 40*3600);
});
test('clipToService keeps only the in-window part of an outage', () => {
  // Fri 16:30→18:00 → only 16:30–17:00 = 30min in-window
  const s = Date.parse('2026-08-14T16:30:00Z'), e = Date.parse('2026-08-14T18:00:00Z');
  assert.equal(clipToService(SILVER_OFFICE, [s, e]), 30*60);
});
test('clipToService splits across the lunch gap', () => {
  // 12:30→14:30 → 12:30–13:00 (30m) + 14:00–14:30 (30m) = 60min
  const s = Date.parse('2026-08-14T12:30:00Z'), e = Date.parse('2026-08-14T14:30:00Z');
  assert.equal(clipToService(SILVER_OFFICE, [s, e]), 60*60);
});
test('mine calendar (Mon–Sun) counts weekend service hours', () => {
  const s = Date.parse('2026-08-15T09:00:00Z'), e = Date.parse('2026-08-15T10:00:00Z'); // Sat
  assert.equal(clipToService(SILVER_MINE, [s, e]), 3600);           // office would be 0
});
```
- [ ] **Step 2 — run, expect FAIL** (module/functions absent).
- [ ] **Step 3 — implement.** UTC-as-local (§1). `serviceSecondsBetween`: iterate days in `[from,to)`, for each day look up `cal[dow]` windows, clip each window to `[from,to]`, sum. `clipToService`: for `[start,end]`, iterate the days it spans, intersect with that day's windows, sum. Windows are `HH:MM` strings → minutes-of-day. Handle empty day arrays (weekend/closed) → 0.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit** `feat(wan-sla): service-hours calendar helpers (pure)`

### Task 2: `computeCircuitSla` (the core, pure)
**Files:** Modify `services/wanSla.js`; extend `tests/wan-sla-engine.test.js`.
- [ ] **Step 1 — failing tests** covering, per spec §7: availability = 1 − counted/service within hours; month-boundary intersection (outage starting the previous month / ending next month counts only the in-month, in-window part); `attribution!=='isp'` excluded; `<min_outage_minutes` excluded; **clock_start** `'notification'` (counts from `notified_at ?? detected_start+triggerMinutes`) vs `'detection'` (from detected_start) — both figures; tiered credit bands (sorted min-desc even if config unsorted); prorata model; `credit_pct` capped at `credit_cap_pct` THEN amount computed+rounded; `gap_pp`/`gap_hours`; `allowed_s=(1−target/100)*service`; `mrc_amount=0 → amount=null`; current-month provisional (denominator = elapsed service seconds → NOT the elapsed-fraction artifact); `service_seconds==0 → availability=null`. Example:
```js
test('SILVER office: one 3h in-hours ISP outage → availability + credit tier', () => {
  const outage = { attribution:'isp', detected_start:'2026-08-11T09:00:00Z',
                   restored_end:'2026-08-11T12:00:00Z', notified_at:'2026-08-11T09:15:00Z' };
  const r = computeCircuitSla({ outages:[outage], circuit:{mrc_amount:100000,currency:'XOF'},
    tier:SILVER, maintenance:[], monthStart:AUG1, monthEnd:SEP1, clockStart:'notification',
    triggerMinutes:15, nowMs:SEP1 });
  // notification clock → counted 09:15→12:00 = 2h45 in-hours
  assert.equal(r.counted_downtime_s, (2*3600+45*60));
  assert.ok(r.availability_pct < 97 && r.credit_due === true);
  assert.equal(r.amount, Math.round(100000 * r.credit_pct/100));
});
```
- [ ] **Step 2 — FAIL.**
- [ ] **Step 3 — implement** exactly per §7 pseudocode (intersect-with-month on both branches; read stored `attribution`; `triggerMinutes` for the notification offset; `min_outage_minutes` only as the count floor; both credit models; cap-then-round; return `{availability_pct, met, credit_pct, credit_due, gap_pp, gap_hours, counted_downtime_s, allowed_s, amount, currency}` plus a second `detection`-based `availability_pct_objective`).
- [ ] **Step 3b — resolution-SLA (relève) breach, per-outage.** Add a small pure `resolutionBreaches(outages, tier)`: for each `'isp'` outage with a `restored_end`, `resolution_time = restored_end − detected_start`; **all event-log outages are total interruption = Niveau 1**, so compare to `tier.response.resolution_h.crit1` (12 h) → per-outage `{breach:boolean}`; return the count. (crit2/crit3 need degraded detection → Phase 2, noted.) Test: a 13 h outage breaches, an 11 h does not; the count aggregates.
- [ ] **Step 4 — PASS** (all engine tests).
- [ ] **Step 5 — commit** `feat(wan-sla): computeCircuitSla + relève-SLA breach (pure)`

### Task 3: `wan_outages` store (dual-backend)
**Files:** Modify `reports-db.js`; Create `db/postgres/reports/009_wan_outages.sql`; Test `tests/wan-outages-store.test.js`.
- [ ] **Step 1 — failing test:** round-trip; `listOpenWanOutages` returns only `restored_end IS NULL`; `closeWanOutage` sets `restored_end`+`duration_s`; the **one-open-row invariant** (opening a 2nd open row for the same `(site,sub_site,uplink)` is rejected/no-ops); idempotent upsert on PK.
- [ ] **Step 2 — FAIL.**
- [ ] **Step 3 — implement:** `_WAN_OUTAGE_CREATE_SQL` (const, per §4.1 columns, PK `(site_id,sub_site,uplink,detected_start)`), sqlite boot create + `initPgReports` create + `009_*.sql`. Readers `upsertWanOutage` / `getWanOutages` / `listOpenWanOutages` / `closeWanOutage` — dual-backend dispatchers (`if REPORTS_BACKEND==='postgres' return _…Pg()`). Shared `_WAN_OUTAGE_UPSERT` for both backends.
- [ ] **Step 4 — PASS** + `node --test tests/await-precedence.test.js` (new dispatchers).
- [ ] **Step 5 — commit** `feat(wan-sla): wan_outages store + readers (dual-backend)`

### Task 4: config key + resolver
**Files:** Modify `services/reportConfig.js` (DEFAULTS); Create `services/slaWanConfig.js`; Test `tests/wan-sla-config.test.js`.
- [ ] **Step 1 — failing test:** `parseSlaWanConfig(raw)` returns defaults on empty/garbage; `resolveCircuit(config, {site_id,sub_site,uplink})` merges tier defaults with circuit overrides (`hours ?? tier.hours_default`, `credit_schedule ?? tier.credit_schedule`), returns null for an unmapped circuit; `sla_wan_config` present in `reportConfig.DEFAULTS`.
- [ ] **Step 2 — FAIL.**
- [ ] **Step 3 — implement.** Add `sla_wan_config: JSON.stringify(DEFAULT_SLA_WAN_CONFIG)` to `DEFAULTS` (SILVER seeded per §4.2; GOLD/PLATINUM empty-ish). `slaWanConfig.js`: `DEFAULT_SLA_WAN_CONFIG`, `parseSlaWanConfig`, `resolveCircuit`. **DEFAULT_SLA_WAN_CONFIG additionally carries** (beyond §4.2): `event_types: ['wan_1_up','wan_1_down','wan_2_up','wan_2_down','uplink_change']` (appliance uplink up/down defaults — **exact Meraki strings are confirmed via discovery = user step**, hence config-driven not hardcoded) and `ingest: { reconcile_tolerance_minutes: 60, stale_open_hours: 24 }`. Test asserts both are present with defaults.
- [ ] **Step 4 — PASS.**
- [ ] **Step 5 — commit** `feat(wan-sla): sla_wan_config default + resolver`

### Task 5: event pairing + attribution (pure)
**Files:** Modify `services/wanSla.js`; Test `tests/wan-event-pairing.test.js`.
- [ ] **Step 1 — failing test:** `pairEvents(events)` pairs each uplink `down` with the next `up` (still-open → `restored_end:null`; out-of-order tolerated); `attributeOutages(outages, {overlapMinutes, maintenance})` marks wan1&wan2 overlaps ≥ threshold `'site'`, maintenance-window hits `'maintenance'`, else `'isp'`, with `attribution_reason`.
- [ ] **Step 2 — FAIL.**
- [ ] **Step 3 — implement** both pure functions.
- [ ] **Step 4 — PASS.**
- [ ] **Step 5 — commit** `feat(wan-sla): event pairing + cross-uplink attribution (pure)`

### Task 6: `merakiClient.networkEvents` (paginated object)
**Files:** Modify `services/merakiClient.js`; Test `tests/meraki-networkevents.test.js`.
- [ ] **Step 1 — failing test** (injected `get`): the method returns the `{events, pageStartAt, pageEndAt}` object and a helper `fetchAllNetworkEvents(client, {networkId, since})` cursor-loops via `startingAfter`/`endingBefore` until exhausted. **Also test the unconfigured/empty case**: an unconfigured client's `_get` returns `[]` (array), so `fetchAllNetworkEvents` must guard `result && result.events` being undefined → return `[]`, not throw.
- [ ] **Step 2 — FAIL.**
- [ ] **Step 3 — implement** `networkEvents({networkId, productType='appliance', startingAfter, endingBefore, perPage})` (returns the object, NOT `res.data`-as-array) + the cursor helper (in the ingester or client).
- [ ] **Step 4 — PASS.**
- [ ] **Step 5 — commit** `feat(wan-sla): merakiClient.networkEvents (paginated)`

---

## SLICE 2 — jobs + routes

### Task 7: nightly ingester
**Files:** Create `tools/meraki/sync-wan-events.js`; Test `tests/wan-events-ingest.test.js`.
- [ ] **Step 1 — failing test** (injected client + rdb): fetch events → `pairEvents` → `attributeOutages` → upsert; the **reconcile** updates the poller's open provisional row in place (targeted UPDATE by non-PK predicate; tolerance 60min) instead of duplicating; config-gated (no key → `{skipped}`); best-effort (throw → prior kept).
- [ ] **Step 2 — FAIL.**
- [ ] **Step 3 — implement** per §5 + §4.1 reconcile (pre-resolve networkId→site/sub via `listSiteMerakiMap`+`listWanSubsiteNetworks`, awaited BEFORE the pure calls — pg-Promise trap). Filter events by **`config.event_types`** (Task 4), not hardcoded strings. Reconcile tolerance = **`config.ingest.reconcile_tolerance_minutes`** (60). `main(deps)` injectable.
- [ ] **Step 4 — PASS.**
- [ ] **Step 5 — commit** `feat(wan-sla): nightly event-log ingester`

### Task 8: 5-min open-outage poller + notification
**Files:** Create `tools/meraki/poll-wan-outages.js`; Test `tests/wan-outage-poller.test.js`.
- [ ] **Step 1 — failing test** (injected `orgUplinkStatuses` + injected mailer + rdb): a down uplink opens exactly one row (invariant); after ≥`trigger_minutes` still down + armed + contact set → mailer called ONCE, `notified_at` stamped; **never sends if `restored_end` set**; disarmed (`notify.enabled=false`) → no send; recovery closes the open row. **Stale-open guard**: an open row older than `config.ingest.stale_open_hours` (24 h) with no recovery is closed with `source='stale_open'`, AND a subsequent new down on the same `(site,sub_site,uplink)` can then open a fresh row (proves the invariant is unblocked).
- [ ] **Step 2 — FAIL.**
- [ ] **Step 3 — implement** per §6 (open-row tracking, 15-min guard, never-after-restore, `mailer.send` via `services/mailer.js`, armed-OFF gate, **24 h stale-open close** — run each poll before opening new rows so the invariant never permanently blocks). `main(deps)` injectable.
- [ ] **Step 4 — PASS.**
- [ ] **Step 5 — commit** `feat(wan-sla): 5-min poller + armed-off ISP notification`

### Task 9: routes + cron wiring
**Files:** Modify `routes/opmanager.js` (or new `routes/wanSla.js`) + `server.js`; Test `tests/wan-sla-routes.smoke.test.js`.
- [ ] **Step 1 — failing smoke** (boot app, sqlite): `GET /summary?month=` returns per-circuit rows incl. an **unmapped-circuit** row when an outage has no circuit; `GET /outages`; `GET/PUT /config` **super_admin-gated** (admin→403); `POST /sync` (admin); best-effort (never 500).
- [ ] **Step 2 — FAIL.**
- [ ] **Step 3 — implement** the 5 routes (summary composes `getWanOutages`+`resolveCircuit`+`computeCircuitSla` per circuit + the `resolutionBreaches` count + unmapped rows; export.csv/xlsx evidence). Wire cron: `*/5 * * * *` poller + nightly (staggered ~05:25) ingester in `server.js`. **NOTE (serialize): `server.js` is edited here AND in Task 11 (`_htmlCache` + view route) — run these two tasks sequentially, never parallel implementers on `server.js`.**
- [ ] **Step 4 — PASS** + `await-precedence` + **`pptx-monthly-golden` unchanged**.
- [ ] **Step 5 — commit** `feat(wan-sla): routes + cron (poller 5min, ingester nightly)`

---

## SLICE 3 — UI + finish

### Task 10: admin card "SLA WAN"
**Files:** Modify `public/reports.html` (4 admin surfaces).
- [ ] Tier editor + **per-site calendar editor** (mine 7j / office 5j) + circuit→ISP map + MRC/currency + credit schedule + maintenance windows + ISP contact + **arm toggle**, saved via `PUT /config`. Parse-check the inline script. Commit `feat(wan-sla): admin card`.

### Task 11: SLA / Chargeback view
**Files:** Create `public/wan-sla.html`; Modify `public/_shell.js` (Insights nav, `bar-chart-3`-family icon in `ICON_LIB`); `server.js` `_htmlCache` + route.
- [ ] Month selector, per-circuit/ISP table (availability contract+objective, met, credit tier, due, gap pts+hours, amount|null as **text-label XOF, no glyph**), outage evidence, export, **"provisoire"** badge for current month, unmapped-circuit prompt, empty state. Parse-check; browser E2E = user step. Commit `feat(wan-sla): chargeback view + nav`.

### Task 12: finish
- [ ] CLAUDE.md Current-State block + a Known-Pitfalls row (event-log-not-loss / service-hours-clip / clock=notification / armed-off notify). Full regression (slice-1/2 suites + `await-precedence` + **`pptx-monthly-golden` unchanged**). Build deploy ZIP. Announce finishing-a-development-branch (merge = user's call). Commit `docs(claude): WAN SLA V1`.

---

## Non-goals (do NOT build)
Helpdesk-based response SLAs (info 30min / feedback 8h), Niveau 2/3 degraded SLA, Meraki Insight, non-UTC sites, any change to WAN Health / `wan_link_snapshots` / report decks. `pptx-monthly-golden` stays green throughout.
