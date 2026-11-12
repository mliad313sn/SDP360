# F-P8-SLACLAIMS — goal B1 "SLA credits: from due to recovered" (bundle P8)

Branch `goal/p8-slaclaims` from `7f8c68b`. ADR: `docs/ai-decisions/ADR-P8-sla-credit-claims.md`.
Switch: `wan_sla_claims_enabled` (default `'0'` = today: every claims route 404, no tab).

## 1. Gap matrix (after this bundle)

| Item | Status | Evidence | Fix / residual |
|---|---|---|---|
| Claim lifecycle due → claimed → credited → disputed → written_off (owner, amounts, dates) | IMPLEMENTED-DARK | `services/wanSlaClaims.js` `TRANSITIONS`/`REOPEN`/`planTransition`; store `services/wanSlaClaimsStore.js`; table `wan_sla_claims` (`db/postgres/reports/098_wan_sla_claims.sql`); routes `routes/wanSlaClaims.js` | owner = free text or user id (who owns claims = Finance decision) |
| Due amount from the engine, frozen at claim time + evidence hash, stale flag | IMPLEMENTED-DARK | `computeBasis` (same engine call and certified gate as `/sla/summary`), `evidenceHash`, `withStale` in the routes | — |
| No duplicate claim | IMPLEMENTED | UNIQUE `(circuit_key, period)` + pre-check → 409 `DUPLICATE_CLAIM` | test `create: … no duplicate` |
| Every state change audited | IMPLEMENTED | `wan_sla_claim_events` append-only + hash chain; `services/auditChain.TABLES` | `tools/pg/harden-audit-grants.sql` does not list the new table (nor the 058+ tables) — DBA step |
| Evidence pack (outages in service hours, archived beyond the Meraki window) | IMPLEMENTED-DARK | `/claims/:id/evidence.{csv,html,pdf}`; per-outage `counted_s` = `outageBreakdown` (sums exactly to the engine figure) ; source = `wan_outages` archive | PDF needs a headless browser on the host; without one the route returns the printable HTML (`X-Pdf-Fallback: html-only`) |
| Operator notification: template + dry run + approval, never unarmed | IMPLEMENTED-DARK | `/claims/:id/notify/{preview,request,approve,send}`; `notifyGate` (arm flag `sla_wan_config.notify.enabled`, `notifications_stop`, second person, recipient, once) | arming + operator e-mail per circuit = human |
| Real-time Teams SLA alerts via SDP Cloud | IMPLEMENTED-DARK (unchanged) | readiness surfaced by `/claims/status` and the tab; nothing armed | SDP Cloud OAuth token + webhooks = human (`docs/integration/2026-10-03-teams-sla-alerts-setup.md`); Connector Health page = bundle P4 |
| Amounts only to admin tier + finance-viewer (invariant 2) | IMPLEMENTED | `maskClaim`, event details masked, evidence pack masked; **pre-existing leak fixed**: `/sla/summary` `amount` was served to site editors | — |
| Value metric USD + per currency due vs claimed vs recovered, claim aging | IMPLEMENTED-DARK | `GET /claims/value` (`valueTotals`), money readers only | USD is indicative (asset FX rates, not certified) |
| UI (no orphan) | IMPLEMENTED-DARK | `public/wan.html` tab « Réclamations » (hidden until `/claims/status` answers) + `public/lib/wanClaimsPane.js` | browser E2E = human step (session login) |

## 2. Changes
- New: `services/wanSlaClaims.js` (pure), `services/wanSlaClaimsStore.js` (store + basis), `routes/wanSlaClaims.js`
  (mounted by `routes/opmanager.js` — `server.js` untouched), migration `098_wan_sla_claims.sql` + rollback
  `db/postgres_rollback/098_wan_sla_claims_drop.sql`, `public/lib/wanClaimsPane.js`.
