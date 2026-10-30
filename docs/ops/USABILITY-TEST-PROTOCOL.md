# Usability test protocol (G17 / G24) — to be run by people, with people

Status: protocol only. **No session has been run**; nothing in this repository records user satisfaction.
Owner: PO + adoption lead. Facilitator: anyone not involved in building the screens.

## 1. Who (5 per role is enough to find most problems)

| Role | Real account role | Site |
|---|---|---|
| Site IT coordinator | editor, own site | two different sites |
| Technician (phone) | field-tech | a mine site, on site Wi-Fi or mobile data |
| Group IT / admin | admin | — |
| Executive | executive | — |
| Portfolio / committee member | committee-member | — |
| Department head (business) | site-business | own site |

## 2. Tasks (timed; the facilitator does not help unless the person is stuck for 2 minutes)

| # | Task | Role | Success = |
|---|---|---|---|
| T1 | Find the overdue actions of your site and close one with a justification | Site IT | action closed, justification saved |
| T2 | Open last week's report, check the helpdesk figures, submit it | Site IT | status submitted |
| T3 | On the phone, record a quick inspection with one photo while offline, then sync | Technician | entry applied, photo visible on the dashboard |
| T4 | Find the Meeting Cockpit and prepare Friday's agenda | Group IT | agenda generated |
| T5 | Tell which site is worst this month and why, from the executive home | Executive | answer matches the data, in < 2 min |
| T6 | Find the projects whose plan slipped versus baseline | Committee | correct list |
| T7 | Change the interface to French and open the manual | any | manual opens in French |
| T8 | Using only the keyboard, reach "Portfolio" from any page | any | reached without the mouse |

## 3. Measures (recorded per task)

Completion (yes / with help / no) · time · errors · clicks/keystrokes · SUS questionnaire at the end
(10 questions, score 0–100) · one free comment. Phone tasks: network type and signal noted.

## 4. Record

One sheet per person, anonymised (role + site only, no name). Results go to `docs/agent-execution/G24.md`
**only as measured** — a task not run stays "not measured", never "passed".

## 5. Accessibility pass (separate, by someone who uses assistive technology daily if possible)

NVDA + Firefox and VoiceOver + Safari on: login, Helpdesk, Site Actions, Portfolio, field app. Check that the
menu groups, the finder result count and the breadcrumb are announced; record each problem with the WCAG reference.
