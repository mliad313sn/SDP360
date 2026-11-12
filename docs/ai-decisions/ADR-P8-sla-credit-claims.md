# ADR-P8 — SLA credit claims: lifecycle, frozen basis, audit trail, operator notification

Status: accepted as an AI technical decision · 2026-11-12 · **not** reviewed by Finance or the Network owner · arming
`wan_sla_claims_enabled` and `sla_wan_config.notify.enabled` are human decisions · amounts are "not certified" unless the
circuit's contract carries a second super_admin review (A-25).

## Context
Goal B1 (docs/audits/2026-11-12-goal-programme/SOURCE-PROMPTS.md): the WAN SLA engine (`services/wanSla.js`) computed a
credit **due** per circuit × month but nothing tracked it to **recovered**. GAP-MATRIX §B1: lifecycle, duplicate guard,
audit of state changes MISSING; evidence pack and notification approval PARTIAL.

## Decisions
1. **One claim per circuit × closed month** (`wan_sla_claims`, UNIQUE `(circuit_key, period)`, migration 098). The
   in-progress month is refused (the engine marks it provisional). A month with no credit due cannot be claimed.
2. **Lifecycle** (pure `services/wanSlaClaims.js`, the only place it is decided): due → claimed | written_off;
   claimed → credited | disputed | written_off; disputed → claimed | credited | written_off. credited and written_off are
   terminal; an explicit **reopen** (admin tier, motive) leads credited → disputed, written_off → due | claimed.
   **A motive is mandatory on every move.** `credited` requires the amount actually credited (recovered ≠ claimed).
3. **Frozen basis.** At creation and again at due → claimed (the claim leaves on the latest evidence) the engine output,
   the contract parameters and `evidence_hash = sha256(canonical outage set + parameters)` are frozen on the claim. On
   read the hash is recomputed and compared: a later outage edit / contract change shows **Stale vs evidence**; the
   frozen figure is never silently rewritten. The due amount follows the summary's rules exactly (same engine call, same
   `wan_sla_require_contract_evidence` gate) — it is the same number the SLA tab shows.
4. **Money.** Amounts keep the claim currency, NULL = unknown (never 0), never summed across currencies. Value metric
   = per quarter × currency: due / claimed / recovered / written off + open-claim aging; a USD figure is shown only as
   **indicative** with the asset rates (`xof_usd_rate`, `asset_currency_rates`) and only when every amount converts.
   Invariant 2: amounts reach the admin tier and finance-viewer only (claims API, evidence pack, trail details, and —
   fixed on the way — the existing `/api/analytics/wan/sla/summary` `amount`).
5. **Audit** = a dedicated append-only, hash-chained `wan_sla_claim_events` table (same triggers as migration 034/058),
   added to `services/auditChain.TABLES` so the nightly `audit.chain_verify` covers it. One row per create, move, edit and
   notification step, written in the same transaction as the change. Reusing `ppm_events` was rejected (its entity
   vocabulary is PPM; mixing would blur both trails).
6. **Operator notification** = an e-mail through `services/mailer` only (no ISP connector — boundary). Template + dry-run
   preview; `requested` → `approved` by a **different** person → `sent`. The send refuses unless the EXISTING arm flag
   `sla_wan_config.notify.enabled` is on AND `notifications_stop` is off AND the approval is by someone else AND the
   circuit has an operator e-mail; never twice.
7. **Teams SLA alerts** stay disarmed; the Claims tab only reports their readiness (armed, token present, channels,
   last run — booleans, never a secret).
8. Routes mount from `routes/opmanager.js` (no `server.js` growth); UI is a third tab of `wan.html` that exists only
   while the status route answers.

## Rollback
`wan_sla_claims_enabled = '0'` (404, no tab; claims stay stored). Schema: `db/postgres_rollback/098_wan_sla_claims_drop.sql`
(manual, destructive — export the evidence packs first).
