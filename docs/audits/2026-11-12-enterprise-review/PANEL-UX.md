# Committee F — PANEL UX (experience, design system, shell, profiles, accessibility, performance, adoption)

Reviewed: branch `sdp-waves` head `413e26b` (read-only), plan E (`docs/audits/2026-11-05-expert-audit/PLAN-E.md`),
worktree `w2-ux` (in flight, read-only), gap analysis "SDP360 Analyse comparative…" (12 Nov 2026, French) and the
vision pack v2.0 (9 Nov 2026). The review.1 build (workspace-settings.html, profile engine, migrations 078/079,
progressive action queue S1) is **not** in any branch: everything that depends on it is labelled
`NEEDS-REVIEW.1-ARTIFACT`; nothing about its content is assumed.

## (a) Verdict summary

1. The head already carries a solid UX substrate: shared shell with role-filtered menu, Ctrl+K finder, 8 role
   workspaces, Home "My work", role landing (switch), keyboard menu, focus ring, page head, 10-state badge vocabulary,
   design ratchet, perf/load harnesses and page-view telemetry. Retain and improve; do not replace.
2. The review.1 "11 profiles + workspace settings" layer is the one big UX delta we cannot see. It must be imported as
   a reviewable lot from the artifact, not re-invented (E06 cannot start its comparison without it).
3. Two real accessibility defects at head, both cheap: `<html lang>` stays `en` on the 11 bilingual `data-lng` pages
   (Home included) when French is shown, and active flat/collapsed menu items carry no `aria-current`.
4. A third: every state badge is a `role="status"` live region (`stateBadge.js:47`) — a table of badges is noise for a
   screen reader. The vocabulary also lacks the "partial coverage" state the gap analysis requires.
5. The vision's performance criterion ("< 3 s to first usable table") is **not measurable** today: the e2e baseline
   records DOMContentLoaded/load, while the Helpdesk/Executive tables wait for `/api/data/requests-raw` afterwards.
6. Reflow is tested at 390 px on 8 pages; WCAG 1.4.10 needs 320 px and the coordinator pages (Home, reports, meetings,
   inspection, field) are not in the matrix. The static a11y floor covers 15 "new" pages; 42 legacy pages are unchecked.
7. Adoption telemetry = one `page_viewed` per user × page × day, shell pages only. No drill, export, action or
   first-click events; field PWA / it-review / site-report / exec-view are invisible.
8. Navigation highlights only through each page's `data-current`; there is no URL-derived active state and the site is
   not carried across links (both claimed for review.1).
9. Plan E W2-UX (E-U01…U05 done in worktree; E-V08, E-V10 pending) covers scoring, URL filters (Analytics), page head
   rollout, reachability, FR glossary, annotations and dataviz tasks — the goals below do not duplicate them.
10. Every threshold (perf budget, adoption target, WCAG conformance claim, chart substitution, profile adoption) stays
    a human decision; the agent work is instrumentation, ratchets, defect fixes and switch-gated proposals.

## (b) Claim verification

Labels: CONFIRMED · REFUTED · ALREADY-FIXED · NEEDS-REVIEW.1-ARTIFACT · NEEDS-HUMAN · OPEN-IN-PLAN-E.

