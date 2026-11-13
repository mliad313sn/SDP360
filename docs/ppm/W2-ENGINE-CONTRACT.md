# W2-ENGINE — data contract for the interactive Gantt (W2-ui) and other consumers

- **Contract id:** `w2-engine/1` (returned as `contract` by `GET …/project/:id/schedule`).
- **Code:** `routes/ppmEngine.js` (routes), `services/ppm/scheduleEngine.js` (CPM), `services/ppm/calendars.js`,
  `services/ppm/resources.js` (contours, rates, loads, levelling), `services/ppm/baselineSlots.js`, `services/ppm/mspdi.js`,
  `services/ppm/engineStore.js` (DB, migration 105). ADR: `docs/ai-decisions/ADR-W2-ENGINE-calendars-resources-mspdi.md`.
- **Nothing here is certified.** Rates and costs are a Finance input; MS-Project interoperability of the exported file is
  proved against our own parser only (no MS-Project licence in the sandbox — a human must open one file in MS Project).

## 1. Switches (all PROPOSED, all `'0'` = today: the route answers 404)

| Switch | Opens |
|---|---|
| `ppm_schedule_engine_v2_ui` (W1, existing) | `GET /api/governance/ppm/project/:id/schedule` |
| `ppm_calendars_enabled` | calendars CRUD, project calendar, the calendars used by the schedule |
| `ppm_resources_enabled` | pool, rates, assignments, loads / over-allocations / costs in the schedule |
| `ppm_leveling_enabled` (+ resources) | levelling proposal, apply, clear; stored levelling delays are used by the schedule |
| `ppm_baseline_slots_enabled` | Baseline, Baseline1..10, Interim1..10 |
| `ppm_mspdi_enabled` | MSPDI export / import |

`GET /api/governance/ppm/features` reports `calendars`, `resources`, `leveling`, `baseline_slots`, `mspdi` (+ `schedule_v2`).

## 2. Access (the SAME helpers as every governance route)

| Action | Rule |
|---|---|
| read a project's schedule / assignments / levelling proposal / slots / MSPDI export | A-15 read scope (`readableProject`), else 404 |
| amounts (rates, `cost`, `task_costs`, slot `cost`, MSPDI rates / costs) | money-read rule (`canSeeMoney`: committee, admin tier, finance-viewer); others get `money_hidden: true` and no amount |
| project calendar, task engine fields, assignments, levelling apply / clear, save a slot, MSPDI dry run | plan-write rule (`refusePlanWrite`) |
| shared calendars + exceptions, resource pool, rate rows, MSPDI **apply** | committee (`isCommittee`) |
| a cost amount on an assignment | committee (money write) |
| resources listed / assignable | admin tier and committee: all; others: group-wide resources and those of their own sites (site perimeter) |

## 3. `GET /api/governance/ppm/project/:id/schedule[?status_date=YYYY-MM-DD]`

```
{ ok, contract: 'w2-engine/1', project_id, version_fingerprint, switches:{schedule_v2,calendars,resources,leveling,baseline_slots,mspdi},
  money_hidden, hours_per_day,
  schedule: {                                   // services/ppm/scheduleEngine.schedule
    anchor, project_finish, deadline, length_days, critical_path:[taskId], calendar:{workdays, elapsed},
    deadlines_missed:[{id, deadline, finish, late_days}],
    links:[{from, to, type:'FS'|'SS'|'FF'|'SF', lag, lag_unit:'d'|'ed'|'%', lag_working_days|null}],
    warnings:[{code, task_id, message}],       // LINK_VIOLATED · DEADLINE_MISSED · CONSTRAINT_NO_DATE · WBS_100_RULE · …
    tasks:[{ id, parent_id, depth, summary, milestone, mode, duration_days, duration_source, assumed_duration,
             es, ef, es_date, ef_date, ls_date, lf_date, total_float, free_float, critical, near_critical, negative_float,
             leveling_delay_days|null, deadline?, deadline_slack_days?, deadline_missed?, driver:{type,…},
             calendar:{calendar_id, source:'task'|'resource'|'project'|'default', resource_id?}, priority|null, rollup? }] },
  ui_calendar: { workdays:[1..7], holidays:[ISO], working_exceptions:[ISO] } | null,   // ctx.calendar of public/lib/ganttCore.makeCal
  calendars: { project_calendar_id, resolved:{ <id>: {id, name, workdays, hours_per_day, holidays, exceptions:[{date,working}], loop} } } | null,
  resources: [{id, name, kind, generic, site_id, max_units_pct, calendar_id, material_label, active}] | null,
  assignments: [{ task_id, resource_id, units_pct, work_hours, work_hours_effective, work_source:'entered'|'units'|null,
                  contour, rate_table, timephased:[{day, hours}], cost?:{CUR:n}|null, cost_unknown_reason? }] | null,
  overallocations: [{resource_id, day, load_hours, capacity_hours, over_hours, task_ids}] | null,
  task_costs?: { <taskId>: {CUR:n} | null } }                                          // money readers only
```

