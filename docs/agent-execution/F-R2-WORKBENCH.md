# F-R2-WORKBENCH — project workbench bundle (R2-WB-01 … R2-WB-06)

Branch `goal/r2-workbench` (from `52b9375`). Migration **085** only (`db/postgres/reports/085_ppm_workbench.sql`).
`server.js`, `reports-db.js` and `public/reports.html` not touched; the new routes are registered from the existing PPM
routes module (`routes/governancePpm.js` → `routes/governanceWorkbench.js`), so there is no wiring line to add.
Nothing is approved by this work: every behaviour change sits behind a PROPOSED `report_config` switch that defaults to
today (`'0'`), each switch has a PILOT-PROFILE row, `docs/ops/FLAG-REGISTER.md`, `docs/ux/CHART-INVENTORY.md` and
`docs/ops/AUTHZ-MATRIX.md` were regenerated. Not pushed, not merged.

## Verdict table

| Goal | Commit | Verdict | What changed | Proof |
|---|---|---|---|---|
| R2-WB-04 team / resource identity | `57b26d2` | FIXED behind `ppm_project_team_enabled` | `ppm_project_members` (label, optional user link, role, allocation 0..100 or **null = unknown**, window). `AllocationContract.withMembers` (reused, not forked) fills a task's UNKNOWN allocation from its owner's member allocation inside the member's window; with no members the same array is returned (golden unchanged). Used by `resourceConflicts` / `resourceCoverage` / `capacityBySite`. Routes GET/PUT/DELETE `/api/governance/ppm/project/:id/team` (read scope / plan-write rule), ledger rows `team_member_*`. Team panel on the project Overview | `ppm-workbench.test.js`, `ppm-workbench.smoke.test.js` (404 while off; plan-write 403; 150 % refused; two unknown tasks read at 60 % → peak 120 %; site read scope; ledger) |
| R2-WB-02 time entries / actuals | `b8e6602` | FIXED behind `ppm_time_entries_enabled` | `ppm_time_entries` (task, person, day, hours 0..24). `projectSchedule.actualHours`: planned / actual / variance per task, **actual = null when no entry** (never 0). Routes on the task + `/project/:id/actual-hours`; hours panel in Plan; workbook Tasks sheet gains actual / variance columns only when on | unit (25 h, negative, bad day refused) + smoke (unknown stays null; delete; workbook columns only when on) |
| R2-WB-03 budget periods in exports | `893dbd5` | FIXED behind the existing `ppm_budget_periods_enabled` + money-read rule | Workbook "Budget periods" sheet (currency stated per row, no glyph, no cross-currency total, "not certified by Finance" note) only for roles the money routes allow. The PPTX deck is NOT changed (stated in the PILOT row) | `portfolio-deck.test.js` (+1), smoke (finance-viewer sees the sheet, viewer does not) |
| R2-WB-01 change requests | `3d6b54f` | FIXED behind `ppm_change_requests_enabled` | Native `ppm_change_requests`: proposed → assessed → approved / rejected → applied, withdraw. Committee assesses/approves/rejects/applies; the author never decides (`SELF_REVIEW` 403); reject/withdraw need a note; apply with a dates impact uses the existing committee re-baseline (409 `REBASELINE_OFF` / `NO_BASELINE`). Budget impact readable/writable only under the money-read rule. Changes tab on the project page. Demo seed uses the native object only when the switch is on in the target DB, else the RFI stand-in as before | unit (transition table), smoke (full flow, SoD, money scope, re-baseline version recorded), `demo-seed.test.js` (+1), e2e demo journey |
| R2-WB-05 portfolio list / board / timeline | `4c38198` | FIXED behind `portfolio_views_enabled` | `public/lib/portfolioViews.js` (pure): view switch with exactly one `aria-current`, choice kept in `?view=` (other query keys kept, default not written), list = the table view promoted, board = read-only columns per stage (no stage = proposal; unknown progress "—", a measured 0 % stays 0 %). French strings added | `portfolio-views.test.js` (3), e2e demo journey (board + list) |
| R2-WB-06 controlled roadmap publication | `dfb7ebe` | FIXED behind `roadmap_publication_enabled` | Off = migration API exactly as before (dry run has no `duplicates` key; new routes 404). On: dry run lists duplicates (`services/roadmapPublication.js`: objective keys already used — live or soft-deleted —, keys repeated in the source, deliverable names repeated after `roadmapParity.norm`), apply refused 409 `DUPLICATES` unless `skip_duplicates=1`, apply recorded as ppm_events `roadmap_migrated`. `GET /api/governance/roadmap-publication` (state + parity). `POST …/roadmap-migration/archive` = the explicit read-only gesture (`confirm:true`), records `published` with the parity verdict and sets `roadmap_redirect_to_portfolio='1'`. `POST …/roadmap-migration/rollback` = dry run by default; apply needs `soft_delete_enabled` (409 `SOFT_DELETE_OFF`) and a ≥10-character reason, renames the migrated keys (`-rb<ms>`, keys are unique even deleted), soft-deletes the programme, turns read-only back off, records `roadmap_rollback`. Roadmap Manager rows are never touched. "Publier dans le portefeuille" section on `itsm-roadmap.html` (hidden while off): Simuler → Publier (typed confirmation) → parité → Archiver (typed confirmation) / Annuler (reason). The pre-existing hand-written 409 now goes through `httpFail` | `roadmap-publication.test.js` (4), `roadmap-publication.smoke.test.js` (2: dry run writes nothing, refusal, skip, archive confirm, rollback dry run/apply, keys freed, re-publication works, Roadmap Manager rows intact) |