| # | Claim (source) | Label | Evidence at head |
|---|---|---|---|
| C1 | 59 screens in dev (écarts p.1) | CONFIRMED (58 at head) + NEEDS-REVIEW.1-ARTIFACT | 57 `public/*.html` + `public/field/index.html`; the 59th = `workspace-settings.html`, absent |
| C2 | Default branch already has Home, project sheet, presentation access (écarts "Profils et ergonomie") | CONFIRMED | `public/home.html`, `public/project.html`, `public/lib/landing.js:13-31` |
| C3 | Compared snapshots do not contain the new profile-engine files | CONFIRMED | no `workspace-settings.html`; latest reports migration `077_password_iterations.sql`; role workspaces are an inline list `_shell.js:393-403` (8 entries) |
| C4 | 11 profiles: cards, nav order, density, context (review.1) | NEEDS-REVIEW.1-ARTIFACT | head: workspaces only drive Home shortcuts + empty Ctrl+K (`home-page.js:61-65`, `_shell.js:642`); nav order fixed, no density, no cards |
| C5 | Home loads sources and cards independently (review.1) | NEEDS-REVIEW.1-ARTIFACT (head: partly) | head: one `fetch('/api/me/work')` for all cards (`home-page.js:67-82`); server degrades per block to `null` = "not measured", but a failed call blanks every card |
| C6 | Login lands in a role-compatible space | ALREADY-FIXED (switch off) | `landing.js:16-31`, `ui_role_landing` default `'0'` (`services/uiPolicy.js:22`) |
| C7 | Active destination chosen by route, query and fragment (review.1) | CONFIRMED gap at head | active state = `data-current` only (`_shell.js:513-516`, `:472`); `reports.html#admin` etc. depend on each page's attribute |
| C8 | Compatible links carry the site | CONFIRMED gap at head | no `site=` propagation in `_shell.js` or `module-tabs.js` |
| C9 | Criterion: exactly one `aria-current` in the menu | CONFIRMED gap | dropdown child gets it (`_shell.js:472`); flat link (`:494-497`) and single-child collapse (`:458-463`) never do → Home, Site Overview, viewer's Helpdesk announce no current page; breadcrumb (`:553`) and module tabs (`module-tabs.js:50`) add their own |
| C10 | States available/unknown/stale/partial/denied distinguishable without colour | CONFIRMED (partly met) | `stateBadge.js:21-33` symbol+text+aria (E-V03, merged); no `partial`(coverage) and no positive `available` state; used by 11/57 pages; legacy hot pages (index, executive, reports, analytics) not on it |
| C11 | Keep a table or description for charts | CONFIRMED gap (legacy) | `docs/ux/CHART-INVENTORY.md`: executive.html (14 charts) and executive-report.html have no ChartTable |
| C12 | Visible keyboard focus | ALREADY-FIXED | global `:focus-visible` + forced-colors (`tests/a11y-static.test.js` A-12b); menu keyboard handling `_shell.js:746-800` |
| C13 | Fallback control when network is slow | CONFIRMED gap (legacy) | `pageStates.js` loaded by 1 page (executive.html); field PWA has its own offline queue (`f1-field-network.spec.js`) |
| C14 | < 3 s first usable table; p95 < 800 ms API | NEEDS-HUMAN (thresholds) + CONFIRMED measurement gap | `docs/agent-execution/PERF-BASELINE.md` (budgets UNKNOWN by design) measures DCL/load (`tests/e2e/fixtures/browser.js:81`), not first usable table; `tools/test/load.js` gives API p50/p95 per step |
| C15 | 320 px targeted tests ≠ WCAG conformance | CONFIRMED (head weaker) | head never tests 320: `tests/e2e/v1-viewport-layout.spec.js:14-15` = 1440/1024/768/390 on 8 pages |
| C16 | Business profile starts on Site Awareness, does not query the internal queue | CONFIRMED (head behaviour) | `landing.js:16`; Home roles exclude business (`_shell.js:113`); WORKSPACES `business` (`:394`) |
| C17 | 11 presentation profiles and 7 personas = two design levels | CONFIRMED gap | head 8 workspaces; vision §3.2 personas "Department member" and "Validator" have no workspace, no inbox |
| C18 | Measure first click, autonomous success, time (pilot S1) | OPEN-IN-PLAN-E (E-U01, E-V10) + CONFIRMED gap | protocol records clicks/keystrokes, not first click (`docs/ops/USABILITY-TEST-PROTOCOL.md:32`); scoring tool in w2-ux (E-U01 `cb25cab`) |
| C19 | workspace-settings: preference, revision, no grant | NEEDS-REVIEW.1-ARTIFACT | head has no server-side preference store (only `localStorage sdp_lang`, `_shell.js:730`) |
| C20 | executive.html: variance, latency, partial state to improve | CONFIRMED | 599 KB HTML, 745 KB transfer (PERF-BASELINE), 11 dual axes, 14 charts, hex 1080 (ratchet `tests/ui-design-ratchet.test.js`) |
| C21 | index.html: Helpdesk filters and reflow to improve | CONFIRMED / OPEN-IN-PLAN-E | URL filters only on Analytics (E-U02, w2-ux, switch `ui_url_filters`); index.html is a declared hot spot |
| C22 | reports.html: source, period, accessible input to improve | CONFIRMED | 8 960 lines, not in `a11y-static` NEW_PAGES (`a11y-static.test.js:11`) |
| C23 | Pages with "undeclared guard" (itsm-integrations-plan, site-report, stubs) | REFUTED as a risk | access is server-side: `server.js:1477-1482` (session redirect), `site-report.html` data via `requireReportSession`; 4 stubs are meta-refresh redirects (`wan-sla.html:5`) |
| C24 | Redirects keep historical bookmarks | CONFIRMED | `wan-sla.html`, `wan-health.html`, `assets-finance.html`, `assets-hygiene.html` |
| C25 | Vision: UI visibility is not a security control | CONFIRMED (retained) | `landing.js:9`, `_shell.js:391-392` ("a starting point, never a permission"); server gates per route |
| C26 | Vision: executive ≤ 8 KPI cards above the fold | NEEDS-HUMAN | exec-home is a published dashboard (`dashboards.html?key=exec-home`); content is a publisher/committee choice |
| C27 | Vision 6.2: reach, workflow adoption, dashboard value, data trust | CONFIRMED gap | only `page_viewed` (`routes/pageUsage.js:37-48`), `dashboard_viewed` (`routes/dashboards.js:109`), `assets_viewed`; no drill/export/action events |
| C28 | Vision 3.1: context persistence (scope, period, filters, a11y prefs) | CONFIRMED gap / OPEN-IN-PLAN-E (Analytics only) | language in localStorage; filters in URL only via E-U02 |
| C29 | Freshness: `skipped` becomes success and moves the watermark (écarts p.151) | CONFIRMED input side; owner = data/ITSM panel | `services/sync/jobs.js:141-157` return `{skipped:true}`; the runner path was not re-verified here. UX impact: `pageHead.freshness` shows the stored last success as truth |
| C30 | Vision 3.4 chart standard (no dual axes, no doughnut for shares) | OPEN-IN-PLAN-E (E-V01 ratchet done) | 27 `yAxisID`, 29 doughnut/pie, budgets may only go down (`ui-design-ratchet.test.js`); substitutions = human browser review |

