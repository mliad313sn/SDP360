# SDP360 — Product Owner review of the corrective plan against the external audit

> Product Owner review (AI perspective) of the corrective plan against the external committee report "SDP360_Rapport_Audit_Comite_Produit_2026-11-02" (not stored in the repo). Decisions marked PROPOSED are not approved; human gates in section E remain open.

Date: 2026-11-04 · Reviewer: Product Owner (AI agent — this document recommends and prioritises; it approves
nothing that the boundary rules reserve for people) · Repo read: `/home/user/fixinst`, branch `sdp-waves` at
`2785963` (A-03a, A-01, A-02, A-04 merged in wave 1; A-08 merged in wave 2; A-03, A-05, A-07 in progress —
A-05 has a paused WIP commit `27cfbb2`, A-07 has no commit yet).

Inputs: the 29-goal playbook (`playbook/goals/*.md`, `playbook/detail/g0..g6.json`) and the external audit
(`gptaudit/out/report.txt`, 2026-11-02, French, static reading only — it could not clone or run anything).

---

## A. Verdict on the audit

### A.1 Overall

The audit is a fair, mostly accurate **outside-in product view**, and its headline verdict (NO-GO for general
production, conditional GO for a controlled TEST pilot on 1–2 sites) is the same as our own G24 dossier of
29 October (`docs/agent-execution/G24-DOSSIER-GO-NOGO-FR.md` §1, §4) — most of its P0 list is literally our
eight open human gates restated. It looked at commit `8cbdee9`, which is **our** "Wave 1: merge goal/a-01"
commit on `sdp-waves`; A-04 and A-08 merged after it, so its view of the installer is one wave behind.

Where it adds value: it looks at the product as a **value chain** (need → decision → funding → execution →
verified benefit) and at **pilot measurement**, two things our playbook — built from a defect review — does
not cover. Where it is weak: it found none of the concrete data-loss, concurrency, privacy and upgrade
defects that make up our waves 1–2, because it ran nothing.

### A.2 Factual claims checked

| Audit claim | Verdict | Evidence |
|---|---|---|
| README says Node 18+ and SQLite fallback; package.json needs Node ≥22 <23 | **Verified** | `README.md:4` "Node.js 18+ … (SQLite fallback)", `:27`, `:41` ("~30 s, sqlite"), `:53` ("sqlite + pg forks"); `package.json:27-28` `"node": ">=22 <23"`; CLAUDE.md top: PostgreSQL is the only database since PO-08 |
| `routes/roadmap.js` "presents itself as not mounted" | **False (stale comment)** | The file's header says "NOT mounted in server.js yet" but `server.js:7664` mounts it (`app.use(require('./routes/roadmap')(…))`). The comment is wrong, not the wiring |
| Chart.js loaded from CDN on index.html and executive.html | **Verified and understated** | 14 pages load `cdnjs …/Chart.js/4.4.0`, plus `activity-tracker.html` (4.4.1), `system-logs.html` and `executive-report.html` (jsdelivr) and two datalabels plugin copies; `activity-tracker.html:36` loads **React from unpkg in production**; `login.html:10-12` loads Google Fonts. CSP whitelists these origins (`server.js:162`, `:205-206`). A site with filtered Internet loses every chart and the tracker page entirely |
| Catalogue: 1/16 rules implemented, R01–R16 largely partial, sends armed off | **Verified** | `docs/sdp360/completion/REPORT-ALERT-CATALOGUE.md:8` — reports 1 implemented / 13 partial / 2 missing; rules 1 / 12 / 3. Note `sync_alert_enabled=1` with **empty** recipients (R11/A08): failure alerts reach nobody |
| D-13 (report release authority/channels) and D-14 (department RBAC) open | **Verified** | `docs/sdp360/2027/02-DECISION-LOG.md:21-22`, both "Open"; site-only scoping today |
| Funding requests, period allocation, benefits register not built (G12) | **Verified** | `docs/agent-execution/G12.md` "Not built: funding requests, period allocation, benefits register" |
| Gantt, templates, RACI not built (G11) | **Partly outdated** | true at G11; our A-14 (project page with Gantt) is planned, not built |
| Roadmap and portfolio are two planning notions (P1-17) | **Verified** | `docs/agent-execution/G13.md`: migration exists, dry-run by default, legacy kept readable; cut-over is a human gate after a parity cycle |
| Playwright evidence lives in scratch, not in CI (P1-20) | **Verified** | no Playwright in `package.json` or `.github/workflows/ci.yml`; G17/G19 say "harness in the session scratchpad, not in CI" |
| server.js ~415 KB / ~7 800 lines; executive.html ~599 KB, reports.html ~522 KB, executive-report.html ~474 KB | **Verified** | 415 587 bytes / 7 790 lines; 598 909 / 524 877 / 473 603 bytes |
| i18n is exact-text, not keyed | **Verified** | `public/lib/i18nText.js` (43 lines, exact-text replacement); `_shell.js:292` dictionary of literal strings |
| No usage/benefit measurement; T1–T8 + SUS protocol exists but never run | **Verified** | `docs/ops/USABILITY-TEST-PROTOCOL.md:21-32`; G24 §5 "Bénéfices métier: non mesurés"; `TCO-TEMPLATE.csv` has no figures |
| "Trust layer" (source / date / formula / certification per number) missing | **Half true** | Server side exists: `services/metricRegistry.js:28-31` carries formula, source, owner and `certification: 'not certified — …'` per metric, served at `GET /api/metrics/registry` (`routes/metrics.js:19`). It is **not shown** on the pilot screens: `index.html`, `site-report.html`, `exec-view.html` contain no "not certified" wording, and `index.html:1809` prints "Data as of" + the **browser's clock**, not the data date |
| "À traiter" / My obligations inbox missing | **Half true** | `obligations.html` + `routes/obligations.js` compose commitments, handoffs, meeting/inspection actions and report follow-ups — but **per site**, not per person, and commitments/handoffs are behind switches that are off. Our A-10 ("My work") is the per-person inbox |
| PG17 restore / upgrade not proven on a real site (P0-08) | **Verified** (with nuance) | CI proves install/update/rollback/restore (`installer.yml`), local rehearsals exist (`docs/ops/rehearsals/2026-10-29-*`, `docs/ops/restore-drills/2026-10-21.md`); nothing on the TEST server. A-03 adds the missing 1.11-under-pm2 case to CI |
| Field PWA: quota, real phone, weak network not proven (P1-16) | **Verified, and one concrete gap found** | `public/field/app.js` never calls `navigator.storage.persist()` / `estimate()` and has no quota handling — the browser may evict the offline queue under storage pressure. A-07 fixes this for `inspection.html` only |
| Licence "internal use only" | **Verified** | `LICENSE:1-5` |

