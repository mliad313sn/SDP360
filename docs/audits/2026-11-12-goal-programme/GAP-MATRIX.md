# Goal programme A0–A8 · B1–B9 · D1–D3 — gap matrix (read-only)

- **Head audited:** `c8f1794` (worktree branch `sdp-waves`) · **Date:** 2026-11-12 · **Nature:** READ-ONLY. No code,
  config or test was changed; this file is the only output and is left uncommitted.
- **Source:** `SOURCE-PROMPTS.md` (same folder). The **C-series (PPM parity)** is not re-audited here — see
  `docs/audits/2026-11-12-ppm-parity/` (README + W0-MATRIX-ENGINE + W0-MATRIX-UX-GOV, 141 items, 20 implemented).
- **Vocabulary:** IMPLEMENTED (code + test on the path users take) · **IMPLEMENTED-DARK** (built and tested, but
  behind a `report_config` switch that is OFF by default — users do not see it; turning it on is a human decision) ·
  PARTIAL · STUBBED (UI with fake logic — none found) · MISSING. No evidence ⇒ not IMPLEMENTED.
- **Tests run for this audit** (throwaway PostgreSQL per file, swept afterwards):
  batch 1 — `capability-registry`, `workspace-profiles-grants-nothing.smoke`, `business-only-boundary.smoke`,
  `tracker-month-lock`, `decision-lifecycle`, `portfolio-benefits.smoke`, `home-queue`, `dashboard-shared-sla-rates`,
  `flag-register`, `wan-sla-engine`, `alert-outbound-arm`, `connector-register`, `assets-money-scope.smoke`,
  `audit-report-write-auth.smoke`, `sod-policy` → **123 / 123 pass**.
  batch 2 — see §5 (result recorded at the bottom).
- **In-flight work not to duplicate** (other worktrees): G1-SYNC (sync write fence) · G2-PLATFORM (Express 5,
  dotenv) · G3-UX (admin 320 px, `login_limit_failures_only`, `portfolio_executive_readonly`, team user picker,
  field badge) · G4-CI (e2e fix; `sla_res_den` / `sla_reply_den` in `getCalendarMonthlyHelpdesk`) · W1-ENGINE (PPM
  date CPM) · W1-INTEGRITY (integrity + optimistic concurrency + null-not-zero in `portfolioEvidence` + PPM rollback
  scripts) · W1-EVM (EVM engine). Each is flagged in the rows it touches as **[in-flight: …]**.

---

## 1. Invariants