- Dates are ISO days; an end is inclusive. `null` = unknown, never 0 (unknown work, unknown rate, unknown cost).
- Costs are per currency and never summed across currencies.
- `version_fingerprint` changes when any task row version or engine field changes (use it to know the screen is stale).
- W2-ui: `ctx.calendar = response.ui_calendar` gives the Gantt the project's working days and holidays. A working
  exception on a non-working weekday (a Saturday shift) cannot be expressed in `makeCal`'s spec: it is listed in
  `working_exceptions`; the scheduled dates in `schedule.tasks` are always the authority.

## 4. Writes

| Route | Body | Notes |
|---|---|---|
| `PUT /api/governance/ppm/calendars` | `{id?, name, site_id?, base_calendar_id?, workdays?:[1..7], hours_per_day?, use_site_holidays?:0/1}` | base loops refused (`BASE_LOOP`) |
| `POST /api/governance/ppm/calendars/:id/exceptions` | `{day_from, day_to?, working, label?}` | ≤ 3660 days; overrides the work week AND holidays |
| `DELETE /api/governance/ppm/calendars/:id/exceptions/:eid` | — | |
| `PUT /api/governance/ppm/project/:id/calendar` | `{calendar_id \| null}` | |
| `PUT /api/governance/ppm/task/:id/engine` | `{calendar_id?, priority?:0..1000, ignore_resource_calendar?:0/1}` | `leveling_delay_days` refused (`LEVELING_BY_PROPOSAL`) |
| `PUT /api/governance/ppm/resources` | `{id?, name, kind:'work'\|'material'\|'cost', user_id?, site_id?, generic?, max_units_pct?, calendar_id?, material_label?, active?}` | |
| `PUT /api/governance/ppm/resources/:id/rates` | `{rate_table:'A'..'E', effective_from?, standard_rate?, overtime_rate?, cost_per_use?, currency}` | currency never defaulted |
| `PUT /api/governance/ppm/task/:id/assignments` | `{assignments:[{resource_id, units_pct?, work_hours?, contour?, rate_table?, cost_amount?, cost_currency?}]}` | replaces the set; contours `flat back_loaded front_loaded double_peak early_peak late_peak bell turtle` |
| `GET /api/governance/ppm/project/:id/leveling[?clear_existing=1]` | — | `{fingerprint, delays:{taskId:days}, moves:[{task_id, from_start, to_start, from_finish, to_finish, leveling_delay_days, added_delay_days, reasons:[{resource_id, resource_name, day, load_hours, capacity_hours, competing:[{task_id, priority}], delayed_working_days, rule}]}], pushed, unresolved, remaining_overallocations, iterations, converged}` |
| `POST /api/governance/ppm/project/:id/leveling/apply` | `{fingerprint, clear_existing?}` | 409 `STALE_PROPOSAL` when the plan changed |
| `POST /api/governance/ppm/project/:id/leveling/clear` | — | removes every stored delay |
| `POST /api/governance/ppm/project/:id/baseline-slots` | `{kind:'baseline'\|'interim', slot, reason}` | 409 `SLOT_TAKEN`: a saved slot is immutable (DB append-only trigger) |
| `GET /api/governance/ppm/project/:id/mspdi.xml` | — | `X-MSPDI-Warnings` header when something could not be carried |
| `POST /api/governance/ppm/project/:id/mspdi/import[?apply=1]` | raw XML body | dry run by default; apply = committee, EMPTY project only (409 `PROJECT_NOT_EMPTY`) |

