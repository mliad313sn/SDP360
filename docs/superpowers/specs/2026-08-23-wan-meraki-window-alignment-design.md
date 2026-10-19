# WAN Health — align availability windows to Meraki Summary Report presets

**Date:** 2026-08-23 · **Branch:** `feat/wan-meraki-window` · Status: approved (conversational design), NOT deployed.

## Problem
The WAN Health dashboard computes availability **event-based, on-demand** from the outage store
(`wan_outages`, fed by the Meraki network **event log** via the nightly ingester + the 5-min
poller). That architecture is already what we want. But the **windows don't match Meraki's own
Summary Report presets**, which is the tool the report editor cross-checks against (they use the
presets, never Custom):

Meraki Summary Report presets, read from the live selector on 2026-08-23:

| Preset | Dates shown | Rule |
|---|---|---|
| Past Day | 2026-08-22 → 2026-08-22 | **1 complete day ending yesterday** |
| Past Week | 2026-08-16 → 2026-08-22 | **7 complete days ending yesterday** (NOT ISO Mon–Sun) |
| Past Month | 2026-07-24 → 2026-08-22 | **30 complete days ending yesterday** (NOT calendar month) |

Uniform rule: `to = start of today (00:00)`, `from = to − N days`, N ∈ {1, 7, 30}. Every preset
**ends yesterday** (excludes the incomplete current day).

Our current route uses:
- Week = `[now − 7d, now]` → **includes today's partial day**, ends *now* not yesterday.
- Month = `this calendar month-to-date` → **not** Meraki's rolling 30 days.
- No Day option.

So a WAN Health number never lines up exactly with what the editor sees in Meraki.

## Decision
Mirror Meraki's presets exactly. Add a **Day** period. Keep the existing on-demand event-based
computation and the `wan_poll_first_run` collected-time clamp. **SLA / chargeback is untouched**
(it stays calendar-month — billing needs fixed periods).

## Design
- **New pure helper `services/wanWindow.js`** — `merakiWindow(period, asOfMs)` →
  `{ fromMs, toMs, fromISO, toISO, days, period }`, where `to = startOfUTCDay(asOf)`,
  `days = {day:1, week:7, month:30}[period] ?? 7`, `from = to − days·86400000`. Pure, UTC,
  deterministic (asOf injected). This is the single source of the window definition, reused by the
  route (and later the report cell).
- **`routes/opmanager.js` `/api/analytics/wan/summary`** — accept `period ∈ {day,week,month}`;
  replace the inline window math with `merakiWindow(period, Date.now())`. Keep the
  `wan_poll_first_run` clamp (`effFromMs = max(from, firstRun)`) and event-based calc unchanged.
  The site/uplink **structure + quality (loss/latency)** still come from `getWanSnapshots`
  (`week`/`month` as today; `day` falls back to the `week` snapshot for structure — no daily
  snapshot exists, and quality is a secondary, labelled figure). Only the **availability window**
  changes.
- **`public/wan.html`** — add a `Daily` button to the period toggle (`data-p="day"`); show the
  active window dates from `data.window`; note that windows mirror Meraki's Summary Report presets.

## Non-goals
- SLA / chargeback windows (unchanged, calendar month).
- Report WAN cell = a **rolling as-of-today** window. Review showed the cell is already
  event-based over the report's **own week** (fixed & reproducible — correct for an archived
  report; rolling would drift). We keep the fixed week and only **expose** it (`window` in
  `infra-auto` + tooltip/banner) so the editor can cross-check Meraki without Custom.
- Live per-request Meraki event-log fetch — unnecessary: the outage store already mirrors the
  ingested event log and reading it on-demand is efficient and cron-independent for the current
  window (poller keeps today fresh; nightly ingester reconciles history).
- Non-UTC site timezones (consistent with the SLA module's stated non-goal).

## Tests
- `tests/wan-window.test.js` — `merakiWindow` for day/week/month against the 2026-08-23 oracle
  (Aug22→Aug22, Aug16→Aug22-start, Jul24→Aug22-start); ends-at-start-of-today; unknown period → week.
- Route smoke — `/api/analytics/wan/summary?period=day|week|month` returns a `window` whose
  `from`/`to` equal `merakiWindow(period)` for the same asOf; existing summary smoke stays green.
- Golden `pptx-monthly-golden` + `await-precedence` unaffected (no schema/report change).
