# Source prompts (user, 2026-11-12) — verbatim

## Execution order (CSV)
```
Order,Run,Why first
1,A0,Safety net — makes every later flag flip safe
2,"A1, A2","Unlock certified money + trustworthy data (blockers for B1, B8, C4)"
3,A3–A8,"Cheap ergonomics/adoption wins, measurable immediately"
4,"B1, B2",The two loops that convert data into cash and closed actions
5,B3→B4→B5→B6,"Portfolio chain — strict order, each canary-gated"
6,"B7, B8, B9","Coherence, actuals, reporting speed"
7,C1→C2→C3,"PPM parity: audit, engine, then executive view"
8,C4–C9,Depth once actuals and gates exist
9,D1–D3,"Sustain, prove, report value"```

```
ROLE: Senior engineer + PPM/IT-operations domain expert + QA on the SDP360 codebase (rev 55dc67c).

NON-NEGOTIABLE INVARIANTS — never break, test each one:
1. Site perimeter: editor acts only on his site(s); admin tier acts on all; no-site account reads/writes nothing site-scoped.
2. Amounts visible only to admin tier + finance-viewer — in UI, exports, PPT, Excel and API.
3. Métier-only accounts: every route except Site Awareness returns 403.
4. Absent measure = "unknown"/"—", NEVER 0.
5. Submitted reports frozen; closed tracker months frozen (current + previous until the 5th).
6. Server-side timestamps; separation of duties (KPI author ≠ approver; super-admin motive/second person).
7. Source systems read-only (SDP, Meraki, OpManager). No production data to any AI model.
8. Feature flags = human decision. Presentation (profiles/blocks) NEVER grants a right.

METHOD: For each requirement classify [IMPLEMENTED]/[PARTIAL]/[STUBBED]/[MISSING] with file:line
evidence (STUBBED = UI exists, logic fake: hardcoded, mock, TODO, linear spread). No evidence ⇒ not
IMPLEMENTED. Write the failing test BEFORE the fix. Migrations reversible, zero data loss.

OUTPUT CONTRACT (every /goal):
1. Gap matrix (item | status | evidence | fix)
2. Code changes wired end-to-end (no orphan UI)
3. Tests proving it (unit + e2e + invariant regression)
4. Flag/rollout note: canary site, rollback trigger, owner
5. Value metric to instrument (before/after)
Never claim done without proof; list residual gaps explicitly.```

