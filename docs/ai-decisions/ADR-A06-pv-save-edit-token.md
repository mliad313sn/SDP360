# ADR-A06 — PV save: optimistic concurrency with a server-computed edit token

Status: accepted as an AI technical decision · 2026-11-04 · not reviewed by a named human owner · no setting, no schema change

## Context
`saveMeeting` (PostgreSQL fork `_saveMeetingPg`) upserts the PV's issues and actions **by id**
(audit F2) and DELETEs every stored action/issue the payload does not carry. A PV tab opened
before another page changed the same PV therefore:
- re-opened an action closed from the Actions Register / Site Actions hub / field app
  (`addActionUpdate` writes only `md_actions`),
- DELETED an action added from the hub "+ Action" (`addActionForIssue` inserts an `md_actions`
  row the stale tab never saw),
- reverted an issue status changed via `addIssueUpdate`.

## Decision
- `getMeeting` returns `header.edit_token`; `editToken(id)` computes the same value. It is a
  **TEXT** string built in SQL: `to_char(GREATEST(m.updated_at, max(issues.updated_at),
  max(actions.updated_at)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') | #issues | #actions`.
- The PV page sends it back as `header.expected_edit_token`. When present, the save locks the
  PV row `FOR UPDATE` inside its transaction, recomputes the token and throws a typed
  `CONFLICT` (with `current_token`) **before any write** if it differs. The route answers 409
  `{error, code:'CONFLICT', current_token}` — handled before the `/Cross-site|closed/` → 403
  mapping, and the message avoids both words.
- The three child writers take `FOR SHARE` on the parent PV row inside their transaction, so
  they serialise with a save that has already passed its check (no change between check and write).
- The page shows a blocking banner (Reload / Copy my edits) and never reloads by itself.
- No token (imports, server-side callers, an old cached page) → exactly today's behaviour.

## Why not `md_meetings.updated_at`
1. The child writers never touch the meeting row, so its timestamp cannot see the three
   lost-update paths above. The token must cover the children; the counts catch additions and
   deletions.
2. `updated_at` is TIMESTAMPTZ (microseconds) and node-pg returns a JS `Date` (milliseconds):
   an echoed client timestamp loses precision and would raise false conflicts. The token is
   compared as a string the server produced.

## Not done
No field-level merge (a stale save is refused, not merged); no version column.

## Proof
`tests/pg-meetings-concurrency.test.js` (7), `tests/meetings-save-conflict.smoke.test.js` (3),
`tests/meeting-save-conflict-client.test.js` (3).

## Rollback
Revert the commit; no schema or data change.
