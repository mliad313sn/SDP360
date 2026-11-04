# ADR-A25 — WAN SLA: stale-closed outages are "unknown" (pending review); credit amounts certified only with reviewed contract evidence

Status: AI technical decision · 2026-11-04 · **proposal, not approved** — both business switches ship OFF
(today's behaviour). Setting them is a decision of the Network owner (`wan_stale_close_at`) and Finance
(`wan_sla_require_contract_evidence`), never of the agent. No contract is reviewed and no credit is certified by
this change.

## Context
- The 5-minute poller (`tools/meraki/poll-wan-outages.js`) closes an outage that stayed open ≥ `stale_open_hours`
  (24 h) without being seen to recover, at the poll time, source `stale_open`, attribution left NULL. The SLA engine
  counts only `attribution = 'isp'`, so those rows were already excluded from credits — **silently**. The nightly
  ingester never revisits them (it reconciles OPEN `meraki_status` rows only).
- A credit amount is computed for every circuit with an MRC in the `sla_wan_config` JSON, which records no editor
  and no evidence (boundary rule: finance values only certified with real evidence).

## Decision
1. **Visible exclusion.** The poller labels a stale-closed row `attribution='unknown'`,
   `attribution_reason='stale_open — not reviewed'` (an existing attribution is kept). `services/wanSla.pendingReview`
   counts CLOSED rows whose attribution is `unknown` or NULL, with their detected minutes inside the month;
   `/api/analytics/wan/sla/summary` returns it per circuit as `pending_review {count, detected_minutes}` and the WAN
   SLA tab shows it. The engine is unchanged (still credits `isp` only).
2. **`wan_outages.last_seen_at`** (migration `reports/046`) — stamped on every poll that SEES the uplink down.
   Switch **`wan_stale_close_at`**: `now` (default, today: end = poll time, `duration_s` left NULL as before) |
   `last_seen` (end = last seen down, `duration_s` computed in JS). `availability24x7(…, {excludeUnknown})` drops
   `unknown` rows when a caller passes it (intended for `last_seen`; it has no production caller today).
3. **Contracts + four-eyes review.** Table `wan_circuit_contracts` (migration `reports/047`, key
   `site_id|sub_site|uplink`): ISP, MRC, currency, contract ref, evidence file (blob store, module `wan-contracts`),
   entered_by/at, reviewed_by/at. super_admin routes `GET/PUT /api/analytics/wan/sla/contracts[/:key]`,
   `GET …/:key/evidence`, `POST …/:key/review`. **The user who entered the terms cannot review them**
   (403 `SELF_REVIEW`); **any** change of terms clears the review. `certified` = reviewed contract whose MRC equals
   the configured circuit MRC; it is always returned. Switch **`wan_sla_require_contract_evidence`**: `0` (default,
   today: amount shown) | `1` (uncertified → `amount: null`, `amount_reason: "not certified"`; the credit % stays).
4. **Historic rows**: `tools/meraki/mark-stale-unknown.js` — simulation by default, `--apply` writes a JSON backup of
   the keys first, `--restore=<file>` puts NULL back; each UPDATE is guarded on the attribution it expects.

## Not done (out of scope)
No ISP connector, no change to the ISP notification (still armed OFF), credit tiers, calendars, `attributeOutages`
or the ingester. No destructive migration; no existing row is rewritten except by the owner-run backfill.

## Rollback
`wan_stale_close_at='now'`, `wan_sla_require_contract_evidence='0'` (today's output, except the explicit `unknown`
label the engine already excluded); backfill: `--restore=<file>`; schema: `db/postgres_rollback/046_*`, `047_*`
+ `DELETE FROM schema_migrations` for the two ids.