```
/goal A0 — SAFETY NET BEFORE ANY ENABLEMENT
SCOPE: 644-route access matrix, capability catalogue, role menus, site perimeter rule.
DO: generate an automated RBAC regression suite from the matrix: route × role × site-scope,
including 403 negatives (métier lock, cross-site writes), amounts masking in responses/exports,
frozen-period writes. Publish the capability matrix as machine-readable JSON, diffed per release.
PROVE: CI gate green; every documented rule has ≥1 test; deliberate rule break fails CI.
VALUE: enablement lead time, zero permission regressions per release.

/goal A1 — FINANCE VERIFIER: UNBLOCK CERTIFIED MONEY  [F1 · §3.7, §3.12, §5.3]
DO: implement designated Finance verifier (named role holder + audit), certification workflow
uncertified → verified (who/when/evidence/source), applies to asset finance, licences, investment,
depreciation AND project benefits. "Non certifié" badge disappears only when certified.
PROVE: finance-viewer still cannot certify; non-verifier cannot flip state; badge logic tested;
certification appears in audit log and exports.
VALUE: % amounts certified, USD of bookable savings/benefits.

/goal A2 — CONNECTOR HEALTH: MAKE "UNKNOWN" ACTIONABLE  [§4]
DO: Connector Health page per connector (SDP/Analytics, Meraki, OpManager, SDP Cloud): last success,
latency, coverage %, failing scope, plain-language cause. Verify OpManager end-to-end until LAN/Wi-Fi/
server KPIs prefill; verify where Meraki config actually loads at runtime. Provision SDP Cloud token
or formally disarm the dependent feature. Turn every "—" into a clickable fix task with owner.
PROVE: prefill provenance shown; injected connector failure surfaces as unknown, never 0.
VALUE: % KPI auto-prefilled, minutes saved per weekly report.

/goal A3 — HOME: ONE QUEUE INSTEAD OF MODULE HOPPING  [F4 · §3.13]
DO: enable ui_home_queue + ui_home_blocks + mywork_awaiting_me_enabled on a canary site. Single
prioritized queue: overdue actions, approvals awaiting me, report due, corrective actions, gate
sign-offs, RFI. Inline complete/snooze/delegate, deep-link to source, independent reorderable blocks.
PROVE: no source omitted ( meetings, inspections, reports, tracker, governance, portfolio);
perimeter respected; permissions unchanged; load <1s.
VALUE: median time-to-first-task, weekly active users, % overdue actions.

/goal A4 — 11 WORKSPACE PROFILES + JOB BUNDLES  [F4/F7 · §3.13, §3.14]
DO: enable workspace_profiles_enabled + settings page; map default profile per role; ship access
bundles ("Site Coordinator" = editor + tracker-editor + field; "Committee Member") via existing
request templates. Profiles change order/display only.
PROVE: automated test — switching profile grants ZERO new route; bundles resolve to explicit roles.
VALUE: clicks-to-task, access-request ticket volume.

/goal A5 — DECISIONS THAT ACTUALLY MOVE  [F6 · §3.11, §3.10]
DO: enable decision_lifecycle_enforced + dashboard_decision_kpis_seed. State machine with mandatory
motive on change, visible pending-approver, cycle-time KPI. Replace committee hard DELETE of
projects/decisions with soft-delete + reason + second person.
PROVE: transition without motive rejected; author cannot self-approve; deleted item recoverable and
still in audit trail; KPI reconciles to source records.
VALUE: decision cycle time (proposed→adopted), % decisions with motive.

/goal A6 — ONE FRONT DOOR (SSO AS ERGONOMICS)  [§3.15]
DO: enable Microsoft SSO, map identity to existing users/roles/sites, keep shared Basic-Auth only as
logged break-glass. Coherent "Mon accès", session list, deputy and emergency-access flows.
PROVE: RBAC identical under SSO; break-glass time-boxed and audited; no orphan session.
VALUE: login steps, access-related tickets, % named-identity actions.

/goal A7 — STOP FLATTERING THE SLA  [F3 · §3.1]
DO: add "open & breached" count and a dual compliance rate (closed-only vs including open past
target) for resolution and first response. Label the closed-only metric explicitly; align helpdesk
tiles, weekly report, scorecard and Exec View on the same definition.
PROVE: hand-computed fixture matches both rates; no tile mixes definitions.
VALUE: true breach count, MTTR, backlog aging.

/goal A8 — ACTIVATE THE VOICE OF THE USER (CSAT/NPS)  [missed value · ZOHO_SURVEY_ID configured]
DO: ship CSAT/NPS tiles per site and group from the configured survey: response rate, trend,
verbatim drill-down (permission-filtered), link to helpdesk volumes.
PROVE: no response ≠ 0; site perimeter on verbatims; sync failure shows unknown.
VALUE: CSAT trend, response rate, correlation with backlog.```