### A.3 Where the audit is right and our plan is wrong or incomplete

1. **No goal makes the product run offline-from-Internet.** We noted the CDN dependency (A-22 detail) but left
   vendoring "optional". For mine sites with filtered or satellite links this is a pilot blocker. → **B-01**.
2. **No goal measures anything.** The pilot cannot produce a GO/NO-GO without a baseline and an extraction of
   adoption and cycle times. Our plan is entirely defect-driven. → **B-02**.
3. **Uncertified numbers are shown as if they were facts** on the screens pilot users will open first. The
   registry knows a figure is uncertified; the page does not say so. → **B-03** (small, reuses the registry).
4. **README/doc drift** misleads the operator who installs the TEST instance. → **B-04**.
5. **No browser test in CI**: every fix we merge during a 4-week pilot can regress a journey unseen. → **B-05**.
6. **Value chain** (funding, expected vs realised benefit) is absent. The audit itself places it in its
   "Vague 2 — after first field proof", and we agree: it is **after** the pilot line. → **B-08**.
7. **Roadmap → portfolio single source** has no goal. Low pilot relevance; after the pilot. → **B-09**.
8. The alert/report catalogue cannot be armed without D-13, and D-13 cannot be decided without seeing **who
   would receive what**. A read-only dry-run pack makes the human decision possible. → **B-07**.

### A.4 Where our plan is better (the audit missed these)

- **Upgrade safety**: refusing a 1.x upgrade while data is in SQLite (A-01), never upgrading a PG cluster Setup
  did not install (A-02), keeping 1.11 `enc:v2` secrets readable (A-03a), running every .env/secret check
  before the first change with an encrypted pre-update backup (A-04), and stopping the pm2 1.x process before
  file replacement with a CI proof of upgrade + rollback (A-03). The audit's P0-08 is "do it on TEST"; ours
  makes the TEST run likely to succeed.
- **Silent data loss and overwrite**: field app sending `resolved` while unknown codes reset to Open (A-05),
  a stale PV tab deleting actions created elsewhere (A-06, `meetings-db.js:488`), inspection drafts that cannot
  fit localStorage and a swallowed `QuotaExceededError` (A-07).
