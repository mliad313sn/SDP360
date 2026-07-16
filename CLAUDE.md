# SDP Dashboard — Claude Memory File

This file is automatically read by Claude at the start of every session.
It records the project architecture, conventions, and all design decisions
made so far so that future sessions can pick up exactly where the last one ended.

---

## ⚡ Current state (as of 2026-07-16)

> **Sub-project 3C landed** (branch `feat/helpdesk-changes`): three user-requested
> additions, all **ours, on top of the authoritative model, none of them touching
> his score**. (1) A **Helpdesk & Changes panel** on the IT Review, between
> Infrastructure Inspection Assurance and Project pipeline — it rides in via an
> **optional `opts.extras`** on `buildReviewVals`, so a no-extras call still emits
> **exactly his 61 keys** and `tests/review-fidelity.test.js` keeps proving the
> port (a new test pins the added keys to a declared allowlist: `hdNote`+`hdRows`).
> (2) A **changes block on the site report** + coordinator email (plain words —
> no "RFC"/"CAB", asserted). (3) **IT Review in the Insights nav**, `target:'_blank'`
> (the page deliberately has no shell mount — a new tab is what makes that a
> non-issue). New: `reports-db.getSiteHelpdeskWindow` / `getSiteChangesWindow`
> (window-scoped, **group-scoped**) + the change classifier **ported verbatim**
> from `public/executive-report.html:5053-5090`.
> **Two windows in one panel, deliberately**: helpdesk follows the period selector;
> **changes are a fixed 90 days** ending at `ANCHOR` (the last change is 2026-07-03
> and the default WEEK window holds **0** changes — following the selector would
> render permanent dashes). `hdNote` states BOTH windows; the panel is thin
> (SML 4 · SMI 3 · HGO 2 · MGO 6 · SGO 2 = **17** over `2026-04-15..2026-07-14`),
> so raw counts sit next to the percentage rather than a 2-row rate standing alone.
> **Verified live in the browser** (both pages render, real numbers, `?period=week`
> vs `month` moves helpdesk 11→53 while changes stay 4/3/2/6/2).
> **Regression:** 713 tests, **627 pass / 16 fail — all 16 pre-existing on `main`**
> (the dev `.env` sets `REPORTS_BACKEND=postgres`, so route-smoke suites that boot
> `server.js` without `initPgReports()` fail; `inspection-blobs`' "delete removes
> the filesystem blobs" fails 4/4 on `main` in isolation on a leftover backup file).
> All three fidelity tests green; golden fingerprint green and **NOT regenerated**.
>
> ---

## ⚡ Prior state (as of 2026-07-13)

> **Reporting Suite sub-projects 1-2 landed** — sub-project 1 (Foundation, branch
> `feat/reporting-suite`): engine + config module + live `/site-report.html` + Automated
> Reports admin card. Sub-project 2 (Coordinator, branch `feat/reporting-coordinator`):
> the per-site data is now REAL (Foundation's binder silently read zeros — see the
> Known Pitfalls rows below), + the coordinator report composer + `POST /api/reports/send`
> (preview / dedup / safety gate) + the scheduled `tools/reports/send-reports.js` CLI.
> **Sub-project 3A landed** (branch `feat/score-sbdims`): the site score is now the
> user's authoritative `sbDims` model (6 dims × 0/1/2 ÷ 12, RAG 70/45) over a
> **3-month rolling window**, replacing the earlier INVENTED weighted model.
> **Scores WILL differ from any report sent before this** — that is the point, the
> old numbers were ours, not theirs. Pinned to the user's own data by
> `tests/score-fidelity.test.js` (their 5 sites, their window, their oracle).
> **Sub-project 3B-1 landed** (branch `feat/composite-engine`): the SECOND
> authoritative model — `composite()` / `eMetrics()` / `twoMoves()`, RAG **75/55** —
> is ported into `services/siteComposite.js` and fidelity-pinned to the author's
> own dataset (`tests/composite-fidelity.test.js`, his 5 sites, his oracle). It
> ships ALONGSIDE `sbDims`, and the two genuinely disagree — see the pitfall rows.
> Also: a site with **no data on the window now reads "non applicable"** instead of
> the fabricated RED 33 the two inverted dims used to produce.
> **Sub-project 3B-2a landed** (branch `feat/review-data`): the two halves the page
> needs, both fidelity-pinned. (1) `services/reviewData.js` — `loadReviewData(asOf)`
> denormalises our schema into the authoritative dashboard's `D` shape (5 joins,
> fleet-wide, sqlite + PG fork with the `to_char` cast on `md_issues.updated_at`);
> **proved field-for-field against `tests/fixtures/em-data.json`** read from
> `prod-snapshot/`. (2) `services/reviewDashboard.js` — the port of his `renderVals()`
> (15 panels, 61 keys, pure). Its acceptance test derives the oracle **by RUNNING HIS
> CODE** (`tests/review-oracle.js` compiles `docs/reference/it-review-dashboard.source.js`
> against the fixture) and asserts **all 61 keys deep-equal across all 72
> view × period × site combos**. Four approved deviations, each commented at its site:
> the `SITES` lookup is total (his 5 codes would throw on our 11-12 site fleet);
> `fleetScore`/`targetDepts` follow `codes.length` not a hardcoded 5; `groupRows`
> country groups narrow to present codes; option objects carry a declarative `key`
> replacing his dropped `pick` closure. All four are identical on his fixture.
> **Sub-project 3B-2b landed** (branch `feat/review-page`): **the live page** —
> `/it-review.html` serves the author's IT Review Dashboard from our databases.
> His 15 panels, his numbers, **none of his runtime**: no dc-runtime, no React,
> no Babel, no CDN, no remote fonts — **zero external requests** (verified in the
> browser: every request is same-origin). Three parts: (1) `public/it-review.js`
> — a **3-primitive renderer** (`{{ }}` / `<sc-for>` / `<sc-if>`), ~220 lines,
> vanilla, `require`-able by the tests AND browser-usable (see the pitfall row —
> it carries two invariants that each cost a review round); (2) three approved
> `server.js` additions and nothing else — the `_htmlCache` boot-load entry, the
> `GET /it-review.html` route (`site-report.html`'s precedent: `injectApiKey=false`,
> session via cookie), and `GET /api/reports/review-data` (whitelists all 4 of
> `view`/`period`/`site`/`asOf` — they reach the model; proved un-500-able live on
> path-traversal + SQLi-shaped input); (3) `public/it-review.html` — his 85 KB of
> markup carried across verbatim (219 bindings, 32 `<sc-for>`, 3 `<sc-if>`), his
> `<helmet>` CSS minus its 9 `@font-face` (artifact blobs we don't have; the stacks
> fall back to system faces). His `sc-raw-*` / `sc-camel-*` aliases become the real
> tags/attrs; the template lives in a `<script type="text/html">` so the HTML
> parser never touches his `<table>`/`<svg>` before the renderer sees it. **The 4
> `pick` closures became links** — the page is stateless, so changing a control
> navigates (a delegated handler merges the one changed param into the current
> query string, so switching view doesn't reset period + site).
> **Two disclosures the page MUST keep** (unexplained, both read as bugs): the
> score's window (programme start → as-of here, vs a **rolling 3-month window** on
> the emailed site reports — the two can legitimately differ, and neither is the
> report month), and that **`?asOf=` moves the scoreboard only** — `windows(period)`
> pins to `ANCHOR`, not `asOf` (`reviewDashboard.js:110`, his own line, ported for
> fidelity).
> **Deploy note:** `server.js` **and `it-review.html`** are server-code /
> `_htmlCache` surfaces — after the ZIP is applied, `pm2 stop` → `timeout /t 5` →
> `pm2 start` (**NOT `pm2 reload`** — see the EADDRINUSE crash-loop pitfall, where
> the orphan keeps serving the OLD `_htmlCache` and your deployed HTML looks
> "missing"). `it-review.js` is referenced as an external `<script src>` on
> purpose, so `injectAssetVersion` versions it (`?v=<APP_VERSION>`) and users need
> no Ctrl+F5 beyond the usual one.
> Sub-projects 4/5 (scheduling auto-send + the Finance Manager report) pending.
>
> **READ FIRST.** Branch `main`. **🏁 The SQLite→PostgreSQL migration is COMPLETE
> in prod: ALL 4 modules run on PostgreSQL** (`TRACKER_BACKEND` / `MEETINGS_BACKEND`
> / `INSPECTION_BACKEND` / `REPORTS_BACKEND` = `postgres` in prod `.env`, plus
> `PG_URL=postgres://sdp_app:…@localhost:5432/sdp_dashboard`). The PG cluster is the
> one the 4MyPeople installer manages (cohabitation audited: its destructive ops are
> scoped to fmp_v2/fmp_app; the postgres superuser password is the appliance-standard
> value from the installer's config.psd1 — treat it as 4MyPeople-owned). The sqlite
> `.db` files are **frozen archives** — rollback per module = remove the flag + pm2
> stop/start (post-flip writes stay in PG). Backups: `_sdp_admin.cmd` option 5 embeds
> a `pg_dump` (`tools/pg/dump-db.js`) in every restore point — 4MyPeople's own
> restore points cover fmp_v2 ONLY.
>
> **Prod ops now go through `_sdp_admin.cmd`** (4MyPeople-style menu at the app root):
> apply deploy ZIP / restart (stop-wait-start) / backup+restore points / health probe
> / diagnostics / PG check (C) / PG provisioning (P — blank postgres password = the
> standard appliance value auto-read from config.psd1) / pm2 crash-loop recovery (R).
> Deploy-marker discipline: the packager NO LONGER advances `.git/last-deployed` —
> run `tools\deploy\mark-deployed.cmd` on the dev box after each confirmed prod apply;
> the packager auto-deletes older `sdp-deploy_*.zip` so the repo root holds exactly one.
>
> **Key fixes this session (all deployed):** `survey_answers` had NO unique key → every
> sync re-inserted every row (70% dupes; deck pain-points showed "14 mentions" for 2
> respondents) — boot migration purges + `uq_sa_response_question`; slide-9 downtime/MTTR
> now use the `UDF:Incident Actual Start/Resolution Time` window (the typed Total
> Downtime UDF key had drifted + is unreliable); slide-8 has two donuts (By Type +
> "By Category" = UDF:Division); CHANGES-scope group presets now SEED populated
> (Operations incl. Infosec + ManageEngine per user direction — ERP excluded);
> Exec View made PG-ready (5 readers forked, `loadExecSummary` async — this had been
> silently breaking the strategic block since the tracker flip); **await-precedence
> pitfall**: a sync→async sweep wrote `await rdb.listSites().find(...)` in 11 places
> (method chained on the Promise) — always `(await f()).method()`; grep for
> `await \w+\.\w+\([^)]*\)\.` after any such sweep.
>
> **QA asset:** `prod-snapshot/` (gitignored) = full prod `data/` copy (2026-07-09) —
> reports/tracker/meetings/inspection DBs + blobs. Local PG 17 on :5432 mirrors prod
> (sdp_app/sdp_dashboard populated from it). Postgres superuser password = appliance
> standard, read from `%TEMP%\4MyPeople-Installer\config.psd1` at run time.
>
> **2026-07-13 (suite) — INSTALLEUR 4MyPeople-style LIVRE** : `SDP-Setup-<version>.exe`
> autonome (Node+pm2+PostgreSQL+Python embarques, zero reseau) — spec/plan dans
> docs/superpowers/, guide operateur docs/INSTALLER.md. Runtime committe dans
> tools/installer/ (Setup.bat menu, Install-SDP.ps1 7 etapes/4 modes/rollback auto,
> Manage-SDP.ps1 = L'implementation backup/restore/schedule unique — _sdp_admin.cmd
> 5/6/7 delegue), build dev-only dans tools/installer-build/ (cache gitignore).
> Carte admin "Scheduled Backups" (reports.html#admin, super_admin) -> 2 taches
> Task Scheduler via /api/admin/backup-schedule (services/backupSchedule.js, TDD).
> E2E prouve sur :3457 : fresh/upgrade/rollback-auto(exit 2)/downgrade-refuse.
> Pieges captures : robocopy /IS /IT /IM (fichiers meme taille+date sautes),
> 7zSD.sfx vient du LZMA SDK (plus dans 7z-extra), Read-Host -AsSecureString gele
> sur stdin redirige, python-embed exige ._pth import site decommente. INCIDENT
> recupere : le .env dev a ete perdu (fichiers racine supprimes pendant le build
> T10, cause externe non identifiee) — reconstruit depuis le .env prod (UNC),
> PG_URL re-adapte dev; git etait intact.
>
> **Open items:** (1) SSO Entra go-live — code complete + dormant, waiting on the
> user's app registration (see the 2026-07-08 section below); (2) scheduled/automatic
> pg_dump (Task Scheduler) — today it runs only when option 5 is used; (3) 12
> pre-existing PG test fixtures missing the `template` key (task chip filed);
> (4) backlog-theme keyword tuning; (5) repo never pushed to origin.

---

## ⚡ Prior state (as of 2026-07-08)

> **READ FIRST.** Branch `main`, tip `01c0811`+, **~46 commits ahead of the last
> confirmed prod deploy** (`7fb62d9`, Exec View v1). **NOTHING in this session
> is deployed yet.**
>
> **DEPLOY MODEL CHANGED (2026-07-08): ZIP package, no more `Z:` xcopy.** Run
> `_deploy.cmd` (now a wrapper for `tools/deploy/make-deploy-zip.ps1`) → builds
> `sdp-deploy_<sha>_<stamp>.zip` → user copies it to prod, extracts, runs the
> bundled `_apply_on_prod.cmd` (xcopies into `C:\Apps\SDP-Dashboard` + deletions)
> → then **`_pm2_restart_prod.cmd`** (pm2 stop → `timeout /t 5` → start — NOT
> `reload`; EADDRINUSE crash-loop pitfall). `render.py` is copy-only. Users need
> ONE **Ctrl+F5** after restart. Because this backlog touches `server.js` + many
> `_htmlCache`'d HTMLs, the restart is mandatory. The marker still drifts
> (background harness) — rebaseline `git rev-parse 7fb62d9 > .git/last-deployed`
> before packaging if it looks wrong.
>
> ### What landed (7 tracks, ~44 commits)
>
> | Track | Commits | Summary |
> |---|---|---|
> | **1 · SharePoint Exec View v1.1/v1.2** | `8bb2ce1`..`15168ef` (+`28ca533`) | MI-centric site panel (only sites with an active Major Incident or overdue backlog), on-page MI detail + SDP quick-links, report-month anchoring, **AI-summarized MI cards** (server-side, cached, degrades to non-AI text), active-MI query fix (exclude closed/resolved/cancelled — stale `pending_status` was leaking closed MIs), footer "Powered by…" removed. New `_pm2_restart_prod.cmd` + `_pm2_recover_prod.cmd`. |
> | **2 · Group IT Report (exec-pptx)** | `db8c100`..`7bea65c` | Slide-2 rebuilt to the "5. Operations: Summary" template (initials avatar, quadrant grid, title colours, light-blue zones); slide-3 Executive Overview compacted; **page number in a blue box**; **FRT SLA target = 80%** everywhere; Resolution-SLA 12-mo trend flat-100% bug fixed (`isResOverdue` in the monthly builder); channel chart trims leading no-data months; **deterministic TOP PAIN POINTS** from survey verbatims (dropped the Phase-5/LLM placeholder); **change charts inherit the tickets group scope** (stop Application-team leakage into the Ops deck); **backlog classified BY THEME** from ticket subjects (`_backlogThemes`, 7 keyword rules) + fixed a >100% "fresh share" denom bug. |
> | **3 · AI off + Quick-only** | `c5f64cd`, `50ea5f7` | **`AI_PROVIDER` default flipped `anthropic`→`off`** — `/api/ai/analyze` returns a clean 503, MI-summary regen skips. Deck builder is **Quick-only**: cloud "Analyze" buttons removed, "Analyze (Quick)" promoted to primary, `runAnalysis()` redirects to the offline engine, Audience selector hidden. |
> | **4 · Corrective-Action dashboards + exports** | `78664ea`, `8074b10`, `71d9fa7`, `b3c5db1` | `inspection-actions.html` + `meetings-actions.html` each got a **Chart.js analytics dashboard** (status/priority-or-dept donuts, ageing, by-site stacked, raised-vs-closed trend) + a **client-side PPTX export** (pptxgenjs 3.12.0, already vendored — 3-slide deck scoped to the active filter). Plus **full-table Excel export** (`services/tableExcel.js` + `GET /api/inspection/export.xlsx` + `GET /api/meetings/export.xlsx`, admin+, multi-sheet, SheetJS server-side). |
> | **5 · Inspection form** | `e6b19e0`, `1fa20d3`, `b3c5db1` | **Owner + Target Date now mandatory** on corrective actions (red highlight + Submit blocked). **Checklist "display by type"** domain filter (All / IT & Datacenter / Telecom & Comms / Safety & Physical / OT & Ops — pure display filter over the 17 categories). Fixed the **`/api/inspection/aggregate/export` 404** (route order: `/:id/export` was swallowing `/aggregate/export`). |
> | **6 · Microsoft Entra ID SSO** (dormant) | `e9dd863`..`40212de`, `f1c6c1f` | Full stack, **flag-gated on `SSO_MODE` (off/available/only), inert until set**. See the dedicated section below. |
> | **7 · Help manual** | `01c0811` | `help.html` bilingual (EN+FR) refreshed: inspection domain filter + mandatory fields + 11.6 Actions Register; meetings 12.6 Actions Register + 12.7 Insights; section 14 reframed Quick-first; new section 15 SharePoint Exec View. 30 headings, TOC anchors validated. |
>
> ### Microsoft Entra ID SSO — built this session, DORMANT
>
> Decisions (locked with the user): **SSO-only** end-state, **pre-provisioned
> only** (deny unknowns), **roles/sites stay in the dashboard DB**, one
> **break-glass** password super_admin, **profile auto-synced from Entra**,
> **hybrid `available` cutover window**. Everything is gated on `SSO_MODE` and
> ships completely inert (default `off`).
>
> - **Engine** `services/ssoEntra.js` — OIDC auth-code + PKCE, **zero new npm
>   deps** (axios + built-in `crypto` for RS256/JWKS verification). Enriches the
>   profile via Graph `/me` (jobTitle/officeLocation; needs `User.Read`).
>   `tests/sso-entra.test.js` (12, real RSA round-trip).
> - **DB** `reports-db.js` — `users` gains `email`, `entra_oid`, `first_name`,
>   `last_name`, `title`, `office` (idempotent ALTER). New `findUserByEntra`,
>   `linkUserEntra`, `createSessionForUser` (mints the SAME session token as
>   `login()`), `updateUserProfileFromEntra` (COALESCE — never wipes on blank),
>   `setUserEmail`. sqlite + pg forks. `tests/sso-db.test.js` (8).
> - **Routes** `server.js` — `SSO_MODE` (SSO_ENABLED=true → `only` back-compat).
>   `GET /api/auth/config` (public), `/api/auth/sso/login`, `/api/auth/sso/callback`
>   (state/nonce/PKCE in a 10-min in-memory map; findUser→link→profile-sync→mint
>   →httpOnly `report_token` cookie + localStorage handoff via a tiny HTML page).
>   All 3 exempted from the `/api/` gate. Password-login **break-glass gate fires
>   only in `only` mode**. `tests/sso-routes.smoke.test.js` (4, boots app SSO-off).
> - **UI** `login.html` (Microsoft button; hides password form per mode; friendly
>   `sso_error` messages), `reports.html` (Email field on Users + **✉ Map SSO
>   emails** bulk screen with `first.last@edv-ops.com` auto-suggest, accent-folded).
> - **Cutover** (`docs/SSO_ENTRA_SETUP.md`): register app + `email` claim +
>   `User.Read` → **map emails in bulk** → `SSO_MODE=available` (~1 wk, both
>   methods) → `SSO_MODE=only`. `.env`: `SSO_MODE`, `ENTRA_TENANT_ID/CLIENT_ID/
>   CLIENT_SECRET/REDIRECT_URI`, `SSO_BREAKGLASS_USER`, `SESSION_COOKIE_SECURE=1`.
> - **The user is the M365/Entra admin** and will do the app registration. **Not
>   yet done** as of this writing → SSO cannot be end-to-end tested until it is.
>   Total SSO suite: **24 tests green**.
>
> ### New files this session
>
> `services/ssoEntra.js`, `services/tableExcel.js`, `docs/SSO_ENTRA_SETUP.md`,
> `_pm2_restart_prod.cmd`, `_pm2_recover_prod.cmd`, tests: `sso-entra`, `sso-db`,
> `sso-routes.smoke`, `exec-active-mi-filter`, `exec-mi-summary`.
>
> ### Open items / next session
>
> 1. **Deploy the 30-file backlog** + `_pm2_restart_prod.cmd`; after restart run
>    ONE full requests sync (`POST /api/sync/trigger/requests?force=true`) so the
>    new `template` column backfills and **Major Incident #311587** (flagged via
>    SDP Template, not Request Type) appears.
> 2. **SSO go-live** — user does the Entra app registration, then: bulk-map
>    emails → `SSO_MODE=available` → verify own Microsoft sign-in → `only`.
>    Offered but not yet done: a **callback integration test** (stub the engine,
>    prove findUser→link→profile→session→cookie) + a **security-review pass**.
> 3. **help.html** — add a "Sign in with Microsoft" note to §2 once SSO is
>    `available`; optionally refresh Admin §7 for the new cards (Exec View
>    editorial, SSO email-mapping).
> 4. **Backlog-theme keyword tuning** — the `_backlogThemes` rules are a first
>    pass; tune against real June data if too much lands in "Other".
> 5. **Postgres**: the SSO reports-db pg forks exist but `entra_oid`/profile
>    columns must be added to the pg `users` schema before a reports.db PG cutover.
>
> ---

## ⚡ Prior state (as of 2026-06-22)

> **READ FIRST.** Branch `main`, tip `50d8717`. This session was a focused
> **Group IT Report PPTX (exec-pptx) overhaul** — 6 commits
> (`72f593c`..`50d8717`) bringing the dashboard's generated deck into
> pixel-alignment with the user's hand-finished **"Group IT May 2026 -
> Final-Operations.pptx"** template, fixing filter leakage, and making the
> AI commentary length audience-aware. The pipeline is unchanged in shape
> (`executive-report.html _buildExecPptxPayload` → POST `/api/reports/exec-pptx`
> → `services/reportPayload.js build()` → `python tools/exec-pptx/render.py`);
> all visual work lives in `render.py`, all data/scoping work in the browser
> builder + `build()`.
>
> **Deploy status**: NOT yet deployed by the user as of this writing. The
> 6 commits touch `tools/exec-pptx/render.py`, `public/executive-report.html`,
> `services/reportPayload.js`. `executive-report.html` is in `_htmlCache` and
> `reportPayload.js` is server code → after `_deploy.cmd`, do
> `pm2 stop` → `timeout /t 5` → `pm2 start` (NOT reload — EADDRINUSE pitfall).
> `render.py` is spawned fresh per export (copy-only, no reload needed).
> The user had already deployed `411cf2f` and earlier and confirmed a clean
> June 2026 export mid-session.
>
> ### What landed (6 commits)
>
> | Commit | Subject |
> |---|---|
> | `72f593c` | design: align slides 3-11 to May template (render.py restyle) |
> | `411cf2f` | feat: wire live payload to feed new template fields (slides 5/8/9/10/11) |
> | `9114a08` | fix: apply CHANGES GRP filter to change charts in export |
> | `9c6ae36` | fix: apply selected group + site filters across all helpdesk + change charts |
> | `c42604d` | feat: dimension AI commentary length by audience + footer auto-shrink |
> | `50d8717` | polish: audience-size slide-2 bullets + larger footer font |
>
> ### Track 1 — render.py restyle to match the May template (slides 3-11)
>
> Per-slide changes in `tools/exec-pptx/render.py` (the matplotlib + python-pptx
> generator). The May final was the **design** reference (data still comes
> from the dashboard — the user's directive: "stick to the site's calc logic"):
>
> - **Slide 3 (KPI Executive Overview)** — tile titles changed from light
>   gray to **bold NAVY** (`kpi_tile` label color); slide-3 footer band
>   enlarged (was the smallest at 0.55").
> - **Slide 4 (12-mo trend)** — `_draw_volume_trend`: grouped vertical
>   Inbound(navy `#1F3D5C`)/Closed(green `#2E8540`) bars + value labels on
>   top. `_draw_sla_trend`: Res.SLA green / FRT navy lines.
> - **Slide 5 (categories/channel)** — `_draw_categories`: horizontal
>   **grouped** current-vs-previous bars (needs `categories_prev`); the
>   channel area is now a **single line chart** (`_draw_channel_share_trend`),
>   the redundant horizontal channel bar was removed.
> - **Slide 7 (CSAT)** — `_draw_csat_donut`: bold-white % **on the slices**
>   (autopct, pctdistance 0.80) + legend below.
> - **Slide 8 (changes)** — `_draw_changes_donut`: bold-white % on slices
>   (Standard dark-navy, Major mid-blue, Emergency red); the yellow box is
>   now **data-driven** (was hardcoded CHG-254) + a **"→ Recent changes
>   include …"** glance line from `recent_changes`.
> - **Slide 9 (Major Incidents)** — **4 tiles** (Major / Resolved / Open /
>   MoM Change; P1/P2/downtime in the first tile's subtitle) + **single-column**
>   full-width incident cards with a description + bold **Action:** line
>   (run-level: "Action:" bold navy + recommendation italic). Was a 2×3 grid
>   with "Lessons:".
> - **Slide 10 (tracker roadmap)** — **5 pastel KPI tiles** (Green / Amber /
>   Red / Avg Score / Best Δ — pastel bg + colored top bar, NOT the
>   left-accent kpi_tile); **vertical** per-site bars (one stable colour per
>   site) + **vertical** stacked pillar bars; italic **"Source:"** footer
>   (no navy commentary band). Header subtitle adds "· N Operating Sites · M
>   Activities".
> - **Slide 11 (per-site)** — **4 pillar banners** (name + weight% + Δpp,
>   teal/orange/purple/gold) + rich **site cards** (code, name·activities,
>   score%, Δ pill, G/A/R light badges, ✓ positive line, ⚠ action line) +
>   **General Review** bullets + "Source:" footer. This is the
>   **tracker-pptx.js two-slide design** ported into render.py at 13.33×7.5.
> - **UTF-8 fix**: `render.py` now reads stdin via
>   `sys.stdin.buffer.read().decode('utf-8')` — was the Windows locale codec
>   (cp1252) → mojibake on accented site names (Houndé→HoundÃ©) + em-dashes.
>
> ### Track 2 — data wiring so the LIVE export populates the new fields
>
> render.py reads new fields with graceful fallbacks; the browser + `build()`
> now supply them:
> - **`executive-report.html` `_buildTrackerBlock`** enriched: `best_site`,
>   `best_delta_pp`, `total_activities`, `active_sites`, fleet `avg_delta_pp`,
>   per-site `positive`/`action` (via existing `_trkSiteCommentary`), per-pillar
>   `delta_pp` (cur vs prev fleet avg), `general_review` (via `_trkGeneralReview`).
>   Plus top-level `recent_changes` (from `chgInMonth` subjects).
> - **`services/reportPayload.js build()`**: emits `categories_prev` (from the
>   browser `categories[].previous` already present) and passes `recent_changes`
>   through. `_majorIncidents()` now computes `mi_resolved` / `mi_open` /
>   `mi_downtime_h` / `mi_prev_total` (prev-month count via an extra query) for
>   the slide-9 tiles, and already supplies per-record `detail` (description) +
>   `lessons`/`action`.
>
> ### Track 3 — filter scoping (the "Sunshine ERP leaked into Operations deck" bug)
>
> The export's change charts (donut, 6 tiles, recent-changes) were filtered
> by **month only** — they ignored CHANGES GRP entirely, so ERP/Apps changes
> leaked into the Operations deck. AND the helpdesk side was **hardcoded** to
> the Operations ticket preset, ignoring an explicit TICKETS GRP selection
> AND the site selector. Now `_buildExecPptxPayload`:
> - **Group (tickets)** = explicit `_activeGroups` if set, else
>   `_DEFAULT_GROUP_PRESETS.Operations` (keeps the Operations default but
>   honors a narrower selection). Applied to tickets, prev, 12-mo trend,
>   categories, channels, ageing, backlog, support-groups.
> - **Group (changes)** = explicit `_activeChangeGroups` if set, else
>   `CHANGE_GROUP_PRESETS.Operations` (consistent with tickets).
> - **Site** = the SAME `siteMatch()` the on-screen preview uses (`selSite`;
>   'all' = no filter) — applied across tickets + changes + ageing + trend.
> - **No change for the all/all default** — numbers identical; filters only
>   bite when the user narrows a group or site.
> - **STILL fleet-wide (by design, flagged):** Major Incidents (server
>   `_majorIncidents`, month+type only) and CSAT (survey-wide, not group/site
>   tagged). Open question for next session — see below.
>
> ### Track 4 — AI commentary length is now audience-aware + footers never overflow
>
> The audience selector (Executive CFO/CIO · Operational · Technical) set
> **tone** but each prompt field hardcoded sentence counts (helpdesk 5-7,
> csat 4-6, sla/change 2-3) that overrode the brevity → footers overflowed
> even in CFO/CIO mode. Now:
> - **`_AUDIENCE_LEN` + `_alen()`** in `executive-report.html` → per-audience
>   LENGTH BUDGET (Executive 1-2 short sentences / Operational 2-3 / Technical
>   4-6). `_audiencePreamble()` injects a **STRICT budget block** that overrides
>   any later count and notes the text renders in a narrow footer band.
> - Every footer-feeding field spec now substitutes `${_alen('section')}` /
>   `${_alen('csat')}` instead of a fixed count; the slide-2 narrative bullets
>   (progress/issues/nextperiod/actions) scale via `${_alen('gov')}`.
> - **Slide 2 IS audience-aware** — the governance prompt already prepends
>   `_audiencePreamble()`; verified. Its columns cap at 5 bullets / fixed box
>   so no overflow regardless of audience.
> - **`render.py _fit_footer_size(text, base=11.5)`** — safety net: short
>   (CFO/CIO) commentary renders LARGE (base 11.5, bands are 0.85" tall);
>   only long (Operational/Technical) commentary scales down (10 → 9 → 8.5)
>   to fit. Applied to all footer bands (slides 3-9 + 11b). Slide-9 footer band
>   enlarged 0.55"→0.85". Verified with a 527-char stress comment — fits.
>
> ### QA harness (dev-only, gitignored deploy)
>
> `tools/exec-pptx/_mk_qa_fixture.py` builds `fixtures/kpis-may-qa.json` —
> a **render.py-flat-shape** fixture (monthly_trend, monthly_channels,
> categories_prev, flat csat, mi resolved/open/mom/action, enriched tracker
> block) so render.py can be visually QA'd locally WITHOUT a 5-min live data
> fetch. Loop: edit render.py → `python tools/exec-pptx/render.py < fixtures/kpis-may-qa.json > out.pptx`
> → LibreOffice (`C:\Program Files\LibreOffice\program\soffice.exe`) → PDF →
> PyMuPDF → PNG → inspect. The dev box also has real **Office 365 PowerPoint**
> at `C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE` for
> faithful-render QA.
>
> ### Open items / next improvements (for the following session)
>
> 1. **Major Incidents scoping (slide 9)** — ✅ DONE: the browser sends the
>    selected site in `payload.filters.site`; `build()` forwards it as
>    `dbFilters.site`; `_majorIncidents` filters rows with the SAME fuzzy
>    `siteMatch` logic the rest of the deck uses ('all' = fleet-wide). Group
>    filtering left OFF by design (MIs are cross-cutting). The main query
>    `LIMIT` lifts 10→50 only when a site is selected so post-filter rows
>    aren't truncated; prev-month MoM count is site-scoped too.
> 2. **CSAT scoping (slide 7)** — survey-wide; can't filter by group/site
>    until survey responses are reliably tagged with site/group. Needs a
>    survey-instrument change (add a site question) or a mapping.
> 3. **Pain-points / Voice clustering** — slide-7 "TOP PAIN POINTS" still
>    shows a "Voice clustering pending (Phase 5)" placeholder; `/api/survey/voice`
>    returns 401. LLM verbatim clustering is the unfinished Phase 5.
> 4. **Verify on live** that `categories_prev` (slide 5 grouped Apr-vs-current
>    bars) and `monthly_channels` (slide 5 channel line) actually populate from
>    the browser payload — they were validated against the QA fixture, not yet
>    against a real export.
> 5. **No golden test for the exec-pptx deck** — the `tests/pptx-monthly-golden`
>    fingerprint covers the weekly/monthly report decks, NOT `render.py`.
>    Consider a fingerprint test for the 11-slide Group IT Report.
> 6. **Slide 2 narrative columns** — ✅ DONE (commit after `2a57c29`): the
>    Operations Summary editor now has Progress / Issues / Activities
>    textareas (os-progress / os-issues / os-activities, persisted per month).
>    They override the slide-2 columns; blank = falls back to the AI commentary
>    (render.py `_section_bullets` reads `_os.<key>` first, then `commentary`).
>    Also verified live: slide-5 `categories_prev` (Jun-vs-May grouped bars)
>    + `monthly_channels` (channel line) populate from the browser payload.
> 7. **Deploy the cumulative commits** and confirm a fresh Analyze→Export in
>    each audience renders correctly end-to-end.
>
> ### Sync gotcha — closed Changes weren't re-synced after post-closure edits
>
> Diagnosed from a Major Incident (#289097) whose RCA/CA/PIR/LL showed RED
> (MISSING) on the live register although they were filled in Zoho. Findings:
> - **Major Incidents base rows**: the requests filter now **always upserts
>   every Major-Incident base row** (`_isMajorIncident`, ≈16 rows) so
>   status/resolution/priority stay fresh without trusting Last Updated Time.
> - **Major-Incident UDF (RCA/CA/PIR/LL) — real bug, fixed 2026-06-22**: the
>   register UDFs were sourced from a SEPARATE Zoho Analytics report
>   **view 790842**, which had gone STALE — the `POST /api/admin/refresh-major-incident-udfs`
>   diagnostic showed it returned only **12 rows with udfsExtracted=0** (the UDF
>   fields were re-created in SDP AFTER the report's columns were mapped, so it
>   returned them empty for recent incidents — e.g. #289097 showed RCA/CA/PIR/LL
>   red despite being filled in SDP). Meanwhile the base **REQUEST_TABLE view
>   002201 NOW returns all UDF columns** (203-col schema snapshot; a manual
>   Request export confirmed #289097's UDF filled there). **Fix**: source the MI
>   UDF straight from the base 002201 rows we already fetch (`extractUdf` over
>   `allRows.filter(_isMajorIncident)`), 790842 kept only as a fallback. Also
>   `extractUdf` now keeps **non-empty values only** (no 100-null bloat per
>   request; neither path can clobber good data with blanks). Needs deploy +
>   one requests sync to repopulate. **Diagnostic endpoint to reuse**:
>   `POST /api/admin/refresh-major-incident-udfs` returns rowsFetched /
>   udfsExtracted / dbUpdated / dbUnmatched. **Rule**: prefer sourcing UDF from
>   the table that actually owns the record over a separate Analytics report —
>   reports drift when custom fields are recreated.
> - **Changes had a real gap (fixed)**: the Zoho Change view exposes NO
>   "Last Updated Time" column (`EXPECTED_CHANGE_COLS`), so the old incremental
>   filter (new OR open OR recently-completed) NEVER re-pulled a change edited
>   AFTER it closed (RCA / Change Closure Code / UDF filled during the
>   post-implementation review — the normal workflow). Fix: **upsert ALL change
>   rows every sync** (`zoho-sync.js` change_cab) — the set is small (~hundreds),
>   so a full upsert is cheap and guarantees post-closure edits propagate.
>   **Rule**: a dataset with no modified-time signal can't be synced
>   incrementally on edits — either add a modified-time column or full-upsert it.

---

## ⚡ Prior state (as of 2026-06-05)

> **READ FIRST.** Branch `claude/busy-kirch-2a4176` is now **~273 commits
> ahead of origin** (still NOT pushed). Tip: `d86b382` (data evolution
> strategy doc). This session shipped **8 commits** across three
> tracks: (1) Activity Tracker drill-down + new PPTX slide 11b,
> (2) browser asset caching evolved from no-cache → tiered → canonical
> URL versioning pattern (webpack/vite style — zero RTT + zero stale
> for all modules), (3) two standalone reference docs for handing off
> data architecture + evolution planning to architects/future sessions.
>
> **Deployment status**: `_deploy.cmd` is staged with **6 prod-facing
> files** (server.js + CLAUDE.md + 4 client files from the tracker
> drill-down) covering commits `adfa33d`..`a340b74`. Two later commits
> (`be75f5e`, `d86b382`) are docs-only — they sit in `docs/` which is
> in the post-commit hook's `SKIP_PREFIXES`, so they're in git but NOT
> in the deploy script. User has NOT yet run `_deploy.cmd` — pending
> action.
>
> **Pending user actions after this session**:
>
> 1. Run `_deploy.cmd` from cmd.exe in the worktree → propagates 6
>    files to `Z:\`.
> 2. On the prod server: `pm2 reload endeavour-dashboard --update-env`.
>    The `--update-env` flag matters because nothing new env-wise was
>    added but the server.js + boot-cached HTMLs need a fresh start
>    to inject the new `APP_VERSION` at boot.
> 3. **Once on prod, every user (including Mohamed) needs ONE Ctrl+F5
>    on any dashboard page** to flush their existing browser cache. The
>    old HTML they have cached references unversioned asset URLs;
>    after Ctrl+F5 they receive the new HTML with `?v=<APP_VERSION>`
>    references and from that point onwards the cache pattern handles
>    everything automatically — NO future Ctrl+F5 needed, ever.
> 4. Verify in Chrome DevTools Network tab that `App.jsx` and
>    `dashboard-shared.js` arrive with `?v=...` in the URL and
>    `Cache-Control: public, max-age=31536000, immutable` in the
>    response headers.
>
> **User test result during the session**: Mohamed (super_admin)
> confirmed at the end of the session that everything works on his
> end with the URL-versioning change in place. The browser cache
> was confirmed as the root cause of his earlier "tracker inputs
> revert to null on refresh" report — a stale `App.jsx` running an
> outdated `D.inputs` schema. Fix is structural, not just patched.
>
> ### What landed (8 commits, chronological)
>
> | Commit | Subject | Files |
> |---|---|---|
> | `adfa33d` | feat(activity-tracker): drill-down per pillar / per site + PPTX slide 11b | 5 files (App.jsx, styles.css, reportPayload.js, render.py, CLAUDE.md) |
> | `34141a9` | fix(server): force conditional revalidation on .jsx + active-dev folders | server.js, CLAUDE.md |
> | `c81d62f` | fix(server): tiered cache policy — Tier A no-cache + Tier B 5-min cache | server.js, CLAUDE.md |
> | `429bcf6` | docs(claude.md): codify browser-side cache tier policy as coding principle | CLAUDE.md |
> | `0d1eabf` | docs(claude.md): fix stale line number in cache-policy verification tip | CLAUDE.md |
> | `a340b74` | feat(server): URL-versioned assets (?v=APP_VERSION) — zero RTT + zero stale | server.js, CLAUDE.md (replaces tier policy as primary; tier system kept as fallback) |
> | `be75f5e` | docs: standalone DATA_ARCHITECTURE.md reference for report builders | docs/DATA_ARCHITECTURE.md (1051 lines, NEW) |
> | `d86b382` | docs: data evolution strategy + migration difficulty matrix | docs/DATA_EVOLUTION_STRATEGY.md (491 lines, NEW) |
>
> ### Track 1 — Activity Tracker drill-down (commit `adfa33d`)
>
> Closes the user feedback "can we see progress other months per pillar
> of sites?". Single-surface design with PPTX echo — no duplicate
> dashboard, no new top-level tab.
>
> **Browser** — Dashboard tab now has clickable rows:
> - Click any **Pillar Health** row → inline 6-month fleet-average line
>   chart slides open below the row. Click again to collapse.
> - Click any **Site Leaderboard** row → inline 6-month per-site score
>   line chart slides open below the row.
> - Single open per panel; `▾`/`▴` indicator, hover affordance,
>   slide-in animation 220 ms.
> - Trend window = 6 months ending at the currently-selected period,
>   rolling back across year boundaries.
> - Computed client-side via `TR.ps2(D, site, pillar, y, m)` and
>   `TR.ss(D, site, y, m).avg` — NO extra API call.
>
> **Server payload** — `services/reportPayload.js _tracker()` returns
> a new `trends: { months, fleet[], pillars{name:[]}, sites{code:[]} }`
> block (6-month window). Pillar trend aggregates `{g,a,r}` counts
> across active sites per period and converts to a score at the end —
> faithful to the engine.js `ps2` rollup semantics at a single point
> in time. Sites with zero active activities for a period contribute
> `null` (skipped, not zeroed).
>
> **PPTX** — new **Slide 11b "Pillar Trends"** (conditional —
> only emitted when `K['tracker']['trends']` is populated; empty trends
> → slide skipped, deck stays coherent at 11 pages). 2×2 grid of mini
> matplotlib line charts (one per pillar) on 6.20" × 2.40" cards each,
> with RAG-threshold reference bands at 5% alpha, per-point %
> labels, stable pillar→colour map (Network blue · Biz Partner teal ·
> Risk purple · People orange), and an auto-synthesised "improving /
> declining / stable" commentary at the bottom (no AI dependency).
>
> ### Track 2 — Browser cache strategy (5 commits, evolved during the session)
>
> The session uncovered a long-latent bug pattern: Mohamed (super_admin)
> reported tracker Input values "disappearing on refresh". Root cause
> was a stale browser-cached `App.jsx` running a `D.inputs` shape that
> no longer matched the server's `loadTracker` contract → saves landed
> OK in the DB but under keys that no longer lined up with current
> activity ordering. Server log showed `[Tracker] save ok user=mohamed`
> with the correct user, but next load returned `null` for the cells
> the user thought they'd edited.
>
> The fix evolved across the session through user-driven Q&A:
>
> 1. **First attempt** (`34141a9`) — `.jsx` files + `/activity-tracker/`
>    served with `Cache-Control: no-cache, must-revalidate`. Solves
>    the bug but pays 1 RTT per asset per page load.
>
> 2. **Tiered policy** (`c81d62f`) — extended to include Tier B for
>    `/lib/` (5-min cache) and Tier C (default 1-day). User concern
>    was "does this break cache for the other sites?" — the tier
>    system preserves cache for Helpdesk / Reports / Executive / etc.
>
> 3. **Mohamed's clarifying question** drove a re-frame: "is it
>    possible to have a solution that doesn't interfere with cache
>    AT ALL, like other websites do?" — this triggered Path D, the
>    canonical URL versioning pattern.
>
> 4. **URL versioning** (`a340b74`) — the final, canonical solution:
>    - At server boot, compute `APP_VERSION = git rev-parse --short HEAD`
>      (fallback: `t<epoch-ms>`).
>    - `injectAssetVersion(html)` rewrites every local `<script src>`
>      and `<link href rel=stylesheet|preload|prefetch|modulepreload>`
>      to append `?v=<APP_VERSION>`. CDN URLs (Chart.js, React, Babel,
>      unpkg), data: URIs, hash anchors, and `<link rel=icon>` favicons
>      are skipped.
>    - `loadHtml()` runs `injectAssetVersion` at boot when caching
>      HTMLs in `_htmlCache`.
>    - `activity-tracker.html` + `help.html` moved out of
>      `express.static` into dedicated `sendHtmlPage` route handlers
>      so the injection applies (the path-scoped CSP override at
>      `server.js:182` still fires — matches by `req.path`).
>    - `express.static setHeaders`: if `req.query.v` is present →
>      serve with `Cache-Control: public, max-age=31536000, immutable`.
>      Otherwise the Tier A/B/C safety net kicks in as fallback.
>
>    Result: HTML is no-cache (always fresh), assets are cached
>    forever AND auto-invalidate on every deploy (URL changes).
>    Zero RTT for cached pages, zero stale risk, zero need for
>    Ctrl+F5 in normal use. Same approach webpack / vite / Next.js
>    use in production.
>
> **CLAUDE.md** — new top-level section `## Coding Principles —
> Browser-side asset caching` documents the pattern, the decision
> flow for adding new HTMLs or assets, what gets injected vs not,
> the anti-patterns to avoid, and verification recipes via Chrome
> DevTools. Look for `### When adding a new HTML page` for the
> step-by-step.
>
> ### Track 3 — Documentation (commits `be75f5e`, `d86b382`)
>
> Two standalone reference docs created at the end of the session,
> both excluded from `_deploy.cmd` (`docs/` prefix is in `SKIP_PREFIXES`).
>
> **`docs/DATA_ARCHITECTURE.md`** (1051 lines) — comprehensive schema
> reference for ALL 4 databases. Covers:
> - Every table with full `CREATE TABLE` definition, column types,
>   meanings, indices.
> - UDF field-name variants for Major Incidents (RCA / CA / PIR / LL).
> - Per-module `SITE_MAP` conversion tables (with the canonical trap:
>   Hounde is `MGO` in tracker, `HGO` in inspection, `HGO` in Risk
>   Register, but Kalana is `KLN` in tracker and `KGO` in inspection).
> - Cross-DB linkage map listing every soft FK with applicative
>   validation status.
> - Zoho external sources + field mappings.
> - 6 ready-to-copy SQL query patterns for typical reports
>   (SLA compliance with ITSM denominators, Major Incident UDFs via
>   `json_extract`, Change Success Rate, tracker fleet score,
>   inspection rollups, meetings escalations).
> - File-path quick reference and a list of "Things NOT to assume"
>   (NULL `impact`, stale subjects, inconsistent codes, denominator
>   doctrine).
> - Hand this to any new agent / contractor / engineer building a
>   report — they should be productive without reading source code.
>
> **`docs/DATA_EVOLUTION_STRATEGY.md`** (491 lines) — discussion draft
> for the IT Director / architect on where the 4-SQLite-DB shape will
> hit walls. Covers:
> - Quantitative audit of current state (sizes, growth projections,
>   concurrency reality).
> - 10 initial assumptions inferred from the code (single-host,
>   one-DB-per-module, inline base64 blobs, idempotent ALTER TABLE,
>   etc.).
> - 6 pressure points expected in next 2-3 years (Node `_rawCache`
>   OOM, inspection photos disk pressure, cross-DB join cost,
>   `request_records` partitioning, schema drift between modules,
>   no failover).
> - **Three evolution paths**:
>   - Path A — incremental SQLite (2-3 weeks, +5 years headroom)
>   - Path B — Postgres for hot data + SQLite for cold modules
>     (6-8 weeks)
>   - Path C — full Postgres unification (10-14 weeks)
> - Per-module migration difficulty matrix:
>   - tracker / RR aliases / group presets → 🟢 EASY (1-3 days each)
>   - meetings → 🟡 MEDIUM (5-7 days)
>   - inspection (because of photos) → 🟠 MEDIUM-HARD (7-10 days)
>   - reports.db auth → 🟡 MEDIUM (5-7 days, blocking — do FIRST)
>   - reports.db reports/KPIs → 🟡 MEDIUM (5-7 days)
>   - Zoho-synced data + hot read path → 🔴 HARD (15-20 days)
> - Recommended sequencing in 8 phases (each deployable independently)
>   + target architecture diagram + decision triggers + per-future-
>   module guidance (CMDB / KB / vendor SLAs / etc.).
> - **Recommendation**: Path A this quarter (mandatory), plan Path B
>   for next year, defer Path C until B is limiting.
> - Marked "discussion draft, NOT a commitment to ship anything" — the
>   decision belongs to the IT Director.
>
> ### Open items / suggestions for the next session
>
> 1. **Apply Path A quick-wins** (from `DATA_EVOLUTION_STRATEGY.md` §11):
>    - Add DB-size logging at boot (zero risk, instant value).
>    - Stop preloading `_rawCache` (highest immediate risk).
>    - Move inspection photos to filesystem blobs (~3 days work,
>      80% inspection.db size cut).
>    - Single canonical sites table (drop 4 duplicated `SITE_MAP` JS
>      maps).
> 2. **Push the branch to origin** — `git push -u origin claude/busy-kirch-2a4176`
>    once the deploy is verified working. Branch is now ~273 commits
>    ahead, never pushed. Code review on GitHub would benefit any
>    future architectural discussion.
> 3. **Phase 4 cleanup** (the only remaining task from earlier sessions
>    that's still flagged pending): delete old `/api/data/*` proxy code
>    that's superseded by the DB-backed `/api/exec/*` endpoints. Not
>    user-facing, just dead code in `server.js`.
> 4. **CLAUDE.md is becoming long** (~3000 lines now). Eventually
>    consider extracting the per-module deep-dives into separate files
>    under `docs/modules/` and keeping CLAUDE.md as a top-level index +
>    Current State + Known Pitfalls. Not urgent.

---

## ⚡ Prior state (as of 2026-06-04)

> Branch `claude/busy-kirch-2a4176` is now **~265 commits
> ahead of origin** (still NOT pushed). Tip: `61a0c18` (slide 7 CSAT —
> full payload mapping + dynamic NPS tile). This session was a 25-commit
> sweep of the **executive PPTX pipeline** (`📋 Group IT Report`) and
> related Group Presets + AI Analyze infrastructure. All 11 slides of
> the Group IT Report are now data-driven and free of April-template
> hardcoded text. Most user-facing fixes:
>
> 1. **Group Presets** moved from localStorage-only to DB-backed (new
>    `dashboard_preset_groups` table, separate scopes for tickets +
>    changes, modal-managed). CHANGES GRP dropdown rebuilt to match
>    TICKETS GRP shape (Ops · Apps · All · Clear toolbar + Configure
>    footer).
> 2. **AI Analyze button** re-activated (was disabled with 🔒). Output
>    flows into slide 2 IT Governance commentary. Auto-fallback to the
>    deterministic "Quick" engine when cloud AI is unreachable.
>    Audience selector (Executive CFO/CIO default · Operational · Technical)
>    persisted in localStorage. Wording neutralised — labels are just
>    "Analyze" and "Analyze (Quick)" instead of "(AI)" / "(Lite)".
> 3. **Major Incident priority + UDF** resolution made variant-tolerant
>    and shared across all 3 dashboards (executive-report, executive,
>    analytics). New shared helpers in `public/lib/dashboard-shared.js`.
>    Server-side `getMajorIncidentsHistory()` now ships a canonical
>    `P-Label` field that the browser trusts first.
> 4. **PPTX exec-pptx pipeline** — 11 slides, all data-driven now. No
>    more "Apr '26: 1,465 tickets... Hounde power outage..." hardcoded
>    text anywhere. Slides 4 charts wired (volume_trend + sla_trend).
>    Slide 5 pie → bar chart (label overlap fixed) + new 12-month
>    Email vs Web Form share inset. Slides 10/11 wired to the Activity
>    Tracker (`K['tracker']` snapshot). Slide 9 incidents reorganised
>    into 2-column grid to stop drifting off the bottom.
> 5. **FCR Rate tile dropped** from slide 3 — the metric is computed
>    from CSAT survey responses which rarely match the helpdesk filter,
>    so the tile was almost always misleadingly red (0%). Row 2 now
>    shows just FRT SLA + AVG RESOLUTION.
>
> Specific data-flow conventions worth keeping in mind for any future
> exec-pptx work:
>
> ### Major Incidents — strict "created in month" (2026-06-04)
>
> `services/reportPayload.js _majorIncidents()` SQL now filters
> strictly by `strftime('%Y-%m', created_time) = ?` (was `created_time
> = ? OR resolved_time = ?`). Mixing the two let prior-month carry-
> overs into the current month's deck (e.g. "Incident 3rd and 6th
> February 2026" resolved 2026-05-19 was showing in the May deck and
> inflating the P2 count from 3 → 4). The tile label says "Created in
> May" so the data must match the label. Browser-side `incMonth`
> filter in `executive-report.html` already used `created_time`, so
> the server, the browser, the dashboard, and the PPTX now all reconcile.
>
> ### `KEEP_SERVER_WHEN_BROWSER_IS_ZERO` pattern (2026-06-04)
>
> In `services/reportPayload.js` build(), some KPI fields where 0 from
> the browser is almost always a filter bug (not a real reading) keep
> the SERVER's value when browser sent 0. Set in
> `KEEP_SERVER_WHEN_BROWSER_IS_ZERO`:
>
>   total · closed · changes_total · open_backlog · mi_total ·
>   fcr_rate · support_groups
>
> Plus the nested `changes` block (`changes.total`, `changes.emergency`)
> follows the same rule per sub-field. CSAT block uses an explicit
> `_take(key, browserVal)` helper that applies the same logic for
> `csat_satisfied`/`neutral`/`dissatisfied`/`no_rating`/`total_responses`/
> `avg_score`/`pct`/`nps_proxy`.
>
> The trade-off: this masks a legitimately 0 reading (e.g. a month
> with truly zero major incidents). The opposite trade-off (browser
> always wins) was worse — users reporting "CHANGES = 0" on the PPTX
> because their CHANGES GRP filter was empty (per the seed in
> `services/groupPresets.js`) was the most-frequent complaint.
> Percentage KPIs (closure_rate, sla_compliance, etc.) trust the
> browser unconditionally because 0% IS a legitimate value worth
> reporting on a five-alarm-fire dashboard.
>
> ### MoM delta defaults: None, not 0 (2026-06-04)
>
> `tools/exec-pptx/render.py` `_DEFAULTS` dict now sets all `*_delta_*`
> fields to `None` instead of `0.0`. The render helpers (`_delta_str`,
> `_cover_delta`) format `None` as "— vs Apr" / "— MoM" instead of a
> misleading "0.0% vs Apr". Effect: when the browser doesn't compute
> a previous-period reading (most of the new MoM fields are placeholder
> `null` because they need a snapshot we don't preload), the deck reads
> honestly instead of inventing a "flat MoM".
>
> ### CSAT field-name convention (2026-06-04)
>
> The naming convention across the 3 layers is finally aligned:
>
> | Layer | Field names |
> |---|---|
> | Browser (`_buildExecPptxPayload`) | `csat:{satisfied, neutral, dissatisfied, no_rating, total_responses, avg_score, avg_rating, csat_pct, nps, promoters, passives, detractors}` |
> | Server (`services/reportPayload.js`) | maps to top-level `csat_satisfied`, `csat_neutral`, `csat_dissatisfied`, `csat_no_rating`, `csat_total_responses`, `csat_avg_score`, `csat_pct`, `nps_proxy` |
> | Render (`tools/exec-pptx/render.py`) | reads top-level `csat_*` keys |
>
> Browser ships both CSAT-style (4-5 / 3 / 1-2 = satisfied/neutral/
> dissatisfied) and NPS-style (9-10 / 7-8 / 0-6 = promoters/passives/
> detractors) breakdowns so render.py can fall through gracefully on
> tenants whose survey instrument only classifies one of the two.
> Avg score is `avgRating × 20` (5-scale → 100% expression).
>
> Slide 7 right tile is **NPS-first** when `nps_proxy ≠ 0`, falls back
> to AVG SCORE only when NPS truly absent. CSAT donut chart has a
> fallback path that derives sat/dis counts from `csat_pct ×
> total_responses` when explicit counts are zero — so the chart is
> never empty when there's a known percentage.
>
> ### Group Presets DB schema (2026-06-04)
>
> New table `dashboard_preset_groups` in reports.db (created lazily on
> first hit). Schema:
>
> ```sql
> CREATE TABLE dashboard_preset_groups (
>   scope         TEXT NOT NULL,        -- 'tickets' or 'changes'
>   preset_name   TEXT NOT NULL,        -- Operations/Application/Cybersecurity/ITSM/Other
>   group_name    TEXT NOT NULL,
>   display_order INTEGER DEFAULT 0,
>   updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
>   updated_by    TEXT,
>   PRIMARY KEY (scope, preset_name, group_name)
> );
> ```
>
> API at `/api/dashboard/presets?scope=tickets|changes` (GET public,
> PUT admin+). Auto-discovered groups (in `request_records.tech_group`
> or `change_records.group_name` last 12 months but not yet assigned)
> surface in the modal under "Pending Discovery" until an admin
> classifies them. Module: `services/groupPresets.js`.
>
> Configs are **separate per scope** by user direction — a preset
> called "Operations" under tickets is NOT shared with changes scope
> (different tech_group conventions on `request_records` vs
> `change_records`). Tickets scope seeds from the existing
> `dashboard-shared.js` defaults (12 site IT Agents in Operations +
> 9 app teams in Application). Changes scope seeds EMPTY — admin
> populates as discovered.
>
> ### Audience tone selector (2026-06-04)
>
> New `<select id="analyzeAudience">` next to the Analyze button.
> 3 options with default Executive (CFO/CIO):
>
> | Audience | Preamble injected into every prompt |
> |---|---|
> | Executive (CFO/CIO) | Lead with business outcome (uptime, cost avoidance, user-hours lost). Quantify in monetary or operational terms. Frame risks as strategic exposure. Plain English — no ITSM jargon (replace SLA/FRT/MTTR/RCA/PIR with "response time", "time to resolve", etc.). |
> | Operational (IT Mgr) | Full ITSM vocabulary. Correlate metrics across KPIs to identify root operational cause. Name specific groups/sites/categories. Recommend concrete process changes. |
> | Technical (Engineer) | Maximum specificity. Reference categories, sub-categories, sites, group names, ticket IDs, UDF fields by name. Suggest tooling or platform changes. |
>
> Persisted in `localStorage` under `analyze_audience_v1`. Applied to
> all 4 prompt builders (helpdesk, sla/changes/incidents, csat,
> governance) so the tone is uniform across the deck. Switching the
> audience and re-clicking Analyze regenerates every section in the new
> register.
>
> ### AI prompt grounding — anti-hallucination clause (2026-06-04)
>
> `buildPromptGovernance()` embeds a "NUMERIC GROUNDING — ABSOLUTE RULE"
> block:
>
> ```
> CANONICAL VALUES FOR <period> (these and ONLY these):
>   • Total tickets   : <h.total>
>   • Closed tickets  : <h.closed>    ← write "<h.closed>" not a rounded variant
>   • Closure rate    : <h.closureRate>%
>   ...
>
> PROHIBITED — examples:
>   ✘ "Closure rate 93.4%" when canonical is 93.1%
>   ✘ "1,240 of 1,327 tickets closed" when canonical is 1,236 of 1,327
>   ✘ "12 RFCs" when canonical is 0
>
> REQUIRED:
>   ✓ Copy values BYTE-FOR-BYTE from the canonical list.
>   ✓ If a bullet needs a number not in the list, REPHRASE to omit it.
>   ✓ "(canonical)" self-check rule — if you can't tag a number as
>     canonical without lying, do not use that number.
> ```
>
> Caught: the AI was hallucinating "Closure rate 93.4% (1,240 closed)"
> when actual was 93.1% / 1,236, and "12 RFCs" when changes_total was
> 0. The grounding doesn't prevent stale-snapshot hallucinations (where
> the user clicks Analyze, then changes filters, then exports) — that's
> a UX concern for a future "re-run on filter change" follow-up.
>
> ### "Apr '26" hardcoded text purge (2026-06-04)
>
> Every footer + delta label on slides 1, 3, 7, 8, 9 that used to
> embed an April reference is now data-driven from `K['month']` /
> `K['prev_month_short']`. Slide 2 IT Governance content is AI-
> generated (with the grounding clause above). Slides 4-6 footers were
> already mostly aligned but received the same treatment.
>
> Conventions used by `_delta_str()` + `_cover_delta()`:
> - Returns `('— vs <prev>', 'neutral')` when delta is `None`.
> - Signs the delta string (`+1.3pp` / `-0.2pp`) and decides
>   good/bad/neutral colour via XOR with `invert` flag (backlog,
>   incidents, MTTR all use `invert=True`).
> - `prev_month_short` comes from `services/reportPayload.js build()`
>   computing `MONTH_SHORT[monthIdx - 2]` (with year-wrap fallback to
>   `'Dec'`).
>
> ### Slide 9 incident grid — 2 columns × 3 rows (2026-06-04)
>
> Was 5 stacked cards of 1.10" → drifted into the y=6.55 footer band.
> Now 2 columns × max 3 rows. Card dimensions: 6.10" wide × 1.05"
> tall. Badge strip width 1.00" (was 1.50"). Lessons text truncated
> at 120 chars to fit. Layout origin (0.4, 3.20), row gap 0.05", col
> gap 0.15". Caps at 6 cards; sixth slot stays empty if fewer.
>
> ### Slides 10/11 — Activity Tracker integration (Phase 3.5 done)
>
> `services/reportPayload.js _tracker()` now returns:
>
> ```
> tracker = {
>   green, amber, red,              // fleet totals (active sites × current month)
>   avg_score, avg_delta_pp,        // fleet avg + MoM delta
>   sites: [{ code, name, color, score, delta_pp, g, a, r }],
>   pillars: {                       // weighted per-pillar RAG
>     "P1-Network Infrast": { green, amber, red, score, weight },
>     "P2-Business Partner": ..., "P3-Risk & Compliance": ..., "P4-Manage People": ...
>   },
>   commentary: []                   // placeholder for AI/manual notes
> }
> ```
>
> Slide 10 KPI strip (Fleet · Green · Amber · Red) + 2 charts (site
> leaderboard horizontal bar coloured by score, pillar RAG stacked
> bar sorted by weight). Slide 11 grid of up to 10 site cards (2 rows
> × 5 cols), each showing score + MoM delta + G/A/R counts. Both
> slides fall through to a graceful "tracker data unavailable" amber
> panel when `K['tracker'].sites` is empty.
>
> ### Activity Tracker drill-down — Dashboard + Slide 11b (2026-06-04)
>
> Closes the user feedback "can we see progress other months per
> pillar of sites?". Two complementary surfaces (no duplicate
> dashboards — feedback was clear we already have too many tabs).
>
> **Browser — inline drill-down on the Dashboard tab**:
>
> - Click any row in **Pillar Health** → an inline 6-month fleet-avg
>   trend chart slides open below the row. Click again to collapse.
> - Click any row in **Site Leaderboard** → an inline 6-month per-site
>   score trend chart slides open below the row. Click again to
>   collapse.
> - Single open at a time per panel (clicking another pillar swaps).
> - Hover affordances: light grey bg on row hover, `▾` indicator
>   flipped to `▴` when expanded, slide-in animation 220 ms.
> - Computed client-side via `TR.ps2(D, site, pillar, y, m)` and
>   `TR.ss(D, site, y, m).avg` — no extra API call.
> - Trend window = 6 months ending at the currently-selected period,
>   rolling back through year boundaries.
>
> **Server payload — `tracker.trends`** in `services/reportPayload.js`:
>
> ```
> tracker.trends = {
>   months : ['Dec 25', 'Jan 26', ..., 'May 26'],   // last 6 months ending at selected period
>   fleet  : [pct, pct, pct, pct, pct, pct],        // fleet score per month
>   pillars: { 'P1-Network Infrast': [pct,...], ... },  // per-pillar fleet avg
>   sites  : { 'HGO': [pct,...], 'MGO': [pct,...], ... }  // per-site score
> }
> ```
>
> The pillar-trend computation aggregates `{g, a, r}` counts across
> active sites per period and converts to a score at the end (faithful
> to how the engine.js `ps2` rollup works at a single point in time).
> Sites whose pillar has zero active activities for the period
> contribute null (skipped, not zeroed).
>
> **PPTX — new Slide 11b "Pillar Trends"**:
>
> Inserted between current Slide 11 (Site Summaries) and the
> save-to-stdout block. 2×2 grid of mini line charts (one per
> pillar) on a 6.20" × 2.40" card each:
>
> - Pillar name + latest-value RAG pill in the card header
> - Mini line chart 5.2"×2.0" rendered via matplotlib in `_chart()`
> - RAG threshold reference bands as low-alpha horizontal stripes
>   (red 0-55, amber 55-65, green 65-100) at 5% alpha so they read
>   as context, not noise
> - Per-point % labels above each marker
> - Stable pillar→colour map (`_PILLAR_COLORS` in render.py): Network
>   blue · Biz Partner teal · Risk purple · People orange
> - Defensive pillar ordering: canonical 4 first, then any extras
>   present in payload (so future pillar additions still render)
>
> Bottom commentary auto-synthesised: identifies "improving" /
> "declining" / "stable" pillars by comparing the latest value to
> the trailing 5-month average (±2 pp dead band). No AI dependency
> on this slide.
>
> Footer page number = 12. Slide is **conditional** — only emitted
> when `K['tracker']['trends']['months']` and `['pillars']` are both
> populated. Empty trends → slide skipped entirely, deck stays
> coherent at 11 pages.
>
> ---
>
> **Prior session's work** (Risk Register, Active Sessions, DB-backup
> infrastructure, the CIO/CFO + SharePoint presentation decks, design
> brief for Claude Designer) is unchanged on top of which this sits.

## ⚡ Prior state (as of 2026-06-01)

> Branch `claude/busy-kirch-2a4176` is now **~240 commits
> ahead of origin** (still NOT pushed). Tip: `5a5c07a` (Meetings import
> page bilingual EN/FR + FR guide). This session shipped the
> end-to-end **Meetings lookup management** — closes the gap between
> "an IT coordinator hands me an xlsx with a new code" and "the import
> accepts it". 5 commits across 4 files. Plus the original ask: a
> comprehensive **French step-by-step guide** for francophone field IT
> coordinators on the bulk-import page. Print-only stylesheet makes
> the FR guide PDF-friendly via Ctrl+P. Earlier session's work
> (Risk Register, Active Sessions, DB-backup infrastructure, the
> CIO/CFO + SharePoint presentation decks, design brief for Claude
> Designer) is unchanged on top of which this sits.

### What landed today

| Phase | Commit | What |
|---|---|---|
| 1+2+3 | `fb91f19` | Meetings lookup management end-to-end. New API (GET/PUT/PATCH on `/api/meetings/lookups/:table[/:code[/active]]`, super_admin only). New admin card "🗂 Meetings — Codes de référence" on `reports.html#admin`. Inline "+ Créer ce code" button on `meetings-import.html` preview when an unknown-code error appears (super_admin only). All three pieces tightly coupled around the same API surface. |
| 4 | `5a5c07a` | `meetings-import.html` bilingual EN/FR with localStorage-persisted toggle (15 inline pairs, 8+ block pairs). FR-only "📘 Guide complet" section with: ASCII diagram of the 3-sheet linkage, canonical reference format, Excel formula trick for batch reference generation, duplicate-reference suffix workaround, unknown-code workflow (3 branches by role), end-to-end recipe, cheat-sheet errors table, FAQ. |
| 5 | (in the same commit as 4) | Print stylesheet (`@media print`) on `meetings-import.html` — Ctrl+P with FR active produces a clean A4 portrait PDF containing only the guide (no app shell, no upload UI, no EN content). Coordinators print and email the PDF. |
| 6 | (this commit) | CLAUDE.md update + new "Meetings lookup management" + "Bilingual import page" sections below. |

### What the user sees now on `meetings-import.html`

```
┌────────────────────────────────────────────────────────────[EN|FR]─┐
│ Insights · Réunions · Import en masse                              │
│ Importer des PV historiques                                        │
│ Téléversez un classeur Excel à 3 onglets (Meetings, Issues,        │
│ Actions) pour importer des PV départementaux en une seule…         │
├────────────────────────────────────────────────────────────────────┤
│ [Step 1 — Télécharger]   │ [Preview · rien n'est encore saved]     │
│ [Step 2 — Remplir       │   • KPIs: Réunions / Issues / Actions    │
│   • règle d'or sur la    │   • erreur row 7: Unknown intake_source │
│     reference]           │     "business_incubation" [+Créer code] │
│ [Step 3 — Téléverser]    │ [Step 4 — Valider l'import]             │
├────────────────────────────────────────────────────────────────────┤
│ 📘 Guide complet — FR-only (mécanisme de liaison, pièges, FAQ)     │
│   Section autonome de ~600 lignes pour les coordinateurs IT FR     │
└────────────────────────────────────────────────────────────────────┘
```

Click **+ Créer ce code** (super_admin only) → modal pré-remplie →
POST → re-run preview → erreur disparaît. Boucle fermée.

Ctrl+P avec toggle FR actif → PDF clean A4 portrait avec uniquement
le guide. Email aux coordinateurs.

### Meetings lookup management — full architecture

**API** (all super_admin only, except GET /api/meetings/lookups which is form-facing):

| Method · Path | Purpose |
|---|---|
| `GET /api/meetings/lookups` | Active-only — drives every dropdown in the form |
| `GET /api/meetings/lookups/:table` | Admin view — includes soft-deleted rows |
| `POST /api/meetings/lookups/:table` | Add a new code. Refuses duplicate (use PUT to update). |
| `PUT /api/meetings/lookups/:table/:code` | Partial patch — name_en/fr, display_order, active, plus table-specific extras (color, icon, descriptions). `code` itself is the PK and is NOT editable through this route. |
| `PATCH /api/meetings/lookups/:table/:code/active` | Convenience toggle — body `{active: 0|1}`. Soft delete; old PVs keep their original code labels. |

**meetings-db.js** functions:
- `addLookupRow(table, row)` — strict: refuses duplicate code (avoids the silent INSERT-OR-REPLACE clobber on display_order/active)
- `listLookupTable(table, {includeInactive})` — admin view of one table
- `updateLookupRow(table, code, patch)` — partial UPDATE, uses `PRAGMA table_info` to drop client keys that don't apply to the target table (so the same modal works for all 11 lookups despite their column-set differences)

**Admin card** on `reports.html#admin` — `🗂 Meetings — Codes de référence` — super_admin only. Dropdown picks which of the 9 admin-extensible lookups to manage (it_involvement + engagements stay locked as system concepts). Table shows code/EN/FR/order/active with Edit + Toggle buttons. Edit/Add modal in French (the audience is mostly francophone admins).

**Preview enrichment** on `meetings-import.html` — when a `_coerceCode` error of the form `Unknown <field> "<code>". Allowed: ...` reaches the browser, a "+ Créer ce code" button is injected next to the error (super_admin only — gated client-side via `window.__userHasRole('super_admin')` AND server-side at the route). Click → small modal pre-filled with code + Title-Case-suggested names → POST → auto-rerun of preview → error vanishes.

`FIELD_TO_TABLE` map (top of the meetings-import.html IIFE — KEEP IN SYNC with `meetings-import.js` `_coerceCode` callsites):

```
site_code         → null (sites NOT extensible from here; managed elsewhere)
department        → md_departments
intake_source     → md_intake_sources
meeting_status    → md_meeting_statuses
status            → md_statuses
category          → md_categories
severity          → md_severities
escalation_reason → md_escalation_reasons
council_theme    → md_council_themes
```

### Bilingual EN/FR pattern (replicable across the dashboard)

The meetings-import.html implementation is the canonical pattern for any future page that needs an EN/FR toggle. Reusable as-is:

**Toggle button** — top-right of the hero, persisted to localStorage:

```html
<div class="mim-lang-toggle" id="mimLangToggle">
  <button data-lang="en" class="active">EN</button>
  <button data-lang="fr">FR</button>
</div>
```

**Inline text pairs** for one-line content:

```html
<span data-lng="en">English text</span>
<span data-lng="fr">Texte français</span>
```

**Block-level content** (paragraphs, list items, sections):

```html
<p data-lng-block="en">English paragraph.</p>
<p data-lng-block="fr">Paragraphe en français.</p>
```

**FR-only content** (no EN twin needed — e.g. the import guide):

```html
<div data-lng-block="fr"> ... whole FR-only section ... </div>
```

**CSS** — body.lang-fr toggles visibility:

```css
[data-lng="fr"]       { display: none; }     /* EN is default */
[data-lng-block="fr"] { display: none; }
body.lang-fr [data-lng="en"]       { display: none; }
body.lang-fr [data-lng-block="en"] { display: none; }
body.lang-fr [data-lng="fr"]       { display: inline; }
body.lang-fr [data-lng-block="fr"] { display: block; }
```

**Programmatic strings** through a `T(key, args)` helper backed by an `I18N` table — used for messages we emit at runtime (banners, KPI labels, button labels in dynamically-rendered HTML, confirm prompts).

**Print stylesheet** in the same page — `@media print` hides the app chrome, hides EN content when FR is active, keeps the guide section page-break-friendly. Result: `Ctrl+P` produces a clean A4 PDF.

### Lessons / patterns to NOT re-discover (this session)

| Trap | What we learned |
|---|---|
| **`INSERT OR REPLACE` silently clobbers columns absent from the patch** | The pre-existing `addLookupRow` (and its underlying `_seedTable`) used `INSERT OR REPLACE`. Calling it twice with `{code:'survey', name_en:'IT Survey'}` (no name_fr/display_order/active) would reset name_fr to NULL, display_order to 0, active to 1 — even though the admin only wanted to fix the EN label. Fix: refuse duplicates in `addLookupRow` (forces admin to use the PUT/PATCH path which is partial-update aware) and use `PRAGMA table_info` to discover per-table editable columns. **Rule**: any "upsert" helper that uses INSERT OR REPLACE on a wide schema is a footgun for partial patches. Either use INSERT … ON CONFLICT DO UPDATE with explicit column lists, or separate add (strict) from update (partial). |
| **Form-facing GET vs admin-facing GET differ by `active=1` filter** | `GET /api/meetings/lookups` (used by every dropdown in the form) hides soft-deleted rows via `WHERE active = 1` inside `loadLookups()`. The admin card needs to SEE soft-deleted rows so it can re-activate them. **Fix**: separate route `GET /api/meetings/lookups/:table` with `includeInactive: true`. **Rule**: when adding admin tooling to manage a lookup, decide upfront whether the admin view shows the same rows as the form view or a superset. They almost always differ. |
| **Same-named span pairs across <head> CSS and <body> markup produce false-positive count mismatches** | Counting `data-lng="en"` vs `data-lng="fr"` via grep included matches inside CSS selectors (`[data-lng="fr"] { display: none; }`) and inside HTML comments (`<span data-lng="en"> / <span data-lng="fr">`). The "imbalance" was just CSS being correctly written (EN is the default so only FR needs `display: none` overrides). **Rule**: when sanity-checking i18n pair counts, filter the grep to body-content only, OR just visually pair the actual UI spans in source order. The "off by N" warning is meaningless without context. |
| **Inline `esc` helper named identically to the global escaper** | `_openTicketDrillModal` in `index.html` defined a local `esc` that only handled null/undefined coercion, then used it as if it were the project's HTML escaper. Same trap as the security review caught — a local `esc` that's NOT actually escaping creates false safety in code review. **Rule**: when adding a small inline helper, NEVER name it `esc` if the codebase already has a global `escapeHTML`/`esc` with HTML safety semantics. Use `_orDash`, `_strOrEmpty`, `_nullCoerce`, anything but the conflicting name. |
| **Post-commit hook regenerates _deploy.cmd from git diff — manual edits don't persist across commits** | The hook builds `_deploy.cmd` from `git diff --name-only <last-deployed>..HEAD`, so any manual exclusion (e.g. presentation artefacts) gets overwritten on the next commit. **Workaround**: edit `_deploy.cmd` AGAIN after each commit until the user actually runs it (which advances `.git/last-deployed` past the offending files). **Better long-term**: extend the hook to read a per-repo skip-list (`.deployignore`) — same syntax as `.gitignore`. **Defer**: low priority while the only excluded files are the two presentation artefacts that will eventually move out of the worktree anyway. |

---

## ⚡ Prior state (as of 2026-05-30)

> **READ FIRST.** Branch `claude/busy-kirch-2a4176` is now **~235 commits
> ahead of origin** (still NOT pushed). Tip: `3197c30` (move Risk Register
> admin UI into reports.html#admin card). Two big things landed this
> session: (1) the **Risk Register monthly Occurrence export** —
> entire new feature wiring up SDP incident data to the operations
> risk register; (2) the **DocuSign communication reel** was
> extracted out of the dashboard repo into a standalone folder, since
> it was internal-comms content masquerading as a dashboard feature.
> Also: `better-sqlite3` upgraded 9.6.0 → 12.10.0 (Node 24 prebuild),
> `exceljs` install attempted then reverted in favour of the
> already-installed `xlsx` for security, and the post-commit deploy
> hook now propagates file deletions to prod via `del` commands.
> Prior 2026-05-24 work (Activity Tracker rebuild, save model
> switches, nav consolidation) is unchanged on top of which this sits.

### What landed in the Risk Register Occurrence export

| Stage | Commit | What |
|---|---|---|
| Initial impl | `fe595fd` | Whole-feature: classifier (5 domains, 16 cat/sub rules), SQLite reader, exceljs writer, `/api/risk-register-export` endpoint, button in `index.html` |
| Impact scope filter | `b3955b6` | Added `impact` column to `request_records` + idempotent ALTER + zoho-sync mapping. Filter to operational scope (Enterprise / Single dept / Multiple dept) |
| Auth fix | `b815ab6` | Export fetch was missing `X-Dash-Key` header → 401 from the global API gate |
| Security rewrite | `1779deb` | **exceljs → xlsx (SheetJS CE)** to avoid 80 new transitive deps + 4 npm-audit findings. Same .xlsx output, plainer styling (CE drops cell fill colors) |
| Dep cleanup | `f65d909` | `_uninstall_exceljs_prod.cmd` to remove the 80 dead packages from prod |
| Native binding fix | `6a0855b` | better-sqlite3 9.6.0 → 12.10.0 after `npm uninstall --ignore-scripts` removed the .node binary. v12 ships Node 24 prebuilts. `_recover_better_sqlite3_prod.cmd` ships the same recovery for prod |
| Site name mapping | `3bde6eb` | SDP uses full mine names (`HOUNDE`); spec wants codes (`HGO`). Added SITE_ALIASES map. Also relaxed NULL impact (91% of historical rows are NULL) |
| Admin UI | `a182d51` → `3197c30` | First built as standalone page, then refactored into a 4th card on `reports.html#admin` per user's mental model. SQLite-backed `rr_site_aliases` table; super_admin only |

### DocuSign reel — extracted to standalone folder

Originally drafted under `public/docusign-comms.html` + `docusign-pptx.js` + `public/brand/goldy/*.png` + `public/brand/banners/*.png`. User correctly flagged: this is **internal communication content for TV signage + email distribution**, not a dashboard feature. It shouldn't live in the helpdesk repo.

Moved (commit `db7594b`) to `C:\Users\Admin\Documents\EDV-DocuSign-Comms\` with its own `README.md`, `package.json`, `node_modules\pptxgenjs\`, asset folder. Self-contained — no server, no auth, copy folder to a USB stick → open `index.html` in any browser. Hidden keyboard shortcuts: `Space` next, `←` prev, `F11` fullscreen, `P` play/pause. PPTX still buildable via `node generate-pptx.js`.

Files removed from the dashboard repo (deployment script's new deletion handling propagated these to prod's `Z:\`):
- `public/docusign-comms.html`
- `docusign-pptx.js`
- `public/brand/goldy/*.png` (6 files)
- `public/brand/banners/*.png` (2 files)

### Deploy hook — now handles deletions

The post-commit hook (`.git/hooks/post-commit`) previously used `git diff --diff-filter=ACMR` which dropped Deletions, so removed files orphaned on prod's `Z:\` forever. Fixed: hook now runs a parallel `--diff-filter=D` pass and emits `if exist "Z:\path" ( del /F /Q "Z:\path" )` blocks. Idempotent (skips files already gone). See "Lessons / patterns" below for the rationale.

### Active Sessions admin card (added 2026-05-30 evening, commit `cc64695`)

Small Tier-2 observability feature requested after the Risk Register
work. Backed by a new `sessions.last_seen` column that
`validateSession()` bumps on every authenticated request (~50µs per
call on warm WAL DB).

| Capability | Where | Who |
|---|---|---|
| See who's online | `reports.html#admin` → 🟢 Active Sessions card | admin+ |
| Choose idle window | Dropdown: 1 min / 5 min / 15 min / 1 h / 24 h | admin+ |
| Force-logout a user | ⛔ Force logout button per row | super_admin only |
| Auto-refresh every 30 s | Only fires when admin tab is active + browser tab visible | — |

Schema delta: `ALTER TABLE sessions ADD COLUMN last_seen TEXT` (idempotent).
Backwards-compatible — `COALESCE(s.last_seen, s.created_at)` everywhere
so existing sessions don't disappear from the view before they get
their first bump.

API:
- `GET /api/reports/sessions/active?idle_minutes=N` — admin+
- `DELETE /api/reports/sessions/:token` — super_admin only, server-side
  rejects attempts to kill your own session.

### Late-session inspection + dictation work (2026-05-31, commits `3693c6d` + `b440ebf`)

Two field-user-impacting bugs surfaced from the inspections team after
the Risk Register / Active Sessions work. Both turned out to be older
than tonight's session — they just got reported now.

**Bug 1 — voice dictation duplicating whole sentences**

The 2026-05-23 fix tried to keep continuous-mode dictation working
across natural pauses with a 3-buffer system + auto-restart in
`r.onend` + auto-language fallback (EN ↔ FR swap). The cross-session
boundary commit still produced duplicate sentences on some Chrome
network conditions. Per user direction, **reverted to the simplest
possible push-to-talk model** (commit `3693c6d`):

| Old (continuous mode) | New (push-to-talk) |
|---|---|
| `r.continuous = true` | `r.continuous = false` |
| 3 buffers: initial / committed / current | None — append directly |
| `r.onend` auto-restarts | `r.onend` just stops |
| Auto-language swap on first failure | Hard-set `r.lang = dictLang` (user picks EN / FR via header toggle) |
| Idempotent rebuild from `e.results[0..]` | Canonical pattern from `e.resultIndex` |

Trade-off: longer paragraphs need multiple taps. Inspectors preferred
this over the duplicate-words bug. The EN/FR toggle at the top of
`inspection.html` is the SOLE language-selection mechanism — no
auto-detect — which gives the browser the right speech model upfront
for much better accuracy than auto-fallback.

**Bug 2 — "inspection data disappeared after clearing browser cache"**

Field user reported: filled an inspection, submitted, could see all
data on re-open. Cleared browser cache + re-logged. Re-opened the same
inspection from the dashboard → data was gone.

It wasn't actually gone. The dashboard's "Open" link navigates to
`inspection.html?id=EM-IT-20260531-7591`, but **init() completely
ignored the `?id=` URL parameter** — it only read `localStorage`. With
localStorage empty after the cache clear, it fell through to
`newInspection()` and created a brand-new empty inspection
(`EM-IT-20260531-1991`) with a fresh ID. The original 7591 was sitting
safely on the server the whole time; the form just never asked for it.

Fix (commit `b440ebf`):

1. `init()` now reads `?id=` from `URLSearchParams` FIRST, falls back
   to `localStorage` KEY_CURRENT, then to `newInspection()`.
2. Added `window.fetchInspectionFromServer(id)` helper exposed from
   the IIFE — thin wrapper around `GET /api/inspection/:id` returning
   the state blob or null. Never throws.
3. When local cache misses, init() calls the server, hydrates `state`,
   mirrors to localStorage + index, and shows "✓ Loaded from server"
   toast. If the server also returns nothing, starts fresh with a
   "Inspection not found" toast.

The canonical load-priority chain for any deep-linkable form:
**URL ?param → localStorage → server → fresh**.

### Activity Tracker year management (where to delete a year)

Per the 2026-05-24 Phase 6.5 work, the toolbar's `+ Year` button was
moved out of the top bar into the `Tracker Setup` tab's
`1 · Years` section. To **delete a year** (e.g. someone added 2027
prematurely and you need to remove it without touching 2026 data):

1. Open Activity Tracker → **Tracker Setup** tab (top bar)
2. Section **`1 · Years`** at the top — list of years with a small
   delete button per row
3. Clicking delete shows a confirm modal listing cascade impact
   (number of `tracker_inputs` rows for that year that will be wiped)
4. Confirm → year is removed from `tracker_config.years` AND
   `tracker_inputs` rows for that year are deleted server-side
5. The selector at the top updates immediately; previously-selected
   year falls back to the most recent remaining year

Schema reminder: `tracker_inputs.year` is part of the composite PK
`(year, site, activity_ix)` — deleting year N has NO effect on rows
for year M. The years array in `tracker_config` is just a list of
"years the UI should show in the dropdown"; the inputs table is
keyed by year, so 2026 data is isolated from 2027 data by design.

### Lessons / patterns to NOT re-discover (Risk Register + this session)

| Trap | What we learned |
|---|---|
| **`npm uninstall <pkg> --ignore-scripts` can delete OTHER packages' native bindings** | Even though `--ignore-scripts` blocks REBUILDS, npm's package-tree reconciliation pass deletes files it considers extraneous. Removed `better_sqlite3.node` from both dev and prod after `npm uninstall exceljs --ignore-scripts` ran. **Rule**: BACK UP `node_modules/better-sqlite3/` before any npm install/uninstall on prod, even with --ignore-scripts. Recovery is `_recover_better_sqlite3_prod.cmd`. |
| **`prebuild-install` fails through corporate proxy with "unable to get local issuer certificate"** | The proxy does SSL inspection; Node's bundled CA doesn't trust the corporate root cert. The fallback `node-gyp rebuild --release` then fails because prod has C++17 build tools, not C++20. **Per-process bypass**: `set NODE_TLS_REJECT_UNAUTHORIZED=0` + `npm install --strict-ssl=false`. Do NOT persist in `npm config` — that's a global security weakening. |
| **`npm rebuild <pkg>` skips the prebuild download** | `rebuild` runs `node-gyp rebuild` directly, bypassing `prebuild-install`. **Rule**: to fetch a missing prebuild, `rm -rf node_modules/<pkg> && npm install <pkg>` — the `install` lifecycle script tries prebuild FIRST, then source. |
| **`<` inside `node -e "..."` from cmd.exe is parsed as stdin redirect** | cmd.exe ends quote-mode at the inner `\"`, then sees the bare `<` as a redirect operator. Symptom: "The system cannot find the file specified" with no Node stack trace. **Fix**: write the script to a `.js` file (`node script.js`) or rewrite SQL to use `BETWEEN ... AND ...` instead of `<`. |
| **SDP `site` column carries full mine names, NOT short codes** | The Risk Register, Activity Tracker, and Inspection module each have their own code conventions. The helpdesk `request_records.site` is the most authoritative source for what SDP actually populates — `HOUNDE`, `MANA`, `Sabodala`, `LAFIGUE`, `Ouagadougou`, mixed-case, with one-off labels like `LAFIGUE - SML`. **Don't assume the codes line up with any other module's list.** Use a `*_aliases` lookup. |
| **`impact` column in `request_records` is 91% NULL on historical rows** | The Impact field was added to SDP recently. ~228 of 251 May 2026 incidents carry NULL impact — they predate the field. Strict `VALID_IMPACTS` filtering shows zero everywhere; report becomes useless. **Decision shipped**: treat NULL as in-scope (likely operational, just unannotated), explicitly EXCLUDE only `Individual`. Diagnostics surface `classified_with_null_impact` so the operator knows how much of the count is impact-uncertain. As Zoho's data catches up, this number will shrink naturally. |
| **SheetJS CE drops cell fill colors / borders / fonts on write** | Pro-only feature. **What CE DOES preserve on write**: column widths (`!cols`), row heights (`!rows`), date number formats (cell.z), cell values. **What CE DROPS silently**: fill colors, borders, fonts, freeze panes (`!views`). For the Risk Register, the spec's colored header bands and row banding are lost; data is fully correct. If you ever need the styling: either use a template (`XLSX.read` an pre-styled file, repopulate the data cells, `XLSX.write` — round-trip preserves more), or accept Plain Format. |
| **Standalone HTML pages vs `reports.html#admin` cards — pick the integration pattern early** | Built the Risk Register admin as a standalone page first (`public/risk-register-admin.html`), then re-built it as a 4th card on `reports.html#admin` per user feedback. The card pattern matches the existing User / Sites / Departments cards, reuses `.modal-overlay.open` + `toast()` + `esc()` + `.user-table` styles, and keeps the nav simple (flat "Admin" link, not a dropdown). **Rule**: if it's an admin function, default to a new card on `reports.html#admin` unless there's a specific reason to surface it separately. |
| **`x-dash-key` is REQUIRED for every `/api/*` call from a browser tab** | The global gate at `server.js:946` (`app.use('/api/', ...)`) rejects requests without either `X-Dash-Key` or a valid `x-report-token`. `index.html` uses `pgGet()` which injects this. Naked `fetch('/api/something')` from new code → 401. **Rule**: when adding a new API call, copy the auth header pattern from `pgGet` or the inline pattern at `public/index.html:396`. |

### Activity Tracker rebuild (Phases 2–6) — from 2026-05-24 session

(retained — see below)

## ⚡ Prior state (as of 2026-05-24)

> **READ FIRST.** Branch `claude/busy-kirch-2a4176` is now **~96 commits
> ahead of origin** (still NOT pushed). Tip: `a4d9ed3` (soften RAG red
> on tracker roadmap/leaderboard, drop "NEW" badge). The Activity
> Tracker was rebuilt end-to-end this session to match the
> dashboard-preview design while keeping the calculation engine
> identical, the Inspection save model was switched from auto-debounce
> to manual ("Save now"/Submit), the primary nav was consolidated
> (Reports + Insights dropdowns), and a few small UX polish items
> landed (branded delete modal, softer RAG red). Yesterday's work
> (meetings v2, inspection diagnostics, voice fix — see 2026-05-23
> entry below) is unchanged on top of which this sits.

### What landed in the Activity Tracker rebuild (Phases 2–6)

| Phase | Commit | What |
|---|---|---|
| 2  | `1a19a16` | React shell + Dashboard tab, on `/api/tracker/load`. Legacy at `/activity-tracker-legacy.html` |
| 3  | `23d903a` | Scoring + Input + Heatmap tabs. Input gets debounced auto-save (800 ms) + explicit Save button |
| 3.5| `a1709f9` | Dashboard hierarchy rewritten to match preview — hero (Overall + Trend) + Pillar Health + Site Leaderboard, charts reduced from 6 → 4 |
| —  | `fa00c7a` | Site Leaderboard score bars: switched from `<span>` (didn't render) to `<div>`; RAG-coloured (55/65 thresholds) instead of site brand colour |
| 4  | `fa7c9b6` | Tracker Setup tab + RedistributeModal (proportional/equal/custom) |
| —  | `fcfc32f` | Add-pillar / add-activity / delete cascade warnings |
| —  | `259b0e1` | Site activate / deactivate confirm modal (direction-aware copy) |
| 5  | `dd18a6f` | Targets + Roadmap panels (12-month Gantt by pillar) |
| —  | `8f5206e` | Smart default month (last month with data) + two-line Roadmap (period vs today) |
| —  | `80216c6` | + Year button in toolbar (with confirm modal) |
| 6  | `5c26d61` | PPTX export modal + CLAUDE.md update |
| 6.5| `6736df6` | **+ Year moved out of toolbar** into Tracker Setup tab (new "1 · Years" section); section renumbering 2-4; drive-by fix of an `onExport` prop destructure missed in Phase 6 |

### Nav reorganization — Reports + Insights consolidation

Top-level menu cleaned up. Old: 5 top-level items (Helpdesk, Reports,
Insights ▾, Inspections, Deck Builder) + Admin + Help. New: 3 functional
top-level items (Helpdesk, Reports ▾, Insights ▾) + Admin + Help.

```
Helpdesk · Reports ▾ · Insights ▾ · Admin · Help
            │            └ Inspections, Activity Tracker,
            │              Meetings Decisions, Analytics,
            │              Executive Scorecard
            └ Site Reports, Deck Builder
```

Changes in `_shell.js`:
- **Reports becomes a parent** with two children: `site-reports`
  (reports.html, any) + `reports-builder` (executive-report.html,
  report-author / super_admin / executive). Parent click smart-lands on
  Site Reports.
- **Inspections moved INTO Insights** as the first child (id `inspections`).
  Top-level Inspections entry removed. Capture is still one click away
  via the "+ New inspection" button on the dashboard.
- **Insights children reordered**: any-role items first (Inspections,
  Tracker, Meetings) so site-IT users clicking the parent smart-land on
  Inspections. Admin- / executive-gated items (Analytics, Scorecard) last.
- **Single-child dropdowns collapse to a flat link** in `renderNavItem`:
  if a user has access to only one child of a parent (typical: viewer
  sees only Site Reports under Reports), the parent renders as a plain
  link instead of a one-item dropdown with caret.

Pages whose mount `data-section` / `data-current` had to be updated:
- `inspection.html` + `inspections.html`: `section=performance current=inspections`
- `executive-report.html`: `section=reports current=reports-builder`
- `reports.html`: `section=reports current=site-reports`

Verified per-role rendering with a throwaway harness (loaded `_shell.js`
with stubbed window/document and walked `window.__shell.NAV` per role) —
all 6 role variants render the expected shape.

### Inspection save model — switched to Local + Save now + Submit

After three rounds of bug-fixing (window.state scoping → 413 → empty
draft pollution) the field user asked: *"autosave should be local and
only appear on server when submitted?"*. We confirmed the trade-off
and switched to:

| Action | Local | Server |
|---|---|---|
| Keystroke | ✓ | ✗ |
| **Save now** button | ✓ | ✓ |
| **Submit** | ✓ | ✓ |
| **Re-open** (admin+) | ✓ | ✓ |

Patched `saveCurrent` in `public/inspection.html` no longer schedules
a debounced server POST — it just runs the local autosave and updates
the toolbar with a "click Save now to sync" hint. `forceSyncNow()`
remains the single path to the server (Save now button + the
auto-chained sync from Submit / Re-open). The `_stateIsMeaningful`
gate and `_promotedIds` Set are retained to drive the toolbar hint
text but no longer block any POST. Full details in §"Save model"
inside the Inspection module section below.

### Analyze Lite — deterministic stop-gap (no AI, no network call)

While cloud AI analysis is paused pending IT approval for the on-prem
Mistral Nemo deployment, a deterministic templating engine
(`public/analyze-lite.js`) fills the same commentary fields the AI
path used to fill. **Nothing leaves the browser** — pure JavaScript,
zero network calls, instant.

```
Browser executive-report.html / executive.html
  ├─ 🔒 Analyze (paused)   ← cloud-AI button, disabled
  └─ ⚡ Analyze (lite)     ← new, calls window.AnalyzeLite.run*Lite()
       ├─ reads buildAiSnapshot() (or _baseData / _rawRows)
       ├─ classifies each KPI vs threshold (same thresholds the AI used)
       ├─ picks worst site / worst category / trend direction
       └─ writes into f-exec, f-helpdesk, f-sla, f-change, f-incidents,
          f-csat (executive-report.html) or f-obs, f-risks, f-actions,
          f-change, f-incidents, f-outlook (executive.html)
```

**Field strategy** — fact-first, narrative-poor:

| AI strength | Lite equivalent |
|---|---|
| Classify KPI vs target | Identical — same threshold table (slaComp ≥90, frtComp ≥90, reopenRate <5, fcrRate ≥75, csat ≥80, nps ≥30, emergency <5%, etc.) |
| Worst category by volume / SLA | Identical — sort the parsed category breakdown |
| Worst site by FRT SLA | Identical — sort the parsed site summary |
| 12-month trend direction | Identical — last value vs trailing-6m average (`_trendDir`) |
| Backlog blocker categories + sample subjects | Renders the pre-computed strings verbatim with a "manual triage required" note |
| Major incident per-row (RCA / CA / Lessons / PIR / downtime) | Renders `s.incidents.lines` verbatim — that string already came from the snapshot |
| Narrative prose, cross-KPI causal speculation, inferred-from-subjects analysis | **Not attempted** — Lite is honest about its limits |

**Visual cue** for Lite-generated fields: thin amber left border
(`border-left: 3px solid #d97706`) so the analyst can see at a glance
which fields came from templates vs the user's own edits.

**Bilingual EN / FR** — detected from `<html lang>`. Full string table
in `STR.en` / `STR.fr` inside `analyze-lite.js`. Both languages are
first-class; pick by changing the document `lang` attribute or a
fallback default constant in the file.

**Files touched**:

| File | Purpose |
|---|---|
| `public/analyze-lite.js` | The engine (~470 lines). Exposes `window.AnalyzeLite.runReportLite()` + `runExecutiveLite()`. |
| `public/executive-report.html` | Loads the script in `<head>`. Two `⚡ Analyze (lite)` buttons: one in top action row, one in bottom action bar (next to each paused 🔒 AI button). |
| `public/executive.html` | Loads the script in `<head>`. One `⚡ Analyze All (lite)` button next to the paused 🔒 AI button. |

**Re-enable cloud / local AI flow** when Mistral lands:

1. Remove the `disabled` attribute + `style="opacity:.55..."` from the 🔒 buttons (3 places: 2 in executive-report.html, 1 in executive.html).
2. Optionally hide the `⚡ Analyze (lite)` button (or keep it as a "factual rerun" alternative — both can coexist).
3. Restore button labels from "🔒 Analyze (paused)" → "✨ Analyze & Save".
4. Update `actionStatus` text on executive-report.html if desired.
5. Set `AI_PROVIDER=local` in prod `.env` and `pm2 reload --update-env`.

**Known limits / future improvements**:

- `_parseCategoryLines` and `_parseSiteLines` parse the formatted
  strings buildAiSnapshot produces. If that function's output format
  ever changes, the parsers need to keep pace. Pin format if drift
  becomes an issue.
- `executive.html` Lite is intentionally lighter than the AI version
  (which has 4 separate sub-analyses: Monthly Summary, Staff Scorecard,
  Change & Incidents, Customer Voice). Lite fills the 6 visible fields
  with templated commentary using `_baseData` / `_rawRows`; staff
  scorecard sub-analysis is not attempted (would require
  technician-level row scans).
- CSAT recommendation copy is a fixed three-state lookup (both OK /
  CSAT OK only / both below). For more nuance, add intermediate
  states or feed the actual rating distribution.

### AI analyze — local Ollama provider (on-prem privacy switch)

`/api/ai/analyze` (server.js around line 2825) now has a provider switch
controlled by the `AI_PROVIDER` env var. Set `AI_PROVIDER=local` and
restart pm2 — every "Analyze & Save" click stays on the network. ITSM
data (ticket subjects, root causes, customer voice, incident lessons-
learned) no longer leaves the corporate LAN.

The browser is unaware. `executive-report.html` still POSTs an
Anthropic-shape body — the server translates it into an
OpenAI-compatible chat-completions request, talks to local Ollama, and
re-wraps the response back into the Anthropic envelope. Same client
code, same response handling, no deploy on the HTML side.

**Env vars** (`.env` on the prod host):

| Key | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | `anthropic` | `anthropic` (cloud) or `local` (Ollama / LM Studio / llama.cpp / any OpenAI-compatible chat-completions server) |
| `LOCAL_LLM_URL` | `http://localhost:11434/v1/chat/completions` | Ollama default. LM Studio uses `:1234/v1/...`, llama.cpp `:8080/v1/...` |
| `LOCAL_LLM_MODEL` | `mistral-nemo:12b-instruct-2407-q4_K_M` | The tag you pulled via `ollama pull`. Default is Mistral Nemo (France/EU, Apache 2.0, native French). |
| `LOCAL_LLM_TIMEOUT` | `240000` (4 min) | CPU inference can take 1-2 min for a long prompt. Raise if it's hitting 504. |
| `ANTHROPIC_API_KEY` | — | Only required when `AI_PROVIDER=anthropic`. Safe to remove from `.env` once fully on local. |

**Model choice rationale**: Mistral Nemo 12B Instruct (default) is picked
over Qwen2.5 14B for two non-trivial reasons:

1. **EU sovereignty** — Mistral AI is a French company headquartered in
   Paris. ITSM data on Endeavour's network (ticket subjects, root cause
   text, customer voice) stays under the same legal regime as the ops
   that generated it. Avoids Chinese supply-chain concerns that come
   with Alibaba's Qwen family.
2. **Native French quality** — Mistral's training mix is heavily
   European, so French analytical commentary reads native (matters for
   Endeavour's Francophone West African sites: Mana, Houndé, Ity,
   Kalana, Lafigué, Tanda, Dakar, Ouaga).

Trade-off: Mistral Nemo is ~7 GB Q4 vs Qwen's ~10 GB, so it's also
faster on CPU. Quality on multi-KPI reasoning (Prompt 2) is roughly on
par. JSON-mode reliability via `format:'json'` is excellent on both.

**Setup checklist (Windows Server, CPU only, Mistral Nemo 12B):**

1. Install Ollama: download the `.msi` from `https://ollama.com/download/windows` — runs as a Windows service on `localhost:11434`.
2. Pull the model: `ollama pull mistral-nemo:12b-instruct-2407-q4_K_M` (≈7 GB download, ~7 GB RAM in use).
3. Add to `.env`: `AI_PROVIDER=local` (LOCAL_LLM_URL + LOCAL_LLM_MODEL default to the right values).
4. `pm2 reload endeavour-dashboard --update-env`. The `--update-env` flag is required for new env vars.
5. Test: open `executive-report.html`, pick a month, click "✨ Analyze & Save". Expect ~45 s – 75 s per prompt on CPU (three prompts = 2-4 min total).

**Alternative models** if Mistral Nemo doesn't fit your constraints:

| Model | When to pick it | `ollama pull` tag |
|---|---|---|
| `llama3.1:8b` | US-only policy preference, RAM tight, want ~50 s/prompt | `llama3.1:8b-instruct-q4_K_M` |
| `gemma2:9b` | Google ecosystem preference | `gemma2:9b-instruct-q4_K_M` |
| `phi3.5:3.8b` | Very limited RAM (~3 GB), can tolerate weaker reasoning | `phi3.5:latest` |
| `mistral-small:24b` | More RAM available (~14 GB), better quality, **research-only license** | `mistral-small:24b-instruct-2409-q4_K_M` |
| `qwen2.5:14b` | OK with Chinese-origin (Alibaba, Apache 2.0), want max Q4 reasoning | `qwen2.5:14b` |

To swap: `ollama pull <tag>` then set `LOCAL_LLM_MODEL=<tag>` in `.env` and `pm2 reload --update-env`. No code change.

**Translation quirks the server handles transparently:**

- **System prompt placement**: Anthropic uses a top-level `system` field; OpenAI puts a `{role:'system', content:...}` message at the start of the array. `_aiCallLocal` prepends the system message accordingly.
- **Assistant pre-fill trick**: Prompt 1 in the client sends `{role:'assistant', content:'{'}` as the last message — an Anthropic-only feature where the model continues the partial assistant content. OpenAI-compatible servers don't reliably support this. Server-side we (a) strip the pre-fill from the request, (b) force JSON-mode (`format:'json'` + `response_format:{type:'json_object'}`) which guarantees `{...}` output, and (c) strip the leading `{` from the model's response when the client used the trick, so the client's `text = lastMsg.content + text` reconstruction still parses as valid JSON.
- **Temperature**: forced to `0.2` for the local path. Smaller models drift more — tighter temp keeps the analyst tone + structured output stable.
- **Diagnostic errors**: `ECONNREFUSED` → "Is Ollama running? (try: ollama serve)". `ETIMEDOUT` → suggests bumping `LOCAL_LLM_TIMEOUT`. Surfaces in the toolbar status, not just the console.

**Why Mistral Nemo 12B is the default** (see the "Model choice rationale" section above): EU origin + Apache 2.0 + native French + lighter than Qwen 14B + faster CPU inference. Quality is close enough to Qwen on this analyst workload that the sovereignty + speed wins outweigh the few % quality delta on the hardest multi-KPI prompt. If GPU lands later, `mistral-small:24b` (Mistral Small 2409) or `llama3.3:70b` close the gap to Haiku — same env-only swap. Avoid Chinese-origin models (`qwen2.5:*`, `deepseek-*`, `glm-*`, `yi-*`) by policy.

**Fallback policy (today: none)**: when `AI_PROVIDER=local`, failures DO NOT fall back to Anthropic — the privacy guarantee is absolute. If the analyst sees "Local LLM not reachable", the Ollama service is down and the operator fixes it (or temporarily flips `AI_PROVIDER=anthropic` for the duration). A "local with cloud fallback" mode is a 10-line addition if ever needed.

### Inspection delete — branded confirmation modal (`9bd7d56`)

Replaced the native browser `confirm()` dialog with a styled modal in
both `inspection.html` (toolbar 🗑 button) and `inspections.html`
(per-row Delete on the dashboard). Status-aware copy: deleting a
submitted / closed inspection shows a sterner red warning than a
plain draft.

- `inspection.html`: new `#deleteModal` mirroring the existing
  `#submitModal` pattern (same `.modal-backdrop` / `.modal-sheet`
  classes). `deleteInspection()` now opens the modal; the actual
  server DELETE + local cleanup moved into `confirmDelete()`.
- `inspections.html`: new `.del-modal-*` styles + `#delModal` markup
  + per-row Delete handler opens the modal instead of calling
  `confirm()`. Backdrop click, Cancel button, and Escape all dismiss.
  Cancel + backdrop dismiss wired in JS (not inline `onclick`) because
  the script is inside an IIFE — inline handlers can't see IIFE-local
  functions.
- Defensive fallback: if the modal markup is somehow missing at
  runtime, both paths fall back to native `confirm()` rather than
  silently dropping the delete action.

### RAG red softened on tracker roadmap + leaderboard (`a4d9ed3`)

Field-user feedback on the Roadmap page: the brand `#D90038`
(`--edv-red`) reads as a wall of red when many activities are
failing — the full-width 12-month bars compound at full saturation
and visually drown out the amber/green/grey signal.

Switched to `#DC2626` (Tailwind red-600) in three places inside the
activity tracker module:
- `.rm-bar--red` (roadmap bars)
- `.dash-lb__bar-fill--red` (Site Leaderboard score bars on Dashboard)
- inline legend text in the Roadmap hero (`color: '#D90038'` → `'#DC2626'`)

This is the same shade `.hm-cell--red` already used (heatmap), and the
same shade the dashboard charts already used for their "Red (Off
Track)" series — so every red in the activity tracker module is now
**internally consistent on `#DC2626`**.

The brand `--edv-red` / `#D90038` is **untouched everywhere else**
(KPI tile accents, pills, borders, inspection danger, meetings high-
severity, etc.) — at small-accent sizes it reads as colour, not
volume. The override is scoped to the dense-RAG visuals where it
matters.

Also drove a tiny housekeeping change in the same commit: dropped
the `NEW` badge from the Roadmap tab — it shipped weeks ago and
isn't new anymore.

### Architecture in one diagram

```
Browser:
  /activity-tracker.html              entry point (~60 lines, CSP-exempt)
   ├─ _tokens.css / _shell.css        brand surface + production header
   ├─ auth.js                         sets window.__authUser + __userHasRole
   ├─ _shell.js                       renders the navy header
   ├─ Chart.js (CDN)                  dashboard charts
   ├─ activity-tracker/engine.js      scoring engine — pure functions on window.TR
   ├─ activity-tracker/api.js         /api/tracker/* fetch wrappers on window.TRApi
   ├─ React + ReactDOM + Babel (CDN)  same pattern as /dashboard-preview/
   └─ activity-tracker/App.jsx        ~120 KB, all 7 panels + modals
        + activity-tracker/styles.css ~40 KB, brand-token-driven

  /activity-tracker-legacy.html        snapshot of the legacy 779-line page
                                       (fallback during the cutover; can be
                                       deleted in a future maintenance window)

Server (unchanged):
  /api/tracker/{load,save,export,reset}   identical contract pre/post rebuild
  tracker-db.js → tracker.db (SQLite)
  tracker-pptx.js → fixComboChartAxes()
```

### Lessons / patterns to NOT re-discover (Activity Tracker)

| Trap | What we learned |
|---|---|
| **Inline `<span>` for percentage bars** | `<span class="lb__bar"><span class="bar-fill" style="width:69%"/></span>` renders nothing — `width` / `height` don't apply to inline elements. The pillar bars worked because they used `<div>`. **Fix**: use `<div>` for any progress-bar wrapper + fill, OR add `display: block`. Caught on the Site Leaderboard during Phase 3.5 QA. |
| **D mutated in place needs a tick** | React state is the `D` object. Children mutate it in place via `engine.si2()` etc. Without a counter `setMutationCounter(c => c + 1)` to flip on every mutation, React doesn't see the change and the auto-save effect never fires. The `mutationCounter` lives in App state alongside `dirty`. |
| **Two modal scopes coexist** | One `modal` state in SetupPanel (for redistribute / per-pillar confirms — handlers close over per-pillar state) + one `appModal` state in App (for the toolbar's +Year). They share the same `<Modal>` component. Single user = one modal visible at a time, no conflict. |
| **Default month vs server's `currentMonth`** | The server-stored `currentMonth` defaults to 3 (March) from `tracker-init.json`. Users landing on the page saw stale anchoring. Fix: `lastMonthWithData(D, year)` scans `D.inputs[year][site][ix]` arrays for the rightmost non-zero month; boot uses that as the default S.month. |
| **Roadmap line meaning ambiguity** | A single vertical line on a 12-month Gantt is ambiguous — selected period? today? Fix: render two lines (solid orange = S.month, dashed grey = calendar today) with inline legend pills in the hero. The today line is suppressed when it coincides with S.month (which is the common case thanks to the smart default). |
| **CSP for JSX-at-runtime pages** | The new tracker uses React + Babel via CDN (in-browser JSX transform = needs 'unsafe-eval'). server.js has a path-scoped CSP override at `app.use((req, res, next) => ...)` that grants `unsafe-eval` + unpkg.com only on `/activity-tracker.html`, `/activity-tracker/*`, `/dashboard-preview/*`, `/design-system/*`. The production CSP on every other live page is untouched. |
| **Brand red `#D90038` is too heavy for full-width RAG bars** | Brand `--edv-red` (`#D90038`) is high-saturation pure red. Tiny accent uses (pills, borders, KPI strips) read as "colour"; full-width filled bars (Roadmap rows, leaderboard score bars) read as a wall of red and drown out amber/green/grey signal when many activities are failing. **Fix 2026-05-24** (`a4d9ed3`): override to `#DC2626` (Tailwind red-600) scoped to `.rm-bar--red`, `.dash-lb__bar-fill--red`, and the Roadmap legend text. Same shade `.hm-cell--red` and the dashboard charts already used, so the whole tracker module is now internally consistent on `#DC2626`. The brand red stays the canonical token for everything else. Rule of thumb for future RAG visuals: if the red surface is >100 px wide and filled, prefer `#DC2626`; if it's a small accent, use the brand token. |
| **Single-child dropdowns look broken** | When a user has access to only ONE visible child of a parent nav item (typical: a viewer sees only Site Reports under Reports, not Deck Builder), a dropdown with one item + redundant caret reads as a UI bug. **Fix** (`206860f`): `renderNavItem` in `_shell.js` collapses a single-visible-child parent to a flat link pointing straight to that child. Hover state, active state, and `data-section` matching all still work; the caret just disappears. Applies dynamically per user — same NAV literal renders differently per role. |

---

## ⚡ Prior state (as of 2026-05-23)

> **READ FIRST.** Branch `claude/busy-kirch-2a4176` is now **~37 commits
> ahead of origin** (still NOT pushed). Tip: `211ccbd` (voice dictation
> duplicate-words fix). Two huge feature waves shipped today:
>
> 1. **Meetings & Council Escalations module v2** — full rewrite of the
>    earlier v1 (which was never deployed). Meeting-centric digital twin
>    of the Endeavour Mining Group IT × Mines operating system. Plus
>    bulk Excel import for historical PVs and a "since last meeting"
>    pre-brief diff view for the IT coordinator.
> 2. **Inspection module hardening** — 2 new checklist categories
>    (Servers + Datastores), visible server-sync diagnostics in the
>    form toolbar, and a fix for the voice-dictation duplicate-words
>    bug a field user reported.
>
> Prior 2026-05-16 and 2026-05-12 handoffs are preserved further down.

### What landed today

| Area | What | Commit |
|---|---|---|
| Meetings v2 schema + API | 11 bilingual lookups, 6 core tables, 14 API routes, defensive children contract, two-sided cross-site write guard | `b4848d4` |
| Meetings v2 list + editor | `meetings.html` + 7-section PV editor (`meeting.html`) + audit thread + quick-comment box + 5 Engagements local snapshot | `a439831` |
| Meetings v2 companion views | `meetings-issues.html` (flat log), `meetings-council.html` (theme-grouped escalations), `meetings-compliance.html` (5 Engagements monitor) + nav + CLAUDE.md | `4e37ccb` |
| Bulk Excel import | `meetings-import.js` (xlsx-based) + 3 routes (template / preview / commit) + `meetings-import.html` UI + xlsx dep | `e8cf5bc` |
| "Since last meeting" diff | `compareDepartment()` in `meetings-db.js` + `/api/meetings/progress` + `meetings-progress.html` + deep-link from `meeting.html` sticky bar | `e8cf5bc` |
| Label fix + self-healing migration pattern | "InfoTech Survey" → "IT Survey" on the live row via idempotent UPDATE in `_initSchema` | `4a38a92` |
| Inspection save diagnostics | Toolbar shows server-sync state ("✓ Saved (local + server HH:MM)" vs "✓ Saved locally · ⚠ Server queued") + toast on POST failure + `__inspectionSync.lastServerError` + server-side `[Inspection] save ok …` log | `05ddc4f` |
| Inspection: Servers + Datastores categories | Two new checklist categories (`srv` + `sto`, 12 items each, bilingual) inserted between `net` and `rack`. **15 → 17 categories.** | `05ddc4f` |
| Voice dictation duplicate-words fix | Web Speech API idempotency — rebuilt transcript-buffer logic so duplicate `isFinal` emissions (Chrome bug on flaky networks) collapse instead of doubling | `211ccbd` |

### Lessons / patterns to NOT re-discover

| Trap we hit today | What we learned |
|---|---|
| **`npm install xlsx` on prod FAILS** (Visual Studio C++20 error in better-sqlite3) | better-sqlite3 9.4.3 has no prebuilt for Node 24 and node-gyp falls back to source compile which needs C++20. Prod VS Build Tools default to C++17. Same problem on the dev box. **Workaround**: xcopy `node_modules/xlsx/` directly from dev → `Z:\node_modules\xlsx\` — xlsx is pure JS, no native bindings, ~7 MB. No npm involved. Followup: upgrade better-sqlite3 to ^11 (has Node 24 prebuilds) as a separate change. |
| **Editing seed JSON doesn't fix already-seeded rows** | The first-run seed gate in every `*-db.js` (`if (n === 0) _seedLookups(db)`) means re-running on an existing DB is a no-op. To rename / fix a live row, add a one-time **idempotent UPDATE** below the seed gate. Only touches rows that still carry the old value; logs once on the affected reload; no-op forever after. Same file safe to ship indefinitely. Example: see the `survey` rename block in `meetings-db.js:_initSchema()`. |
| **Web Speech API duplicate-emits** (push-to-talk repeated words) | Chrome's `webkitSpeechRecognition` can emit the same `isFinal=true` chunk twice on flaky networks. The classic `_recBaseText += finals` accumulator doubles the transcript. **Fix**: track three buffers (initial / committed-from-prior-sessions / current-session) and **rebuild current-session from scratch on every onresult event** — duplicate emits collapse to the same value. Cross-session boundary handled in `r.onend` before re-issuing `r.start()`. |
| **Form looked like it was saving but wasn't** | Toolbar's "✓ Saved" only reflected localStorage save, not the server POST result. Patched debounced `saveCurrent` to surface server-sync state separately ("server-ok" / "server-fail" CSS classes + toast on first failure of a streak). Also added a server-side audit log: `pm2 logs endeavour-dashboard --lines 200 --nostream \| findstr Inspection`. |
| **Two sources of truth for inspection categories** | The form has an inline `CATEGORIES` const (line 1454 of `inspection.html`), AND `inspection-init.json` seeds the DB's `_findItemDef()`. **Both must be edited together** or findings save fine but reports/PPTX lose item text. (No DB migration needed — `_findItemDef` reads from the JSON at module load time.) |

### Deployment paths used today

| Asset | How it deploys |
|---|---|
| `.js`, `.html`, `.json`, `.css` in worktree | `_deploy.cmd` (auto-staged on commit) → `xcopy /Y` over the SMB share `Z:\` |
| New `node_modules/<pkg>/` (pure JS only) | Manual one-liner: `xcopy "<worktree>\node_modules\<pkg>" "Z:\node_modules\<pkg>\" /E /Y /I` — bypasses npm so better-sqlite3's native binding stays intact |
| Native-binding deps | Don't try from dev — risk nuking better-sqlite3 on prod. Schedule a maintenance window + upgrade better-sqlite3 first. |

### Open / future items (carried forward)

- **Push to origin**: branch is ~37 commits ahead, never pushed. `git push -u origin claude/busy-kirch-2a4176` when ready for review.
- **CH-273 Phase B** — still pending PKI wildcard cert. See prior state below.
- **Goldy mascot assets + Franklin Gothic WOFF2** — still pending from EDV brand team (see 2026-05-12 handoff).
- **better-sqlite3 ^11 upgrade** — would let `npm install` work cleanly on Node 24. Single-package change, modest behaviour risk; do it in a dedicated maintenance window.
- **Zoho Survey API integration** — user confirmed the IT Survey is done with Zoho Survey. Future: a `/api/meetings/sync/survey` route that auto-pulls responses into draft issues under `intake_source = 'survey'`. Needs the Zoho Survey scope added to the existing OAuth refresh token + a sample response payload to design the question→field mapping.
- **Pre-existing Zoho Desk schema warnings** (`requests/Request — MISSING columns: Request ID`, `survey/Results — MISSING columns: Survey Name`, `ViewSchemaCheck: Invalid URL`) — unrelated to today's work, flagged by the user as low-priority.

---

## ⚡ Prior state (as of 2026-05-16)

> Today's session added the **IT Inspection module** end-to-end (form
> + dashboard + API + PPTX + nav). The 2026-05-23 work above LANDED ON
> TOP of this state; the 2026-05-12 handoff below is older still.

### Inspection module — what landed on 2026-05-16

| Area | What | Status |
|---|---|---|
| Schema + seed | `inspection-init.json` (10 sites · 26 areas · 6 types · 15 categories · 149 items — **expanded to 17 categories · 173 items on 2026-05-23**) | ✅ |
| DB layer | `inspection-db.js` — SQLite (`inspection.db`), CRUD + aggregate + cross-site write guard | ✅ Smoke-tested |
| API routes | `/api/inspection/{lookups,list,aggregate,:id,save,export,aggregate/export,reset}` in `server.js` | ✅ Wired |
| Form page | `public/inspection.html` — port of `IT_Inspection_SDP.html` + brand tokens + CSP nonce + offline-queue server-sync | ✅ |
| Dashboard | `public/inspections.html` — KPI tiles + filters + monthly trend bars + table | ✅ |
| Nav | "Inspections" entry added to Performance ▾ in `_shell.js`; `clipboard-check` / `camera` / `mic` icons added to `brand/icons.js` | ✅ |
| PPTX | `inspection-pptx.js` — 4-slide single deck + 4-slide aggregate, 13.33"×7.5" canvas | ✅ Smoke-tested |

See the §"IT Inspection Module" section further down for architecture,
schema, API contract, and known pitfalls.

---

## ⚡ Prior state (as of 2026-05-12)

> Brand-system merge + executive page audit shipped on this date. Two open items
> below remain across sessions.

### Branch you should be on

`claude/busy-kirch-2a4176` — the main working branch. **30 commits ahead of
origin** (not yet pushed). Latest commit is `b6e2145` (brand handoff doc).
The merge commit for today's work is `9882318`.

### What landed today (already on `claude/busy-kirch-2a4176`)

| Area | What | Status | Reference |
|---|---|---|---|
| **HTTPS migration (CH-273)** | IIS reverse-proxy + `https://itops-dashboard.edv-ops.com` cutover | ✅ Live with placeholder cert; awaiting wildcard `*.edv-ops.com` from PKI | `docs/CHANGE_REQUEST_HTTPS_LOGIN.md` + `docs/ROLLOUT_BACKOUT_CHECKLIST.md` |
| **Brand design system Phase 1** | Tokens (CSS + JS), icon library, login hero, Goldy infrastructure, nav SVG icons | ✅ Merged via `9882318` | `docs/BRAND_HANDOFF.md` — read this FIRST when extending the brand work |
| **Emoji → SVG icon migration** | ~30 buttons / headings across index, reports, executive, executive-report, activity-tracker, analytics | ✅ Done for high-visibility surfaces; keep ✓ ✕ ⚠ ✏ 🟢🟡🔴 😊😟 as text (BMP / functional) | `public/brand/icons.js` library + `BRAND_HANDOFF.md` policy section |
| **Executive page audit fixes** | Phantom groups removed (CAB / Dakar / IT Agents); ITY + Kalana added to site filter; `avgResolveDays` aligned with AP (Math.floor per ticket on all paths); `isResOverdue` + `xRows` hoisted to `dashboard-shared.js` | ✅ Merged | Commits `6052eab` + `37c2b28` |
| **executive-report.html drift fix** | Local `isResOverdue` was missing `'confirm resolution'` variant — same ticket counted as a violation on this page but not others. Now consumes shared lib. | ✅ Merged | Commit `37c2b28` |
| **`executive.html` Chart.js race** | `<script ... defer>` removed; inline script at line 2608 called `Chart.defaults.*` at parse time | ✅ Fixed (commit `feffa00`) | — |
| **Activity Tracker tab icon sizing** | Raw SVG inserted without wrapper → browser stretched to ~60 px. Fix: emit `width="1em" height="1em"` directly on the `<svg>`. | ✅ Fixed (commit `70bdf14`) | — |

### Operational notes from 2026-05-12 (post-merge)

- **Node heap raised to 4 GB on prod** to stop the recurring 2 GB OOM crash that
  surfaced after the merge deploy (caused stuck "Connecting to data proxy…" splash).
  PM2 now starts with `--node-args="--max-old-space-size=4096"`. See the OOM row
  in Known Pitfalls for the re-apply command if PM2 ever gets reset.
- **Underlying memory leak is a separate ticket** — heap ceiling is a band-aid;
  Node still trends upward over hours. Suspects: `_rawCache` retention,
  `syncRequestData()` not releasing the 51 700-row Zoho fetch, or `stripPiiColumns`
  regexing huge arrays. Worth a heap-snapshot diff session.

### What's still open (carry to next session)

1. **CH-273 Phase B — pending PKI wildcard cert delivery**
   - Currently dashboard is reachable at `https://itops-dashboard.edv-ops.com`
     with a placeholder cert (red "Not secure" banner). The wildcard
     `*.edv-ops.com` is in flight with PKI.
   - When the `.pfx` arrives: IIS Manager → Server Certificates → Import →
     bind to the IT-Dashboard site (replaces placeholder). 2-minute job.
   - **After cert binding**, run Phase B (BIND_HOST=127.0.0.1 + firewall
     rule + sign-off email to Cezar + Alexis). Full runbook at
     `docs/ROLLOUT_BACKOUT_CHECKLIST.md` §3.
   - Open question: confirm corporate domain suffix is **`edv-ops.com`**
     (already used in all docs; awaiting final PKI confirmation).

2. **Goldy mascot assets + Franklin Gothic WOFF2** — pending from EDV brand team
   - Drop 5 PNGs into `public/brand/goldy/` (named per the README) and the
     login hero / empty-states light up automatically.
   - Drop licenced Franklin Gothic WOFF2 into `public/brand/fonts/` and add
     `@font-face` in `_tokens.css`. Until then Libre Franklin (Google
     Fonts) substitutes — ~95 % visual match.

3. **Phase 2 of brand rollout** (deferred deliberately)
   - Per-PPTX-slide migration from legacy `C.*` palette to brand `EDV.*`.
     Visual change to deliverables — needs per-slide design review.
   - `docs/BRAND_HANDOFF.md` §"What's NOT in Phase 1" lists all deferred items.

### Branches preserved but not merged

- **`perf/index-windowed-load`** (`1a9930c`) — windowed-load optimisation
  of `/api/data/requests-raw`. Reverted in the working branch because
  wall-clock improvement didn't materialise; row count dropped ~50 % but
  TTFB barely moved. **Real bottleneck is server-side `JSON.stringify` on
  the warm cache, not payload size.** Available for revisiting:
  pre-stringify common window slices once during sync and serve the bytes
  directly. **Do NOT re-propose the row-windowing approach without first
  measuring `res.json()` time on the server.** Branch preserved for
  reference.

- **`brand/design-system-phase-1`** — the feature branch merged into
  `claude/busy-kirch-2a4176` as commit `9882318`. Already-merged; safe to
  delete with `git branch -d brand/design-system-phase-1`.

### Deployment status

`_deploy.cmd` is staged with **26 files** since the last successful deploy.
Run it from the dev laptop when ready to push everything to `Z:\`. Then on
prod: `pm2 reload endeavour-dashboard --update-env`. (All HTML files in
`_htmlCache` require a reload to refresh.)

The repo is **not pushed to origin**. `git push` when ready.

### Key reference docs in `docs/`

| Doc | Read when |
|---|---|
| `BRAND_HANDOFF.md` | Touching any visual layer / icons / tokens / typography |
| `CHANGE_REQUEST_HTTPS_LOGIN.md` | Anything related to CH-273 / cert binding / Phase B |
| `ROLLOUT_BACKOUT_CHECKLIST.md` | Executing Phase B or rolling back |
| `INTERNAL_TLS_SETUP.md` | IIS / cert / appcmd issues |

---

## Project Identity

**Name**: Endeavour Mining SDP Dashboard
**Stack**: Node.js + Express + SQLite (better-sqlite3) + PM2 on Windows Server
**PPTX**: pptxgenjs
**Production path**: `C:\Apps\SDP-Dashboard\` *(on the remote server)*
**Production via SMB share**: `Z:\` *(remote `C:\Apps\SDP-Dashboard\` mapped on the dev box)*
**Local/dev path**: `C:\Users\Admin\Documents\SDP-Dashboard\`
**Worktree path**: `C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-*\`
**Port**: 3456
**PM2 app name**: `endeavour-dashboard`

> **When Claude is working in this folder it is already in the workspace — edits go live on copy to `Z:\` (the SMB-shared production path).**

### Deploy commands — ZIP package model (2026-07-08+; the Z:\ xcopy model is RETIRED)

Prod deploys are now done with a **self-contained ZIP** copied to the server —
**no `Z:` drive mapping**. The workflow:

```cmd
:: 1) DEV BOX — build the package (post-commit regenerates _deploy.cmd to do this)
_deploy.cmd
::    → runs tools\deploy\make-deploy-zip.ps1
::    → produces  sdp-deploy_<sha>_<stamp>.zip  in the repo root
::    (every file changed since .git/last-deployed, at its repo-relative path
::     under files\, + DELETIONS.txt + MANIFEST.txt + _apply_on_prod.cmd)

:: 2) copy the .zip to the PROD server, extract it anywhere, then FROM the extracted folder:
_apply_on_prod.cmd
::    → xcopy files\* into C:\Apps\SDP-Dashboard  (override with SDP_PROD_DIR)
::    → processes DELETIONS.txt

:: 3) PROD — restart (server.js + boot-cached HTML need it; render.py is copy-only)
_pm2_restart_prod.cmd          :: pm2 stop -> timeout /t 5 -> start  (NOT reload)
```

Then each user presses **Ctrl+F5** once. The packager advances
`.git/last-deployed` to HEAD after building the ZIP. Dev-only paths are excluded
(`iis/`, `docs/`, `tools/deploy/`, `tools/exec-pptx/{fixtures,refs}/`, the ZIP +
`_deploy.cmd`/`_apply_on_prod.cmd` themselves).

> Claude CAN build the ZIP itself (PowerShell tool → `make-deploy-zip.ps1`), but
> **cannot copy it to prod or run pm2** — the user does steps 2-3 on the server.
> The old `Z:\` SMB path is no longer used for deploys.

---

## Key Files

| File | Purpose |
|------|---------|
| `server.js` | Express API, sync jobs, PM2 entry point. **Being split** — see `routes/` (split-server.js pilot). |
| `routes/inspection.js` | First module extracted from server.js (split pilot, 2026-06-21). Factory `module.exports = (deps) => router` — DI pattern: server.js passes `{ express, inspectionDb, inspectionPptx, rdb, require* middleware, getRawCache }` and does `app.use(require('./routes/inspection')(deps))`. Handlers byte-identical to the old inline ones. Tested by `tests/inspection-routes.test.js`. **Pattern to copy for future extractions** (meetings, tracker, risk-register…). |
| `services/blobStore.js` | Filesystem blob store (`<DATA_DIR>/blobs/<module>/<owner>/…`) — keeps inspection photos/signatures (and future blobs) OUT of SQLite. Path-traversal-guarded, SDP_DATA_DIR-aware. |
| `services/report*.js` + `siteReport*.js` | **Reporting Suite Foundation** (branch `feat/reporting-suite`) — `reportConfig.js` (delivery settings k/v), `reportDirectory.js` (per-site recipients), `reportSchedule.js` (schedules + Task Scheduler bridge), `reportSentLog.js` (dedup/audit send log), `siteScore.js` (composite RAG score + two-moves), `siteReport.js` + `siteReportDeps.js` (per-site report composer + DI deps), `reportRender.js` (PDF), `mailer.js` (SMTP send). All backed by 4 reports.db tables auto-created at boot (sqlite `_initSchema` / pg `005_reporting.sql`); pg copy via `tools/pg/copy-reports-reporting.js`. |
| `services/pgDb.js` | **Reusable async PostgreSQL adapter** (Chunk 1 of the PG migration). better-sqlite3-shaped surface: `prepare(sql).get/all/run` (async), `exec`, `runTransaction` (AsyncLocalStorage), `?`→`$N` translate, NUMERIC type-parser, `RETURNING *` for bare INSERTs. Module-agnostic — **Chunks 2-4 (meetings/inspection/reports.db) copy this same adapter + recipe.** Selected per-module by a `TRACKER_BACKEND=sqlite\|postgres` style flag; prod stays `sqlite` until cutover. See `tools/pg/README.md`. |
| `db/postgres/tracker/001_init.sql` + `tools/pg/copy-tracker.js` | Postgres tracker schema (legacy+v2, FK CASCADE, type-preserving `*_json` TEXT / `active` INT / `target` TEXT) + one-shot idempotent `tracker.db`→PG copy. Tests: `tests/pg-tracker.test.js` (+ `tests/pg-helpers.js`) — `PG_ADMIN_URL=… node --test tests/pg-tracker.test.js`; skips cleanly with no PG. |
| `reports-weekly-pptx.js` | Weekly PPTX **and** all `slideMonthly*` monthly slide functions |
| `reports-monthly-pptx.js` | Dedicated monthly PPTX generator — FORKED `slideMonthly*` (feeds v2 + all-sites decks; NOT identical to the weekly file's copies — see the slideMonthly* audit section) |
| `reports-pptx-shared.js` | Shared pure RAG/trend helpers (`statusColor`, `trendArrow`, `trendColor`, `computeTrends`, `autoStatusColor`) deduplicated out of both PPTX files. Edit here, not in copies. |
| `reports-db.js` | All SQLite queries (`getMonthlyData`, `getHelpdesk6MonthHistory`, `getCalendarMonthlyHelpdesk`, `getYearlySummary`) |
| `public/lib/dashboard-shared.js` | **Canonical helpers** consumed by every page — `parseZohoDT`, `isClosed`, `isResOverdue`, `xRows`, `OPS_GROUPS_DEFAULT`, `APPS_GROUPS_DEFAULT`, `IT_HELPDESK_GROUPS`. Single source of truth for KPI math. **Edit here, NOT in individual pages.** |
| `public/_tokens.css` | **Canonical design tokens** (palette, typography, spacing, radius, shadow) — every page imports this |
| `public/brand/brand-tokens.js` | JS mirror of `_tokens.css` for PPTX generators. Keep in lockstep with the CSS |
| `public/brand/icons.js` | Lucide-style icon library (`window.EDV_ICONS.html('name')`). Loaded by every page before `_shell.js` |
| `public/brand/icons.css` | `.icon` class system with size + tint modifiers |
| `public/brand/components.css` | `.edv-empty-state`, `.edv-hero`, `.edv-section-divider`, `.edv-goldy-badge` patterns |
| `public/_shell.js` + `_shell.css` | Header nav + dropdown rendered by every page that loads `_shell.js` |
| `tracker-db.js` | SQLite persistence for Activity Tracker (`tracker_config`, `tracker_targets`, `tracker_inputs`) |
| `tracker-pptx.js` | Server-side 2-slide PPTX generator for IT Activity Tracker |
| `tracker-init.json` | Default seed data — activities list, pillar weights, targets, active sites |
| `public/activity-tracker.html` | IT Activity Tracker UI — 10 sites, 31 activities, 4 pillars, RBAC |
| `public/tracker-icons/` | 8 PNG icon files embedded in tracker PPTX (logo, 4 pillar icons, green/amber) |
| `public/index.html` | Main helpdesk dashboard |
| `public/reports.html` | Weekly + monthly report UI |
| `public/executive.html` | Executive Scorecard — 5 tabs (KPI Snapshot · Action Plan · Tech Scorecard · Change & Incidents · Customer Voice). Includes Multi-Touch Rate, Verbatim Explorer, deterministic Analyze Lite |
| `public/executive-report.html` | Executive report (deck builder) with localStorage presets + AI Analyze & Save |
| `public/activity-tracker.html` | IT Activity Tracker — 10 sites, 31 activities, 4 pillars, RBAC auth |
| `public/inspection.html` + `inspections.html` | IT Inspections — form + dashboard, 17 categories / 173 items, photos, signatures, PPTX |
| `public/inspection-actions.html` | Corrective Actions Register — flat list of all `insp_actions` across inspections, per-action status change (editor+) via `POST /api/inspection/actions/:id/update`, closable even when the parent inspection is submitted/closed. Reached from a button on `inspections.html`. Sibling of `meetings-actions.html` |
| `public/meetings-actions.html` | Meetings Actions Register — flat list of all `md_actions` across PVs, per-action close via `POST /api/meetings/actions/:id/update` (works even on a closed PV — actions outlive the meeting). `✔ Actions` tab on every meetings module page. Audit in `md_action_updates` |
| `inspection-db.js` + `inspection-pptx.js` + `inspection-init.json` | Inspections SQLite layer + 4-slide PPTX generator + seed data |
| `public/meetings.html` + `meeting.html` + `meetings-issues.html` + `meetings-council.html` + `meetings-compliance.html` + `meetings-import.html` + `meetings-progress.html` + `meetings-insights.html` | Meetings & Council Escalations module v2 — PV editor, Issues Log, Council theme grouping, 5 Engagements compliance, bulk Excel import, "since last meeting" diff, **analytical dashboard with 6 Chart.js charts + 5-Engagements heatmap + site leaderboard** |
| `meetings-db.js` + `meetings-init.json` + `meetings-import.js` | Meetings SQLite layer + seed data (11 bilingual lookups) + xlsx bulk import parser |
| `risk-register-export.js` | Risk Register monthly Occurrence export — 5-domain classifier, SDP→register site alias mapping (SQLite-backed config in `reports.db`), xlsx (SheetJS CE) writer. Card lives at `reports.html#admin` for super_admin |
| `public/analyze-lite.js` | Deterministic Voice-of-Customer + Voice Insights analysis engine (no AI, no network, ~470 lines, bilingual EN/FR) |
| `public/help.html` | Bilingual EN/FR user manual — covers all 14 sections |
| `_recover_better_sqlite3_prod.cmd` | Emergency: rebuild better-sqlite3 native binding on prod after an npm operation breaks it. Bypasses corporate SSL inspection for the prebuild download. Run from prod cmd.exe at `C:\Apps\SDP-Dashboard\` |
| `_uninstall_exceljs_prod.cmd` | Optional cleanup: removes the unused `exceljs` + 80 transitive packages from prod after the xlsx switch. Run from prod cmd.exe |
| `public/auth.js` | Unified auth helper — roles: super_admin > executive > admin > editor > viewer + feature roles (tracker-admin, tracker-editor, report-author, audit-viewer, scorecard-viewer). `data-require` accepts a pipe-separated OR list (`"admin\|scorecard-viewer"`). scorecard-viewer (2026-06-12) = read-only access to executive.html + analytics.html without the executive/admin write powers; AI Analyze + PPTX export stay blocked server-side by report-author |
| `RENEW_ZOHO_TOKEN.html` | Runbook for renewing the Zoho OAuth refresh token (8 steps) |
| `ANALYTICS_PLUS_API_SCOPES.md` | Canonical scope reference — **use `MEAplus.fullaccess.all`** (the narrower read-only scopes trigger 7301) |
| `get-token.js` | Token exchange utility — supports `--dc=com/eu/in/au` and `--verbose` flags |

> **Critical rule — `slideMonthly*` functions have FORKED across the two tracked
> files** (`reports-weekly-pptx.js` and `reports-monthly-pptx.js`). They are **no
> longer identical copies** — each set feeds a *different* live deck (see the
> usage table below). **Do NOT blind-merge a `slideMonthly*` change into "the
> other copy"** — that would change the output of a deck it doesn't belong to.
> Edit the version that belongs to the deck you're changing, and rely on the
> golden fingerprint test to confirm you didn't disturb the others.

### `slideMonthly*` duplication — actual state (2026-06-21 audit)

A function-by-function diff of the two files found that **only the small pure
RAG/trend helpers were ever truly identical**; everything else has legitimately
diverged. Result of the 2026-06-21 dedup pass:

**Deduplicated → `reports-pptx-shared.js`** (single source of truth, imported by
both files): `statusColor`, `trendArrow`, `trendColor`, `computeTrends`,
`autoStatusColor`. Unit-tested in `tests/pptx-shared-helpers.test.js`.

**Left forked on purpose** — these differ between the two files and unifying any
of them is a *visual/design decision*, not a mechanical dedup:

| Symbol | How they differ | Why forked |
|---|---|---|
| `addTitle` | weekly fontSize 28 / y 0.15 · monthly 24 / 0.12 | different title sizing per deck |
| `addSectionBadge` | monthly added an `h` param + font 10 (weekly 11) | monthly needs variable-height banners |
| `const C` palette | values differ | each deck tuned independently |
| every `slideMonthly*` renderer | different signatures (`prevReport`, `reportMonth`, `openChanges`) + bodies | feed different generators (see usage table) |

**Which deck each file actually powers** (server.js call sites):

| Generator (exported) | File | Server route |
|---|---|---|
| `generateWeeklyPptx` | weekly | weekly download |
| `generateMonthlyPptx` | weekly | per-site monthly download |
| `generateWeeklySummaryPptx` | weekly | all-sites weekly summary |
| `generateMonthlyPptxV2` | monthly | per-site monthly **v2** |
| `generateAllSitesMonthlyPptx` | monthly | all-sites monthly |

> `generateMonthlyPptxV2` / `generateAllSitesMonthlyPptx` are *also* exported by
> the weekly file but those copies are **dead** — the server always calls the
> `reports-monthly-pptx.js` versions (`rpptxMonthly.*`).

**Safety net — golden fingerprint test.** `tests/pptx-monthly-golden.test.js`
seeds a throwaway DB (`SDP_DATA_DIR`), renders **all 5 live decks**, and compares
a per-slide structural fingerprint (text runs + shape/pic/chart counts) to
`tests/__golden__/pptx-fingerprint.json`. Run it before/after any PPTX edit:
```
node --test --test-force-exit tests/pptx-monthly-golden.test.js
```
After an INTENTIONAL visual change, regenerate the golden:
```
GOLDEN_UPDATE=1 node --test --test-force-exit tests/pptx-monthly-golden.test.js
```

> _2026-06-02 update_: `reports-pptx.js` was a third copy referenced here
> historically; deleted in commit `94c549e`. Duplication is across TWO files only.

The other shared helpers (`kpiTile`, `metricCard`) are defined *inline inside*
their slide functions (closures), so they aren't trivially extractable and stay
per-file. Grep both files before assuming a helper is shared.

### KPI denominator doctrine — ITSM standard (added 2026-06-02)

**For any percentage KPI that gates a verdict** (SLA compliance, Reopen Rate, FRT compliance, Change Success Rate), the dashboard uses the **ITSM industry-standard denominator** rather than the AP-canonical "/total" denominator. See `FORMULA_RECONCILIATION.md` §6 for the four documented divergences (D1–D4) and the rationale.

When adding or modifying a percentage KPI, default to:

```
Reopen Rate            = reopened-of-closed / closed         (NOT /total)
Resolution SLA %       = (closed AND not overdue) / closed   (NOT /total)
First Response SLA %   = (responded AND not violated) / responded  (NOT /total)
Change Success Rate    = successful / executed               (executed = success + failed + backed_out;
                                                              cancelled + rejected EXCLUDED)
```

The verdict-only denominator pattern is implemented uniformly across:
- `reports-db.js` aggregate helpers (getCalendarMonthlyHelpdesk, getMonthlyHelpdeskHistory, getSlaTrendDB, getSlaByCategoryDB, getRequestMetrics, _aggregateHelpdesk6MoFromRaw)
- `public/executive.html` + `public/executive-report.html` (KPI tiles + AI snapshot + PPTX slide builder)
- `public/index.html` (Res SLA + 1st Reply SLA tiles + technician table)
- `executive-new-report.js` (server-side PPTX generator)
- `server.js /api/reports/helpdesk-charts` route

If you introduce a new surface that displays one of these KPIs, follow the existing helper or replicate the closed/responded-only denominator pattern. **Do not regress to /total.**

---

## Legacy local-only files (DO NOT modify — not in git, not deployed)

These files exist in `C:\Users\Admin\Documents\SDP-Dashboard\` but are listed under `LEGACY / ONE-OFF SCRIPTS` (or `RUNTIME DATA`) in `.gitignore`. They are **not** in the GitHub repo and **not** deployed to `C:\Apps\SDP-Dashboard\`. Editing them changes nothing in production. If a future session is tempted to "fix" or extend them, stop — they are scratch artifacts retained for reference, not active code.

| File / pattern | What it was |
|----------------|-------------|
| `generate-executive-pptx.js` | Older standalone CLI — composited screenshot PNGs (`--kpi`, `--tech`, etc.) into `IT_Operations_Monthly_Report_COMPACT.pptx` (template lives outside the repo, referenced only in local-only `NEW_CONVERSATION_PROMPT.md`) |
| `generate-executive-pptx-v2.js` | Newer standalone CLI — built native pptxgenjs charts from `--data data.json`. Superseded by the executive flow served from `server.js` + `public/executive-report.html` |
| `generate-monthly-report.js`, `generate-site-monthly-pptx.js` | One-off monthly / per-site PPTX builders |
| `make_monthly_report.js`, `make_group_reports.js`, `make_group_reports_endeavour.js` | Earlier `make_*` family of report scripts |
| `executive-new-report.js` | Helper for the original "new report" workflow |
| `server-minimal.js` | Zero-dependency drop-in for `server.js` (uses only Node built-ins). Kept as a fallback for restricted environments — not loaded by PM2 |
| `get-token.js` | Standalone Zoho OAuth token-exchange utility (one-off) |
| `extract_feb2026_data.js`, `extract-cache.py`, `data/extract_*.js` | Ad-hoc data extraction scripts run for specific months |
| `unpacked_tmpl/` | Unpacked PPTX template tree — scratch, regeneratable |
| `slide_qa*.jpg`, `smoke-check*.jpg`, `tmpl_thumb.jpg`, `chart_*.png` | QA / smoke-test screenshots |

The active executive flow lives in `server.js` (canonical runtime) + `public/executive-report.html`. Token rotation only needs `.env` + `server.js`. Each legacy script above has its own `getToken()` / `addChrome()` etc., but those duplications are **not a maintenance concern** because no one runs them in production — leave them alone.

If you find one of these files referenced in `package.json` scripts, in a `server.js` route handler, or in a Windows Task Scheduler entry, that's a sign it should be moved out of `.gitignore` and back into the live app — surface that finding rather than silently editing the file.

---

## PPTX Canvas — Canonical Dimensions

| Property | Value |
|----------|-------|
| Slide width | 13.33" |
| Slide height | 7.50" |
| Left margin x | 0.30" |
| **Content width** | **12.73"** (= 13.03 − 0.30) |
| Safe bottom y | 7.38" |

**Every table, chart, badge, and panel must use `x=0.3, w=12.73`.**
No slide should use 9.4", 9.0", or any narrower content width.

---

## Helpdesk Slides — Shared KPI Strip Design

Both `slideHelpdeskMetrics1` (weekly) and `slideMonthlyHelpdesk` (monthly) use
the **exact same layout**. Do not change one without changing the other.

### Tile geometry

```js
const tileW = 3.15;   // tile width (4 tiles fit in 12.73" with 0.04" gaps)
const tileG = 0.04;   // gap between tiles
const tileH = 0.40;   // tile height
const tX    = i => 0.3 + i * (tileW + tileG);
// Row y positions:
//   row 0: y = 0.62
//   row 1: y = 1.12   (0.10" gap between rows)
```

### Tile internal layout — absolute y offsets (never use valign top/bottom)

```
y+0.03  h=0.10  LABEL  fontSize 6.5, bold true, color '111111', valign 'middle'
y+0.13  h=0.16  VALUE  fontSize 14,  bold true, color C.blue,   valign 'middle'
y+0.29  h=0.08  DELTA  fontSize 6.5, color varies,              valign 'middle'
```
Left accent bar: `w=0.06, h=tileH` in the tile's accent color.

### `kpiTile` helper (canonical — copy verbatim)

```js
const kpiTile = (col, row, label, value, deltaStr, deltaColor, accent) => {
  const x = tX(col);
  const y = row === 0 ? 0.62 : 1.12;
  slide.addShape('rect', { x, y, w: tileW, h: tileH, fill: { color: 'FFFFFF' }, line: { color: 'DDDDDD', pt: 0.5 } });
  slide.addShape('rect', { x, y, w: 0.06,  h: tileH, fill: { color: accent  }, line: { color: accent,   pt: 0 } });
  slide.addText(label, {
    x: x+0.1, y: y+0.03, w: tileW-0.15, h: 0.10,
    fontSize: 6.5, bold: true, color: '111111', fontFace: 'Calibri', valign: 'middle'
  });
  slide.addText(String(value ?? '—'), {
    x: x+0.1, y: y+0.13, w: tileW-0.15, h: 0.16,
    fontSize: 14, bold: true, color: C.blue, fontFace: 'Calibri', valign: 'middle'
  });
  if (deltaStr) {
    slide.addText(deltaStr, {
      x: x+0.1, y: y+0.29, w: tileW-0.15, h: 0.08,
      fontSize: 6.5, color: deltaColor || C.midGrey, fontFace: 'Calibri', valign: 'middle'
    });
  }
};
```

### Tile assignments

| Col | Row 0 (volume/SLA) | Accent | Row 1 (timing/status) | Accent |
|-----|--------------------|--------|-----------------------|--------|
| 0 | INBOUND TICKETS | `C.blue` '2A5490' | TIME TO ASSIGN (AVG) | `C.blue` |
| 1 | CLOSED TICKETS | `'27AE60'` | AVG FIRST REPLY | `'27AE60'` |
| 2 | RES. SLA OK % | `'E87722'` | AVG RESOLUTION TIME | `'E87722'` |
| 3 | 1ST REPLY SLA % | `'E74C3C'` | ON-HOLD / OPEN TICKETS | `'7C3AED'` |

### Delta string format

```js
// Always show signed change AND previous value with its label:
// "+7  ·  prev: 64 (W12 2026)"   (weekly)
// "+42  ·  prev: 198 (Mar 2026)" (monthly)
const prevRef = v => pLbl ? `prev: ${v} (${pLbl})` : `prev: ${v}`;
// deltaStr = `${inbDelta}  ·  ${prevRef(fmtNum(prevValue))}`
```

Delta color rules:
- Inbound: `C.midGrey` (volume — neutral direction)
- Closed, SLA%: green ≥ 0, red < 0
- Timing (TTA, FR, RT): **green ≤ 0** (lower = faster), red > 0

---

## Full Helpdesk Slide Layout (weekly & monthly)

```
y=0.42   addTitle(slide, 'N. Title', null)    ← NEVER pass a subtitle
y=0.62   KPI Row 0  h=0.40  [Inbound | Closed | Res.SLA% | 1stReply%]
y=1.12   KPI Row 1  h=0.40  [TTA | AvgFR | AvgRT | On-Hold/Open]
y=1.58   Combo chart  x=0.3, w=12.73, h=3.04
           bars: Inbound (2A5490), Closed (27AE60)
           lines (secondary axis): Res.SLA% (E87722), 1stReply% (E74C3C)
           val2AxisMaxVal=100, legendPos='b'
─── y=4.72  bottom section ───────────────────────────────────────────
LEFT   x=0.3, w=7.8,  y=4.72, h=2.66   Ageing bar chart (fills to 7.38)
RIGHT  x=8.3, w=4.73, y=4.72           Stack (dynamic):
         SLA Violations panel  (height = 0.27 + slaRowH + rows*slaRowH)
         +0.07 gap
         Team panel  h=0.73 (fixed)
         +0.07 gap
         Comments panel  h = 7.38 - cmtY  (fills rest of slide)
```

---

## SLA Violations Panel

```js
const slaRowH    = 0.20;
const maxViolRows = 4;
const showViol   = top10.slice(0, maxViolRows);
const slaH       = 0.27 + slaRowH + showViol.length * slaRowH;

// Header bar
slide.addShape('rect', { x: rightX, y: slaY, w: rightW, h: 0.27, fill: { color: 'E74C3C' }, ... });
slide.addText('⚠  Top SLA Violations — Current Week', { fontSize: 7.5, bold: true, color: 'FFFFFF' });

// No violations state: green box, '✓  No SLA violations this week', color '27AE60'
// Data rows: alternate 'FFF5F5' / 'FFFFFF', violation count in 'E74C3C'
```

Weekly header: `'⚠  Top SLA Violations — Current Week'`
Monthly header: `'⚠  Top SLA Violations — Last Week of Month'`

---

## Monthly Helpdesk Data Sources

`slideMonthlyHelpdesk` differs from weekly in data source only — layout is identical.

### Row 0 (monthly totals)
- Primary: `monthlyData.calendar_hd` → `{ inbound, closed, close_pct, sla_res_pct, sla_reply_pct, source:'calendar' }`
- Fallback: last entry of `monthlyData.history6m`
- `calSyncNeeded` → show `'—sync'` in all tiles, hide deltas

### Row 0 deltas (month vs previous month)
```js
const prevH6   = h6[h6.length - 2];   // second-to-last entry in history6m
const pMLabel  = prevH6?.label || '';  // "Mar 2026"
const prevMRef = v => pMLabel ? `prev: ${v} (${pMLabel})` : `prev: ${v}`;
```

### Row 1 (timing — from last week of month)
`calendar_hd` has NO timing fields. Use last report's `cd.weeks` array:
```js
for (const r of reports) {
  const wks = cd.weeks || r.helpdesk?.group_metrics || [];
  if (wks.length) { lastCurWk = wks[wks.length-1]; lastPrevWk = wks[wks.length-2]; }
}
// Row 1 deltas use lastPrevWk?.label (week label, not month label)
```

### SLA violations (monthly)
```js
if (Array.isArray(cd.top10)) lastTop10 = cd.top10;
// from the last report's chart_data.top10
```

### Combo chart (always 6-month)
Uses `monthlyData.history6m` — same chart spec as weekly, same dimensions.

---

## Dynamic Service Column Pattern (Infrastructure Tables)

```js
const fixedSum = kpiW + tgtW + (nMonths * monthW) + ytdW;  // sum all fixed cols
const svcW     = 12.73 - fixedSum;   // service col absorbs remaining space
// colW = [svcW, ...fixedCols]
```

This prevents "WAN1 Fetekro Explo" and similar long names from wrapping.

---

## Coding Principles — Browser-side asset caching (codified 2026-06-05)

The dashboard uses the **canonical URL-versioning pattern** (the same
approach webpack / vite / Next.js use in production). Every browser-
side asset is referenced from HTML with a `?v=<APP_VERSION>` query
string suffix. The user gets:

- **Zero round-trips** for cached assets on every page load (full
  `immutable` cache hit — browser never even contacts the server).
- **Zero stale risk** — every deploy bumps `APP_VERSION` → all asset
  URLs change → browsers fetch fresh automatically.
- **Zero Ctrl+F5** needed — users never have to manually bust their
  cache.

The HTML itself is `no-cache` so users ALWAYS receive an up-to-date
HTML referencing the current `APP_VERSION`. Combined with the
`immutable, max-age=1year` on versioned assets, this gives optimal
cache utilization AND immediate deploy propagation.

### How it works end-to-end

```
                 ┌─────────────────────────────────────┐
   server boot   │  APP_VERSION = git rev-parse HEAD   │
                 │  (or fallback: 't<epoch-ms>')       │
                 └──────────────┬──────────────────────┘
                                │
                                ▼
                 ┌─────────────────────────────────────┐
   per HTML      │  loadHtml(name) at boot:            │
   page         │   read public/<name>.html           │
                 │   call injectAssetVersion(html)     │
                 │   cache result in _htmlCache        │
                 └──────────────┬──────────────────────┘
                                │
                                ▼
   browser GET /index.html       Response (no-cache):
                                 <script src="auth.js?v=abc123">
                                 <link href="_tokens.css?v=abc123">

   browser GET /auth.js?v=abc123  Response (immutable, 1 year):
                                 → browser caches under URL key
                                 → next load: served from cache,
                                   ZERO server contact

   --- deploy happens, APP_VERSION = def456 ---
   browser GET /index.html       Response (no-cache, NEW VERSION):
                                 <script src="auth.js?v=def456">
                                                          ^^^^^^

   browser sees a URL it doesn't have cached → fetches fresh.
   Old auth.js?v=abc123 sits dormant in cache until LRU eviction.
```

### When adding a new HTML page

Just add it to the `_htmlCache` boot-load list and add a route handler
that calls `sendHtmlPage()`. **DO NOT serve protected HTMLs via
`express.static`** — `injectAssetVersion` only runs at `loadHtml` time
on cached HTMLs.

```js
// 1. Add to the boot-load list at server.js (in the _htmlCache block):
['executive.html', ..., 'my-new-page.html'].forEach(loadHtml);

// 2. Add a route handler near the other sendHtmlPage handlers:
app.get('/my-new-page.html', (req, res) => {
  sendHtmlPage(res, 'my-new-page.html', false, 'My new page unavailable');
});
//        third arg: injectApiKey — true only if the page needs window.__ak
//                                  (Helpdesk / Executive / Reports / Analytics)
```

That's the only required wiring. `injectAssetVersion` runs at boot,
your `<script src>` and `<link href>` references automatically pick up
`?v=APP_VERSION`.

### When adding a new client-side JS / JSX / CSS file

Reference it from HTML with a relative path — no special treatment
needed:

```html
<script src="my-module/widget.js"></script>
<link rel="stylesheet" href="my-module/styles.css">
```

At boot, the cached HTML becomes:

```html
<script src="my-module/widget.js?v=abc123"></script>
<link rel="stylesheet" href="my-module/styles.css?v=abc123">
```

When the browser requests `/my-module/widget.js?v=abc123`, the static
handler sees the `?v=` query and serves with `Cache-Control: public,
max-age=31536000, immutable`. Cached forever, auto-invalidated next
deploy.

### What gets injected (and what's left alone)

`injectAssetVersion` (at `server.js:~982`) handles two tag families:

| Tag | Rule |
|---|---|
| `<script src="…">` | Inject if local path. Skip if URL starts with `http://`, `https://`, `//`, `data:`, `#`, `mailto:`, or already has `?`. |
| `<link href="…" rel="…">` | Inject only if `rel` is `stylesheet`, `preload`, `prefetch`, or `modulepreload`. Same local-only rules. Skip `rel="icon"` (favicons are too small to cache-bust meaningfully). |

**NOT injected** (these need different cache-busting strategies if
they ever matter):
- `<img src="…">` — images rarely change across deploys
- `<video src>`, `<audio src>`, `<source src>`
- `<iframe src>` — those are full pages, not assets
- Inline `<style>` blocks
- Dynamically-built script tags (added via JS at runtime)
- Background images set via CSS `url(…)`

If you need to bust a CSS-referenced asset, build the asset URL in JS
with `?v=<APP_VERSION>` (exposed to browser via `window.__appVersion`
— TODO if needed).

### Anti-patterns to avoid

| Anti-pattern | Why it's a problem | Do instead |
|---|---|---|
| Serving an HTML via `express.static` instead of `sendHtmlPage` | `injectAssetVersion` runs in `loadHtml`. A page served by `express.static` skips that injection and loses cache busting. | Add a route handler with `sendHtmlPage` for every HTML in `public/`. |
| Hardcoding a CDN URL with `?v=…` already in the source | The injector skips URLs that already contain `?`. If you add `auth.js?fallback=true`, the injector won't add `?v=…` — and the file may go stale. | Don't put query strings in `<script src>` source. Add them only at HTTP-request time if dynamic params are needed. |
| Inlining critical JS in `<script>…</script>` blocks | Inline scripts can't be URL-versioned — they're part of the HTML. If the HTML is cached server-side (it is — `_htmlCache`), the inline script only refreshes on `pm2 reload`. | Move logic to an external `.js` file referenced via `<script src>`. The injector handles the rest. |
| Adding assets referenced via `fetch('/something.js')` from another script | Dynamic fetches don't go through HTML injection. The browser fetches the raw URL → falls through to the `Tier A/B/C` safety net (typically 1-day cache). | Either: (a) reference via `<script src>` so injection applies, or (b) manually append `?v=` + `window.__appVersion` in the fetch. |

### Verifying the cache policy applies correctly

In Chrome DevTools → Network tab → reload the page → check the
`Cache-Control` column (right-click column header to enable):

| File | Expected `Cache-Control` | Expected behavior |
|---|---|---|
| Any `.html` page | `no-cache, must-revalidate` | Status `200` on every load (HTML is always fresh) |
| Any local asset WITH `?v=…` | `public, max-age=31536000, immutable` | Status `200` on first load post-deploy, then `(memory cache)` or `(disk cache)` with ZERO server contact on subsequent loads |
| Any local asset WITHOUT `?v=…` | falls through to Tier A/B/C safety net | Direct-URL hits only (rare) — Tier A modules get `no-cache`, Tier B `/lib/` gets 5 min, Tier C gets 1 day |
| External CDN (`unpkg.com`, `cdnjs.cloudflare.com`) | CDN-controlled headers | Browser caches per CDN policy (typically 1 year for versioned URLs) |

If you see `(disk cache)` on a `.html` page or `(memory cache)` on an
asset URL that's missing `?v=…`, the injection didn't apply. Possible
causes:
1. HTML is served via `express.static` instead of `sendHtmlPage` →
   add a route handler.
2. HTML isn't in the boot-load list → add it to the `.forEach(loadHtml)`
   array near `server.js:1012`.
3. The asset URL has special characters or already had a `?` → check
   `injectAssetVersion` skip rules.

**To verify the injection ran**: View source on the served HTML
(Ctrl+U). All local `<script src>` and `<link href stylesheet>`
should have `?v=<APP_VERSION>` appended. CDN URLs and favicons should
NOT.

### Fallback safety net (Tier A / B / C)

For asset requests that arrive WITHOUT a `?v=…` query (typically
direct-URL hits or fetches from external tools), the static handler
falls through to a 3-tier policy as defensive backup:

- **Tier A** — `no-cache, must-revalidate` — `.jsx` files and anything
  under `/activity-tracker/`, `/dashboard-preview/`, `/design-system/`.
  Prevents the original "stale React app → data loss" bug from
  reappearing if someone bypasses the HTML-injection path.
- **Tier B** — `public, max-age=300, must-revalidate` — anything under
  `/lib/` + `analyze-lite.js`. Shared display helpers.
- **Tier C** — default `max-age=86400` from `express.static` — brand
  assets, `_shell.*`, `auth.js`, fonts, images, vendored libraries.

In normal use NO request hits this fallback. It's a safety net.

---

## Known Pitfalls

| Pitfall | Rule |
|---------|------|
| **The IT Review's Helpdesk & Changes panel is OUR addition — the authoritative `D` has no helpdesk concept at all** | His dashboard is meetings + inspection only; there is no helpdesk or changes anywhere in `D`. The panel therefore rides in via `buildReviewVals(D, opts)`'s **optional `opts.extras`**, precisely so that calling **without** extras still emits **exactly his 61 keys** and `tests/review-fidelity.test.js` keeps proving the port. **Never fold extras into `D`, and never let them reach the score** — the Leaderboard/Scoreboard keep his numbers. `tests/review-fidelity.test.js` guards **both** sides of that door: the no-extras call deep-equals his oracle at 61 keys, and a second test pins the WITH-extras additions to a **declared allowlist** (`['hdNote','hdRows']`) so a future accidental key silently polluting his contract fails loudly. Label the panel as a complement, never as part of his model. |
| **Per-site helpdesk AND changes both scope by GROUP — never by `site`** | `request_records.tech_group` and `change_records.group_name`, both comma-split from `sites.zoho_group` (resolved via `getSiteIdByModuleCode('meetings', code)`). **Never `request_records.site` / `change_records.site_id`** — `site` is free-form and unreliable (`'HOUNDE'`, `'Hounde Mine'`, `'Ouaga'` vs `'Ouagadougou'`); `change_records.group_name` is populated on 291/295 rows. The reader takes a **`site_id`** and resolves the group *internally* — so a binder passing `s.zoho_group` where `s.site_id` belongs yields `undefined` → an **all-zero block with no error**, which `_safe` then swallows. Copy the `helpdesk` binder (`siteReportDeps.js:40-44`) and change only the reader call. |
| **The change outcome is NOT in `status`/`closure_code` — and there is already a classifier; do NOT write a second one** | `closure_code` is **NULL on 82%** of rows, and `'Successful'`/`'Failed'` appear in **neither** `status` nor `closure_code`. The outcome lives in **`udf_json`** (`UDF:Change Implementation Outcome` / `UDF:Review decision`). The shipped classifier is `_changeOutcome`/`_tallyChanges` at **`public/executive-report.html:5053-5090`** — its own header comment documents the exact bug a naive `status`/`closure_code` reader causes ("the deck builder reported a different success number than the live scorecard"). **Port it verbatim** (`reports-db.js` `_changeOutcome`/`_computeSiteChanges`). Three counter-intuitive facts: the bucket is **`'success'`, not `'successful'`**; **no signal → `'pending'`, never `null`**; and `UDF:Review decision` **short-circuits on `'rework'` ONLY** — priority is per-VALUE, not per-field, so outcome beats review's success/cancel. `executed = successful + partial + failed(incl. backed_out) + cancelled` → **187 / 91.4%** on the snapshot, which **deliberately diverges** from this file's own denominator-doctrine line (`175 / 97.7%`, cancelled excluded). **Agreeing with the deck the team already reads beats agreeing with a doc line** — that divergence is the decision, not a bug. `failed` already merges `backed_out` and `pending` already merges `rework`; the raw counts survive only under `buckets`. |
| **`created_time` is TEXT holding ISO-with-T-and-Z — a raw `BETWEEN` silently drops the last day** | `'2025-01-09T15:15:14.000Z'`, TEXT in **both** sqlite and pg (`db/postgres/reports/004_hot.sql:22` — so no `::date`, no `to_char`). `created_time BETWEEN '2026-01-01' AND '2026-07-03'` returns **127**; the correct form returns **129** — two rows lost, **no error**. Use **`substr(created_time,1,10) BETWEEN ? AND ?`**: correct and identical on both backends. Not `date()` (sqlite-only) or `::date` (the column is TEXT). Accepted trade-off: `substr()` defeats `idx_cr_created`/`idx_rr_created` → seq scan; cheap here and this route isn't hot. `created_time >= ? AND created_time < ?` with an **exclusive** upper bound is the sargable equivalent if it ever shows up in a profile. |
| **`fmt()` in `reviewDashboard` is a DISPLAY formatter — feeding it to SQL returns 0 rows with NO error** | `fmt('2026-04-15')` → **`'15 Apr'`** (`reviewDashboard.js:95-99`). Hand that to `substr(created_time,1,10) BETWEEN ? AND ?` and it matches nothing, silently. Use **`addDays`**; `windows()` already returns ISO strings ready for SQL as-is. `extrasWindows(period)` exists so the two-window decision lives in exactly ONE place — don't re-derive it in a route. (Pedantry: an inclusive `BETWEEN` over `addDays(ANCHOR,-90)..ANCHOR` spans **91** days — don't write "exactly 90" in a UI note.) |
| **The house `\|\| 0` normalisation idiom destroys a meaningful `null` — one layer ABOVE every renderer guard** | `siteReport.js:53` normalises with `const helpdesk = { created: hd.created \|\| 0, … }`. Copy that blindly onto a verdict field and `success_pct: null \|\| 0` → **the coordinator email prints "0%"** for a site with nothing to judge. **Use `?? null` for verdict fields** (counts zero, verdict null — that's also what the `EMPTY` fallback must carry). And **test THROUGH `siteReportData`, not around it**: a template test that hands the block in directly stays green while the email prints 0%, because the `\|\| 0` lives in a layer that test never executes. `null` = "nothing to judge" ≠ `0` = "0% succeeded". |
| **`ICON_LIB` in `_shell.js` is a hand-curated ~10-key SUBSET of `brand/icons.js` — not a mirror** | An icon that exists in `icons.js` is still **`undefined`** in the nav until it is listed in `ICON_LIB`, and `renderNavItem` then renders an **EMPTY icon span with no error** — the entry looks half-broken and nothing logs. **Add the key to `ICON_LIB` when you use it.** Reuse an existing `icons.js` key; never add an asset. (`bar-chart-3` was present in `icons.js` and used by zero nav entries; `trending-up` is the Insights PARENT's own icon and `line-chart` is Analytics' — don't reach for those.) |
| **`public/it-review.js`'s tag scan reads RAW TEXT and does NOT skip HTML comments** | Its regex is literally `/<(sc-for\|sc-if)(?=[\s>])/g` over the raw template — so writing `<sc-for>` **inside an HTML comment** corrupts the page silently. Don't comment out template control flow; delete it or comment *around* the whole block with the tags removed. |
| **`public/it-review.html` has NO automated backstop — the render test parses the REFERENCE copy, not the live page** | `tests/review-render.test.js:121` parses `docs/reference/it-review-dashboard.template.html`; **nothing parses `public/it-review.html`**. Given this repo's own history (a renderer that passed 12/12 unit tests while matching **0 of 32** real loops, shipping the page inert), **a browser check is the only proof the live page's grammar is right.** Same for `public/site-report.js` — its DOM-insertion cards have no test either; `new Function()` parsing proves syntax, not rendering. If a panel renders empty with data present, **suspect the tag form before the data.** Also wrap a whole added panel — heading included — in `<sc-if value="{{ list }}">`: `<sc-for>` over a missing list emits nothing, but the renderer has **no mechanism to remove static markup**, so the degrade path would still render a headed empty table (an empty `[]` is truthy, so `sc-if` hides it only in the `undefined` case — exactly the degrade path). |
| **The site report's two major-incident numbers are DIFFERENT populations and legitimately disagree** | `helpdesk.major_incidents` counts incidents **raised in the report month**; the MI detail list (`getActiveMajorIncidentsForSite`) shows incidents **open right now**. A month can show `major_incidents: 0` beside a non-empty open list, or vice versa. **Both are labelled on the page** ("still running now") precisely so the pair never reads as a contradiction — keep the labels. (And MGO's July zeros are **real**, verified: 98 tickets, 0 overdue, 0 MI. Don't "fix" the reader.) |
| **`em-data.json` IS our own prod database, exported later — that is why the review-suite asserts EQUALITY, not approximation** | The fixture is not a hand-made sample: it is `window.EM_DATA` from the author's dashboard, and it reconciles field-for-field with `prod-snapshot/` over **1668 comparisons** with exactly ONE row of drift (`inspActions id=84`, created 2026-07-12 — the fixture is the same DB exported ~5 days after our snapshot; blast radius nil, its status is `Closed` and the sole consumer filters `status !== 'Closed'`). That identity is what lets `tests/review-data.test.js` prove the 5 denormalisation joins by equality rather than by shape. **If the snapshot is ever refreshed, the fixture AND the oracles must be re-derived together or the proofs rot silently** — a stale fixture keeps passing while certifying a drifted port. This is also why `tests/review-oracle.js` commits the *harness* (which re-runs his code) instead of a dumped JSON blob. Corollary: **do NOT write a bare count-equality test for `inspActions`** — it fails against a CORRECT reader and sends you hunting a phantom bug. |
| **`loadReviewData` must NOT filter drafts** | The authoritative export contains **1 draft PV** and the model applies **no status filter** — so it counts it. Filtering here would be a silent deviation from the screen the team actually reads: our numbers would quietly disagree with theirs with no error anywhere. Pinned by `tests/review-data.test.js` ("does NOT filter drafts"). Settled by fact, not opinion — don't "tidy" it. |
| **`windows('month'\|'quarter'\|'semester')` is hardcoded July 2026 — and is NOT `scoreWindow.js`** | Two DIFFERENT window concepts that must not be merged. (a) The source's `windows()` (`:27`) hardcodes `'2026-07-01'`/`'2026-06-01'`/… — only `'week'` derives from the anchor. Ported **as-is** and pinned; it is his dashboard's behaviour. (b) `services/scoreWindow.js` is the **rolling 3-month** score window that 3A deliberately introduced so the score stays meaningful as time passes. Conflating them silently changes either the panels or the score. Same trap as `getSiteScoreInputs`, which *looks* like `sbDims`' measurement half but uses the rolling window — hence `sbMeasure` was ported into `reviewDashboard.js` instead. |
| **His `codes` order is LOAD-BEARING — sorting it flips five panels** | `codes` (`source :213`) is not incidental ordering. `eMatrix` (`:297`) and `inspSiteRows` (`:344`) **iterate `codes` directly** — their row order IS `codes` order. `sbRows`/`gapRows`/`sbMoves` inherit it through `sbSorted`'s **stable sort** (`:426`): SML and MGO both score **50**, so the tie resolves to whichever comes first in `codes`. (`leaderboard` escapes only by luck — 62/58/48/44/41 are all distinct.) A reviewer ran the source both ways: naive sorting differs on **five panels**. Rule: keep **his 5 in his order** (`SML,SMI,HGO,MGO,SGO`), then append sites he never saw, sorted for determinism — `const codes = [...HIS.filter(c => present.has(c)), ...[...present].filter(c => !HIS.includes(c)).sort()]`. On his fixture the extras set is empty, so `codes` is byte-identical to `:213` and the oracle holds. |
| **`public/it-review.js` is a 3-primitive RENDERER, not a template engine — and it has two invariants no unit test can catch** | The authoritative template has **219 pure `{{key}}`/`{{obj.field}}` bindings, ≤1 dot, 32 `<sc-for>`, 3 `<sc-if>`, nesting exactly 2 deep**. Do not generalise it; do not add a raw/unescaped mode — every binding renders untrusted PV/ticket free-text. **Two non-obvious invariants:** (1) the grammar MUST tolerate **arbitrary extra attributes in any order** — every real tag carries `hint-placeholder-*`, and a bare-form grammar **passes its unit tests while matching 0 of 32 loops, shipping the page inert**; (2) **control flow MUST resolve BEFORE interpolation** — `hint-placeholder-val="{{ true }}"` puts a binding *inside* the `sc-if` tag, so interpolating first corrupts the tag and **the gate silently vanishes**. `tests/review-render.test.js`'s **BACKSTOP** runs the renderer over the real template in all 3 views and is **the only test that catches either — never delete it to get green.** |
| **The site score is a PORT, not a design of ours — do NOT retune it** | The score is a faithful port of the user's own dashboard model (`IT Review Dashboard.html` → `sbDims`): 6 dims × 0/1/2 ÷ 12, RAG 70/45. Do NOT "improve" the thresholds, the rounding, or the (deliberately asymmetric, technically-invalid-as-a-comparator) moves tie-break — **a score that diverges from the one the team already sees on their dashboard is worse than no score at all.** `tests/score-fidelity.test.js` pins our output to THEIR numbers on THEIR data (`tests/fixtures/em-data.json` = their real `EM_DATA`, 5 sites, their `W0` window). If that test ever fails, our code is wrong — fix the port, never the expectations. |
| **Score window ≠ report window** | The report's blocks are monthly / MTD; the score is a **3-month rolling window**. This is not an oversight: the user's thresholds (`reviews ≥8`, `inspections ≥3` "quarterly") are calibrated for ~3 months and are meaningless over one. Both windows are surfaced with their window stated — keep it that way, and don't "align" the score to the report month. |
| **`md_issues.updated_at` is TIMESTAMPTZ in pg, TEXT everywhere else** | Every other date column the score touches is TEXT. The pg fork of `getSiteScoreInputs` MUST `to_char()` it — otherwise `_effClose` yields `'Wed Jun 11'`, every ISO string compare (`c <= to`) silently loses, and resolution/overdue go wrong **in prod only** (sqlite tests stay green). The score's date logic is ISO STRING comparison by contract; anything reaching it must already be a `YYYY-MM-DD…` string. |
| **TWO scoring models, both authoritative, and they DISAGREE** | The reporting suite carries TWO scoring models, both ported from the boss's dashboard, both authoritative, and they genuinely disagree — 3 of 5 sites land on a different RAG and the rankings are nearly inverted. `composite()` (RAG 75/55) scores how well problems are handled; `sbDims()` (RAG 70/45) scores programme discipline. This is the source's design. Do NOT "reconcile" them; if the double-verdict is a problem, that is a conversation with the model's author, not a code change. |
| **`composite()` is NOT per-site-isolated** | `fleetMttr` is the median resolution time across ALL sites, so adding data for site B changes site A's score. It must be passed the whole fleet's `D`, never one site's slice. |
| **`eMetrics.cov` is hardcoded `/12` with no upper clamp** | `cov = round(100 * depts/12)` (departments) and is never clamped — >12 distinct departments at one site pushes `cov`>100, `eng`>100, and `composite` above 100 (it is floored at 0 by `Math.max(0,…)` but has no ceiling). Unreachable on the author's 5 sites (max `cov` = 75); our fleet is larger and the meetings data already carries an unseeded `SP` department code. Ported as-is and pinned by a test — surface it to the author rather than clamping it here. |
| **Inverted dims make ABSENCE of data look like excellence** | Two of `sbDims`' six dimensions (`overdue`, `findings`) are inverted, so a site with nothing measured scored `0 overdue → 2 pts` + `0 findings → 2 pts` = 4/12 = **RED 33** — a confident verdict on nothing, mailed to coordinators. `computeSiteScore` now gates on `hasData` and returns `applicable:false` (score/points/rag/trend all null, dims/moves empty); both renderers then claim no verdict rather than a grey `—/100`. **"We measured zero" ≠ "we measured nothing"** — a site that met twice and resolved nothing is still a real RED. Any new score dimension that rewards a zero must respect the same gate. **And the gate can't be read off the six alone: two of them are RATIOS, and a ratio's zero is ambiguous without its denominator.** `resolution` = resolved ÷ **raised** → `0` is either "0% of 4 resolved" (a measurement) or "no issues at all" (absence); `signoff` = signed ÷ **reviews** (denominator already among the six). The other four are counts — their zeros are unambiguous. So `hasData` also takes **`raised`**, passed through by `siteReportDeps` (BOTH `scoreInputs` and `prevScore`) purely as an **applicability signal — it is NEVER scored**: not a dim, no effect on points/score/rag. Miss it and `scoreInputs` → `siteReport.js`'s `computeSiteScore` calls a real, measured, bad site "non applicable" **on its own report** (headline verdict, not just the trend). Any future ratio dimension must pass its denominator to the gate the same way. |
| **A binder that "looks wired" can silently read zeros** | `services/siteReport.js`'s `_safe()` swallows shape mismatches into empty blocks — so a mis-shaped binder degrades to zeros instead of throwing. Foundation's helpdesk/meetings/inspection binders passed EVERY test (all stub-shaped, contract-conformant) while returning zeros against the REAL readers: `getCalendarMonthlyHelpdesk` returns `{inbound, closed, …}`, not `{created, resolved, …}`; the meetings kpis are `dept_target`/`resolved_month`/`new_month`/`escalations_open`, not `pvs_target`/`resolved`/`new`/`escalations`; `aggregate()` nests under `counts:{}`. **Rule: any deps binder needs at least one test against the REAL reader's shape, not just a contract-shaped stub.** A stub proves the contract, never the wiring. |
| **Per-site helpdesk readers MUST scope by `tech_group`, NEVER `request_records.site`** | `site` is free-form and unreliable (`'HOUNDE'`, `'Hounde Mine'`, `'Ouaga'` vs `'Ouagadougou'`, `'LONDON'`/`'London'`). Scope by `tech_group IN (…)`, comma-split from `sites.zoho_group`. Every existing per-site reader in this codebase already does this — follow it. |
| **A CLI with an unguarded top-level IIFE cannot be unit-tested** | `require()`-ing `tools/reports/send-reports.js` used to EXECUTE it and call `process.exit(0)` — so the test file reported "1 test passed" having run ZERO of its 10. Guard the entrypoint with `if (require.main === module)` and export the pure core. **Symptom: a test file whose reported test count is far lower than the number of `test()` calls in it.** Whenever a suite's count looks too low, count the `test()` calls before trusting the green. |
| **`site_module_codes` code namespaces differ per module** | Ity is `SMI` in meetings/inspection but `ITY` in tracker; Kalana is `KGO` vs `KLN`. The reporting suite resolves via the **meetings** namespace (`getSiteIdByModuleCode('meetings', code)`). Exploration + Tanda have NO meetings code and therefore cannot be site-reported. Never assume one module's code list works in another. |
| **`+null === 0` passes `Number.isFinite`** | When averaging a nullable duration column, guard `x != null && Number.isFinite(+x)` — order matters. Otherwise closed-with-no-`resolved_time` rows inject phantom 0-hour resolutions and silently drag the average down (`Number.isFinite(+null)` is `true`). |
| **pm2 Windows service name is `pm2.exe`, not `PM2`** | Confirmed 2026-06-09. The Services GUI shows DisplayName "PM2" but the ServiceKeyName needed by `sc start/stop` is `pm2.exe` (full executable name as service identifier — likely installed via nssm or a similar wrapper). So `sc start PM2` returns "service does not exist" (error 1060), but `sc start pm2.exe` works. Verify the actual name: `powershell -command "Get-Service \| Where-Object {$_.DisplayName -like '*pm2*'}"`. The service is configured **Automatic** so it starts at Windows boot, and on start it executes the equivalent of `pm2 resurrect` reading `C:\ProgramData\pm2\dump.pm2`. End-to-end test on 2026-06-09: `pm2 save` → `pm2 kill` → `sc start pm2.exe` → after ~15s, `pm2 status` shows endeavour-dashboard online. **Conclusion**: Windows reboot is safe — service auto-restarts endeavour-dashboard within ~30-60s of OS boot, total downtime ~2-3 min. **Rule**: always run `pm2 save` after modifying the pm2 process list (otherwise the new state isn't in `dump.pm2` and won't be restored at next boot). |
| **ADR-001 COMPLETE — tracker is fully PER-YEAR since 2026-06-12 (`TRACKER_PER_YEAR_EDITS=1` in prod `.env`)** | Each year has its OWN pillars, activities and targets (`tracker_pillars`/`tracker_activities` UNIQUE per year; `tracker_targets_v2`/`tracker_inputs_v2` keyed year+site+activity_id). **Setup edits apply ONLY to the year selected in the toolbar** — the blue "📅 Editing year N" banner shows the scope; ALWAYS check it before deleting. A new year starts EMPTY ("⧉ Copy structure from prev" button clones on demand). Proven in prod: 2026=31 activities, 2027=30 after a 2027-only delete, both audits PASSED. **Key facts**: (a) the legacy `tracker_config` activities/pillarWeights JSON is FROZEN forensics — never write it, never re-enable the legacy mirror (`_backfillFromLegacy`/prune/v2-sync are auto-skipped at boot in per-year mode; re-running them would resurrect deleted activities from the stale legacy); (b) shadow comparator is auto-off (legacy is stale by design); (c) the audit (`_audit_tracker_dualwrite.cmd`) runs internal-integrity checks in this mode; (d) **rollback is backup-restore ONLY** (env-var rollback died with the first divergent edit on 2026-06-12); (e) zero-activity pillars are invisible in the UI (`gP(D)` derives pillars from activities) — clean them via SQL if ever needed. |
| **Deep-linkable forms must read `?id=` from URL — `localStorage` alone is not enough** | Discovered 2026-05-31 from the inspection module. The form's `init()` only checked `localStorage.getItem(KEY_CURRENT)` for the ID to load. When a user clicked the dashboard's "Open" link `inspection.html?id=EM-IT-20260531-7591` after a browser cache clear, localStorage was empty → form silently created a fresh inspection with a NEW id, leaving the original on the server untouched. User reported "my data disappeared." **Rule**: any form supporting deep-linking from a dashboard list MUST follow the priority chain `URL ?param → localStorage → server → fresh`. If the URL has an id but localStorage doesn't, fetch from server before falling through to a new entity. Pattern shipped in `b440ebf` — `window.fetchInspectionFromServer(id)` exposed from the IIFE, init() now `async` to await the server lookup. **Audit suggestion**: grep meetings / tracker / executive-report for the same blind spot — any module whose dashboard navigates to `?id=` and whose form init reads only localStorage has this bug latent. |
| **"Data disappeared" is almost always a load bug, not a save bug** | Same 2026-05-31 incident. The submission POST returned 200 OK with a valid inspection ID + `created: true`; the row was in `inspection.db` the whole time. The user's exported JSON had a DIFFERENT id (1991 vs 7591) — that was a clue I missed at first that the form had auto-created a new inspection on load, not failed to save. **Rule**: when a user reports lost data, FIRST check the server-side DB directly (a quick `node -e "..."` script counts as 30 seconds well spent). If the row exists server-side, the bug is on the load path — usually a URL param being ignored, a stale localStorage shadowing the server, or a filter on the list endpoint hiding the row. |
| **Continuous-mode SpeechRecognition is racier than it looks** | The 2026-05-23 fix for voice dictation tried to keep `r.continuous = true` working across natural pauses with a 3-buffer cross-session-boundary system. It still produced duplicate sentences in production. Reverted to push-to-talk (`r.continuous = false`, one session per tap) on 2026-05-31. **Rule**: for any field-user-facing dictation feature, default to push-to-talk + explicit language selection. The Web Speech API's continuous mode adds complexity (auto-restart, e.results retention, boundary commits) that exceeds the ergonomic benefit for ops users who can tap a mic button between sentences. Keep `r.lang = explicitLanguageChoice`, never auto-detect — the browser loads a different speech model per language, and the wrong model is dramatically less accurate than the right one. |
| **`npm uninstall <pkg> --ignore-scripts` can delete OTHER packages' native bindings** | Discovered 2026-05-30 after `npm uninstall exceljs --ignore-scripts` removed `node_modules/better-sqlite3/build/Release/better_sqlite3.node` from BOTH dev and prod. The flag protects against post-install rebuilds but doesn't guard against npm's package-tree reconciliation pass deleting files it considers extraneous. PM2 stopped with `Could not locate the bindings file`. **Rule**: back up `node_modules/better-sqlite3/` before any npm install/uninstall on prod, even with --ignore-scripts. Recovery: `_recover_better_sqlite3_prod.cmd` (upgrades to v12 which ships Node 24 prebuilts). |
| **Node-side `zlib.gzip` on `/api/data/requests-raw` made boot WORSE through IIS ARR** | Tried 2026-05-30 to fix the 25-30 s boot by gzipping the 28 MB JSON payload inline in Node. Smoke-tested fine on dev. On prod through IIS reverse proxy, page load got slower — ARR either stripped the `Content-Encoding: gzip` header, double-handled the compression, or buffered before forwarding. Reverted (`0bbc223`). **Fix shipped**: enable IIS dynamic compression for `application/json` instead. Node ships plain JSON to loopback (fast); IIS gzips on the way to the browser with its own compression cache. Boot dropped 25-30 s → 1-3 s. Configuration: `appcmd set config -section:system.webServer/httpCompression /+"dynamicTypes.[mimeType='application/json',enabled='true']" /commit:apphost` — placed BEFORE the `*/*` enabled=false catchall (IIS matches first-to-last). The charset variant (`application/json; charset=utf-8`) may also be needed depending on Express's Content-Type header. **Rule**: when a route ships >1 MB JSON behind IIS ARR, do the gzipping at the IIS layer, NOT in Node — ARR doesn't proxy upstream Content-Encoding reliably. |
| **`prebuild-install` fails through corporate proxy with "unable to get local issuer certificate"** | Corporate proxy does SSL inspection; Node's bundled CA bundle doesn't trust the proxy's root cert. `prebuild-install` warns and falls through to `node-gyp rebuild`, which then fails because prod's VS Build Tools are C++17 not C++20. **Per-process bypass for THIS install only**: `set NODE_TLS_REJECT_UNAUTHORIZED=0` + `npm install --strict-ssl=false`. DO NOT persist via `npm config set strict-ssl false` — that's a global security weakening. Discovered 2026-05-30 while recovering better-sqlite3. |
| **`npm rebuild <pkg>` skips the prebuild download — jumps straight to source compile** | `rebuild` runs `node-gyp rebuild --release` directly. The `install` lifecycle script is what wraps `prebuild-install || node-gyp rebuild`. **Rule**: to fetch a missing prebuild, `rm -rf node_modules/<pkg> && npm install <pkg>`, NOT `npm rebuild <pkg>`. |
| **`<` inside `node -e "..."` from cmd.exe is interpreted as stdin redirect** | cmd.exe ends quote mode at the embedded `\"`, then sees the bare `<` as a redirect operator. Symptom: `The system cannot find the file specified.` with NO Node.js stack trace (it's a CMD-level error before Node starts). Hit 2026-05-30 trying to run a one-liner with `created_time < '2026-06-01'` inside the SQL. **Fix**: write the script to a small `.js` file (`node diag.js`) or rewrite SQL with `BETWEEN ... AND ...` instead of `<`. |
| **SDP `site` column carries full mine names — does NOT match any other module's code list** | The helpdesk `request_records.site` is the authoritative source for what Zoho actually returns: `HOUNDE`, `MANA`, `Sabodala`, `LAFIGUE`, `Ouagadougou`, `Massawa`/`MASSAWA` (case-inconsistent), `KALANA`, `ITY`, plus office labels `LONDON`, `Dakar`, `ABIDJAN`, `ASSAFO`, and one-offs like `LAFIGUE - SML`. The Risk Register, Activity Tracker, and Inspection modules each use their own short codes (HGO, MGO, etc). **Rule**: never hardcode site lists against SDP data — use a `*_aliases` lookup table (see `rr_site_aliases` in `reports.db` as the canonical pattern). Discovered 2026-05-30 — initial Risk Register export showed zero everywhere because the canonical code list didn't match the data. |
| **`request_records.impact` column is mostly NULL on historical SDP tickets** | The Impact field was added to SDP recently. ~91% of historical rows (228 of 251 May 2026 incidents) carry NULL — they predate the field. Strict `VALID_IMPACTS` filtering shows zero everywhere; the Risk Register became useless. **Decision shipped 2026-05-30**: treat NULL impact as in-scope (likely operational, just unannotated). Explicitly EXCLUDE only `Individual`. Diagnostics surface `classified_with_null_impact` so operators know how much of the count is uncertain. As Zoho's data catches up, the NULL share shrinks naturally. **Rule**: when filtering on a recently-added column, decide explicitly how NULL should be treated — NULL = unknown ≠ NULL = excluded. |
| **SheetJS CE silently drops cell styling (fill colors, fonts, borders, freeze panes) on write** | The community edition writes data + column widths + row heights + number formats reliably, but Pro features get stripped. Risk Register's colored header bands and row banding from the spec are lost; data is fully correct. **Rule**: if a feature needs styled .xlsx output, either (a) use SheetJS Pro, (b) round-trip a pre-styled template (`XLSX.read` + repopulate cells + `XLSX.write` preserves more), or (c) document the styling loss and ship plain. We picked (c) for the Risk Register because the data accuracy is what stakeholders care about. |
| **Route handlers re-opening a SQLite DB at the ROOT path silently break after the data/ harmonisation (2026-06-05)** | The meetings issue-update + action-update routes did `new Database(path.join(__dirname, 'meetings.db'))` inline for a parent-site lookup. After meetings.db/inspection.db moved to `data/` (2026-06-05), that root path no longer exists → `better-sqlite3` *creates a stray empty file* there and the lookup returns nothing → every call 404s ("Issue not found"), silently disabling the quick-comment status change. **Rule**: NEVER re-open a module's DB with a hard-coded path inside a route. Add a tiny helper in the `*-db.js` module (e.g. `getActionParent(id)` / `getIssueParent(id)`) that uses the already-open `getDB()` connection, and call that. Canonical DB paths are `__dirname/data/<name>.db` for meetings + inspection (see DATA_DIR in each `*-db.js`). Fixed 2026-06-15 in `83af826`. |
| **`/api/<module>/actions` shadowed by `/api/<module>/:id`** | When adding a flat-list route like `/api/meetings/actions` or `/api/inspection/actions`, Express matches the earlier-registered `/:id` route first (`:id='actions'`). For meetings the numeric guard on `/:id` (`if (!Number.isFinite(parseInt(id))) return next()`) lets it fall through; for **inspection the id is TEXT**, so no guard works — the `/actions` route MUST be registered physically BEFORE `/:id`. Same lesson as the pre-brief `/progress` shadowing (`bbe531b`). |
| **Global `/api/` middleware rejects naked fetches with 401** | `server.js:946` `app.use('/api/', ...)` requires either `X-Dash-Key` header or a valid `x-report-token` cookie/header. `index.html`'s `pgGet()` injects this automatically. A naked `fetch('/api/something')` from new client code → 401 "Unauthorized". **Rule**: copy the auth-header pattern from `pgGet` (`public/index.html:394-400`) — `window.__ak ? {'X-Dash-Key': window.__ak} : (window.__authToken ? {'x-report-token': window.__authToken} : {})`. Hit this 2026-05-30 with the Risk Register export button (`b815ab6`). |
| **Standalone HTML pages vs `reports.html#admin` cards — pick the integration pattern early** | First built the Risk Register admin as a standalone page (`public/risk-register-admin.html`), then re-built it as a 4th card on `reports.html#admin` per user feedback. The card pattern matches the existing User / Sites / Departments cards, reuses `.modal-overlay.open` + `toast()` + `esc()` + `.user-table` styles, and keeps the nav simple (flat "Admin" link, not a dropdown). **Rule**: if it's an admin function, default to a new card on `reports.html#admin`. Standalone pages only when the workflow is fundamentally different (heavy filtering, lots of state, distinct user role). |
| **Post-commit deploy hook ignored file deletions before 2026-05-30** | The hook used `git diff --diff-filter=ACMR` which dropped Deletions. Removed files orphaned on prod's `Z:\` forever. Hit when extracting DocuSign reel (`db7594b`) — 10 deleted files stayed on prod after `_deploy.cmd` ran. **Fix shipped**: hook now runs a parallel `--diff-filter=D` pass and emits `if exist "Z:\path" ( del /F /Q "Z:\path" )` blocks. Idempotent (skips files already gone). When in doubt, grep `_deploy.cmd` after a commit to verify del lines are present for removed files. |
| **Zoho 7301 SECURITY_NOT_PERMITTED with misleading "user does not have permission" message** | Token was minted with the narrower `MEAplus.data.read,MEAplus.metadata.read` scope. Despite what Zoho's docs imply, this scope triggers 7301 on Survey Results, REQUEST_TABLE, and MAJOR_INCIDENTS views in prod. **Use `MEAplus.fullaccess.all` instead.** The 7301 error text reads like a per-user-ACL issue but is actually a scope-too-narrow rejection. Hit this on 2026-05-27 when renewing the token — every sync 403'd until the broader scope was used. Updated `RENEW_ZOHO_TOKEN.html` + `ANALYTICS_PLUS_API_SCOPES.md` to reflect the correct scope. |
| **OAuth refresh-token rate-limit death spiral after multiple `pm2 reload`** | `accounts.zoho.com` rate-limits the OAuth refresh endpoint per workspace. When tripped, every restart/cron/manual sync trigger that fires a refresh extends the penalty window. Hit 2026-05-27 — took ~1 hour stopped to clear. **Fix shipped in `a06d5a3`**: circuit breaker in `refreshAccessToken` detects `error: Access Denied` and short-circuits subsequent refresh calls during an exponential backoff window (60s → 60min cap). Reset on first successful refresh. Going forward: avoid `pm2 reload` chains; trust the breaker. |
| **Self Client recreation in api-console.zoho.com invalidates the old refresh token** | When the OLD Self Client gets deleted (Zoho cleanup, password rotation, admin housekeeping) and a NEW one is created, prod's `.env` still points at the OLD `ZOHO_CLIENT_ID`/`SECRET`. Auth code exchange fails with `invalid_code` (misleading — the real cause is client-id mismatch). **Fix**: copy NEW Client ID + Secret from `api-console.zoho.com → Self Client → Client Secret tab`, update `.env` BEFORE running `get-token.js`, then exchange. The dashboard has `RENEW_ZOHO_TOKEN.html` as the canonical runbook. |
| **Classic `<script>` top-level `const`/`let` is SHARED across all classic scripts on the page** | A `const SDP_TICKET_URL_BASE = ...` declared in both `index.html` (line 744) AND `dashboard-shared.js` (line 260) throws `SyntaxError: Identifier already declared` at parse time — kills the entire body script tag. Symptom: page stuck on "Loading dashboard data..." even though API returns data correctly. **Rule**: when refactoring constants into `dashboard-shared.js`, grep for and delete the inline duplicate. Same trap as the `window.__authToken` issue noted in user-memory. Fixed 2026-05-27 in `18329db`. |
| Subtitle overlaps title in PPTX | Always `addTitle(slide, 'Title', null)` — never pass a subtitle string |
| Label touches top border of tile | Use absolute `y+0.03` offset, NOT `valign:'top'` |
| Delta touches bottom border of tile | Use absolute `y+0.29`, NOT `valign:'bottom'` |
| Monthly slide not updating | Both `reports-weekly-pptx.js` AND `reports-monthly-pptx.js` must be edited |
| Old server running after deploy | `EADDRINUSE` → kill orphan on port 3456, then `pm2 restart` |
| **`pm2 reload` EADDRINUSE crash-loop: the ORPHAN keeps serving the OLD `_htmlCache`** | Hit twice on 2026-06-11. `pm2 reload` has a race: the new process binds port 3456 while the old one hasn't released it. When it loses, pm2 retries in a loop (restart counter climbs by thousands), each boot re-attempts a Zoho token refresh (→ rate-limit death spiral), AND the **orphan process keeps serving requests with its boot-time `_htmlCache`** — so deployed HTML changes appear "missing" even though the file on disk is correct and `findstr` confirms it. Symptoms: restart counter jumps (363→2575), html edits invisible after Ctrl+F5, `curl localhost:3456/<page> \| findstr <marker>` returns nothing. **Recovery**: `pm2 stop endeavour-dashboard` → `netstat -ano \| findstr :3456 \| findstr LISTENING` → `taskkill /F /PID <pid>` (surgical — NEVER `taskkill /F /IM node.exe`, that kills the pm2 daemon too) → `pm2 start endeavour-dashboard`. **Prevention**: for deploys that touch server.js or any `_htmlCache`'d HTML, prefer `pm2 stop` + `timeout /t 5` + `pm2 start` over `pm2 reload`. |
| calSyncNeeded state | Shows `'—sync'` — means `getCalendarMonthlyHelpdesk()` returned 0 inbound. Sync Zoho data for the month first |
| Emoji in PPTX render as `?` | Use BMP Unicode only: `✓ ► ■ ▲ ▼ → ⚠` |
| **IIS 500.52 `URL Rewrite Module Error`** (0x80070021) | The `<allowedServerVariables>` section is locked at the server level. Register variables at `applicationHost.config` via `appcmd set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_FORWARDED_PROTO']" /commit:apphost` (and same for HOST + FOR). REMOVE the local block from `web.config`. Discovered 2026-05-09 during CH-273 deploy. |
| **PPTX export returns 502 from `https://itops-dashboard.edv-ops.com`** | IIS ARR proxy timeout (default 30 s on many installs) fires before the Python renderer finishes. The render genuinely takes 45-90 s (matplotlib redraws 8 chart PNGs + python-pptx repack + optional tracker-slides merge). Node is still working when IIS gives up and returns `502 Web server received an invalid response`. **Fix on prod (cmd.exe as admin, run ONCE)**: `cd /d %windir%\system32\inetsrv && appcmd set config -section:system.webServer/proxy /timeout:00:05:00 /commit:apphost && iisreset`. Verify: `appcmd list config -section:system.webServer/proxy`. The Node route at `server.js:/api/reports/exec-pptx` has a 4-min guard timeout (configurable via `EXEC_PPTX_TIMEOUT_MS` in `.env`) which fires BEFORE ARR's 5 min so the user gets a 504 with a useful error rather than IIS's opaque 502. Discovered 2026-05-25. |
| **Inspection submit fails with HTTP 413 even after Node body limit was bumped to 100 MB** | Two body-size gates in the request path; bumping ONE isn't enough. After we lifted Express's `/api/inspection/save` parser from 30 MB → 100 MB in `d4ca435`, the IIS `requestFiltering` was still capped at the original 50 MB (`maxAllowedContentLength="52428800"` in `iis/web.config`). A field user at Houndé hit it 2026-05-25 with a 60-80 MB inspection (64 of 173 items addressed with 1-3 photos each + 2 signatures + notes). IIS returned its own 413 HTML page before the request ever reached Node. **Fix**: bumped `iis/web.config` to `maxAllowedContentLength="157286400"` (150 MB) AND wrote it at the SITE level (apphost-level commit was being overridden by the site's local web.config — see next pitfall). |
| **`appcmd set /commit:apphost` doesn't override a site-level web.config** | The site's local web.config (tier 3 in IIS's config inheritance) always wins over apphost-level changes (tier 2). When we ran `appcmd set ... /requestLimits.maxAllowedContentLength:157286400 /commit:apphost`, the change took effect at apphost but the IT-Dashboard site's own web.config still hardcoded `maxAllowedContentLength="52428800"` — so `appcmd list config "IT-Dashboard"` still showed 52428800. **Fix**: either commit at site level (`appcmd set config "IT-Dashboard" -section:... /requestLimits.maxAllowedContentLength:157286400` with NO `/commit:apphost`), edit the site's web.config directly, or use IIS Manager → site → Request Filtering → Edit Feature Settings (writes to site web.config). The status bar at the bottom of the IIS Manager dialog tells you which file is about to be written — verify it says "configuration: 'IT-Dashboard' web.config" before clicking OK. **Rule of thumb**: when in doubt, commit at the site level — that's the layer IIS reads last. |
| **Inspection submit fails with 413 (Express default page) even after IIS limit is at 150 MB** | A third body-size gate: the GLOBAL `app.use(express.json())` at `server.js:739` runs with the body-parser default (~100 KB) before any route-specific middleware. Body-parser is idempotent — the first JSON parser to consume `req.body` wins, and the global one was rejecting the 60-80 MB inspection body with Express's own 413 HTML page (recognisable: `<title>Error</title>` + `<pre>Payload Too Large</p>` with mismatched tag). The route-specific `inspectionJsonBody = express.json({ limit: '100mb' })` at `server.js:4658` never got a chance. **Fix 2026-05-25**: registered path-scoped parsers BEFORE the global one at server.js:739: `app.use('/api/inspection/save', express.json({ limit: '100mb' }))` (plus aggregate/export at 50 MB and meetings save / issues update / lookups at 10 MB each). The global `app.use(express.json())` still runs but becomes a no-op when `req._body=true`. **Lesson**: when you see Express's 413 HTML page (not IIS's verbose one), the bottleneck is body-parser ordering, not IIS. Three gates total: IIS `maxAllowedContentLength`, Express global `app.use(express.json())`, route-specific parser. Any one of them too tight = 413. |
| **Tracker Input data doesn't persist after the 2026-05-25 path-scoped-parser change** | Direct regression from the fix above. Commit 5f11098 added path-scoped parsers for inspection + meetings but **missed `/api/tracker/save`**. Tracker `D` blob (years × sites × activities × months + targets + config) is typically 100-300 KB — comfortably over the default global 100 KB limit. Saves silently 413'd with the same Express default page; client `handleSave` threw, sync indicator flipped to red ("Save failed — retry") but users (notably mohamed, super_admin) reported it as "data doesn't stay". **Fix 2026-05-26**: added `app.use('/api/tracker/save', express.json({ limit: '5mb' }))` to the path-scoped parser block at server.js:757-762. Also added `[Tracker] save ok user=… role=… scope=… years=… sites=… activities=… size=…KB` audit line on every successful save so future regressions show up immediately in `pm2 logs … \| findstr Tracker`. **Rule of thumb**: when adding a path-scoped JSON parser to fix one route's 413, audit EVERY route that POSTs JSON anywhere larger than 100 KB. Today's audit caught only tracker; future routes with large bodies need similar treatment. |
| **Inspection Submit blocked by "Only X% of checklist items addressed"** | Original `validateForSubmit()` hard-blocked Submit when `pct < 30%`, treating it as an error. Field user at Houndé covered ~40% of 173 items (focused on a few categories) but still wanted to submit. **Fix 2026-05-25** (`inspection.html` line ~3074): demoted percentage from error to warning. Now only the 4 identification fields (date, site, area, lead inspector) are hard errors. Coverage % surfaces in the warnings panel ("Partial coverage: 40% addressed — confirm scope was intentionally narrow") but Submit is never blocked on it. Inspectors can legitimately submit a focused single-category inspection, a header-only access acknowledgement, or work split across multiple sessions. |
| **Inspection photos make state blob huge (60-80 MB)** | Photos inline as base64 in `state.items[].photos[]`. Default `processPhoto()` settings (maxW=1600, JPEG quality 0.85) produce ~500-1000 KB per photo; 80 photos × that = 40-80 MB. **Mitigation 2026-05-25** (`inspection.html` line ~2511): cranked compression to maxLongSide=1280 + quality 0.72. Drops typical photo to ~250-400 KB; 80-photo inspection → ~25-30 MB total — well within Express's 100 MB and IIS's 150 MB ceilings, tolerant to flaky cellular uploads at remote sites. Compression result console-logged per photo: `[Inspection] photo compressed: 1280x960 · 312 KB · key=net-04`. **Longer term** still wants a `/api/inspection/:id/photo` endpoint that uploads each photo separately (multipart, not inline base64) — drops the main state save to ~1-3 MB and lets photos resume independently. Not yet implemented. |
| **HTML edits not appearing after deploy** | `index.html`, `executive.html`, `executive-report.html`, `login.html`, `reports.html`, `analytics.html` are cached in `_htmlCache` at Node startup (`server.js:798-807`). Disk file change is invisible until `pm2 reload endeavour-dashboard --update-env`. Static files like `_shell.js`, `_shell.css`, `brand/*.{js,css}` are served via `express.static` and DO refresh without reload. |
| **Static JS/CSS edits not appearing for 24 h after deploy** | Discovered 2026-06-05 from a super_admin reporting tracker Input values "disappear on refresh". Root cause: `express.static` registered with `maxAge: '1d'` (`server.js:1067`) → browsers cache `.jsx` / `.js` / `.css` for 24 h with NO conditional revalidation. Users keep running a stale `App.jsx` whose `D.inputs` shape no longer matches the server's `loadTracker` contract → saves land OK in the DB but under keys that no longer line up with current activities ordering → next load returns `null` for the cells the user thought they'd edited. **Fix shipped (`server.js:1080-1129`)** — tiered cache policy in the `setHeaders` callback: (a) **Tier A — `no-cache, must-revalidate`** for data-loss-risk modules: `.jsx` files + everything under `/activity-tracker/`, `/dashboard-preview/`, `/design-system/`. Pay 1 RTT per asset per page load to guarantee freshness; ETag returns 304 on unchanged (~200 bytes). (b) **Tier B — `max-age=300`** for shared display libraries: everything under `/lib/` (`dashboard-shared.js` consumed by Helpdesk/Reports/Executive/Analytics) + `analyze-lite.js`. Risk on these is "wrong displayed numbers" not data loss; 5-min cache picks up deploys quickly without RTT on every Helpdesk page load. (c) Everything else (brand, _shell, auth.js, tokens, fonts, images) keeps the default 1-day cache. **Existing browsers carrying a stale cache need ONE Ctrl+F5** to bust the entry; after that the new headers keep them fresh forever. **Rule**: when adding a new fast-iteration browser module, drop its folder into Tier A; when adding a new shared display helper, drop its file into Tier B. |
| **Dashboard shows "Proxy offline" through HTTPS proxy but works on direct IP** | Front-end `PROXY` constant was hardcoding `http://<hostname>:3456` — broke under HTTPS reverse proxy (mixed-content blocking + wrong port). Always use `location.origin` for non-localhost. Pattern in `public/index.html:374` and `public/executive.html:4566`. CORS allow-list in `server.js:681` must include the HTTPS hostname. |
| **`avgResolveDays` differs between executive KPI tile and monthly table** | Pre-merge bug — KPI tile used raw fractional days, table used `Math.floor` per ticket. Aligned in commit `37c2b28` (both now `Math.floor` to match AP). |
| **executive.html stuck on splash, "Chart is not defined" console error** | Chart.js loaded with `defer` but inline `<script>` at line 2608 calls `Chart.defaults.*` during parse. Fix: drop `defer` from the Chart.js script tag (commit `feffa00`). |
| **Activity-tracker tab icons are huge (40–60 px)** | Raw `<svg>` dropped inline without a sizing wrapper. Fixed by emitting `width="1em" height="1em"` directly on the SVG in `brand/icons.js` (commit `70bdf14`). |
| **Phantom groups in executive.html filter dropdown** | `CAB Agents`, `Dakar IT Agents`, `IT Agents` were "removed groups" per canonical filter reference but still appeared as dropdown options. Selecting them collapsed KPIs to 0. Removed in commit `6052eab`. Canonical OPS list lives in `public/lib/dashboard-shared.js → OPS_GROUPS_DEFAULT`. |
| **Node OOM crash after ~7 h uptime, dashboard stuck on "Connecting to data proxy…"** | V8's default heap ceiling is 2 GB; with the warm `_rawCache` of 25 k+ tickets + sync workload Node trends toward that limit and eventually dies with `FATAL ERROR: Reached heap limit Allocation failed`. PM2 auto-restarts (visible as `restarts: 11+` in `pm2 status`) but the browser request mid-crash is lost → spinner forever. **Fix**: raise the heap to 4 GB. Re-apply after any clean PM2 reinstall: `pm2 delete endeavour-dashboard && pm2 start server.js --name endeavour-dashboard --node-args="--max-old-space-size=4096" && pm2 save`. Verify with `pm2 show endeavour-dashboard \| findstr "interpreter args"` — should show `--max-old-space-size=4096`. Hit 2026-05-12 (after ~7 h uptime, restart #11). **The underlying slow leak is separate work** — see the section above. |

---

## Color Constants (C object in PPTX files)

```js
const C = {
  blue:      '2A5490',
  green:     '27AE60',
  red:       'E74C3C',
  orange:    'E87722',
  darkGrey:  '333333',
  midGrey:   '666666',
  lightGrey: 'F5F5F5',
  white:     'FFFFFF',
  tableHead: '2A5490',   // same as blue — used for table header rows
};
```

---

## Deployment Steps — ZIP package (2026-07-08+)

```cmd
:: 1. DEV BOX — build the deploy package (post-commit regenerates _deploy.cmd)
_deploy.cmd
::    → tools\deploy\make-deploy-zip.ps1 → sdp-deploy_<sha>_<stamp>.zip (repo root)

:: 2. copy the .zip to the PROD server, extract anywhere, run FROM the extracted folder:
_apply_on_prod.cmd
::    → xcopy files\* into C:\Apps\SDP-Dashboard  (+ processes DELETIONS.txt)

:: 3. PROD — restart (server.js + boot-cached HTML need it; render.py is copy-only)
_pm2_restart_prod.cmd          :: pm2 stop -> timeout /t 5 -> start (NOT reload — EADDRINUSE trap)

:: If EADDRINUSE crash-loop (orphan on :3456), recover with:
_pm2_recover_prod.cmd

:: 4. Verify (on prod, in C:\Apps\SDP-Dashboard\)
node -e "require('./server.js')" 2>&1 | head -3    :: or just check pm2 status + Ctrl+F5
```

Then each user presses **Ctrl+F5** once. `pm2 reload` is NOT used (race →
EADDRINUSE crash-loop; always stop→wait→start).

### Auto-deploy via git post-commit hook

A post-commit hook at `.git/hooks/post-commit` (in the main repo, shared by all
worktrees) regenerates `_deploy.cmd` in the worktree root on every commit. Since
2026-07-08 `_deploy.cmd` is a **thin wrapper** that runs the committed
PowerShell packager `tools/deploy/make-deploy-zip.ps1`. Running it builds a
**self-contained ZIP** — `sdp-deploy_<sha>_<stamp>.zip` — of every file changed
since the last deploy (cumulative), at its repo-relative path under `files\`,
plus `DELETIONS.txt`, `MANIFEST.txt`, and the `_apply_on_prod.cmd` installer.
**No `Z:` mapping needed.**

The packager reads the `.git/last-deployed` marker (fallback `7fb62d9`, the last
confirmed prod deploy), diffs `<marker>..HEAD`, and **advances the marker to
HEAD** after building the ZIP. So packaging == "this is the deploy".

After Claude commits, output looks like:
```
[deploy] _deploy.cmd will package 8 file(s) + 0 deletion(s) since <sha> into a ZIP.
[deploy] Run it (cmd.exe) -> sdp-deploy_*.zip -> copy to prod -> _apply_on_prod.cmd -> _pm2_restart_prod.cmd
```

**On prod**, `_apply_on_prod.cmd` (bundled in the ZIP) xcopies `files\*` into
`C:\Apps\SDP-Dashboard` (override via `SDP_PROD_DIR`), processes deletions, then
reminds you to run `_pm2_restart_prod.cmd`. `_deploy.cmd`, `_apply_on_prod.cmd`
and `sdp-deploy_*.zip` are all gitignored.

> Claude CAN build the ZIP itself (PowerShell tool → `make-deploy-zip.ps1`), but
> cannot copy it to prod or run pm2 — the user does steps 2-3 on the server.

**Skipped paths (dev-only, never deployed to Z:\):** The hook's
`SKIP_PREFIXES` regex (around line 68) excludes paths that exist in
git but don't belong on prod. Current list:

| Pattern | Why |
|---|---|
| `^iis/` | IIS web.config — installed location, not SMB |
| `^_deploy\.cmd$` | The script the hook just wrote |
| `^docs/` | Dev/internal docs (TRACKER_DB_SCHEMA, handoffs, ADRs) |
| `^tools/exec-pptx/fixtures/` | Test payloads (kpis-*.json) — dev only |
| `^tools/exec-pptx/refs/` | Reference decks + integration guides — dev only |
| `^tools/exec-pptx/INTEGRATION_` | The roadmap MD next to refs/, also dev only |

Add a new line to `SKIP_PREFIXES` when you spot another tracked
file that has no business on prod. The hook lives at
`.git/hooks/post-commit` and is NOT version-controlled — re-apply
the exclusions if the worktree is wiped or someone clones fresh.

Skip auto-deploy for a single commit:
```cmd
git commit --no-verify -m "..."
```

---

## Checklist Before Submitting PPTX Changes

- [ ] Content width = 12.73" on all slides (x=0.3)?
- [ ] `addTitle(slide, '...', null)` — no subtitle?
- [ ] KPI tiles: label y+0.03, value y+0.13, delta y+0.29?
- [ ] Row 0 at y=0.62, Row 1 at y=1.12?
- [ ] Combo chart at y=1.58, h=3.04?
- [ ] Ageing at y=4.72, h=2.66 (fills to 7.38)?
- [ ] SLA violations panel dynamic height (`0.27 + slaRowH + rows*slaRowH`)?
- [ ] Comments panel fills to y=7.38?
- [ ] Monthly slide updated in BOTH `reports-weekly-pptx.js` AND `reports-monthly-pptx.js`?
- [ ] No emoji in PPTX code (BMP symbols only)?
- [ ] Delta strings show full context `"±N  ·  prev: VALUE (LABEL)"`?
- [ ] `node -e "new Function(src)"` syntax check passes on changed files?

---

## Incident SLA Configuration (Zoho Desk)

### Priority → P-Label mapping (used in dashboard & PPTX)

| Zoho Priority | P-Label | SLA Name in Zoho |
|---------------|---------|------------------|
| Critical | **P1** | Critical SLA for Incident |
| High | **P2** | High SLA for Incidents |
| Medium / Normal | **P3** | Medium SLA for Incidents |
| Low | **P4** | Low SLA for Incidents |

> Code reference: `extract_incidents_ytd.js` line 126 — `'critical' → 'P1'`, `'high' → 'P2'`

**Important** (2026-06-04): `request_records` does NOT have an explicit
priority column for major incidents. The priority lives inside
`udf_json` under varying keys (`Priority` / `priority` / `Severity`).
**Two server functions resolve this** — keep both in sync:

| Function | File | Used by |
|---|---|---|
| `_majorIncidents()` | `services/reportPayload.js` | render.py PPTX (Group IT Report) |
| `getMajorIncidentsHistory()` | `reports-db.js` | `/api/data/major-incidents` (browser tile + register) |

Both follow the same fallback chain when `udf_json` is missing the
field: `Priority → priority → Severity → severity → UDF:Priority →
UDF:Severity → (impact === 'Enterprise' ? 'Critical' : 'High')`.
Without the fallback in `getMajorIncidentsHistory()`, the browser's
P1/P2 tiles silently returned **0 even when downtime > 0** — caught
2026-06-04 on May 2026 review (0 P1 + 0 P2 + 123h downtime).
`getMajorIncidentsHistory()` now also computes a normalised `P-Label`
field (`P1`/`P2`/`P3`/`P4`) so the browser doesn't have to redo the
string-matching dance.

---

### SLA Targets by Site

All sites share identical **Resolution Time** and **P4** targets.  
Sites differ only in **Response Time** for P1–P3.

#### Standard Profile — MANA, LONDON, EXPLORATION, HOUNDE, ITY, KALANA, LAFIGUE, **TANDA**

| Priority | Response Time | Resolution Time |
|----------|--------------|-----------------|
| P1 / Critical | **30 min** | 2 hours |
| P2 / High | **1 hour** | 4 hours |
| P3 / Medium | **4 hours** | 1 day |
| P4 / Low | 1 day | 5 days |

#### Enhanced Profile — Dakar, Ouaga, Sabodala

| Priority | Response Time | Resolution Time |
|----------|--------------|-----------------|
| P1 / Critical | **15 min** | 2 hours |
| P2 / High | **30 min** | 4 hours |
| P3 / Medium | **2 hours** | 1 day |
| P4 / Low | 1 day | 5 days |

#### Abidjan (Intermediate Profile)

| Priority | Response Time | Resolution Time |
|----------|--------------|-----------------|
| P1 / Critical | **30 min** | 2 hours |
| P2 / High | **1 hour** | 4 hours |
| P3 / Medium | **2 hours** | 1 day |
| P4 / Low | 1 day | 5 days |

---

### Full Site × Priority Matrix

| Site | P1 Response | P2 Response | P3 Response | P4 Response | P1 Res. | P2 Res. | P3 Res. | P4 Res. |
|------|-------------|-------------|-------------|-------------|---------|---------|---------|---------|
| MANA | 30 min | 1 h | 4 h | 1 day | 2 h | 4 h | 1 day | 5 days |
| LONDON | 30 min | 1 h | 4 h | 1 day | 2 h | 4 h | 1 day | 5 days |
| EXPLORATION | 30 min | 1 h | 4 h | 1 day | 2 h | 4 h | 1 day | 5 days |
| HOUNDE | 30 min | 1 h | 4 h | 1 day | 2 h | 4 h | 1 day | 5 days |
| ITY | 30 min | 1 h | 4 h | 1 day | 2 h | 4 h | 1 day | 5 days |
| KALANA | 30 min | 1 h | 4 h | 1 day | 2 h | 4 h | 1 day | 5 days |
| LAFIGUE | 30 min | 1 h | 4 h | 1 day | 2 h | 4 h | 1 day | 5 days |
| TANDA | 30 min | 1 h | 4 h | 1 day | 2 h | 4 h | 1 day | 5 days |
| ABIDJAN | 30 min | 1 h | **2 h** | 1 day | 2 h | 4 h | 1 day | 5 days |
| Dakar | **15 min** | **30 min** | **2 h** | 1 day | 2 h | 4 h | 1 day | 5 days |
| Ouaga | **15 min** | **30 min** | **2 h** | 1 day | 2 h | 4 h | 1 day | 5 days |
| Sabodala | **15 min** | **30 min** | **2 h** | 1 day | 2 h | 4 h | 1 day | 5 days |

> **Bold** = tighter than Standard Profile. Resolution times are identical across all sites.

---

## IT Activity Tracker Module (v2 — React rebuild, 2026-05-24)

### Architecture Overview

The tracker is a self-contained module sitting alongside the helpdesk dashboard. It does **not** use Zoho data — all inputs are manually entered by site IT admins. The frontend was rebuilt 2026-05-24 to match the `/dashboard-preview/` design system; the calculation engine is unchanged (every formula ported verbatim into `engine.js`).

```
Browser:
  /activity-tracker.html                 entry point (~60 lines, CSP-exempt)
    ↓ activity-tracker/engine.js         window.TR — scoring engine (pure functions)
    ↓ activity-tracker/api.js            window.TRApi — fetch wrappers
    ↓ React + ReactDOM + Babel (CDN)     same pattern as /dashboard-preview/
    ↓ activity-tracker/App.jsx           composition + 7 panels + modals
    ↓ activity-tracker/styles.css        brand-token-driven page styles

  /activity-tracker-legacy.html          snapshot of the previous 779-line page
                                         (fallback URL; can be deleted later)

API (unchanged — same contract pre/post rebuild):
  GET  /api/tracker/load                 returns the full D object
  POST /api/tracker/save                 persists D (RBAC scope enforced server-side)
  POST /api/tracker/export               returns PPTX blob
  POST /api/tracker/reset                wipes + re-seeds (super_admin)

Server:
  tracker-db.js → tracker.db (SQLite)
  tracker-pptx.js → fixComboChartAxes() → Buffer → res.send()
```

### Frontend file layout

| File | Purpose |
|------|---------|
| `public/activity-tracker.html` | Entry point. Loads tokens, brand chrome, Chart.js, engine.js, api.js, React+Babel, App.jsx. **No business logic.** |
| `public/activity-tracker/engine.js` | Direct port of `score / ss / ps2 / fleetStats / execSummary / genCom / effWeights / gi / si2 / gP / gPS / gPC` from the legacy file. Pure functions on `window.TR`. Reads from a passed-in `D`, doesn't touch globals. **Calculation logic is byte-identical to the legacy.** |
| `public/activity-tracker/api.js` | `window.TRApi.{ load, save, reset, exportPptx }`. Thin wrappers around `/api/tracker/*` — same payloads as before. |
| `public/activity-tracker/App.jsx` | The whole React app. ~120 KB of JSX. Contains: Toolbar, Tabs, all 7 panels (Dashboard / Scoring / Input / Heatmap / Tracker Setup / Targets / Roadmap), `Modal` infrastructure, `RedistributeModal`, `ExportModal`. |
| `public/activity-tracker/styles.css` | All page styles. Uses `_tokens.css` brand variables — same surface as `/index.html`, `/executive.html`, `/meetings.html`. |
| `public/activity-tracker-legacy.html` | Untouched copy of the legacy file. Kept as a fallback URL — retire in a future maintenance window. |

### Seven tabs

| Tab | Status | What it does |
|---|---|---|
| **Dashboard** | Phase 2 + 3.5 | Hero (Overall % + Trend) → Pillar Health + Site Leaderboard → Executive commentary → 4 charts. Replaces the old 8-KPI-strip + 11-site-card-grid layout. |
| **Scoring** | Phase 3 | Per-site activity breakdown grouped by pillar. Effective-weight column lights up when redistribution kicked in. |
| **Input** | Phase 3 | 12-month editable grid. Current month highlighted orange. Debounced auto-save (800 ms) on every cell change + explicit Save button forces flush. |
| **Heatmap** | Phase 3 | Site × activity RAG matrix with pillar band header. Hover a column to highlight + show activity name. |
| **Tracker Setup** | Phase 4 | Pillars (with weights), Active sites, Activities (with M1-M12 Window). All edits go through confirm + redistribute modals. |
| **Targets** | Phase 5 | Per-site target value + active toggle per activity. iOS-style toggles. Bulk "All on / All off" per pillar. |
| **Roadmap** | Phase 5 | 12-month Gantt by pillar. Bars positioned by `a.start → a.end`. Two vertical lines: solid orange = selected period, dashed grey = today. RAG-coloured bars. |

### Modal patterns

Two distinct modal scopes coexist (single-modal-visible-at-a-time, no conflict):

1. **`appModal`** in App state — used by toolbar actions (+ Year, Export PPTX). Renders via the generic `<Modal>` component.
2. **`modal`** in SetupPanel state — used by per-pillar / per-activity / toggle-site flows. Same `<Modal>` plus a `<RedistributeModal>` variant for delete-with-redistribute.

The shared `<Modal>` component supports `wide`, custom confirm label, `confirmKind` (`primary` / `danger`), `confirmDisabled`, Escape-to-close, click-outside-to-close.

`<RedistributeModal>` extends `<Modal>` with three strategies — **proportional** (default, splits by existing relative weights), **equal** (even N-way), **custom** (per-row editable input, must total 100% to confirm). A red cascade-warning banner above the strategy chooser surfaces destructive consequences (number of activities / data cells that will be removed) when applicable.

### Auto-save model

Children mutate `D` in place via `engine.si2()`. They then call `onMutate()` which (a) sets `dirty = true` and (b) bumps a `mutationCounter` state. The autosave `useEffect` watches `[mutationCounter, dirty, roles.CAN_SAVE]` and debounces 800 ms before firing `handleSave()`. Concurrent saves are protected via a `lastSaveRef` tag — only the freshest one updates UI state. The explicit Save button bypasses the debounce.

Sync states surfaced in the toolbar:

```
idle  →  saving  →  synced (1.8 s)  →  idle
              ↘  fail (sticky until next change)
```

### SQLite Schema (tracker.db)

Unchanged from the legacy:

```sql
tracker_config   (id=1)   -- activities[], pillarWeights{}, activeSites[], years[], current_month
tracker_targets            -- PRIMARY KEY (site, activity_ix) — target value + active flag
tracker_inputs             -- PRIMARY KEY (year, site, activity_ix) — months_json [12 values]
```

First-run auto-seeds from `tracker-init.json`. Reset via `POST /api/tracker/reset` (super_admin).

### SQLite Schema (tracker.db)

```sql
tracker_config   (id=1)   -- activities[], pillarWeights{}, activeSites[], years[], current_month
tracker_targets            -- PRIMARY KEY (site, activity_ix) — target value + active flag
tracker_inputs             -- PRIMARY KEY (year, site, activity_ix) — months_json [12 values]
```

First-run auto-seeds from `tracker-init.json`. Reset via `POST /api/tracker/reset` (super_admin).

### RBAC Rules

| Role | Load | Save config/targets | Save own inputs | Save all inputs | Export PPTX |
|------|------|---------------------|-----------------|-----------------|-------------|
| viewer | ✓ | — | — | — | — |
| editor | ✓ | — | — | — | — |
| admin | ✓ | — | ✓ (own site only) | — | ✓ |
| executive | ✓ | ✓ | ✓ | ✓ | ✓ |
| super_admin | ✓ | ✓ | ✓ | ✓ | ✓ |

`siteNameToCode()` in `tracker-db.js` maps the user's `site_name` from the users table to a tracker site code (e.g. `'HOUNDE' → 'HGO'`).

### Scoring Engine (tracker-pptx.js / activity-tracker/engine.js)

Both use identical logic — changes must be kept in sync. The frontend half lives in `engine.js` (was inline in `activity-tracker.html` before the v2 rebuild). PPTX generation runs server-side via `tracker-pptx.js` and has its own copy of the math.

```
score(D, site, yr, mo)    → per-activity RAG + weighted score contribution
ss(D, site, yr, mo)       → { g, a, r, active, avg, pScores }
ps2(D, site, pillar, yr, mo) → pillar-level weighted average
fleetStats(D, sites, yr, mo) → { avg, best, attainment }
```

KPI type rules:
- `BOOLEAN`  — 0 or 1 cumulative; GREEN ≥ 1, AMBER ≥ 0.5, RED otherwise (if ended)
- `PERCENT`  — avg over active months; GREEN ≥ target%, AMBER ≥ 75%, RED below
- `MILESTONE`— phase/target; GREEN = complete, AMBER = in progress, RED = none & ended
- `CURRENCY` — actual/target; GREEN ≥ 100%, AMBER ≥ 75%, RED below
- `RATING`   — avg of non-zero months / target; same thresholds as PERCENT

### Tracker PPTX — Layout Reference (10" × 5.625" — LAYOUT_16x9)

> CRITICAL: `LAYOUT_16x9` in pptxgenjs = `cx="9144000"` = **10" wide**.  
> `LAYOUT_WIDE` = `cx="12192000"` = **13.33" wide**. Never confuse the two.

**Slide 1 — IT Ops Strategy Roadmap**

| Element | x | y | w | h | Notes |
|---------|---|---|---|---|-------|
| Header navy | 0 | 0 | 10 | 1.30 | `1E293B` |
| Teal accent | 0 | 1.22 | 10 | 0.08 | `0D9488` |
| Logo | 0.50 | 0.22 | 0.42 | 0.42 | `tracker-icons/logo.png` |
| Title text | 1.10 | 0.12 | 7.00 | 0.48 | White bold |
| Month badge | 8.50 | 0.25 | 1.10 | 0.58 | Teal `0D9488` |
| KPI tiles (5) | 0.475/2.325/4.175/6.025/7.875 | 1.52 | 1.65 | 0.80 | Light bg + accent top bar |
| Chart card L | 0.40 | 2.55 | 4.50 | 2.70 | White, border `E2E8F0` |
| Chart card R | 5.10 | 2.55 | 4.50 | 2.70 | White, border `E2E8F0` |
| Footer text | 0.40 | 5.35 | 9.00 | 0.20 | Italic gray `94A3B8` — NO black bar |

KPI tile accent colors: GREEN=`16A34A`, AMBER=`D97706`, RED=`DC2626`, AVG=`0D9488`, BEST Δ=`0EA5E9`

**Slide 2 — Executive Commentary & Site Summaries**

| Element | x | y | w | h | Notes |
|---------|---|---|---|---|-------|
| Header navy | 0 | 0 | 10 | 0.72 | |
| Teal accent | 0 | 0.65 | 10 | 0.07 | |
| Title | 0.50 | 0.12 | 9.00 | 0.42 | |
| Pillar box i | 0.43+i×(pW+0.14) | 0.84 | dynamic | 0.46 | Full-color bg; icon 0.25×0.25 at x+0.09,y+0.11 |
| Section bar | 0.45 | 1.42 | 0.04 | 0.16 | Teal |
| Site card i | 0.37+i×(cW+0.14) | 1.65 | dynamic | 2.55 | White; colored top bar h=0.055 |
| — Site name | cx+0.10 | 1.75 | | 0.24 | Colored bold |
| — Score % | cx+0.10 | 2.15 | 0.65 | 0.28 | Large bold dark |
| — Delta badge | cx+0.78 | 2.54 | 0.62 | 0.20 | Green/red bg pill |
| — G/A/R badges | cx+0.10/0.61/1.12 | 2.49 | 0.45 | 0.19 | Light bg pills |
| — Separator | cx+0.10 | 2.77 | cW−0.20 | 0.01 | `E2E8F0` |
| — Green icon | cx+0.10 | cardY+1.18 | 0.13 | 0.13 | `green-check.png` |
| — Green text | cx+0.26 | cardY+1.18 | | 0.57 | `334155`, shrinkText |
| — Amber icon | cx+0.10 | cardY+1.90 | 0.13 | 0.13 | `amber-warn.png` |
| — Amber text | cx+0.26 | cardY+1.90 | | 0.46 | `D97706`, italic, shrinkText |
| Gen. Review bar | 0.45 | 4.30 | 9.10 | 0.04 | Teal |
| Gen. Review hdg | 0.55 | 4.35 | 3.00 | 0.18 | Bold dark |
| Bullet icon j | 0.55 | 4.57+j×0.19 | 0.11 | 0.11 | green-check / amber-warn2 |
| Bullet text j | 0.74 | 4.56+j×0.19 | 8.60 | 0.17 | Color: `334155` / `D97706` |
| Footer text | 0.40 | 5.38 | 9.00 | 0.16 | Italic gray — NO black bar |

Dynamic width formulas:
```js
// n pillars:  pW = (9.14 - (n-1)*0.14) / n    startX = 0.43
// n sites:   cW = (9.26 - (n-1)*0.14) / n    startX = 0.37
```

### Tracker Icon Files

Extracted from `IT_Ops_Strategy_Mar2026_template.pptx` and stored in `public/tracker-icons/`:

| File | Source | Used for |
|------|--------|---------|
| `logo.png` | template image1 | Slide 1 header logo |
| `pillar1.png` | template image2 | Network Infra pillar icon |
| `pillar2.png` | template image3 | Biz Partnering pillar icon |
| `pillar3.png` | template image4 | Risk & Compliance pillar icon |
| `pillar4.png` | template image5 | People Dev pillar icon |
| `green-check.png` | template image6 | Site commentary positive + GR bullets 1-3 |
| `amber-warn.png` | template image7 | Site commentary action lines |
| `amber-warn2.png` | template image8 | General Review amber bullets |

### Known Pitfalls

| Pitfall | Rule |
|---------|------|
| `LAYOUT_16x9` vs `LAYOUT_WIDE` | Always verify output `sldSz cx`. `9144000`=10", `12192000`=13.33" |
| `tracker-icons/` missing on server | Copy folder before `pm2 reload` — server logs `null` images silently |
| Commentary always generic | Means actuals not yet entered. Check DB `tracker_inputs` has non-zero months |
| `better-sqlite3` binding error | Native module compiled per OS/arch. Rebuild if moving to new server |
| Admin saving other site's data | `saveTracker(D, userSite)` silently skips inputs for other sites — this is correct RBAC |
| `fixComboChartAxes` not applied | Without it, file opens in LibreOffice but not PowerPoint. Always pipe through it |
| **Engine drift between frontend + PPTX** | `engine.js` (browser) and `tracker-pptx.js` (server) both implement the scoring math. When changing a KPI rule or RAG threshold, update BOTH files — otherwise the live page and the exported PPTX disagree. |
| **CSP blocks the React tracker** | `/activity-tracker.html` and `/activity-tracker/*` need `unsafe-eval` + unpkg.com for Babel/React CDN. The path-scoped exception is at `server.js:182`. If the page silently renders blank with a "Refused to evaluate" console error after a server.js edit, that block was probably moved or its path list edited. |
| **Stale activity_ix after pillar/activity delete** | Deleting an activity must `splice()` it out of `D.activities`, every `D.targets[s]` array AND every `D.inputs[yr][s]` array — otherwise the engine's activity_ix lookups misalign and rows shift. The Phase 4 pillar-delete handler does this for every activity under the deleted pillar; activity-delete does it for the single index. Don't regress to `Array.filter()` which leaves the parallel arrays unchanged. |
| **Legacy file still accessible** | `/activity-tracker-legacy.html` is preserved as a fallback URL. Not linked from the new UI but reachable by bookmark. Delete it in a future maintenance window once the new page has been live for a few weeks. |

---

## IT Inspection Module (v1)

Site-IT inspection tooling for the mining + office sites. Mirrors the
Activity Tracker pattern (own SQLite file, `*-db.js`, `*-pptx.js`,
`*-init.json`) and is fully additive — no migrations touch `tracker.db`,
`reports.db`, or any existing table.

### Architecture overview

```
Browser (inspection.html — form, voice, camera, signature pad)
  ↓ debounced POST /api/inspection/save  (auto-sync + offline queue)
  ↓ GET  /api/inspection/lookups          (form hydration)

Browser (inspections.html — list + KPI tiles + trend + filters)
  ↓ GET /api/inspection/list?site=&from=&to=&risk=&status=
  ↓ GET /api/inspection/aggregate
  ↓ POST /api/inspection/aggregate/export  (rollup PPTX)

Server (server.js, ~line 4380)
  ↓ inspection-db.js → inspection.db (SQLite, 7 tables prefix insp_*)
  ↓ inspection-pptx.js (LAYOUT_WIDE, 13.33" × 7.5", text-only)
```

### Key files

| File | Purpose |
|------|---------|
| `inspection-init.json` | Seed: 10 sites, 26 areas, 6 types, **17 categories (173 checklist items)** — `srv` (Servers & Hypervisor) and `sto` (Storage & Datastores) added 2026-05-23, inserted between `net` and `rack` |
| `inspection-db.js` | Schema + CRUD + cross-site write guard + aggregate roll-ups |
| `inspection-pptx.js` | `generateInspectionPptx(rec, lookups)` + `generateAggregatePptx(payload, lookups)` |
| `public/inspection.html` | Form (port of `IT_Inspection_SDP.html`) with EDV brand + server-sync overlay |
| `public/inspections.html` | List/dashboard with filters + KPI tiles + monthly trend |

### SQLite schema (`inspection.db`)

```sql
insp_sites        (code, name_en, name_fr, country, site_type, display_order, active)
insp_areas        (code, name_en, name_fr, area_group, display_order, active)
insp_types        (code, label_en, label_fr, display_order)
insp_inspections  (id, label, inspection_date, inspection_time, inspection_type,
                   site_code, area_code, area_text, specific_location,
                   inspector_name, inspector_role, accompanied_by,
                   weather, last_inspection_date, scope,
                   overall_risk, operational_impact,
                   key_observations, positive_findings, distribution,
                   state_json,                          -- full state blob (round-trip safe)
                   status, created_by, created_at, updated_at, submitted_at)
insp_findings     (id, inspection_id, category, item_index, item_code,
                   item_text_en, item_text_fr,         -- denormalised → reports survive form edits
                   status, notes; UNIQUE(inspection_id, category, item_index))
insp_actions      (id, inspection_id, ord, description, linked_item, priority,
                   owner, due_date, status, notes, created_at, updated_at, closed_at)
insp_photos       (id, inspection_id, finding_key, action_id, caption,
                   mime_type, data_b64, size_bytes, created_at)
insp_signatures   (inspection_id, signer_type, signer_name, signer_date,
                   signature_b64, signed_at; PK (inspection_id, signer_type))
```

First-run auto-seeds the three lookup tables from `inspection-init.json`. Reset via
`POST /api/inspection/reset` (super_admin only).

### API surface — `/api/inspection/*`

All require `requireReportSession` (session cookie + `x-report-token` header).

| Method · Path | Min role | Purpose |
|---|---|---|
| `GET /lookups` | any | `{ sites, areas, types, statuses, categories, priorityMap, siteAliases }` — one call hydrates the form |
| `GET /list?...` | viewer+ | Paginated headers, filters: `site`, `from`, `to`, `risk`, `status`, `limit`, `offset` |
| `GET /aggregate?...` | viewer+ | KPI roll-up for dashboard tiles |
| `GET /:id` | viewer+ | Full record (header + findings + actions + photos + signatures + state blob) |
| `POST /save` | editor (own site) / admin+ (any site) | Upsert; cross-site writes throw 403 |
| `DELETE /:id` | executive+ | Cascading delete |
| `POST /:id/export` | admin+ | Single-inspection PPTX (4 slides) |
| `POST /aggregate/export` | executive+ | Roll-up PPTX (4 slides) |
| `POST /reset` | super_admin | Wipe + re-seed lookup tables (does not touch inspection rows) |

`/save` and `/aggregate/export` accept a 30 MB JSON body (photos +
signatures are base64 PNG inline). Everything else stays inside the
default `jsonBody` 2 MB limit.

### Site code authority

The inspection form uses its own code table (SGO / HGO / MGO / SMI / SML
/ KGO + DKR / ABJ / OUA / OTH). For cross-module lookups, the loaded
`siteAliases` object maps inspection codes to tracker codes where they
differ:

```
SMI → ITY     (Ity uses SMI in form, ITY in tracker)
KGO → KLN     (Kalana uses KGO in form, KLN in tracker)
OUA → EDV     (Ouagadougou uses OUA in form, EDV in tracker)
```

Server-side `inspectionDb.siteNameToCode(siteName)` maps the `site_name`
column from `users` → inspection code (e.g. `'KALANA' → 'KGO'`). Used by
the route handler to scope writes for editor-role users.

### Save model — Local + manual "Save now" + Submit (chosen 2026-05-24)

**Keystrokes save to localStorage ONLY. Server POSTs fire only when the
user explicitly clicks "Save now" in the toolbar OR submits the
inspection.** This replaced the original debounced auto-sync model
after field feedback that (a) empty/half-filled drafts were appearing
on the dashboard the moment someone opened the form, and (b) field
users wanted explicit control over when their work hit the server
(satellite/cellular at remote sites is unreliable; pushing on every
keystroke wasted bandwidth and sometimes synced half-formed records).

| Action | localStorage | Server (`/api/inspection/save`) |
|---|---|---|
| Keystroke / blur on any field | ✓ (via `orig.apply` in patched `saveCurrent`) | ✗ |
| Click **Save now** in toolbar | (same) | ✓ via `forceSyncNow()` |
| Click **Submit** | (same — `state.status='submitted'`) | ✓ via `forceSyncNow()` chained from `confirmSubmit` |
| Click **Re-open** (admin+) | (same — `state.status='draft'`) | ✓ via `forceSyncNow()` chained from `reopenInspection` |
| Offline queue drain | — | ✓ on boot + after every successful `forceSyncNow` |

Offline queue: if `forceSyncNow` fails (no connectivity, server 5xx),
the inspection id is pushed onto `em_insp_sync_queue` in localStorage.
The queue drains on the next successful `forceSyncNow`, and on every
page boot. A toolbar pill shows depth so the inspector knows there's
unsynced work.

The base64 photo + signature blobs ride inside `state` so a single
`/save` round-trip carries everything. No multipart, no S3 — keeps the
on-prem deploy story simple.

#### Toolbar status indicator

The `#saveStatus` element reflects sync state in real time:

| Situation | Indicator text | CSS class |
|---|---|---|
| Local save, not yet on server (empty draft) | `✓ Saved locally HH:MM` | (no class) |
| Local save, not yet on server (meaningful content) | `✓ Saved locally HH:MM · click Save now or Submit to sync` | (no class) |
| Local save, already on server but dirty since | `✓ Saved locally HH:MM · click Save now to sync` | (no class) |
| Save now / Submit succeeded | `✓ Saved (local + server HH:MM)` | `.saved.server-ok` (green, **bold**) |
| Save now / Submit failed | `✓ Saved locally · ⚠ Server queued` | `.server-fail` (amber, **bold**) |

On failure, a toast surfaces the actual error message
(`Cross-site save blocked: …`, `Inspection is submitted …`, HTTP-code
details, etc.) — no rate-limiting needed since the user explicitly
asked for the save.

#### Console diagnostics

```js
__inspectionSync.lastServerError   // null when healthy, message when not
__inspectionSync.queueDepth        // current offline queue length
__inspectionSync.localDirty        // true when there are local edits not yet pushed
__inspectionSync.forceSave()       // manual server POST (same as Save now), returns promise
__inspectionSync.flushQueue()      // drain the offline queue
```

#### Server-side audit log (grep-friendly)

```
[Inspection] save ok id=… user=… site=… status=draft items=N actions=N photos=N size=NN.NMB
[Inspection] DELETE id=… user=… site=… prior_status=…
```

Confirm via `pm2 logs endeavour-dashboard --lines 200 --nostream | findstr Inspection`.

Because server POSTs now only happen on explicit user action, the log
volume drops dramatically — one save per inspector per inspection
during fieldwork, instead of one per keystroke debounced.

### Voice dictation — idempotent transcript builder

Web Speech API (`webkitSpeechRecognition` in Chrome/Edge) calls
Google's cloud speech service. On flaky networks (satellite / cellular
at remote mine sites) it can emit the **same `isFinal=true` chunk
twice** when the stream re-segments mid-phrase. The old code used an
incremental accumulator (`_recBaseText += finals`) which doubled
transcripts ("the truck broke down the truck broke down").

The patched implementation tracks three separate buffers:
- `_recInitialText` — textarea content at session start (never mutated)
- `_recCommittedFinal` — finals from previously-ended sessions in this
  dictation (committed in `r.onend` before the continuous-mode auto-restart)
- `_recCurrentFinal` — finals from the CURRENT live session; **rebuilt
  from scratch on every `onresult` event** from the full `e.results`
  array (NOT incremental — that's the key)

Composed value = `initial + committed + current`. Duplicate `isFinal`
emissions collapse to the same value instead of doubling. Cross-session
boundaries (the `onend → r.start()` continuous-mode trick that
preserves text across natural pauses) handled by committing
`_recCurrentFinal → _recCommittedFinal` before the restart.

`_buildRecognizer` + the two `toggleDictation*` entry points are the
only places this state lives. All three buffers reset in
`_stopDictation()` and in each `toggleDictation*` entry.

### PPTX canvas

13.33" × 7.5" (LAYOUT_WIDE). Every panel uses `x=0.3, w=12.73`. No
charts — tables and rectangles only — so the deck opens cleanly in both
PowerPoint and LibreOffice without piping through `fixComboChartAxes`.

Slide 1 = Cover + KPI strip (6 statuses) + context cards.
Slide 2 = Critical / Major findings table (status, code, item, notes).
Slide 3 = Corrective actions table (priority, linked, description, owner, due, status).
Slide 4 = Observations + signatures (embeds base64 PNGs).

The aggregate variant uses the same canvas: cover + 6-tile findings-by-status,
inspections-in-scope table, findings distribution bars, monthly trend bars.

### Status & priority

```
status (per finding):  ok · minor · major · critical · opp · na
priority (per action): Critical · High · Medium · Low
status → priority map: { critical:'Critical', major:'High', minor:'Medium', opp:'Low' }
```

The form's `wireChecklistEvents()` auto-seeds an action when a finding
flips to minor/major/critical/opp (handled in the legacy script — keep
that logic untouched on future edits).

### Brand surface used

| Concern | Tokens |
|---|---|
| Palette | `--edv-orange` (CTA + active states), `--edv-blue` (links + Opportunity), `--edv-green` (OK), `--edv-red` (Major), `--color-warning` (amber Minor/Moderate), `--edv-slate` (table headers) |
| Typography | `--font-sans` from `_tokens.css` (Libre Franklin) |
| Icons | `brand/icons.js` — `clipboard-check` (nav), `camera`, `mic`. Also: `plus`, `download`, `refresh-cw`, `check`, `cloud-off` |
| Components | `.edv-empty-state` is available but unused — wire it for the no-results states if needed |

The form page **keeps its inline `:root` block** but maps every legacy
variable (`--bg`, `--accent`, etc.) onto the EDV tokens. That lets the
2 500-line embedded stylesheet stay untouched while picking up the
unified palette — change the alias map at the top of the inline `<style>`
to re-skin in one place.

### Known pitfalls

| Pitfall | Rule |
|---------|------|
| `inspection.db` missing on server | First request to `/api/inspection/lookups` auto-creates + seeds. Safe to delete to force re-seed. |
| Photo body too large (HTTP 413) | The `/api/inspection/save` route uses a dedicated 30 MB `express.json` parser. If a future change touches that route, keep the `inspectionJsonBody` parser ahead of the global `jsonBody`. |
| Cross-site save 403 | Editor-role users are scoped to their `site_id` via `inspectionDb.siteNameToCode()`. `_userInspectionSite()` in `server.js` returns null for admin+ → unrestricted. |
| Static-served HTML out-of-date | `inspection.html` + `inspections.html` are in `_htmlCache` at boot (server.js line 807). Edits require `pm2 reload`. |
| Lookups out of sync with form | The form's hard-coded `<option>` lists are the offline fallback. `hydrateLookups()` replaces them when online — keep both in step or the offline UX desyncs from the DB. |
| Tracker code vs inspection code drift | Inspection module owns its own codes (SGO/HGO/MGO/SMI/SML/KGO + DKR/ABJ/OUA). Don't reuse tracker's `siteNameToCode` for inspection writes — use `inspectionDb.siteNameToCode`. |
| Aggregate export filter mismatch | The `POST /aggregate/export` body must wrap filters as `{ filters: {...} }`. Mismatched casing/keys silently exports an empty deck. |
| **CATEGORIES list lives in TWO places** | `inspection-init.json → categories` AND `public/inspection.html` line 1454+ inline `const CATEGORIES`. Both must be edited together or findings save fine but reports/PPTX lose item text (the JSON drives `_findItemDef` denorm; the HTML drives form rendering). 17 categories as of 2026-05-23. |
| **"Save flow doesn't seem to persist"** | **Expected behaviour under the 2026-05-24 save model**: keystrokes save to localStorage ONLY. Server POSTs happen only on **Save now** or **Submit**. The toolbar says `✓ Saved locally HH:MM · click Save now or Submit to sync` until the user explicitly pushes. The dashboard will be empty until then. If user reports their **Save now** / **Submit** clicks aren't reaching the server: check toolbar amber state, `__inspectionSync.lastServerError` in console, and `pm2 logs ... \| findstr Inspection`. Most likely culprit is cross-site write block (editor's `site_id` doesn't match the form's site selection) or a 413 (state blob too large). |
| **Voice dictation duplicates words** | Web Speech API double-emits `isFinal` chunks on flaky networks. Fixed 2026-05-23 by rebuilding the current-session transcript idempotently on every `onresult` event (NOT incremental accumulation). If a future change touches `r.onresult` in `inspection.html`: keep `_recCurrentFinal` as a from-scratch rebuild, NEVER use `+=`. Same pattern applies to any other Web Speech consumer. |
| **`window.state` is undefined — top-level `let` is NOT on window** | Critical scoping trap in `inspection.html` (and any classic script). The body script declares `let state = {...}` and `let currentId = null` at top level. In **classic mode**, top-level `let` / `const` bindings go into the **script lexical environment** — shared across all classic scripts on the page via BARE name lookups, but **NOT exposed as `window.*` properties**. Only `var` and function declarations get aliased onto window. The overlay script that wraps `saveCurrent` referenced `window.state` / `window.currentId` (which are undefined) and silently bailed out of every server POST. The patched saveCurrent then SHOWED the green "✓ Saved" indicator (from the body script's autosave, which uses bare `state` — that works) while nothing reached the database. Symptom: field user reports "I saved but the dashboard is empty". Fixed 2026-05-24 by switching the overlay to bare `state` / `currentId` references which resolve through the global lexical env to the body script's `let` bindings. Any future overlay added to `inspection.html` (or any other classic-script page) must use bare references, NOT `window.*`, when reading variables declared with `let` / `const`. |
| **HTTP 413 Payload Too Large on `/api/inspection/save`** | The state blob in `inspection.html` carries every photo as a base64 JPEG inline in `state.items[key].photos[]`. A heavily-documented inspection (60-80% of the 173 items addressed with 1-3 photos each) can land in the 30-60 MB range. The previous `inspectionJsonBody` limit was `30mb`, which rejected these requests with Express's default 413 page. Symptom (post-scoping-fix above): the toolbar toast says `Server save failed: save HTTP 413 — <html><pre>Payload Too Large</pre>… — data is safe locally, will retry`. **Fix 2026-05-24**: bumped to `100mb` (`server.js:4461`). Also added a `size=NN.NMB` field to the `[Inspection] save ok …` audit log so we can spot inspections that are creeping toward the cap. Longer-term improvement: the form should chunk photos onto a dedicated `/api/inspection/:id/photo` endpoint so the state blob stays small — separate change. |
| **Photos/signatures now live on the FILESYSTEM, not in SQLite (2026-06-21)** | Inspection photos + signatures were stored as base64 **twice** — inline in `state_json` AND in `insp_photos.data_b64` / `insp_signatures.signature_b64` — bloating inspection.db to tens of MB per record. Now externalized to `<DATA_DIR>/blobs/inspection/<id>/…` via `services/blobStore.js`. **The save/load contract is unchanged** (transparent): `saveInspection` strips inline `data:` URLs out of `state` (replacing them with `__blob` refs) and writes files before the tx; `getInspection` re-inflates so `rec.state.*.dataUrl` (frontend hydrate path) AND `rec.photos[].data_b64` / `rec.signatures` (PPTX path) look exactly as before. **Dual-read**: legacy rows with inline b64 and no `file_ref` pass through untouched, so old + new coexist — no migration required for correctness. `deleteInspection` removes the blob dir. Locked by `tests/inspection-blobs.test.js` (round-trip + DB-slimmed + legacy + delete). Backlog shrink (optional): `node tools/migrate-inspection-blobs.js` (backup-first, idempotent, preserves `updated_at`). `data/blobs/` is gitignored (under `data/`) and NOT deployed. **`md_meeting_attachments` was left alone** — it has no write path and no frontend caller (dormant table). Rule: any new blob field goes through `blobStore`, never a new `*_b64` column. |
| **Empty draft rows on the dashboard** | After fixing the scoping + 413 bugs, the dashboard started showing empty draft rows (no site / no area / no inspector) every time someone opened `inspection.html` and clicked around. Cause: `init()` auto-creates a fresh inspection ID on every page load; any keystroke triggered the autosave debounce → the patched `saveCurrent` POSTed the empty state to the DB. **Initial fix 2026-05-24**: added `_stateIsMeaningful(state, id)` check before the debounced server POST. **Definitive fix 2026-05-24 (later)**: changed the save model entirely to **Local + manual Save now + Submit** — keystrokes now save to localStorage only and never auto-promote to the server. See §"Save model" above. The `_stateIsMeaningful` / `_promotedIds` machinery is retained: it gates the toolbar status hint ("click Save now or Submit to sync") and tracks which inspections have ever hit the server, but the patched `saveCurrent` no longer does a debounced POST. Server pushes flow only through `forceSyncNow()` (Save now button + Submit). |
| **No Delete UI for inspections** | The legacy form's `deleteInspection()` only wiped localStorage — never called the server's DELETE route — and the dashboard had no Delete button at all. Combined with the empty-draft autosave problem above, this left admins unable to clean up the backlog. **Fix 2026-05-24**: (a) relaxed `DELETE /api/inspection/:id` from `requireExecutiveOrSuperAdmin` to `requireAdmin` (admin / executive / super_admin) + added a per-delete audit log line; (b) extended the form's `deleteInspection()` to call the server DELETE before clearing localStorage (with a tolerant fallback if the row was never promoted to the server — 404 treated as success); (c) added a per-row `✕ Delete` button on the dashboard table for admin+ users, with destructive-confirmation prompt that highlights when the inspection is in submitted / closed state. |

---

## Meetings & Council Escalations Module (v2)

Meeting-centric digital twin of the Endeavour Mining Group IT × Mines
operating system. **v2 replaces v1 entirely** — v1's flat-decision
schema is dropped on init (no production data lost; v1 was never
deployed). The unit of capture is a signed **PV** (Procès-Verbal) for
one site × one department × one month, with nested issues / actions /
projects. Escalations are auto-derived from issues flagged `escalate=1`.

Mirrors the Inspections / Activity Tracker pattern — own SQLite file
(`meetings.db`), `meetings-db.js`, `meetings-init.json`, dedicated HTML
pages, `/api/meetings/*` routes — fully additive (no migrations touch
the other DBs).

The model derives directly from three canonical templates:
- `Guide_Operationnel_Reunions_Departementales.docx` (May 2026)
- `Department_Meeting_Report_Template.docx` (the signed PV)
- `Site_IT_Tracker_Template.xlsx` (the quarterly site workbook)

### Architecture overview

```
Browser (meetings.html — list + KPI strip + quick-jump cards)
  ↓ GET /api/meetings/lookups          (11 lookups + sites in one call)
  ↓ GET /api/meetings/list?...         (paginated meetings + nested counts)
  ↓ GET /api/meetings/aggregate?...    (KPI roll-up across meetings + issues)

Browser (meeting.html — 7-section PV editor + audit thread)
  ↓ GET  /api/meetings/:id             (full record incl. updates + attachments)
  ↓ POST /api/meetings/save            (upsert: header + nested children)
  ↓ POST /api/meetings/issues/:id/update  (audit comment + status / escalate flip)
  ↓ DELETE /api/meetings/:id           (executive+)

Browser (meetings-issues.html — flat Issues Log)
  ↓ GET /api/meetings/issues?...       (severity / category / status filters)
  ↓ GET /api/meetings/aggregate?...    (by_category bar chart data)

Browser (meetings-council.html — Council escalations grouped by theme)
  ↓ GET /api/meetings/escalations?...  (alias for /issues?escalate=1)

Browser (meetings-compliance.html — 5 Engagements monitor)
  ↓ GET /api/meetings/compliance?month=YYYY-MM   (per-site leaderboard)

Server (server.js)
  ↓ meetings-db.js → meetings.db (SQLite, 11 lookups + 6 core tables, prefix md_*)
```

### Key files

| File | Purpose |
|------|---------|
| `meetings-init.json` | Seed: 4 intake sources · 15 departments · **9 canonical categories** (CN/HW/IN/OT/AP/SC/DR/SD/LV) · 3 severities · 6 statuses · 4 meeting statuses · **6 escalation reasons** · 6 council themes · 5 project phases · 5 IT involvement levels · the **5 Engagements** |
| `meetings-db.js` | Schema + CRUD + audit-trail + cross-site write guard + per-engagement compliance monitor + `compareDepartment()` for pre-brief diffs |
| `meetings-import.js` | Excel parser → dry-run → commit. Builds a 3-tab template (Meetings / Issues / Actions) + a 4th "Codes" tab listing every valid lookup code. |
| `public/meetings.html` | List/dashboard — hero (+ Bulk import button), 6 KPI tiles, 4 quick-jump cards, filters, sortable meetings table |
| `public/meeting.html` | 7-section PV editor — header / 3 priorities / projects / issues / actions / auto-escalations / sign-off + audit thread + quick-comment box + "Since last meeting" deep-link in the sticky bar |
| `public/meetings-issues.html` | Flat Issues Log — every issue across all PVs with the full filter set + by-category bar |
| `public/meetings-council.html` | Mine IT Council view — escalations grouped by Council theme with indicative ask |
| `public/meetings-compliance.html` | 5 Engagements monitor — per-site leaderboard for the selected month |
| `public/meetings-import.html` | Bulk historical import — admin+ — drag/drop xlsx, dry-run preview, commit (idempotent by `reference`) |
| `public/meetings-progress.html` | "Since last meeting" pre-brief — pick site + department, see standing/resolved/new issues + actions + audit trail since the previous PV in scope |

### SQLite schema (`meetings.db`)

11 bilingual lookup tables (`md_intake_sources`, `md_departments`,
`md_categories`, `md_severities`, `md_statuses`, `md_meeting_statuses`,
`md_escalation_reasons`, `md_council_themes`, `md_project_phases`,
`md_it_involvement`, `md_engagements`) — every row carries `name_en` +
`name_fr` so the UI flips language without a re-query. All extendable
via `POST /api/meetings/lookups/:table` (super_admin).

6 core tables:

```sql
md_meetings              -- one PV header: site × department × meeting_date
                         -- reference = SITE_Department_PV_YYYY-MM
                         -- status: draft / submitted / signed / closed
                         -- 3 priorities inline, sign-off timestamps,
                         -- next-meeting fields
md_meeting_projects      -- department projects in flight (phase, IT involvement,
                         -- status on_track/at_risk/blocked/done, leads, dates)
md_issues                -- issues raised; category (1 of 9), severity HIGH/MEDIUM/LOW,
                         -- champion (Engagement #3), target_date, status,
                         -- escalate flag + reason + council_theme
md_issue_updates         -- audit-trail: status_change, escalate_change, body
md_actions               -- IT commitments; owner_it (Champion), linked_issue_id
md_meeting_attachments   -- inline base64 (rarely used; PV PDFs typically live in SharePoint)
```

Reference format mirrors the SharePoint naming convention:
`HGO_Maintenance_PV_2026-05`. Auto-allocated on first save from
`site_code + department + meeting_date`. If the meeting date is moved
to a different month, the reference is regenerated.

### API surface — `/api/meetings/*`

All require `requireReportSession` (session cookie + `x-report-token` header).

| Method · Path | Min role | Purpose |
|---|---|---|
| `GET /lookups` | any | All 11 lookups + sites in one call |
| `GET /people?site=CODE` | any | Reuses `inspectionDb.listPeople()` for owner autocomplete |
| `GET /list?...` | viewer+ | Paginated meetings; filters: `site`, `department`, `status`, `intake`, `from`, `to`, `q` |
| `GET /aggregate?...` | viewer+ | Meeting + issue KPI roll-up + `by_category` + `by_council_theme` |
| `GET /insights?from=&to=&site=&department=` | viewer+ | Chart-shaped roll-up for `meetings-insights.html` — 7 datasets in one call (monthly time-series, by_month_site stacked-bar source, by_category top 12, by_severity, by_council_theme, compliance_heatmap per site, site_leaderboard with composite score). Default window = last 6 months. |
| `GET /compliance?month=YYYY-MM` | viewer+ | Per-site 5-Engagements leaderboard (single-month, drives the standalone `meetings-compliance.html`) |
| `GET /issues?...` | viewer+ | Flat Issues Log; filters: `site`, `department`, `category`, `severity`, `status`, `escalate`, `council_theme`, `from`, `to`, `q` |
| `GET /escalations?...` | viewer+ | Alias for `/issues?escalate=1` |
| `GET /:id` | viewer+ | Full record: header + projects + issues + actions + updates + attachments |
| `POST /save` | editor (own site) / admin+ (any site) | Upsert; children arrays optional — omit to preserve existing rows |
| `POST /issues/:id/update` | editor (own site) / admin+ | Append audit row; can flip status + escalate |
| `DELETE /:id` | executive+ | Cascading delete |
| `POST /lookups/:table` | super_admin | Append a row to any of the 11 lookups |
| `POST /reset` | super_admin | Wipe + re-seed all lookups (does NOT touch meeting rows) |
| `GET /import/template` | admin+ | Download a blank 3-tab xlsx template (Meetings / Issues / Actions + Codes cheat-sheet) |
| `POST /import/preview` | admin+ | Raw xlsx bytes in body → returns parsed summary + per-row validation errors. **Does not** touch the DB. |
| `POST /import/commit?force=0\|1` | admin+ | Same body shape. Persists. Existing references are UPDATED in place. `force=1` skips bad rows; default refuses if any errors. |
| `GET /progress?site=X&department=Y&[asOf=YYYY-MM-DD\|current_id=N]` | viewer+ | Pre-brief diff — standing issues, resolved-since, new-since, audit trail, meeting history for that site × dept |

The `/save` and aggregate routes use a 30 MB JSON body parser
(`meetingsJsonBody`) — keep it ahead of the global 2 MB parser if the
route handler is ever touched. The `/import/{preview,commit}` routes
take **raw bytes** via `meetingsImportBody` (`express.raw({type:'*/*',
limit:'30mb'})`) — the client POSTs the .xlsx ArrayBuffer directly
with `Content-Type: application/octet-stream`.

### Defensive children contract

`saveMeeting(state, userSiteCode, userId)` only mutates a child
collection when the caller **explicitly** sends the array:

```js
if (state.projects !== undefined) { /* wipe + reinsert */ }
if (state.issues   !== undefined) { /* preserve ids + reinsert */ }
if (state.actions  !== undefined) { /* wipe + reinsert */ }
```

A "header-only" PATCH (e.g. flipping status to `signed` from
`meetings.html`) preserves issues + actions + projects intact, along
with their audit history. This was a v2 smoke-test fix — earlier the
save was wiping children on every call.

### Cross-site write guard (v2)

For editors (userSiteCode set), saveMeeting blocks if **either**:
- the existing meeting belongs to a different site, **or**
- the incoming `header.site_code` is for a different site.

```js
if (existingSite && existingSite !== userSiteCode) throw 'Cross-site …';
if (incomingSite !== userSiteCode)                  throw 'Cross-site …';
```

Both checks are necessary — checking only the incoming site lets an
editor stamp their own site_code onto a meeting that already belongs to
someone else's site. Smoke-test caught this in the v2 build.

### Audit trail

Every issue save that changes `status` or `escalate` automatically
appends a row to `md_issue_updates` with the old → new transition. The
single-meeting editor's right column renders the thread newest-first
with author, timestamp, status-change chip, and body. The quick-comment
box at the bottom posts an update without re-saving the entire PV.

### The 5 Engagements monitor

`meetings-compliance.html` reads `/api/meetings/compliance?month=...`
and reports per-site:

| Engagement | Rule | How measured |
|---|---|---|
| #1 Three departments / month | At least 3 PVs per site per calendar month | Count of meetings per site_code that month |
| #2 Diffusion within 48 h | Signed PV shared within 48 h | `julianday(submitted_at) - julianday(meeting_date) <= 2` |
| #3 Champion / action | Every action has a named owner | `actions_without_champion` count |
| #4 Monthly feedback loop | Write back to depts seen in last 3 months | Currently tracked off-system (placeholder card) |
| #5 Escalation discipline | Every escalate=1 has reason + theme | `missing_reason` / `missing_theme` counts |

Engagement #4 currently shows `—` because the "feedback loop" needs an
outbound communication log we haven't built yet — flagged as future
work.

### Bilingual labels

Every lookup table has `name_en` + `name_fr`. The UI currently labels
form fields with both ("Site · Site", "Department head · Chef de
département"). The seeded category descriptions also carry both
languages for the future language toggle.

### RBAC summary

| Role | View | Create meeting | Edit own-site | Edit any-site | Re-open closed | Manage lookups |
|---|---|---|---|---|---|---|
| viewer | ✓ | — | — | — | — | — |
| editor | ✓ | ✓ (own) | ✓ | — | — | — |
| admin | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| executive | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| super_admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

`closed` meetings lock against editor edits; admin+ can flip the status
back to a non-terminal value via the status dropdown.

### Bulk historical import

The team came into v2 with months of past PVs already in Excel / Word /
SharePoint. `meetings-import.js` lets an admin upload them in one shot
via `/meetings-import.html`.

**Workbook format** (3 tabs + a cheat-sheet):

```
Meetings tab:   reference | site_code | department | meeting_date |
                duration_min | intake_source | status |
                department_head | department_head_title | site_it_lead | other_attendees |
                priority_1 | priority_2 | priority_3 |
                next_meeting_date | next_meeting_location

Issues tab:     meeting_reference | ord | title | description |
                category | severity | status |
                champion | champion_email | affects | target_date |
                escalate | escalation_reason | council_theme | notes

Actions tab:    meeting_reference | ord | description |
                owner_it | owner_email | target_date | status | linked_issue_ord

Codes tab:      auto-generated cheat-sheet — lists every valid site /
                department / category / severity / status / escalation
                reason / council theme code from the live lookups
```

**Foreign keys**:
- `reference` on the Meetings tab. If left blank, the server
  auto-generates `SITE_Department_PV_YYYY-MM` from site_code +
  department + meeting_date.
- `meeting_reference` on Issues + Actions joins back to the Meetings tab.
- `linked_issue_ord` on Actions joins to the 1-based ord of the issue
  in the SAME meeting.

**Two-step flow**:
1. **Preview** — `POST /api/meetings/import/preview` parses + validates
   + returns `{ summary, errors, warnings, meetings: [...] }` without
   touching the DB. UI renders a table of meetings + errors so the user
   can fix and re-upload.
2. **Commit** — `POST /api/meetings/import/commit` parses again and
   calls `saveMeeting()` per meeting in admin scope. Default behaviour:
   if `errors.length > 0`, the whole upload is refused. With
   `?force=1`, bad rows are skipped and the rest commits.

**Idempotency**: existing `reference` matches are UPDATED in place — so
re-uploading the same workbook doesn't create duplicates. The
defensive-children contract on `saveMeeting` still applies: an import
with empty Issues/Actions tabs would **wipe** that meeting's existing
issues. Don't rely on partial imports — re-upload the FULL state per
meeting.

**Date coercion**: Excel serial numbers (cellDates: false), ISO
`YYYY-MM-DD`, and `DD/MM/YYYY` are all accepted. Anything else returns
a validation error.

**`xlsx` dependency**: requires the `xlsx` (SheetJS) npm package on the
server. If it's missing, all `/import/*` routes return 503 but the
rest of the meetings module keeps working — degraded mode is acceptable.

### "Department Meetings" slide — on ALL report decks (added 2026-06-21)

Every report PPTX now emits a **"Department Meetings · <Month>"** slide so the
presenter can justify why department work is / isn't advancing.

- **Data**: `meetings-db.getSiteMonthlyMeetingSummary(siteCode, year, month)`
  — a calendar-month snapshot for one site: cadence KPIs (PVs held vs 3-dept
  target, open/HIGH issues, resolved/new this month, escalations), a
  per-department breakdown with a RAG status (`on_track` / `blocked` /
  `no_pv`), a 3-month opened/closed trend, and an auto-generated
  "why progress stalled" commentary string. Tested in
  `tests/meetings-summary.test.js`. meetings-db now also exports `getDB` +
  `siteNameToCode`.
- **Slide**: `slideDepartmentMeetings(pptx, summary)` + `hasDeptMeetingData()`
  live in **`reports-pptx-shared.js`** — self-contained (inline colours, own
  title/badge) so BOTH `reports-weekly-pptx.js` AND `reports-monthly-pptx.js`
  import it (no duplication despite their forked addTitle/C). Tested in
  `tests/pptx-meetings-slide.test.js` + `tests/pptx-meetings-all-decks.test.js`.
- **All 5 decks wired** (slide appended after that deck's last per-site slide):
  `generateWeeklyPptx` (5th arg `meetingsSummary`), `generateMonthlyPptx`,
  `generateWeeklySummaryPptx` (per site, `report.meetingsSummary`),
  `generateMonthlyPptxV2`, `generateAllSitesMonthlyPptx`
  (`monthlyData.meetingsSummary` / per-site `meetingsSummary`).
- **Wiring**: server.js helper `_meetingsSummaryForSite(siteName, year, month)`
  maps `site_name → site_code` via `meetingsDb.siteNameToCode`, derives the
  month (report period for weekly, `getWeekRange` for the weekly summary, route
  params for monthly), and attaches the summary in each of the 5 PPTX routes.
- **Conditional + backward-compatible**: emitted ONLY when the site has meeting
  data (`hasDeptMeetingData`: `available` + departments/PVs). Callers that don't
  supply a summary (the golden test fixtures) render exactly as before — that's
  why `tests/pptx-monthly-golden.test.js` still matches. Snapshot shows the
  CURRENT month (fills in as PVs land).

### Insights dashboard (`meetings-insights.html` — added 2026-06-02)

Chart-driven analytical view of the whole meetings module — for the IT
manager who wants a six-month snapshot of how the operating cadence is
performing without scrolling through individual PVs. Companions
`meetings.html` (list) and `meetings-compliance.html` (single-month
Engagements monitor) rather than replacing them.

**Layout** (top → bottom):
1. **Hero** + EN/FR toggle + period badge (`Jan 26 → Jun 26` etc.)
2. **Filter bar** — site / department / period (3 / 6 / 12 months)
3. **KPI strip — 6 tiles**: PVs total · Open issues · HIGH open ·
   Escalations open · Overdue · Departments covered
4. **Row 1**: Meetings per month × site (stacked bar) + Issues flow
   (multi-line opened vs closed)
5. **Row 2**: Issues by category (h-bar with HIGH overlay) + Severity
   donut
6. **Row 3**: Council escalations by theme (h-bar) + 5 Engagements
   compliance heatmap (CSS-grid, RAG-colored)
7. **Row 4**: Site leaderboard (sortable, composite score)

**Data plane**: single `/api/meetings/insights` round-trip returns all
7 datasets (see API table above). All filters apply uniformly across
the page — change site, everything re-renders.

**Score formula (composite leaderboard)** — Option A per user choice
2026-06-02: simple unweighted mean of the non-null engagement scores.
E1 (3 PVs/month) + E2 (48h diffusion) + E3 (champion on actions) + E5
(escalation discipline). E4 is excluded — it's a placeholder until the
outbound-comms log feature lands. RAG thresholds: ≥80% green, 60-79%
amber, <60% red. Same thresholds apply per-engagement column.

**Chart.js + heatmap**: Chart.js 4.4 from CDN (already in CSP
allowlist). Heatmap is pure CSS grid (12-col × N-rows) rather than a
chart library — cleaner for tabular RAG data with cell-level labels.

**Backfilled monthly time-series**: `_backfillMonths()` in
meetings-db.js ensures inactive months render as zero rows in the
charts rather than being silently skipped (which would compress the
x-axis and lie about the cadence).

**Period default**: trailing 6 months including current — matches the
ITSM standard visibility window doctrine in this file.

**Stable site colors**: `siteColor(code)` hashes the site code to a
deterministic palette slot, so MGO is always the same blue across
reloads + across the stacked bar and the leaderboard.

### "Since last meeting" pre-brief

Built on `meetings-db.compareDepartment(opts)` (called from
`GET /api/meetings/progress`). For a given site × department, returns:

```js
{
  site, department,
  current, previous,      // meeting headers or null
  as_of,
  standing,       // open issues in scope (HIGH-first, then earliest target)
  resolved,       // closed_at > previous.meeting_date
  new_items,      // issues attached to meetings dated AFTER previous
  actions_standing, actions_resolved, actions_new,
  escalations,    // escalate=1 AND not resolved
  updates_since,  // last 25 audit rows since previous.meeting_date
  meeting_history,// last 6 PVs in scope (UI breadcrumb strip)
  summary: { standing_total, standing_high, resolved_total, new_total,
             escalated_open, actions_standing, actions_resolved, actions_new },
}
```

The "previous meeting" is auto-derived in two ways depending on input:
- `?current_id=N` — previous = most recent PV in scope with
  `meeting_date < current.meeting_date`.
- `?asOf=YYYY-MM-DD` — previous = most recent PV before asOf.
- Neither → most recent PV overall in scope.

This is the IT coordinator's pre-brief view: they pick site + dept,
walk into the next meeting knowing exactly what carried over, what
closed (the wins to report back), what new issues bubbled up, and the
full audit trail since the last conversation. Also satisfies the spirit
of Engagement #4 (monthly feedback loop) — though the formal
"outbound communication log" check still shows `—`.

A deep-link from `meeting.html`'s sticky bar passes
`?site=X&department=Y&current_id=N` so the page lands directly on the
right diff with zero clicks.

### Known pitfalls

| Pitfall | Rule |
|---------|------|
| `meetings.db` missing on server | First request to `/api/meetings/lookups` auto-creates + seeds. Safe to delete to force re-seed. |
| v1 schema still on disk | Init drops v1 tables (`md_decisions` + v1 lookup shapes) before creating v2 schema. Idempotent. |
| Cross-site write 403 | Editor-role users scoped to their `site_id` via `inspectionDb.siteNameToCode()` (reused). `_userMeetingsSite()` returns null for admin+. Both incoming AND existing site must match. |
| Reference jumped a month | Reference is regenerated when `meeting_date` moves to a new month. The old reference is dropped — there's no rename trail. |
| Static-served HTML out-of-date | `meetings.html`, `meeting.html`, `meetings-issues.html`, `meetings-council.html`, `meetings-compliance.html`, `meetings-import.html`, `meetings-progress.html` are all in `_htmlCache` at boot. Edits require `pm2 reload`. |
| Editor can't re-open a closed meeting | Intended — once `closed`, only admin+ can flip status back. Editor would get a 403 with `Meeting is closed — only admin can re-open`. |
| Header-only save wiped children (v2 smoke test) | Fixed by `if (state.X !== undefined)` guard. Don't regress — header-only PATCH must preserve issues + actions + projects. |
| Bulk import wipes children too | The import always sends `issues:[…]` and `actions:[…]` arrays, so saveMeeting WILL wipe + reinsert. Don't run an import expecting it to "merge" with hand-edits — re-upload the FULL state per meeting. |
| Engagement #4 shows `—` | Intentional placeholder — the monthly feedback loop needs an outbound communication log we haven't built. The pre-brief page partially addresses this with its "Audit trail since last meeting" panel. |
| `_unset` Council theme bucket | `meetings-council.html` adds a synthetic `_unset` theme group for issues missing a theme. The API doesn't accept `_unset` as a `council_theme` filter — handled client-side. |
| Owner / Champion field free-text | Datalist autocomplete from `/api/meetings/people` (reuses inspection roster), but the saved value is the plain string — same pattern as inspections. |
| Audit row author "system" | If `req.reportUser.full_name` is missing, falls back to `username`; if both absent, UI shows "system". |
| `/import/*` returns 503 on prod | The `xlsx` npm package isn't loaded. **DO NOT just run `npm install xlsx`** — that fails on Node 24 because better-sqlite3 9.4.3's post-install tries to rebuild against C++17 instead of the required C++20 → `error C1189: #error: "C++20 or later required"`. **Workaround**: xcopy `node_modules/xlsx/` from a dev box that's already got it (xlsx is pure JS, no native bindings, ~7 MB). Then `pm2 reload`. Tested against `xlsx@^0.18`. Long-term fix: upgrade `better-sqlite3` to `^11` (has Node 24 prebuilts), then native `npm install` will work. |
| Label rename on already-seeded lookup row | The `_initSchema` seed gate (`if (n === 0)`) means editing `meetings-init.json` doesn't fix existing rows. Pattern: add an idempotent `UPDATE` block AFTER the seed gate that targets rows still carrying the old value (`WHERE name_en = '<old>'`). Logs once on the affected reload, no-op thereafter. See the `survey` → "IT Survey" rename in `meetings-db.js:_initSchema()` for the canonical example. |
| Excel dates parsed wrong | Set Excel cells to a real date type before saving, OR use ISO `YYYY-MM-DD` strings. `DD/MM/YYYY` is accepted but the dash format (`15-04-2026`) is also parsed as DD-MM-YYYY. |
| "No prior meeting" in pre-brief | Means this is the first PV for the site × dept. Every standing issue counts as "new since" (no reference point yet). Normal behavior, expected on first month. |

---

## Risk Register Module (v1 — 2026-05-30)

Monthly Occurrence export for the operations Risk Register. Aggregates SDP incident tickets per site × per risk domain into an .xlsx that matches the layout the operations team already uses. Two surfaces:

1. **Export button** on the Helpdesk dashboard (Monthly view) — anyone with dashboard access can generate the report
2. **Admin card** at `reports.html#admin` — super_admin only — edits the site name mapping (SDP free-form labels → register short codes)

### Architecture overview

```
Browser (index.html, Monthly view)
  └─ "📥 Export Risk Register" button
     └─ GET /api/risk-register-export?month=YYYY-MM   (X-Dash-Key required)
        └─ risk-register-export.js
            ├─ loadOccurrencesFromDB(db, month)        — SELECT from request_records
            │   └─ classifyIncident(rec, aliases)      — 5 domain rules, first match wins
            ├─ getSiteAliases(db)                      — reads rr_site_aliases (live)
            └─ generateRiskRegisterExcel(month, ...)   — xlsx (SheetJS CE)

Browser (reports.html#admin)
  └─ "🛡 Risk Register — Site Code Mapping" card  (super_admin only)
     ├─ GET    /api/risk-register-config/aliases       — list
     ├─ GET    /api/risk-register-config/sites         — canonical codes (for dropdown)
     ├─ POST   /api/risk-register-config/aliases       — upsert (super_admin)
     ├─ DELETE /api/risk-register-config/aliases/:lbl  — delete (super_admin)
     └─ GET    /api/risk-register-config/unmapped?month=… — diagnostic
```

### Key files

| File | Purpose |
|---|---|
| `risk-register-export.js` | The whole module. Classifier rules, SQLite reader, xlsx writer, admin CRUD helpers, `_initConfigSchema` for the `rr_site_aliases` table |
| `server.js` (around line 2440) | `/api/risk-register-export` + 4 admin routes under `/api/risk-register-config/*` |
| `public/index.html` (button + `exportRiskRegister()`) | Helpdesk monthly view — the launch button |
| `public/reports.html` (admin card + modal + functions) | Admin UI — search for `// RISK REGISTER` section header |
| `reports-db.js` | Added `impact TEXT` column to `request_records` schema + idempotent ALTER migration |
| `zoho-sync.js` | Added `impact: r['Impact'] \|\| null` to the sync row mapping |

### Five risk domains (first-match-wins classifier)

**Matching is SUB-CATEGORY-driven, mostly category-agnostic** (changed 2026-06-28).
SDP duplicates the same subcategory names (Electrical power & UPS, Radio,
Servers, …) under several parent categories, so a ticket's `category` is
unreliable. Each match object requires every field it specifies
(`classifyIncident` in `risk-register-export.js`):
- `{ sub: 'X' }` — match `sub` under ANY parent category (default; for specific
  subcategory names SDP duplicates across parents).
- `{ cat: 'Y', sub: 'X' }` — STRICT, only under category `Y`. Used for the two
  GENERIC names `System` / `Technical` (Enterprise Applications) so unrelated
  tickets like `ERP Support / System` are NOT pulled into domain 4.

| # | Domain | SDP sub-category matches |
|---|---|---|
| 1 | Unavailability of Internet | `Network issues`, `WAN` (any parent) |
| 2 | Unavailability of the mobile phone | `3G/4G Internet & GSM-SIM` (any parent) |
| 3 | Unavailability of electrical power | `Electrical power & UPS` (any parent) |
| 4 | Infrastructure unavailability | any-parent: `Servers`, `Data Centers`, `Network`, `Backup`, `Database`, `Cloud Services`, `Issue with Email`, `Network Configuration`, `VPN (Remote Access Services)` · **strict** `Enterprise Applications / System` + `… / Technical` |
| 5 | Radio system unavailability | `Radio` (any parent) |

> **Gotcha (2026-06-28):** the original rules pinned `cat:'IT Infrastructure'`
> for elec/radio AND used the wrong sub names (`Power & UPS`, `Radio / Telecom`)
> → domains 3 & 5 were **0 on every site**. Real SDP names are
> `Electrical power & UPS` and `Radio`, and the subs are duplicated across
> parents → hence category-agnostic matching (with `System`/`Technical` kept
> strict to avoid over-counting). Also the SheetJS date cell rendered the
> **previous day** (e.g. `06-29` for June) from a midnight `Date`; anchoring the
> last-day date at **noon** fixes the off-by-one. Validated on real June-2026
> data (192 incidents → D1=22 · D2=8 · D4=30 · D3=0 · D5=0).

Source/Actions text per domain is fixed (per spec §5) — see `DOMAINS` array in `risk-register-export.js`. Effecacite columns ("Leave empty (0)") are spec-required.

### "Services affected" field takes PRECEDENCE over category (2026-06-29)

SDP additional field **`txt_services_affected`** (a multi-select Check Box,
options Internet / Mobile phone / Electrical power / Infrastructure (FW, files,
data, mail, etc.) / Radio = the 5 domains 1:1) lets the technician **declare**
which risks an incident materialised. It syncs into `request_records.udf_json`
under key **`UDF:Services affected`** as a **comma-joined list of the exact
labels**. ⚠️ The Infrastructure label itself contains commas, so parse by
**keyword** (internet/mobile/electrical/infrastructure/radio), never `split(',')`.

> **Sync fix (2026-06-29):** the requests sync USED to capture `udf_json` **only
> for Major Incidents** (`zoho-sync.js` `_miBase = allRows.filter(_isMajorIncident)`),
> so a regular `Incident`'s Services-affected was silently dropped. Fixed: the
> sync now builds udf via `buildUdfRows(newRows)` → UDFs captured for **every
> changed incident** (extractUdf keeps non-empty only → bounded by the
> incremental set). **A one-time `force=true` requests sync backfills `udf_json`
> across the whole table** (an already-synced incident whose Last Updated Time is
> in the past isn't re-pulled by a normal incremental sync). Tested in
> `tests/zoho-sync-udf.test.js`.

`domainsForIncident(rec)` (in `risk-register-export.js`) resolves an incident's
domain set with this precedence (impact≠Individual + non-Inspection still apply
as the AND gate):
1. **Services affected populated → it WINS** (authoritative, **multi-domain** —
   one incident can count toward several risks, e.g. power outage → Internet +
   Electrical + Radio). The category/sub inference is **NOT** also applied → no
   double-count.
2. Field empty → fall back to the single category/sub classification.

So the *Occurrence* column can now exceed the incident count (1 occurrence **per**
risk materialised — correct for a risk register). Applied to **all months**
(the field is populated back to Jan 2026). Diagnostics expose
`classified_via_services_affected` vs `classified_via_category`. Tested in
`tests/risk-register-classify.test.js` (pure parser + in-memory loadOccurrences).

**Provenance column (col. J "Origine occurrence")**: `loadOccurrencesFromDB` also
returns `sources[site][domain] = { field, category }` (per-cell breakdown, since
a cell aggregates several incidents and can be mixed). `generateRiskRegisterExcel`
emits a trailing column J showing `Services affected` / `Catégorie` /
`Mixte: X SA / Y cat.` per row — so the reader knows which occurrences are
technician-declared vs category-inferred. Additive (columns A-I unchanged).

### Filtering rules

```
EXCLUDED if any of:
  - category = 'Inspection'      (audit records, not incidents)
  - request_type NOT LIKE '%Incident%' (only Incident + Major Incident counted)
  - impact = 'Individual'        (user-level, not operational)
  - resolveSite(site) === null   (site not on the Risk Register)
  - no domain rule matches the category/sub-category combo

INCLUDED:
  - everything else, including impact = NULL (treated as in-scope per
    2026-05-30 decision; 91% of historical rows have NULL impact)
```

### Site alias mapping

`rr_site_aliases` SQLite table (in `reports.db`). Schema:

```sql
CREATE TABLE rr_site_aliases (
  sdp_label  TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);
```

Seeded on first call with 12 defaults from `DEFAULT_SITE_ALIASES` in the module:

| SDP label | Register code |
|---|---|
| HOUNDE | HGO |
| MANA | MGO |
| ITY | IGO |
| KALANA | KGO |
| Sabodala | SGO |
| LAFIGUE, LAFIGUE - SML | SML |
| Massawa, MASSAWA | MASSAWA |
| Ouagadougou | OUAGA OFF1 |
| Fetekro Exploration Office, Exploration CI | EXPLO |

Off-register SDP labels (`LONDON`, `Dakar`, `ABIDJAN`, `ASSAFO`, …) are silently dropped — they're corporate / regional offices, not operating mines, not on the Risk Register. Admins see them in the "Unmapped sites this month" strip on the admin card.

`resolveSite()` does case-insensitive fallback for label drift (`HOUNDE ` → still maps to HGO).

### `EMSA` and the canonical SITES list

The 10 canonical site codes are hardcoded in `SITES` in the module:

```
IGO · SGO · MASSAWA · HGO · KGO · MGO · EXPLO · OUAGA OFF1 · EMSA · SML
```

These render as column B of the export. **`EMSA` is included in the column list but has no SDP label mapped to it yet** — Endeavour Mining S.A. doesn't appear in incident tickets under any consistent label as of 2026-05-30. The row renders with Occurrence = 0; when SDP starts producing tickets with an EMSA-mappable site label, an admin adds the alias via the UI and the row populates.

### Output format (SheetJS CE — security-first choice)

| Column | Header | Source |
|---|---|---|
| A | Dates | Last day of selected month (real date object, `yyyy-mm-dd` formatted) |
| B | Site | One of the 10 canonical codes |
| C | Liste des risques Majeurs | Domain label |
| D | Source | Spec-defined static text per domain |
| E | Actions(préventives & correctives) | Spec-defined static text per domain |
| F | Effecacite actuelle(%) | 0 (spec: "Leave empty") |
| G | Effecacite Cible(%) | 0 (spec: "Leave empty") |
| H | Commentaires | empty (spec: "Leave empty") |
| I | Occurrence | Aggregated ticket count for site × domain |

Total rows: 1 header + 10 sites × 5 domains = 51 rows. Output ~16 KB.

**Styling lost on write (SheetJS CE limitation)**: cell fill colors (red/blue/green header bands), bold + white text, borders, frozen pane. Preserved: column widths, row heights, date number format, cell values. Acceptable trade-off — data correctness over aesthetics; users can apply Excel's "Format as Table" once if they want the visual styling back.

### Diagnostics

Every export sets `X-Risk-Register-Diag` response header + console-logs to pm2:

```
{
  total_incident_rows: 251,        // matched the WHERE clause
  classified: 187,                  // ended up in the output
  classified_with_null_impact: 165, // subset — NULL impact still counted
  skipped_no_site: 0,               // site was empty string
  skipped_unknown_site: 47,         // site not in rr_site_aliases
  skipped_unknown_site_top: [       // top 5 by frequency for spotting drift
    'LONDON (22)', 'ABIDJAN (19)', …
  ],
  skipped_non_operational: 11,      // impact == 'Individual'
  skipped_no_domain: 6              // in-scope impact, but no rule matched
}
```

Operators check the diagnostics in:
- Browser DevTools Console: `[risk-register] diagnostics: {...}`
- Browser DevTools Network tab: response header `X-Risk-Register-Diag`
- Prod logs: `pm2 logs endeavour-dashboard --lines 50 --nostream | findstr risk-register`

### Admin UI walkthrough

`reports.html#admin` → scroll past Users / Sites / Departments → "🛡 Risk Register — Site Code Mapping" card (super_admin only — hidden for other roles).

Workflow:
1. Open the card — see existing mappings (sortable by code), plus the "Unmapped sites for [month]" strip
2. Click `+ Map` next to an unmapped label → opens the New Mapping modal pre-filled
3. Choose a register code from the dropdown → Save
4. Effect is **immediate** — next export uses the new mapping (no pm2 reload required)
5. To edit: click Edit on an existing row → modal opens with label locked + code editable
6. To delete: click Delete → confirm prompt → the mapping vanishes; future tickets with that label show up as unmapped again

Audit log: every mutation writes `[rr-config] upsert HOUNDE → HGO by <username>` (or `delete`) to pm2 logs. The DB also stores `updated_at` + `updated_by` per row.

### RBAC

| Role | Export .xlsx | View mappings | Edit mappings |
|---|---|---|---|
| viewer | ✓ | — | — |
| editor | ✓ | — | — |
| admin | ✓ | — | — |
| executive | ✓ | — | — |
| super_admin | ✓ | ✓ | ✓ |

`GET /api/risk-register-config/aliases` is open to any authenticated user (for sanity-checking before generating a report); only super_admin sees the card in `reports.html#admin` and can mutate.

### Known pitfalls (Risk Register-specific)

| Pitfall | Rule |
|---|---|
| Export shows zero occurrences everywhere | (a) Site name mapping is wrong — open admin card → "Unmapped sites this month" → add aliases. (b) Impact column is empty — check `node -e "..."` on `reports.db` to see `COUNT(impact)`. Force re-sync via `/api/sync/trigger/requests?force=true` to backfill. |
| New mine added to operations | Add to canonical SITES list in `risk-register-export.js` (one line) → deploy → restart → SDP label will start appearing in admin card's "Unmapped sites" → admin adds the alias. |
| Domain rules need adjustment | Edit `DOMAIN_RULES` in `risk-register-export.js`. NOT exposed via admin UI (too risky for a simple form — changes affect classification across all months). |
| Diagnostics show high `skipped_no_domain` | Lots of in-scope incidents whose category/sub aren't on the risk register. Could be normal (we only track 5 domains) or could mean SDP added new sub-categories that should be folded in. Spot-check the underlying tickets to decide. |
| `rr_site_aliases` corrupted | `getSiteAliases` falls back to `DEFAULT_SITE_ALIASES` if the SELECT fails, so exports still work. To rebuild: `DELETE FROM rr_site_aliases; -- next request re-seeds from defaults` |

---

## SharePoint Executive View (v1 — 2026-07-01)

Public, read-only, **exception-only** IT status snapshot meant to be embedded as
a SharePoint Quick Link, not a replacement for the full dashboard. One page,
aggregates only.

**Purpose**: give any Endeavour employee (no login) a one-glance "is IT healthy
this month" view — headline KPIs, sites needing attention, upcoming planned
maintenance, strategic (Activity Tracker) progress, and admin-authored
highlights/focus — without exposing ticket-level detail.

### Data flow

```
Browser: GET /exec-view.html (public route, no auth, no window.__ak)
  └─ fetch GET /api/exec/summary   (public — exempted from the /api/ auth gate,
                                     60 s server-side in-memory cache)
       └─ services/execSummary.js loadExecSummary(deps)
            ├─ mapHelpdeskKpis / mapSpark / mapSiteRows / mapActiveMi
            │    → reports-db.js readers: getMonthlyHelpdeskHistory,
            │      getRequestMetrics, getSurveyKpisDB, getSlaTrendDB,
            │      listSites, getActiveMajorIncidentsForSite, getUpcomingChanges
            ├─ mapStrategic → tracker-db.loadTracker() + FAITHFUL scorers
            │      re-exported from tracker-pptx.js (fleetStats/ps2/ss/score —
            │      same math as the tracker PPTX, no reimplementation)
            └─ deriveSiteStatus (pure) → buildExecSummary (pure, whitelisted)
                    → JSON response consumed by exec-view.html
```

`GET /api/exec/summary` is exempted at `server.js` (`app.use('/api/', ...)`,
the `req.path === '/exec/summary'` short-circuit BEFORE the dash-key/session
check) — it is the ONLY unauthenticated `/api/*` route in the app. Everything
else under `/api/exec/*` (the editorial reader/writer) stays behind the normal
gate + `requireReportSession` + `requireAdmin`.

### Site status — derived, exception-only, no OPManager in v1

`deriveSiteStatus(rows)` in `services/execSummary.js` is a pure function:
`has_active_mi → 'major'`, else `overdue_open >= 1 → 'degraded'`, else omitted
entirely (`'operational'` sites are never listed — the page shows problems,
not a roster). Sorted major-first then by open-incident count, capped at 4.
**No real device/uptime monitoring (OPManager) is wired in v1** — status is
inferred purely from SDP incident data (active Major Incident + overdue open
backlog). Site name matching is accent/case-folded (`_normSite`) to survive
`Houndé` vs `HOUNDE` drift, same class of trap documented elsewhere in this
file for `request_records.site`.

### Editorial store — admin-authored highlights/focus

New table `exec_view_editorial` in `reports.db` (sqlite-only, `TODO(pg)` noted
inline for the eventual `REPORTS_BACKEND=postgres` fork):

```sql
CREATE TABLE exec_view_editorial (
  period          TEXT PRIMARY KEY,   -- 'YYYY-MM'
  highlights_json TEXT,               -- string[], max 4, blanks dropped
  focus_json      TEXT,               -- {title, subtitle}[], max 3
  updated_at      TIMESTAMP,
  updated_by      TEXT
);
```

`reports-db.js` exports `getExecEditorial(period)` (returns `{highlights:[],
focus:[]}` default) and `setExecEditorial(period, {highlights, focus}, user)`
(caps + drops blank entries so the rendered page footprint stays predictable
regardless of admin input). Edited via a new **"Exec View" card** on
`reports.html#admin` (admin+) — `GET`/`PUT /api/exec/editorial?period=YYYY-MM`,
both behind the normal auth gate. The summary endpoint reads the editorial row
for the **current** period only.

### PII boundary

`buildExecSummary()` in `services/execSummary.js` builds the response by
**whitelisting fields one at a time** (`pick(obj, [...])` helper) — it never
forwards a raw DB row. Excluded by construction: ticket subjects, requester /
technician names, verbatim survey comments, per-technician stats, raw change
records (only `date/title/window/impact/scope` survive from
`getUpcomingChanges`). If a future field is added to the endpoint, whitelist it
explicitly in the same style — don't widen `pick()` calls to "just pass the
object through."

### Files

| File | Purpose |
|---|---|
| `services/execSummary.js` | `deriveSiteStatus` (pure) + `buildExecSummary` (pure, whitelisted assembler) + `loadExecSummary(deps)` (live-data glue, DI'd deps for testability) + the per-KPI mappers |
| `public/exec-view.html` | The public page. No `window.__ak`, no session — fetches only `/api/exec/summary` |
| `public/reports.html` | Admin "Exec View" editorial card (highlights/focus editor) |
| `reports-db.js` | `exec_view_editorial` table + `getExecEditorial`/`setExecEditorial`; `getUpcomingChanges(days)` reader (PII-safe column whitelist) |
| `tracker-pptx.js` | Now also exports `fleetStats`/`ps2`/`ss`/`score` (Task 1 of this feature) — no logic change, just re-exported so execSummary can reuse the exact same scoring math instead of forking it |
| `tests/exec-summary.test.js`, `tests/exec-summary-load.test.js`, `tests/exec-editorial.test.js`, `tests/exec-routes.smoke.test.js` | Unit + integration coverage for the assembler, the live-glue mappers, the editorial store, and the HTTP routes |

### Deploy note

`server.js`, `reports.html`, and `exec-view.html` are server-code / `_htmlCache`
surfaces — after `_deploy.cmd`, use `pm2 stop` → `timeout /t 5` → `pm2 start`
(NOT `pm2 reload` — see the EADDRINUSE pitfall in Known Pitfalls). SharePoint
Quick Link target: `https://itops-dashboard.edv-ops.com/exec-view.html`.

### v2 / follow-ups (not in scope for v1)

- Additional tabs (Service Health / Sites / Projects / Reports / Knowledge) —
  v1 ships a single summary screen only.
- Real OPManager uptime feed instead of incident-derived site status.
- Native SharePoint integration (SPFx web part / Microsoft Graph / embedded
  Power BI) instead of an iframe-able external page + Quick Link.
- Single-screen density polish + emoji→brand SVG icon pass (the rest of the
  dashboard completed this migration; exec-view.html hasn't yet).
- Real SDP deep-link URLs — the page currently has `#TODO_SDP_*` placeholders
  where a "view in SDP" link would go.
- A pg fork of `getExecEditorial`/`setExecEditorial`/`getUpcomingChanges` (all
  currently sqlite-only) + an async fork of `loadExecSummary`'s mappers for
  when `reports.db` cuts over to `REPORTS_BACKEND=postgres`.
| Stylings dropped on .xlsx | SheetJS CE limitation, documented above. Users can "Format as Table" in Excel once to restyle. Or switch to SheetJS Pro (license cost) for full styling support. |
