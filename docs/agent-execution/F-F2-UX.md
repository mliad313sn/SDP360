# Plan F — bundle F2-UX (experience, accessibility, adoption) — evidence

Branch `goal/f2-ux`, built on `sdp-waves` after the W2-UX merge (`fe42835`). Goals in the plan order; F-UX-08 is not
this bundle's (it needs the review.1 artifact). Nothing here is a usability result, a WCAG conformance statement, an
approved budget or a production-readiness claim. Every new behaviour is behind a `report_config` switch whose default
is today's behaviour; defect fixes ship on. Migration 084 was assigned and **not used** (no schema change was needed:
the task events go to `system_log`).

## Verdict

| Goal / audit action | Verdict | What changed | Test proof |
|---|---|---|---|
| F-UX-01 `<html lang>` follows the language on bilingual `data-lng` pages (panel N1, WCAG 3.1.1) | **FIXED** (defect, on) | home-page.js, obligations-page.js, infra-health, meetings-import, site-awareness now set `documentElement.lang` with the body class; English bodies keep `en` | `tests/html-lang-mirror.test.js` 4/4 (every class write paired with a lang write; Home vm run fr/en); e2e `t7-french-help` asserts `lang="fr"` on Home — PASS |
| F-UX-02 one `aria-current` per navigation landmark (C9, N2, N10) | **FIXED** (defect, on) + switch for the URL fallback | `_shell.js`: flat links and the single-child collapse carry `aria-current="page"`, at most one per menu; `ui_nav_active_from_url` ('0') derives the active entry from path / `?key=` / `#fragment` when `data-current` names no menu entry | `tests/shell-navigation.test.js` +4 (every visible entry × 5 role sets = exactly one; zero when none; switch off/on); `ui-policy*`; e2e `t8-keyboard-portfolio` asserts the single current entry — PASS |
| F-UX-03 state vocabulary: `partial`, no live-region badges, French partial note (C10, N3, N4) | **FIXED** | `stateBadge.js`: badges are `role="img"` (no `role="status"`), `liveRegion()` helper, new `partial` state (◐, "Partial — some sources missing, total unknown"); `dashboardRender.partialNote` follows the language (sentence + fr-FR date), English byte-identical; FR strings in `dashboards.fr.js` | `tests/state-badge.test.js` 9/9 (pinned texts unchanged, no live region, partial ≠ stale ≠ not measured, FR note) |
| F-UX-09 Home cards load and fail independently (C5) | **FIXED behind switch** `ui_home_blocks` ('0') | `home-page.js` (client only; `routes/myWork.js` untouched so F1-GOV's "Awaiting me" block merges cleanly): per-block shared states, failed call keeps the page with an error state + retry, per-site-card reload with focus kept | `tests/home-page-blocks.test.js` 6/6 (off = today; one null block leaves the others; failure keeps shortcuts; FR) |
| F-UX-11 legacy safety net on slow / failed loads (C13, N12) | **FIXED** (defect: silent 180 s spinner, on) | `pageStates.slowNotice()`: after 20 s, while the Helpdesk ticket set is still loading, a polite notice offers keep waiting / open my summary / try again — no figure shown; index.html (one tag, one call, 30 s sweep off), assets, wan, meetings, inspections load the net | `tests/page-states-adoption.test.js` 5/5; e2e `u3-admin-helpdesk-infra` PASS |
| F-UX-04 320 px reflow + coordinator pages in the viewport matrix (C15, N7) | **FIXED** (tests) + **PARTIAL** (6 known problems) | V1 now 1440/1024/768/390/**320** × 16 pages (+ home, reports, meetings, meeting, inspection, inspections, site-awareness, field PWA); `reports.html` fixed at 390/320 (list filters, weekly-summary card, report cards); 6 remaining 320 px problems pinned in `tests/e2e/fixtures/reflow-known.json` (shrink-only; a listed entry that passes fails the journey); switch-off 404 of `/api/inspection/repeat-findings` not counted as a console defect | e2e `v1-viewport-layout` PASS; `tests/reflow-known.test.js` 2/2 (ceiling 6) |
| F-UX-10 static a11y floor as a shrink-only ratchet on legacy pages (N8, C22) | **FIXED** (measurement) | `tools/agent/a11y-legacy.js` counts 9 checks on all 57 pages + field PWA; baseline `tests/fixtures/a11y-legacy-baseline.json` (1 152 findings: 542 unlabelled controls, 531 inline handlers, 34 pages without `<main>`…), generated `docs/ux/A11Y-LEGACY.md`; no page edits | `tests/a11y-legacy-ratchet.test.js` 3/3 (no page worse; new page must start at zero; doc = baseline) |
| F-UX-05 measure "first usable table" + API p95 per route (C14, N5) | **FIXED** (instrumentation) / **DEFERRED** Server-Timing | shell `__markFirstUsable` → `performance.mark('sdp:first-usable')` on home, Helpdesk, site-actions, dashboards, wan, reports and executive (via the loadLiveData wrapper); e2e fixture records `first_usable_ms` (null = no mark); `perf-baseline.js` adds first-usable p50/p95 (budget UNKNOWN); `load.js` reports p50/p95/p99 per route template (no threshold). `Server-Timing` (`ops_server_timing`) not built: it needs `server.js` (F1-SEC owns it) | `tests/first-usable.test.js` 4/4; `perf-baseline` + `load-harness` green; real run: index 279 ms, site-actions 146 ms, wan 125 ms (local, synthetic — an observation, not a budget) |
| F-UX-06 adoption telemetry v2, privacy-first (C27, N6) | **FIXED behind switch** `ux_event_telemetry` ('0') | `POST /api/ux/event` in the already-mounted `routes/pageUsage.js` (no `server.js` change): allow-listed kinds, short token targets (no URL, no text), `u<id>` + role tier, one row per user × kind × page × target × day, nothing written while off; shell sends first click / exports / drills / `data-ux-event` only when the UI policy says so; it-review + site-report report their view (`lib/pageView.js`), field PWA after a fresh bootstrap (SW cache `field-v8`), exec-view stays anonymous; `tools/pilot/adoption-report.js` (reach per tier, repeat users, events, first click on expected page — UNKNOWN without D4) | `tests/ux-events.smoke.test.js` 5/5 (400 on unknown kind / URL / e-mail target, off = no row, no PII, client sends nothing when off); `tests/adoption-report.test.js` 3/3; `page-usage*` green; e2e `f1-field-network`, `t3-field-inspection` PASS |
| F-UX-07 persona–task–screen matrix + first-click protocol (C17, C18) | **FIXED** (docs / tools) | `tools/agent/persona-matrix.js` → `docs/ux/PERSONA-TASK-MATRIX.md` (vision 7 personas × head workspaces × 31 journeys × T1-T12; review.1 11 profiles = NEEDS-REVIEW.1-ARTIFACT; Department member, Validator, Guest = named gaps); `docs/ops/FIRST-CLICK-PROTOCOL.md` + `docs/ops/pilot/FIRST-CLICK-SHEET.csv` (candidate first clicks only, expected answers UNKNOWN, no result) | `tests/persona-matrix.test.js` 4/4 (pages exist, every journey mapped, `--check`, sheet claims nothing) |
| F-UX-12 Executive chart substitution behind a switch (C20, C30) | **FIXED behind switch** `ui_exec_charts_v2` ('0') / ratchet **not lowered** | `lib/execChartsV2.js` (installed after auth.js on executive.html): dual axes → small multiples (in-place updates re-synced to the extra panel), rings → horizontal bars with the same labels / order / values (not sorted: the page updates rings by index). Off = `window.Chart` untouched | `tests/exec-charts-v2.test.js` 5/5 (same values, update sync, destroy, off = untouched); `ui-design-ratchet` unchanged; browser check on a throwaway instance: off 14 canvases, on +2 panels, no page error |
| F-UX-08 import the review.1 profile engine | **NOT THIS BUNDLE** | needs the review.1 artifact (decision D9) | — |

Switches added (all default = today, PILOT-PROFILE rows, FLAG-REGISTER regenerated): `ui_nav_active_from_url`,
`ui_home_blocks`, `ux_event_telemetry`, `ui_exec_charts_v2`.

## Tests run

Focused run of every touched test file and its neighbours (shell, ui-policy, state badge, dashboards, home / my-work,
page usage, a11y, i18n, design ratchet, perf / load, persona, flag register, server size budget, authz matrix, error
shape, readme truth, kpi doc links, field PWA, e2e harness, inventory, await precedence, html pages, url filters,
charts, metrics, retention, CSP): **405 tests, 405 pass, 0 fail, 0 skipped**. Browser journeys run individually:
`t7-french-help`, `t8-keyboard-portfolio`, `u3-admin-helpdesk-infra`, `v1-viewport-layout` (5 widths × 16 pages),
`f1-field-network`, `t3-field-inspection` — all PASS. Full suite and full e2e not run (other bundles in parallel).
Suite manifest: +12 files / +48 tests (total 4 589). Generated docs regenerated: FLAG-REGISTER, AUTHZ-MATRIX,
CHART-INVENTORY, INVENTORY, METRIC maps, one `docs/kpi/FORMULA-REFERENCE.md` citation re-anchored.

## Deviations

- F-UX-03: the `available` state was not added (no consumer needs it, as the goal allows).
- F-UX-05: `Server-Timing` / `ops_server_timing` deferred — it needs `server.js` (owned by F1-SEC).
- F-UX-06: `action_open` / `action_done` are emitted from `data-ux-event` attributes; no page carries them yet (the
  helper is in place; wiring the Site Actions close buttons is a follow-up). Retention: the events are ordinary
  `system_log` rows (12-month purge already listed in the generated RETENTION-INVENTORY).
- F-UX-12: rings become bars in the SOURCE order, not sorted — the page updates them in place by index, and sorting
  would assign values to the wrong labels. Data tables (ChartTable) for executive.html charts not added.
- F-UX-04: six 320 px problems on pages not owned by this bundle are pinned rather than fixed.
- Test infrastructure: other bundles' `drop-test-dbs` sweeps (`DROP DATABASE … WITH (FORCE)` on every
  `sdp_tracker_test_*`) killed this bundle's running test databases mid-run. Runs were moved to a private database
  (`f2ux_private`, schema path) and only idle test databases were swept; the private database is dropped at the end.

## Left for a person

- D1 performance budgets (first usable table, API p95) — the columns exist and read UNKNOWN.
- D3 arming `ux_event_telemetry` (privacy notice, retention) — default off.
- D4 the expected first-click answers in `docs/ops/pilot/FIRST-CLICK-SHEET.csv`, cohort and targets.
- D5 browser review of the Executive Scorecard with `ui_exec_charts_v2 = 1` before arming; then lower the design ratchet.
- D2 the persona → workspace proposal and the three persona gaps (Department member, Validator, Guest).
- Browser review of `ui_home_blocks`, `ui_nav_active_from_url`, the Helpdesk slow-load notice and the 320 px screenshots.
- D7 any WCAG statement (the a11y ratchet is a string check: 1 152 findings to burn down).