```
/goal B1 — SLA CREDITS: FROM "DUE" TO "RECOVERED"  [F2 flagship ROI · §3.8]  REQ: A2
DO: claim lifecycle due → claimed → credited → disputed → written-off, with owner, amounts, dates,
evidence pack export (outages in service hours, archived beyond Meraki window). Arm operator
notification (template + dry-run + approval) and real-time Teams SLA alerts via SDP Cloud.
PROVE: credit computation matches contract terms on fixtures; no duplicate claim; notification
cannot fire unarmed; every state change audited.
VALUE: USD due vs claimed vs RECOVERED per quarter, claim aging.

/goal B2 — ACTION REGISTER: MAKE IT USABLE  [F7 · §3.5]  REQ: A3
DO: export (editor/admin, amounts masked), aging reminders + escalation to site coordinator,
bulk status update, owner reassignment with justification, "my actions" across my sites, feed the
home queue. Keep mandatory justification on cancel.
PROVE: export respects perimeter and masking; reminder dedupe; escalation ladder tested.
VALUE: median action age, % overdue, closure rate.

/goal B3 — PORTFOLIO: SHOW MY PROJECTS, NOT EVERYONE'S  [F5a · §3.12]
DO: canary portfolio_site_scope_reads; default "my projects" filter with explicit "all" for
admin/committee/Finance; add sensitive-project visibility flag; keep global rollups for exec.
PROVE: site editor cannot read out-of-perimeter project via UI or API; committee view unchanged.
VALUE: relevance (projects shown vs actionable), portfolio weekly active users.

/goal B4 — LET SITES MAINTAIN THEIR OWN PLAN  [F5b · §3.12]  REQ: B3
DO: enable portfolio_editor_plan_writes scoped to site projects (tasks, milestones, progress,
risks); "plan updated X days ago" freshness badge; stale-plan nudges; full change audit.
PROVE: cross-site write rejected; committee-only fields protected; baseline untouched by edits.
VALUE: % projects with plan updated <30 days, data freshness at committee.

/goal B5 — ACTUALS & SCOPE CONTROL  [F5c · §3.12]  REQ: B4
DO: enable project team, timesheets (approval workflow) and change requests with schedule/cost
impact simulation BEFORE approval; approved CR creates a versioned baseline.
PROVE: timesheet approval SoD; CR without approval cannot alter baseline; impact math tested.
VALUE: % projects with actuals, scope-change lead time, budget variance.

/goal B6 — VIEWS & ROADMAP PUBLICATION  [F5d · §3.12]  REQ: B4
DO: enable list/board/timeline views and roadmap publication with audience control (site,
programme, committee, exec) and amounts masking per audience.
PROVE: view switching preserves filters/state; published roadmap honours perimeter + masking.
VALUE: roadmap usage in committee, % milestones tracked live.

/goal B7 — ONE EXPORT POLICY, NO ARBITRARY GAPS  [F7 · all modules]
DO: single sensitivity-based export matrix across helpdesk, reports, PV, inspections, actions,
tracker, assets, portfolio, governance. Amounts masked everywhere (Excel/PPT/PDF/API); export
logging + watermark; close incoherences (viewer PV export, action register export).
PROVE: matrix-driven tests per role × module × format; no export bypasses masking.
VALUE: access tickets, audit readiness, time to prepare a site meeting.

/goal B8 — ACTUALS BRIDGE + LOCAL CURRENCY  [F1 ext · §3.7, §5.2]  REQ: A1
DO: Pronto CSV/Excel actuals import (mapping wizard, dry-run validation, reconciliation report,
no write-back) + multi-currency USD/XOF/EUR with dated FX rates and per-user/site display.
PROVE: round-trip import reconciliation; uncertified badge persists until A1 verifier acts;
currency conversion audited and reproducible.
VALUE: manual re-entry hours eliminated, budget accuracy in local currency.

/goal B9 — WEEKLY REPORT: FASTER, MOBILE, MEASURED  [§3.2]  REQ: A2
DO: maximize verified prefill (Meraki + OpManager) with provenance badges (source/timestamp/manual),
never overwrite typed values; mobile-friendly editing; draft autosave; submission nudges;
time-to-complete telemetry.
PROVE: prefill never overwrites manual input; frozen report immutable; server-recomputed asset counts.
VALUE: median completion time, % on-time submissions.```

```
/goal D1 — FLAG REGISTER & ENABLEMENT RUNBOOK
DO: machine-readable flag inventory: name, purpose, owner, risk, dependencies, canary site,
rollback trigger, success metric, decision deadline, expiry. Quarterly review; delete dead flags.
Cover all currently dark items (profiles, queue, blocks, awaiting-me, decision lifecycle, decision
KPIs, portfolio reads/writes/team/timesheets/CR/views/roadmap, green band, SSO, Teams alerts,
operator notification).
PROVE: every dark flag has an owner and a decision date; no flag without rollback path.
VALUE: shipped-but-dark ratio, enablement lead time.

/goal D2 — VALUE SCOREBOARD & ADOPTION TELEMETRY
DO: instrument and display: report on-time % and median completion time; median action age and
% overdue; SLA credits due/claimed/recovered USD; asset coverage and unknown %; repeat-finding
rate; decision cycle time; % plans updated <30d; WAU by role; CSAT. Before/after per flag rollout.
PROVE: unknown ≠ 0 for un-instrumented metrics; perimeter on site-level figures.
VALUE: this IS the ROI proof — quarterly value contract reviewed with the committee.

/goal D3 — BOARD PACK & EXEC VIEW QUALITY  [§3.9]
DO: strengthen the Group IT monthly pack and Exec View: deterministic narrative ("quick analysis",
no AI on production data), trend context, milestone/benefit highlights, clean PPT/PDF; verify the
public Exec View exposes aggregates only and cannot re-identify a single site or ticket.
PROVE: aggregate-only tests (small-cell suppression), link expiry/access review, amounts masking.
VALUE: board prep hours, executive engagement with Exec View.```
