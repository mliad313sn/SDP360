# WAN SLA / ISP Chargeback — Design (V1)

**Date:** 2026-08-17
**Status:** Design (approved in brainstorming; pending spec-review + user review)
**Builds on:** V1b (WAN availability & quality, `wan_link_snapshots`, `merakiClient`, WAN Health dashboard) and V1b-E (per-sub-site WAN).

---

## 1. Problem & goal

The network manager needs a **defensible, contract-aware instrument** to measure per-ISP WAN unavailability against each circuit's SLA and to substantiate **service-credit (chargeback) claims** — because the ISP contract explicitly states **« Type de rapport : pas de rapport »** (the ISP provides none). The existing **WAN Health** dashboard is an *operational* health view (24/7 RAG); it is deliberately **not** changed by this work. This adds a **separate SLA / Chargeback instrument**.

Anchored to a real **SILVER** ISP SLA:
- Availability target **97 %**, measured **only within the defined service hours** (« dans la limite de l'horaire défini »).
- Service hours (SILVER default): **Mon–Fri, 08:00–13:00 + 14:00–17:00** (lunch 13–14 excluded). Fully editable **per site** (mines run **Mon–Sun**, offices **Mon–Fri**) and per tier (GOLD/PLATINUM extend hours). Timezone **GMT/UTC** for all sites. **No holiday exclusions** (sites work holidays).
- Fault criticality: **Niveau 1 = total interruption** (this is the availability metric); Niveau 2/3 = degraded (out of the 97 % scope).
- Response SLAs: info ≤30 min, first feedback ≤8 h, resolution (relève) **12 h / 24 h / 48 h** for crit 1/2/3.
- Measurement: interruption time = **notification → restoration**; frequency **1×/month** (calendar month).

## 2. The two decisive definitions (settled)

1. **"Down" = Meraki uplink connectivity state (option b), via the EVENT-LOG** — uplink `down`→`up` transitions, horodatés à la seconde. NOT the `loss < 100` hourly derivation (which overstates on degraded links and can't match Meraki). The event-log is Meraki's own determination → *evidence*, not a home-grown formula. It also resolves the "no-data vs loss=100" ambiguity of the loss-history path (explicit up/down events).
2. **Availability is measured within SERVICE HOURS** — each outage is **clipped** to the site's service-hours calendar (GMT); only the in-window portion counts. At 97 % over ~173 service-hours/month, allowed downtime ≈ **5.2 h/month** in business hours; nights/weekends are free (SILVER office) — this is the whole point of the contract's « horaire de service ».

## 3. Scope

**In (V1):**
- Meraki event-log ingestion → per-outage records.
- Auto-notification to the ISP at the **15-minute** outage mark (via the alternate live ISP link), **armed-OFF by default**.
- Pure SLA engine: outages + config → monthly availability % per circuit within service hours → conformity vs target → **credit tier + credit due (yes/no) + gap (points & hours)** → amount if MRC configured.
- Auto-measurable response SLA: **resolution time (relève) vs 12/24/48 h** (restoration − detection).
- Admin card **"SLA WAN"** (config: tiers, per-site calendar, circuit→ISP map, MRC, credit schedule, ISP contacts, auto-notify arm).
- **SLA / Chargeback view** (separate page/section) with **evidence export**.
- Dual-backend (sqlite + Postgres), config-gated, best-effort.

**Out (deferred / non-goals):**
- **Response SLAs that need the helpdesk**: *info ≤30 min* and *first feedback ≤8 h* (require human/ticket timestamps) → **Phase 2**. (Auto-notification partially covers "info" but the contractual first-feedback is human.)
- Niveau 2/3 (degraded) SLA — the 97 % is Niveau 1 only.
- Meraki **Insight** uptime API (licence-gated) — event-log is the chosen source.
- Any change to WAN Health dashboard or the existing `wan_link_snapshots` derivation. (The WAN-Health **monthly card artifact** — ~53 % = elapsed-fraction — is a *separate* known issue, out of scope here; the SLA view avoids it by design, see §7.)
- No **CFA amount required** in V1: the view shows tier + due (yes/no) + gap; the **amount appears automatically once the per-circuit MRC is entered** in config.

## 4. Data model (dual-backend, PG in prod)

### 4.1 `wan_outages` — one row per detected outage (append-as-detected)
Stored incrementally so monthly SLA is built from **accumulated** outages (sidesteps event-log retention AND any month-in-progress artifact). Pattern mirrors `asset_effort_history` (accumulate forward, can't reconstruct the past).

| Column | Notes |
|---|---|
| `site_id` INTEGER NOT NULL | |
| `sub_site` TEXT NOT NULL DEFAULT '' | Exploration per-sub-site (V1b-E) |
| `uplink` TEXT NOT NULL | `wan1`/`wan2` |
| `isp` TEXT | resolved from circuit config (nullable until mapped) |
| `circuit_id` TEXT | contractual circuit ref |
| `detected_start` TEXT NOT NULL | Meraki event `down` timestamp (UTC ISO) |
| `restored_end` TEXT | Meraki event `up` timestamp; NULL = still down |
| `notified_at` TEXT | when the ISP auto-notification was sent (NULL if not/where disarmed) |
| `duration_s` INTEGER | restored_end − detected_start (NULL while open) |
| `network_id` TEXT, `device_serial` TEXT | provenance |
| `source` TEXT | `'meraki_event'` |
| `raw_json` TEXT | the raw event pair (evidence) |
| **PK** | `(site_id, sub_site, uplink, detected_start)` — composite, no surrogate id (sqlite/pg parity) |

Idempotent upsert on the PK (re-ingesting the same event updates `restored_end`/`duration_s`/`notified_at`). An **open** outage (no `up` yet) is updated when its `up` event later arrives.

### 4.2 `sla_wan_config` — JSON blob in `report_config` (admin-editable)
Must be added to `reportConfig.DEFAULTS` (else `setConfig` silently drops it — documented trap). Shape:
```jsonc
{
  "notify": { "enabled": false, "trigger_minutes": 15, "from_name": "SDP NOC" },   // armed OFF by default
  "clock_start": "detection",     // 'detection' | 'notification' (contractual toggle; default detection)
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
    "GOLD": { … }, "PLATINUM": { … }   // pre-seeded empty/looser, admin fills
  },
  "circuits": [
    { "site_id": 5, "sub_site": "", "uplink": "wan1", "isp": "ISP-A", "circuit_id": "CI-123",
      "tier": "SILVER",
      "hours": null,                 // null → inherit tier default; mine overrides to Mon–Sun
      "mrc_amount": 0, "currency": "XOF",
      "credit_schedule": null,       // null → inherit tier
      "isp_notify_email": "" }       // per-circuit/ISP contact for auto-notification
  ]
}
```

## 5. Meraki source — event-log

New `merakiClient` method (read-only), joining the existing 5:
```
networkEvents({ networkId, productType='appliance', startingAfter, endingBefore, perPage })
  → GET /networks/{networkId}/events?productType=appliance&...
```
Filter to **uplink connectivity** event types (`type` like `wan_1_up`/`wan_1_down`/`uplink_change` — exact strings confirmed against the org during discovery; the ingester matches a configurable set, defaulting to the appliance uplink up/down types). Pair each `down` with the next matching `up` on the same uplink → an outage `[detected_start, restored_end]`. Retention is a few weeks → the nightly ingester runs incrementally and **appends** to `wan_outages` (never relies on re-querying old months).

**Attribution guards (defensibility) in the ingester/engine:**
- **wan1 + wan2 down simultaneously** → likely a **site/power** issue, not two ISPs failing at once → flagged `attribution='site'` and **excluded** from a circuit's counted downtime by default (configurable).
- **Maintenance windows** (config) → excluded.
- Only outages **≥ `min_outage_minutes` (15)** count.

## 6. Auto-notification (armed-OFF)

When an **open** outage crosses **15 min** and `notify.enabled` is true and the circuit has an `isp_notify_email`:
- Send a timestamped email to the ISP contact **via `services/mailer.js`** (the SMTP path already reaches the internet through whichever ISP link is up — feasible precisely because ≥2 links). Subject/body: site, circuit_id, uplink, `detected_start`, "still down as of <now>".
- Stamp `wan_outages.notified_at`.
- **Safety**: mirrors the codebase's send-gates (`hygiene_send_enabled`, `scoreboard_send_enabled`) — **disarmed by default**; requires an admin to (a) fill the ISP contact and (b) flip `notify.enabled`. The agent never sends; the operator arms it. Entering the ISP contact + arming IS the authorization act.
- The `notified_at` timestamp is the contractual "notification received". With `clock_start='detection'` (default), counted downtime is the full `detection→restoration` window and the 15-min notification merely **proves** the ISP was informed within the 30-min info SLA. With `clock_start='notification'`, counted downtime is `notified_at→restoration` (concedes the first 15 min) — a one-flag change for ISPs that insist on it.

## 7. Pure SLA engine (`services/wanSla.js`) — no I/O

`computeCircuitSla({ outages, circuit, tier, monthStart, monthEnd, clockStart, nowMs })` →
```
1. Resolve the effective service-hours calendar (circuit.hours ?? tier.hours_default).
2. For each outage in [monthStart, monthEnd): pick the counted window
     start = clockStart==='notification' ? (notified_at ?? detected_start) : detected_start
     end   = restored_end ?? min(monthEnd, nowMs)         // open outage → up to now/month-end
   then CLIP [start,end] onto the service-hours calendar (GMT) → Σ in-window seconds.
   Skip if attribution==='site' (simultaneous) or inside a maintenance window or < min_outage.
3. service_seconds = Σ service-hours seconds in [monthStart, monthEnd) (or elapsed if month in progress).
4. availability_pct = 100 × (1 − counted_downtime_s / service_seconds).   // null if service_seconds==0
5. met = availability_pct >= target.
6. credit_pct = first band where availability_pct >= band.min   (tiered) OR prorata formula.
7. credit_due = credit_pct > 0.
8. gap_pp = target − availability_pct;  gap_hours = counted_downtime_s/3600 − allowed_downtime_s/3600.
9. amount = mrc_amount>0 ? round(mrc_amount × credit_pct/100, cap) : null.   // null → view shows tier only
```
- **Completed month** → `service_seconds` = full month's service hours (contract measures 1×/month at month-end). **Current month** → provisional, `service_seconds` = elapsed service hours to `nowMs` (so no elapsed-fraction artifact — availability reflects real outages vs elapsed service time, clearly labelled "provisoire").
- **Credit models**: `tiered` (default, international norm: % of MRC stepped by shortfall) or `prorata` (`(counted_downtime − allowed_downtime)/service_seconds × MRC`). Cap at `credit_cap_pct` % of MRC.
- Monthly claim per ISP = Σ per-circuit credits.
- Pure & `nowMs`/`monthStart`/`monthEnd` injected → unit-testable with no DB.

Service-hours calendar helper (pure): `serviceSecondsBetween(cal, fromMs, toMs)` and `clipToService(cal, [start,end])` — handle **2 windows/day** (lunch split), day-of-week membership, GMT. Shared by steps 2 & 3.

## 8. Surfaces

- **Readers** (dual-backend, awaited): `upsertWanOutage(row)`, `getWanOutages({site_id, from, to, uplink})`, `listOpenWanOutages()`.
- **Ingester** `tools/meraki/sync-wan-events.js` — config-gated, best-effort; nightly cron (staggered after `sync-wan`); also `POST /api/analytics/wan/sla/sync`. Fetches events → pairs → upserts outages → fires due auto-notifications.
- **Routes** (best-effort, never 500):
  - `GET /api/analytics/wan/sla/summary?month=YYYY-MM` → per-circuit SLA rows (availability, met, credit_pct, credit_due, gap, amount|null).
  - `GET /api/analytics/wan/sla/outages?site=&from=&to=` → evidence rows.
  - `GET /api/analytics/wan/sla/export.(csv|xlsx)?month=` → evidence export (the report the ISP doesn't give).
  - `GET/PUT /api/analytics/wan/sla/config` (super_admin) → the `sla_wan_config` blob (redact nothing — no secrets; `isp_notify_email` is not a secret).
  - `POST /api/analytics/wan/sla/sync` (admin) → run the ingester.
- **Admin card "SLA WAN"** (super_admin, 4 admin-surface wiring): tier editor + **per-site calendar editor** (mine 7 j / office 5 j) + circuit→ISP map + MRC/currency + credit schedule + ISP contact + **auto-notify arm toggle**.
- **SLA / Chargeback view** (`public/wan-sla.html`, Insights nav, distinct from WAN Health): month selector, per-circuit/ISP table (availability vs target, credit tier, due, gap in pts+hours, amount if MRC), outage evidence list, export button, "provisoire" badge for the current month.

## 9. Error handling / edge cases
- No `meraki_api_key` or no `circuits` → ingester self-skips; SLA view empty state. Config-gated.
- Open outage spanning month boundary → clipped per month.
- `service_seconds == 0` (e.g. a week with no configured service hours) → availability `null`/`none`, never `0`.
- Simultaneous wan1+wan2 → `attribution='site'`, excluded (configurable) + shown in evidence with the reason.
- Event-log gap/pagination failure → best-effort, prior outages kept, logged.
- MRC unset → amount `null`, view shows tier + due only.

## 10. Testing (TDD, pure-engine first)
1. `wanSla` pure: service-hours clipping (2 windows/day, lunch split, weekend, mine 7 j vs office 5 j), availability within hours, tiered credit bands, prorata, cap, gap pts+hours, MRC-null→amount-null, simultaneous exclusion, min-outage filter, clock_start toggle, current-month provisional. No DB.
2. `wan_outages` store round-trip + open-outage update + idempotent upsert (both backends via await-precedence).
3. Event pairing (down→up, still-open, out-of-order) — pure.
4. Ingester with an injected client (stub events) → outages upserted, ≥15-min due notification fired (injected mailer), disarmed → no send.
5. Routes smoke (summary/outages/config/sync, super_admin gate on config).
6. `await-precedence` covers the new dual-backend dispatchers.
7. `pptx-monthly-golden` unchanged (this feature touches nothing in the report decks).

## 11. Known limits (flagged)
- Attribution is **best-effort**: "uplink down" measured from the MX ≈ ISP circuit, but a determined ISP can still contest (last-mile power, demarcation). The wan1+wan2-simultaneous guard + maintenance exclusions + the evidence export are the defensibility levers; the contract's own method governs the binding figure.
- Response SLAs *info/first-feedback* need helpdesk data → Phase 2.
- Event-log retention → history accrues forward only (like `asset_effort_history`); a fresh deploy has no back-history.
- The auto-notification proves *delivery attempt* (SMTP) not *ISP acknowledgement*; `clock_start='detection'` default keeps the client's position strongest.
