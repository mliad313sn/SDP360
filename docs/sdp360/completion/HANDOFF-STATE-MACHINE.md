# Handoff state machine (G-22)

Interdepartmental business handoffs: one department hands a piece of work to a **named person** of another
department. Code: `services/handoffLifecycle.js` (pure rules), `services/handoffStore.js`, `routes/handoffs.js`,
`public/handoffs.html` (EN/FR), migration `db/postgres/reports/026_handoffs.sql`. Feature flag
`handoffs_enabled` (default `0` = every route answers 404). Notifications: `handoff_notify_enabled` (default `0`).

Status: **IMPLEMENTED · TESTED** (synthetic personas). Not FIELD_VALIDATED, not DEPLOYED, not BUSINESS_ACCEPTED.

## States and transitions

| From | To | Who | Reason required |
|---|---|---|---|
| requested | accepted | the named receiver | no |
| requested | rejected | the named receiver | yes |
| requested | cancelled | requester (or admin) | yes |
| accepted | blocked | receiver | yes (the blocker) |
| accepted | delivered | receiver | no |
| accepted | cancelled | requester (or admin) | yes |
| blocked | accepted | receiver (unblocked) | no |
| blocked | escalated | requester (or admin) | yes |
| blocked | cancelled | requester (or admin) | yes |
| escalated | accepted | receiver (resumes) | no |
| escalated | rejected | admin | yes |
| escalated | cancelled | requester (or admin) | yes |
| rejected | requested | requester (resubmits) | no |
| rejected | cancelled | requester (or admin) | yes |
| delivered | verified | requester (or admin) — **never the deliverer** | no |
| delivered | accepted (rework) | requester (or admin) | yes |
| verified, cancelled | — | final | — |

Reassignment (requester or admin, with a reason, while requested / accepted / blocked / escalated): the receiver
changes and the handoff goes back to **requested** — the new receiver accepts it themselves.

Overdue: the hourly job `handoffs.escalate` moves an open handoff (requested / accepted / blocked) whose due date
has passed to **escalated** once (`escalated_from` keeps the previous state). It self-skips while the flag is off.

## Rules and where each one is proven

| Rule | Test |
|---|---|
| Nothing is accepted on the receiver's behalf — not by the requester, a colleague, or an admin | `tests/handoff-lifecycle.test.js`, `tests/handoffs.smoke.test.js` "full path" |
| The requester cannot be the receiver; departments must differ and exist in the department list | smoke "intake" |
| A repeated submit (same `idem_key`) returns the first handoff, never a duplicate | smoke "intake" |
| The receiver must be an active user working on the handoff's site | smoke "intake" |
| Late reassignment returns to `requested`; the former receiver loses the power to act | smoke "late reassignment" |
| Permission downgrade: a receiver moved to another site cannot act, on the same live session | smoke "permission downgrade" |
| The deliverer cannot verify; rework needs a reason; verified is final; stale version → 409 | smoke "full path" |
| Overdue escalation happens once | smoke "overdue" |
| Notifications off by default; on → the receiver gets an in-app notification | smoke "notifications" |
| Another site sees nothing (list empty, detail and writes 404) | smoke "scope" |
| Every change is an append-only event with time and actor (`null` actor = the scheduler) | smoke "full path", "overdue" |

## Known limit (data, not code)

User accounts carry **no department attribute**. The receiving department is therefore a label checked against
`action_departments`; the duty sits with the named receiver. "Wrong division" is enforced as "only the named
receiver may act". If the business wants department-wide queues, a user↔department mapping must be supplied
first (decision for the platform owner).

## Human gates

- Enabling `handoffs_enabled` on production (CAB).
- Who is notified, and on which channel beyond in-app (D-04).
- Field validation with a pilot site (D-05).
