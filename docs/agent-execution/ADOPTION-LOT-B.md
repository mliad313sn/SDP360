# ADOPTION LOT B — "Each profile lands on its job" (evidence)

> **AI work, sandbox, synthetic data only.** Implemented by an AI agent from `docs/ux/adoption-review-2026-11-20/
> ADOPTION-REVIEW.md` §5–§6 (Lot B). Every behaviour change sits behind a `report_config` switch defaulting to `'0'`
> (today's behaviour); enabling them per pilot site is the **pilot owner's** decision. Nothing here is a usability
> result: the Lot B gate is the human first-click and SUS sessions of `docs/ops/USABILITY-TEST-PROTOCOL.md` on two
> pilot sites (one francophone coordinator, one technician, one PMO, one executive). No push, no merge, no deployment.
> Decisions: `docs/ai-decisions/ADR-ADOPTION-LOTB-profile-landing.md`.

Branch `feat/adoption-lotB` (worktree `/home/user/w/adoption-lotB`), base `5176ec3b`.

## Switches (all default `'0'`, category interface, risk low, no four-eyes)

| Key | Off (today) | On (PROPOSED for the pilot) | Lot |
|---|---|---|---|
| `ui_role_landing_profiles` | landing as `ui_role_landing` decides | feature-role-only accounts land on their default workspace profile's first page instead of the Helpdesk | L15 |
| `ui_home_group_variant` | Home says "no site" to a site-less person | group card: worst sites (executive tier only), late projects, decisions due | L15 |
| `ui_home_freshness_strip` | — | admin tier: last collection per data source on Home, never synced = amber | L15 |
| `ui_helpdesk_site_default` | Helpdesk opens on All Sites | site-scoped roles open on their own site (alias fold), All Sites one click away | L15 |

Registered in `services/reportConfig.js` DEFAULTS, `services/uiPolicy.js` (UI_KEYS / ENUMS / `uiPolicyFrom`),
`docs/ops/policy-catalogue.json`, `docs/ops/switch-lots.json` (new lot **L15**, 4 switches), `docs/ops/pilot/PILOT-PROFILE.md`
(recommended values, "Pilot owner (UI policy)"); generated `FLAG-REGISTER.{md,json}`, `FLAG-DECISIONS-GAPS.md`,
`SWITCH-LOTS.md` regenerated. Note for the merge: the portfolio Lot 3 branch may also add a lot — renumber if both
claim L15.

## Items

| # | Review item | Status | Where |
|---|---|---|---|
| 5 | Executive / super_admin landing (pilot turns `ui_role_landing` on) | no code — pilot-owner decision; recommended value already `1` in PILOT-PROFILE | — |
| 6 | 7 profiles still land on the Helpdesk | done, behind `ui_role_landing_profiles` | `public/lib/landing.js` (`profileLanding`, reuses `workspaceProfiles` catalogue), `public/login.html` (loads `lib/workspaceProfiles.js`, passes the switch + roles), `public/_shell.js` (brand link honours the switch when the module is loaded) |
| 7 | French by default, finish English pages | partial: 3 more pages translated (static markup), behind the existing `ui_i18n_pages` | `public/lib/i18n/{notifications,report-studio,integrations}.fr.js`; the pages load them (inert while the switch is off) |
| 11 | Home group variant for executive / site-less | done, behind `ui_home_group_variant` | `public/lib/homeGroup.js` (pure helpers + compose), `public/lib/home-page.js` (`lotB()`), `public/home.html` |
| 13 | Portfolio register view | **not done here** — portfolio pages are being changed by portfolio Lot 3 in parallel | — |
| 14 | "Mes projets" default semantics | **not done here** — same reason (portfolio route + page) | — |
| 16 | Freshness strip for admin Home | done, behind `ui_home_freshness_strip` | `public/lib/homeGroup.js` `freshnessHtml`, `#hmFreshBox` on Home |
| 22 | Helpdesk default site for site roles | done (preset only), behind `ui_helpdesk_site_default`; "collapse advanced filters" not done (layout change needs the browser review) | `public/lib/helpdeskSiteDefault.js`, one call in `public/index.html` `populateDrops` |
| 2 (partial month) | PROPOSED rule submitted to the KPI committee | restated below, unchanged engine | — |

### Profile landing with the switch on (from the catalogue — PROPOSED)
committee-member → `portfolio.html` · finance-viewer → `assets.html#finance` · audit-viewer → `cockpit.html` ·
kpi-committee → `cockpit.html` · dashboard-publisher → `dashboards.html` · scorecard-viewer → `dashboards.html?key=exec-home` ·
field-tech → `field/index.html` · viewer / report-author → `index.html` (unchanged). Editors and above, tracker editors
and business accounts: unchanged.

### Item 2b — partially entered tracker month (submitted to the KPI committee, unchanged)
Options (as in Lot A): (1) keep today's rule (empty cells of a partly entered month count as nothing done);
(2) score only the activities entered for the month, flag the rest "non saisi"; (3) withhold the site colour until a
cut-off day of the following month (e.g. the 5th, as the closed-month lock) and show "en cours de saisie" before.
Decision owner: KPI committee. The engine rule lives in `services/trackerMonthState.js` + the tracker scorer; nothing
changes until the committee adopts one.

## Tests (targeted; full suite not run here)
`PG_ADMIN_URL=… NODE_OPTIONS="--require tools/test/blocking-stdio.js --require tests/_default-env.js --import tests/_pg-boot.mjs" node --test --test-force-exit <files>`

New: `adoption-lotb-landing` (5), `adoption-lotb-home` (9). Extended: `adoption-lota-nav-authz` (+1: with the Lot B
switches on, the landing page and every route the Home blocks / Helpdesk default call are walked for every outcome
persona — no U/F, no refusing page gate), `i18n-coverage` (+6: three translated pages), `ui-policy` (keys + defaults).
Fail-before: the two new files fail on the base commit (modules `homeGroup`, `helpdeskSiteDefault` absent; landing
without `profileLanding` returns `index.html` for the committee).
Targeted unit run (all files matching simplicity-budget, shell*, adoption-lot*, ui-policy*, i18n-*, a11y-*,
ui-design-ratchet, csp-*, authz-*, error-shape, switch-lots*, flag-register, policy-center-catalogue, agent-inventory,
inventory-*, readme-truth, landing, home-*, workspace-profiles*, html-lang*, first-usable, page-head, my-work*,
gate-dossiers, evidence-manifest, login*, business-*): **474 tests, 473 pass, 1 fail** after the fixes — the one
failure is pre-existing and not in this lot's files: `tests/i18n-shell-charts.test.js` "glossary" flags three Lot A
dictionaries (`inspection-actions.fr.js` / `meetings-actions.fr.js` "Closed → Clôturées", `meetings-issues.fr.js`
"Escalated → Escaladés" vs the glossary's singular). The three new dictionaries are not flagged. Left to the owner of
those dictionaries (a wording choice: plural filter label vs glossary singular). `ui-policy-me.smoke` was updated for
the four new policy keys (3/3). `npx eslint .` clean.

E2E (Chromium, throwaway PostgreSQL, Lot B switches on in that database only): new journey
`tests/e2e/b1-adoption-lotb-landing.spec.js` — off: committee lands on the Helpdesk; on: committee lands on
`portfolio.html`, Home group card at 390 and 1366 px with only `cockpit.html` / `portfolio.html` links, no freshness
strip, no "no site" message, layout judge clean; super_admin in French sees "Sites à surveiller" + the freshness strip
"jamais synchronisé"; the site editor's Helpdesk opens without a page error — **pass**. `r2-home-queue` — pass.
Other journeys touching the changed pages (login landing, Helpdesk, translated pages, PMO): P09-A, P09-B, U1, U3, U5, UAT S3 — 6/6 pass.

## Authorization
No route added, removed or re-gated: `docs/ops/authz-matrix.json` and `docs/ops/authz-outcomes.json` unchanged (no
changed rows). The landing / Home-block walk reads the committed outcome snapshot.

## Generated artefacts regenerated
`docs/ops/FLAG-REGISTER.{md,json}`, `docs/ops/FLAG-DECISIONS-GAPS.md`, `docs/ops/SWITCH-LOTS.md`,
`docs/agent-execution/INVENTORY{,-STRICT}.md`, `INVENTORY.json`, `README.md` size block, `docs/ux/CHART-INVENTORY.md`,
`docs/agent-execution/P09-PAGE-INVENTORY.md`, `tests/.suite-manifest.json` (5742 → 5763),
`docs/agent-execution/EVIDENCE-MANIFEST.md`. Unchanged by their generators: `docs/security/CSP-JOURNEYS.md`,
`docs/ops/pilot/RACI-TEMPLATE.md`.

## Human decisions left
- **Pilot owner**: turn on, per pilot site, `ui_role_landing`, `ui_i18n_pages` and the four Lot B keys (recommended
  values in PILOT-PROFILE — proposals); confirm or change each profile's landing (it follows the workspace-profile
  catalogue's first destination).
- **KPI committee**: the partial tracker month rule (2b) and the SLA population (Lot A 12b).
- **Portfolio Lot 3 / PMO**: items 13 (register view) and 14 ("Mes projets" default only for owners).
- **Usability sessions** (Lot B gate): first-click + SUS on two pilot sites before anything is ranked for delivery.
