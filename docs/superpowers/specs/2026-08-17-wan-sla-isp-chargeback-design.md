# WAN SLA / ISP Chargeback — Design (V1)

**Date:** 2026-08-17
**Status:** Design (spec-review round 1 folded in; pending re-review + user review)
**Builds on:** V1b (WAN availability & quality, `wan_link_snapshots`, `merakiClient`, WAN Health dashboard) and V1b-E (per-sub-site WAN).

---

## 1. Problem & goal

The network manager needs a **defensible, contract-aware instrument** to measure per-ISP WAN unavailability against each circuit's SLA and to substantiate **service-credit (chargeback) claims** — the ISP contract states **« Type de rapport : pas de rapport »** (the ISP provides none). The existing **WAN Health** dashboard is an *operational* health view (24/7 RAG); it is deliberately **not** changed. This adds a **separate SLA / Chargeback instrument**.

Anchored to a real **SILVER** ISP SLA:
- Availability target **97 %**, measured **only within the defined service hours**.
- Service hours (SILVER default): **Mon–Fri, 08:00–13:00 + 14:00–17:00** (lunch excluded). Editable **per site** (mines **Mon–Sun**, offices **Mon–Fri**) and per tier. **No holiday exclusions**.
- Fault criticality: **Niveau 1 = total interruption** = the availability metric; Niveau 2/3 = degraded (out of the 97 % scope).
- Response SLAs: info ≤30 min, first feedback ≤8 h, resolution (relève) **12 h / 24 h / 48 h** for crit 1/2/3.
- Measurement: interruption time = **notification → restoration**; frequency **1×/month** (calendar month).

**V1 hard constraint — all sites are GMT/UTC+0** (West Africa). The service-hours clipping treats event timestamps (UTC) as local. Any non-UTC site would break the clipping and is **explicitly out of scope for V1** (a per-site tz offset is a Phase-2 addition). This assumption is load-bearing and stated so the plan doesn't silently assume it generalizes.

## 2. The two decisive definitions (settled)

