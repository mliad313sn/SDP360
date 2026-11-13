# ADR-W4-ENTERPRISE — per-project roles, comments with @mentions, board, roadmap, offline editing

Status: technical decision (reversible engineering detail). Every BUSINESS rule below is **PROPOSED**, behind a switch
defaulting to today's behaviour; none is approved. Wave W4 of `docs/audits/2026-11-12-ppm-parity/README.md` §5
(external connectors deferred until the W2 MSPDI work lands — not built here).

## 1. Project roles are memberships, not account roles
- Stored on `ppm_project_members.ppm_role` (migration 108, CHECK on the five values), only for a member LINKED to an
  account. An account role (`user_roles`) would be platform-wide; a PM of one project must not become a PM everywhere.
- One rule: `services/ppm/projectRoles.decide()` (pure), called from the existing `refusePlanWrite` gate
  (`routes/governance.js`) through `roleGate`, so EVERY plan write route (PUT/DELETE portfolio kinds, team, time,
  RACI, change requests, timesheets) is covered by the same function. An `op` (write / delete / team / time / action)
  is passed by the callers; with the switch off the role code path is never entered (no query).
- A role REPLACES the default plan-write rule for that user on that project (it can narrow a site editor who is only
  a contributor, or open a plan to a named PM outside the project's sites). Two rows for one person → the most
  restrictive (client wins) — never widen by accident. Committee / admin tier: unchanged.
- Reading: a role member reads the project (A-15 site scope and B3 sensitive rule) — `portfolioAccess.canReadProject`.
- Client: no write anywhere; never an amount. The request's user is marked (`u.__ppmClient`) by `accessCtx`, which
  runs before every money decision of the PPM routes (the EVM portfolio route and the history route were reordered to
  read first; the B7 export-policy money flag is ANDed with it in the portfolio report, workbook/deck data and the
  annual pack).
- Catalogue: `capabilityRegistry.PROJECT_ROLES` (bilingual, risk, ops) — not in `CAPABILITIES`, because no route guard
  tests them (the zero-escalation proof stays about account roles); a test pins the ops to `decide()`.

## 2. Comments
- Append-only table (`BEFORE UPDATE` trigger raises). DELETE is not blocked so a hard purge of the project/task
  cascades. No edit / delete route.
- `@username` resolves only to ACTIVE accounts that may read the project (same `readableProject` as the page, run for
  the candidate user); others are returned as `unresolved` without saying why (no existence leak). In-app notice via
  the engagement `notifications` table, never to the author, nothing while `notifications_stop = '1'`.
- PROPOSED: every reader may comment except a client project role.

## 3. Board, roadmap
- Board = leaf tasks (work packages) by status; a move is the existing task PUT with the row version (409 handled).
- Roadmap Now / Next / Later = pure grouping; a project without a start date is "not scheduled", never guessed.

## 4. Offline editing
- Browser-only queue (`public/lib/ppmOfflineQueue.js`) over the draftStore adapter (IndexedDB, localStorage fallback),
  envelope discipline of the field outbox (ordered, removed only on a terminal answer). Installed by intercepting the
  project page's task/milestone PUT and its project GET (served from the last copy + queued edits when offline), so
  `project.html` needed no change to its save code (the Gantt UI lot edits the same page).
- Conflict = a field the person changed whose stored value moved away from what they saw. No conflicting field → one
  automatic re-send with the current version; otherwise a merge screen (keep mine / keep theirs per field, default
  theirs). A refusal other than 409 stays visible until discarded.

## Rollback
Switches to `'0'`; schema: `db/postgres_rollback/108_ppm_roles_comments_drop.sql` (proved by `ppm-rollback-scripts`).
