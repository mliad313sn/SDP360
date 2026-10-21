# 01 — Gap register vs the 2027 master goal (Goal 01)

Baseline: HEAD `49ff9e0` — see [00-CURRENT-STATE-AND-TRUTH.md](00-CURRENT-STATE-AND-TRUTH.md). Severity: **P0** blocks trustworthy management reporting or leaves serious risk unowned · **P1** blocks a 2027 routine/report · **P2** improvement. "Extend" names the existing module to build on — the brief forbids a competing register.

## Domain 1 — Canonical business signals and commitments

| ID | Gap | Sev | Evidence | Extend |
|---|---|---|---|---|
| G1.1 | No canonical commitment identity: actions live in `md_actions`, `insp_actions`, `action_items`, `session_actions`, `decisions`, `portfolio_deliverables` with no shared key | P0 | 00 §6; table list in `services/governanceStore.js` | `services/siteActionsRegister.js` (already reads 4 of them) + new `commitments`/`commitment_source_links` |
| G1.2 | ≥ 5 independent terminal-status definitions; a source "closed" is treated as done | P0 | `public/lib/statusTransfer.js` `DONE`, `public/lib/actionGroups.js` `TERMINAL`, `services/siteActionsRegister.js` `TERMINAL`, inline SQL in `governanceStore.js` | one state machine module consumed by all |
| G1.3 | No distinction technical completion vs independent business/control verification | P0 | no `verified_*` / reviewer columns in any action table (grep) | new `closure_verifications` |
| G1.4 | High/critical findings can exist without owner/date/treatment | P0 | `inspection-db.js` / `insp_actions`: owner+due are form-mandatory only (CLAUDE.md "Owner + Target Date now mandatory" — client-side) | server-side rule in inspection save + A01 |
| G1.5 | No append-only event history for actions outside meetings (`md_action_updates`) | P1 | `insp_actions`, `action_items`, `session_actions` have no event table | `commitment_events` |
| G1.6 | Evidence = inline/base64 or blob photos only; no evidence metadata (type, checksum, retention) | P1 | `services/blobStore.js`, `insp_photos` | `evidence_items` over `blobStore` |
| G1.7 | Scoping is site-only; no department scoping | P0 | `services/userSites.js` (site ids only) | extend `userSites` with department grants |

## Domain 2 — Business partnering and prevention

| ID | Gap | Sev | Evidence | Extend |
|---|---|---|---|---|
| G2.1 | No planned vs held vs logged vs accepted session states for department meetings | P1 | `md_meetings.status` = draft/submitted/signed/closed | `meeting_cadences` / `meeting_sessions` in `governanceStore.js` |
| G2.2 | Cadence not configurable by programme/site/effective date with approved exceptions | P1 | `meeting_cadences` has no effective-date/exception model | `governanceStore.js` |
| G2.3 | Incubation lacks baseline, sponsor, disposition, intake to portfolio | P1 | `services/incubationForm.js` §1-§4 fields only | incubation blob + portfolio intake |
| G2.4 | Inspection duplicate-session detection absent | P1 | no uniqueness on site×area×date in `insp_inspections` | `inspection-db.js` candidate matcher |
| G2.5 | Field PWA never validated on real devices / networks | P1 | 00 §4 (field = ?) | `public/field/`, `services/fieldOutbox.js` |

## Domain 3 — Native portfolio, cost and value

| ID | Gap | Sev | Evidence | Extend |
|---|---|---|---|---|
| G3.1 | Portfolio tables exist but no lifecycle/stage gates/business case | P1 | `portfolio_programmes/projects/milestones/deliverables/risks/objectives` in `governanceStore.js` | same tables + `portfolio_events` |
| G3.2 | No budget declarations with provenance/approver | P1 | no budget columns | portfolio tables |
| G3.3 | No benefit ledger (forecast/measured/verified/sustained) | P2 | no benefit table (grep `benefit` in services: none) | new `benefit_claims`/`benefit_observations` |
| G3.4 | Meridian external PMO connector still in code/jobs | P1 | `routes/meridian.js`, job `meridian.resources` | retire (decision D-05) |
| G3.5 | Two roadmap tools (`roadmap_*` personal tool in `routes/roadmap.js`) overlap portfolio objectives | P2 | `routes/roadmap.js` | fold or label as personal |

## Domain 4 — Audience-specific views

| ID | Gap | Sev | Evidence | Extend |
|---|---|---|---|---|
| G4.1 | No role-scoped landing pages (10 audiences) | P1 | `public/dashboards.html` is generic | `services/dashboardData.js` definitions per audience |
| G4.2 | No role × object × action permission matrix document beyond route matrix | P1 | `tests/authz-route-matrix.test.js` covers routes, not objects | extend matrix |
| G4.3 | No auditor read-only / period-freeze view | P2 | — | governance + report snapshots |

