# Team capacity — data contract (DRAFT, not approved)

Status: **DRAFT** written by an agent for E-P03 (expert audit of 5 Nov 2026, audit P-03 / I-05). Nothing here is a
decision. A **capacity owner** (to be named) must accept or rewrite it before any figure called "availability" or
"capacity" is shown as a fact.

## What exists today (no new source)

- **Load**, not capacity: `public/lib/ppmVisuals.js` `resourcePressure` (per person × week, peak of the open tasks'
  `allocation_pct`) and `capacityBySite` (sum of those peaks per project site × week, behind `ppm_capacity_view`).
  100 % means "one person full time", nothing more.
- A task with no allocation is **unknown** — never 0 %, never 100 %.
- **One rule for every reader (F-PRODUCT-01)**: `public/lib/allocationContract.js` is required by the server
  (`services/projectSchedule.js` `resourceConflicts` / `resourceCoverage`) and loaded by the pages before
  `ppmVisuals.js`. null, empty, omitted or non-numeric → unknown; 0–100 → known (0 adds 0); below 0 or above 100
  (legacy rows only, the write path refuses them) → **invalid**, never summed, listed; done / cancelled, no owner,
  no or inverted dates → excluded. Every portfolio / project answer carries `resource_coverage` next to
  `resource_conflicts`, with the **possible conflicts** (overlapping tasks where an allocation is not known):
  they are never counted as conflicts and never shown as "none".
- Conflicts = a person above 100 % in consecutive weeks, sorted by excess then duration. A "suggestion" names a
  person below 100 % in those weeks; it is a **proposal only**, nobody is reassigned automatically.
- A reassignment (task owner change) is written to the hash-chained `ppm_events` ledger (`task_reassigned`: old,
  new, actor, reason). With the switch on the reason is required.
- Duty coverage (`services/dutyCoverage.js`, C-20) answers "is the rota covered", not "how much time is free".

## What a team-capacity source would need (to be decided, not built)

| Field | Meaning | Who would own it |
|---|---|---|
| person id | a dashboard user id (not a free-text owner) | IT management |
| period | ISO week (Monday start) | — |
| available_pct | share of a full-time week this person can give to project work | the person's manager |
| reason for absence | category only (leave / training / duty) — **no medical or HR detail** | the person's manager |
| source | who entered it and when | — |

Rules a source must follow before it is read:

1. **HR data is not a source.** No payroll, contract, leave-balance or HR-system extract feeds this view; only what a
   manager states for project planning, in the dashboard, with a trace.
2. No value = unknown. A missing week is never read as "fully available".
3. No money: capacity is time, never a cost.
4. A person sees their own line; the site IT lead and the PMO see their scope (A-15 read rule).

## Left for a person

- Name the capacity owner and decide what "availability" means for a team (I-05).
- Decide whether `available_pct` is entered per person or derived from the duty roster.
- Decide the threshold that makes a site "over capacity" (no threshold is set by this draft).
