# P11 qualification — Security seat — ROUND 4

**AI review — not an independent human review.** Reviewer seat: security. I did not write this code and did not modify it. No push, merge, tag, live system or human decision field was touched.

- Frozen SHA: `e43d11d5738dc4af650bd06715c54e6927f1649e` (clone `/home/user/qual/security`, `git rev-parse HEAD` checked; only the intentionally removed `docs/agent-execution/` narratives differ from the tag, not read).
- Previous rounds (unchanged): `security.md` (R1), `r2-security.md` (R2), `r3-security.md` (R3 at ead6efb6).
- Raw logs: `/home/user/qual/out/sec-logs/r4-outcomes.log`, `r4-batch.log`, `r4-probe.log`, `r4-probe-b.log`. Throwaway probes: `/tmp/claude-0/p11attack-r4/tests/r4-probe.test.js`, `r4b.test.js` (copied into the clone only for the run, then deleted; never committed).
- Env: shared PG (max_connections 400), `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, node_modules symlinked from `/home/user/SDP360`.

## 0. Round-3 findings — fixed or not (repro re-run at e43d11d5)

| R3 item | Trunk claim | Re-test | Verdict |
|---|---|---|---|
| **N-R3-1 (P2)** four-eyes bypass with look-alike owner | `7c2ecba2` (fix 11): NFKC + `\p{Cf}` strip + whitespace collapse + Cyrillic/Greek skeleton on the refusal side; owner/executor changes record `by` (`services/commitmentLifecycle.js:52-74`, `services/commitmentStore.js:93-97`) | **Route level, executed end-to-end**: editor Bob creates (owner `r4-bob`); admin Alice PUTs owner `r4-alice​` (ZWSP) → 200; Bob moves to awaiting_verification; Alice verifies → **403** "the owner, an executor or the creator cannot verify". Pure: ZWSP, Cyrillic і/а/е/ӏ, double space, BOM, full-width → isSelf true | **FIXED**. Residual P3: Latin `ɑ` (U+0251) is not in the skeleton (`ɑlice` → isSelf false) — exploitable only if a *third party* names the look-alike (collusion), since self re-pointing is now caught by `by`. |
| **N-R3-3 (P3)** hostile period params → 500 | `3ec82fd4`, `9f727e4b` (`services/periodParams.js`) | `/api/reports/monthly/1/abc/13`, `/monthly/1/2026/abc/edits`, `/weekly-summary/2026/xx/pptx`, `/monthly/x/2026/1`, `/yearly/1/20x6` → all **400** with field-named message; editor on other site + bad period → **403** (site check before 400). Outcome-probe log: none of the 11 report-route 500s of R3 remain. | **FIXED** for the named routes. Residual P3: other hostile-input 500s still present in `r4-outcomes.log` (already present at R3, not named then): `GET /api/kpi-policies/1/diff` (bigint "NaN", 19×), `POST /api/trackers/1/rollback/ZZZ` (8×), `DELETE /api/governance/portfolio/ZZZ/1` (4×), `PUT /api/reports/schedule` with no type (2×). Bodies do not expose stacks. |
| **R2-N2 (P3)** pre-fix editor share link revives on promotion | `a07bde14` + migration `reports/116` (`creator_admin` recorded at mint, view needs admin then AND now) | pre-fix editor link → 404; editor promoted to admin → **404** (was 200); admin-minted link → 200; that admin demoted → 404 | **FIXED**. Note: the migration back-fills existing rows from the tier *at deploy* — a pre-fix editor already promoted before the deploy keeps a live link (narrow, accepted by design text). |
| **R2-N3 (P3)** field 409 status oracle across sites | `42d9ac55` (`routes/field.js:171-174`) | foreign-site id → 409 with generic text, **no status/detail**; foreign row untouched (`submitted`, `MGO`); unused id → 200 | **PARTIAL** — status no longer leaks; *existence* of an id still distinguishable (409 vs 200). P3, low value (ids are date-prefixed). |
| R1-F2 (P1 policy) committee reads portfolio amounts | not claimed | `KNOWN_OUTCOME_MONEY` exception unchanged (`tests/_rbac-matrix-core.js:480`) | **NOT FIXED — human decision pending** (Finance + InfoSec) |
| R1-F3 (P2) dash key injected / scope open | not claimed | `services/reportConfig.js:542` `dashkey_scope_mode:'open'`, `ui_inject_dash_key:'1'` | **NOT FIXED** (D-15) — and see N-R4-1: the Policy Center lets one person return to these values |
| R1-F4 (P2) CSP strict on few pages | partial | `STRICT_PAGES` now 3 (`/policy-center.html` added, `services/sessionAuth.js:23`) | **NOT FIXED** (progress +1 page) |
| R1-F5 (P2) money sentinels partial | not claimed | `MONEY_SENTINELS` unchanged (`:476`); new money-adjacent intake fields (`budget_status`, `budget_approval_date`, `budget_reference`) have no sentinel either | **NOT FIXED** |
| R1-F7, F8 (P3) | — | not re-tested | open |

## 1. Evidence re-run at e43d11d5 (command · result)

Prefix: `NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | `tests/authz-outcomes.smoke.test.js` | **5/5 pass**, 355 s, exit 0 (residual hostile-input 500s listed in §0) | VERIFIED |
| E2 | authz-handler-checks, authz-matrix-json, authz-route-matrix, csp-candidate-pages.smoke, csp-headers.smoke, csp-journey-report, csp-no-inline-handlers-new-pages, csp-report.smoke, csp-strict-pages-config, rbac-external-writes, rbac-matrix.smoke, rbac-mutation.smoke, rbac-scope-frozen.smoke, rbac-ui-gates, rbac-write-scope.smoke, secret-scan, session-security.smoke + fix/lot tests field-inspection-action-status.smoke, policy-center-catalogue, policy-center-routes.smoke, ppm-intake-pure, ppm-intake-ui, ppm-intake.smoke, report-period-params.smoke, report-run-group-share.smoke, report-subscription-scope.smoke (26 files, one run) | **156/156 pass**, 0 skip, 145 s, exit 0 | VERIFIED |
| E3 | `node tools/security/secret-scan.js --check` | "no credential in the tracked files", exit 0 | VERIFIED |
| E4 | `node tools/security/csp-journey-report.js --check` | up to date, exit 0 | VERIFIED |
| E5 | `node tools/security/retention-inventory.js --check` | up to date, exit 0 | VERIFIED |
| E6 | `npm audit --omit=dev` | found 0 vulnerabilities (registry-dependent, 2026-11-20) | VERIFIED |
| E7 | R3 repros + new attacks (§2): `r4-probe` 8 tests, `r4b` 1 test | executed, exit 0 | VERIFIED |
| E8 | `authz-divergence-report.js`, `dashkey-consumers.js` (no `--check`) | not run | NOT VERIFIED |
| E9 | access-revocation, dashkey-only-routes, export-share-boundary, SSO/Entra, route-authz suites (not assigned) | not run | NOT VERIFIED |