Counts: CONFIRMED 19 (incl. partial / gap forms) · REFUTED 1 · ALREADY-FIXED 2 · NEEDS-REVIEW.1-ARTIFACT 4 (C1 also
carries it) · NEEDS-HUMAN 2 (C14 also carries it) · OPEN-IN-PLAN-E 2 primary (+3 secondary tags).

## (c) New findings (not in either document)

| # | Finding | Evidence | Severity |
|---|---|---|---|
| N1 | French body announced with an English voice: the 11 `data-lng` pages (home, site-awareness, access, coverage, handoffs, infra-health, kpi-builder, meetings-import, meetings-insights, obligations, policies) toggle `body.lang-fr` but keep `<html lang="en">`; the shell mirrors `lang` only when `data-i18n="on"`, which only `lib/i18n/boot.js` sets | `home.html:2`, `home-page.js:9`, `_shell.js:521-525`, `lib/i18n/boot.js:18` | P1 defect (WCAG 3.1.1) |
| N2 | Active flat / collapsed menu entries have no `aria-current` (only a CSS class) | `_shell.js:458-463`, `:494-497` | P1 defect (WCAG 1.3.1/2.4.8 practice; E06 criterion) |
| N3 | Every state badge is a polite live region: `role="status"` on static markup inserted in tables/cards | `stateBadge.js:47`, consumers on 11 pages | P1 a11y defect (announcement flood or ignored) |
| N4 | Partial-period note is English-only and formats with `en-GB` in a French UI | `dashboardRender.js:181-184` | P2 |
| N5 | Perf baseline cannot judge "first usable table": DCL is ~100-260 ms while the Helpdesk/Executive tables wait for `/api/data/requests-raw` (client timeouts 180 s / 300 s) | `fixtures/browser.js:81`, `index.html:1905`, `executive.html:6467`, `executive-report.html:2315` | P1 measurement gap |
| N6 | Telemetry blind spots: pages without the shell send no `page_viewed` (field PWA, it-review, exec-view, site-report); no event for export, drill-through, action started/completed, first click after landing | `_shell.js:563-581` (only emitter) | P1 for E09 |
| N7 | Reflow matrix misses 320 px and every coordinator page | `v1-viewport-layout.spec.js:14-15` | P1 |
| N8 | Static a11y floor covers 15 pages; legacy 42 (index, reports, executive, meetings, inspection…) unchecked, no shrink-only ratchet | `a11y-static.test.js:11` | P2 |
| N9 | Workspace resolution is first-match by list order: admin+committee-member or admin+finance-viewer → "Group IT"; no finance / governance / analyst / coordinator distinction; Department member and Validator personas absent | `_shell.js:393-416` | P2 (design gap, E06 input) |
| N10 | `data-current` ids not in NAV → no active marker, breadcrumb leaf unnamed: access, coverage, kpi-builder | page mounts vs NAV ids | P2 |
| N11 | Untranslated accessible names in the shell: `aria-label="Toggle … menu"` | `_shell.js:489` | P2 (FR, E-U05 scope adjacent) |
| N12 | "Never spin forever" safety net on 1 page; page head on 4 pages (10 after w2-ux E-U03) | `grep -l pageStates.js` → executive.html; `pageHead.js` users | P2 |

