# SDP360 — enterprise-grade prompt pack

Baseline: branch `claude/sdp-dashboard-analysis-55b1oy`, commit `80a0340` (13 Nov 2026). Run in order; P00 first. Each prompt is self-contained once P00 has been given in the same session.

## P00 — Operating frame (run first; every later prompt inherits it)

**Why:** Changes the programme from "build" to "qualify". Without it, each prompt adds scope and more dark switches.

```
/goal Take SDP360 from "built and dark" to "qualified and adopted" without adding scope.

CONTEXT - verify, do not trust this text:
- Repo mliad313sn/SDP360. At review time the working line was branch
  claude/sdp-dashboard-analysis-55b1oy, commit 80a0340 (2026-11-13 09:30 UTC),
  package version 2.0.0-alpha.14. Confirm HEAD and report if it moved.
- Read first: .claude/rules/SDP360_BOUNDARIES.md,
  docs/sdp360/completion/RELEASE-GATES.md and TRUTH-MATRIX.md,
  docs/ops/FLAG-REGISTER.json, docs/ops/flag-decisions.json,
  docs/ops/authz-matrix.json, docs/audits/2026-11-12-*/.

MODE: QUALIFY, NOT BUILD
- No new module, page, connector or switch unless the prompt names it.
- Search for an existing implementation before writing code. Extend it;
  never create a parallel one.
- Evidence goes to docs/agent-execution/, decisions to docs/ai-decisions/.
  Do not open a new documentation tree.
- Behaviour changes ship behind a report_config switch whose default is
  today's behaviour. Defect fixes ship on.
- Failing test first, then the fix, then npm test and the browser journeys
  twice. Never skip a test to get green.
- A value with no source is null / "unknown", never 0 and never green.

HUMAN-ONLY - prepare the dossier, never fill the field:
owners, canary sites, thresholds, KPI definitions, approvals, signatures,
release gates, credentials, any action on a live system.
An AI panel is not an independent review. Label every AI review as AI.

STOP AND REPORT when: a P0 security defect appears; a change crosses more
than one bounded area; a human decision is required to continue.

REPORT EACH RUN: commands run and their results; files, migrations and
switches changed; what remains; which human decision is now unblocked.
```

## P01 — One baseline, one truth

**Why:** Rules and the truth matrix name a branch the work no longer lands on; two modules loaded at boot are not in the repository; README counts are stale.

```
/goal Establish a single verified baseline for SDP360. No behaviour change.

1. Branches: list every remote branch with ahead/behind against the working
   line. Propose (do not execute) a trunk: a protected main, the working line
   merged into it, stale agent branches archived. Output the exact commands
   for a human to run.
2. Rules drift: .claude/rules/SDP360_BOUNDARIES.md and
   docs/sdp360/completion/TRUTH-MATRIX.md name claude/sdp360-consolidation.
   Correct every document that names a branch, and add a test that fails when
   a rules file names a branch that is not the trunk.
3. Missing source: server.js requires ./generate-site-monthly-pptx.js and
   ./executive-new-report.js; .gitignore says both are tracked; neither is in
   git. Find every require() whose target is absent from git ls-files, list
   the routes that answer 503 because of it, and add a boot-integrity test.
   Do not recreate the files: ask the owner for them.
4. Installed build: docs/audits/2026-11-12-enterprise-review/PLAN-F.md says
   the installed build 2.0.0-alpha.16+review.1 is in no branch. State what is
   known, what is rebuilt (REBUILD-SPEC.md), and what a human must supply.
5. Counts: regenerate README figures from the inventory tool (pages, routes,
   tests, migrations) and make tests/readme-truth.test.js own them.
6. Refresh TRUTH-MATRIX.md on the trunk by re-running its evidence commands.

Deliver docs/agent-execution/BASELINE-<sha>.md with: SHA, branch map,
full-suite result with the exact command, list of failing tests with cause,
missing-source list, and the human actions needed.
```