## 5. Engine semantics added in W2

- **Lag units** (`dependency_links[].lag_unit`): `d` working days in the successor's calendar (default, W1); `ed` elapsed
  calendar days from the predecessor's boundary (a start lands on the next working day, a finish at the end of the
  working day it reaches); `%` of the predecessor's duration (a summary predecessor: its rolled-up span), rounded to
  whole working days. A negative lag is a lead.
- **Deadlines:** `deadline_slack_days` (working days, negative = late), `deadline_missed`, `deadlines_missed[]`,
  warning `DEADLINE_MISSED`, and the negative total float that already existed.
- **Levelling delay:** working days added after every network requirement (constraints MSO / MFO still win); written
  only by applying a proposal.
- **Levelling:** delay-only; order of service fixed for the run: priority (high first) → start in the unlevelled plan →
  total float → id, and never before a task's own predecessors; never moves a summary, manual, started, MSO / MFO /
  ALAP or priority-1000 task; a demand above a resource's max units is reported (`unresolved`), not moved; at most 20
  passes (`converged: false` says the last pass still moved something). Within the project only (other projects' loads
  are not part of the capacity — documented limit).
- **Calendars:** task calendar > primary work resource calendar (highest units) unless `ignore_resource_calendar` >
  project calendar > Mon–Fri. MS Project schedules each assignment on its own resource calendar; we use the primary
  resource's for the whole task (documented approximation).

## 6. MSPDI coverage

Carried: project (name, start, finish, minutes per day, currency, calendar), calendars (work week, exceptions, base),
tasks (UID, outline level, WBS, start / finish to the minute, duration, work, milestone, summary, manual, constraint +
date, deadline, priority, % complete, calendar, levelling delay, predecessor links with type / lag / lag format,
Baseline 0..10 with start / finish / duration / work / cost), resources (type, generic, material label, max units,
calendar, rate tables A–E with effective dates, standard / overtime rate, cost per use), assignments (units, work,
contour, cost rate table, cost). **Not carried:** interim plans (MS-Project keeps them as custom Start1-10/Finish1-10),
time-phased data blocks, split tasks, recurring tasks, overtime work, several currencies (MSPDI holds one), resource
assignment baselines. On export from the DB, calendars are FLATTENED (site holidays become non-working exceptions,
base chains resolved); on import into the DB a calendar is created per file calendar with `use_site_holidays = 0`.
The percent-lag encoding (`LinkLag` = percent × 10, `LagFormat` 19) is our reading of the schema and must be confirmed
on a file saved by MS Project.

## 7. Performance (recorded 2026-11-13, sandbox: 4 vCPU, Node 22.22, `node tools/ppm/bench-engine.js --runs=3`, median)

| Generated project | Assignments | CPM full reschedule | Levelling | Passes | Converged |
|---|---:|---:|---:|---:|---|
| 1,000 tasks | 567 | 14 ms | 525 ms | 8 | yes |
| 5,000 tasks | 2,819 | 51 ms | 4,397 ms | 20 (cap) | no (the generator over-books on purpose: remaining over-allocations are mostly pinned / impossible demands) |

The W1 10,000-task CPM benchmark (`tests/ppm-schedule-engine.test.js`) stays under its 1 s budget. Loose budgets are
asserted in `tests/ppm-w2-bench.test.js` (CPM 1,000 < 1.5 s, 5,000 < 4 s; levelling 1,000 < 30 s and converged);
levelling 5,000 is recorded, not asserted (shared machines).
