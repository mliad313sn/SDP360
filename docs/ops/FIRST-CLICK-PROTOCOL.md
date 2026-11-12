# First-click protocol (F-UX-07 — E06 / E09 preparation)

Status: **protocol only — not run.** No participant has done this test; every result cell in the sheet is empty, and an
empty cell is **not measured** (never a failure, never a success). The expected answers are a decision of the pilot
sponsor and the change & communication lead (decision D4); the candidates below come from
`docs/ux/PERSONA-TASK-MATRIX.md` (generated) and are not confirmed.

## Why

The first click predicts task success: a participant whose first click is on the right path completes the task far more
often than one whose first click is wrong. It is cheap to observe in a usability session and, once
`ux_event_telemetry` is armed (F-UX-06, default `0`), the platform records `first_click` for real users too
(`tools/pilot/adoption-report.js` compares it with the expected answers).

## Session

1. Use the persona's real account on the test instance (`docs/ops/pilot/TEST-INSTANCE.md`), on the device the person
   uses at work. Open the **landing page** of the row; do not show the menu first.
2. Read the task wording from `docs/ops/USABILITY-TEST-PROTOCOL.md` (T1-T12) aloud, once.
3. Record the **first click** (page or control reached), whether it matches an **expected page**, and the seconds from
   the end of the wording to the first click. Then let the participant finish the task as in the main protocol.
4. Do not help before the first click. "Not run" stays an empty row.

## Sheet

`docs/ops/pilot/FIRST-CLICK-SHEET.csv` — one row per task × persona. Columns:

| Column | Filled by | Meaning |
|---|---|---|
| `task`, `persona`, `landing_page` | prepared | the task id, the vision persona, the page the participant starts on (page id, as reported by the shell) |
| `candidate_page` | generated | the action page of the matching journey — a **candidate** only |
| `expected_page` | **decision D4** | the accepted first-click page; `UNKNOWN` until decided (the adoption report then shows UNKNOWN) |
| `participant` | facilitator | a pseudonym (P01…), never a name |
| `first_click` | facilitator | page id or control reached first |
| `correct` | facilitator | `yes` / `no` against `expected_page`; empty while `expected_page` is UNKNOWN |
| `time_s` | facilitator | seconds to the first click |
| `notes` | facilitator | what the person said or hesitated on |

## Scoring

Per task: first-click success = `yes` rows ÷ rows with a result — the denominator is always shown, and a task with no
result reads UNKNOWN. Task completion and SUS are scored with `tools/pilot/usability-score.js` (E-U01). No target is
set here: an acceptance threshold is the pilot sponsor's decision.
