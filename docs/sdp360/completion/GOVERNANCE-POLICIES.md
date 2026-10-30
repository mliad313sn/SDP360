# Governance policies — every regulation rule is a parameter

Code: `services/governancePolicy.js` (registry, bounds, defaults), `routes/policies.js`, page `policies.html` (Operations ▸ Governance policies, EN/FR), migration `db/postgres/reports/027_governance_policies.sql`. Migrations `027_governance_policies.sql`, `028_policy_proposals.sql`. Status: **IMPLEMENTED · TESTED** (`tests/governance-policy.test.js`, `tests/governance-policy-routes.smoke.test.js`, `tests/governance-policy-coverage.test.js` — one behaviour probe per parameter). Hardened after the committee review of 2026-10-28 (`COMMITTEE-REVIEW-2026-10-28.md`).

## How a value is chosen

**site value → country value → business-unit value → platform value → default.** A site carries an optional country and business unit (migration 036, set by a super_admin in the "Sites: country and business unit" card; moving a site between groups is logged, as a risk when one of its protected rules becomes less strict). Group values exist only for site-scoped rules and pass the same guardrails (relaxing one is a two-person proposal). A relaxation whose `expires_at` has passed no longer applies (the stricter value is back). A change applies at the next request on **every** server process: each read compares the history version (`MAX(id)`) and reloads when it moved; no restart. If the store cannot be read, the **last good snapshot** keeps applying (never a silent fall back to defaults that would drop a stricter site value); a stored value outside the current bounds is ignored and logged (`invalid_policy_value`).