- **Privacy and correctness on the public Exec View** (A-08, done): public MI text behind a switch, month
  windows with no upper bound.
- **An authorisation hole the audit did not see**: any authenticated session reads every portfolio project,
  task, risk and milestone (`routes/governance.js:360-376`, only money stripped) — A-15. The audit filed
  authorisation only under D-14.
- **Honest numbers**: fake 0 % on the SLA trend (A-17), MANA presented as "the group" on asset money (A-16,
  227/2 473 assets carry a cost, 226 of them at MANA), OpManager `data_through` (A-18), Teams SLA truncation
  never reported on a real run (A-23), stale-closed WAN outages counted as credited (A-25).
- **Secrets crypto detail**: `enc:v2` uses a fixed salt and no AAD, so ciphertexts can be swapped between keys
  (A-28) — not visible without reading `services/configSecrets.js`.

### A.5 What I reject from the audit (for this period)

| Audit item | Decision | Reason |
|---|---|---|
| P1-13 decompose `server.js` | **Rejected as a goal; adopted as a rule** | A big-bang extraction in the middle of a pilot is the riskiest possible change. Rule (F.1): any goal that adds or materially edits a route puts it in `routes/<domain>.js` and leaves one mount line in server.js |
| P1-14 i18n by keys | **Deferred** | A-09 delivers French on the pilot pages with the existing mechanism. Re-key only if pilot task T7 or French-speaking users show breakage |
| P1-11 design-system catalogue + visual regression | **Deferred** | Not pilot-critical; A-12/A-22 cover contrast and charts |
| P1-12 performance budget | **Measure, don't enforce** | B-05 records page weight and load time per journey; a budget is set from pilot data |
| New persona "workspaces" (Business Value Cockpit etc.) | **Rejected now** | G17 already ships persona workspaces in `_shell.js` (`WORKSPACES`, line ~328); building more before measuring use is speculation |
| WCAG 2.2 AA audit | **Human gate** | Code side: A-12a focus/skip link; the audit itself needs an assistive-technology user |

---

## B. Product goal for the next period

> **Pilot-ready on the Endeavour TEST instance for 1–2 named sites, with measurement in place — then run a
> 4-week pilot whose results feed a new GO/NO-GO.**

Not "production-ready", not "feature-complete". Everything that does not make the pilot safer, usable or
measurable waits.

### Exit criteria — "pilot-ready" (all must hold, checked at one SHA of `sdp-waves`)

1. Every goal above the pilot line (§D) is merged; full PostgreSQL suite green with 0 failures and 0
   unexplained skips (`PG_TESTS_REQUIRED=1`), Windows installer CI green **including** A-03's 1.11-under-pm2
   upgrade and forced rollback.
2. B-05 browser journeys (T1, T2, T3, T4, T7, T8) green in CI on PostgreSQL 17.
3. **Zero requests to external origins** from pilot pages, asserted by B-05 with all non-localhost traffic
   blocked; the CSP no longer whitelists cdnjs/jsdelivr/unpkg for those pages.
4. No data-loss path open on the pilot tasks: A-05, A-06, A-07, B-06 merged.
5. Every KPI tile on `index.html`, `site-report.html` and `exec-view.html` shows its certification state and
   the **data** date (not the browser clock); an unmeasured value shows "—/UNKNOWN", never 0 or green.
6. `tools/pilot/pilot-metrics.js` produces a week-0 baseline from the TEST database (§C, B-02).
7. README and install docs state Node 22, PostgreSQL 17 only, and the TEST-instance procedure.
8. A **pilot profile** (`docs/ops/pilot/PILOT-PROFILE.md`) lists every switch introduced by the plan with
   "today" vs "recommended for pilot" values — applied only by a person (§E).

### Exit criteria — "pilot done" (to be agreed by the sponsor before week 1, not by me)

Proposed measures, no targets invented: T1–T8 completion/time/errors + SUS per persona; median minutes per
weekly report (stopwatch week 0 vs week 4, and created→submitted proxy); decision→action and action→closure
medians; weekly active users on **business** events per site/persona; % pilot KPIs stale/UNKNOWN; field
entries refused/conflicted/lost (target for the last one: zero); every anomaly logged with a severity.

---

## C. Revised backlog

### C.1 Existing goals — keep / split / merge / defer