## Test proof (PostgreSQL, per-file throwaway databases)

- Each goal's focused set was green at its commit (pure + smoke + neighbours named above).
- After R2-WB-06: the governance/PPM/portfolio/project/roadmap/demo neighbourhood (49 files, 357 tests) → **355 pass,
  2 fail**. The 2 failures are in `tests/soft-delete-readers.test.js` (`inspection-db.js:1044 listRecentFindings`,
  `services/governanceStore.js:297 rfiLineage`): neither file is changed on this branch (`git diff 52b9375 --` is
  empty for both) — they fail identically on the base and belong to the owners of those files.
- Ratchets and generated docs green: `error-shape` (ratchet lowered 445 → **444**), `server-size-budget` (server.js
  untouched), `authz-route-matrix`, `flag-register`, `readme-truth`, `test-runner-guard` (manifest total 4770),
  `ui-design-ratchet`, `a11y-static`, `i18n-coverage`, `i18n-text`, `chart-a11y`, `authz-enforce`.
- Playwright `tests/e2e/demo-journey.spec.js` green after R2-WB-05 (board, list, budget periods + Changes sheet,
  Changes tab).
- `node tools/test/drop-test-dbs.js` run after the test runs.

## Deviations

- `tests/project-page.test.js`: its "hidden tabs" regex now lists `budget|raci|changes` (the new Changes tab is hidden
  while its switch is off, exactly like the two it already listed).
- Recording one's OWN time on a readable project without the plan-write right is a product decision — not built; time
  writes follow the plan-write rule.
- The PPTX portfolio deck does not carry budget periods (workbook only).
- `services/roadmapParity.js` now also exports `norm` (no behaviour change).
- A rolled-back programme restored from the trash keeps its renamed `-rb…` keys (by design: the original keys stay free
  for a new publication). Stated here so nobody expects the original key back.

## Left for a person

- Decide, per switch, whether to arm it on the pilot: `ppm_project_team_enabled`, `ppm_time_entries_enabled`,
  `ppm_change_requests_enabled`, `portfolio_views_enabled`, `roadmap_publication_enabled` (and the existing
  `ppm_budget_periods_enabled`). All ship at `'0'`.
- Change-request policy: who sits on the committee that assesses/approves, and whether an approved budget impact must
  also pass a Finance step — not decided here.
- Roadmap publication: the archive (Roadmap Manager read-only) and any later deletion of Roadmap Manager rows are a
  CAB / owner decision after a parity cycle; this work only provides the controlled gesture and the audit rows.
- Browser check of the new "Publier dans le portefeuille" section with a real super_admin session (only static and
  HTTP tests cover it).
- The two pre-existing `soft-delete-readers` failures (files outside this bundle).
