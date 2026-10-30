# SDP360 — Claude Code native /goal + 25 executable remediation goals

Read the installation instructions. `/goal` is a native Claude Code command in documented current versions; **do not install a custom `goal` skill**. Each prompt below is independent, but run in dependency order. Long-running goal mode does not authorize unattended production operations or impersonated acceptance. `/sdp-*` skills are project-defined and must be copied to the repository before invoking them.

## MASTER GOAL — execute all compatible engineering actions

```text
/goal Drive SDP360 branch claude/sdp360-consolidation through the complete G00-G24 remediation programme in SDP360_GOALS_READY_TO_PASTE_EN.md. Before modifying anything verify current HEAD, working tree, actual CI and paths; respect .claude/rules/SDP360_BOUNDARIES.md. Use the /sdp-master skill, isolated specialist subagents, supported read-only MCP tools and independent reviews. Make reversible technical decisions autonomously after evidence-backed ADRs, implement and test code, document each completed Gxx in docs/agent-execution, avoid duplicate modules and protect the inherited architecture. Execute waves W0 -> W1 -> W2 -> W3 -> W4 -> W5 -> W6; complete independent work even if human authority is pending. Do not silently mark an unmeasured KPI, missing chart contract, user approval, live data, legal right, test skip or field UAT as PASS. Use SHADOW/pending for unresolved business policy, block irreversible or live actions, never deploy/merge/push or send real notifications, and finish with an executive NO-GO/GO recommendation grounded in actual evidence. Continue until every coding task is tested or an explicit blocker with exact owner and precondition is recorded; no false completion or unauthorized production actions.
```

## Individual native /goal prompts

### G00 · Re-baseline / proof of truth · W0 · sdp-audit

```text
/goal Finish SDP360 G00 — Re-baseline / proof of truth on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-audit with the `sdp-chief-architect` subagent acting as an independent reviewer. Map existing references: G-01 G-02 CG-11.

AUDIT AND DESIGN: Re-read HEAD, branch ancestry, files, migrations, actions CI and live feature flags. Reconcile stale 2027/ and consolidation/ docs against current code; distinguish IMPLEMENTED, TESTED, FIELD_VALIDATED, DEPLOYED, BUSINESS_ACCEPTED, BLOCKED.

IMPLEMENTATION: Commit an evidence-based inventory, feature x role x site x channel map, gap register linked to named files/tests, source-of-truth README with SHA, a dependency DAG and executable phase checklist. Preserve history; do not claim deployment from CHANGELOG.

ACCEPTANCE: Every feature has source path, test proof or explicit UNKNOWN; contradictions between files become tracked defects; manifest has stable IDs.

DECISION RULE: Technical prioritisation delegated; no invented field acceptance.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G00.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G01 · Reproducible toolchain, CI and version integrity · W0 · sdp-qa

```text
/goal Finish SDP360 G01 — Reproducible toolchain, CI and version integrity on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-qa with the `sdp-sre` subagent acting as an independent reviewer. Map existing references: G-01 G-02 CG-06 CG-07 CG-09.

AUDIT AND DESIGN: Establish pinned Node runtime after examining package.json, installer and CI; reconcile runtime/lock/readme versions, reproducible npm ci, PG17 collation/timezone, build and test manifest.

IMPLEMENTATION: Unify automated checks, lock dependency versions, record all skips by reason; make PG17 migrations, SAST, dependency audit, build and full tests blocking; fix latest CI/Installer errors with reproducible Windows evidence.

ACCEPTANCE: Every workflow green at one exact HEAD; no hidden skip; tests fail when gates are intentionally broken; attach workflow URLs and SHAs.

DECISION RULE: Do not mark current CI green until the HEAD jobs finish.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G01.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G02 · Cross-site / cross-department data authorization · W1 · sdp-security