## (d) Vision capability map (UX domain)

| Vision capability (section) | What exists at head | Decision | Evidence |
|---|---|---|---|
| Role-adaptive workspace (3.1) | Role-filtered menu, lean profile, 8 workspaces, role landing (switch) | IMPROVE (then CONSOLIDATE with review.1 profiles) | `_shell.js:291-416`, `uiPolicy.js`, `landing.js` |
| 7 persona workspaces (3.2) | Exec, business, site IT, technician, PMO, admin, reader | IMPROVE: add Validator inbox & Department member view; map review.1's 11 profiles onto the 7 personas | `_shell.js:393-403` |
| Decision-first / progressive disclosure (3.1) | Home "My work" per site; exec-home dashboard; Site Actions hub | RETAIN + IMPROVE (independent card loading, page head) | `home-page.js`, w2-ux E-U03 |
| Context persistence (3.1) | Language (localStorage), Analytics URL filters (switch) | IMPROVE: server preference store — **consolidate with review.1 workspace-settings, do not build twice** | C19, C28 |
| Explainable data (3.1, 3.3) | pageHead (question/scope/window/freshness), trustLabel, kpiCard base line (switch) | RETAIN, extend adoption | `pageHead.js`, `uiPolicy.js:18-19` |
| Consistent states (3.1, 3.3) | 10-state badge vocabulary; pageStates on 1 page | IMPROVE: add `partial`, fix live-region role, adopt on legacy pages | `stateBadge.js`, N3 |
| Widget standard (3.3) | Composer presets carry a question; server validates unit/trend | IMPROVE: persist `question` + drill target in the widget definition | `services/dashboardWidgets.js:37-41` |
| Chart standard (3.4) | chartTheme, ChartTable, chart-a11y tests, no-growth ratchet | RETAIN ratchet; REPLACE dual axes/doughnuts page by page after human review | `ui-design-ratchet.test.js`, `CHART-INVENTORY.md` |
| Target IA, 6 families (Prompt 2; écarts annex) | Menu: Home, Site Overview, Helpdesk, Operations, Infrastructure, Reports, Executive, Admin + task groups | NEEDS-HUMAN (IA change is a committee decision); prepare a mapping doc only | `_shell.js:105-252` |
| Accessibility WCAG 2.2 AA (NFR) | Skip link, focus ring, keyboard menu, static floor (15 pages), chart a11y | IMPROVE (N1-N3, N7, N8); conformance claim = human | tests listed above |
| Performance < 3 s / p95 800 ms (NFR) | perf-baseline (DCL), load.js (API p95), budgets UNKNOWN | IMPROVE instrumentation; thresholds human | N5 |
| Adoption measures (6.2) | page_viewed per tier, dashboard_viewed, view counts page in System Logs | IMPROVE (events, non-shell pages, report tool) | N6 |
| Usability validation (Prompt 11) | Protocol T1-T8, SUS, sheets; scoring E-U01; T9-T12 E-V10 | RETAIN + add first-click / persona matrix | `docs/ops/USABILITY-TEST-PROTOCOL.md` |
| Legacy monolith pages (executive 599 KB, reports 8 960 l.) | Hot spots, ratchet-protected | IMPROVE incrementally; RETIRE only after usage evidence (C-09 telemetry) | PERF-BASELINE, `docs/ux/EXEC-PAGES-MATRIX.md` |