## P02 — Authorization outcome assurance

**Why:** The generated matrix proves outcomes for 262 role-guarded routes. For 455 session-gated routes the decision is inside the handler and the matrix cannot predict it.

```
/goal Prove the allow/deny outcome of every API route for every persona,
including routes whose check lives inside the handler.

Start from docs/ops/authz-matrix.json, tests/_rbac-matrix-core.js,
tests/rbac-matrix.smoke.test.js, tests/rbac-mutation.smoke.test.js and the
cross-site sweeps. Extend them; do not write a second harness.

1. For each route with gate "session" and no guard, classify the in-handler
   decision: role check, site scope, ownership, switch, or none. Record it in
   the matrix as a declared expectation (new field), reviewed in the diff.
2. Routes classified "none": list them. For each, either justify in one line
   why any signed-in user may call it, or add the check behind a failing test.
3. Extend the generated probe to every method of every route for: anonymous,
   viewer, editor site A, editor sites A+B, site-less editor, each feature
   role alone, admin, executive, super_admin, business-only, deactivated
   account, revoked session. Object ids from site B for a site-A persona.
4. Run the probe twice: all switches at default, then with each
   authorization-relevant switch on (portfolio_site_scope_reads,
   portfolio_editor_plan_writes, authz_capability_mode, sensitive projects).
   A switch may narrow access; fail if any switch widens it.
5. Money: scan every 2xx body and every export for money keys under a
   non-money persona. Resolve the committee-member exception recorded in
   docs/audits/2026-11-12-goal-programme/GAP-MATRIX.md (invariant 2) as a
   proposal for the security owner; do not decide it.
6. Mutation control: break five different in-handler checks in a sandbox copy
   and show the probe fails for each.

Deliver the updated matrix, the probe result, the list of routes changed and
the dossier for the Security gate in RELEASE-GATES.md. Never state that the
application has no vulnerability.
```

## P03 — Switch activation in lots

**Why:** 148 dark switches, none with a complete decision record. Activation is the path to value and the largest untested surface.

```
/goal Turn 148 dark switches into a small number of activation lots that a
human can approve one at a time.

Use docs/ops/FLAG-REGISTER.json, flag-decisions.json,
docs/ops/pilot/PILOT-PROFILE.md, services/switchPrereqs.js. Do not turn any
switch on outside a throwaway database.

1. Dependency graph: for each dark switch, the switches, migrations, roles,
   data and jobs it needs. Detect cycles and orphans.
2. Classify each switch: activate (in a lot), keep dark (why), retire
   (dead or superseded - propose removal of switch and code). Target: fewer
   switches after this run than before.
3. Propose lots of at most 10 switches, ordered by user journey, not by
   build wave. Suggested first lot = the daily-work journey: workspace
   profiles, home queue, commitments, data quality page. Suggested second =
   the PMO journey. Mark both as PROPOSED.
4. For each lot, on a throwaway database with all its switches on: full
   suite, browser journeys, P02 probe, data-parity check before/after, and a
   rehearsed rollback (switches off, data intact).
5. Pairwise test across lots for switches that touch the same tables or
   routes.
6. For each lot write a one-page decision dossier: what changes for which
   profile, risk, prerequisites, evidence, rollback trigger, the metric that
   would show it worked. Leave owner, canary site, dates and thresholds
   empty.
7. Add expiry: a test that fails when a switch has been "on" in the pilot
   profile for more than N days without a removal or keep decision (N left
   for the owner).

Deliver the lot plan, the dossiers and the retire list.
```

## P04 — PPM certification, not more PPM features

**Why:** Scheduling, EVM, levelling, baselines, MSPDI and the Gantt merged on 13 Nov behind switches. The repo's own parity audit says "not certified".