| Goal | Status | Decision | Line | One-line reason |
|---|---|---|---|---|
| A-03a enc:v2 secrets | done | keep | pilot | merged |
| A-01 SQLite preflight | done | keep | pilot | merged |
| A-02 PG cluster ownership | done | keep | pilot | merged |
| A-04 .env checks first | done | keep | pilot | merged |
| A-08 Exec View | done | keep | pilot | merged |
| A-03 stop app + 1.11 upgrade/rollback in CI | in progress | **keep, P0** | pilot | it is the code half of the audit's P0-08; the TEST install depends on it |
| A-05 status vocabulary | in progress | **keep, P0** | pilot | field + PV + hub status corruption on T1/T3 |
| A-07 inspection drafts in IndexedDB | in progress | **keep, P0** | pilot | 25–80 MB inspections cannot live in localStorage; T3 |
| A-06 PV optimistic concurrency | todo | **keep, P0** | pilot | a stale tab deletes actions created by the hub/field (`meetings-db.js:488`) |
| A-15 portfolio site-scoped reads | todo | **keep, raise to P0** | pilot | real authorisation leak with named pilot users from several sites; ships behind a switch, value set by a person |
| A-09 French | todo | **split** | A-09a pilot / A-09b after | A-09a = shell `lang`, policy channel, dictionary, coverage test + `site-actions.html`, `meeting.html`, `inspection.html`, tracker (francophone pilot sites); A-09b = `reports.html`, assets, wan, trackers, portfolio, rfi |
| A-10 role landing + My work | todo | **keep, narrow** | pilot | My work = the audit's "À traiter" inbox, built on `services/obligations.js` per user; landing behind `ui_role_landing` (default today) |
| A-12 tokens / focus / skip link | todo | **split** | A-12a pilot / A-12b after | A-12a = global `:focus-visible` ring + skip link from `_shell.js`/`_shell.css` only (T8); A-12b (contrast `*-text` tokens, the 55 `outline:none`) merged into A-22 |
| A-17 SLA doctrine | todo | **split** | A-17a pilot / A-17b after | A-17a = trend chart denominators + null for empty periods on `index.html` (correctness, T2); A-17b = server SLA definition switch (KPI-committee choice) |
| A-18 OpManager freshness | todo | **split** | A-18a pilot / A-18b after | A-18a = honest `data_through`/`data_as_of` (feeds the weekly report autofill, T2, and B-03); A-18b = WAN calibration banner |
| A-11 published site verdict | todo | keep | after | needs D-03; pilot shows scores labelled "not certified" via B-03 |
| A-16 asset money coverage | todo | keep | after | Finance is not a pilot persona; amounts already admin-only |
| A-23 Teams SLA alerts | todo | keep | after | alerts stay disarmed during the pilot |
| A-25 WAN SLA review/credits | todo | keep | after | chargeback is not in the pilot |
| A-21 navigation diet | todo | keep, **re-scope from pilot data** | after | decide the lean profile from T1–T8 results, not opinion |
| A-22 chart theme | todo | **merge with A-12b** | after | one visual goal; its CDN part moved to B-01 |
| A-14 project page | todo | keep | after (PPM wave) | audit's Vague 2; witness project needs PMO |
| A-27 baselines, PPM deck, A11 alerts | todo | keep | after (PPM wave) | depends on A-14 |
| A-13 capacity/load | todo | **demote to P3, park** | after (only if PMO asks) | L-size, depends on PD-7 and A-14/A-15; no pilot user needs it |
| A-19 soft delete | todo | keep (split a/b/c as reviewed) | after | protects against deletes, not pilot-blocking with backups |
| A-24 frozen submitted reports | todo | keep | after | needs PD-3 (reverses a 2026-10-02 decision) |
| A-26 locale-safe money parser | todo | keep | after | depends on A-16 |
| A-28 CSP report-only, enc:v3, PDF temp, deps | todo | keep | after; **CSP part after B-01** | report-only CSP is far simpler once CDNs are gone |
| A-20 Meridian retire | todo | keep phase 1 only | after | phase 2 waits for CAB (D-07) |

No goal is dropped outright; A-13 is parked. Net effect: the pilot line holds 21 items — 5 done, 3 in
progress, 7 existing or split A-pieces (A-06, A-15, A-09a, A-10, A-12a, A-17a, A-18a) and 6 new goals
(B-01…B-06); everything else waits for pilot evidence.

### C.2 New goals