1. **"Down" = Meraki uplink connectivity state (option b), via the EVENT-LOG** — uplink `down`→`up` transitions, horodatés. NOT the `loss < 100` hourly derivation used by `deriveAvailability` (which overstates on degraded links and can't match Meraki; §2 acknowledges the two formulas differ). The event-log is Meraki's own determination → *evidence*, and resolves the "no-data vs loss=100" ambiguity.
2. **Availability is measured within SERVICE HOURS** — each outage is **clipped** to the site's service-hours calendar; only the in-window portion counts. At 97 % over ~173 service-hours/month, allowed downtime ≈ **5.2 h/month** in business hours; nights/weekends free (SILVER office).

## 3. Scope

**In (V1):**
- **Real-time open-outage poller** (5-min cron): detects currently-down uplinks via `orgUplinkStatuses`, opens `wan_outages` rows, and fires the **15-minute ISP auto-notification** (armed-OFF). See §6.
- **Nightly event-log ingester**: authoritative `down`→`up` pairing → fills exact `detected_start`/`restored_end`, computes cross-uplink **attribution**, reconciles the poller's provisional rows. See §5.
- Pure SLA engine: outages + config → monthly availability % per circuit within service hours → conformity → **credit tier + credit due (yes/no) + gap (points & hours)** → amount if MRC set. See §7.
- Auto-measurable response SLA: **resolution time vs 12/24/48 h**.
- Admin card **"SLA WAN"** + **SLA/Chargeback view** with **evidence export**.
- Dual-backend (sqlite + Postgres), config-gated, best-effort.

**Out (deferred / non-goals):**
- Helpdesk-dependent response SLAs (*info ≤30 min*, *first feedback ≤8 h*) → **Phase 2**.
- Niveau 2/3 (degraded) SLA. Meraki **Insight** API (licence-gated). Non-UTC sites (§1).
- Any change to WAN Health, `wan_link_snapshots`, its derivation, or the report decks. The WAN-Health **monthly-card artifact** (~53 % elapsed-fraction) is a *separate* known issue, out of scope; the SLA view avoids it by design (§7).
- No CFA amount required in V1: view shows tier + due + gap; **amount appears once per-circuit MRC is entered**.

## 4. Data model (dual-backend, PG in prod)

### 4.1 `wan_outages` — one row per detected outage (append-as-detected)
Accumulated forward (mirrors `asset_effort_history`; can't reconstruct the past). Monthly SLA is built from **stored** outages → sidesteps event-log retention.

| Column | Notes |
|---|---|
| `site_id` INTEGER NOT NULL | |
| `sub_site` TEXT NOT NULL DEFAULT '' | Exploration per-sub-site (V1b-E) |
| `uplink` TEXT NOT NULL | `wan1`/`wan2` |
| `isp` TEXT | from circuit config (NULL until mapped) |
| `circuit_id` TEXT | contractual circuit ref |
| `detected_start` TEXT NOT NULL | outage start (UTC ISO); poller = first-seen-down, corrected by the event-log pass to the exact `down` event |
| `restored_end` TEXT | `up` timestamp; NULL = still open |
| `notified_at` TEXT | when the ISP auto-notification was sent (NULL if disarmed / never crossed 15 min) |
| `duration_s` INTEGER | restored_end − detected_start (NULL while open) |
| `attribution` TEXT | `'isp'` (default, counts) \| `'site'` (wan1+wan2 simultaneous → excluded) \| `'maintenance'` |
| `attribution_reason` TEXT | human string for the evidence export |
| `network_id` TEXT, `device_serial` TEXT | provenance |
| `source` TEXT | `'meraki_status'` (poller) → `'meraki_event'` (after event-log pairing) |
| `raw_json` TEXT | raw event/status (evidence) |
| **PK** | `(site_id, sub_site, uplink, detected_start)` — composite, no surrogate id (sqlite/pg parity) |

Idempotent upsert on the PK, plus a reconcile rule with a stated invariant:
- **INVARIANT: at most ONE open row (`restored_end IS NULL`) per `(site_id, sub_site, uplink)`** at any time. The poller enforces it — it opens a row only if none is open for that key.
- **Reconcile (event-log pass corrects the poller's provisional `detected_start`→exact):** this is a **targeted `UPDATE … WHERE site_id=? AND sub_site=? AND uplink=? AND restored_end IS NULL`** — updating the PK column `detected_start` in place by a *non-PK* predicate (valid on both sqlite and pg; NOT a PK-upsert, so no duplicate row). The invariant guarantees the predicate hits exactly one row. The event is matched to the open provisional row only if the event's `down` time is within **`reconcile_tolerance_minutes` = 60** of the provisional `detected_start` (a sanity guard against pairing an unrelated stale-open row); otherwise the event inserts its own authoritative row.
- **Stale-open guard:** a provisional open row with no matching `up` event and older than **24 h** is closed with `attribution` unchanged and `source='stale_open'` rather than left open forever (prevents the invariant from blocking a genuine new outage on the same uplink).
- Closing an outage sets `restored_end`/`duration_s`. Re-ingesting the same paired event is idempotent (same PK → DO UPDATE).

### 4.2 `sla_wan_config` — JSON blob in `report_config` (admin-editable)
**MUST be added to `reportConfig.DEFAULTS`** — `setConfig` filters on `KEYS = Object.keys(DEFAULTS)` (`reportConfig.js`), so a key absent from DEFAULTS is silently dropped. Shape:
```jsonc
{
  "notify": { "enabled": false, "trigger_minutes": 15, "from_name": "SDP NOC", "poll_minutes": 5 },  // ARMED OFF
  "clock_start": "notification",   // DEFAULT 'notification' (matches the contract) | 'detection' (aggressive upper-bound)
  "maintenance": [ { "site_id": 5, "uplink": "", "from": "2026-08-20T22:00:00Z", "to": "2026-08-21T02:00:00Z", "reason": "…" } ],
  "simultaneous_overlap_minutes": 5,   // wan1&wan2 overlap ≥ this → attribution 'site' (see M2 under-claim note §11)
  "tiers": {
    "SILVER": {
      "hours_default": { "mon":[["08:00","13:00"],["14:00","17:00"]], "tue":[…], "wed":[…], "thu":[…],
                         "fri":[["08:00","13:00"],["14:00","17:00"]], "sat":[], "sun":[] },
      "availability_target_pct": 97,
      "response": { "info_min": 30, "first_feedback_h": 8, "resolution_h": { "crit1": 12, "crit2": 24, "crit3": 48 } },
      "min_outage_minutes": 15,
      "credit_schedule": [ {"min":97,"credit":0}, {"min":95,"credit":10}, {"min":90,"credit":25}, {"min":0,"credit":50} ],
      "credit_cap_pct": 100,
      "credit_model": "tiered"     // 'tiered' | 'prorata'
    },
    "GOLD": { … }, "PLATINUM": { … }
  },
  "circuits": [
    { "site_id": 5, "sub_site": "", "uplink": "wan1", "isp": "ISP-A", "circuit_id": "CI-123",
      "tier": "SILVER", "hours": null,   // null → inherit tier; mine overrides to Mon–Sun
      "mrc_amount": 0, "currency": "XOF", "credit_schedule": null, "isp_notify_email": "" }
  ]
}
```

## 5. Meraki sources

Two read-only client methods (joining the existing 5):
```
orgUplinkStatuses(...)   // ALREADY EXISTS — current state, used by the poller
networkEvents({ networkId, productType='appliance', startingAfter, endingBefore, perPage })
  → GET /networks/{networkId}/events  →  RETURNS AN OBJECT { events:[…], pageStartAt, pageEndAt }, NOT an array.
    The ingester MUST cursor-page (startingAfter/endingBefore) — the other 5 methods return arrays; this one is the exception.
```
Ingester (nightly): page the events, filter to appliance **uplink up/down** types (exact `type` strings confirmed against the org during discovery; the ingester matches a **config-declared set** with the appliance uplink up/down defaults so a Meraki string change is a config edit, not a code change), pair each `down` with the next `up` on the same uplink → `[detected_start, restored_end]`, upsert into `wan_outages`, and run a **cross-uplink attribution pass**:
- **wan1 & wan2 outage windows overlap ≥ `simultaneous_overlap_minutes`** → both marked `attribution='site'` (likely power/site) + reason.
- Inside a **maintenance** window (config) → `attribution='maintenance'`.
- Else `attribution='isp'`.
Attribution is **persisted** (the pure engine only reads the stored flag — it never recomputes it and never needs the other uplink's rows).

## 6. Auto-notification (armed-OFF, real-time poller)

A dedicated **`*/poll_minutes * * * *`** cron (default 5 min), separate from the nightly ingester:
1. `orgUplinkStatuses` → currently-down `wanX`. For each, ensure an **open** `wan_outages` row (insert with `detected_start` = first-seen-down if none open).
2. If `notify.enabled` and the open outage has been continuously down **≥ `trigger_minutes` (15)** and `notified_at IS NULL` and the circuit has `isp_notify_email`: send a timestamped email via `services/mailer.js` (reaches the internet through whichever ISP link is up — feasible because ≥2 links), stamp `notified_at`.
   - **Guard: never send if `restored_end` is already set** (no "still down" mail after recovery — B1 fix).
3. Poller closes an open row when the uplink is back up (provisional `restored_end`); the nightly event-log pass corrects timestamps.
- **Safety**: mirrors the codebase send-gates (`hygiene_send_enabled`, `scoreboard_send_enabled`) — **disarmed by default**; requires an admin to fill the ISP contact AND flip `notify.enabled`. The agent never sends; the operator arms it. Entering the contact + arming IS the authorization.
- **Contractual clock**: `notified_at` is the "notification received". With the default `clock_start='notification'`, the SLA counts from `notified_at ?? (detected_start + trigger_minutes)` — so even if auto-notify is disarmed, the contract offset still applies, and an outage that never reaches 15 min never counts (consistent with `min_outage_minutes=15`).

## 7. Pure SLA engine (`services/wanSla.js`) — no I/O

`computeCircuitSla({ outages, circuit, tier, maintenance, monthStart, monthEnd, clockStart, triggerMinutes, nowMs })` →
(`triggerMinutes` = `notify.trigger_minutes` from config, injected so the pure engine has it — it is the *notification-fired* offset, a DIFFERENT knob from `tier.min_outage_minutes` which is only the "does this outage count" floor. Do NOT couple them.)
```
cal            = circuit.hours ?? tier.hours_default
target         = tier.availability_target_pct
service_seconds= serviceSecondsBetween(cal, monthStart, min(monthEnd, nowMs))   // elapsed if month in progress
allowed_s      = (1 − target/100) × service_seconds

counted_downtime_s = 0
for outage in outages:                       // already this circuit's rows
   if outage.attribution !== 'isp': continue         // 'site' / 'maintenance' excluded (read stored flag)
   if outage.duration/… < tier.min_outage_minutes: continue     // min-outage FLOOR (distinct knob)
   chosenStart = clockStart==='notification'
                 ? (outage.notified_at ?? addMin(outage.detected_start, triggerMinutes))   // notif-fired offset
                 : outage.detected_start
   chosenEnd   = outage.restored_end ?? min(nowMs, monthEnd)
   # INTERSECT with the month on BOTH branches (I1 fix):
   start = max(chosenStart, monthStart);  end = min(chosenEnd, monthEnd)
   if end <= start: continue
   counted_downtime_s += clipToService(cal, [start, end])     // handles 2 windows/day, weekend, mine 7j vs office 5j

availability_pct = service_seconds<=0 ? null : round2(100 × (1 − counted_downtime_s / service_seconds))
met        = availability_pct != null && availability_pct >= target
bands      = sortByMinDesc(circuit.credit_schedule ?? tier.credit_schedule)   // M6: sorted min desc
credit_pct = availability_pct==null ? 0 : bands.find(b => availability_pct >= b.min).credit
credit_pct = min(credit_pct, tier.credit_cap_pct)                            // M7: cap % first…
credit_due = credit_pct > 0
gap_pp     = availability_pct==null ? null : round2(target − availability_pct)
gap_hours  = round2((counted_downtime_s − allowed_s)/3600)                    // + = over budget
amount     = circuit.mrc_amount>0 ? roundCurrency(circuit.mrc_amount × credit_pct/100) : null  // …then compute+round
```
- **Completed month** → `service_seconds` = full month's service hours. **Current month** → `min(monthEnd, nowMs)` → denominator = **elapsed** service seconds → availability reflects real outages vs elapsed service time (no elapsed-fraction artifact; view labels it "provisoire").
- **Two figures shown**: the engine is called twice (or returns both) — `clock_start='notification'` = the **binding contract figure** (headline / credit), and a `detection`-based figure = the **objective upper bound** for negotiation. `detected_start` is always in the evidence export.
- **`prorata` model**: `credit = min(cap, 100 × (counted_downtime_s − allowed_s)/service_seconds)` % of MRC (0 if ≤0).
- Monthly claim per ISP = Σ per-circuit credits.
- Pure; `nowMs`/`monthStart`/`monthEnd`/`maintenance` injected → unit-testable with no DB.

Pure helpers (shared, tested): `serviceSecondsBetween(cal, fromMs, toMs)` and `clipToService(cal, [start,end])` — 2 windows/day (lunch split), day-of-week membership, UTC-as-local (§1).

## 8. Surfaces
- **Readers** (dual-backend, awaited; covered by `await-precedence`): `upsertWanOutage`, `getWanOutages({site_id,from,to,uplink})`, `listOpenWanOutages`, `closeWanOutage`.
- **Poller** `tools/meraki/poll-wan-outages.js` (5-min cron) — §6. **Ingester** `tools/meraki/sync-wan-events.js` (nightly, staggered) — §5. Both config-gated, best-effort. Manual `POST /api/analytics/wan/sla/sync` (admin) runs the ingester.
- **Routes** (best-effort, never 500):
  - `GET /api/analytics/wan/sla/summary?month=YYYY-MM` → per-circuit rows (availability contract+objective, met, credit_pct, credit_due, gap_pp, gap_hours, amount|null, + **unmapped** rows, see §9).
  - `GET /api/analytics/wan/sla/outages?site=&from=&to=` → evidence rows.
  - `GET /api/analytics/wan/sla/export.(csv|xlsx)?month=` → evidence export.
  - `GET/PUT /api/analytics/wan/sla/config` (super_admin) → the blob (`isp_notify_email` is not a secret; no redaction needed).
  - `POST /api/analytics/wan/sla/sync` (admin).
- **Admin card "SLA WAN"** (super_admin; the 4 admin-panel surfaces): tier editor + **per-site calendar editor** (mine 7j / office 5j) + circuit→ISP map + MRC/currency + credit schedule + maintenance windows + ISP contact + **auto-notify arm toggle**.
- **SLA/Chargeback view** `public/wan-sla.html` (Insights nav, distinct from WAN Health): month selector, per-circuit/ISP table, outage evidence, export, **"provisoire"** badge for the current month. **Money is a text label** (e.g. `12 500 XOF`), **no currency glyph** (codebase convention).

## 9. Error handling / edge cases
- No `meraki_api_key` / no `circuits` → poller+ingester self-skip; SLA view empty state.
- **Unmapped circuit**: `wan_outages` rows whose `(site,sub_site,uplink)` has no `circuits[]` entry (no tier/hours) → SLA is uncomputable → shown as an **"unmapped circuit"** row with availability `null`/`none`, the raw outage count, and a "configure this circuit" prompt (never silently dropped, never a fabricated 0).
- Open outage spanning month boundary → intersected per month (§7 I1 fix).
- `service_seconds == 0` (no service hours in the window) → availability `null`/`none`, never `0`.
- `attribution ∈ {site, maintenance}` → excluded from counted downtime but **kept in evidence** with the reason (reviewable — see §11 under-claim note).
- Event-log pagination/gap failure → best-effort, prior outages kept, logged.
- MRC unset → amount `null`, view shows tier + due only.

## 10. Testing (TDD, pure-engine first)
1. `wanSla` pure: service-hours clipping (2 windows/day, lunch split, weekend, mine 7j vs office 5j), **month-boundary intersection** (outage starting prev month / ending next month counts only in-month), availability within hours, tiered bands (+ unsorted-schedule guard), prorata, cap-then-round, gap pts+hours, `allowed_s`, MRC-null→amount-null, attribution exclusion, min-outage filter, **clock_start notification vs detection (both figures)**, current-month provisional (no elapsed artifact), service_seconds==0→null. No DB.
2. `wan_outages` store round-trip + open-outage reconcile/close + idempotent upsert (both backends via await-precedence).
3. Event pairing + **cross-uplink attribution** (simultaneous overlap ≥ threshold → 'site'; maintenance → 'maintenance') — pure/ingester with injected events.
4. Poller with injected `orgUplinkStatuses` + injected mailer: opens outage, fires ≥15-min notification once, **never after restore**, disarmed → no send.
5. `networkEvents` pagination (object wrapper + cursor) — with injected transport.
6. Routes smoke (summary/outages/config/sync; super_admin gate on config; unmapped-circuit row present).
7. `await-precedence` (new dispatchers) + `pptx-monthly-golden` unchanged.

## 11. Known limits (flagged)
- **Attribution is best-effort.** "uplink down" from the MX ≈ ISP circuit, but a determined ISP can contest (last-mile power, demarcation). Guards + evidence export are the levers; the contract's own method governs the binding figure.
- **Under-claim risk on the simultaneous guard (M2):** wan1+wan2 failing together CAN be a legitimate shared-backbone ISP fault, yet we default it to `attribution='site'`. It is therefore **excluded but retained in evidence** and re-includable by the operator (not silently discarded). `simultaneous_overlap_minutes` is configurable.
- **clock_start default = notification** (contract-faithful, most defensible). `detection` gives a larger figure shown only as the objective upper bound.
- Response SLAs info/first-feedback → Phase 2. Event-log retention → history accrues forward only. Auto-notification proves *delivery attempt* (SMTP), not ISP acknowledgement. GMT-only (§1).