```
/goal Close the PPM certification suite T1-T11 defined in
docs/audits/2026-11-12-ppm-parity/README.md and prepare the human checks.
Build nothing that the two W0 matrices do not list as a gap.

1. Re-audit both W0 matrices at HEAD after the W1-W4 merges. Update every
   row with file:line and test. Publish the new totals
   (implemented / partial / missing) next to the W0 totals.
2. For each of T1-T11 state PASS / PARTIAL / MISSING with the test that
   proves it. Close in this order: T3 task-type matrix, T4 work-weighted
   rollups and 100 % rule, T5 EVM against a hand-computed reference
   (PV, EV, AC, SPI, CPI, EAC, ETC, VAC, TCPI), T8 offline project edits
   (50 edits, zero loss, conflicts shown), T10 dashboard reconciles to the
   engine, T7 browser half (5,000 rows, frame time, memory soak).
3. Measure line and branch coverage of services/ppm/*.js and
   public/lib/ganttCore.js. Report the figure; do not chase a number with
   empty tests.
4. Interoperability kit for a human: three MSPDI files exported by SDP360
   (small, 1,000 tasks, calendars + all link types) with a checklist to open
   them in Microsoft Project and compare dates, float and critical path.
   The agent cannot perform this check and must not claim it.
5. Witness project kit for the PMO (gate "Business witness project"): a
   script to load one real project supplied by the PMO into a TEST instance,
   and a comparison sheet tool-of-record vs SDP360.
6. Wording: remove or qualify every claim of "MS Project-grade" or "parity"
   in the UI, help and docs until T1-T11 and the human checks pass.
7. Thresholds (RAG, DCMA, alerts) stay PROPOSED and are listed for the PMO.
```

## P05 — Performance budgets and service levels

**Why:** CI records p50/p95 as "observation, not a budget". Every SLO target in docs/ops/SLO-PROPOSAL.md is UNKNOWN. No external probe exists.

```
/goal Give SDP360 measured, enforceable performance and service levels.

Use tools/test/load.js, tools/test/perf-baseline.js, docs/ops/LOAD-TEST.md,
docs/ops/SLO-PROPOSAL.md, routes/health.js, tools/ppm/bench-engine.js.

1. Synthetic dataset at declared production scale (ask the owner for the
   real orders of magnitude: sites, users, tickets per year, assets,
   projects; until answered use the 100,000-ticket rehearsal set and say so).
2. Run load and a 1-hour soak with the harness in a separate process from
   the server. Record p50/p95/p99, error rate, memory, pool saturation,
   slowest queries with their plans.
3. Fix only measured bottlenecks: unbounded queries, missing indexes,
   N+1 readers, synchronous deck generation on the request path.
4. Propose budgets per route class (page data, export, deck generation,
   sync) from the measurements. Add them to CI in warn mode with the switch
   to make them blocking; the SRE owner decides when.
5. Instrument the SLIs already listed in SLO-PROPOSAL.md so each has a
   30-day reading, and expose them on the existing health endpoint. Describe
   what an external probe on /ready must do; do not add a monitoring
   connector.
6. Restore drill: time a full restore of the scale dataset and report the
   observed recovery time and data loss window as inputs for RPO/RTO.

Deliver the report (environment, dataset, workload, results, limits) and the
dossier for the Capacity and Backup/restore gates. Targets stay UNKNOWN
until a person approves them.
```

## P06 — Reduce the monolith, keep the stack

**Why:** server.js is 6,914 lines with 209 inline routes; reports-db.js is 5,859 lines. Parallel agent bundles already collide on these files.