**B-01 — Same-origin front-end libraries: no Internet needed to render charts or the tracker**
- Why: audit A4 (Chart.js CDN); verified wider (17 pages + React/unpkg on `activity-tracker.html`).
- Scope: commit pinned UMD builds under `public/vendor/` (chart.js 4.4.1, chartjs-plugin-datalabels 2.2.0,
  react + react-dom 18.3.1 production builds) obtained with `npm pack`, plus their licence files; repoint every
  `<script src="https://…">` in `public/*.html` to `vendor/…` (the asset injector will version them);
  one Chart.js version everywhere; remove cdnjs/jsdelivr/unpkg from `script-src` in `server.js:162` and
  `:205-206` (keep `unsafe-eval` only for dev previews); record the three libraries in
  `docs/sdp360/completion/LICENCE-INVENTORY.csv`. Fonts: **out of scope** — the stack falls back to system
  fonts; vendoring Libre Franklin is optional.
- Key files: `public/{index,analytics,assets,dashboards,executive,executive-report,infra-health,
  inspection-actions,inspections,meetings-actions,meetings-insights,reports,site-awareness,site-report,
  system-logs,wan,activity-tracker}.html`, `server.js` (CSP lines only), new `public/vendor/*`,
  `tests/csp-headers.smoke.test.js`.
- Acceptance: a static test fails if any tracked `public/**/*.html` (excluding `dashboard-preview/`,
  `design-system/`) contains `src="http` or `//cdn`; vendored files match recorded SHA-256; CSP smoke asserts no
  CDN origin in `script-src` for production pages; B-05 later asserts zero external requests.
- Size **M** (many one-line edits). Depends: A-05 and A-07 merged (shared html files).

**B-02 — Pilot measurement kit (read-only, derived from data that already exists)**
- Why: audit §11, P0-05, P2-21, P2-22; G24 §5 "non mesuré".
- Scope: pure `services/pilotMetrics.js` + CLI `tools/pilot/pilot-metrics.js --from --to [--site]` producing a
  CSV/Markdown report per site and persona (role) per week: active users on business events (`system_log` +
  `audit_log` actions, not page views); weekly report created→submitted median (labelled "proxy, not effort");
  PV submitted → action created median; action created → closed median (`md_action_updates`,
  `insp_actions.closed_at`, `action_items.status_changed_at`); field entries applied / refused / conflicted
  (`field` outbox); share of pilot metrics UNKNOWN or stale (via the metric registry). User ids pseudonymised
  (HMAC with a key from `.env`); no names in the output. Session kit as files: `docs/ops/pilot/T1-T8-SHEET.csv`,
  `SUS-FORM.md`, `WEEKLY-REPORT-STOPWATCH.csv`, `PILOT-MEASUREMENT.md` (who records what, when).
- Key files: new only — `services/pilotMetrics.js`, `tools/pilot/pilot-metrics.js` (loads `.env` first,
  `require.main` guard), `docs/ops/pilot/*`, tests `tests/pilot-metrics.test.js` (pure) + one PG integration.
- Acceptance: runs read-only (a test asserts no INSERT/UPDATE/DELETE in the module); every measure carries
  its definition and source table in the output header; an empty window prints "no data", never 0 medians;
  output contains no username/email (test).
- Size **M**. Depends: none — fully disjoint, start now.

**B-03 — Trust label on pilot KPIs: certification state and data date**
- Why: audit §9 "trust layer", P0-03; registry already holds the facts.
- Scope: `public/lib/trustLabel.js` reads `GET /api/metrics/registry` once and decorates any element with
  `data-metric-key` with a compact label ("Non certifié · source · formule · données au <date>"), keyboard and
  screen-reader accessible; tag the KPI tiles of `index.html`, `site-report.html`, `exec-view.html`; replace
  `index.html:1809` browser-clock "Data as of" with the data date the API already returns (or "date inconnue").
  No metric definition changes.
- Key files: new `public/lib/trustLabel.js`; `public/index.html`, `public/site-report.html` (+ `site-report.js`),
  `public/exec-view.html`; `routes/metrics.js` only if `exec-view` (public, no session) needs a public read of
  the non-sensitive registry fields — if so, add a whitelisted public subset, never the readers.
- Acceptance: unit test on the formatter (null date → "date inconnue"); DOM test that every tagged tile shows
  a certification string; E2E (B-05) asserts the label on the T5 path.
- Size **M**. Depends: A-17a (same `index.html` region) — same worker lane.

