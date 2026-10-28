# Governance policies — every regulation rule is a parameter

Code: `services/governancePolicy.js` (registry, bounds, defaults), `routes/policies.js`, page `policies.html` (Operations ▸ Governance policies, EN/FR), migration `db/postgres/reports/027_governance_policies.sql`. Status: **IMPLEMENTED · TESTED** (`tests/governance-policy.test.js`, `tests/governance-policy-routes.smoke.test.js`).

## How a value is chosen

**site value → platform value → default.** A change applies at the next request (30 s cache, invalidated on write); no restart.

## Guardrails

| Guardrail | Rule |
|---|---|
| Bounds | A value outside its range (or of the wrong type) is refused (400). |
| Reason | Every change needs a reason (3+ characters); it is stored with the value and in the history. |
| Protected | Moving a protected rule in the **less strict** direction (switching a four-eyes rule off, raising a freshness limit, lengthening a grace) needs a **super_admin** and a 10+ character reason, and is logged as a risk event (`policy_relaxed`). Tightening only needs the admin tier. |
| Site scope | Only rules marked site-scoped accept a per-site value. Source freshness limits are properties of the source and are platform-wide. |
| History | `governance_policy_history` is append-only: scope, rule, before, after, who, when, reason, relaxation flag. |
| Read access | Committee members and the admin tier read the registry; anyone reads the effective values of their own sites (`/api/governance/policies/effective`). |

## Parameters

| Key | Area | Type | Default | Bounds | Per site | Guardrail | Meaning |
|---|---|---|---|---|---|---|---|
| `reports.four_eyes` | reports | bool | true | — | yes | **protected** | The person who generated a report run cannot review or publish it; the last commentary editor cannot review it. |
| `reports.freshness_gate` | reports | bool | true | — | yes | **protected** | Refuse publication when a source behind a figure is stale or has never synced. |
| `reports.override_allowed` | reports | bool | true | — | yes | **protected** | An admin may publish despite stale sources by giving a written reason. |
| `reports.override_reason_min` | reports | int | 10 | 5 – 500 | yes | — | Minimum length of an admin override reason. |
| `reports.withdraw_reason_min` | reports | int | 5 | 3 – 500 | yes | — | Minimum length of the reason to withdraw a published report. |
| `freshness.helpdesk_hours` | freshness | number | 3 | 0.25 – 744 | platform only | **protected** | A helpdesk figure is current while its last successful sync is younger than this (hours). |
| `freshness.changes_hours` | freshness | number | 3 | 0.25 – 744 | platform only | **protected** | A changes figure is current while its last successful sync is younger than this (hours). |
| `freshness.survey_hours` | freshness | number | 3 | 0.25 – 744 | platform only | **protected** | A survey figure is current while its last successful sync is younger than this (hours). |
| `freshness.assets_hours` | freshness | number | 30 | 0.25 – 744 | platform only | **protected** | A assets figure is current while its last successful sync is younger than this (hours). |
| `freshness.wan_hours` | freshness | number | 30 | 0.25 – 744 | platform only | **protected** | A wan figure is current while its last successful sync is younger than this (hours). |
| `freshness.infra_hours` | freshness | number | 30 | 0.25 – 744 | platform only | **protected** | A infra figure is current while its last successful sync is younger than this (hours). |
| `publication.four_eyes` | publication | bool | true | — | yes | **protected** | A tracker or dashboard is published by someone other than the person who submitted or last edited it. |
| `publication.override_allowed` | publication | bool | true | — | yes | **protected** | An admin may publish without review by giving a written reason. |
| `publication.override_reason_min` | publication | int | 10 | 5 – 500 | yes | — | Minimum length of a publication override reason. |
| `meetings.missed_grace_hours` | meetings | number | 48 | 1 – 720 | yes | **protected** | A planned session not started this many hours after its time is counted as missed. |
| `meetings.minutes_four_eyes` | meetings | bool | true | — | yes | **protected** | Minutes are accepted by someone other than the person who closed the session. |
| `meetings.cancel_requires_approval` | meetings | bool | true | — | yes | **protected** | A cancelled session stays an unexcused miss until a committee member (not the canceller) approves the exception. |
| `meetings.cancel_reason_min` | meetings | int | 5 | 3 – 500 | yes | — | Minimum length of a cancellation reason. |
| `meetings.reopen_reason_min` | meetings | int | 10 | 5 – 500 | yes | — | Minimum length of the reason to reopen accepted minutes. |
| `handoffs.reason_min` | handoffs | int | 5 | 3 – 500 | yes | — | Minimum length of a reason (reject, block, escalate, cancel, rework, reassign). |
| `handoffs.overdue_escalation` | handoffs | bool | true | — | yes | **protected** | An open handoff past its due date is escalated automatically. |
| `handoffs.escalation_grace_days` | handoffs | int | 0 | 0 – 60 | yes | **protected** | Days after the due date before the automatic escalation. |
| `commitments.escalation_enabled` | commitments | bool | true | — | yes | **protected** | Record A01 / A02 escalations (serious commitment without owner / overdue without exception). |

## Invariants — deliberately NOT parameters

These protect data or people, not a working practice; a context cannot switch them off:

- Site scoping of every read and write (a site-A account never sees or changes site-B data).
- A commitment is never verified by its owner, an executor or its creator.
- A handoff is never accepted on behalf of its named receiver; the deliverer never verifies.
- The audit trail (events, histories, system log) cannot be disabled.
- "Not measured" is never shown as 0.
- Secrets never leave the server.

Adding a rule: declare it in `PARAMS` (default = today's behaviour), read it through the policy object in the pure module, add a test that a changed value changes the behaviour.
