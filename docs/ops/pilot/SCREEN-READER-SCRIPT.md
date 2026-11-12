# Screen-reader session script — SDP360 pilot (gate 7, audit U-08)

Status: **script only. No session has been run.** The result column is empty on purpose; a step not run stays
"not measured", never "passed". Fill a COPY of this table per session; keep the filled copy with the facilitator
(no participant names in the repository).

Who: ideally a person who uses a screen reader daily. Two pairings, both required:
**NVDA (latest) + Firefox ESR on Windows** and **VoiceOver + Safari on macOS or iOS**.
Before you start: test instance only (`docs/ops/pilot/TEST-INSTANCE.md`), a test account of the role named in the
journey, browser zoom 100 %, screen-reader verbosity at its default.

How to record each step: **Result** = `ok` / `problem` / `blocked` / `not run`; **What was announced** = verbatim
when it matters; **WCAG** = the success criterion the problem breaks (e.g. 1.3.1, 2.1.1, 2.4.3, 4.1.2, 4.1.3).

Key reminders: NVDA — `H` next heading, `D` next landmark, `T` next table, `Ctrl+Alt+arrows` move in a table,
`Insert+F7` elements list. VoiceOver — `VO` = Ctrl+Option, `VO+U` rotor, `VO+Cmd+H` next heading,
`VO+Cmd+T` next table, `VO+Shift+↓` interact with a group.

## J1 — Sign in and the shell (any role)

| # | Step | Expected | Result | What was announced | WCAG / note |
|---|---|---|---|---|---|
| 1.1 | Open `/login.html`, tab to the user field | label "User name" announced, not just "edit" | | | |
| 1.2 | Submit a wrong password | the error is announced without moving focus by hand (live region) | | | |
| 1.3 | Sign in, land on the home page | page title announced; a skip link reaches the main content | | | |
| 1.4 | Open the top menu groups (Reports, Insights) | each group announces expanded/collapsed; Escape closes it | | | |
| 1.5 | Use the finder (search) | the result count is announced as you type | | | |
| 1.6 | Breadcrumb | announced as navigation with the current page marked | | | |

## J2 — Charts and their data tables (executive / Group IT)

| # | Step | Expected | Result | What was announced | WCAG / note |
|---|---|---|---|---|---|
| 2.1 | Open the Analytics page, reach the first chart | the chart has a name (title) and a short text summary, not "image" or "canvas" | | | 1.1.1 |
| 2.2 | Open the chart's data table | a real `<table>` with column headers; `T` reaches it | | | 1.3.1 |
| 2.3 | Move cell by cell | each cell announces its row and column header | | | 1.3.1 |
| 2.4 | A value that is not measured | read as "unknown" / "not measured", never "0" | | | — |
| 2.5 | Colour status (RAG) | the status is said in words (green / amber / red / unknown), not only by colour | | | 1.4.1 |
| 2.6 | Change a filter (period, site) | the update is announced, focus stays on the control | | | 4.1.3 |

## J3 — Modals and confirmations (site IT coordinator)

| # | Step | Expected | Result | What was announced | WCAG / note |
|---|---|---|---|---|---|
| 3.1 | Site Actions → close an action that needs a justification | the dialog is announced as a dialog with its title; focus moves into it | | | 4.1.2 |
| 3.2 | Tab around inside the dialog | focus stays inside the dialog (no escape behind it) | | | 2.4.3 |
| 3.3 | Press Escape / Cancel | the dialog closes, focus returns to the control that opened it | | | 2.4.3 |
| 3.4 | Confirm without the mandatory comment | the error is announced and tied to the field | | | 3.3.1 |
| 3.5 | Confirm with a comment | the success toast is announced | | | 4.1.3 |

## J4 — Forms and errors (weekly report / inspection)

| # | Step | Expected | Result | What was announced | WCAG / note |
|---|---|---|---|---|---|
| 4.1 | Open last week's report, move through the section tabs | tabs announce selected state and position ("tab 2 of 5") | | | 4.1.2 |
| 4.2 | Leave a mandatory field empty, save | the error names the field and is reachable | | | 3.3.1 |
| 4.3 | Autosave / "saved" message | announced once, not on every keystroke | | | 4.1.3 |
| 4.4 | Inspection form: set a finding status | the radio/select announces its choice and the item text | | | 1.3.1 |
| 4.5 | Signature / photo controls | each has a name; their absence of support is said, not silent | | | 4.1.2 |

## J5 — Data tables (lists)

| # | Step | Expected | Result | What was announced | WCAG / note |
|---|---|---|---|---|---|
| 5.1 | Issues Log / Actions Register table | caption or heading names the table; headers announced | | | 1.3.1 |
| 5.2 | Sort a column | the sort direction is announced | | | 4.1.2 |
| 5.3 | Inline status select in a row | its label includes the row it belongs to | | | 2.4.6 |
| 5.4 | Empty table (filter with no result) | "no result" is announced, not a silent empty table | | | — |

## J6 — Field app (technician, phone + VoiceOver iOS / TalkBack if available)

| # | Step | Expected | Result | What was announced | WCAG / note |
|---|---|---|---|---|---|
| 6.1 | Offline indicator | the offline state is announced | | | 4.1.3 |
| 6.2 | Queue a quick entry, then sync | the queued count and the sync result are announced | | | 4.1.3 |

## Session summary (to fill)

Pairing: ______ · Date: ______ · Role account: ______ · Facilitator: ______
Problems found: ______ (each with journey/step and WCAG reference). Results go to the evidence file only as
measured; nothing here is a pass until a person has run it.