## (e) Goals for plan F

### /goal — SDP360 / F-UX-01 `<html lang>` follows the language on bilingual `data-lng` pages
- Problem: N1. French body read with an English voice on 11 pages, Home first.
- Change: one tiny helper (e.g. `public/lib/langMirror.js`, UMD, or a 3-line addition in each page's existing toggle) that sets `document.documentElement.lang` to `fr`/`en` whenever `body.lang-fr` is toggled; `home-page.js:9` and the 10 other pages. Do not change `_shell.js:525` semantics for English-body pages.
- Switch: none (defect fix; visible output unchanged).
- Tests: new `tests/html-lang-mirror.test.js` — every page that toggles `lang-fr` also sets `documentElement.lang` (static + vm run of the helper); extend `tests/e2e/t7-french-help.spec.js` to assert `lang="fr"` on home.html after the switch.
- Guardrails: English bodies keep `lang="en"`; no text changes. Size S · P1 · deps none · AGENT-DOABLE yes.

### /goal — SDP360 / F-UX-02 One `aria-current` per navigation landmark
- Problem: C9, N2, N10.
- Change: `_shell.js` renderNavItem — flat link and single-child collapse emit `aria-current="page"` when active; menu guarantees ≤ 1; optional URL-derived fallback (path + `?key=` + `#fragment`) for pages whose `data-current` is not a NAV id, behind `ui_nav_active_from_url` ('0' = today) added to `services/uiPolicy.js`.
- Tests: extend `tests/shell-navigation.test.js` (exactly one in `.shell-nav` for every NAV id × 5 role sets; zero when `current` empty); `tests/ui-policy*.test.js` for the new key; e2e `t8-keyboard-portfolio.spec.js` asserts the attribute.
- Guardrails: no change to which items are visible; breadcrumb/module tabs keep theirs (separate landmarks). Size S · P1 · deps none (review.1 implementation may supersede — compare when artifact arrives) · AGENT-DOABLE yes.

### /goal — SDP360 / F-UX-03 State vocabulary: `partial`, no live-region badges, French partial note
- Problem: C10, N3, N4.
- Change: `public/lib/stateBadge.js` — add `partial` ("Partial — some sources missing, total unknown", symbol distinct, never colour alone) and `available`/`ok` only if a consumer needs it; badges become static (no `role="status"`; keep `aria-label` via `role="img"` or visually-readable text); a separate `liveRegion` helper for page-level announcements. `dashboardRender.partialNote` uses the i18n dictionary + `fr-FR` dates. FR texts in `public/lib/i18n/dashboards.fr.js`.
- Switch: none for the role fix (defect); `partial` badge use sites behind no switch only where today's output was blank/ambiguous — otherwise reuse existing consumers unchanged.
- Tests: `tests/state-badge.test.js` (11 keys, no `role="status"` on badge, partial ≠ stale ≠ not-measured text and symbol), `tests/dashboard-render*.test.js` partial note FR.
- Guardrails: pinned texts of existing states stay byte-identical. Size S · P1 · deps W1-VIZ (merged) · AGENT-DOABLE yes.

### /goal — SDP360 / F-UX-04 Reflow 320 px and coordinator pages in the viewport matrix
- Problem: C15, N7.
- Change: `tests/e2e/v1-viewport-layout.spec.js` adds width 320 and pages home, reports, meetings, meeting, inspection, inspections, site-awareness, field/index; known failures recorded in a pinned allow-list (`tests/e2e/fixtures/reflow-known.json`) that may only shrink.
- Switch: none (tests). Tests: the spec itself + `tests/e2e-harness.test.js` manifest count.
- Guardrails: screenshots for a person, never auto-approved; no claim of WCAG conformance. Size S/M · P1 · deps none · AGENT-DOABLE yes.

### /goal — SDP360 / F-UX-05 Measure "first usable table" and API p95 per route
- Problem: C14, N5. The vision NFR cannot be evaluated.
- Change: `performance.mark('sdp:first-usable')` when the page's primary table/figure is rendered with data or with an explicit state (home, index, site-actions, dashboards, executive, reports, wan); `tests/e2e/fixtures/browser.js` reads the mark; `tools/test/perf-baseline.js` adds "first usable p50/p95" columns (budget `UNKNOWN — to be approved`); `tools/test/load.js` report groups p95 by route template. Optional `Server-Timing` header behind `ops_server_timing` ('0').
- Tests: `tests/perf-baseline.test.js` (new column, null ≠ 0, budget UNKNOWN), static test that each listed page emits the mark once.
- Guardrails: no threshold written anywhere; synthetic data labelled. Size M · P1 · deps none · AGENT-DOABLE yes (budgets = human, F-decision D1).

### /goal — SDP360 / F-UX-06 Adoption telemetry v2 (events + non-shell pages), privacy-first
- Problem: C27, N6. E09 cannot measure drill-through, export, action initiation or first click.
- Change: `POST /api/ux/event {kind, page, target}` with an allow-listed `kind` (`export`, `drill`, `action_open`, `action_done`, `first_click`), actor = `u<id>` + role tier only (same rules as `routes/pageUsage.js`); `page_viewed` from field PWA, it-review, site-report (session pages only; exec-view stays anonymous/none); `tools/pilot/adoption-report.js` (reach by tier, repeat visits, first-click-on-expected-page ratio per workspace, all denominators shown, empty = UNKNOWN).
- Switch: `ux_event_telemetry` ('0' = only today's page_viewed) in `reportConfig.DEFAULTS`.
- Tests: `tests/ux-events.smoke.test.js` (unknown kind 400, no PII fields stored, switch off = no row), `tests/adoption-report.test.js`.
- Guardrails: no names, e-mails, IPs, URLs with query values; retention per `docs/ops/RETENTION-INVENTORY.md`. Size M · P1 · deps none · AGENT-DOABLE yes (arming = human, D3).

### /goal — SDP360 / F-UX-07 Persona–task–screen matrix + first-click protocol (E06/E09 prep)
- Problem: C17, C18; E06 asks for a persona-task-screen matrix with first click.
- Change: `docs/ux/PERSONA-TASK-MATRIX.md` generated by `tools/agent/persona-matrix.js` from `_shell.js` WORKSPACES, `docs/ops/PERSONA-JOURNEYS.md`, the vision's 7 personas; columns for the review.1 11 profiles left `NEEDS-REVIEW.1-ARTIFACT`; `docs/ops/FIRST-CLICK-PROTOCOL.md` (expected first click per task, success = matches, time, "not run" = not measured) + `docs/ops/pilot/FIRST-CLICK-SHEET.csv`; scoring via E-U01 tool.
- Switch: none (docs/tools). Tests: `tests/persona-matrix.test.js` (every screen exists, every e2e journey mapped, `--check` stale detection).
- Guardrails: no persona content invented beyond sources; no results claimed. Size S · P1 · deps w2-ux E-U01, E-V10 · AGENT-DOABLE yes.

### /goal — SDP360 / F-UX-08 Import the review.1 profile engine and workspace settings as a reviewable lot
- Problem: C3, C4, C19, N9. The largest UX delta exists only on the user's test machine.
- Change: from the verified artifact, split into lots (profile model → home cards → nav order/density → workspace-settings page + preference store); renumber migrations after checking 072-077 usage; every profile behind `ui_workspace_profile` ('off' = today's WORKSPACES); precedence rule for multi-role users documented and tested; no effect on rights.
- Tests: profile resolution table for every role combination, "preference never grants" smoke, existing `shell-navigation`, `landing`, `a11y-static` stay green.
- Guardrails: never reconstruct missing files; compare with head WORKSPACES and F-UX-02 before merging. Size L · P1 · deps review.1 artifact + D2 · AGENT-DOABLE **no** (artifact + decision).

### /goal — SDP360 / F-UX-09 Home cards load and fail independently
- Problem: C5 (head side). One failed `/api/me/work` blanks every card; admins/executives without a site get an empty Home.
- Change: `home-page.js` renders per-block states with `StateBadge` (`error`, `not-measured`, `no-right`), retry per card; optional per-block endpoints only if the server already computes blocks separately (`/api/me/work?block=`); focus kept on the retried card.
- Switch: `ui_home_blocks` ('0' = today's single render).
- Tests: `tests/home-page.test.js` (vm, one block failing leaves others), smoke on the block param.
- Guardrails: null stays "not measured", never 0; coordinate with w2-ux E-U03 (page head on Home) and with F-UX-08 (review.1 home may replace this — do it only if D2 = keep head Home). Size M · P2 · deps E-U03 merge, D2 · AGENT-DOABLE yes (after D2).

### /goal — SDP360 / F-UX-10 Static a11y floor as a shrink-only ratchet on legacy pages
- Problem: N8, C22.
- Change: `tests/a11y-legacy-ratchet.test.js` runs the `a11y-static` checks on all 57 pages + field and pins today's violations per page (lang, viewport, skip link, main, labelled controls, alt, positive tabindex, inline handlers, status region); counts may only go down. Generated list in `docs/ux/A11Y-LEGACY.md`.
- Switch: none. Guardrails: no page edits in this goal. Size S · P2 · deps none · AGENT-DOABLE yes.

### /goal — SDP360 / F-UX-11 Legacy safety net: page states on slow or failed loads
- Problem: C13, N12. Helpdesk waits up to 180 s on `requests-raw` with no shared fallback.
- Change: load `pageStates.js` on index.html (loading → still loading after N s with "keep waiting / open summary" link → error with retry), assets, wan, meetings, inspections; index.html touched minimally (hot spot: one script tag + one call).
- Switch: none for the timeout message (defect: endless spinner); any new link behind none.
- Tests: `tests/page-states-adoption.test.js` (static: listed pages load it), extend `tests/e2e/f1`-style throttled run for index if feasible.
- Guardrails: never show a cached figure as current. Size M · P2 · deps none · AGENT-DOABLE yes.

### /goal — SDP360 / F-UX-12 Executive chart substitution, one page, behind a switch
- Problem: C20, C30. 11 dual axes and 3 doughnuts on executive.html contradict vision §3.4.
- Change: executive.html charts replaced by small multiples / sorted bars + ChartTable, behind `ui_exec_charts_v2` ('0'); lower the ratchet budget only when the switch is armed in the pilot profile.
- Tests: `tests/ui-design-ratchet.test.js`, `chart-a11y.test.js`, `report-figures-parity` for same numbers.
- Guardrails: same figures, same windows; screenshots for human review. Size M · P2 · deps D5 · AGENT-DOABLE yes (arming = human).

Priority order (top 5): F-UX-01, F-UX-02, F-UX-03, F-UX-05, F-UX-06 (then F-UX-04, F-UX-07, F-UX-08 when the artifact arrives).

## (f) Decisions that belong to people (owner roles)

| # | Decision | Owner role |
|---|---|---|
| D1 | Performance budgets (first usable table, API p95), reference network/device per site | Product owner + infrastructure lead, at pilot gate G2 |
| D2 | Adopt the review.1 profile engine / workspace settings vs extend head WORKSPACES; profile precedence for multi-role users | Product owner with UX lead (E06), after the artifact is supplied |
| D3 | Arming task-level telemetry; privacy notice; retention | Data protection officer / works-council contact + product owner |
| D4 | Pilot cohort, sites, adoption targets, first-click expected answers | Pilot sponsor + change & communication lead (E09, G2/G5) |
| D5 | Chart substitutions and executive "≤ 8 KPI above the fold" content | Executive sponsor + data/BI owner, after browser review |
| D6 | Target IA (6 families) vs current menu | Review committee (UX lead, process owners) |
| D7 | Any WCAG 2.2 AA conformance statement | Accessibility lead after a manual + assistive-technology audit |
| D8 | French terminology validation | Francophone business representative (gate 17, E-U05) |
| D9 | Supplying the review.1 artifact (files, manifest, migrations 078/079) | Owner of the test machine / release manager |