Every change is replayable: `rowsAsOf(history, date)` rebuilds the values in force at any date from the append-only history (a relaxation's end date is recorded with it, migration 033). With `meetings.compliance_as_of` on, each session is judged with the rules in force at its scheduled date.

Freshness defaults are taken from the sync job declarations (`services/sync/jobs.js` `FRESHNESS_HOURS`), so publication, `/api/sync/health` and the alerts start from the same number.

## Guardrails

| Guardrail | Rule |
|---|---|
| Bounds | A value outside its range (or of the wrong type) is refused (400). |
| Reason | Every change needs a reason (3+ characters); it is stored with the value and in the history. |
| Protected | Moving a protected rule in the **less strict** direction (switching a four-eyes rule off, raising a freshness limit, lengthening a grace, lowering a reason minimum) needs a **super_admin** and a 10+ character reason. Tightening only needs the admin tier. |
| Two people | Under `governance.dual_approval_relaxations` (on by default) the relaxation is only a **proposal** (202): a DIFFERENT super_admin approves or rejects it (`POST /api/governance/policies/proposals/:id/approve` · `/reject`). The proposer never decides; one pending proposal per rule; proposals lapse after 7 days. The history row names both people. Events: `policy_relaxation_proposed`, `policy_relaxed`, `policy_relaxation_rejected` (risk). |
| Temporary | An approved relaxation carries `expires_at` (at most `governance.relaxation_max_days`, 90 by default) and stops applying at that date. Clearing it earlier is a tightening (admin tier). |
| Site scope | Only rules marked site-scoped accept a per-site value. Source freshness limits are properties of the source and are platform-wide. Trackers have no site and follow the platform value. |
| Atomic | Read → check → write runs in one transaction under a per-rule advisory lock: two concurrent writers cannot both pass the check against a stale value. |
| History | `governance_policy_history` is append-only, **enforced by the database** (trigger `sdp_append_only`, also on `handoff_events`, `commitment_events`, `closure_verifications`): scope, rule, before, after, who, proposer, approver, when, reason, relaxation flag. |
| Oversight | `GET /api/governance/oversight?from=&to=[&format=csv]` (committee): relaxations, publication / report overrides, proposals, and every value that differs from its default, flagged when less strict — the exceptions register for the periodic MEA02 review. |
| Read access | Committee members and the admin tier read the registry; anyone reads the effective values of their own sites (`/api/governance/policies/effective`). |

## Parameters

| Key | Area | Type | Default | Bounds | Per site | Guardrail | Meaning |
|---|---|---|---|---|---|---|---|
| `governance.dual_approval_relaxations` | governance | bool | true | — | platform only | **protected** | Relaxing a protected rule is a two-person act: one super_admin proposes, another approves (proposals expire after 7 days). |
| `governance.dual_approval_tightening` | governance | bool | false | — | platform only | **protected** | Tightening a protected rule also takes two people (a very short freshness limit or a very long reason minimum can stop work across the platform). Off = the admin tier tightens alone, the behaviour until now. |
| `governance.relaxation_max_days` | governance | int | 90 | 1 – 365 | platform only | **protected** | A relaxed protected rule reverts to the stricter value automatically after this many days (a new relaxation is needed to keep it). |
| `reports.four_eyes` | reports | bool | true | — | yes | **protected** | The person who generated a report run cannot review or publish it; the last commentary editor cannot review it. |
| `reports.freshness_gate` | reports | bool | true | — | yes | **protected** | Refuse publication when a source behind a figure is stale or has never synced. |
| `reports.override_allowed` | reports | bool | true | — | yes | **protected** | An admin may publish despite stale sources by giving a written reason. |
| `reports.override_reason_min` | reports | int | 10 | 5 – 500 | yes | **protected** | Minimum length of an admin override reason. |
| `reports.withdraw_reason_min` | reports | int | 5 | 3 – 500 | yes | **protected** | Minimum length of the reason to withdraw a published report. |
| `freshness.helpdesk_hours` | freshness | number | 3 | 0.25 – 744 | platform only | **protected** | A helpdesk figure is current while its last successful sync is younger than this (hours). |
| `freshness.changes_hours` | freshness | number | 3 | 0.25 – 744 | platform only | **protected** | A changes figure is current while its last successful sync is younger than this (hours). |
| `freshness.survey_hours` | freshness | number | 3 | 0.25 – 744 | platform only | **protected** | A survey figure is current while its last successful sync is younger than this (hours). |
| `freshness.assets_hours` | freshness | number | 30 | 0.25 – 744 | platform only | **protected** | A assets figure is current while its last successful sync is younger than this (hours). |
| `freshness.wan_hours` | freshness | number | 30 | 0.25 – 744 | platform only | **protected** | A wan figure is current while its last successful sync is younger than this (hours). |
| `freshness.infra_hours` | freshness | number | 30 | 0.25 – 744 | platform only | **protected** | A infra figure is current while its last successful sync is younger than this (hours). |
| `publication.four_eyes` | publication | bool | true | — | yes | **protected** | A tracker or dashboard is published by someone other than the person who submitted or last edited it. |
| `publication.override_allowed` | publication | bool | true | — | yes | **protected** | An admin may publish without review by giving a written reason. |
| `publication.override_reason_min` | publication | int | 10 | 5 – 500 | yes | **protected** | Minimum length of a publication override reason. |
| `meetings.missed_grace_hours` | meetings | number | 48 | 1 – 168 | yes | **protected** | A planned session not started this many hours after its time is counted as missed. |
| `meetings.minutes_four_eyes` | meetings | bool | true | — | yes | **protected** | Minutes are accepted by someone other than the person who closed the session. |
| `meetings.cancel_requires_approval` | meetings | bool | true | — | yes | **protected** | A cancelled session stays an unexcused miss until a committee member (not the canceller) approves the exception. |
| `meetings.cancel_reason_min` | meetings | int | 5 | 3 – 500 | yes | **protected** | Minimum length of a cancellation reason. |
| `meetings.reopen_reason_min` | meetings | int | 10 | 5 – 500 | yes | **protected** | Minimum length of the reason to reopen accepted minutes. |
| `meetings.compliance_as_of` | meetings | bool | false | — | yes | — | Judge each past session with the rules in force at its scheduled date (a later change does not rewrite past compliance). Off = the rules of today apply to every session shown, the behaviour until now. |
| `meetings.reopen_two_people` | meetings | bool | false | — | yes | **protected** | Reopening accepted minutes takes two admins: one requests it with a reason, ANOTHER confirms it (off = one admin with a reason, the behaviour until now). |
| `meetings.group_decisions_public` | meetings | bool | true | — | platform only | **protected** | Decisions of group-level (committee) sessions are listed for every account; off = only the committee, the chair / secretary and the participants see them, like the sessions themselves. |
| `handoffs.reason_min` | handoffs | int | 5 | 3 – 500 | yes | **protected** | Minimum length of a reason (reject, block, escalate, cancel, rework, reassign). |
| `handoffs.overdue_escalation` | handoffs | bool | true | — | yes | **protected** | An open handoff past its due date is escalated automatically. |
| `handoffs.escalation_grace_days` | handoffs | int | 0 | 0 – 60 | yes | **protected** | Days after the due date before the automatic escalation. |
| `handoffs.commitment_ledger` | handoffs | bool | false | — | yes | — | Every new handoff is also recorded in the commitments ledger (one commitment owned by the receiver, linked to the handoff; needs commitments enabled). Off = handoffs and commitments stay separate registers, the behaviour until now. |
| `handoffs.proxy_accept` | handoffs | bool | false | — | yes | **protected** | A handoff may name a receiver who has no account (e.g. a department head); the receiver account (a coordinator) then records each step on their behalf, with a note every time. Off = only people with an account receive handoffs, the behaviour until now. |
| `calendar.skip_weekends` | calendar | bool | false | — | yes | **protected** | Saturdays and Sundays are not working days for the overdue rules (handoff escalation grace and days overdue, escalation levels, missed sessions). Holidays and shutdowns are listed per site in the calendar. Off = every day counts, the behaviour until now. |
| `commitments.escalation_enabled` | commitments | bool | true | — | yes | **protected** | Record A01 / A02 escalations (serious commitment without owner / overdue without exception). |
| `commitments.serious_due_move_needs_admin` | commitments | bool | true | — | yes | **protected** | Moving the due date of a high / critical commitment past its original (baseline) date needs the admin tier — a site editor cannot clear an A02 overdue alert alone. |
| `commitments.exception_max_days` | commitments | int | 90 | 1 – 365 | yes | **protected** | An approved exception (overdue serious commitment) lapses after this many days; the A02 alert comes back unless it is renewed. |

## Who acts — roles, deputies, escalation matrix (ADR-006)

The parameters above say *how strict*; `docs/adr/ADR-006-roles-escalation-delegation-as-data.md` says *who*.
Governance policies ▸ **Roles, deputies and escalation** (`GET/POST /api/governance/roles…`):

- **Role assignments** — a role from the catalogue held by a person for one site or the platform, dated (super_admin).
- **Deputies** — a person stands in for an absent colleague between two dates (≤ 120 days, same site, admin tier); the deputy acts in their name (`acting_for`), never verifies the work of the person they replace.
- **Escalation matrix** — register × severity × site × days overdue → role (super_admin). The escalation jobs record the target on the event and, when the notice switch is on, tell the holders (and their deputies). Each further level is raised once.
- Required roles without a holder and rules that reach nobody appear in the oversight register (`role_gaps`).
- **Working calendar** (migration 037, admin tier) — holiday / shutdown days per site or for every site: they do not count in the handoff escalation grace and days overdue, in the escalation levels, and a session missed on such a day is excused (`calendar_excused`). Weekends by the rule `calendar.skip_weekends`.
- **KPI targets per site** (migration 038, super_admin; `GET/POST /api/metrics/targets`) — `GET /api/metrics/:key?site=` returns `target`, `target_source` (site / platform) and `vs_target` (attainment and colour through the shared RAG table, policy `kpi-target`). The KPI definitions stay D-01..D-03.
- Every change is in `governance_role_events` (append-only, hash-chained). Empty tables = the behaviour until now.

## Site profiles

`services/governanceProfiles.js` — a named bundle of site-scoped values applied to one site in one action
(Governance policies ▸ choose a site ▸ *Site profile* ▸ *Apply to this site*; `POST /api/governance/policies/profile`).
Each value goes through the store like a manual change: a relaxation needs a super_admin and becomes a
two-person proposal, values already in force are skipped, every change is reasoned and in the history.

| Profile | For | Values |
|---|---|---|

The values are a starting point for the committee; `validateProfiles` (tested) refuses an unknown or platform-only rule.

## Invariants — deliberately NOT parameters

These protect data or people, not a working practice; a context cannot switch them off:

- Site scoping of every read and write (a site-A account never sees or changes site-B data).
- A commitment is never verified by its owner, an executor or its creator.
- A handoff is never accepted on behalf of its named receiver; the deliverer never verifies.
- The audit trail (events, histories, system log) cannot be disabled.
- "Not measured" is never shown as 0.
- Verification rights follow a unique identity (username or e-mail) — never a full name or a typed id.
- A tracker or dashboard that was ever published is retired, never deleted (its versions are evidence).
- Secrets never leave the server.

Adding a rule: declare it in `PARAMS` (default = today's behaviour), read it through the policy object in the pure module, add its probe to `tests/governance-policy-coverage.test.js` (the test fails for a parameter without one).