**7 verified, 2 not verified.** No full suite (not assigned).

## 2. New claims I tried to break (none repeat an earlier attack)

| Capability | Claim | Attack | Outcome |
|---|---|---|---|
| Policy Center four-eyes (new lot) | "every high-risk change goes through four-eyes; requester refused by id and normalised identity" | super1 hardens `dashkey_scope_mode` open→restrict | 202 pending; super1 self-approve **403**; super2 approve 200 — holds |
| Policy Center four-eyes | "returning to the default is the safe direction" (ADR-POLICY-CENTER §6) | super1 alone resets `dashkey_scope_mode` restrict→open; sets `export_policy_strict` 1→0 | **applied, single person** → N-R4-1 |
| Policy Center "one change path" | center is the one path for rule changes | super1 alone `PUT /api/reports/config {export_policy_strict:'1', ui_inject_dash_key:'0', authz_capability_mode:'enforce'}` then reverts | **200, applied immediately, no request** → N-R4-1 |
| Policy Center read scope | config values readable as before | admin (not super) `GET /api/reports/config` → 403; same admin `GET /api/policy-center/catalogue` and `/export?format=csv` | **200**, returns `sso_breakglass_user` and `entra_tenant_id` values → N-R4-2 |
| Policy Center import | secrets never imported; four-eyes rows become requests; dry-run hash binds apply | profile with `smtp_pass`, `entra_client_secret`, two four-eyes keys; confirm with hash; admin import | secrets `forbidden`, four-eyes rows `pending`, admin 403 — holds |
| Intake register (new lot) | budget metadata follows the money rule | code review of `intakeMoneyless` (`routes/governance.js:565-570`), single-project read (`:730`), history route (`:858-868` requires money) | holds by reading (no money-reader persona probe with seeded `budget_reference` → partial) |
| Adoption Lot A telemetry | page-view needs a session, allow-listed page | anonymous POST → 401; `page: '../../etc/passwd'` → 400 | holds |
| activate-switches tool (new) | outbound switches skipped unless `--include-outbound` | `--plan --lots=all --json` (no DB) | 108 applies, 5 skipped outbound; the reminder/nudge switches it applies write in-app notifications only (`services/weeklyReportNudges.js:56`, `actionAgingReminders.js:73`). Holds. Note: it writes `report_config` via `setConfig` directly (no Policy Center four-eyes) — operator/DB-credential path, see N-R4-1. |