```text
/goal Finish SDP360 G02 — Cross-site / cross-department data authorization on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-security with the `sdp-ciso` subagent acting as an independent reviewer. Map existing references: CG-01 CG-02 G-03 G-04 G-05 G-07 G-08 D-14 D-15.

AUDIT AND DESIGN: Enumerate all API, HTML, exports, media, PPTX/XLSX, signed shares, background jobs, API-key paths and object IDs. Prove positive and negative authorization per persona/site/department/object/action/channel.

IMPLEMENTATION: Implement centralized object-level deny-by-default checks for read and write, security audit events, immediately effective session revocation, and department grants with policy migration in shadow mode. Identify and constrain the 16 dash-key-only routes by registered consumer, without breaking approved external clients.

ACCEPTANCE: Automated site A vs B, department A vs B, revoked user, forged token and malicious CSV tests; zero unauthorized content/exposure; staged compatibility report for all consumers.

DECISION RULE: Technical scope delegated; if a real external consumer is unknown, restrict new routes and record existing exception pending verified owner instead of breaking it blindly.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G02.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G03 · Secrets, outbound networking and supply-chain security · W1 · sdp-security

```text
/goal Finish SDP360 G03 — Secrets, outbound networking and supply-chain security on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-security with the `sdp-ciso` subagent acting as an independent reviewer. Map existing references: CG-03 CG-04 CG-05 G-09 G-27 EA-01.

AUDIT AND DESIGN: Threat-model login/SSO/CSRF/CSP, TLS verification, SSRF, outbound webhooks, secret storage, logs, attachments, AI provider and dependency tree. Hunt for hard-coded secrets across Git history without exposing values.

IMPLEMENTATION: Remove exposed values from working files, add secret scanners, parameterized config, URL allowlists including DNS rebinding protection, strict content policies incrementally, pinned action SHAs and SBOM. Prepare secret-rotation instructions, not the actual unauthorised production rotation.

ACCEPTANCE: Negative abuse tests, no high/critical dependency audit findings at pinned lockfile, no exposed secrets in distribution, reviewable threat-model + risk ledger.

DECISION RULE: AI can choose mitigations; real secret rotation and history rewrite require environment owner authorisation.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G03.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G04 · PostgreSQL-only migrations, audit chains and recovery · W1 · sdp-data

```text
/goal Finish SDP360 G04 — PostgreSQL-only migrations, audit chains and recovery on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-data with the `sdp-data-architect` subagent acting as an independent reviewer. Map existing references: PO-08 G-11 G-34 CG-10.

AUDIT AND DESIGN: Validate all PostgreSQL-only migrations and transaction semantics under PG17, locale en_US.utf8, UTC and representative test shapes. Inspect audit-table ownership, trigger functions, idempotence, hash-chain anchors, backups and restore tooling.

IMPLEMENTATION: Create fresh/install/upgrade/rollback rehearsals with disposable databases; test encrypted backup, corruption checks, retention, realistic restore size and failure injection; document RPO/RTO as observed values only.

ACCEPTANCE: Two consecutive fresh migrations idempotent, restore reconstitutes database and audit chain, no application owner power to delete/tamper evidence, synthetic recovery timings captured.

DECISION RULE: Never run migrations/restore on production; DBA must execute protected role grants.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G04.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G05 · Connector scope and canonical data contracts · W1 · sdp-integrations

```text
/goal Finish SDP360 G05 — Connector scope and canonical data contracts on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-integrations with the `sdp-data-architect` subagent acting as an independent reviewer. Map existing references: G-29 G-30 D-06 D-07 D-08 D-09.

AUDIT AND DESIGN: Map the 13 documented connectors, their owners, direction, contracts, polling limits, secrets, data lineage, mapping and rate limits. ServiceDesk Plus/Analytics is read source; OpManager is infrastructure source; Meraki remains for WAN/SLA; the native PPM has no Meridian dependency.

IMPLEMENTATION: Implement connector ownership/catalog, health, retries, idempotent ETL, 0-row and truncation protection, per-source coverage and stale/unknown states. Keep excluded connector ban: Pronto, OT/HSE, ISP, Nutanix, external backup platforms, Defender API and external PPM. Preserve Meraki. Stage decommission proposal for dormant Meridian after consumer inventory.

ACCEPTANCE: Contract and failure tests, zero prohibited live connectors, every registered source mapped to real job/API; source outage cannot produce fresh false-green KPI.

DECISION RULE: MCP must be read-only on sandbox/nonproduction data; credentials never added to repository.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G05.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G06 · Canonical KPI definitions and official score · W2 · sdp-kpi