## Domain 5 — Certified KPIs and scorecard

| ID | Gap | Sev | Evidence | Extend |
|---|---|---|---|---|
| G5.1 | 2027 five-dimension scorecard (20/20/25/20/15) not implemented | P1 | `services/metricRegistry.js` has no such keys | metric registry |
| G5.2 | Single site score undecided (E9 suspended on D1/D2) — 3 score models coexist (`siteScore`, `siteComposite`, `siteScoreboard`) | P0 | `docs/sdp360/review/2026-10-20-PLAN-DE-REMEDIATION-PROMPTS.md` §E9 | metric registry |
| G5.3 | Thresholds still literal in pages (38 in `executive.html` per E9 fiche) | P1 | E9 fiche §2 | `public/lib/kpiRag.js` |
| G5.4 | No stale/missing → UNKNOWN rule shared by every surface | P0 | freshness only in `/api/sync/health` | registry readers + freshness |
| G5.5 | Historical 2026 slide figures (53/90, 68/30…) not reconciled | P1 | brief §A "NON-NEGOTIABLE BASELINE" | fixture reconciliation test |

## Domain 6 — Report factory R01–R16, rules A01–A16

| ID | Gap | Sev | Evidence | Extend |
|---|---|---|---|---|
| G6.1 | No report catalogue R01–R16; Report Studio has templates but not the 2027 set | P1 | `routes/reportStudio.js` | Report Studio |
| G6.2 | Report runs have `draft → reviewed → published` (`services/reportStore.js` header) — no `approved`/`archived`, no immutable released snapshot or revocation/retention | P0 | `services/reportStore.js` lines 3-4 | reportStore |
| G6.3 | Stale-feed suppression of authoritative publication (A08) absent | P0 | `publish.connectors`/`reports.*` jobs don't read freshness | `services/sync/jobs.js` + engagementJobs |
| G6.4 | SharePoint/Graph publishing untested | P0 | 00 §4 Graph row | `services/engagementJobs.js` |
| G6.5 | Alert rules A01–A16 not configured (12 seeded generic rules) | P1 | `tests/engagement-routes.smoke.test.js` (12 seeded) | `alert_rules` |
| G6.6 | `engagementJobs.js` has no unit test | P1 | grep: no test requires it | add tests |

## Domain 7 — Lean connectors and OpManager coverage

| ID | Gap | Sev | Evidence | Extend |
|---|---|---|---|---|
| G7.1 | Meraki direct connector (5 jobs) duplicates OpManager scope | P1 | `services/sync/jobs.js` meraki.* | decision D-04 |
| G7.2 | OpManager: availability only, no alarm feed, no per-site coverage matrix | P1 | `services/opmanagerAvailability.js` | `routes/opmanager.js` `/coverage` |
| G7.3 | OpManager Analytics view documented frozen at 2026-05-24 | P1 | CLAUDE.md 2026-10-02 | upstream (Zoho) fix |
| G7.4 | No connector register with owner/contract/scope/freshness per connector | P1 | — | 06-CONNECTOR-REGISTER (later goal) |
| G7.5 | Two high npm advisories (follow-redirects, image-size) | P1 | `npm audit --omit=dev` | dependency bump |

## Domain 8 — Assured operations

| ID | Gap | Sev | Evidence | Extend |
|---|---|---|---|---|
| G8.1 | Version drift README/package/CHANGELOG | P0 | 00 §2 | **closed by this goal** (`tests/version-consistency.test.js`) |
| G8.2 | Runtime does not expose the package version | P2 | `routes/health.js` | authenticated health route |
| G8.3 | Restore drill proven on sandbox only | P0 | `tests/restore-drill.test.js` | prod drill evidence |
| G8.4 | Manifest-signing public key is a placeholder; CI action SHAs written from memory | P0 | `DECISIONS-EN-ATTENTE.md` E1 rows | CI |
| G8.6 | Full-suite TAP output can silently drop whole files under `--test-force-exit` (2 660 vs 2 711 tests, 0 fail) — no guard on the expected test count | P1 | 00 §7 | CI: assert test count ≥ previous baseline |
| G8.5 | `tools/deploy/frozen-lots.json` cited in CLAUDE.md is absent | P2 | 00 §4 notes | release process |

## Domain 9 — Pilot

| ID | Gap | Sev | Evidence | Extend |
|---|---|---|---|---|
| G9.1 | No pilot sites chosen; no UAT scripts | P1 | — | decision D-03 |
| G9.2 | No baseline of time-to-record / report effort | P2 | — | instrumentation via `system_log` |
