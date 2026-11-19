# Two-site pilot — runbook (P09)

Version 1 · 2026-11-19 · Prepared by the agent (AI). **Nothing in this runbook has been run.** People run the
pilot; this page only orders the existing kit so a facilitator can run it without re-entering data by hand.
No owner, site, date, threshold or result is filled in: every such field says **TO BE DECIDED (sponsor)** or
stays empty until a person records it.

The sponsor decisions this runbook waits for are listed in §4.

## 1. What the pilot measures

| Question | Instrument (already in the repo) | Who records | Captured how |
|---|---|---|---|
| Do people use the pages of their profile? | page usage (`page_viewed`, routes/pageUsage.js) → **page_usage** measure | nobody — automatic | `node tools/pilot/pilot-metrics.js` (read-only) |
| Are people doing business work in the tool? | active users, report / PV / action delays, field outcomes | nobody — automatic | same report |
| Value indicators (baseline vs pilot) | value table (`--value`) + value scoreboard snapshot (`/value-scoreboard.html`) | adoption lead triggers the snapshot | `pilot-metrics.js --value` + snapshot button |
| Can a person do the three tasks of their profile? | T1-T8 sessions, first-click sheet | facilitator | `T1-T8-SHEET.csv`, `FIRST-CLICK-SHEET.csv` |
| Is it usable? | SUS | each participant | `SUS-FORM.md` → `SUS-SHEET.csv` |
| Time to write the weekly report | stopwatch (baseline then pilot) | observer | `WEEKLY-REPORT-STOPWATCH.csv` |
| Does the field app lose or duplicate data on real phones? | device scenarios | site IT lead on a real phone | `FIELD-DEVICE-SHEET.csv` |

A measure that was not taken stays **not measured** — never 0, never "passed". Targets are set only at the end,
by the sponsor, against the baseline (PILOT-MEASUREMENT.md §3).

## 2. Steps

| # | When | Who (role) | Step | Done when |
|---|---|---|---|---|
| S1 | before anything | sponsor | Take the decisions of §4 (sites, cohort, dates, task lists, switches) | decision record signed by the sponsor — not by the agent |
| S2 | baseline week −4…−1 | IT ops | Turn on the instruments only: `workspace_profiles_enabled` stays as decided; page usage is recorded by the shell for every session (no switch). Run `node tools/pilot/pilot-metrics.js --from=<baseline start> --to=<baseline end> --site=<site> --format=both --out=docs/ops/pilot/runs/` per pilot site | one MD + one CSV per site; sections with no data say "no data" |
| S3 | baseline week | IT ops (super_admin — the snapshot button is super_admin only) | Value scoreboard snapshot (`/value-scoreboard.html` ▸ "Take a snapshot now") and `pilot-metrics.js --value --from=… --to=… --stopwatch=docs/ops/pilot/WEEKLY-REPORT-STOPWATCH.csv` | baseline value table saved next to S2 output |
| S4 | baseline week | observer | 2–3 weekly reports written the old way, stopwatch on, phase `baseline` | lines in `WEEKLY-REPORT-STOPWATCH.csv` |
| S5 | go-live −1 day | IT ops | Set the pilot switches approved in §4 on the pilot instance only (PILOT-PROFILE.md); verify the profile journeys pass on TEST: `node tools/test/run-e2e.js` (includes `p09-profile-tasks-a/b`) | journeys green twice; switch values match the decision record |
| S6 | go-live | facilitator | Train each participant with the sheet of their profile (`docs/ops/pilot/training/<profile>.md`, FR + EN) | participant can open the three task pages from Home |
| S7 | each pilot Monday | adoption lead | Re-run S2 + S3 for the previous week (same `--site`, same `PILOT_PSEUDONYM_KEY`) | one report per site per week; no manual copy into the sheets |
| S8 | pilot week 2–3 | facilitator not involved in building the screens | T1-T8 session + first-click + SUS per participant (codes P01…, no names) | sheets filled by the facilitator; agent never pre-fills |
| S9 | pilot weeks | site IT lead | Field device scenarios on real phones (FIELD-DEVICE-UAT.md §2, the ones in P09 §3 marked "person on a device") | `FIELD-DEVICE-SHEET.csv` lines with `result` per scenario; field sign-off PV signed by the site |
| S10 | end of pilot | product owner + sponsor | Read baseline vs pilot (S2/S3/S7 outputs + sheets); decide targets, page merges/retirements (P09-PAGE-INVENTORY.md), and go / no-go for a wider rollout | decision record — the agent may draft the comparison, never the decision |