**B-04 — Documentation truth for the TEST operator**
- Why: audit A3.
- Scope: README stack line (Node 22, PostgreSQL 17 only, no SQLite), test command and counts, file map;
  remove the stale "NOT mounted" comment in `routes/roadmap.js`; one page `docs/ops/pilot/TEST-INSTANCE.md`
  linking the existing install/upgrade/restore runbooks (`docs/ops/INSTALLATION.md`, `REPLICA-RESTORE.md`,
  `RELEASE-RUNBOOK-2026-10-29.md`) in execution order. A test that fails if `README.md` mentions
  `sqlite`/`Node.js 18`.
- Key files: `README.md`, `routes/roadmap.js` (comment only), new `docs/ops/pilot/TEST-INSTANCE.md`,
  `tests/readme-truth.test.js`.
- Size **S**. Depends: none.

**B-05 — Browser journeys in CI (Playwright, PostgreSQL 17)**
- Why: audit P1-20, P1-12 (measurement only).
- Scope: Playwright (Chromium only) as a devDependency used by a new CI job, never shipped by the installer;
  seeded throwaway DB; journeys: T1 close an overdue site action with justification (site editor), T2 open
  and submit a weekly report, T3 field quick inspection offline → online sync with one photo, T4 cockpit
  agenda, T7 switch to French + open help, T8 reach Portfolio by keyboard; plus a cross-site deny journey
  (site A editor cannot read site B's report or portfolio project once A-15's switch is on). All requests to
  non-localhost hosts are blocked and counted (must be 0). Each journey records transfer size and load time
  to an artefact (no thresholds yet).
- Key files: new `tests/e2e/*.spec.js`, `tests/e2e/fixtures/seed.js`, `playwright.config.js`,
  `.github/workflows/ci.yml` (new job), `package.json` (devDependency + script).
- Acceptance: job green twice in a row on the same SHA; a deliberately broken selector makes it red.
- Size **M**. Depends: A-03 merged (package.json/CI files), B-01, A-09a, A-10 (journeys target final UI).

**B-06 — Field app storage durability**
- Why: audit P1-16; verified no `storage.persist()`/quota handling in `public/field/app.js`.
- Scope: request `navigator.storage.persist()` on first queued entry; show `estimate()` usage when > 70 %;
  catch `QuotaExceededError` on queue writes and tell the technician the entry was **not** saved (never a
  silent drop); pending-count badge stays visible offline.
- Key files: `public/field/app.js`, `public/field/i18n.js`, field tests.
- Acceptance: browser test with a stubbed quota error shows the error and keeps prior entries; unit test for
  the persist request being idempotent.
- Size **S**. Depends: A-05 merged (same file).

**B-07 — D-13 decision pack: dry-run of every report and alert with would-be recipients**
- Why: audit P0-04, P0-07; the catalogue cannot be armed until people decide D-13, and they cannot decide
  without seeing the effect. Also makes visible that `sync_alert_enabled=1` reaches nobody today.
- Scope: read-only `tools/reports/catalogue-dry-run.js` that, for R01–R16 / A01–A16, prints the switch states,
  the recipients that **would** be used today (resolved from the directory and config, confirmed-only), what
  would have fired over the last N days, and the open decision. Output Markdown for the decision meeting.
  No send, no state change.
- Key files: new tool + `services/reportCatalogue.js` (read helpers only), test.
- Size **S/M**. Depends: none. Line: **during the pilot** (not blocking it).

**B-08 — Minimal benefit record on portfolio projects (after the pilot, PPM wave)**
- Why: audit P0-06 / A09 rule "benefit review date reached — missing".
- Scope (lean): on `portfolio_projects`: expected benefit (text + optional measure, unit, baseline value,
  target), benefit owner, benefit review date, realised value with evidence link and verifier; A09 reminder
  in the obligations/My-work feed (no outbound send). Funding requests and period allocation **not** in this
  goal — Finance must first say what they need.
- Key files: next free `db/postgres/reports/0NN_portfolio_benefits.sql`, `services/governanceStore.js`,
  `routes/governance.js`, `public/project.html` (from A-14).
- Size **M**. Depends: A-14, A-15.

**B-09 — Roadmap → portfolio single source (after the pilot)**
- Why: audit P1-17.
- Scope: parity report (roadmap objectives/deliverables vs migrated portfolio items) as a read-only CLI;
  switch `roadmap_redirect_to_portfolio` (default `0`) that turns `itsm-roadmap.html` into a read-only page
  linking to the portfolio. Deletion stays a human/CAB step.