```text
/goal Finish SDP360 G06 — Canonical KPI definitions and official score on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-kpi with the `sdp-itil-owner` subagent acting as an independent reviewer. Map existing references: D-01 D-02 D-03 G-12 F-09 ITSM-06 ITSM-09.

AUDIT AND DESIGN: Map all KPI definitions and hard-coded variants; reconcile denominators, window and exclusions: helpdesk requests, first-response SLA, resolution, changes, PIR, 2026 baseline, roadmap 22%/54% discrepancy, RAG thresholds and site weights.

IMPLEMENTATION: Build one versioned registry (formula, numerator, denominator, scope, source, as-of, provenance, owner, target, approval) and dual-run old/new metrics; emit a disagreement report. Use null/UNKNOWN for no source, never 0 or green. AI drafts D-01/02/03 with alternatives supported by evidence; unapproved corporate score remains SHADOW.

ACCEPTANCE: Golden SQL/fixture tests verify counts and rate derivation, no averaging percentages, one canonical definition used on all surfaces, violations identified; no official ranking until supported by approved criteria.

DECISION RULE: AI chooses reversible technical implementations; it cannot certify missing corporate KPI policy.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G06.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G07 · Reporting source freshness and publication controls · W2 · sdp-reporting

```text
/goal Finish SDP360 G07 — Reporting source freshness and publication controls on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-reporting with the `sdp-risk-auditor` subagent acting as an independent reviewer. Map existing references: G-13 G-14 D-13 G-25.

AUDIT AND DESIGN: Trace data -> calculation -> dashboard -> scheduled report -> external export; define stale/missing/partial-feed behavior and proper separation of author, reviewer, approver and publisher.

IMPLEMENTATION: Implement immutable published snapshots, withdrawn/reissue history, channel scoping, per-recipient approvals, audit evidence, no publication when required sources are STALE/UNKNOWN except controlled logged override. Reject reused stale review after edit.

ACCEPTANCE: Automated freshness, concurrent publish, revoked share, role-scope, false-green and withdrawal tests; recipient-specific output reproducible from captured data snapshot.

DECISION RULE: AI can design policy; public/released reports cannot claim formal corporate approval without delegated identity and recorded authority.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G07.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G08 · Governance meetings, cadences and decision lifecycle · W2 · sdp-governance

```text
/goal Finish SDP360 G08 — Governance meetings, cadences and decision lifecycle on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-governance with the `sdp-itil-owner` subagent acting as an independent reviewer. Map existing references: G-21 F1-F13.

AUDIT AND DESIGN: Inspect roles/deputies/site calendars/cadence sessions/agendas/decisions/minutes/acceptance; trace action continuity and missed meetings. Harmonise committee, group and mine-site policy.

IMPLEMENTATION: Implement effective-dated meeting calendar, rescheduling non-erasing history, explicit role ownership, agenda generation, minutes signer verification, meeting-to-action follow-through, exceptions and immutable accepted minutes; site-level scope and bilingual forms.

ACCEPTANCE: Two-user role and concurrency tests; no unilateral approval under four-eyes policy; decisions automatically appear in next cadence and obligations; small-site exceptions logged.

DECISION RULE: AI may propose chairs and templates for simulation using known directory records; cannot assign real duties without authorised identity data.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G08.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G09 · Unified commitment, closure verification and serious-finding control · W2 · sdp-governance

```text
/goal Finish SDP360 G09 — Unified commitment, closure verification and serious-finding control on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-governance with the `sdp-risk-auditor` subagent acting as an independent reviewer. Map existing references: G-17 G-18 D-04 A01 A02.

AUDIT AND DESIGN: Trace all action sources and terminal statuses; ensure canonical commitments with source links, stable keys, append-only events, evidence and independent verification. High/critical findings require owner, due, treatment and non-silent exceptions.

IMPLEMENTATION: Complete safe paginated backfill dry-run then idempotent migration, event ledger, lifecycle captured -> triaged -> committed -> in_progress -> awaiting_verification -> verified_closed, reopen/reject/accept risk with reason. Deduplicate escalations; default notifications OFF until recipients known.

ACCEPTANCE: Backfill leaves originals intact; re-run does not duplicate; cross-site impossible; executor cannot self-verify; unresolved serious obligations remain visible across switch toggles.

DECISION RULE: AI chooses default workflows in simulated mode; real exception acceptance remains a named business act.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G09.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G10 · Interdepartmental requests, ownership and escalations · W2 · sdp-governance

