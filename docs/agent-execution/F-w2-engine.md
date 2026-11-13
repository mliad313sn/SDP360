# F-w2-engine — PPM parity wave W2, engine / data side

Branch `goal/w2-engine` (merged `sdp-waves` at `df506f0` before the final run). Migration **105** (107 unused).
ADR: `docs/ai-decisions/ADR-W2-ENGINE-calendars-resources-mspdi.md`. Contract for W2-ui and other consumers:
`docs/ppm/W2-ENGINE-CONTRACT.md`. Every behaviour is behind a PROPOSED switch defaulting to `'0'` (today: 404).

## Built, per clause
| Clause | Where | Evidence |
|---|---|---|
| FS/SS/FF/SF with lag/lead in working days, % of predecessor duration, elapsed days | `services/ppm/scheduleEngine.js` (`lagUnit`, `baseOrd`, backward pass per unit); `dependency_links[].lag_unit` kept by `governanceStore._schedLinks` | `tests/ppm-w2-engine.test.js` "lag units…" — hand-computed fixtures for each of the 4 types × 3 units, leads |
| 8 MS-Project constraints + deadlines, negative float | engine (W1 constraints kept) + per-task `deadline_slack_days` / `deadline_missed`, `deadlines_missed[]`, `DEADLINE_MISSED` | "deadlines…", "constraints with negative float…" (hand fixtures) |
| Calendars project/task/resource on `site_calendar`, working-time exceptions | `services/ppm/calendars.js`, migration 105 `ppm_calendars` / `ppm_calendar_exceptions` | "calendars…" (site + platform holidays, exception overrides holiday and weekend, base chain, loop refused) |
| Resource pool, rate tables A–E with effective dates, contours | `services/ppm/resources.js` (`rateAt`, `contourWeights`, `spread`, `timephase`, `assignmentCost`) | "rates…", "contours…" (8 shapes, exact minute totals), unknown rate → null cost |
| Over-allocation detection + delay-only priority levelling with an explanation per move; never writes without apply | `resources.level`, `GET …/leveling` (proposal + fingerprint), `POST …/leveling/apply` (409 `STALE_PROPOSAL`), `…/leveling/clear` | "levelling…" (moves, reasons with rule strings, pinned tasks never moved, unresolved over-max demand); smoke: proposal does not write, apply writes, stale refused |
| 11 baselines + interim plans, immutable | `services/ppm/baselineSlots.js`, `ppm_baseline_slots` (append-only trigger) | "baseline slots…"; smoke: second save of a slot → 409 `SLOT_TAKEN` |
| Lossless MSPDI import/export, round-trip golden on a generated 1,000-task file | `services/ppm/mspdi.js`, `tools/ppm/gen-mspdi-golden.js`, routes export / import (dry run; apply = committee, empty project only) | `tests/ppm-mspdi.test.js`: SHA-256 of the generated file pinned, `normalize(from(to(m))) == normalize(m)`, writer fixed point, DTD refused |
| Benchmarks CPM + levelling 1,000 / 5,000 | `tools/ppm/bench-engine.js`, `tests/ppm-w2-bench.test.js` | 1,000: CPM 14 ms, levelling 525 ms (8 passes, converged); 5,000: CPM 51 ms, levelling 4,397 ms (20 passes, cap) — loose budgets asserted, 5,000 levelling recorded only |
| Switches default off, API with the same guards | `routes/ppmEngine.js` mounted by `routes/governancePpm.js`; `ppm_calendars_enabled`, `ppm_resources_enabled`, `ppm_leveling_enabled`, `ppm_baseline_slots_enabled`, `ppm_mspdi_enabled` in DEFAULTS + PILOT-PROFILE rows (PROPOSED) | `tests/ppm-engine-routes.smoke.test.js` (switches off → 404; read scope, plan-write, committee, money hidden for non-money readers, site perimeter on resources) |
| Contract for the Gantt (W2-ui reads `ctx.calendar`) | `ui_calendar` in the schedule response | smoke asserts `ui_calendar` shape |
| W0 gap matrix rows closed | `docs/audits/2026-11-12-ppm-parity/W0-MATRIX-ENGINE.md` (ARCH-6/7/8/10, B3, B7, B8, B18, D1–D6, J1), README T1/T2/T6/T7 | status + test references in each row |

## Shared files touched (minimal)
`services/governanceStore.js` (`_schedLinks` keeps `lag_unit`), `routes/governancePpm.js` (mount + 5 feature keys),
`services/reportConfig.js` (5 DEFAULTS), `docs/ops/pilot/PILOT-PROFILE.md` (5 rows), `tests/ppm-rollback-scripts.test.js`
(105), suite manifest, regenerated INVENTORY*, FLAG-REGISTER*, AUTHZ-MATRIX / authz-matrix.json.

## Not done / human decisions
- Open one exported `.xml` in MS Project (no licence in the sandbox) and confirm the percent-lag encoding (`LinkLag` ×10, `LagFormat` 19).
- Levelling is within one project (other projects' loads are not capacity); MS-Project-exact contour tables and per-assignment resource calendars are approximated (documented).
- Deadline alert in `ppmAlerts` not added; the project page does not yet show calendars/resources (W2-ui consumes `/schedule`).
- PMO: who owns the pool, when to arm each switch; Finance: the rate tables (no amount is invented — unknown rate → null cost).
