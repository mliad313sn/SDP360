# F-w2-ui — PPM parity wave W2, UI side (interactive Gantt v2 + companion views)

Base `222ab4b`, branch `goal/w2-ui`. ADR: `docs/ai-decisions/ADR-W2-UI-interactive-gantt.md`. No migration (106 unused).

## Built, per clause
| Clause | Where | Evidence |
|---|---|---|
| Interactive virtualised Gantt on `project.html`, vanilla module under `public/lib/`, no framework/CDN, URL-versioned | `public/lib/ganttCore.js`, `public/lib/ganttV2.js`, `public/lib/ganttV2.css`, `public/project.html` (`mountGanttV2`) | smoke "project.html is served with the Gantt v2 module scripts URL-versioned"; static "no external URL / CDN" |
| Zoom day/week/month/quarter | `ZOOMS`, `zoom`, `ticks` (core); +/− buttons, select, Ctrl+wheel | core "zoom scales…" |
| Drag to move / resize / drag-to-link (FS; typed links drawn when present) | `dragDates`, `canLink`, `linkPatch` (core); pointer + Alt+arrows (module) | core "dragDates…", "canLink…"; smoke "writes…" |
| Undo / redo | `createHistory`, `command`, `inverseOf`; Ctrl+Z / Ctrl+Y | core "undo / redo…"; smoke "writes…" (undo replays inverse, failed replay dropped) |
| Inline grid editing (name, duration, start, predecessors, % complete) with row version (409) | `editCell` (core); grid Enter/F2/Escape (module); PUT with `version` | core "inline editing…"; smoke "writes…" (409 → shown, reload, dropped) |
| Critical path, baseline bars, today line | layout flags + `.g2-crit`, `.g2-base`, `.g2-today-l` | core "rowsFrom + layout…" |
| Keyboard accessible, readable at 320 px (list fallback) | roles grid/row/gridcell, labelled bars, live status, roving focus; List view auto-selected ≤ 560 px | static "a11y + safety…" |
| Task Usage / Resource Usage / Resource Graph (read-only) + Network diagram | `taskUsage`, `resourceUsage`, `resourceGraph`, `networkLayout` | core "companion views…" (unknown never 0) |
| Writes only via existing plan-write route and guards, no new right | `PUT /api/governance/portfolio/task` only; read-only sends nothing | smoke "writes…" read-only block; authz/rbac suites green |
| Switch `ppm_gantt_v2_enabled` default `'0'` | `services/reportConfig.js` DEFAULTS, `routes/governancePpm.js` features `gantt_v2`, PILOT-PROFILE row (PROPOSED) | smoke "switch…" |
| Performance 1,000 / 5,000 tasks; browser-free windowing test; layout timing | core performance tests; smoke "virtualised in the page module" | 1,000 tasks ≈ 8 ms, 5,000 ≈ 28 ms; ~40 bars drawn of 5,000 |
| French i18n entries | `public/lib/i18n/gantt.fr.js` (`I18N_FR_GANTT`, used when `ui_i18n_pages='1'`) | smoke "every text the module asks for has a French entry" |

## Shared files touched (minimal)
- `routes/governancePpm.js`: one key `gantt_v2` added to the features response (w2-engine may touch the same line — trivial merge).
- `services/reportConfig.js`: one DEFAULTS entry; `docs/ops/pilot/PILOT-PROFILE.md`: one row; regenerated INVENTORY*, FLAG-REGISTER.

## Tests
`tests/ppm-gantt-core.test.js` (11) + `tests/ppm-gantt-v2-page.smoke.test.js` (6), added to the suite manifest.
Neighbour run (authz-*, rbac-*, cross-site sweeps, flag-register, inventory-strict, i18n-coverage, error-shape,
await-precedence, server-size-budget, readme-truth, ui-policy*, simplicity-budget, ppm-rollback-scripts, a11y-*, csp*,
report-config*, project-page, ppm-visuals, ppm-w2, ppm-workbench, portfolio-views, ppm-schedule*): **332 pass, 0 fail**.

## Not done / human steps
- No real browser available in this sandbox (no Playwright browser installed): pointer drag, focus order and 320 px
  rendering are proven by the pure-module tests and a DOM double only — **browser E2E is a human step** before the
  switch is turned on.
- Turning `ppm_gantt_v2_enabled` on for the pilot = PMO decision (PROPOSED).
- Project calendars/holidays from w2-engine are not yet fed to the UI (`ctx.calendar` hook, Mon–Fri default meanwhile).