```text
/goal Finish SDP360 G10 — Interdepartmental requests, ownership and escalations on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-governance with the `sdp-product-owner` subagent acting as an independent reviewer. Map existing references: G-22 D-14 D-04.

AUDIT AND DESIGN: Review current handoffs, account-less contacts, department directory and receiver/initiator roles. Simplify terminology and site-aware routing; avoid cross-site disclosure and phantom proxy approvals.

IMPLEMENTATION: Implement department-owned queues, request->accept->deliver->verify state machine, blocked/reassign/deputy paths, SLA calendars, idempotent operations, escalation ledger and notification destinations with switches default OFF.

ACCEPTANCE: Role x site x department negative tests; duplicate calls only one outcome; requester verifies, actor-on-behalf visibly attributed; expiry and reassign rules testable.

DECISION RULE: AI can set sample department routing for a fixture; real names and live notification recipients require source-backed directory and explicit operational enablement.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G10.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G11 · Native PPM: full project execution and resource management · W3 · sdp-ppm

```text
/goal Finish SDP360 G11 — Native PPM: full project execution and resource management on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-ppm with the `sdp-ppm-architect` subagent acting as an independent reviewer. Map existing references: G-19 G3.1 G3.2 G3.3.

AUDIT AND DESIGN: Extend existing governanceStore/portfolio tables, not a parallel PPM product. Analyze missing project charters, life-cycle gates, WBS, deliverables, tasks, durations, dependencies, resource allocation, calendars, critical path and changes.

IMPLEMENTATION: Implement project->WBS->task->dependency->milestone->deliverable with baseline vs forecast vs actual; project stages proposal/approval/in-progress/on-hold/closure; configurable project templates, RACI, dependency cycle detection, resource conflicts, milestone slippage and Gantt. Keep programs and portfolios native.

ACCEPTANCE: Create/update authorization, referential integrity, no cyclic dependencies, valid schedules, rollback migration and E2E project lifecycle fixtures. UI must work for project manager and executive.

DECISION RULE: AI selects architecture and technical workflow; budgets/mandates stay draft until finance/sponsor authenticated.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G11.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G12 · Native PPM: budget, financial control and benefits realization · W3 · sdp-ppm

```text
/goal Finish SDP360 G12 — Native PPM: budget, financial control and benefits realization on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-ppm with the `sdp-ppm-architect` subagent acting as an independent reviewer. Map existing references: G-19 G14 G3.2 G3.3.

AUDIT AND DESIGN: Define project investment model with approved budget, changes, forecast at completion, actual cost imports under controlled provenance, benefit hypotheses and verified actual benefits. Do not invent financial figures.

IMPLEMENTATION: Create currency-aware finance ledger, funding request, capex/opex tags, period allocation, cost-to-complete, forecast versus actual, sensitivity scenarios, benefit owners, evidence and Finance read-only role. Build export to Power BI without adding any ERP connector.

ACCEPTANCE: Fictitious values only in clearly labeled test fixtures; no double-counting in portfolio roll-up; no currency mixing; audited financial edits and Finance separation of duties; cost fields null if source absent.

DECISION RULE: AI produces proposed thresholds and model; finance approval/figures remain unverified until source supplied.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G12.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G13 · Native PPM: roadmap consolidation and migrations · W3 · sdp-ppm

```text
/goal Finish SDP360 G13 — Native PPM: roadmap consolidation and migrations on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-ppm with the `sdp-chief-architect` subagent acting as an independent reviewer. Map existing references: G-20 G-19 E9.

AUDIT AND DESIGN: Analyze existing Roadmap Manager, itsm-roadmap.html and new portfolio modules. Identify duplicated fields, routes, references and reporting consumers; select native PPM as target.

IMPLEMENTATION: Build mapping and dry-run migration with counts, conflicts, provenance, source-to-target lineage and reversible dual-read; deep-link old entry points. Preserve legacy for a comparison cycle; do not delete before signed-off data parity.

ACCEPTANCE: Migration repeatability, no missing milestones/actions, metric parity or documented differences, old links redirect without loss, read-only old module after cutover only when proven.

DECISION RULE: AI determines technical migration order; irreversible live cutover stays gated.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G13.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G14 · RFI, incubation and investment decision pipeline · W3 · sdp-product

