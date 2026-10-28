# ADR-006 — Roles, escalation matrix and delegation as configuration data

**Status: PROPOSED — for the committee (DECISION #38 of `docs/sdp360/completion/COMMITTEE-REVIEW-2026-10-28.md`). Nothing here is built.**
Date: 2026-10-28. Raised by: Group CIO seat (P0-1, P0-2, P1-4), Houndé site IT seat (P0-1, P1-8, P1-9).

## Context

The governance policy registry (`services/governancePolicy.js`) makes *how strict* each control is a
parameter, per site, with bounds, two-person relaxation and history. It does not say *who* acts:

- each lifecycle hard-codes its actors — handoffs: receiver / requester / admin; sessions: chair /
  secretary / site editors / committee; commitments: owner / executors / reviewer / admin;
- escalation is one switch per register (`handoffs.overdue_escalation`, `commitments.escalation_enabled`)
  and nobody is named as the target;
- nobody can stand in for an absent person: a handoff waits while its receiver is on leave, and the
  admin override becomes the routine way out;
- a one-person site cannot satisfy four-eyes rules and either piles up unaccepted minutes or asks a
  super_admin to switch the rule off.

## Decision proposed

Three tables, resolved like the policies (**site → platform → default**), effective-dated, with history:

1. **`role_assignments`** — `(process, role, scope, user_id, effective_from, effective_to)`.
   Processes: `handoffs`, `meetings`, `commitments`, `reports`, `publication`. Roles per process (R/A/C/I),
   e.g. `meetings.chair`, `meetings.minutes_acceptor`, `commitments.reviewer`, `handoffs.escalation_target`,
   `reports.publisher`. Scope: `platform` or `site:<id>`.
2. **`deputies`** — `(user_id, deputy_id, from, to, reason, approved_by)`. A deputy acts **in the name
   of** the absent person; every event records `acting_for`. A deputy never satisfies a four-eyes rule
   against the person they replace (no self-approval by proxy).
3. **`escalation_matrix`** — `(register, severity, scope, after_hours, role)`, e.g. *a high handoff at
   Houndé overdue 24 h → `handoffs.escalation_target` of Houndé; after 72 h → group service manager*.

One resolver used by every lifecycle: `canAct(process, transition, actor, object)`. The pure modules keep
their invariants (receiver-only acceptance, no self-verification); the resolver only answers *who holds
the role here, today*, deputies included.

**Small sites** get a *delegate-to-group* option instead of switching four-eyes off: the second pair of
eyes is a named group role (`group.reviewer`) — the control stays, the person is elsewhere.

**Site profiles** ("Grande mine", "Petite mine / 1 IT", "Bureau") become named bundles of policies +
role defaults that a site inherits; onboarding a mine = create the site, assign a profile, name the
people. Profiles depend on the site registry (DEC-4).

## Consequences

- Positive: tailoring "who" no longer needs a developer; absences stop blocking work; escalations reach a
  person; small sites keep their controls.
- Cost: a migration, an admin screen, and every lifecycle test re-run against the resolver. Roughly the
  size of the policy registry work again.
- Risk: a misconfigured matrix escalates to nobody — the resolver must refuse an empty target and the
  oversight register must list processes × sites with no holder.

## Not decided here

D-14 (department-level access), the account-less participant question (committee #34), and whether
handoffs become a commitment kind (committee #39) — they interact with this ADR and should be decided
together.
