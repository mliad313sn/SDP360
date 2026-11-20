# P11 qualification — Security seat — ROUND 5

**AI review — not an independent human review.** Reviewer seat: security. I did not write this code and did not modify it. No push, merge, tag, live system or human decision field was touched. Nothing here approves, signs or declares anything production-ready.

- Frozen SHA: `3ee4dd23cbe661488f3f693a302358fb62eba6a0` (clone `/home/user/qual/security`, `git rev-parse HEAD` checked; only the intentionally removed `docs/agent-execution/` narratives differ, not read). Gate dossiers / docs/ops / docs/business-readiness read where needed.
- Previous rounds unchanged: `security.md` (R1), `r2-security.md`, `r3-security.md`, `r4-security.md` (R4 at e43d11d5).
- Raw logs: `/home/user/qual/out/sec-logs/r5-outcomes.log`, `r5-batch.log`, `r5-probe.log`, `r5-takeover.log`. Throwaway probes: `/tmp/claude-0/p11attack-r5/tests/r5-probe.test.js`, `r5-takeover.test.js` (copied into the clone only for the run, deleted afterwards, never committed). Test databases are the per-file throwaway DBs created by `tests/_pg-boot.mjs` for my own runs only.
- Env: shared PG 17 (max_connections 400), `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, node_modules symlinked from `/home/user/SDP360`.

## 0. Round-4 findings — fixed or not (repro re-run at 3ee4dd23)

| R4 item | Trunk claim | Re-test (r5-probe.log) | Verdict |
|---|---|---|---|
| **N-R4-1 (P2)** Policy Center four-eyes advisory: reset to weak default alone; legacy `PUT /api/reports/config` | fix 14 (`95780319`): `strict_value`/`strict_direction` per key, `needsSecondPerson` (`services/policyCatalogue.js:236-245`), legacy PUT 409 while center on (`routes/adminConfig.js:115-124`), `policy_center_enabled` itself four-eyes | super1 hardens `dashkey_scope_mode` → **200 applied** (towards strict, by design); super1 alone `reset:true` → **202 pending pc-1**, value stays `restrict`; legacy PUT `{export_policy_strict, ui_inject_dash_key}` → **409 CONFLICT**; super1 sets `policy_center_enabled=0` → **202 pending** | **PARTIAL.** Both R4 doors closed. Two new single-person paths found → N-R5-1 (Teams SLA card) and N-R5-2 (password-reset takeover of the "independent" approver). With the center **off**, the legacy PUT still writes every four-eyes key alone (documented "center off = today"). |
| **N-R4-2 (P2)** center reads open to admin tier | fix 14: center reads `requireSuperAdmin` (`routes/policyCenter.js:99,118,144,205`) | admin (non-super): catalogue, export csv, requests, rule history → **403** each, break-glass name not in any body | **FIXED.** Note: `GET /policy-center.html` answers 200 to admin (page shell only, `auth.js` gate client-side; no data) — cosmetic. |
| **N-R4-3 (P3)** Latin confusables | fix 14 | `ɑlice`, `ᴀlice`, `alıce`, `aⅼice`, `ⓐlice`, `𝐚lice`, Cyrillic, ZWSP, double space → `isSelf` **true** | **FIXED.** (`al1ce`/`a1ice` → false: digit substitution, not a Unicode confusable — out of scope, P3 at most.) |
| **N-R4-4 (P3)** hostile-input 500s | fix 14 | `/api/kpi-policies/1/diff`, `/abc/diff` → 400; `/api/trackers/1/rollback/ZZZ` → 400; `DELETE /api/governance/portfolio/ZZZ/1` → 400; `PUT /api/reports/schedule {}` → 400; `/api/reports/abc` → 404. Outcome-probe log: no 500 left except connector-absent ones (`/api/data/*`, `/api/survey/list`, `/api/orgs`… "Zoho Analytics credentials missing" — environment, same as R4) | **FIXED.** |
| **R2-N3 (P3 residual)** field existence oracle | fix 18 F-11 (actions) | **actions**: unknown id → 403 `action_unavailable`, same text as foreign id → fixed. **inspections**: foreign existing id → **409** "this inspection id is already used on the server"; unused id → **200 applied** | **PARTIAL** (unchanged for inspection ids; low value, date-prefixed ids). |
| R1-F2 (P1 policy) committee reads portfolio amounts | not claimed | `KNOWN_OUTCOME_MONEY` still present (`tests/_rbac-matrix-core.js:480`) | **NOT FIXED — human decision pending** (Finance + InfoSec; HD register row) |
| R1-F3 (P2) dash key injected / scope open | not claimed | defaults unchanged `services/reportConfig.js:609` (`dashkey_scope_mode:'open'`, `ui_inject_dash_key:'1'`); now proposed in `docs/business-readiness/REGISTRE-DECISIONS-HUMAINES.md` HD-S05 | **NOT FIXED** (human decision HD-S05 / D-15, blank) |
| R1-F4 (P2) CSP strict on few pages | partial | `STRICT_PAGES` = 6 (`services/sessionAuth.js:23`; +3 new Lot 3/4/6 pages) | **NOT FIXED** (progress: every new page strict) |
| R1-F5 (P2) money sentinels partial | not claimed | `MONEY_SENTINELS` unchanged (`:476`); the outcome probe does not switch on the new lot switches (`AUTHZ_SWITCHES` `:707-717` has no `ppm_portfolio_dashboard_v2_enabled`, `ppm_documents_enabled`, …), so Lots 2-6 money paths are covered only by their own smoke tests and my probes (§2) | **NOT FIXED** |

## 1. Evidence re-run at 3ee4dd23 (command · result)

Prefix: `NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | `tests/authz-outcomes.smoke.test.js` | **5/5 pass**, 5 m 10 s, exit 0; residual 500s are connector-absent only (§0) | VERIFIED |
| E2 | authz-handler-checks, authz-matrix-json, authz-route-matrix, csp-candidate-pages.smoke, csp-headers.smoke, csp-journey-report, csp-no-inline-handlers-new-pages, csp-report.smoke, csp-strict-pages-config, rbac-external-writes, rbac-matrix.smoke, rbac-mutation.smoke, rbac-scope-frozen.smoke, rbac-ui-gates, rbac-write-scope.smoke, secret-scan, session-security.smoke + fix/lot tests policy-center-four-eyes-bypass.smoke, policy-center-four-eyes-direction, policy-center-routes.smoke, policy-center-catalogue, policy-center-packaged, portfolio-lot5.smoke, portfolio-phase2.smoke, teams-sla-routes.smoke, field-inspection-action-status.smoke (26 files, one run) | **164/164 pass**, 0 skip, 94 s, exit 0 | VERIFIED |
| E3 | `node tools/security/secret-scan.js --check` | "no credential in the tracked files", exit 0 | VERIFIED |
| E4 | `node tools/security/csp-journey-report.js --check` | up to date, exit 0 | VERIFIED |
| E5 | `node tools/security/retention-inventory.js --check` | up to date, exit 0 | VERIFIED |
| E6 | `npm audit --omit=dev` | found 0 vulnerabilities (registry state 2026-11-20) | VERIFIED |
| E7 | R4 repros + new attacks: `r5-probe` 10 tests, `r5-takeover` 1 test | executed, exit 0 (findings are in the logged values, not in assertions) | VERIFIED |
| E8 | `tools/security/authz-divergence-report.js` (needs `PG_URL` in `.env`, not present in the clone), `dashkey-consumers.js` (no `--check`) | not run | NOT VERIFIED |
| E9 | access-revocation, dashkey-only-routes, export-share-boundary, SSO/Entra, route-authz suites (not assigned) | not run | NOT VERIFIED |

**7 verified, 2 not verified.** No full suite (not assigned).

## 2. New claims I tried to break (none repeat an earlier attack)

| Capability | Claim | Attack | Outcome |
|---|---|---|---|
| Policy Center four-eyes | "while the center is on, a four-eyes rule changes only through its request flow" (`routes/adminConfig.js:115`) | super1 `PUT /api/teams-sla/settings {enabled:true}` (`teams_sla_enabled` is four-eyes, strict `'0'`) | **200, `teams_sla_enabled` 0 → 1, no request** → N-R5-1 |
| Policy Center approver independence (fix 14 cont. `4053e8ca`, R4-A2(b)) | "the approver must be independent of the requester (identity journal)" | super1 files relax request pc-1 (`dashkey_scope_mode` → open); super1 `PUT /api/reports/users/<super2> {password}`; logs in as super2; approves | **200 approved, value `open`.** Journal shows `password_reset` + `user_updated` by super1 — not read by `approverProvenance` → N-R5-2 |
| Lot 5 review workflow self-approval (fail closed) | "a decision out of approval is refused to the requester … or a decider not independent of the requester" | (a) committee c1 submits then approves → **409 SELF_APPROVAL** (holds); (b) super1 submits project, resets committee c2's password, approves as c2 | (a) holds; (b) **200** — same root cause, N-R5-2 |
| Lot 5 business-case freeze | "approved business-case fields change only with an approved change request of this project, named in the write" | CR "+100 USD, one licence" authored by c1, assessed + approved by c2 (SoD holds); c1 then edits budget 1000 → 1100 (CR), → **999 999 + new charter (same CR)**, → **5 (same CR)** | all **200**; one CR unlocks unlimited, unrelated edits forever → N-R5-3 |
| Lot 3 register money-safe filters | "money filters are ignored / not echoed for a money-hidden reader" | editor (site A): `?budget=identified`, `?report=unfunded`, `?sort=budget&dir=desc`, `?budget_status=approved`, `?cols=budget,currency,budget_status`; CSV with money cols | same 3 rows, same order, no `budget` key, money cols dropped from `cols` and CSV — **holds** |
| Lot 6 documents | money documents downloadable by amount readers only; upload type-checked | editor uploads `vendor_quotation` → 403; committee → 200; editor list shows it `restricted`; editor download → 403; HTML upload → 415; doc id via another project → 404; `application/pdf;x=1` + PDF magic + HTML tail → 200 but served `attachment` + `nosniff` + declared mime | **holds** (no malware scan — documented operator decision) |
| Lot 6 dependencies | "a predecessor the reader cannot read is shown as 'another project' (no name)" | c1 links site-A project ← site-B project; editor (site A, cannot read B: 404) reads A's dependencies | label null, `predecessor_readable:false`, but **`predecessor_project_id: 4` exposed** → N-R5-4 (P3) |
| Lot 6 external API portfolio | switch + `portfolio:read` scope, non-sensitive only, no money/names | code review `routes/extApi.js:105-136`, `extProjects` filters `sensitive IS DISTINCT FROM 1`; covered by `portfolio-phase2.smoke` (passed in E2) | holds (by reading + their test) |
| Lot 4 alerts promote / decision record | committee only, readable projects only | code review `routes/governanceDecisionAgenda.js` (promote matches only active alerts over `viewFor`; record checks readable project) | holds by reading |
| Adoption Lot B | UI-only switches; data still server-scoped | code review `services/uiPolicy.js`, `/api/connector-health` admin tier | holds by reading |

## 3. Findings (round 5)

### P0 — none.

### P1 — none open in code. R1-F2 stays a **policy** blocker (human decision).

### P2

**N-R5-1 (P2) — Teams SLA admin card arms a four-eyes outbound switch alone while the Policy Center is on.**
- Where: `routes/teamsSla.js:46-53` (`if ('enabled' in b) patch.teams_sla_enabled = …` → `reportConfig.setConfig` at `:100`); `teams_sla_enabled` is `four_eyes` with `strict_value '0'` in `docs/ops/policy-catalogue.json`. Fix 14 guarded only `PUT /api/reports/config`.
- Repro (`r5-probe` test 1): `policy_center_enabled='1'`; super1 `PUT /api/teams-sla/settings {"enabled":true}` → **200 `{"ok":true}`**, `report_config.teams_sla_enabled` `0 → 1`. Same key through the center would need a second super_admin.
- Regression test to add: for every route that calls `reportConfig.setConfig` (`grep -rn "setConfig(" routes/`), any changed four-eyes key while the center is on answers 409/202; a static test listing writers of four-eyes keys outside `routes/policyCenter.js`.
- Fix direction (not applied): share the adminConfig four-eyes filter as a helper (`services/policyCatalogue` `refuseFourEyes(cur, patch)`) and call it in `routes/teamsSla.js`; or drop `teams_sla_enabled` from the card. Rollback risk low.

**N-R5-2 (P2) — Approver "independence" is defeated by a password reset: one super_admin approves their own four-eyes request (Policy Center) or their own project decision (Lot 5 review) with a second person's account.**
- Where: `services/approverProvenance.js:12-13,19-21` reads only `user_created` / `user_role_changed`; `routes/adminUsers.js:134-151` lets any super_admin set another user's password (journal `password_reset`, `user_updated`); `reports-db.js` `_updateUserPg` does not revoke the target's sessions (see N-R5-5), so the real owner is not even logged out.
- Repro (`r5-takeover.log`): super1 hardens `dashkey_scope_mode`, then requests reset → 202 pc-1; super1 `PUT /api/reports/users/<super2-id> {"full_name":"r5-super2","password":"…"}` → 200; login as super2; `POST /api/policy-center/requests/pc-1/approve` → **200 approved**, `dashkey_scope_mode=open`. Same pattern on Lot 5: super1 submits project to approval, resets committee member c2's password, `POST …/stage {to:'in_progress'}` as c2 → **200** (`r5-probe` test 8). super2's pre-existing session still answers 200 after the reset.
- Why P2: super_admin only (≈2 accounts), fully journalled, both switches default off, and the pilot plan keeps `policy_center_enabled` off (`docs/business-readiness/PLAN-PILOTE.md:18,60`). It is the direct answer to human decision **HD-S04** ("can we rely on the center's double control after fixes 14 and 17?"): **not yet** — becomes **P1** the day InfoSec accepts four-eyes as a compensating control.
- Regression test: an approver whose password, e-mail, SSO link (`entra_oid`) or break-glass state was changed by the requester inside the cooling-off window is refused (`APPROVER_NOT_INDEPENDENT`); same for the review workflow and gate sign-off.
- Fix direction: treat `password_reset` / `user_updated` (credential or identity fields) by the requester as non-independence in `checkIndependent`; revoke target sessions on admin reset; optionally force a self-chosen password at next login. Rollback risk low (refuses more).

**N-R5-3 (P2) — Business-case freeze: one approved change request unlocks every later frozen-field edit, of any size, forever.**
- Where: `services/ppm/reviewWorkflow.js:98-104` `freezeRefusal` checks only `cr.project_id === projectId && status ∈ {approved, applied}`; the CR's `impact_budget`, its scope, and whether it was already used are ignored; `services/governanceStore.js:723-731` never consumes or marks the CR.
- Repro (`r5-probe` test 7, switch `ppm_business_case_freeze_enabled='1'`, `ppm_change_requests_enabled='1'`): project budget 1000 approved → CR #1 "+100 USD" (author c1, approved by c2) → c1 edits budget 1100 with CR #1 (200), then budget **999 999 + new charter** with CR #1 (**200**), then budget **5** with CR #1 (**200**). Ledger records `business_case_change` rows citing CR #1, so it is detectable, not prevented.
- Why P2: integrity of a financial control ("frozen business case") on a default-off switch; requires the committee role; becomes P1 for lot L05 if Finance relies on the freeze.
- Regression test: after one use, the same CR is refused (`BUSINESS_CASE_FROZEN`/`CR_ALREADY_APPLIED`); a budget change must equal `before.budget + cr.impact_budget` (same currency) or be refused; charter/business_need edits need a CR whose scope names those fields.
- Fix direction: bind each frozen edit to an unused approved CR and mark it `applied` in the same transaction; compare the budget delta to `impact_budget`. Rollback risk low.

Carried P2: R1-F3, R1-F4, R1-F5 (§0).

### P3
- **N-R5-4** Lot 6 per-project dependencies expose the raw `predecessor_project_id` of a project the reader cannot read (`services/ppm/structuredDependencies.js:136-138` `view()`), confirming its existence and id (label correctly null). Return `null` id when `!pp`.
- **N-R5-5** An administrator's password reset does not revoke the target's existing sessions (`reports-db.js` `_updateUserPg`); a reset used to evict a compromised account leaves the attacker logged in. Revoke sessions on reset (and on deactivation, if not already covered by access-revocation — not re-tested this round).
- **R2-N3 residual** inspection ids: 409 vs 200 still reveals an existing id on another site (actions fixed by fix 18).
- `GET /policy-center.html` serves the page shell to admin (client-side gate only; all its data routes are 403) — cosmetic.
- R1-F7, F8 still open (not re-tested).

## 4. Optimistic claims challenged
- "N-R4-1 fixed: four-eyes by strict direction, legacy PUT refuses four-eyes keys" — true for the two named doors; a third door (Teams SLA card) and an identity-level bypass (password reset) remain → PARTIAL.
- "Independent approver for Policy Center requests (R4-A2(b))" — independence is computed from creation/role journal only; credential control over the approver account is not considered.
- "Lot 5 review workflow refuses self-approval fail-closed" — holds for the same account, look-alike names and fresh accounts; not for a taken-over account.
- "Business case frozen after approval" — frozen until the first approved CR, then open.
- "authz-outcomes green" — green, but it runs every new lot switch off (Lots 2-6 routes answer 404 in that probe); their money/scope behaviour rests on their own smoke tests (which pass) and on manual probes.

## 5. Per P03 lot — AI panel recommendation, not a decision

| Lot | Recommendation |
|---|---|
| L01 Daily work | GO PILOT |
| L02 Portfolio reading | CONDITIONAL — R1-F2 decided by Finance/InfoSec and recorded |
| L03 Change control | CONDITIONAL — N-R5-3 if the business-case freeze is in scope; otherwise GO PILOT |
| L04 Scheduling/collab | GO PILOT |
| L05 Time, money, benefits | CONDITIONAL (pilot plan already NO-GO) — R1-F2 + R1-F5 + N-R5-3 |
| L06 Plan exchange | CONDITIONAL — not reviewed in depth by this seat |
| L07 Roadmap publication | CONDITIONAL — one executed roadmap-share test with amounts seeded |
| L08 Governance cadence | GO PILOT |
| L09 KPI trust | GO PILOT |
| L10 Reporting rhythm | GO PILOT |
| L11 Site ops evidence | CONDITIONAL — R1-F5 sentinels for certified asset money |
| L12 Access hardening | CONDITIONAL — break-glass drill evidence + InfoSec gate; N-R5-5 (sessions survive admin reset) |
| L13 Ops resilience / identity (incl. `policy_center_enabled`) | **CONDITIONAL; NO-GO for relying on the center's four-eyes** — N-R5-1 and N-R5-2 open (answer to HD-S04: keep off, or enable without relying on it); pair with R1-F3 / HD-S05 / D-15 |
| L14 Portfolio intake register | CONDITIONAL — tied to L02/L05 money decision |
| L15 Adoption Lot B (landing, group Home) | GO PILOT (UI switches; server scope unchanged — by reading) |
| L16 Portfolio phase 2 (Lot 6) | CONDITIONAL — N-R5-4 (P3) fix recommended; malware scanning of documents is an open operator decision |
| Portfolio Lots 2-5 switches (DQ, register v2, decision agenda/alerts, lifecycle/review/freeze) | GO PILOT for Lots 2-4; Lot 5 CONDITIONAL — N-R5-2 (review workflow) and N-R5-3 (freeze) |

## 6. Human gates still empty in this area (`docs/sdp360/completion/RELEASE-GATES.md`, rows verified empty at 3ee4dd23)
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08) — Information Security (row 8)
- Security — threat model and findings register (G27) — Information Security (row 9)
- Signing key and CI action SHAs D-12 (G-09) — Information Security + CI owner (row 11)
- Connectors D-07/D-08/D-09, dash-key clients D-15 — platform owners (row 20; R1-F3, HD-S05)
- Finance — budgets and benefits (G14) — Finance (row 21; R1-F2, N-R5-3)
- Penetration test / accepted analysis (E-B05, X-B-03) — Information Security (row 25)
- Production deployment GO/NO-GO — CAB (row 24); CAB D-11 / PO-08 (row 10)
- Business-readiness register rows in this area still blank: HD-S04 (Policy Center double control), HD-S05 (dash key), HD-G13.

No approval, signature or production readiness is claimed or implied by this file.