| # | Invariant | Proving tests (exist today) | Gap |
|---|---|---|---|
| 1 | Site perimeter: editor only his site(s); admin tier all; no-site account nothing site-scoped | `tests/cross-site-read-sweep.smoke.test.js` (live router, every GET with site-B ids), `tests/cross-site-write-sweep.smoke.test.js` (every POST/PUT/PATCH/DELETE of meetings/inspection/reports/sites + read-back), `tests/audit-report-write-auth.smoke.test.js:75` (no-site editor not global), `tests/rbac-write-scope.smoke.test.js`, `tests/multi-site-editor.smoke.test.js`, `tests/portfolio-site-scope.smoke.test.js`, `tests/home-queue-two-sites.smoke.test.js`, `tests/capability-registry.test.js:50` | Write sweep covers only `/api/meetings`, `/api/inspection`, `/api/reports`, `/api/sites` (`cross-site-write-sweep.smoke.test.js:24`) — governance/portfolio/commitments/handoffs/field/duty/tracker writes rely on per-module tests. **Survey verbatims have no site filter at all** (`routes/survey.js` — no `userSites`/`reportUser` use) → invariant 1 not met for CSAT drill-down. Portfolio reads are global until `portfolio_site_scope_reads` = 1 (`services/reportConfig.js:216`) — by design today, but it means invariant 1 is switch-dependent for portfolio. |
| 2 | Amounts only for admin tier + finance-viewer (UI, exports, PPT, Excel, API) | `tests/assets-money-scope.smoke.test.js` (7), `tests/assets-finance-routes.smoke.test.js`, `tests/ppm-baselines.smoke.test.js:111` (deck/workbook), `tests/portfolio-access-parity.smoke.test.js` (8 personas × 4 profiles) | **Deviation:** portfolio money uses `canSeeMoney = isCommittee \|\| finance-viewer` (`routes/governance.js:502`, `isCommittee` = admin tier OR `committee-member`, `:62`) → a `committee-member` without admin sees project amounts. Either the invariant gets a documented exception or the rule changes (human). No cross-module matrix test (role × module × format) — see B7. |
| 3 | Métier-only accounts: every route except Site Awareness → 403 | `tests/business-only-boundary.smoke.test.js` (live router walk, ALLOWED list `services/businessGuard.js:12-16`) | ALLOWED also admits `/reports/auth/*`, `/auth/*`, `/ping`, `/health/version`, `/workspace/(me\|prefs)` — consistent with the intent (session plumbing), but the invariant text says "every route except Site Awareness"; record the plumbing exceptions explicitly. |
| 4 | Absent measure = unknown / "—", never 0 | `tests/dashboard-shared-sla-rates.test.js:45`, `tests/exec-payload-null.test.js`, `tests/pilot-metrics-value.test.js:13`, `tests/health-deps.test.js:8`, `tests/data-quality.test.js:8`, `tests/home-queue.test.js:74`, `tests/stale-source-no-colour.test.js`, `tests/dashboard-widget-truth.test.js` | No global guard; rule is enforced per reader. [in-flight: W1-INTEGRITY null-not-zero in `portfolioEvidence`]. |
| 5 | Submitted reports frozen; closed tracker months frozen (current + previous until the 5th) | `tests/audit-report-write-auth.smoke.test.js:90` (submitted → 403, super_admin may edit), `:202/:215` (reassign policy), `tests/tracker-month-lock.test.js:32-72` | Super_admin can still edit a submitted report and closed months (`tracker-month-lock.test.js:52`) — documented exception; no audit-trail assertion on that override. |
| 6 | Server-side timestamps; SoD (KPI author ≠ approver; super-admin motive / second person) | `tests/meetings-signature-stamp.test.js`, `tests/meeting-stamp-guard.test.js`, `tests/kpi-policy-routes.smoke.test.js:62` (author cannot adopt), `tests/sod-policy.test.js`, `tests/emergency-access.smoke.test.js:47/68`, `tests/audit-report-write-auth.smoke.test.js:157-194` (second-person revert), `tests/portfolio-benefits.smoke.test.js:77` (SELF_REVIEW) | Super-admin edits of submitted reports / closed months carry no motive or second person (see #5). Decision lifecycle has no author≠confirmer check (A5). Timesheets have no approver at all (B5). |
| 7 | Source systems read-only (SDP, Meraki, OpManager); no production data to any AI | `tests/connector-register.test.js:57-95` (every outbound caller registered; no excluded system), `tests/ai-sanitize.test.js`, `tests/ai-proxy-sanitize.smoke.test.js`, `tests/ai-analyze-guard.test.js`; AI default OFF (`server.js:4184`) | **Conflict:** an SDP **write** path exists — field ticket creation `services/sdpApiClient.js:118-121`, dark behind `sdp_api_write_enabled='0'` (`services/reportConfig.js:194`); no test names `WRITE_DISABLED`. No test asserts the AI default is `off`. Meraki/OpManager clients have no "no non-GET verb" test. |
| 8 | Flags = human decision; presentation never grants a right | `tests/workspace-profiles-grants-nothing.smoke.test.js` (4), `tests/flag-register.test.js` (register in sync), `tests/switch-prereqs.test.js:23` (no prerequisite claims an approval), `tests/capability-registry.test.js:97` (zero escalation) | Home blocks / queue have a grants-nothing proof only indirectly (`home-queue-two-sites.smoke.test.js:59`). 195 register rows still "to be named" owner (`docs/ops/FLAG-REGISTER.md`). |

---

## 2. Goals A0–A8

### A0 — Safety net before any enablement

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| DO: route × role × site-scope regression suite generated from the 644-route matrix | PARTIAL | `tests/authz-route-matrix.test.js:54` walks the live router and writes `docs/ops/AUTHZ-MATRIX.md` (644 routes, guard + capability + inline roles + site helpers); zero-escalation `tests/capability-registry.test.js:97`; cross-site sweeps (editor only) | `authz-route-matrix`, `capability-registry`, `cross-site-{read,write}-sweep.smoke` | Matrix asserts *a guard exists*, not the 403/200 outcome per role. Add a generated **probe** suite: every route × {viewer, editor A, editor A+B, no-site editor, admin, executive, finance-viewer, committee-member, business-only, field-tech} × {own site, other site} with expected status from the catalogue. |
| DO: 403 negatives — métier lock | IMPLEMENTED | `services/businessGuard.js:12-17` | `business-only-boundary.smoke` | — |
| DO: 403 negatives — cross-site writes | PARTIAL | sweep limited to 4 prefixes (`cross-site-write-sweep.smoke.test.js:24`) | `cross-site-write-sweep.smoke`, `portfolio-site-scope.smoke` | Extend sweep to governance, portfolio (with switch on), commitments, handoffs, duty, field, tracker, trackers, dashboards annotations. |
| DO: amounts masking in responses/exports | PARTIAL | assets + portfolio covered | `assets-money-scope.smoke`, `portfolio-access-parity.smoke`, `ppm-baselines.smoke:111` | No generic response scanner (money-key detector over every 2xx body for a non-money role). See invariant 2 deviation. |
| DO: frozen-period writes | IMPLEMENTED | report submit freeze + tracker month lock | `audit-report-write-auth.smoke:90`, `tracker-month-lock` | Include in the generated probe suite. |
| DO: capability matrix as machine-readable JSON, diffed per release | MISSING | only Markdown (`docs/ops/AUTHZ-MATRIX.md`); catalogue in code `services/capabilityRegistry.js`; sweep can emit CSV via `SDP_AUTHZ_MATRIX_OUT` (`cross-site-read-sweep.smoke.test.js:9`) | — | Emit `docs/ops/AUTHZ-MATRIX.json` (+ capability catalogue JSON) from the same walk; release workflow diffs it against the previous tag. |
| PROVE: CI gate green | IMPLEMENTED | `npm test` in `.github/workflows/ci.yml:80` | — | — |
| PROVE: every documented rule has ≥1 test | MISSING | no rule→test traceability for RBAC rules (TRACEABILITY.md is goal-level) | — | Rule IDs in the matrix JSON + a test that every rule id is referenced by ≥1 test. |
| PROVE: deliberate rule break fails CI | PARTIAL | zero-escalation test fails on an uncatalogued guard (`capability-registry.test.js:75`); negative control exists only for e2e (`ci.yml:138`) | — | Add an RBAC negative control (mutate one guard in a sandbox copy → suite must fail). |

**Build size:** M · **Human decisions:** none to build; whether `committee-member` money access is an accepted exception (invariant 2).

### A1 — Finance verifier: unblock certified money

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Designated Finance verifier (named role holder + audit) | PARTIAL (benefits only, DARK) | `benefit_money_verifier_role` (`services/reportConfig.js:249`, empty = off); independence check `services/portfolioBenefits.js:76-85` | `portfolio-benefits.smoke:171` | Generalise into a `finance-verifier` role (new feature role in `reports-db` role list + capability `finance.certify`), held by a named person (human). |
| Workflow uncertified → verified (who/when/evidence/source) | PARTIAL (benefits); MISSING (assets) | benefits: `verified_at/verified_by`, evidence link (`portfolioBenefits.js:16-26`); assets: "certified" is an **automatic coverage threshold**, not a human act (`services/moneyCoverage.js:59-77`, `asset_money_certify_min_*` `reportConfig.js:94-96`) | `money-coverage.test.js` | New `finance_certifications` table (scope: asset-finance, licences, investment, depreciation, project-benefit; period; who/when/evidence link/source snapshot hash) + routes + migration (additive). |
| Applies to asset finance, licences, investment, depreciation AND project benefits | MISSING (4 of 5) | only benefits | — | As above. |
| "Non certifié" badge disappears only when certified | PARTIAL — rule differs | badge driven by coverage threshold (`moneyCoverage.js:104-107`), dark behind `asset_money_certify_display='0'`; budget periods say "not certified" permanently (`services/ppmBudgetPeriods.js:14`) | `money-coverage.test.js` | Badge = coverage gate AND a human certification record. |
| PROVE: finance-viewer cannot certify; non-verifier cannot flip | MISSING (assets) / IMPLEMENTED-DARK (benefits) | — | `portfolio-benefits.smoke:171` | Route tests. |
| PROVE: certification in audit log and exports | MISSING | — | — | system_log `finance_certified` + Certification sheet in exports. |

**Build size:** M · **Human decisions:** name the verifier; Finance approval of the certification policy (boundary: "Finance values only certified when real evidence exists").

### A2 — Connector health: make "unknown" actionable

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Page per connector (SDP/Analytics, Meraki, OpManager, SDP Cloud): last success, latency, coverage %, failing scope, plain cause | PARTIAL | `GET /api/sync/health` (last_ok / last_error / skip reason / drift, `routes/sync.js:29`); `GET /api/health/deps` (PG latency, Zoho token, sync vs freshness, no outbound, `routes/health.js:100`); only rendered in `public/system-logs.html`; data-quality board DARK (`ui_data_quality_page` `reportConfig.js:27`, `routes/dataQuality.js:18-20`); register `tests/connector-register.test.js` | `health-deps`, `data-quality(.smoke)`, `sync-routes.smoke`, `sync-skip-semantics` | A `connector-health.html` keyed by the connector register: per connector last success, call latency (recorded by the sync runner — not stored today), coverage % (sites/devices read ÷ expected), failing scope, plain-language cause. |
| Verify OpManager end-to-end until LAN/Wi-Fi/server prefill | PARTIAL | prefill route `GET /api/reports/:id/infra-auto` | `infra-auto-route.smoke:71` (lan fill) | End-to-end needs real OpManager discovery (human, `tools/opmanager/discover.js`). |
| Verify where Meraki config loads at runtime | PARTIAL | config keys `meraki_*` in report_config; runtime source not shown on any page | — | Show resolved source (base / .env / default) as done for Analytics (`services/analyticsSettings.js`). |
| Provision SDP Cloud token or formally disarm dependent feature | IMPLEMENTED (disarmed) | `teams_sla_enabled='0'` (`reportConfig.js:188`), poller refuses unarmed (`tools/teams/poll-sla.js:52`) | `teams-sla-poll`, `teams-sla-routes.smoke` | Token provisioning = human. Record the disarm in the flag register with owner/date (D1). |
| Every "—" clickable fix task with owner | PARTIAL (DARK) | data-quality cells carry a fix link (`tests/data-quality.test.js:18`) | `data-quality.test.js` | Owner per connector (register) + link from every "—" tile to the fix task. |
| PROVE: prefill provenance shown | PARTIAL | tooltip by `basis` (`public/reports.html:3456-3467`), `data_as_of` (`infra-auto-route.smoke:103`) | `infra-auto-route.smoke` | Visible badge, not tooltip only (shared with B9). |
| PROVE: injected connector failure → unknown, never 0 | IMPLEMENTED | sync skip typed (`F-F1-*` ARCH-01), `health-deps` nothing read → unknown | `health-deps.test.js:8`, `sync-skip-semantics` | Add an end-to-end fault-injection test per connector feeding the new page. |

**Build size:** M · **Human decisions:** SDP Cloud OAuth token; OpManager discovery run; connector owners.

### A3 — Home: one queue instead of module hopping

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Enable `ui_home_queue` + `ui_home_blocks` + `mywork_awaiting_me_enabled` on canary | IMPLEMENTED-DARK (enable = human) | `reportConfig.js:20,22,275` | `home-queue-page`, `home-page-blocks` | Canary choice + rollback trigger in register (D1). |
| Queue sources: overdue actions | IMPLEMENTED-DARK | meetings/inspection/report follow-ups (`public/lib/homeQueue.js:2-10,28`) | `home-queue.test.js` | — |
| approvals awaiting me | PARTIAL | awaiting-me covers commitments, handoffs, benefits, decisions, PVs (`homeQueue.js:34`, `services/myWork.js:164`); **access approvals, change-request approvals, timesheets missing** | `home-queue.test.js:74` | Add access-request approvals (`/api/access/approvals`) and CR assessments. |
| report due | PARTIAL | weekly report is a Home *block* (`services/myWork.js:82-87`), not a queue line | — | Queue line when the week's report is not submitted. |
| corrective actions | IMPLEMENTED-DARK | inspection actions | `home-queue.test.js` | — |
| gate sign-offs | MISSING | — | — | Read stage-gate pending sign-offs. |
| RFI | MISSING | — | — | Read own/site RFIs. |
| tracker | MISSING in queue | `trackerEmptyCells` exists as a block (`myWork.js:36`) | — | Queue line for empty current-month cells. |
| governance / portfolio items | PARTIAL | decisions via awaiting-me; portfolio tasks owned by me absent | — | Add my overdue portfolio tasks/milestones. |
| Inline complete / snooze / delegate | MISSING | queue is read + deep-link only | — | Inline status via existing update routes (no new right); snooze = per-user pref; delegate = handoffs. |
| Deep-link to source | IMPLEMENTED-DARK | `homeQueue.js:104-106` (deep link or register fallback) | `home-queue.test.js:41` | — |
| Independent reorderable blocks | PARTIAL | independent load/fail (`home-page-blocks.test.js:51-60`); order only for profile shortcuts (`public/lib/workspaceProfiles.js`) | `home-page-blocks` | Block order in workspace prefs. |
| PROVE: no source omitted | PARTIAL | 5 sources; see gaps above | `home-queue.test.js` | — |
| PROVE: perimeter respected; permissions unchanged | IMPLEMENTED | `home-queue-two-sites.smoke:45-71` | same | — |
| PROVE: load < 1 s | MISSING (measurement exists) | `sdp:first-usable` mark (F-UX-05), `tools/test/perf-baseline.js` | — | Budget assertion in e2e perf baseline. |

**Build size:** M · **Human decisions:** canary site, owner, go/no-go to switch on.

### A4 — 11 workspace profiles + job bundles

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Enable `workspace_profiles_enabled` + settings page | IMPLEMENTED-DARK | `reportConfig.js:280`; `public/workspace-settings.html`; migration `078_user_workspace_prefs.sql` | `workspace-profiles`, `workspace-routes.smoke`, `workspace-mounted.smoke` | Enable = human. |
| Default profile per role | IMPLEMENTED-DARK | `public/lib/workspaceProfiles.js:104` | `workspace-profiles.test.js` | — |
| Access bundles "Site Coordinator", "Committee Member" via request templates | PARTIAL | template mechanism (`db/postgres/reports/057_access_templates.sql`, versioned, published = frozen); **no bundle seeded**; request approval off (`access_require_approval='0'`) | `access-request-lifecycle`, `access-routes.smoke` | Ship two DRAFT templates (seed script, dry run) — publishing is a human act. |
| Profiles change order/display only | IMPLEMENTED | — | `workspace-profiles-grants-nothing.smoke` | — |
| PROVE: switching profile grants zero new route | IMPLEMENTED | `workspace-profiles-grants-nothing.smoke.test.js:45-72` | same | Extend to every profile × role (11) using the generated A0 probe. |
| PROVE: bundles resolve to explicit roles | MISSING | no bundle exists | — | Test: published template payload roles ⊆ known roles; request grants exactly those. |

**Build size:** S · **Human decisions:** enable; publish templates; approver matrix.

### A5 — Decisions that actually move

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Enable `decision_lifecycle_enforced` | IMPLEMENTED-DARK | `reportConfig.js:267`; `services/decisionLifecycle.js:23-29` | `decision-lifecycle.test.js` | Enable = governance chair. |
| Enable `dashboard_decision_kpis_seed` | IMPLEMENTED-DARK | `reportConfig.js:17`, `services/dashboardSeeds.js:99`, `routes/dashboards.js:36-39` (draft only) | `dashboard-store` | NB: this seeds KPIs *that support decisions*, not decision-flow KPIs. |
| State machine with mandatory motive on change | PARTIAL | reason only on cancel / reopen / send-back (`decisionLifecycle.js:16,28`) | `decision-lifecycle.test.js:38` | Motive on every transition (behind the same switch, or a new policy param). |
| Visible pending-approver | PARTIAL | `awaiting_confirmation` state (`decisionLifecycle.js:14-15`) but no named approver shown | — | Show chair/secretary of the cadence; ties to UAT-OI-06. |
| Cycle-time KPI (proposed → adopted) | MISSING | no reader | — | Metric `governance.decision_cycle_days` in `metricRegistry` from `ppm_events`, null when no decision closed. |
| Replace committee hard DELETE with soft-delete + reason + second person | PARTIAL | soft delete exists, DARK (`soft_delete_enabled` `reportConfig.js:334`, `routes/governance.js:207-208`); reason optional (null accepted); **no second person**; decisions have no delete route at all | `soft-delete-portfolio.test.js` | Require reason (min length) + second-person confirmation for portfolio/cadence delete when on. |
| PROVE: transition without motive rejected | PARTIAL | only for the 3 transitions | `decision-lifecycle.test.js:38` | — |
| PROVE: author cannot self-approve | MISSING | no author ≠ confirmer rule on decisions | — | Add SoD: the proposer of `awaiting_confirmation` cannot confirm. |
| PROVE: deleted item recoverable and in audit | IMPLEMENTED-DARK | restore + ledger | `soft-delete-portfolio.test.js:38-82` | — |
| PROVE: KPI reconciles to source records | MISSING | KPI absent | — | Parity test. |

**Build size:** S–M · **Human decisions:** enable lifecycle; choose the two decision KPIs (F-DATA-11 proposal); soft-delete retention owner.

### A6 — One front door (SSO as ergonomics)

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Enable Microsoft SSO | IMPLEMENTED-DARK | `sso_mode` empty (`reportConfig.js:113`), `services/ssoSettings.js`, `services/ssoEntra.js` | `sso-entra`, `sso-db`, `sso-routes.smoke`, `sso-settings`, `sso-login` | Needs a real Entra app registration + secret (human). |
| Map identity to existing users/roles/sites | IMPLEMENTED-DARK | match-and-link, group provisioning (`sso_group_map`) | `sso-login.test.js:28-77`, `sso-provisioning`, `sso-grant-merge` | — |
| Shared Basic-Auth only as logged break-glass | PARTIAL | break-glass login logged as risk (`server.js:5001-5003`); password refused for others only in `only` mode (`server.js:4988`); `DASH_USER/DASH_PASS` still a live account | — | Plan to retire shared account once SSO `only` (human). |
| Coherent "Mon accès", session list, deputy, emergency flows | PARTIAL | `public/access.html`; active sessions card; scoped deputies; emergency access DARK (`emergency_access_enabled` `reportConfig.js:430`) | `emergency-access.smoke`, `scoped-deputies`, `access-routes.smoke` | Single "My access" page linking session list + deputies + emergency (UX only). |
| PROVE: RBAC identical under SSO | PARTIAL | provisioning tests; no "same request, password vs SSO session, same answers" test | — | Run the A0 probe suite with an SSO-minted session. |
| PROVE: break-glass time-boxed and audited | PARTIAL | audited (risk event); **not time-boxed** (break-glass account always usable); emergency grants ≤ 24 h | `emergency-access.smoke:47` | Time-box break-glass session lifetime + mandatory reason. |
| PROVE: no orphan session | PARTIAL | deprovisioning DARK (`entra_deprovision_*`), `entra-deprovision.test.js` | `entra-deprovision` | — |

**Build size:** S (code) · **Human decisions:** Entra registration, tenant admin consent, `SSO_MODE` cutover, break-glass holder.

### A7 — Stop flattering the SLA

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| "Open & breached" count | MISSING | no reader (`grep open_breached` = 0) | — | `getCalendarMonthlyHelpdesk` + browser `periodSlaRates` compute open tickets past due. **[in-flight: G4-CI adds `sla_res_den`/`sla_reply_den` to the same reader — coordinate].** |
| Dual compliance rate (closed-only vs incl. open past target), resolution + first response | MISSING | only closed-only (`dashboard-shared-sla-rates.test.js:27`); `helpdesk_sla_definition` chooses flag vs due-vs-resolved, not the denominator (`reportConfig.js:315-318`) | — | Add `*_incl_open` rates beside existing ones; null when no population. |
| Label closed-only metric explicitly | MISSING | tiles say "Res. SLA OK %" | — | Label + KPI definition text. |
| Align helpdesk tiles, weekly report, scorecard, Exec View on same definition | PARTIAL | definition parity tests exist for flag vs browser | `sla-definition-parity`, `site-fold-sla-definition:133` | Shared definition module consumed by index.html, reportPayload, execSummary, PPTX. |
| PROVE: hand-computed fixture matches both rates | MISSING | — | — | Fixture test. |
| PROVE: no tile mixes definitions | PARTIAL | `sla-definition-parity.test.js` | same | Static test over every consumer. |

**Build size:** M · **Human decisions:** KPI committee picks the headline definition (both shown meanwhile).

### A8 — Voice of the user (CSAT / NPS)

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| CSAT/NPS tiles per site and group from configured survey | PARTIAL | `/api/survey/by-dimension` returns bySite / byGroup / byTech from DB (`routes/survey.js:332-350`); shown on executive.html Customer Voice tab only | `survey-routes.smoke.test.js:73` | Tiles on site report / helpdesk per site + group. |
| Response rate | IMPLEMENTED | server-computed `responseRate`, null when unknown (`routes/survey.js:159-166`) | `survey-routes.smoke:64` | — |
| Trend | PARTIAL | `/api/survey/kpis` | — | Monthly series per site. |
| Verbatim drill-down permission-filtered | **MISSING** | no site filter in any survey route (any session reads every site's verbatims) | — | Filter `/api/survey/voice` + `/:response_id/answers` by `userSites` for non-admin; business-only already blocked. |
| Link to helpdesk volumes | PARTIAL | by-dimension joins request_records | — | Ratio tile. |
| PROVE: no response ≠ 0 | PARTIAL | safe empty shape (`survey-routes.smoke:64`) | same | Assert null rates. |
| PROVE: site perimeter on verbatims | MISSING | — | — | Cross-site test. |
| PROVE: sync failure shows unknown | PARTIAL | sync health covers `survey` job (`freshness.survey_hours`) | — | Tile reads freshness. |

**Build size:** S–M · **Human decisions:** none (data-protection officer may want to review verbatim visibility).

---

## 3. Goals B1–B9

### B1 — SLA credits: from "due" to "recovered" (REQ A2)

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Claim lifecycle due → claimed → credited → disputed → written-off (owner, amounts, dates) | MISSING | engine computes credit due only (`services/wanSla.js:107` `computeCircuitSla`); no claim table | `wan-sla-engine.test.js` | New `wan_sla_claims` table (additive migration) + state machine + routes (super_admin/finance). |
| Evidence pack export (outages in service hours, archived beyond Meraki window) | PARTIAL | `/api/analytics/wan/sla/export.csv|xlsx`, contract evidence (`routes/opmanager.js:514,570,645`); outages persisted in `wan_outages` | `wan-sla-routes.smoke` | Per-claim pack (zip: outage list, contract, calculation, sign-off). |
| Arm operator notification (template + dry-run + approval) | PARTIAL | ISP notify armed-off (`sla_wan_config.notify.enabled`, `tools/meraki/poll-wan-outages.js:185-190`); no dry-run, no approval step | `alert-outbound-arm` | Dry-run preview + second-person approval before arming. |
| Real-time Teams SLA alerts via SDP Cloud | IMPLEMENTED-DARK | `tools/teams/poll-sla.js:46-90`, `teams_sla_enabled='0'` | `teams-sla-*` | Token + channel webhooks (human). |
| PROVE: credit matches contract terms on fixtures | IMPLEMENTED | `tests/wan-sla-engine.test.js`, `_wanSlaFixtures.js` | same | — |
| PROVE: no duplicate claim | MISSING | — | — | Unique (circuit, month). |
| PROVE: notification cannot fire unarmed | IMPLEMENTED | `poll-sla.js:52`, poll-wan-outages:185 | `teams-sla-poll`, `alert-outbound-arm` | — |
| PROVE: every state change audited | MISSING | — | — | ledger rows. |

**Build size:** M · **Human decisions:** Finance owner for claims; ISP contacts; arming notifications; contract evidence (`wan_sla_require_contract_evidence`).

### B2 — Action register: make it usable (REQ A3)

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Export (editor/admin, amounts masked) | PARTIAL | meetings/inspection `export.xlsx` open to editors on own sites (`routes/meetings.js:291`, `routes/inspection.js:317`); client PPTX on registers; **no export of the Site Actions hub / report follow-ups** | `export-share-boundary.smoke` | `GET /api/reports/site-actions/export.xlsx` (perimeter). |
| Aging reminders + escalation to site coordinator | PARTIAL | commitments escalation ladder (`commitment-escalation.test.js`, `commitments_enabled='0'`); schedule reminders for meetings/inspections (`services/scheduleReminders.js`, DARK); no aging reminder for md/insp/report actions | — | Aging job over the three action sources, dedupe key, escalation to coordinator. |
| Bulk status update | MISSING | — | — | Bulk route that loops the existing per-item update (same RBAC, same transfer-status justification). |
| Owner reassignment with justification | MISSING | — | — | Reassign route + audit row. |
| "My actions" across my sites | IMPLEMENTED-DARK | home queue (A3) | `home-queue-two-sites.smoke` | — |
| Feed the home queue | IMPLEMENTED-DARK | `homeQueue.js` | — | — |
| Keep mandatory justification on cancel | IMPLEMENTED | `public/lib/statusTransfer.js`, `/api/reports/action/:uid/status` | `status-transfer.smoke`, `report-action-status.smoke` | Bulk path must reuse it. |
| PROVE: export perimeter + masking | PARTIAL | | `export-share-boundary.smoke` | — |
| PROVE: reminder dedupe; escalation ladder | PARTIAL (commitments only) | | `commitment-escalation` | — |

**Build size:** M · **Human decisions:** escalation owner/ladder; arming reminders.

### B3 — Portfolio: show my projects (REQ none)

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Canary `portfolio_site_scope_reads` | IMPLEMENTED-DARK | `reportConfig.js:216`; `services/portfolioAccess.js` | `portfolio-site-scope.smoke:61-81`, `portfolio-access.test.js:43`, `portfolio-access-parity.smoke` | Enable = human. |
| Default "my projects" filter + explicit "all" for admin/committee/Finance | MISSING | page filters only by scope (`public/portfolio.html:232`) | — | UI filter (no right). [in-flight: G3-UX `portfolio_executive_readonly`] |
| Sensitive-project visibility flag | MISSING | no column | — | `portfolio_projects.sensitive` + rule in `portfolioAccess.canReadProject`. |
| Keep global rollups for exec | IMPLEMENTED | committee reads all (`portfolio-access.test.js:43`) | same | — |
| PROVE: editor cannot read out-of-perimeter project via UI/API | IMPLEMENTED-DARK | | `portfolio-site-scope.smoke:61-73` | — |
| PROVE: committee view unchanged | IMPLEMENTED | | `portfolio-access-parity.smoke` | — |

**Build size:** S · **Human decisions:** enable; who may mark a project sensitive.

### B4 — Let sites maintain their own plan (REQ B3)

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Enable `portfolio_editor_plan_writes` scoped to site projects | IMPLEMENTED-DARK | `reportConfig.js:217` | `portfolio-site-scope.smoke:81-114` | Enable = human. |
| "Plan updated X days ago" badge | MISSING | no reader | — | Derive from `ppm_events` max ts per project. [in-flight: W1-INTEGRITY optimistic concurrency touches the same store] |
| Stale-plan nudges | MISSING | ppm alerts cover slip/blocked (`ppm_alerts_enabled`) not staleness | `ppm-alerts` | Add `stale_plan_days` rule to ppmAlerts. |
| Full change audit | IMPLEMENTED | hash-chained `ppm_events` | `ppm-project-lifecycle.smoke` | — |
| PROVE: cross-site write rejected | IMPLEMENTED-DARK | | `portfolio-site-scope.smoke:81-97` | — |
| PROVE: committee-only fields protected | IMPLEMENTED-DARK | | `portfolio-site-scope.smoke:104` | — |
| PROVE: baseline untouched by edits | IMPLEMENTED-DARK | `ppm_baseline_versions` | `ppm-baselines.smoke:75` ("ordinary edit still frozen") | — |

**Build size:** S · **Human decisions:** enable; staleness threshold.

### B5 — Actuals & scope control (REQ B4)

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Project team | IMPLEMENTED-DARK | `ppm_project_team_enabled` (`reportConfig.js:346`), `ppm_project_members` | `ppm-w2.smoke`, `pg-ppm-w2-store` | [in-flight: G3-UX team user picker] |
| Timesheets with approval workflow | PARTIAL | entries stored (`services/ppmWorkbenchStore.js:54-77`), **no submit/approve states** | `ppm-w2.smoke` | Week submission → approve/reject by a person ≠ entrant. |
| Change requests with schedule/cost impact simulation BEFORE approval | PARTIAL | CR lifecycle with SoD (`services/ppmWorkbench.js:52-59`); impact = **typed numbers**, not simulated (`ppmWorkbench.js:63-77`) | `ppm-w2.smoke` | Simulation needs the date engine. **[in-flight: W1-ENGINE CPM, W1-EVM]** — build after they land. |
| Approved CR creates versioned baseline | PARTIAL | apply with dates impact → `gov.rebaseline` (`ppmWorkbenchStore.js:104-118`) when rebaseline enabled; budget impact not baselined | `ppm-baselines.smoke` | — |
| PROVE: timesheet approval SoD | MISSING | | — | — |
| PROVE: CR without approval cannot alter baseline | IMPLEMENTED-DARK | `apply: { from: ['approved'] }` | `ppm-w2.smoke` | — |
| PROVE: impact math tested | MISSING | no math | — | After W1-ENGINE. |

**Build size:** M (after W1) · **Human decisions:** enable three switches; timesheet approver policy.

### B6 — Views & roadmap publication (REQ B4)

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| List / board / timeline views | IMPLEMENTED-DARK | `portfolio_views_enabled` (`reportConfig.js:355`), `public/lib/portfolioViews.js` | `portfolio-views.test.js` | — |
| Roadmap publication with audience control (site, programme, committee, exec) | MISSING | `roadmap_publication_enabled` (`reportConfig.js:359`) is a **Roadmap-Manager → portfolio migration** with duplicate check (`services/roadmapPublication.js`), not an audience-scoped publication | — | Published roadmap snapshot with audience + share-link expiry (reuse engagement share). |
| Amounts masking per audience | MISSING | | — | — |
| PROVE: view switching preserves filters/state | IMPLEMENTED-DARK | `?view=` kept with other keys | `portfolio-views.test.js:12-33` | — |
| PROVE: published roadmap honours perimeter + masking | MISSING | | — | — |

**Build size:** M · **Human decisions:** audiences; publication owner.

### B7 — One export policy

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Single sensitivity-based export matrix across 9 modules | MISSING | rules scattered per route | `export-share-boundary.smoke` (anon / dash-key / business-only refused on every export route) | `services/exportPolicy.js` (module × format × role → allow / mask / deny) consulted by every export route. |
| Amounts masked everywhere (Excel/PPT/PDF/API) | PARTIAL | assets, portfolio | `assets-money-scope.smoke`, `ppm-baselines.smoke:111` | Route-by-route via the policy. |
| Export logging | PARTIAL | only `asset_export` (`server.js:1823`) | `assets-usage-log.smoke` | Log every export (category `export`). |
| Watermark | MISSING | — | — | User + timestamp footer / sheet header. |
| Close incoherences (viewer PV export, action register export) | MISSING | — | — | Decide per policy row (human for the policy). |
| PROVE: matrix-driven tests per role × module × format | MISSING | | — | Generated from the policy. |

**Build size:** M–L · **Human decisions:** the sensitivity matrix itself (data owner / security).

### B8 — Actuals bridge + local currency (REQ A1)

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Pronto CSV/Excel import (mapping wizard, dry-run, reconciliation, no write-back) | MISSING | none | — | FILE import only (boundary: no live Pronto connector). Reuse `meetings-import.js` preview/commit pattern. |
| Multi-currency USD/XOF/EUR | PARTIAL | per-site currency + rates proposed, DARK (`services/currency.js`, `asset_site_currency`, `asset_currency_rates` `reportConfig.js:103`); project amounts carry currency (`finance_currency_required` `:254`) | `currency.test.js`, `portfolio-finance-currency.smoke` | — |
| Dated FX rates | MISSING | single rate per currency, no effective date | — | `fx_rates(currency, effective_from, rate, source)` additive. |
| Per-user / site display currency | MISSING | | — | Workspace pref. |
| PROVE: round-trip import reconciliation | MISSING | | — | — |
| PROVE: uncertified badge persists until A1 verifier acts | MISSING | depends on A1 | — | — |
| PROVE: conversion audited and reproducible | MISSING | | — | Store rate id with each converted figure. |

**Build size:** L · **Human decisions:** Finance supplies the Pronto export layout + rate source; certification (A1).

### B9 — Weekly report: faster, mobile, measured (REQ A2)

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Maximise verified prefill (Meraki + OpManager) with provenance badges | PARTIAL | `maybeAutoFillInfra` fills empty cells (`public/reports.html:3061,3483`); provenance as tooltip/basis (`:3456-3467`) | `infra-auto-route.smoke` | Visible badge source/timestamp/manual per cell, persisted with the KPI row. |
| Never overwrite typed values | IMPLEMENTED (no test) | empty-cell-only rule in `maybeAutoFillInfra` | **none** | Add a DOM test (typed value survives fill). |
| Mobile-friendly editing | PARTIAL | `reports.html` fixed at 390/320 (F-UX-04) | e2e viewport matrix | — |
| Draft autosave | IMPLEMENTED | 1.5 s autosave + row lock | `pg-reports-reports` (parallel save) | — |
| Submission nudges | MISSING | reminders cover meetings/inspections only | — | Weekly-report reminder rule in `scheduleReminders`. |
| Time-to-complete telemetry | PARTIAL | manual stopwatch sheet (`docs/ops/pilot/WEEKLY-REPORT-STOPWATCH.csv`); `ux_event_telemetry` DARK (`reportConfig.js:19`) | `pilot-metrics-value:26` | first-edit → submit duration from audit_log. |
| PROVE: prefill never overwrites manual input | MISSING (test) | | — | as above. |
| PROVE: frozen report immutable | IMPLEMENTED | | `audit-report-write-auth.smoke:90` | — |
| PROVE: server-recomputed asset counts | IMPLEMENTED | freeze on first submit | `asset-review-routes.smoke`, `asset-review-status.smoke` | — |

**Build size:** S–M · **Human decisions:** arm nudges.

---

## 4. Goals D1–D3

### D1 — Flag register & enablement runbook

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Machine-readable inventory | PARTIAL | generated Markdown `docs/ops/FLAG-REGISTER.md` (233 keys + 37 policies + 62 env), `tools/agent/flag-register.js` | `flag-register.test.js` | Emit JSON alongside. |
| name, purpose, owner, default, prerequisites, reference | IMPLEMENTED | | `flag-register.test.js:22` | — |
| risk, dependencies, canary site, rollback trigger, success metric, decision deadline, expiry | MISSING | not in the register; PILOT-PROFILE has no canary/deadline | — | Hand-maintained sidecar `docs/ops/flag-decisions.json` merged by the generator; test that every DARK switch has all fields. |
| Quarterly review; delete dead flags | MISSING | | — | `--stale` report (expiry passed). |
| Cover all dark items (profiles, queue, blocks, awaiting-me, decision lifecycle/KPIs, portfolio reads/writes/team/timesheets/CR/views/roadmap, green band, SSO, Teams alerts, operator notification) | PARTIAL | all present as keys **except "green band"** (tracker RAG ≥ 90 % is a frozen *commit*, not a switch — CLAUDE.md "ONE exception"; no key) and **operator notification** (nested `sla_wan_config.notify.enabled`, not its own row) | — | Add pseudo-rows for frozen lots and nested arms. |
| PROVE: every dark flag has an owner and decision date | MISSING | 195 rows "to be named" | — | Owners/dates = human; test = completeness check. |
| PROVE: no flag without rollback path | IMPLEMENTED (generic) | rollback by source in register header | `flag-register.test.js` | Per-flag rollback trigger. |

**Build size:** S · **Human decisions:** every owner, canary site, deadline (the agent must not invent them).

### D2 — Value scoreboard & adoption telemetry

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Instrument + display the listed metrics | PARTIAL | offline CLI `tools/pilot/*`, `services/pilotMetrics.js:466-472` (value table rows), page usage `/api/ux/page-usage` (super_admin, `routes/pageUsage.js:78`); **no in-app scoreboard** | `pilot-metrics-value`, `adoption-report`, `page-states-adoption` | `value-scoreboard.html` (admin) reading the same pure builders. |
| report on-time % / median completion time | PARTIAL / MISSING | status data exists; completion time manual | — | — |
| median action age, % overdue | PARTIAL | site actions register computes age (`siteActionsRegister`) | `site-actions-register` | Aggregate. |
| SLA credits due/claimed/recovered USD | MISSING | needs B1 | — | — |
| asset coverage and unknown % | IMPLEMENTED | `tools/pg/asset-engagement-kpis.js`, moneyCoverage | `money-coverage` | Surface. |
| repeat-finding rate | IMPLEMENTED-DARK | `insp_repeat_findings` (`reportConfig.js:469`) | inspection tests | — |
| decision cycle time | MISSING | A5 | — | — |
| % plans updated < 30 d | MISSING | B4 | — | — |
| WAU by role | PARTIAL | `page_viewed` always-on (one row/user/page/day) | `adoption-report` | WAU aggregation by role tier. |
| CSAT | PARTIAL | A8 | — | — |
| Before/after per flag rollout | MISSING | | — | Snapshot at switch flip (system_log `config` change) + compare. |
| PROVE: unknown ≠ 0 for un-instrumented metrics | IMPLEMENTED | | `pilot-metrics-value:13` | — |
| PROVE: perimeter on site-level figures | MISSING | CLI is admin-only, no per-site perimeter | — | — |

**Build size:** M · **Human decisions:** value contract with committee; real users for adoption (E09).

### D3 — Board pack & Exec View quality

| Clause | Status | Evidence | Test ref | Fix needed |
|---|---|---|---|---|
| Deterministic narrative, no AI on production data | IMPLEMENTED | Analyze (Quick) / `analyze-lite.js`; `AI_PROVIDER` default `off` (`server.js:4184-4187`) | `ai-analyze-guard`, `exec-deck-payload` | Test that asserts the default is `off`. |
| Trend context | IMPLEMENTED | exec deck MoM deltas, null-aware (F-DATA-06) | `exec-payload-null`, `exec-summary-windows` | — |
| Milestone / benefit highlights | PARTIAL | portfolio deck (`services/portfolioDeck.js`) separate from Group IT pack | `portfolio-deck` | Add a portfolio slide to the monthly pack (money masked per audience). |
| Clean PPT/PDF | IMPLEMENTED | golden fingerprints | `pptx-monthly-golden`, `exec-pptx-python` | — |
| Public Exec View exposes aggregates only, cannot re-identify a site or ticket | **CONFLICT / MISSING** | exec view **names sites needing attention by design** (`services/execSummary.js:8` `deriveSiteStatus`) and shows MI detail (`exec_view_mi_detail='full'`, `reportConfig.js:33`) | `exec-summary.test.js:70` (anti-PII key whitelist only) | Small-cell suppression (min n) + `exec_view_mi_detail='summary'` option exists? — needs owner decision; the goal contradicts the shipped v1 design. |
| PROVE: small-cell suppression | MISSING | | — | — |
| PROVE: link expiry / access review | PARTIAL | share links expire (`routes/engagement.js:13,99`); exec-view URL is permanent public | `export-share-boundary.smoke` (expired token 404) | — |
| PROVE: amounts masking | IMPLEMENTED (no amounts in exec view) | whitelist assembler | `exec-summary.test.js:70` | — |

**Build size:** S–M · **Human decisions:** whether the public Exec View may keep naming sites (reverses Exec View v1).

---

## 5. Human decisions & boundary conflicts (consolidated)

- **Enablement is never code:** every IMPLEMENTED-DARK row (A3, A4, A5, A6, B3, B4, B5, B6, B1 Teams) needs a named owner,
  canary site and rollback trigger. Code can only be made *ready*; defaults stay OFF.
- **SSO (A6):** real Entra app registration, client secret, admin consent, cutover — human.
- **SDP Cloud token (A2/B1):** OAuth client + refresh token — human; otherwise keep `teams_sla_enabled='0'`.
- **Finance verifier (A1/B8):** a named person; certification policy approved by Finance — never invented.
- **B8 Pronto:** a CSV/Excel **file** import is allowed; a live Pronto connector is forbidden
  (`.claude/rules/SDP360_BOUNDARIES.md`).
- **Notifications (B1/B2/B9/Teams):** must not fire unarmed; arming = human; dry-run first.
- **Invariant 7 vs code:** SDP write path for field tickets (`services/sdpApiClient.js:118-121`, dark) — keep off
  unless CAB approves; add a test pinning `WRITE_DISABLED`.
- **Invariant 2 vs code:** `committee-member` reads portfolio amounts (`routes/governance.js:502`).
- **D3 vs Exec View v1:** public page names sites + MI detail.
- **D1 "green band":** tracker RAG ≥ 90 % is a frozen commit behind the deploy marker, not a switch.
- **UAT open issues** relevant here: UAT-OI-05 (executive writes portfolio) [in-flight G3-UX], UAT-OI-06 (no chair
  → nobody can record a decision; A5), UAT-OI-08 (team identity; B5) [in-flight G3-UX picker], UAT-OI-02 [in-flight
  G3-UX], UAT-OI-03 [in-flight G3-UX].

## 6. Recommended bundling (low file overlap between parallel bundles)

| Bundle | Goals | Main files touched | Avoid (owned elsewhere) |
|---|---|---|---|
| **P1 — RBAC safety net** | A0, invariant tests (#2 money scanner, #7 SDP write pin, AI default) | new `tests/authz-probe-matrix.smoke.test.js` (generated), `tools/agent/authz-walk.js`, `tests/authz-route-matrix.test.js` (JSON emit), new `docs/ops/AUTHZ-MATRIX.json`, `.github/workflows/release.yml` (diff step), `tests/cross-site-write-sweep.smoke.test.js` (prefixes) | no product code — run first; every other bundle reuses its probe |
| **P2 — Finance & money** | A1, B8 (file import + dated FX), B7 money part | new `services/financeCertification.js`, `services/financeCertStore.js`, migration `db/postgres/reports/0xx_finance_certifications.sql` + `0xx_fx_rates.sql`, `services/moneyCoverage.js`, `services/currency.js`, new `services/actualsImport.js` + `routes/actualsImport.js`, `public/assets.html` (badge), `services/capabilityRegistry.js` (one entry) | `portfolioEvidence` (W1-INTEGRITY), `governanceStore` |
| **P3 — Helpdesk truth & voice** | A7, A8 | `public/lib/dashboard-shared.js` (`periodSlaRates`), `public/index.html`, `services/reportPayload.js`, `services/execSummary.js` (SLA only), `routes/survey.js` (perimeter), `reports-db.js` survey readers | **coordinate with G4-CI on `getCalendarMonthlyHelpdesk`** (same function) — land after G4-CI |
| **P4 — Connectors & weekly report** | A2, B9 | new `public/connector-health.html` + `routes/connectorHealth.js`, `services/sync/syncRunner.js` (latency field), `services/healthDeps.js`, `public/reports.html` (provenance badge, autofill test hook), `services/scheduleReminders.js` (weekly nudge) | `services/sync/*` write path (G1-SYNC) — touch only telemetry fields, rebase after G1 |
| **P5 — Home & actions** | A3 (missing sources, inline actions), A4 bundles, B2 | `public/lib/homeQueue.js`, `routes/myWork.js`, `services/myWork.js`, `routes/siteActions.js` (export, bulk, reassign), `services/siteActionsRegister.js`, new `tools/access/seed-bundles.js` | `public/home-page*.js` shared with G3-UX field badge — confirm |
| **P6 — Governance decisions** | A5, A6 UX ("My access") | `services/decisionLifecycle.js`, `routes/governance.js` (decision PUT + delete reason/second person), `services/softDelete.js`, `services/metricRegistry.js` (cycle-time), `public/cockpit.html`, `public/access.html` | `routes/governance.js` portfolio section (B-bundle) — split by region; G3-UX `portfolio_executive_readonly` also edits `routes/governance.js` → serialize |
| **P7 — Portfolio chain** | B3 (sensitive + my-projects), B4 (freshness, nudge), B5 (timesheet approval, CR simulation), B6 (audience publication) | `services/portfolioAccess.js`, `public/portfolio.html`, `public/project.html`, `services/ppmWorkbench*.js`, `services/ppmAlerts.js`, `services/roadmapPublication.js`, migrations | **wait for W1-ENGINE / W1-INTEGRITY / W1-EVM** (same stores, schedule engine) and G3-UX team picker |
| **P8 — SLA credits** | B1 | new `services/wanSlaClaims.js` + store + migration, `routes/opmanager.js` (claims routes), `public/wan-sla.html`, `tools/meraki/poll-wan-outages.js` (dry-run/approval) | — |
| **P9 — Exports policy** | B7 | new `services/exportPolicy.js`, each export route (meetings/inspection/reports/assets/governance/tracker) one-line hook | overlaps P5/P2 route files — run after them |
| **P10 — Sustain & prove** | D1, D2, D3 | `tools/agent/flag-register.js` + `docs/ops/flag-decisions.json`, new `public/value-scoreboard.html` + `routes/valueScoreboard.js`, `services/pilotMetrics.js`, `services/execSummary.js` (suppression) | `services/execSummary.js` shared with P3 — serialize P3→P10 |

Parallel-safe set: **P1, P2, P4, P8** together; then **P3** (after G4-CI), **P5**, **P6**; then **P7** (after W1-*),
**P9**, **P10**.

## 7. Test results (batch 2)

Batch 2 — `cross-site-write-sweep.smoke`, `cross-site-read-sweep.smoke`, `portfolio-site-scope.smoke`,
`export-share-boundary.smoke`, `sso-routes.smoke`, `emergency-access.smoke`, `money-coverage`,
`sla-definition-parity`, `home-queue-two-sites.smoke`, `data-quality.smoke`, `ppm-w2.smoke`, `ppm-baselines.smoke`,
`soft-delete-portfolio`, `exec-summary`, `pilot-metrics-value` → **82 / 82 pass**. Throwaway databases swept with
`tools/test/drop-test-dbs.js`. Total evidence run: **205 / 205 pass** — i.e. what exists is green; the gaps above are
absences, not failures.
