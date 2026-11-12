# Value table — audit §9 indicators (proposal, measured from recorded data only)

> No value is claimed for SDP360 without a real baseline. Every indicator below is a **proposed** definition for
> the business validator to confirm. A value with no recorded source prints **UNKNOWN** with the missing source
> named — never 0, never a colour. **No target is set.**

## How to produce it
```
node tools/pilot/pilot-metrics.js --from=2026-11-02 --to=2026-11-29 --value [--targeted=FILE] [--stopwatch=FILE] [--format=md|csv|both]
```
- `--targeted=FILE` — one numeric user id per line: the users the pilot targets (the adoption denominator).
  Without it, active adoption is UNKNOWN.
- `--stopwatch=FILE` — the filled `docs/ops/pilot/WEEKLY-REPORT-STOPWATCH.csv` (columns `phase`, `active_minutes`).
- The session is READ ONLY (PostgreSQL refuses any write); no name or e-mail is ever read.

Columns: indicator · definition (proposed) · formula · source · population · observations **n** · value · unit ·
state (measured, or UNKNOWN + the missing source) · owner role · validator role (roles, never names).

## What is computable today
| Indicator | Source | Becomes UNKNOWN when |
|---|---|---|
| Report preparation time (baseline / pilot) | WEEKLY-REPORT-STOPWATCH.csv | no filled row for that phase |
| Verified closure delay; share of verified actions | `commitments` (db 021) | `commitments_enabled = 0`, or nothing verified / completed in the window |
| Data freshness | `sync_runs` + `services/publishGate.js` SOURCES | no source has ever synced (denominator = ACTIVE sources only) |
| Active adoption | `system_log` + `audit_log` business events; targeted list = input file | no targeted list, or an empty one |
| Field task time | `system_log` field_*_applied details | `field_task_timing = 0`, or no timed entry |

**Always UNKNOWN today (source named in the output):** certified resolution SLA (no policy adopted by the KPI
committee), duplicate-entry reduction (no journey observation), KPI reliability (no committee minutes), usability
(UX sessions not run), project benefits (not recorded in the portfolio), service availability (no monitoring
recorded), correct delivery rate (sends are logged, receipts are not).

## Baseline before the pilot, constant scope (audit §9.1)
1. Take a **baseline** run over the weeks **before** the pilot starts (and fill the stopwatch `baseline` rows).
2. Compare a pilot run only on the **same scope**: same sites, same roles, same targeted list, same formula.
3. Any formula change is noted with its date; keep **n** next to every value — a change on a small n is not a gain.
4. Declare a gain only after the business validator has reviewed external factors (staffing, outages, seasonality).

## Left for a person
Name the data owner, the result owner and the business validator of each row; Finance / BRM baseline and validation;
confirm or amend each proposed definition.
