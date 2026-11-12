# F-W1-INTEGRITY — PPM parity W1, data-integrity bundle

- **Date:** 2026-11-12 · **Branch:** `goal/w1-integrity` (base `c8f1794`) · **Nature:** P0 defect fixes (ON, no switch), one additive migration.
- **Scope (from `docs/audits/2026-11-12-ppm-parity/README.md` §3):** A-INT-1, I-CONC-1, E-NULL-1/2/3, ARCH-MIG-1, plus the quiet catch at `routes/governance.js:138` (engine matrix stub scan).
- **Not touched (other W1 bundles):** `services/projectSchedule.js`, the Gantt drawing in `public/project.html`, EVM.

## 1. Changes

| Defect | What changed | Where |
|---|---|---|
| A-INT-1 | New pure rules `services/ppm/planIntegrity.js`: real calendar dates only (`DATE_INVALID`), end before start refused per pair start/end, baseline, actual (`DATE_ORDER`, same day allowed), `PARENT_SELF`, `PARENT_NOT_FOUND`, `PARENT_OTHER_PROJECT`, `PARENT_CYCLE`, `DEPENDS_ON_HIERARCHY` (a task cannot depend on its own parent/ancestor or sub-task — repro R3). The store calls `_integrityCheck` before every task / project / milestone write; refusal = 400 `{ error, code }` through the existing route mapping (`e.reason` → `code`). **Incremental:** only the fields a write changes are checked, so a legacy bad row stays editable for its other fields. A task with sub-tasks cannot move to another project. | `services/ppm/planIntegrity.js`; `services/governanceStore.js` `_integrityCheck` (before `upsertPortfolio`) and its call in `upsertPortfolio` |
| A-INT-1 (legacy rows) | Read-only CLI `tools/pg/ppm-integrity-report.js` (`--json`): SELECT only, session set `READ ONLY`, lists every offending live row with its rule. Reads (`portfolio()`, `projectDetail()`) proved not to crash on a forged parent loop / non-date / parent link. | `tools/pg/ppm-integrity-report.js`, `findIntegrityIssues` |
| I-CONC-1 | Migration `092_ppm_row_version.sql` (ADD COLUMN IF NOT EXISTS `version INTEGER NOT NULL DEFAULT 1` on projects, tasks, milestones) + rollback. `updateRow` bumps `version` on these three tables; with an expected version it writes `… WHERE id=? AND version=?` and throws 409 `CONFLICT` / `code: STALE_VERSION` when 0 rows changed (atomic, no read-then-write race). The direct baseline UPDATEs (stage gate capture, re-baseline) bump it too. **Backward compatible:** a write without `version` keeps last-writer-wins. Same pattern as decisions (`WHERE status=?` → STALE) and sessions (`version=version+1`). | `services/governanceStore.js` `updateRow`, `upsertPortfolio` (`vopt`); `db/postgres/reports/092_ppm_row_version.sql` |
| I-CONC-1 (pages) | `project.html` sends the version it read for the charter, a task and a milestone, and explains `STALE_VERSION` in plain words (+ the new integrity codes). `portfolio.html` sends the version of the edited project/task/milestone and shows "Someone else changed this item… reload" on 409. | `public/project.html`, `public/portfolio.html` |
| E-NULL-1 (R6) | `objectiveView`: a project with no progress is excluded from the mean (was 0 %); `projects_reporting` / `projects_total` added; no reporting project → evidence null / source `none`. `portfolio.html` shows "N of M projects reporting". | `services/portfolioEvidence.js` `objectiveView` |
| E-NULL-2 (R7) | `ganttRows`: no baseline end → `slip_days: null` (was 0 = "on baseline"). Consumers already treat null as "—" / not late. | `services/portfolioEvidence.js` `ganttRows` |
| E-NULL-3 (R8) | `moneyRollup`: per-currency sums of KNOWN amounts only, `spent_unknown` / `budget_unknown` per currency and `spent_unknown` / `budget_missing` overall; a sum with no known amount is null. Currencies still never added together. `portfolio.html` and the HTML report show "—" for an unknown amount (was `Math.round(null)` = 0) and say how many spends are not reported. | `services/portfolioEvidence.js` `moneyRollup`; `public/portfolio.html`; `routes/governance.js` report.html |
| governance.js:138 | Tracker facts moved to pure `services/trackerFacts.js`: a scoring error keeps the tracker as `score:null, rag:'NA', not_measured:true, reason:'scoring_failed'` + correlation id (logged); a tracker with no score reads `reason:'no_score'`. Agenda, minutes and cockpit show "— (not measured)". | `services/trackerFacts.js`, `routes/governance.js` `trackerFacts`, `services/agendaBuilder.js`, `services/minutesRenderer.js`, `public/cockpit.html` |
| ARCH-MIG-1 | Manual rollback scripts (outside `db/postgres/`, never applied by the migrator) for **010, 011, 039, 043, 044, 045, 052, 056, 072, 073, 080, 081, 085, 092**, in the existing `NNN_*_drop.sql` style, each naming what is lost and the switches to turn off first. No `CASCADE`: an out-of-order rollback refuses. **018_governance is deliberately excluded**: it also creates the cadence / session / decision / RFI tables that non-PPM features build on (025, 070, 071) — rolling it back is a governance-wide decision. No rollback test existed in the repo; one was added. | `db/postgres_rollback/*_drop.sql` |

