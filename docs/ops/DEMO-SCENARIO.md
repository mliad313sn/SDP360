# Demonstration scenario — synthetic two-site organisation (R6)

> **Everything here is SYNTHETIC.** Every name starts with `DEMO`. It runs only on a throwaway PostgreSQL database.
> It demonstrates the software path; it proves **no field result, no realised benefit, no approval**.

## What it is

`tools/demo/seed-demo.js` creates, in an empty throwaway database, a small organisation that lets a person walk the
product end to end (Home → portfolio → project → export → audit trail) and see the site-scope rule at work.
`tests/e2e/demo-journey.spec.js` walks that journey automatically in a real browser.

## Commands

```bash
# 1. a throwaway database (any name containing demo / test / sandbox / throwaway is recognised)
createdb sdp_demo
# 2. seed — the connection string comes from the ENVIRONMENT only (it carries a password)
PG_URL=postgres://<user>:<password>@localhost:5432/sdp_demo node tools/demo/seed-demo.js --inventory=demo-inventory.json
#    → prints the synthetic accounts and their one-time passwords (never written to a file)
#    → writes demo-inventory.json (ids of everything created; no secret inside)
# 3. start the app on that database and log in with the printed accounts
# 4. remove exactly what was created
PG_URL=… node tools/demo/seed-demo.js --remove --inventory=demo-inventory.json
# 5. or simply drop the throwaway database
dropdb sdp_demo
```

Automated journey (boots its own throwaway database, Chromium with external traffic blocked):

```bash
PG_ADMIN_URL=<admin url with CREATEDB> node --test --test-force-exit tests/e2e/demo-journey.spec.js
```

## Safety rules (enforced in code, `assertSafeTarget`, pinned by `tests/demo-seed.test.js`)

| Rule | Behaviour |
|---|---|
| Target is read from the live connection (`current_database()`, `current_schema()`) | never from a typed name |
| `sdp_dashboard`, `fmp_v2`, `postgres`, any `*prod*` | **refused, even with the flag** (unless the connection is pinned to a `sdp_test_*` schema) |
| Database not recognisably throwaway | refused unless `--i-know-this-is-a-test-db` |
| Portfolio not empty (any project, live or soft-deleted) | **refused** |
| `--remove` on another database than the inventory names | refused |
| `--remove` on a row whose label no longer starts with `DEMO` | **skipped**, reported, never deleted |

## Data created

| Item | Content |
|---|---|
| Sites | `DEMO-A Synthetic mine <tag>`, `DEMO-B Synthetic office <tag>` |
| People (random passwords) | coordinator (editor + report-author, site A) · PMO (committee-member) · finance reader (finance-viewer) · executive · editor of site B |
| Portfolio | 1 programme, 1 objective, 1 project on site A (budget 50 000 USD, spent **0** = measured zero) |
| Plan | 3 tasks: done (100 %, 16 h) · in progress (**0 %, 0 h** = measured zero) · to do (**no progress, no effort** = unknown); task 2 depends on 1, task 3 on 2 |
| Milestone, risk | 1 milestone (with baseline date), 1 open risk (P3 × I3) |
| Change request | a governance request (RFI, kind `governance`) titled "DEMO change request …" — **stand-in**: there is no native change-request entity (see `WORKBENCH-GAPS.md`) |
| Time / actuals | effort hours on tasks; budget periods for the current month: USD baseline 15 000, USD actual 12 000, **XOF** actual 1 500 000 |
| Benefit | baseline 12 → target 4 outage hours / month; **realised value left empty** |
| Dashboard | `demo-synthetic-<tag>`, published, site A, text only |
| Audit trail | `ppm_events` rows written by the store for every change (append-only, hash-chained) |

## What the journey asserts

1. The PMO opens Home, then the portfolio (the project is listed), then the project's Plan: the measured-zero task
   reads `0 %` / `0 h`, the unknown task reads `—`, the dependency is shown.
2. The portfolio workbook (`/api/governance/portfolio/workbook.xlsx`) carries the **same figures as the screen's API**:
   budget, spent `0`, task progress (`0` stays `0`, unknown stays empty), benefit baseline/target, realised **empty**.
3. The History tab shows the ledger, including the two-currency `budget_period_edit` rows.
4. The editor of site B reads the project with `portfolio_site_scope_reads = '0'` (today), and gets **404**, no list
   entry and "Project not found" once it is `'1'` (set in the throwaway database only).
5. `removeDemo` leaves **no DEMO-labelled row**.

## Removal

`--remove` deletes, in one transaction: dashboard + its versions, the change request, the project (tasks, milestones,
risks, benefits and budget periods cascade), objective, programme, the five people (sessions cascade), the two sites.
**Retained by design**: `ppm_events` and `system_log` rows (append-only audit — they cannot and must not be deleted),
and the database's first admin when the seed had to create one. Drop the throwaway database to remove those.

## What this does NOT prove

- No field result: nothing here was measured on a site.
- No benefit realised: the realised value is deliberately empty; nobody verified anything.
- No approval, sign-off or production readiness.
- Not a performance or load test.
- The time / actuals are not in the workbook export (budget periods and effort hours are on the project page only) —
  listed in `docs/audits/2026-11-12-enterprise-review/WORKBENCH-GAPS.md`.