```text
/goal Finish SDP360 G14 — RFI, incubation and investment decision pipeline on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-product with the `sdp-product-owner` subagent acting as an independent reviewer. Map existing references: G-19 G21 F6.

AUDIT AND DESIGN: Complete idea/request intake, triage, evidence, risk, reach, impact, effort, sponsor and decision provenance. Resolve conflict between current RFI scoring and charter with alternative score simulation.

IMPLEMENTATION: Implement RFI->analysis->approved initiative->project/program intake with transparent criteria, versioned business cases, rejection/deferral reason, traceable decisions, role-based review and no duplication.

ACCEPTANCE: Scoring matches selected documented policy, tests cover manipulative inputs and access scopes, accepted RFI generates at most one canonical project with linked lineage.

DECISION RULE: AI recommends formula via ADR but retains provisional label until policy ownership is actually recorded.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G14.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G15 · Composable trackers, dashboards and catalog contracts · W3 · sdp-analytics

```text
/goal Finish SDP360 G15 — Composable trackers, dashboards and catalog contracts on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-analytics with the `sdp-ux-lead` subagent acting as an independent reviewer. Map existing references: G-23 G-24 G-27 G-28 CG-11.

AUDIT AND DESIGN: Assess tracker definitions, dashboard widgets, metric registry, existing 41 chart-contract references and F01-F24 backlog. Inspect actual source files before converting requested feature references into verified requirements.

IMPLEMENTATION: Complete catalogue, role/site audience definitions, no raw SQL composer, accessible grid, validated units, publish/rollback history, templates, data as-of. If original F01-F24 / 41 chart register absent, create a PROPOSED backlog with clear provisional IDs and blocked source verification; never claim to reproduce missing input.

ACCEPTANCE: Snapshot parity, grid collision tests, self-review denial, missing/stale chart states, large datasets and export fidelity; no invented charts certified by an absent source.

DECISION RULE: AI may choose optional visual components and layout; missing contractual chart acceptance remains BLOCKED.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G15.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G16 · R01-R16 report factory, A01-A16 alerts and deliverability · W3 · sdp-reporting

```text
/goal Finish SDP360 G16 — R01-R16 report factory, A01-A16 alerts and deliverability on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-reporting with the `sdp-itil-owner` subagent acting as an independent reviewer. Map existing references: G-25 G-26 G-27 D-13.

AUDIT AND DESIGN: Review report catalog, schedulers, templates, SMTP, Graph, Teams, SLA/major incidents and current delivery logs. Build traceable inventory of requested R01-R16 and A01-A16; do not synthesize unavailable authoritative definitions.

IMPLEMENTATION: Add report schemas, source contract, reviewer/publisher chain, recipient scopes, schedules, historical freeze, failure/resend, multi-format export. Add rule engine severity/dedup/cooldown, dispatch log, dry-run recipient verification and STOP switch; test Microsoft Graph/SharePoint via mocked transport before using live tenant.

ACCEPTANCE: Zero unauthorized distribution; report calculations reconciled; dry-run receives correct audience and fails safely on missing/expired credentials; rule fires once per episode.

DECISION RULE: AI can implement message templates; live recipient activation and send authorisation cannot be assumed.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G16.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G17 · UX navigation redesign and role-based workspaces · W4 · sdp-ux

```text
/goal Finish SDP360 G17 — UX navigation redesign and role-based workspaces on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-ux with the `sdp-ux-lead` subagent acting as an independent reviewer. Map existing references: G-31 G-32 F-16 DEC-6.5.

AUDIT AND DESIGN: Inventory 48+ top-level pages, 16 Operations entries, duplicated navigation paths, dead links, nonresponsive screens and actual usage personas. Keep original business semantics.

IMPLEMENTATION: Build role-specific entry points (executive, group/site IT, project manager, Finance, HR read-only, auditor, department head, technician); task-first IA, search, favorites, breadcrumbs, clear empty/error/loading states, keyboard and WCAG 2.2 AA-oriented checks. Preserve old URLs by redirects or alias.

ACCEPTANCE: Real browser 1280/390 widths, no page horizontal overflow, keyboard traversal, screenreader labels, site scope reflected in labels; URL/functional parity tests.

DECISION RULE: AI selects navigation designs based on heuristic tests; do not fabricate user satisfaction.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G17.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G18 · UI modularisation, i18n FR/EN, performance · W4 · sdp-ux