Stop rules: any `lost` or `duplicate` line in the field sheet stops the field part of the pilot (FIELD-DEVICE-UAT.md §4);
a cross-site read or write observed by a participant stops the pilot (P0 security, report to IT Group).

## 3. Field scenarios — what a browser test proves, what needs a person on a device

Automated tests simulate the network (Chromium DevTools protocol + route stubs); they prove the app's logic, not a
real VSAT / 4G link or a real phone's storage.

| Scenario (P09 list / FIELD-DEVICE-UAT id) | Automated test (already in the repo, re-run in this lot where noted) | Still needs a person on a device |
|---|---|---|
| Network loss mid-inspection (N5, offline flaps) | `tests/e2e/f1-field-network.spec.js` case (a): 800 ms latency + 3 offline/online flaps during a sync | yes — real airplane mode on D1/D2 |
| Interrupted upload (chunk failure) | f1 case (e): only the missing chunks are re-sent; `tests/field-routes.smoke.test.js` chunk lifecycle | yes — real 4G with 1-2 bars (N2), VSAT (N3) |
| Captive portal (N4) | f1 case (b): `/api/field/*` answered 200 text/html → "page web" message, nothing marked sent | yes — a real guest Wi-Fi |
| Long offline (queue kept for days) | partial: f1 case (g) entry survives a reload; `tests/field-store.test.js` server purge keeps unresolved rows past 90 days | **yes** — days offline on a real phone, browser storage eviction policy (iOS Safari) cannot be simulated |
| Duplicate send | `tests/field-routes.smoke.test.js` (replay = duplicate, applied once; same uuid other payload = 409); concurrent sends → one applies | no (server logic) — confirm counts on S2 report |
| Expired session | f1 case (c): 401 in the middle of a photo upload → "Session expirée", sync stops before the entry | yes — real token expiry overnight |
| Shared phone (S4 / U1) | f1 case (f): user A queues, user B signs in → A's entries are not sent | yes — real shared device, A then B then A |
| Phone almost full (S1) | `tests/field-storage-browser.test.js` quota error → "NOT saved", prior entry kept; f1 case (g) | yes — a real nearly-full phone |
| 20 photos in a row (S2) | no automated test at that volume | yes |
| App restart (S3) | f1 case (g) reload | yes — force-stop the browser |

Run in this lot: none of the field browser tests were modified; they belong to the orchestrator's e2e run.

## 4. Decisions the sponsor must take (none taken by the agent)

| Id | Decision | Agent preparation | Status |
|---|---|---|---|
| D-P09-1 | The two pilot sites | coverage of each site in the data (reports, PVs, inspections) is read by S2 on the baseline window | TO BE DECIDED (sponsor) |
| D-P09-2 | The cohort: participants per profile and per site (coded P01…), the facilitator, the observer | 11 profiles and their roles in `docs/ops/pilot/training/` | TO BE DECIDED (sponsor) |
| D-P09-3 | Dates: baseline window, go-live, end of pilot, the T1-T8 week | runbook S2–S10 | TO BE DECIDED (sponsor) |
| D-P09-4 | The three tasks per profile (agent proposal in `tests/e2e/fixtures/profile-tasks.js`) | journeys prove each is one click from Home | PROPOSED — to confirm with the cohort |
| D-P09-5 | Which switches are on for the pilot (PILOT-PROFILE.md) | profile journeys run with `workspace_profiles_enabled = 1` | TO BE DECIDED (deciding role per switch) |
| D-P09-6 | Page merges / retirements (P09-PAGE-INVENTORY.md) | proposals only; wait for S7 page-usage data | TO BE DECIDED after the pilot |
| D-P09-7 | Findings F1 / F2: an audit-viewer-only or dashboard-publisher-only account lands on a profile with a page it cannot open | either change the profile's destination list or the default profile for those roles (presentation only, no access widened) | TO BE DECIDED (product owner) |
| D-P09-8 | Pilot pseudonym key holder (`PILOT_PSEUDONYM_KEY`) | PILOT-MEASUREMENT.md §2 | TO BE DECIDED (sponsor) |

## 5. Rules

- No name, e-mail or production data in this repository; pilot outputs with site data stay under `docs/ops/pilot/runs/` on the pilot machine, not committed.
- The agent may draft, generate and check; it never signs, accepts, approves or fills a result field.
- An AI review of the pilot results is labelled "AI review" and is not the independent review.
