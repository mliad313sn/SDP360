# P04 — Microsoft Project interoperability check (HUMAN check — kit prepared, NOT performed)

- **Status:** NOT PERFORMED. The agent has no Microsoft Project licence and cannot open the files; it never claims this
  check. Every "Result" cell below stays empty until a person fills it.
- **What is proven without a person:** each file below is written by SDP360's exporter (`services/ppm/mspdi.toXml`, the
  code path of `GET /api/governance/ppm/project/:id/mspdi.xml`) and re-reads byte-identical on SDP360's own parser
  (`tests/ppm-p04-kits.test.js`, `tests/ppm-mspdi.test.js`). That proves the round trip on OUR parser only.
- **Regenerate:** `node tools/ppm/interop-kit.js` (deterministic). `B-1000-tasks.*` is not committed (1.2 MB) — the
  command rebuilds it byte-for-byte (seed 20261113, SHA-256 pinned by `tests/ppm-mspdi.test.js` for the golden).

## Files

| File | Content | Expected values (SDP360's engine) |
|---|---|---|
| `files/A-small.xml` | 8 tasks: one summary, an FS chain, an SNET constraint, a deadline, a 0-day milestone; Mon–Fri calendar with a holiday on Mon 2027-01-18 | `files/A-small.expected.csv` |
| `B-1000-tasks.xml` (regenerate) | the T1 golden: 1,000 tasks, outline levels 1–3, 3 calendars (one based on another, exceptions), FS/SS/FF/SF with lags in working days / elapsed days / %, the 8 constraints, deadlines, manual tasks, resources with rate tables A–E, contours, Baseline + Baseline1..10 | `B-1000-tasks.expected.csv` (regenerated with it) |
| `files/C-calendars-links.xml` | 28 tasks: every link type × lag unit (d, ed, %, a lead) on a Mon–Fri calendar with a holiday and a shutdown week, and the same chain on a 6-day calendar with a working-Sunday exception | `files/C-calendars-links.expected.csv` |

Hand check of file A by the agent (Mon–Fri, holiday Mon 18): Design Mon 04 → Wed 06; Build 5 working days Thu 07 →
Wed 13; Test 14 → 15; Integrate waits for Test and the SNET task, skips the Monday holiday: Tue 19 → Wed 20; Go-live
◆ 20; Hand-over Thu 21. These are the values in `A-small.expected.csv`.

## Procedure (one person, Microsoft Project desktop, any supported version)

1. File ▸ Open ▸ choose the `.xml`; accept "open as a new project". Note any import warning verbatim.
2. Add the columns: Start, Finish, Duration, Total Slack, Free Slack, Critical, Predecessors, Constraint Type,
   Constraint Date, Deadline, Calendar (task), Baseline Start/Finish (file B).
3. Do NOT reschedule manually first: compare what Microsoft Project shows on open. Then press F9 (calculate) and compare
   again — a difference only after F9 means the file was read but the engines disagree.
4. Compare with the `.expected.csv` (SDP360 counts durations in working days of the task's calendar; Microsoft Project
   shows days of 8 h — the same number on a 480-minute day).

## Checklist (fill in — leave nothing pre-ticked)

| # | Check | File | Result (match / differs / not checked) | Note (task id, values seen) | Who / date |
|---|---|---|---|---|---|
| 1 | The file opens without error | A, B, C | | | |
| 2 | Task count and outline (summaries) identical | A, B, C | | | |
| 3 | Start / Finish of every task = expected CSV on open | A, C | | | |
| 4 | Same after F9 | A, C | | | |
| 5 | Total slack and free slack = expected CSV (working days) | A, C | | | |
| 6 | Critical flag = expected CSV (same critical path) | A, B, C | | | |
| 7 | Link types FS / SS / FF / SF and lags shown as in the task name (d, elapsed d, %) | C | | | |
| 8 | Percent lag (SS 50 %) read as 50 % — SDP360's encoding of percent lag is OUR reading of the schema | C | | | |
| 9 | Calendars: holiday 2027-01-18, shutdown week 2027-02-15..19, 6-day calendar based on the standard, working Sunday 2027-01-24 | C | | | |
| 10 | Constraints (8 types) and constraint dates | B | | | |
| 11 | Deadlines shown, deadline indicator where late | A, B | | | |
| 12 | Resources, rate tables A–E, assignments, contours | B | | | |
| 13 | Baseline + Baseline1..10 present | B | | | |
| 14 | Save the file from Microsoft Project as XML and import it back into a TEST instance (`POST …/mspdi/import`, dry run): same task count, no new warning | A, C | | | |

Known limits (documented in `docs/ppm/W2-ENGINE-CONTRACT.md`): interim plans, time-phased data blocks, split tasks and
more than one currency are not carried; MS Project schedules an assignment on its own resource calendar, SDP360 on the
primary resource's calendar. A difference on those is expected and must be noted, not "fixed" in the sheet.