## 3. Findings (round 4)

### P0 — none.

### P1 — none open in code. R1-F2 stays a **policy** blocker (human decision).

### P2

**N-R4-1 (P2) — Policy Center four-eyes is advisory: one super_admin can relax a hardened security rule alone, two ways.**
- Where: `services/policyCatalogue.js:207-211` `needsSecondPerson` returns false whenever `next === entry.default`; `routes/policyCenter.js` `reset:true` path; ADR-POLICY-CENTER §6 ("returning to the default is immediate (the safe direction)"). Several four-eyes keys have the *weak* value as default: `dashkey_scope_mode 'open'`, `ui_inject_dash_key '1'`, `authz_capability_mode 'off'`, `export_policy_strict '0'`, `auth_account_throttle_enabled '0'`, `access_require_approval '0'`, `soft_delete_two_person '0'`, `breakglass_timebox_enabled '0'`. Second path: `routes/adminConfig.js:84` `PUT /api/reports/config` (super_admin) writes any key with no request, whether `policy_center_enabled` is on or off; `tools/ops/activate-switches.js` also writes directly (needs DB credentials).
- Repro (`r4b`, `r4-probe` test "four-eyes bypass paths"): super1 PUT `/api/policy-center/rules/dashkey_scope_mode {value:'restrict'}` → 202 pc-1; super2 approves → `restrict`; super1 PUT `{reset:true, reason:'revert alone'}` → **200 applied, `open`**. `export_policy_strict` 1→0 by super1 alone → **200 applied**. Legacy `PUT /api/reports/config` by super1 → **200**, three four-eyes keys changed instantly.
- Why P2: super_admin only, journaled (`config_changed`), switch default off. Becomes **P1** if InfoSec accepts the Policy Center four-eyes as a compensating control (e.g. for G-03…G-08 or D-15) — today it does not hold.
- Regression test to add: for each four-eyes key, the direction toward the *less restrictive* value needs a second person regardless of whether it equals the default; with `policy_center_enabled='1'`, `PUT /api/reports/config` on a four-eyes key answers 409/202 (or routes through the request store).
- Fix direction (not applied): give each four-eyes entry an explicit `safe_value`/`relaxing_direction` in the catalogue instead of "default = safe"; route the legacy PUT through `changeRule` when the center is on. Rollback risk low (narrows); keeps emergency rollback possible for genuinely safe directions.

**N-R4-2 (P2) — Policy Center widens config read from super_admin to the admin tier.**
- Where: `routes/policyCenter.js` `GET /api/policy-center/catalogue`, `/export`, `/requests`, `/rules/:key/history` are `requireAdmin`, while the legacy `GET /api/reports/config` is `requireSuperAdmin` (since `5e2f40e`). Matrix `tests/_rbac-matrix-core.js:388-391` records this as intended (`AAA`).
- Repro (`r4-probe` test "admin (not super) reads…"): admin `GET /api/reports/config` → **403**; same admin `GET /api/policy-center/catalogue` → 200 with `sso_breakglass_user = "bg-secret-user"`, `entra_tenant_id = "tenant-1111"`; `export?format=csv` → 200 containing the break-glass username. Viewer → 403. Secrets themselves stay "set / not set" (holds).
- Why P2: the break-glass account name is a targeting aid for the one password account that survives `SSO_MODE=only`; also exposes tenant/client ids, base URLs, history of values. Admin tier ≈ 2 accounts today, but the split was deliberate.
- Regression test: an admin-tier (non-super) caller reading the center never receives a value the legacy super-only GET withholds (at least `sso_*`, `entra_*`, `*_url`, `outbound_allow_hosts`); or align both to super_admin.
- Fix direction: mark identity/auth keys `sensitive_read: super_admin` in the catalogue and blank them for admin; or gate the center reads with `requireSuperAdmin`. Rollback risk low.