- Edited: `routes/opmanager.js` (mount + summary amount masking), `services/reportConfig.js` (`wan_sla_claims_enabled='0'`),
  `services/capabilityRegistry.js` (`wan.sla.claims.manage`), `services/auditChain.js`, `public/wan.html`,
  `docs/ops/pilot/PILOT-PROFILE.md` (row), regenerated `FLAG-REGISTER.md`, `AUTHZ-MATRIX.md`, `INVENTORY*.{json,md}`,
  `INVENTORY-STRICT.md`, `CHART-INVENTORY.md`; `tests/.suite-manifest.json` (+22).
- `tests/ppm-rollback-scripts.test.js`: 098 added; 091 and 093 also added — the pg round-trip test was **already red on
  the base** (`cannot drop table portfolio_tasks`, the 093 EVM table depends on it but was not in the reverse chain).

## 3. Tests
- `tests/wan-sla-claims.test.js` (10, pure): inclusive tier boundary 95.00 % → 10 % / one second less → 25 %, service-hours
  clipping (night/weekend = 0), attribution site/maintenance = 0, breakdown sums to the engine for both clocks, legal +
  illegal transitions, terminal + reopen, motive, credited amount, evidence hash, masking, value totals per currency,
  notification gate, closed-month rule.
- `tests/wan-sla-claims-routes.smoke.test.js` (10, real app on PG): 404 while off; admin-only writes (editor and
  finance-viewer 403); frozen due 10 000 XOF; duplicate 409; current month / unmapped / no-credit 400; perimeter (other
  site → empty / 404) + masking (no amount in the editor payload); transitions; audit chain verified + append-only;
  stale flag; evidence pack content and masking; notification never leaves unarmed, under STOP or self-approved, one send
  through the stubbed mailer transport, never twice; value metric; Teams readiness reports booleans only; summary masking.
- `tests/wan-sla-claims-ui.test.js` (2): tab hidden until the status route answers, real routes used, no hex / inline handler.
- Failing first: the summary masking test was run against the unmasked route → `not ok` (amount served to an editor),
  then green. The claims tests target routes/modules that did not exist on the base (404 / module not found).
- Regression (PG, this worktree): wan-sla*, opm*, opmanager*, meraki*, mailer*, teams-sla*, pg-migrate*,
  alert-outbound-arm, report-config* → **309/309**; all tests reading `tools/agent/*` → **88/88**; flag-register,
  readme-truth, authz-route-matrix, error-shape, await-precedence, server-size-budget, ui-design-ratchet,
  a11y-legacy-ratchet, audit-chain, capability-registry, agent-inventory, inventory-strict, rbac-ui-gates,
  ppm-rollback-scripts, cross-site read/write sweeps, business-only boundary, money*, csp* → green. eslint clean.

## 4. Rollout note
- **Canary:** one circuit whose contract is entered AND reviewed by a second super_admin (A-25), e.g. the Mana wan1
  ISP circuit — open its last closed month's claim, walk it due → claimed → credited with the real credit note.
- **Order:** `wan_sla_claims_enabled='1'` (read + claims) first; operator e-mail stays dry-run; arm
  `sla_wan_config.notify.enabled` only after Finance validates the template on the canary (it also arms the existing
  15-minute outage e-mail — same flag, by design of the request).
- **Rollback trigger:** a due amount that disagrees with the SLA tab for the same circuit/month, an amount visible to a
  non-money account, or any e-mail leaving without an approval row → set the switch back to `'0'` (claims kept).
- **Owner:** Finance (claim owner + money) with the Network owner (circuits, contracts, operator contacts).

## 5. Value metric
`GET /api/analytics/wan/sla/claims/value?quarter=YYYY-Qn` — per currency: due vs claimed vs **recovered**, written off,
open claims and median days since due. Before = the engine's "credit due" with no recovery tracking (recovered unknown);
after = recovered per quarter from credit notes. Feeds the D2 value scoreboard.

## Residual gaps / human decisions
- Who owns claims and who may approve operator e-mails (today: any admin-tier account other than the requester).
- Contract data entry per circuit (MRC, currency, operator e-mail) and review — without it amounts are estimates/unknown.
- Arming the operator e-mail and the Teams alerts; SDP Cloud token provisioning.
- `harden-audit-grants.sql` does not yet own the new events table (DBA step); browser E2E of the tab not run.
