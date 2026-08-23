# WAN Health — Meraki window alignment — Implementation Plan

**Goal:** WAN Health availability windows mirror Meraki Summary Report presets (Day/Week/Month =
rolling N complete days ending yesterday), computed on-demand event-based; SLA untouched.

**Architecture:** New pure `services/wanWindow.js` is the single window definition; the summary
route consumes it; the page gains a Day toggle. TDD, dual-backend-safe (no schema change),
config-gated (availability still gated on `wan_poll_last_run`), normal sites unaffected.

---

### Task 1: Pure window helper `services/wanWindow.js`
**Files:** Create `services/wanWindow.js`; Test `tests/wan-window.test.js`.
- [ ] Write failing test: `merakiWindow('week', Date.parse('2026-08-23T09:00:00Z'))` →
  `toISO='2026-08-23T00:00:00.000Z'`, `fromISO='2026-08-16T00:00:00.000Z'`, `days=7`.
  `'day'` → from Aug22 00:00; `'month'` → from Jul24 00:00; unknown → week; asOf time-of-day ignored.
- [ ] Run: `node --test tests/wan-window.test.js` → FAIL.
- [ ] Implement `merakiWindow(period, asOfMs)`: `to=startOfUTCDay(asOf)`, `days={day:1,week:7,month:30}[period]??7`, `from=to−days·86400000`; return `{fromMs,toMs,fromISO,toISO,days,period:normalized}`.
- [ ] Run → PASS. Commit.

### Task 2: Wire the summary route to `merakiWindow`
**Files:** Modify `routes/opmanager.js` (`/api/analytics/wan/summary`); Test `tests/wan-window-route.smoke.test.js`.
- [ ] Write failing smoke: boot the router with a stub `rdb` (poll active, one site/uplink, some outages), call `?period=day`/`week`/`month`, assert `res.window.from/to` deep-equal `merakiWindow(period, ~now)` (allow the to be start-of-today) and availability present.
- [ ] Run → FAIL.
- [ ] In the route: `period = {day,week,month}` (day no longer coerced to week); replace inline window math (the `nowD`/`fromISO`/`toISO` block) with `const w = merakiWindow(period, Date.now())`; keep `firstRun` clamp on `w.fromMs`; structure/quality via `getWanSnapshots({period_type: period==='day'?'week':period})`.
- [ ] Run smoke + existing `wan-sla-routes.smoke` + `await-precedence` → PASS. Commit.

### Task 3: Page — Day toggle + window display
**Files:** Modify `public/wan.html`.
- [ ] Add `<button data-p="day">Daily</button>` to `#wh-period`; render `data.window` dates under the toggle; update the sub note to “windows mirror Meraki Summary Report presets (Day/Week/Month, ending yesterday)”.
- [ ] Manual/browser check deferred to user (page behind login). Commit.

### Task 4: Regression
- [ ] `node --test tests/wan-window.test.js tests/wan-window-route.smoke.test.js tests/wan-event-availability.test.js tests/wan-dashboard.test.js tests/await-precedence.test.js` green.
- [ ] `node --test --test-force-exit tests/pptx-monthly-golden.test.js` unchanged.

### Task 5: Report WAN cell (DONE) — expose the report-week window
**Files:** Modify `server.js` (`/api/reports/:id/infra-auto`), `public/reports.html`; Test `tests/infra-auto-route.smoke.test.js`.
Review finding: the cell is **already** event-based over the report's **own week** (via
`applyEventAvailability` on the snapshot's `period_start`/`period_end`) — Meraki's *method*, and a
**fixed, reproducible** window, which is correct for an archived report (a rolling as-of-today
window would let the number drift across two Zoho weeks). Its window equals `merakiWindow('week')`
opened the day after the week closes. So we **keep the fixed week** and instead **expose it**:
- [x] `infra-auto` returns `window {from,to,days}` (the report week); test asserts it.
- [x] Client tooltip + banner show the dates + "in Meraki, open Past Week the day after = same
  period (no Custom needed)".
- [x] Goldens byte-identical (the cell is an editor override, never persisted).
