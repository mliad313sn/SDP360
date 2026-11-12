# Plan F amendment — bundle R1-PROFILES (presentation profiles + workspace settings)

Branch `goal/r1-profiles` (from `37e93f8`). Scope: REBUILD-SPEC **R1** (presentation profiles) and **R2** (workspace
settings + per-user preferences API), re-specified from the written evidence in
`docs/audits/2026-11-12-enterprise-review/REBUILD-SPEC.md` — no review.1 code was seen or copied. Engineering evidence
only: nothing here is an approval, a field acceptance or a production-readiness statement. The whole capability is
behind `report_config` **`workspace_profiles_enabled`** = `0` (today: the page and the API answer 404, no row is read or
written). The switch was not turned on anywhere except inside throwaway test databases.

## Verdicts

| Spec item | Verdict | What changed | Test proof |
|---|---|---|---|
| R1 — 11 presentation profiles (declared roles, initial destination order, density, context) | BUILT, switch off | `public/lib/workspaceProfiles.js` (pure UMD engine, shared by the browser and the server): `PROFILES` (the 11 of R1, roles and destinations as written), `DESTINATIONS` (catalogue mirroring the `_shell.js` NAV role lists; `finance-assets` = `assets.html#finance`, roles `admin` + `finance-viewer` = `requireMoneyRead`), `eligibleProfiles`, `defaultProfile`, `mayOpen`, `resolve`, `validatePrefs`. `services/workspaceProfiles.js` re-exports it (the `reportActionGroups` pattern). | `tests/workspace-profiles.test.js` (8): profiles = spec; catalogue roles = shell NAV (parses `_shell.js`, fails on drift); default per role; business-only; exhaustive "never lists a destination the roles do not open"; order / hidden / density / labels; validation; switch default `0`. |
| R1 — "presentation only, never changes rights" | BUILT and tested to grant nothing | Every destination passes the shell's own rule (`'any'` = every account except business-only; else one of the roles, hierarchical via `rdb.userHasRole`). A stored profile the roles do not allow is ignored on read (`reason: not_allowed_fallback`) and refused on save (400). The user id is the session's, never the body's. Only `services/workspaceProfiles.js` reads the table — no middleware, gate or role helper does. | `tests/workspace-profiles-grants-nothing.smoke.test.js` (4, real `server.js` app on PostgreSQL): a viewer with a FORGED row (`administrator` + `system-logs`, `integrations`, `finance-assets`, `analytics`, `exec-home`, `policies`) is served `reader` with none of them; session roles and `/api/reports/auth/me` roles unchanged (`['viewer']`); `/api/reports/system-log`, `/api/reports/config`, `/api/integrations/analytics`, `/api/assets/finance/summary` still 403; saving `finance` / `administrator` → 400; static scan: the table name appears in `services/workspaceProfiles.js` only. **Mutation check**: with the role filter removed from `mayOpen` and the eligibility check removed from `validatePrefs`, 5 of these assertions turn red; the file was restored byte-identical. |
| R2 — workspace settings page | BUILT, switch off | `public/workspace-settings.html` + `public/lib/workspaceSettingsPage.js`: profile (only those the roles allow), destination order (up / down) and hide/show, density (comfortable / compact), default site (own sites; admin tier: any active site), Save → server → re-read, "Back to my role defaults", "Return to Home". EN/FR from the shell language (own table, like `home.html`); `textContent` only; labelled controls, polite live status, 36 px targets, wraps at 320 px; brand primary-fill tokens (no hex). `auth.js data-require="any"`. | `tests/workspace-routes.smoke.test.js` (page 404 off / served on); guards green: `a11y-static`, `brand-buttons` (white-on-orange), `ui-design-ratchet` (0 hex), `csp-no-inline-handlers-new-pages`, `i18n-coverage` (page listed as self-translated), `agent-inventory`. |
| R2 — per-user preferences stored server-side | BUILT, switch off | Migration `db/postgres/reports/078_user_workspace_prefs.sql` (additive, idempotent): one row per user, `user_id` PK → `users` ON DELETE CASCADE, `default_site_id` → `sites` ON DELETE SET NULL, `density` CHECK, JSON text lists. `routes/workspace.js`: `GET /workspace-settings.html`, `GET /api/workspace/me`, `PUT /api/workspace/prefs`, `DELETE /api/workspace/prefs` — all 404 while the switch is `0`; each save journalled (`system_log` `workspace_prefs_saved`). | `tests/workspace-routes.smoke.test.js` (3, PostgreSQL): table columns + FK actions; off → 404 on all four and no row; on → role default, save + re-read (FR labels), body `user_id` ignored, ineligible profile 400, foreign default site 400, unknown destination 400, admin may pick any site, business-only only `business`, reset, journal rows, switch back off → 404. |

## Decisions taken in this bundle (reversible engineering details)