```
/goal Reduce the change-collision surface of server.js and reports-db.js
with no behaviour change and no new technology.

1. Map server.js: for each of its inline routes, its domain, the helpers it
   closes over, its tests. Map reports-db.js the same way per exported
   function.
2. Extraction order by collision history: use git log to rank the regions
   touched by the most merges in the last 30 days. Extract those first.
3. For each extraction: characterization test first (response bodies,
   status codes, headers, side effects), move to routes/<domain>.js and
   services/<domain>Store.js, keep the URL and the JSON shape, run the full
   suite and regenerate the inventory and the authz matrix. The matrix diff
   must be empty apart from file paths.
4. Authorization helpers used inline (_requireSuperAdminInline and similar)
   become named guards registered in services/capabilityRegistry.js, so P02
   can see them.
5. Ratchet: a test that fails if server.js or reports-db.js grows, with the
   current line count as the ceiling, lowered at each extraction.
6. CLAUDE.md is 566 KB. Split it into a short rules file and dated archives
   under docs/; keep only what an agent must read on every run.

Do not introduce microservices, a message broker, a new framework or
TypeScript. Record the target module map as one ADR.
```

## P07 — Security closure and penetration-test readiness

**Why:** The design is strong (OIDC + PKCE, origin guard, hash-chained evidence, SoD). The independent test is unsigned and the content security policy is still report-only on legacy pages.

```
/goal Close the open security items and hand an independent tester a
complete, runnable package. The agent does not perform the penetration test.

1. From docs/security/THREAT-MODEL.md and docs/agent-execution/A-28.md list
   every open item with current status at HEAD.
2. Content security policy: inventory pages still needing unsafe-inline or
   unsafe-eval, migrate them page by page to the nonce policy, and move each
   migrated page from report-only to enforced behind the existing mechanism.
3. Single sign-on: test every sso_mode value including break-glass; prove
   that a deprovisioned Entra account loses its session
   (services/entraDeprovision.js); document what "SSO only" would switch off
   and leave the decision to the security owner.
4. Sessions: fixation, reuse after logout, after deactivation, after role
   removal, forced logout - one test each if missing.
5. Key-only and public routes (8 public, 16 global-key): confirm each
   against DASHKEY-CLIENTS.md; propose retirement of unused ones.
6. Secrets: confirm rotation status in docs/security/ROTATION-RECORD.md and
   the history decision from EX-01; list what a person must rotate.
7. Supply chain: verify the xlsx dependency (installed from a vendor tarball
   URL) has a pinned integrity hash in the lockfile and an offline copy for
   the installer; SBOM generated for the release.
8. Tester package: TEST-instance build steps, one account per role, the
   authz matrix, the scenario list in docs/security/PENTEST-SCOPE.md with
   the rules-of-engagement table left for the security owner to sign.
```

## P08 — KPI and data certification pack

**Why:** No KPI is certified until the KPI committee approves a definition. Change success rate still carries two draft definitions.

```
/goal Prepare every published KPI for a committee decision and prove the
same figure appears on every surface.

Use services/metricRegistry.js, services/kpiRag.js, kpi policies,
docs/ops/METRIC-LINEAGE.md, docs/sdp360/completion/KPI-DISPUTES.md,
FORMULA_RECONCILIATION.md, tests/figure-parity-five-surfaces.test.js.

1. One dossier per KPI shown to executives: definition, numerator,
   denominator, exclusions, source and job, freshness window, aggregation
   rule across sites (state when it is a mean of percentages), RAG policy and
   its origin, owner role, open disputes, and a worked example on synthetic
   data.
2. Where two definitions exist, show both results side by side on the same
   data and state the consequence of each choice. Do not choose.
3. Parity: extend the five-surface parity test to every executive KPI
   (page, API, PPTX, XLSX/CSV, e-mail digest). One calculation path per KPI;
   list and remove duplicates.
4. Reconciliation against the source: for each integrated source a
   count-and-sum check against a source export the owner provides; the tool
   and the comparison sheet are the deliverable, the data is the owner's.
5. Unknown handling: sweep every reader for "|| 0", "?? 0", COALESCE(..., 0)
   on measured values; each hit is justified or fixed.
6. Site and department reference data: finish site_codes_from_registry
   readiness with the difference report, for a human to switch.

Deliver the dossier set formatted for the KPI committee and the dossier for
the "KPI definitions" gate.
```

