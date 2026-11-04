# SDP360 — Committee review of the 4 Nov 2026 report and PO-governed plan v3

Input: "SDP360 — Revue approfondie du produit" (committee dossier, 4 Nov 2026) + Annex C.
The dossier audited commit 776262c (branch claude/sdp360-consolidation, 2 Nov). Re-check done on head 367c309
(branch claude/sdp-dashboard-analysis-55b1oy) by four independent read-only checks:
check-F01-F15.md · check-F16-F30.md · check-IAM.md · check-G01-G35.md (this folder).

## 1. Re-check result (verdicts with code proof)

| Block | Fixed | Partial | Open | Needs a person |
|---|---|---|---|---|
| F01–F15 charts/KPI | 1 (F14) | 2 (F02, F13) | 11 | F15 (brand) |
| F16–F30 screens/exports | 0 | 5 (F18, F26–F29) | 8 | F16, F23 (+F29) |
| A01–A10 identity | 1 (A05) + A08 base OK | 4 | 4 (A02, A06, A09, A10 defect) | — |
| G36–G52 IAM/continuity | — | 6 | 11 | approvers, rosters, qualifications |
| G01–G35 report goals | 0 | 20 | 5 | G34 (UAT) |

New defects found by the re-check (not in the report): (1) `/api/metrics/*` analytics data routes need only a session
while the page is admin|scorecard-viewer → any viewer can read fleet figures (G31); (2) role resolver counts deactivated
holders as coverage and escalates to them (A10); (3) Entra SSO rewrites roles at each login — future approved grants would
be wiped (IAM trap); (4) dashboards `loadData` has no stale-response guard (Annex B #6); (5) ended KPI targets are
never readable (`kpiTargets.list()` filters `ended_at IS NULL`) (F06).
Confirmed by probes: backlog % → NaN/Infinity (F03); null → red (F04); unknown risk → green (F07); 4 widget types render
the same list (F01); unchecked `series[]` accepted (F24); current part-month shown unflagged (F30).

## 2. Committee positions (discipline grid of the dossier, applied to the re-check)

- **BI/KPI architect + data viz lead:** integrity first — F03/F04/F07/F08/F10/F30/F05/F06 change what a manager reads; fix
  before any visual work. Null is never a colour; a part-period is labelled; history uses history's target.
- **CISO / IAM architect:** G31 metrics-route gap and F09 innerHTML are security fixes, ship first. IAM: no parallel
  identity engine; capability catalogue in SHADOW mode first; approval writes through the existing user path; SSO merge
  must preserve approved grants; deny by default only once enforced route by route.
- **Front-end lead + architect:** no rewrite. Widget catalogue must not offer what it cannot render (F01/F02). One
  chart-table helper applied through the shared chart theme covers 17 pages at once (F19/G26). Extract monolith blocks
  only where a test needs them (F20).
- **Accessibility:** every chart gets a data table and a text summary; keyboard inside Gantt; reduced motion.
- **UX / information architect / product:** executive surfaces need a keep/merge matrix (decision, F16/G14) — build the
  usage telemetry that lets the decision be made on facts (page_viewed counts) instead of guessing.
- **Mine operations / shift planner / HSE / audit (SoD):** a task belongs to a team queue before a person; handover needs
  explicit acceptance; coverage with no roster data is UNKNOWN, never green; a software right never stands for an HSE
  qualification; emergency access is time-boxed, logged, reviewed after.
- **PMO/Finance:** risk P×I matrix and resource pressure on the project page; "Other (n)" instead of silent top-8.
- **SRE/QA:** measure before optimising (F22/G29); viewport/visual regression and filter-race E2E (G32).

## 3. PO decisions (governance of this plan)

1. Scope = everything the re-check found OPEN/PARTIAL that code can close. Items needing people stay visible as human gates.
2. Every behaviour change visible to users that is not a defect fix ships behind a `report_config` switch defaulting to
   today (PILOT-PROFILE row added). Pure defect fixes (NaN, null-red, unknown-green, XSS, missing route guard, stale
   response) ship ON — they restore the meaning the screen already claims.
3. Order: V0 integrity & security → V1 contracts/time truth → V2 accessible charts & composer → V3 screens →
   V4 reporting parity → V4b IAM & continuity → V5 qualification (tests, inventory, dossier).
4. Ids: C-01 … C-27 (the old A-/B- ids are closed). Migrations from 057 upward, assigned per goal.
5. No goal claims production readiness; the release dossier (C-27) states GO pilot / NO-GO prod until human gates close.
6. Not built (human decision first): exec surface consolidation itself (F16/G14), Deck Builder vs Studio merge (G24),
   it-review palette identity (F15 — only the variable clash is fixed), Normal-change slice (F23 — "Other" bucket is
   built behind a switch), Google Fonts self-hosting (font files/licence decision), A-13 capacity (still parked), UAT (G34).

## 4. Goals v3

| Wave | Id | Goal | Closes | Size | Switch | Mig |
|---|---|---|---|---|---|---|
| V0 | C-01 | Analytics integrity: ratios, null/unknown status, semantic colours, escaping, filter race, error states | F03 F04 F07 F08 F09 F11 F12 G18, G03 G04 G09 G10 | M | — (defect) | — |
| V0 | C-02 | Analytics data API scope guard + metric routes in authz matrix | G31 gap | S | — (defect) | — |
| V0 | C-03 | Role resolver: skip inactive/site-less holders and deputies | A10 | S | `governance.skip_inactive_holders` (false) | — |
| V1 | C-04 | Dashboard widget truth: real table/ragGrid/bar renders, hide heatmap, trackerRag end-to-end, series[] validated, chart-failure table fallback | F01 F02 F13 F24 G05 G06 G11-min | M | — | — |
| V1 | C-05 | Dashboard time truth: window-anchored series, historical targets (incl. ended), partial-period flag, computed-at vs source date, stale-response guard, resolver timing + bounded concurrency | F05 F06 F21 F30 F22 AnnexB#3 #6 G07 G08 G29 | M | — | — |
| V2 | C-06 | Analytics charts: dual axis → stacked panels, shared states, token palette, aria + data tables | F10 F18 F19(analytics) F26 | M | — | — |
| V2 | C-07 | Accessible charts everywhere: ChartTable via chart theme plugin + TrendPanel tables + Gantt keyboard + reduced motion | F19 F28 G26 | M | — | — |
| V2 | C-08 | Guided dashboard composer (presets per question, per-type fields, JSON under Advanced) | F17 G17 | M | — | — |
| V2 | C-09 | Usage facts + exec surfaces matrix: page_viewed counts, flag register, exec-pages matrix doc, distinct icons, it-review variable namespace, DEMO banner on preview | F16-prep F25 F29 F15-tech G14-prep G33 | S/M | — | — |
| V2 | C-10 | Shared page anatomy (question/scope/window/freshness header) on dashboards, analytics, infra-health, wan | G16 G30 | M | — | — |
| V3 | C-11 | Helpdesk: category Pareto, per-site ranking, drill from each chart | G19 | M | — | — |
| V3 | C-12 | Assets: tile = drill parity tests, completeness bullet + anomaly Pareto | G20 | M | — | — |
| V3 | C-13 | WAN/infra: outage timeline, freshness per tab, coverage | G21 | M | — | — |
| V3 | C-14 | PPM: risk P×I matrix, resource pressure view, Gantt baseline legend | G22 | M | — | — |
| V3 | C-15 | Governance: decisions linked to source session/PV, engagement delays on cockpit | G23 | S/M | — | — |
| V4 | C-16 | Reporting parity: golden figure test across HTML/CSV/XLSX/PPTX/PDF, exec payload builder extracted, "Other (n)" bucket | G25 F27 F23-tech F20-step | M | `exec_deck_other_bucket` (0) | — |
| V4b | C-17 | Capability catalogue (shadow), authorization service, authz matrix with role guards, why-denied | G36 G37 G42 A01 | M | `authz_capability_mode` (off) | — |
| V4b | C-18 | Access templates, requests, approvals, grants with expiry, SSO grant merge, My access screen | G38 G39 G40 G50 G51-part A02 A03 A07 A09 | L | `access_require_approval` (0), `access_grant_expiry_job` (0) | 057, 058 |
| V4b | C-19 | Qualification evidence + separation-of-duties policy | G41 G43 | M | `qualification_check_enabled` (0) | 059 |
| V4b | C-20 | Duty rosters (manual/CSV), coverage engine, coverage page | G44 G48 A06 | L | — (read-only page) | 061 |
| V4b | C-21 | Scoped deputies, duty queues, shift handover with acceptance | G45 G46 G47 A04 A10-rest | L | `governance.handoffs.queue_receivers` (false), `shift_handover_enabled` (0) | 060, 062 |
| V4b | C-22 | Emergency access (time-boxed, logged, post-review), never bypassing HSE prerequisites | G49 | M | `emergency_access_enabled` (0) | 063 |
| V5 | C-23 | IAM & rotation E2E journeys | G52 | M | — | — |
| V5 | C-24 | Viewport/visual regression + filter-race + export E2E | G32 | M | — | — |
| V5 | C-25 | Evidence baseline: metric→widget map, checksums, evidence levels, persona→journey map | G01 G02 | S | — | — |
| V5 | C-26 | Bilingual coverage for the remaining shell pages (index, analytics, dashboards, executive) + glossary | G27 | M | `ui_i18n_pages` (already) | — |
| V5 | C-27 | Release dossier regenerated (GO pilot / NO-GO prod, human gates listed) | G35 G34-prep | S | — | — |

Concurrency rules: C-01 and C-06 share analytics.html → serial. C-04 and C-05 share the dashboard engine → serial.
C-07 after C-06 (chart theme). C-10 after C-05. C-17 → C-18 → (C-19 ‖ C-20) → C-21 → C-22 → C-23. C-26 after C-06/C-10.
C-27 last.

## 5. Human gates (cannot be closed by code)
D-2 (French), D-3, D-6, D-03, D-07, D-14; exec surfaces keep/merge (needs C-09 telemetry); Deck Builder vs Studio;
it-review palette; Normal-change slice; Google Fonts; approvers per role/site, sensitive roles & conflicting pairs, roster
data, qualification types/issuers (HSE), minimum coverage per site; UAT with pilot users (G34); screen-reader session;
TEST install/restore drill + CAB; secret rotation; production deploy.
