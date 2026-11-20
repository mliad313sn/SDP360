# ADOPTION LOT A — "Say the truth, no dead ends" (evidence)

> **AI work, sandbox, synthetic data only.** Implemented by an AI agent from `docs/ux/adoption-review-2026-11-20/
> ADOPTION-REVIEW.md` §5–§6. Browser checks ran on a throwaway PostgreSQL database seeded with the e2e world +
> `tools/demo/seed-demo.js` (no production data, no outbound send). Nothing here is a usability result: the human
> sessions of `docs/ops/USABILITY-TEST-PROTOCOL.md` still decide. No push, no merge, no deployment.
> Decisions: `docs/ai-decisions/ADR-ADOPTION-LOTA-truth-no-dead-ends.md`.

Branch `feat/adoption-lotA` (worktree `/home/user/w/adoption-lotA`), base `944509ae`.

## Items

| # | Item (user list) | Status | Where | Ships |
|---|---|---|---|---|
| 1 | Never-synced source → "—" + "jamais synchronisé", neutral | done | `public/assets.html` (`maskNeverSynced`: every count / money tile of Inventory, Hygiene, Finance, Hardware, Investment when `last_sync` is null **and** the register is empty; charts and tables hidden; green `usd` class withdrawn), `public/lib/kpiCard.js` (a tile whose source never synced shows "—" + "Source never synced"), `public/index.html` (Helpdesk: no ticket ever loaded + no data date → "—" on all 8 tiles), `public/inspections.html` (a failed read is "not measured", not 0) | ON (defect) |
| 2 | Tracker month with no entry = "not entered", no red, no alert | done | `services/trackerMonthState.js` (rule = Home's empty-cell rule), registry reader `tracker.site` (score null → `tracker.site.red` cannot fire), dashboard tracker widget (row "not entered", rag NA, out of the fleet mean) | ON (defect) |
| 2b | Partially entered month | **unchanged — PROPOSED** below | — | — |
| 3 | One reporting week; picker defaults to the week due; dated labels | done | `public/lib/reportingWeek.js` (shared UMD; `reports-db.getISOWeek/getPreviousWeek` delegate), `public/reports.html` (second step back removed, badge "W45 (08–14 Nov) 2026 · report due"), Home (`W45 (08–14 nov.) 2026`), Helpdesk week options marked "in progress" / "report due", `/api/reports/current-week` adds `label_dated` | ON (defect) |
| 4 | Menu roles = route roles; refusals in the no-access wording | done | `_shell.js` (Activity Tracker → admin / tracker-admin / tracker-editor; Finance certification → admin / finance-viewer), page gates on `activity-tracker.html`, `integrations.html`, `finance.html`; `workspaceProfiles.js` tracker destination; Home tracker row unlinked for others; `no-access.html?reason=off` "Cette fonction n'est pas activée" for data-quality / workspace-settings pages when their switch is off; `errorText.js` French for raw "Forbidden" / "Not found" | ON (no widening: those accounts were already refused the data) |
| 5 | Site-less auditor: "aucun site dans votre périmètre", no create / import | done | `public/lib/siteScope.js`; `meetings.html`, `inspections.html` | ON (text). Read scope of audit-viewer **not widened** (human access decision, PROPOSED in review item 9) |
| 6 | Menu entry for the KPI policy builder | done | `_shell.js` "KPI policies / Politiques KPI" (Configure) for admin + kpi-committee; `kpi-builder.html` leaves the dead-end ratchet (`tools/agent/inventory.js`) | ON |
| 7 | "Retour" → "Votre avis" | done | `_shell.js`, `lib/feedback.js` | ON |
| 8 | page-view events from business roles | done | `services/businessGuard.js` (+ `/ux/page-view` only); exposes nothing — the route writes the caller's own `page_viewed` row and answers `{ok, logged}` | ON |
| 9 | Business users open Help; chip "Métier" | done | `auth.js` lets `help.html` through; Help menu entry for business roles; shell chip shows `Business / Métier` for business-only accounts | ON |
| 10 | Label unlabelled fields (inspection, meeting, report) | done | `<label for>` / aria-label: inspection 23 → 0, meeting 20 → 0, reports (coordinator part) 157 → 0 static (6 → 0 in the browser), meetings-issues 8 → 0, Helpdesk filters 5 → 0 | ON |
| 11 | French text for the daily coordinator / technician pages | done (static strings + the new scope wording) | new dictionaries `inspections`, `inspection-actions`, `meetings`, `meetings-actions`, `meetings-issues` (`public/lib/i18n/*.fr.js`), through the existing guarded boot — **inert until `ui_i18n_pages = '1'`** (Lot B turns it on). site-actions / meeting / inspection / reports already had theirs | behind the existing switch |
| 12a | `itsm-integrations-plan.html` readable by every account | done — **restricted to the admin tier** (ADR-ADOPTION-LOTA-01); not removed (the super_admin roadmap links to it) | `server.js` route | ON |
| 12b | Houndé SLA 60 % (site view) vs 50 % (Helpdesk ranking) | cause found and fixed — see below | `reports-db._computeSiteHelpdesk` (`closed_overdue`), `routes/siteAwareness.js` (`res_sla_pct`), `public/site-awareness.html` | ON (defect: doctrine) |
| 12c | Login limit counts successful sign-ins (mine behind one NAT IP) | **not changed** — documented below, PROPOSED to the Security owner | `services/loginGuard.js` (existing switch) | — |

Skipped from the user list: nothing. Out of scope on purpose: `public/project.html`, `public/portfolio.html`,
`services/governanceStore.js`, `routes/governance*.js` (portfolio Lot 1) and the policy-center files; portfolio
actuals display (portfolio lots).

### 12b — why the same week read 60 % and 50 %
- Site Awareness computed "Conformité SLA %" as `100 − overdue ÷ created` (all tickets of the week, open ones in the
  denominator). The Helpdesk ranking computes the KPI doctrine figure `(closed − closed & overdue) ÷ closed`
  (`public/lib/dashboard-shared.js slaRanking`, `docs/sop/SOP-kpi-sla.md`). Example week: 10 created, 8 closed,
  4 overdue (all closed) → 60 % vs 50 %.
- Fix: the site view now reads `res_sla_pct` = closed on time ÷ closed (null when nothing closed — never 0 / 100).
  Pinned by `tests/site-awareness-routes.smoke.test.js` ("Adoption Lot A (item 12)").
- Remaining difference, **PROPOSED to the KPI committee**: the Helpdesk ranking groups tickets by the free-form
  `request_records.site` field (spellings folded), the site view by the site's Zoho groups (`tech_group`). Both are
  defensible; one population should be chosen and written in the KPI definition.

### 12c — login limit (PROPOSED, not changed)
- Today the per-IP login limiter counts every sign-in (10 / 15 min / IP). A mine seen behind one NAT address can lock
  its own shift start. The switch already exists: `login_limit_failures_only` (`services/loginGuard.js`,
  `docs/ops/FLAG-REGISTER.md`, `docs/ops/pilot/PILOT-PROFILE.md`): with `'1'` only FAILED sign-ins count per
  address + login name (10 / 15 min, a success clears the pair; 50 failures / 15 min per address; the per-account
  failure throttle is forced on). Default stays `'0'`. **Decision owner: Security owner** — it is a security policy,
  not an engineering detail. Recommendation for the pilot sites behind NAT: turn it on together with the account
  throttle, and watch `login_failed` in System Logs for the first week.

### 2b — partially entered tracker month (PROPOSED to the KPI committee)
Today (unchanged): a month where SOME activities are entered is scored year-to-date like any month; the empty cells
of that month count as nothing done. Options for the committee:
1. keep as today (simple, can show red early in a month);
2. score only the activities that were entered for the month, flag the rest "not entered" (no colour from them);
3. withhold the site colour until a cut-off day of the following month (e.g. the 5th, same as the closed-month lock)
   and show "en cours de saisie" before it.
The engine rule lives in one place (`services/trackerMonthState.js` + `tracker-pptx` scorer); nothing changes until
the committee adopts one.

## Tests (targeted; the full suite is the orchestrator's — not re-run here)
`PG_ADMIN_URL=… NODE_OPTIONS="--require tools/test/blocking-stdio.js --require tests/_default-env.js --import tests/_pg-boot.mjs" node --test --test-force-exit <files>`

New: `adoption-lota-week` (5), `adoption-lota-nav-authz` (3 — walks 20 personas × every visible menu entry, both with
default switches and with the four page switches on), `adoption-lota-truth` (7), `adoption-lota-labels` (6).
Fail-before / pass-after shown for the nav walk (old `_shell.js`: 52 tracker refusals, 3/3 fail) and the label test
(5/6 fail before).
Changed: `dashboard-widget-truth` (+1; ITY June now "not entered"), `site-awareness-routes.smoke` (+1),
`integrations-plan-gate.smoke` (+1), `site-helpdesk`, `my-work`, `workspace-profiles`, `data-quality.smoke`,
`workspace-routes.smoke`, `i18n-coverage` (+10, five more translated pages), `authz-matrix-json` (business allow-list
+ page-view), `inventory-reachability` (dead-end ratchet 3 → 2).
Green runs: all of the above + `shell-navigation`, `shell-nav-r4`, `exec-nav-consolidated`, `a11y-static`,
`csp-no-inline-handlers-new-pages`, `tracker-roles-client`, `landing`, `kpi-card`, `alert-engine`, `metrics-registry`,
`report-analysis`, `ai-commentary`, `home-page-blocks`, `home-queue-page`, `my-work-route.smoke`, `first-usable`,
`page-head`, `send-weekly-report`, `html-lang-mirror`, `business-roles`, `business-only-boundary.smoke`,
`error-text-fr`, `site-window-readers`, `site-report-helpdesk-weekly`, `p09-adoption-kit`, `persona-matrix`,
`flag-register`, `switch-lots`, `traceability`, `metric-lineage`, `ui-design-ratchet`, `gate-dossiers`,
`readme-truth`, `agent-inventory`, `test-runner-guard`, `authz-route-matrix`, `authz-outcomes.smoke` (regenerated).
E2E journeys (Chromium): T1, T2, C1, R2, U3, U4, P09-A, P09-B, T7, UAT S1, S3, S4, S5, S6, S7, S8, demo journey.
`npx eslint .` clean.

## Generated artefacts regenerated
`docs/ops/authz-matrix.json`, `docs/ops/authz-outcomes.json`, `docs/agent-execution/INVENTORY*.{md,json}`, `README.md`
size block, `tests/.suite-manifest.json` (5570 → 5604), `docs/ops/METRIC-WIDGET-MAP.md`, `docs/ops/METRIC-LINEAGE.md`,
`docs/ops/SWITCH-LOTS.md`, `docs/agent-execution/P09-PAGE-INVENTORY.md`, `docs/ops/pilot/training/pmo.md`,
`docs/ux/CHART-INVENTORY.md`, `docs/agent-execution/gate-dossiers/**`.

### Authorization outcome rows that changed (`docs/ops/authz-outcomes.json`)
| Route | Before | After | Why |
|---|---|---|---|
| `POST /api/ux/page-view` | `UUUVVVVVVVVVVVVVVVFFVVV` | `UUUVVVVVVVVVVVVVVVVVVVV` | sbizA + gbiz now reach the handler (the probe's page id is invalid → 400 V); item 17 |

`docs/ops/authz-matrix.json`: the same route gains `site-business`, `group-business` and `business_allowed: true`
(business role route counts 16 → 17). No other route row changed. HTML-page behaviour changes (not in the API
snapshot): `/itsm-integrations-plan.html` admin tier only; `/data-quality.html`, `/workspace-settings.html` 302 to
the "not enabled" page while their switch is off; page gates on `activity-tracker.html` (admin | tracker-admin |
tracker-editor), `integrations.html` (admin), `finance.html` (admin | finance-viewer).

## Before / after (screenshots)
Before = the review's shots (`/home/user/adoption-out/shots/…`); after = `/home/user/adoption-out/lotA-after/…`.
1. Report week — before `shots/coordinator/reports-390-fr.png` (picker W44) → after `lotA-after/after-coordinator-reports-390-fr.png`
   (picker W45 "(08–14 Nov) 2026 · report due"; Home `W45 (08–14 nov.) 2026`; Helpdesk "W45 … · report due").
2. Asset finance never synced — before `shots/finance/assets-finance-1366-fr.png` ($0.00 green) → after
   `lotA-after/after-finance-assets_html_finance.png` ("—" everywhere, note "Parc jamais synchronisé").
3. PMO dead end — before `shots/pmo/activity-tracker-1366-fr.png` (raw "Forbidden") → after
   `lotA-after/after-pmo-activity_tracker_html.png` (no menu entry; direct URL → French no-access page naming the
   roles and the capability). Also `lotA-after/after-governance-meetings_html.png` (auditor: "No site in your scope",
   no create / import).

## What remains / human decisions now unblocked
- KPI committee: partial tracker month rule (2b); SLA population (12b).
- Security owner: `login_limit_failures_only` for NAT'ed sites (12c).
- Access-policy owner: audit-viewer read scope (review item 9) — the page now says the truth; the scope is unchanged.
- Pilot owner: `ui_i18n_pages` (the five new dictionaries are inert until it is on — Lot B).
