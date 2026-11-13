# ADR-P6 — Decision motive & separation of duties, two-person soft delete, break-glass time-box

Status: accepted as an AI technical decision · 2026-11-12 · **not** reviewed by the governance committee chair, the
retention owner or the security owner · every behaviour below is behind a `report_config` switch whose default is
today's behaviour; turning one on is a human decision (`docs/ops/pilot/PILOT-PROFILE.md`).

## Context
Goals A5 and A6 (`docs/audits/2026-11-12-goal-programme/GAP-MATRIX.md`): a decision could move without a motive, the
person who proposed a completion could later confirm it, nobody was named as the expected approver, there was no
decision cycle-time KPI, a soft delete needed neither a reason nor a second person, and the break-glass password
account kept a normal 24 h session with no stated reason.

## Decisions
1. **Motive on every transition** — switch `decision_motive_required` ('0'). When '1', any status CHANGE of a decision
   needs a reason ≥ 3 characters (same rule and wording as the existing reasoned transitions, so the cockpit's "ask once
   and retry" works unchanged), in free and enforced modes. The reason lands on the decision's ledger row (`ppm_events`).
2. **Proposer ≠ confirmer** — pure `decisionLifecycle.selfConfirmRefusal`, applied in `governanceStore.updateDecision`
   whatever the switch: moving `awaiting_confirmation → done` is refused (403 `SELF_CONFIRM`) when the actor is the
   person of the latest ledger move INTO `awaiting_confirmation`. No new switch: `awaiting_confirmation` only exists
   while `decision_lifecycle_enforced` = '1' (default '0'), so today's behaviour is unchanged. Unknown proposer (legacy
   row without ledger) = not refused (we never refuse on a guess). Withdrawing (→ in_progress) stays allowed.
3. **Named pending approver** — `GET /api/governance/decisions` adds `pending_approver` to awaiting rows: the cadence's
   chair / secretary (names from the user directory), `confirmed_by: 'committee'`, proposer and date. Presentation only.
4. **Decision cycle time** — metric `governance.decision_cycle_days`, registered **draft** (decision F-DATA-11: the
   committee chooses its decision KPIs). Start = `decisions.created_at`; end = FIRST ledger move to `done`
   (`ppm_events`), legacy done decisions without a ledger row fall back to `closed_at` (the source is reported). Window
   = rolling 3 months on the adoption date; mean (median and n travel). No adopted decision → null (UNKNOWN), never 0.
   Pure `services/decisionCycle.js`; parity test recomputes it from the raw rows.
5. **Two-person soft delete** — switch `soft_delete_two_person` ('0'), effective only with `soft_delete_enabled` = '1',
   for the soft-deletable portfolio kinds and cadences (benefits keep today's hard delete — they follow their project).
   No new table: requests live in the existing append-only, hash-chained `ppm_events` ledger as
   `entity = 'delete_request:<kind>'` (`requested` / `confirmed`). First DELETE with a reason ≥ 10 characters → 202
   request; the requester is refused (409 `SECOND_PERSON_REQUIRED`); another authorised person's DELETE (same route
   guard) confirms within 7 days and stamps the row (reason = requester's reason + both ids). An expired request needs a
   new one. Restore is unchanged (admin tier). Pending list: `GET /api/governance/delete-requests` (committee), cockpit
   panel "Deletions awaiting a second person".
6. **Break-glass time-box** — switches `breakglass_timebox_enabled` ('0') and `breakglass_session_minutes` ('60',
   clamped 5..1440). Applies only to a break-glass USE (same test as the existing risk event: the configured break-glass
   user while SSO mode ≠ off). When on: 400 `REASON_REQUIRED` without a reason ≥ 10 characters; the reason and the
   minutes are written on the `breakglass_login` risk event; the minted session's `expires_at` is lowered (never
   raised) to now + minutes and the cookie lifetime matches. Default 60 min is a conservative proposal, not a decision.
   An unreadable config = switch off (the door is never locked shut by a read failure).
7. **"My access" hub** — `public/access.html` gains one section linking active sessions (super_admin), deputies
   (policies page) and emergency access (when enabled). `GET /api/access/me` returns `hub` (links only). Each target
   keeps its own guard; nothing is granted by the page.

## Consequences
- Proof: `tests/decision-lifecycle-p6.test.js` (pure) and `tests/p6-decisions-access.smoke.test.js` (live router:
  motive, SoD, pending approver, cycle parity, two-person delete + ledger + restore, break-glass cap, hub, and a
  password-vs-SSO session RBAC parity walk over guarded GET routes).
- Real SSO enablement (Entra registration, secret, cutover) and naming the break-glass holder remain human.