```text
/goal Finish SDP360 G18 — UI modularisation, i18n FR/EN, performance on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-ux with the `sdp-chief-architect` subagent acting as an independent reviewer. Map existing references: G-32 G-33 F-04 F-14.

AUDIT AND DESIGN: Measure module weight and hot endpoints; profile server.js ~7.7k lines and large HTML pages. Avoid full rewrite, preserve business logic and generated reports.

IMPLEMENTATION: Extract route domains, view models and shared components incrementally; consolidate design tokens, errors, forms, responsive shell and persisted FR/EN locale. Add lazy-load, paginate/cache via measured query plan, structured error IDs and test budget.

ACCEPTANCE: Golden HTML/PPTX regression, browser screenshots on stable fixtures, keyboard checks, API response contract parity, no increased bundle/endpoint latency at equal fixture size.

DECISION RULE: AI chooses internal refactoring; record compatibility changes.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G18.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G19 · Field offline PWA, conflict-safe sync and on-site adoption · W4 · sdp-field

```text
/goal Finish SDP360 G19 — Field offline PWA, conflict-safe sync and on-site adoption on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-field with the `sdp-field-architect` subagent acting as an independent reviewer. Map existing references: G-16 G-35 F-03 F-05.

AUDIT AND DESIGN: Review field service worker, outbox, upload chunks, offline cache, validation and authentication scope. Test online -> offline -> edit -> relogin -> reconnect on device-sized browser and simulated slow/captive network.

IMPLEMENTATION: Implement explicit pending/failed/conflict states, idempotent submissions, safe retry, correct site isolation, freshness timestamps, storage expiry, French default, form usability with keyboard/touch and no loss during interruptions.

ACCEPTANCE: Playwright offline E2E with simulated data, rapid double taps, network cuts and storage pressure; real-device field signoff flagged external; no silent data loss.

DECISION RULE: AI executes synthetic pilot and records evidence; cannot represent that as real mine-site validation.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G19.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G20 · Responsible AI commentary and grounded insights · W4 · sdp-ai

```text
/goal Finish SDP360 G20 — Responsible AI commentary and grounded insights on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-ai with the `sdp-data-architect` subagent acting as an independent reviewer. Map existing references: AI commentary reports.

AUDIT AND DESIGN: Inspect AI provider toggles, prompt injection through imported ticket text, leakage to cloud provider, model output correctness, multilingual tone and external API cost.

IMPLEMENTATION: Implement AI_PROVIDER=off by default, structured facts-only inputs, deterministic calculations outside LLM, PII redaction, prompt-injection barriers, timeout/limits, provider abstraction, human-readable source links and discrepancy rejection. AI text always marked draft until reviewed.

ACCEPTANCE: Hallucination/no-source tests with malicious fixture, offline mode works, zero invented KPI values, output cannot cause external writes or change published score.

DECISION RULE: AI agent may draft analysis, never self-attest operational measurements not in source.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G20.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G21 · E2E, load, security and resilience evidence · W5 · sdp-qa

```text
/goal Finish SDP360 G21 — E2E, load, security and resilience evidence on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-qa with the `sdp-qa-lead` subagent acting as an independent reviewer. Map existing references: G-35 G-36 G-37.

AUDIT AND DESIGN: Generate traceability matrix every requirement -> UI -> API -> DB -> evidence. Re-run integration in PostgreSQL17 and browser tests with representative anonymized fixtures, verify permission and export boundaries.

IMPLEMENTATION: Create deterministic E2E suites, property/fuzz, API contract tests, OWASP checks in authorised staging, load/soak with synthetic concurrency, fault injection, SLO baselines, security scan reports and cross-browser matrix.

ACCEPTANCE: Every P0 has failing-before-fix test; 0 critical unresolved; full suite green at same HEAD; published SLO only with observed baseline; skips explicit with owners.

DECISION RULE: No production penetration tests, load tests, secret probes or user impersonation without access approval.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G21.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G22 · Windows installer, upgrade, packaging, recovery · W5 · sdp-release

```text
/goal Finish SDP360 G22 — Windows installer, upgrade, packaging, recovery on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-release with the `sdp-sre` subagent acting as an independent reviewer. Map existing references: G-34 G-09 EA-07 EA-11.

AUDIT AND DESIGN: Diagnose latest Installer workflow failure, build/release scripts and manager GUI, PG17 prerequisites, silent install, repair, update, service lifecycle, backups and rollback against Windows clean-host test.

IMPLEMENTATION: Fix scripts and paths, produce signed-manifest verification using TEST keys (clearly not production keys), self-contained installer, backup-first update, uninstall preserving data, restore runbook and checksummed artifacts.

ACCEPTANCE: Workflow Windows clean install + upgrade + forced rollback + restore + uninstall succeeds and logs uploaded; security and operational documents accurate; no hardcoded admin credentials.

DECISION RULE: Production signing credentials and actual CAB release remain outside autonomous sandbox.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G22.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G23 · Product packaging, licensing and go-to-market feasibility · W5 · sdp-commercial

```text
/goal Finish SDP360 G23 — Product packaging, licensing and go-to-market feasibility on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-commercial with the `sdp-product-owner` subagent acting as an independent reviewer. Map existing references: G-38 G-39 LICENSE.