- Key files: `routes/roadmap.js`, `public/itsm-roadmap.html`, `tools/governance/roadmap-parity.js`.
- Size **S**. Depends: none (post-pilot by priority).

Not added (considered and rejected): a department authorisation axis before D-14 is decided (cannot build a
policy nobody owns; pilot runs site-only, see §E); standalone server.js split; i18n re-keying; a new executive
"value cockpit".

---

## D. Revised waves

Rules for parallel groups: no two goals in the same wave edit the same file, **except** the two declared
hotspots, where edits are append-only and merged serially: `services/reportConfig.js` (one DEFAULTS line per
new key) and `server.js` (one mount line or the CSP lines in B-01). Migration numbers are taken at merge time,
never reserved in advance (A-15 and A-19 both planned `043_…` — the second to merge renumbers).

| Wave | Goals (parallel) | Files that keep them apart | Gate to start |
|---|---|---|---|
| **W1** done | A-03a, A-01, A-02, A-04 | installer | — |
| **W2** done/in progress | A-08 ✔ · A-03 · A-05 · A-07 | installer+CI · meetings/field/status · inspection.html + `lib/draftStore.js` | — |
| **P2** start now, beside W2 | **B-02** · **B-04** · **A-15** · **A-18a** | new pilot files · README/docs · governance/portfolio · opmanager services/route | none (disjoint from A-03/A-05/A-07) |
| **P3** | **A-06** · **B-06** · **A-12a** · **B-01** | meetings-db/routes/meeting.html · field app · `_shell.js/_shell.css` · html script tags + CSP lines | A-05 and A-07 merged |
| **P4** | **A-09a** · **A-17a → B-03** (one lane) | shell i18n + site-actions/meeting/inspection/tracker · index.html, site-report, exec-view, `lib/trustLabel.js` | A-06, A-12a, B-01 merged |
| **P5** | **A-10** · **B-05** | home/landing/login/shell · `tests/e2e`, CI, package.json | A-09a, A-03 merged |
| ═══ | **PILOT-READY LINE** — exit criteria §B checked at one SHA; then human gates §E | | |
| **During pilot** | **B-07**; defect fixes from the pilot log only (each a small goal, same rules) | catalogue tool | pilot running |
| **Q1 after pilot — truth & usability** | A-09b · A-16 → A-26 · A-17b · A-18b · A-23 · A-25 · A-11 (after D-03) · A-21 (re-scoped from T-results) · A-12b+A-22 | as per detail JSON; A-21 and A-22 both touch `_shell.css` → serialise | new GO/NO-GO or sponsor go-ahead |
| **Q2 — value chain (PPM)** | A-14 → A-27 · B-08 · B-09 · (A-13 only on PMO request) | governance/project | witness project named by PMO |
| **Q3 — hardening** | A-19a/b/c · A-24 (after PD-3) · A-28 (CSP report-only after B-01) · A-20 phase 1 · i18n re-keying if T7 failed | as per detail | — |