1. **A business-only account (only `site-business` / `group-business`) is offered ONLY the `business` profile** — not
   `reader`. Reason: the shell already hides every `'any'` destination from these accounts and `auth.js` redirects them to
   `site-awareness.html`, so `reader` would show nothing but an unreachable Home; and R1 says business "never queries the
   internal queue" (`queue: false` in the resolved payload). This deviates from "reader = any"; the coordinator accepted
   it. A business role held **alongside** an internal role is not business-only: `business` is then one choice among others.
2. **Default profile** follows the hierarchical role first, then feature roles (same precedence as the shell's G17
   workspaces): super_admin → administrator; executive / scorecard-viewer → executive; admin → operations;
   committee-member → pmo; finance-viewer → finance; editor → coordinator; field-tech → field; audit-viewer /
   kpi-committee → governance; dashboard-publisher → analyst; otherwise reader.
3. **Density and context per profile are PROPOSALS** (presentation defaults each person can change), not decisions.
4. **Switch name `workspace_profiles_enabled`, not `ui_*`**: `services/uiPolicy.js` and its two pinned tests are not
   touched (F2-UX is changing them); `set-ui-policy.js` does not handle this key — rollback is Admin ▸ Config (`0`).
5. **Not wired in this bundle** (outside its owned files): `server.js` (wiring lines below), the login landing
   (`public/lib/landing.js` unchanged — "login lands on a space compatible with the role" stays today's rule), the
   shell menu entry to the settings page and Home's use of the resolved destinations (R2-QUEUE, through
   `window.WorkspaceProfiles.load()`, which resolves `null` while the switch is off so callers behave as today).
   Until then the page has no entry point (`INVENTORY.md`: "NO ENTRY POINT") — reachable by URL when switched on.

## Wiring for the PO (server.js is owned by F1-SEC — not edited here)

1. Mount before `express.static`, appended to the existing myWork / dataQuality line (about line 1497 at `37e93f8`):
   `app.use(require('./routes/workspace')({ express, requireReportSession, sendHtmlPage }));`
2. Optional: add `'workspace-settings.html'` to the `forEach(loadHtml)` list. `sendHtmlPage` re-reads from disk on a cache
   miss, so the page works without it; `tests/html-pages-before-static.test.js` only checks listed pages.

## Tests run (PostgreSQL 16 local, test-only cluster, focused set — not the full suite)

- The three files of this bundle: **15 tests, 15 pass**.
- Neighbours, three runs (210, 64 and 64 tests: `flag-register`, `report-config*`, `ui-policy*`, `landing`, `my-work*`, `home-page*`,
  `pg-migrate*`, `db-schema-smoke`, `authz-route-matrix`, `error-shape*`, `no-message-leak`, `a11y-static`, `brand-buttons`,
  `i18n-coverage`, `ui-design-ratchet`, `agent-inventory`, `csp-*`, `server-size-budget`, `await-precedence`,
  `readme-truth`, `kpi-docs-links`, `connector-register`, `csv-guard-coverage`, `evidence-baseline`): all green except
  **four failures that are not this bundle's and touch none of its files** (verified `git diff --quiet HEAD` on them):
  `brand-buttons` "status words" (`public/inspection-actions.html`), `connector-register` (job
  `engagement.schedule_reminders`), `csv-guard-coverage` (`routes/governancePpm.js`), `evidence-baseline`
  (`u6-shared-analytics-url.spec.js` not mapped to a persona). Two `report-config*` files crashed once on a PostgreSQL
  connection dropped mid-run (another bundle's database sweep) and passed when re-run.
- `npx eslint` clean on the touched server/test `.js`; the two `public/lib` files are on the lint ignore list and pass
  `node --check`.
- `tests/.suite-manifest.json`: +3 files (`workspace-profiles` 8, `workspace-routes.smoke` 3,
  `workspace-profiles-grants-nothing.smoke` 4); total 4541 → 4556.
- Regenerated, not hand-edited: `docs/ops/FLAG-REGISTER.md` (208 → 209 keys), `docs/agent-execution/INVENTORY.*`,
  `docs/ux/CHART-INVENTORY.md`. Hand-edited (append only): `docs/ops/pilot/PILOT-PROFILE.md` (one row),
  `services/reportConfig.js` (one key), `tests/i18n-coverage.test.js` (one page in `SELF_TRANSLATED`).
- Incident: the three new files were first truncated to 0 bytes by the disk-full event of 12 Nov; they were rewritten
  in full from the design above, nothing from the truncated state was kept.

## Left for people

- PO: confirm the 11 profiles, their first destinations and the density/context proposals; decide when to set
  `workspace_profiles_enabled` = `1` for the pilot cohort (PILOT-PROFILE row).
- PO: apply the two wiring lines above when merging after F1-SEC.
- No browser check was run in this bundle (the route is not mounted on head); a person should open
  `workspace-settings.html` once after the wiring, in EN and FR, at 320 px and with a screen reader.