AUDIT AND DESIGN: Inspect LICENSE (Endeavour internal use only), inherited code origins, npm license report, dependencies, trademarks, user data/data protection, support obligations and cost structure. Do not assume this public repository is commercially licensable.

IMPLEMENTATION: Prepare product scope, deployment architecture, support/SLA design, SBOM, license/right-to-market risk matrix, TCO/ROI calculation template with blank real values, pricing scenarios clearly labelled hypothetical, target personas and competitive differentiation. No commercial release claim until rights clarified.

ACCEPTANCE: A traceable rights register names each component and right owner; no invented permissions, prices, customer traction or ROI; packaging works in test with secrets absent.

DECISION RULE: AI may recommend commercial strategy but cannot grant Endeavour/third-party rights or sign contracts.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G23.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

### G24 · Executive validation, adoption measurement and final NO-GO/GO dossier · W6 · sdp-product

```text
/goal Finish SDP360 G24 — Executive validation, adoption measurement and final NO-GO/GO dossier on claude/sdp360-consolidation with verifiable, regression-tested changes and a final evidence report.

Context and constraints: Project: SDP360, branch claude/sdp360-consolidation. Before any edits confirm actual HEAD and create a separate worktree or branch for the goal; never overwrite uncommitted work. Node/Express/PostgreSQL-only (target PG17); read existing files and tests before deciding, preserve compatible APIs, UI, reports, data and migrations. Do not build a second PPM, ITSM, or asset register. ServiceDesk Plus remains system of record; OpManager for infrastructure; keep Meraki WAN/SLA; no connectors to Pronto, OT/HSE, ISP, Nutanix, external backup systems, Microsoft Defender or external PPM. AI may decide reversible technical choices after independent architecture/security/QA review, writing a versioned ADR with alternatives, affected paths, test evidence and rollback. For absent source data return UNKNOWN, never invent historical KPIs, approvals, authorisations or financial amounts. No production deployment, live writes, real notifications, key rotations, irreversible migration, repo-wide history rewrite, merges or legal/finance approvals unless actual authenticated authority and explicit operator action are available. All code work may proceed in isolated nonproduction fixtures.

Primary specialist: /sdp-product with the `sdp-chief-architect` subagent acting as an independent reviewer. Map existing references: G-10 G-35 G-40.

AUDIT AND DESIGN: Consolidate all generated evidence, unresolved risks, latest workflow statuses, UAT synthetic results and measured business benefits. Revisit original gaps and new regressions.

IMPLEMENTATION: Produce executive FR report with feature-by-feature IMPLEMENTED/TESTED/FIELD_VALIDATED/DEPLOYED/BUSINESS_ACCEPTED, open decisions, release candidate notes, operations manual, pilot pack, finance data request, compliance evidence, benchmark and prioritized next steps.

ACCEPTANCE: Machine-checkable traceability, zero unreferenced PASS, each exception has owner/evidence/expiry, explicit NO-GO until formal gates actually cleared; no automatic merge, prod deploy, live notification, market release.

DECISION RULE: AI provides recommended GO/NO-GO decision, not fictitious signatures.

Execution protocol: (1) inventory exact code and reproduce failure; (2) write ADR for nontrivial tradeoffs and a failing regression test; (3) implement smallest compatible fix with DB migration + rollback if needed; (4) run appropriate unit/integration/API/browser tests, lint, build and complete suite if feasible; (5) have a different specialist review risk, privacy and regression; (6) record file paths, exact commands/exit status, CI links, commit SHA, before/after and remaining restrictions in docs/agent-execution/G24.md; (7) update a single goal tracker and make an isolated local commit. Never claim passing checks that were not executed. Continue until acceptance is proved or a named external authority/data/environment blocker is documented. Do not erase an unresolved blocker to declare success.
```