Critical path to the pilot line: A-05 → A-06 → A-09a → B-05 (plus A-03 for B-05's CI files). Everything else
fits beside it.

---

## E. Human-only gates (no code replaces them) — and what the code must have ready

| # | Gate | Owner | Code side ready before the gate |
|---|---|---|---|
| H1 | Rotate the historical PostgreSQL superuser secret on every cluster + decision on git history (EX-01) | CISO + DBA | `tools/pg/check-secrets.js` and installer accept a new password without re-encrypting app secrets (A-03a/A-04 done); B-04 links the procedure |
| H2 | Install 2.0 on the TEST instance, run upgrade from 1.11 + forced rollback + restore drill there, measure RPO/RTO | Operator / SRE | A-03 CI proof green; `TEST-INSTANCE.md` (B-04); restore tooling unchanged |
| H3 | CAB authorises the **pilot** (not production) | CAB | release notes of the pilot SHA, exit-criteria checklist §B with evidence links |
| H4 | Name the 1–2 pilot sites (D-05) and the pilot users per persona (site IT lead, 1–2 technicians, Group IT, one executive, one committee member) | Sponsor + Group IT | accounts created through the normal admin page; B-05 cross-site deny journey green |
| H5 | Apply the pilot profile switches (A-15 portfolio scoping, A-09 language default PD-2, A-10 landing, A-08 MI detail mode, A-08 change formula) — or keep today's values | PO (human) + Security for A-15 | `docs/ops/pilot/PILOT-PROFILE.md` lists every key, today's value, recommended value, rollback |
| H6 | Accept site-only scoping for the pilot (D-14 stays open) — or decide the department model | CISO + business owners | site-only enforcement already tested; no code until decided |
| H7 | D-13: who may release which report, on which channel, to whom; set `sync_alert_recipients` | Reporting owner + audience | B-07 dry-run pack |
| H8 | KPI definitions D-01/02/03 — **not** required for the pilot if figures stay labelled | KPI Committee | B-03 labels; registry editable without code |
| H9 | Week-0 baseline: stopwatch two weekly reports per pilot site before the pilot starts | Site IT leads | `WEEKLY-REPORT-STOPWATCH.csv` (B-02) |
| H10 | Usability sessions T1–T8 + SUS; field test on a real phone on the site network; assistive-technology pass | PO + site leads + an AT user | protocol, sheets (B-02), journeys known to pass in CI (B-05) |
| H11 | Inform pilot users that business events are measured (pseudonymised) | Sponsor / HR as required | B-02 pseudonymisation, notice text in `PILOT-MEASUREMENT.md` |
| H12 | Keep `AI_PROVIDER=off` on TEST unless the data owner approves a provider | Data owner + Security | default is already `off` |
| H13 | Signing key ceremony (D-12) and dependency upgrade D-11 | Release owner + Security | required before **production**, not before the TEST pilot |
| H14 | Legal/IP review | Legal | not blocking an internal TEST pilot; blocking any distribution |
| H15 | End-of-pilot GO/NO-GO | Sponsor + CAB | `pilot-metrics.js` final report + anomaly log |

---

## F. Decisions

### F.1 Taken by the PO (reversible engineering choices)

1. **Product goal = pilot-ready on TEST with measurement** (§B). Goals that do not serve it move after the line.
2. **Rename playbook decisions D-1…D-7 to PD-1…PD-7** in goal files and commits, so they never collide with the
   repository decision log D-01…D-15 (e.g. playbook D-1 = repo D-03, D-3 has no repo twin).
3. **Vendor** Chart.js, the datalabels plugin and React UMD under `public/vendor/`, pinned with SHA-256; fonts
   fall back to system fonts (no vendoring this period).
4. **Playwright** is a CI-only devDependency, Chromium only; never packaged by the installer.
5. **Pilot metrics are derived read-only** from existing tables; no new tracking in routes this period; user
   ids pseudonymised; created→submitted is reported as a proxy, never as effort.
6. **Splits**: A-09 → a/b, A-12 → a/b (b merged into A-22), A-17 → a/b, A-18 → a/b, A-19 → a/b/c (as its
   review advised). A-13 parked.
7. **Hotspot rules**: `reportConfig.js` and `server.js` edits append-only and merged serially; new routes go
   to `routes/<domain>.js`; migration number assigned at merge time.
8. **Every new switch defaults to today's behaviour** (unchanged playbook rule); the pilot profile is a
   document, applied by a person.
9. The audit's server.js decomposition, i18n re-keying, design-system catalogue and performance budget are
   **not** goals this period (§A.5).

### F.2 Left PROPOSED for people

| Item | Proposal | Who |
|---|---|---|
| A-15 portfolio visibility | non-committee users see their sites' projects + group-level ones; editors edit tasks/risks of their site's projects | Security + PMO |
| PD-2 page language | French and English both available; saved choice wins; browser language otherwise; e-mails/PPTX stay English | Sponsor |
| A-10 landing per role | `ui_role_landing=1` on TEST for the pilot | PO (human) |
| A-08 Exec View | `exec_view_mi_detail=summarized_only`, `exec_view_change_formula=deck` | Owner of the 2026-07-02 decision + KPI Committee |
| D-14 department axis | pilot runs site-only; department model decided before any multi-department rollout | CISO + business owners |
| D-13 release authority | decided with the B-07 pack during the pilot | Reporting owner |
| D-01/02/03 KPIs | stay "non certifié" on screen until signed | KPI Committee |
| Benefit record fields (B-08) | expected / baseline / target / review date / realised + evidence + verifier | PMO + Finance |
| Roadmap cut-over (B-09) | redirect after one parity cycle; deletion via CAB | PMO + PO + CAB |
| Pilot success thresholds | set after week 0 baseline, before week 1 | Sponsor |
