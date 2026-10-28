# Governance meeting lifecycle (G-21)

Code: `services/sessionLifecycle.js` (pure rules), `routes/governance.js`, `public/cockpit.html`, migration
`db/postgres/reports/025_session_lifecycle.sql`. Status: **IMPLEMENTED · TESTED**.

## Stages

| Stage | Stored as | Meaning |
|---|---|---|
| planned | `status = planned`, date not passed by more than 48 h | scheduled |
| missed | **derived**: planned and the date passed by more than 48 h | a no-show — **never counts as held** |
| held | `status = live` | started |
| logged | `status = closed`, no acceptance | minutes recorded at close |
| accepted | `status = closed` + `minutes_accepted_at` | minutes accepted; the session is read-only |
| cancelled | `status = cancelled` + reason | an exception; `exception_status` pending → approved |

## Rules (each pinned by `tests/session-lifecycle.test.js` and `tests/governance-routes.smoke.test.js`)

- Start only from planned. Close only from live — a session that never started cannot be "held".
- Close only once: the minutes are not rewritten by a second close.
- Minutes are accepted by the chair, the secretary or the committee, **never by the person who closed the session**.
- Accepted minutes freeze the session: notes, items, attendees, new decisions and new actions are refused (409
  `FROZEN`). An admin may reopen with a reason (10+ characters); the session goes back to held and needs a new close
  and a new acceptance. Action follow-up statuses stay editable (that work lives in the registers).
- Cancelling needs a reason and creates a **pending exception**, approved by a committee member other than the
  person who cancelled. Excused = cancelled with an approved exception; unexcused = missed + cancelled not approved.
- A cadence may carry `effective_from` / `effective_to` (YYYY-MM-DD, inclusive). No session can be prepared outside
  that window; an inactive cadence cannot get new sessions.
- The overview reports `compliance_30d`: held, logged, accepted, missed, excused, unexcused, in progress, and
  `held_pct = held ÷ (held + unexcused)` — `null` when nothing was due (not 0 %).

## Not done here

- Linking incubation, prevention checks and commitments into one intake → meeting → commitment → verification
  path without re-entry (goal G10 step 3) — the commitment backfill (G-17) and handoffs (G-22) are the building
  blocks; the joined cockpit view is the next step.
- Per-site exception calendars (holidays, shutdowns) — today an exception is per session.

## Hardening after the committee review of 2026-10-28

- A missed session cannot be rescheduled (409 `MISSED`): the miss stays; a new session is planned or the miss is cancelled as an exception. Every reschedule is logged (`session_rescheduled`).
- Start, close, cancel and reopen are conditional on the current status and bump `meeting_sessions.version`: two runners closing at once → one wins, the other gets 409.
- Session actions are changed only through their own session (`WHERE id=? AND session_id=?`), and every change is logged.
- The overview's 30-day compliance judges each cadence with its own site's policy (grace, cancellation approval) — same answer as the session page.
- Group-level (site-less) cadences: sessions and minutes are read by the committee, the chair / secretary and the named participants only.