## 2. Tests (failing first, then passing)

| File | Tests | Before the fix | After |
|---|---:|---|---|
| `tests/ppm-plan-integrity.test.js` | 4 | store test FAILED ("Missing expected rejection") — pure tests written with the module | 4 / 4 |
| `tests/ppm-concurrency.smoke.test.js` | 3 | 3 / 3 FAILED (no version, no 409, pages silent) | 3 / 3 |
| `tests/portfolio-evidence-null.test.js` | 3 | 3 / 3 FAILED (R6 50 %, R7 slip 0, R8 no unknown flag) | 3 / 3 |
| `tests/governance-tracker-facts.test.js` | 2 | route test FAILED (quiet catch present) | 2 / 2 |
| `tests/ppm-rollback-scripts.test.js` | 2 | presence test failed (no scripts) | 2 / 2 — each rollback applied in reverse order on PG, removes only, forward re-applies to an identical schema, repeatable; all forwards re-applied = migrated schema |

Regression run (PostgreSQL 17 throwaway DBs, `PG_ADMIN_URL` local test role): see §4 for the final counts.

## 3. W0 rows moved

| W0 row | Before | After | Evidence |
|---|---|---|---|
| README §3 A-INT-1 / engine B5 (hierarchy part) | PARTIAL (hierarchy unchecked) | IMPLEMENTED for hierarchy + dates | `services/ppm/planIntegrity.js`, `governanceStore.js` `_integrityCheck`; `ppm-plan-integrity.test.js` |
| README §3 I-CONC-1 / UX-GOV I5 (detection half) | MISSING — P0 | PARTIAL: conflict **detection** IMPLEMENTED (409 STALE_VERSION + reload prompt); a merge UI remains W4 | `governanceStore.js` `updateRow`; `ppm-concurrency.smoke.test.js` |
| README §3 E-NULL-1 / engine A5 (null part) | incorrect (null→0) | null excluded + coverage; work-weighting still W1-ENGINE/W2 | `portfolioEvidence.js` `objectiveView`; R6 test |
| README §3 E-NULL-2 / engine B19 (R7 part) | incorrect | IMPLEMENTED (null slip) | `ganttRows`; R7 test |
| README §3 E-NULL-3 / engine E6 (money part) | incorrect | null-aware money rollup with unknown counts; leaf→summary rollups still W1-ENGINE | `moneyRollup`; R8 test |
| README §3 ARCH-MIG-1 / engine ARCH-24 | MISSING | IMPLEMENTED for 14 PPM migrations (018 excluded, see §1) | `db/postgres_rollback/`; `ppm-rollback-scripts.test.js` |
| Engine stub scan `routes/governance.js:138` | quiet drop | not-measured row with reason | `services/trackerFacts.js`; tracker-facts test |

## 4. Final regression

82 test files run together on PostgreSQL 16 throwaway databases (local test role, never a production URL): every
`ppm*`, `portfolio*`, `project*`, `governance*`, `roadmap*`, `soft-delete*`, `my-work*`, `obligations*`, `alloc*` file plus
`flag-register`, `authz-route-matrix`, `server-size-budget`, `error-shape`, `await-precedence`, `pg-migrate`,
`pg-migrate-from-111`, `ui-design-ratchet`, `a11y-legacy-ratchet`, `readme-truth`, `test-runner-guard`
→ **515 pass / 0 fail / 0 skipped** (second run). A first run had one file fail at boot with PostgreSQL
`53300 too many clients` (the shared local cluster was saturated by parallel sessions) — environment, not code; the same
file passed alone and in the rerun. `tests/.suite-manifest.json` updated (+5 files, +14 tests → 4859). ESLint clean on
every touched JS file (the HTML pages are outside the lint config).

## 5. Human follow-ups

1. **Run the integrity report on production data** (read-only): `node tools/pg/ppm-integrity-report.js` on the server. Every listed row predates the rules; a person corrects it in the project page (the write rules only check what an edit changes, so the other fields stay editable meanwhile).
2. **Deploy migration 092 with the code** (additive; existing rows read version 1). Users need the usual Ctrl+F5 so the pages send the version; an old cached page still works (no version = today's behaviour).
3. The rollback scripts are **manual** and several are destructive (039 drops the hash-chained ledger `ppm_events`; 052 resurrects soft-deleted rows). They are for a decided rollback with a dump in hand, never routine.
4. 018_governance has no rollback by design (see §1); deciding one belongs to the governance owner.