## P09 — Adoption and field readiness kit

**Why:** Pilot instruments exist (stopwatch, first-click, SUS, device sheets) and are empty. No capability is field-validated. A French-coverage test fails at HEAD.

```
/goal Make a two-site pilot runnable and measurable. People run it; the
agent prepares it.

1. Fix the failing static checks at HEAD (French entries on project.html;
   focus-ring rule in tests/a11y-static.test.js) and find why they merged
   red.
2. French: list every page whose body is still English against
   tests/i18n-coverage.test.js; translate using docs/ux/GLOSSARY-FR.md; no
   new variant for an existing term.
3. Page rationalisation: 85 HTML pages. For each: owner profile, last-30-day
   usage if routes/pageUsage.js has data, overlap with another page. Propose
   merges and retirements; execute none without approval.
4. For each of the 11 profiles write the three tasks that matter most and
   make each reachable in three clicks from that profile's landing page;
   add a browser journey per profile.
5. Field: run the device scenarios in docs/ops/pilot/FIELD-DEVICE-UAT.md as
   automated browser tests where possible (network loss mid-inspection,
   interrupted upload, long offline, duplicate send, expired session,
   shared phone). List the ones only a person on a device can run.
6. Measurement: wire the existing value scoreboard and page-usage data to
   the pilot sheets so baseline and pilot weeks are captured without manual
   re-entry. Never pre-fill a result.
7. Training: one page per profile, French and English, from the help
   content already in the app.

Deliver the pilot runbook, the per-profile journeys, and the list of
decisions the sponsor must take (sites, cohort, dates).
```

## P10 — Evidence dossier per human gate

**Why:** docs/sdp360/completion/RELEASE-GATES.md lists 21 gates. Every decision cell is empty, which the file defines as NO-GO.

```
/goal For each row of docs/sdp360/completion/RELEASE-GATES.md produce the
dossier its approver needs to decide in one sitting. Fill no decision cell.

For each gate:
1. The question to decide, in one sentence, in the approver's vocabulary.
2. Evidence at the target SHA: tests, reports, matrices, rehearsals - each
   with the command that regenerates it and its date.
3. What is NOT evidenced and why (no pilot data, no independent test,
   threshold not chosen).
4. Options with consequences, including "not now".
5. Residual risks if approved today.
6. What the approver must supply (name, value, threshold, credential).

Order the gates by dependency and show the critical path to a pilot
GO/NO-GO: which gates block a two-site pilot, which block general
deployment only.

Format: one two-page document per gate, French and English, generated from
one source so that a new SHA regenerates all of them. Add a test that fails
if a dossier cites evidence older than the target SHA.
```

## P11 — Independent qualification run

**Why:** Reviews so far were run by the same agent family that wrote the code. A qualification run must be separated and must end with people.

```
/goal Run a qualification of SDP360 at a frozen SHA with reviewers that did
not write the code, and hand the result to the human release committee.

1. Freeze: tag the SHA. No merge during the run.
2. Reviewer agents start from a clean clone with no access to
   docs/agent-execution/ narratives - only code, tests, matrices and the
   gate dossiers. Seats: security, data/KPI, PPM, operations, UX/field,
   audit.
3. Each seat re-runs the evidence itself (suite, journeys, P02 probe,
   restore rehearsal, load run, PPM certification) and records command,
   result and SHA. A result it did not reproduce is "not verified".
4. Each seat tries to break one claim per capability in its area.
5. Findings classified P0-P3 with reproduction steps. P0/P1 go back to
   implementation; the run restarts from step 1 at a new SHA.
6. Output: readiness report, residual-risk register, and a recommendation
   GO PILOT / CONDITIONAL / NO-GO per lot from P03 - stated as the AI
   panel's recommendation, with the list of human gates still empty.

The run ends when the human committee has the report. It does not end with
a release.
```