Carried P2: R1-F3, R1-F4, R1-F5 (unchanged, see §0).

### P3
- **N-R4-3** Latin-alpha (`ɑ`, U+0251) and other non-Cyrillic/Greek confusables not in `CONFUSABLE` (`services/commitmentLifecycle.js:63`) — collusion-only after fix 11.
- **N-R4-4** remaining hostile-input 500s: `GET /api/kpi-policies/:id/diff`, `POST /api/trackers/:id/rollback/:v`, `DELETE /api/governance/portfolio/:kind/:id` (unknown kind), `PUT /api/reports/schedule` (no type). Robustness, no stack leak.
- **R2-N3 (residual)** field 409 vs 200 still reveals that an id exists on another site (status no longer leaks).
- R1-F7, F8 still open.

## 4. Optimistic claims challenged
- "N-R3-1 fixed" — **confirmed end-to-end** at route level, not just in the pure function.
- "Policy Center: one change path, four-eyes on high-risk rules" — four-eyes holds for *tightening* and for self-approval, not for relaxing to a weak default, and the legacy path remains (N-R4-1).
- "Secrets never returned by the center" — true; but non-secret identity config is now readable one tier lower than before (N-R4-2).
- "authz-outcomes green" — green, but the probe runs with `policy_center_enabled` off, so it cannot see N-R4-1/N-R4-2; and it encodes the admin read as intended.

## 5. Per P03 lot — AI panel recommendation, not a decision

| Lot | Recommendation |
|---|---|
| L01 Daily work | GO PILOT |
| L02 Portfolio reading | CONDITIONAL — R1-F2 decided by Finance/InfoSec and recorded |
| L03 Change control | GO PILOT |
| L04 Scheduling/collab | GO PILOT |
| L05 Time, money, benefits | CONDITIONAL — R1-F2 decided + R1-F5 sentinels (finance actuals, EVM, intake budget metadata) |
| L06 Plan exchange | CONDITIONAL — not reviewed in depth by this seat |
| L07 Roadmap publication | CONDITIONAL — one executed roadmap-share test with amounts seeded |
| L08 Governance cadence | GO PILOT (N-R3-1 fixed) |
| L09 KPI trust | GO PILOT |
| L10 Reporting rhythm | GO PILOT (R2-N1, R2-N2 fixed) |
| L11 Site ops evidence | CONDITIONAL — R1-F5 sentinels for certified asset money |
| L12 Access hardening | CONDITIONAL — break-glass drill evidence + InfoSec gate; note N-R4-1 (hardened access keys revertible by one person) |
| L13 Ops resilience / identity (incl. `policy_center_enabled`) | **CONDITIONAL** — N-R4-1 and N-R4-2 fixed, or InfoSec records that the center's four-eyes is NOT relied on as a control and accepts admin-tier read of identity config; pair with R1-F3 / D-15 |
| L14 Portfolio intake register (`ppm_intake_register_enabled`) | CONDITIONAL — tied to L02/L05 money decision; add a money-sentinel probe for `budget_reference` |

## 6. Human gates still empty in this area (`docs/sdp360/completion/RELEASE-GATES.md`, unchanged since R3, rows verified empty)
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08) — Information Security (row 8)
- Security — threat model and findings register (G27) — Information Security (row 9)
- Signing key and CI action SHAs D-12 (G-09) — Information Security + CI owner (row 11)
- Connectors D-07/D-08/D-09, dash-key clients D-15 — platform owners (row 20; R1-F3)
- Finance — budgets and benefits (G14) — Finance (row 21; R1-F2)
- Penetration test / accepted analysis (E-B05, X-B-03) — Information Security (row 25)
- Report authority and channels D-13 (G-13/G-25); QA lead CI green on target SHA (E-B05); production GO/NO-GO — CAB

No approval, signature or production readiness is claimed or implied by this file.
