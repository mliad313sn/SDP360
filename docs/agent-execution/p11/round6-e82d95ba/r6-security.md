# P11 qualification — Security seat — ROUND 6 (confirmation)

**AI review — not an independent human review.** Reviewer seat: security. I did not write this code and did not modify it. No push, merge, tag, live system or human decision field was touched. Nothing here approves, signs or declares anything production-ready.

- Frozen SHA: `e82d95baf7fa4b554003d32f89e02d634216c1de` (clone `/home/user/qual/security`, `git rev-parse HEAD` checked; only the intentionally removed `docs/agent-execution/` narratives differ — not read). Fixes reviewed: `git log 3ee4dd23..e82d95ba` (fixes 19–24; security-relevant code: `f20d0129` fix 21, `51b71b47` N-12, `e78442fe` fix 24, `8e70b423` fix 20).
- Earlier rounds unchanged: `security.md`, `r2-`, `r3-`, `r4-`, `r5-security.md`.
- Raw logs: `/home/user/qual/out/sec-logs/r6-outcomes.log`, `r6-batch.log`, `r6-probe.log`, `r6-freeze.log`. Throwaway probes (copied into the clone only for the run, deleted afterwards, never committed): `/tmp/claude-0/p11attack-r6/tests/r6-probe.test.js` (R5 repros + 4 new attacks), `r6-takeover.test.js`, `r6-freeze.test.js`.
- Env: shared PostgreSQL (cluster reports `16/main` online on 5432), `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `SDP_TEST_RUN_ID=security-r6`, node_modules symlinked.
- DB hygiene note: `tests/pg-helpers.js:95-98` only embeds the run id when it matches `^[a-z0-9]{1,16}$`; the prescribed `security-r6` contains a hyphen, so my per-file throwaway databases carry **no** run id and cannot be told apart from other seats'. The harness drops each per-file DB at the end of its file; I dropped nothing by hand (dropping by pattern would risk other seats' DBs). Tooling note → P3 (T-R6-1).

## 0. Round-5 findings — fixed or not (repros re-run at e82d95ba)

| R5 item | Trunk claim | Re-test (r6-probe.log / r6-freeze.log) | Verdict |
|---|---|---|---|
| **N-R5-1 (P2)** Teams SLA card arms four-eyes `teams_sla_enabled` alone while center on | fix 21: `services/fourEyesGuard.guardedSetConfig` used by every route writer (teamsSla, adminConfig, policies, trackers, opmanager, assets, governanceWorkbench); `tests/four-eyes-guard.test.js` enumerates `setConfig` callers under `routes/` + `services/` | center on, super1 `PUT /api/teams-sla/settings {enabled:true}` → **409 CONFLICT** "four-eyes rule teams_sla_enabled…", value stays `0`. grep: only `services/fourEyesGuard.js:54` and `routes/policyCenter.js:90` call `setConfig` in routes/services | **FIXED** for the named door. **But** the guard's own value normalisation opens a new single-person path → **N-R6-1** (below). CLIs under `tools/` (e.g. `tools/governance/apply-values.js:65`) still call raw `setConfig` — operator shell, P3 note. |
| **N-R5-2 (P2)** approver independence defeated by password reset (Policy Center + Lot 5 review) | fix 21: `services/approverProvenance.js` counts `password_reset`, credential-touching `user_updated`, `user_email_changed` by the requester as non-independence | (a) super1 relax request pc-1 → resets super2 password → logs in as super2 → approve → **403** "the requester reset the credentials…"; value stays `restrict`. (b) Lot 5: super1 submits, resets committee c2, decides as c2 → **409 APPROVER_NOT_INDEPENDENT**. (c) NEW variant: super1 bulk-remaps an older super3's e-mail (SSO match key) via `PUT /api/reports/users/emails` → approve as super3 → **403**. | **FIXED** (3 variants refused). Username is not editable through `PUT /api/reports/users/:id`, so the "rename to escape the journal lookup" variant is not reachable. |
| **N-R5-3 (P2)** one approved CR unlocks every later frozen edit | fix 20: CR single-use (`business_case_change` ledger row = used), advisory lock per CR id, budget must equal `before + impact_budget`, currency frozen (`services/ppm/reviewWorkflow.js:86-105`, `services/governanceStore.js:705-752`) | reuse after first edit → **409 CHANGE_REQUEST_USED** (twice); two **parallel** edits naming the same CR → one 200, one **409 CHANGE_REQUEST_USED** | **FIXED** for reuse, race and budget size. Residual: the CR is value-bound on `budget` only → **N-R6-2 (P3)**. |
| **N-R5-4 (P3)** predecessor id of an unreadable project exposed | fix 20/21 | editor (site A) reads A's dependencies → `[[null,false,null]]` (id, readable, label) ; B itself → 404 | **FIXED** |
| **N-R5-5 (P3)** admin reset does not revoke sessions | fix 21: `revokeUserSessions` on admin reset | reset → `sessions_revoked: 1` / `3`; old token `GET /api/reports/auth/me` → **401**; deactivation (`active:0`) → old token **401**; demotion admin→viewer → old token on admin route **403** (roles re-read) | **FIXED** |
| **R2-N3 residual (P3)** field inspection-id existence oracle | fix 21 | foreign existing id → 409 "this inspection id cannot be used from the field app — capture a new inspection"; unused non-field id → **same 409 text**; unknown action id → 403 `action_unavailable` | **FIXED** |
| `GET /policy-center.html` shell to admin (cosmetic) | — | admin → 200 page; all four data routes → 403, break-glass name absent | unchanged (cosmetic) |
| N-R4-2/3/4 regressions | — | admin center reads 403 ×4; confusables `isSelf` true; hostile inputs 400/404, no 500 | still FIXED |
| R1-F2 (P1 policy) committee reads portfolio amounts | — | `KNOWN_OUTCOME_MONEY` still in `tests/_rbac-matrix-core.js:480` | **NOT FIXED — human decision** (Finance + InfoSec) |
| R1-F3 (P2) dash key injected / scope open | — | `services/reportConfig.js:609` `dashkey_scope_mode:'open'`, `ui_inject_dash_key:'1'` | **NOT FIXED** (HD-S05 / D-15 blank) |
| R1-F4 (P2) CSP strict on few pages | — | `STRICT_PAGES` = 6 (`services/sessionAuth.js:23`) | **NOT FIXED** (unchanged count) |
| R1-F5 (P2) money sentinels partial / lots off in probe | fix 21: `tests/authz-outcomes-lots-on.smoke.test.js` arms 20 L14–L16 switches and checks money sentinels + "never lift a refusal" | ran, 5/5 pass (20 switches, 290 rows, 6 661 requests); `MONEY_SENTINELS` unchanged (`:476`); `ppm_change_requests_enabled` (L13 list) and outbound keys stay off by design | **PARTIAL** (Lots 2–6 now covered by an outcome probe; sentinel list unchanged) |

## 1. Evidence re-run at e82d95ba (command · result)

Prefix: `SDP_TEST_RUN_ID=security-r6 NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | `tests/authz-outcomes.smoke.test.js` + `tests/authz-outcomes-lots-on.smoke.test.js` (one run) | **10/10 pass**, 7 m 59 s, exit 0 (baseline probe: every /api route × 23 personas, invariants, money sentinels, snapshot equality, switches narrow-only; lots-on: 20 switches, 6 661 requests) | VERIFIED |
| E2 | authz-handler-checks, authz-matrix-json, authz-route-matrix, csp-candidate-pages.smoke, csp-headers.smoke, csp-journey-report, csp-no-inline-handlers-new-pages, csp-report.smoke, csp-strict-pages-config, rbac-external-writes, rbac-matrix.smoke, rbac-mutation.smoke, rbac-scope-frozen.smoke, rbac-ui-gates, rbac-write-scope.smoke, secret-scan, session-security.smoke + fix-21 tests four-eyes-guard, p11-r5-security.smoke, approver-provenance, policy-center-control-switches, policy-center-four-eyes-bypass.smoke, policy-center-four-eyes-direction, policy-center-routes.smoke, access-revocation.smoke (25 files, one run) | **134/134 pass**, 0 skip, 3 m 34 s, exit 0 | VERIFIED |
| E3 | `node tools/security/secret-scan.js --check` | "no credential in the tracked files", exit 0 | VERIFIED |
| E4 | `node tools/security/csp-journey-report.js --check` | up to date, exit 0 | VERIFIED |
| E5 | `node tools/security/retention-inventory.js --check` | up to date, exit 0 | VERIFIED |
| E6 | `npm audit --omit=dev` | found 0 vulnerabilities (registry state 2026-11-20) | VERIFIED |
| E7 | R5 repros + R6 attacks: `r6-probe` 14 tests + `r6-takeover` 1 + `r6-freeze` 1 | executed, exit 0 (findings are in logged values, not assertions) | VERIFIED |
| E8 | `tools/security/authz-divergence-report.js` (needs `PG_URL` in `.env`), `dashkey-consumers.js` (no `--check`) | not run | NOT VERIFIED |
| E9 | SSO/Entra, dashkey-only-routes, export-share-boundary, route-authz suites (not assigned) | not run | NOT VERIFIED |

**7 verified, 2 not verified.** No full suite (not assigned).

## 2. Break attempts at this SHA (one per capability, preferring code changed by fixes 19–24)

| Capability | Claim | Attack | Outcome |
|---|---|---|---|
| Four-eyes guard on every config writer (fix 21) | "while the center is on, a four-eyes change that needs a second person is a typed 409" (`services/fourEyesGuard.js:1-10`) | center on, `portfolio_site_scope_reads`/`export_policy_strict`/`access_require_approval` = `'1'`; super1 `PUT /api/reports/config {portfolio_site_scope_reads:true, export_policy_strict:true, access_require_approval:true}` (JSON booleans) | **200**; stored values **`"true"`** ×3; `routes/governance.js:598` reads `c.portfolio_site_scope_reads === '1'` → **scope OFF**; `routes/adminUsers.js:50` and `services/authzShadow.js:35` read `=== '1'` → approval gate OFF → **N-R6-1** |
| Approver independence (fix 21) | credential control by the requester = not a second person | e-mail remap of an older super_admin via the bulk SSO mapping route, then approve | **403** — holds |
| Session revocation (fix 21) | admin reset revokes sessions | reset, deactivate, demote; replay old tokens | 401 / 401 / 403 — holds |
| Business-case freeze (fix 20) | CR single-use and value-bound | parallel double use; budget-CR used to rewrite the charter | race holds (200 + 409); **charter rewritten with a "+100 USD licence" CR** → N-R6-2 (P3) |
| Field inspection oracle (fix 21) | identical refusal | foreign vs unused id | identical 409 — holds |
| DB stall 503 (fix 22 N-12) | DB_BUSY → 503, never fail-open | code review `server.js` gate (`app.use('/api/')`) + `requireReportSession`: `DB_BUSY` → `fail(res,e)` (503) before `next()`; any other error → 401/500 | fail-closed — holds by reading |
| Policy Center boolean input | center normalises values | center `PUT …/rules/export_watermark_enabled {value:true}` | stored `'1'` (normalised) — holds; the bypass is specific to the legacy PUT |
| Lot 6 / money (lots-on probe) | no amount sentinel to non-readers with L14–L16 on | re-run E1 | holds (committee exception = R1-F2) |

## 3. Findings (round 6)

### P0 — none.

### P1 — none open in code. R1-F2 stays a **policy** blocker (human decision).

### P2

**N-R6-1 (P2) — JSON booleans slip past the four-eyes guard on the legacy config PUT: one super_admin weakens a strict-`'1'` control while the Policy Center is on (regression class of fix 21 / fix 14).**
- Where: `services/fourEyesGuard.js:14` `str()` maps `true → '1'`, so `blockedKeys` (`:22-33`) sees "no change" when the current value is `'1'`; `routes/adminConfig.js:118-124` then calls `guardedSetConfig` with the raw body, and `services/reportConfig.js:832-846` stores `String(true)` = **`"true"`**. Every reader compares `=== '1'` (`routes/governance.js:598`, `routes/adminUsers.js:50`, `services/authzShadow.js:35`, `services/execPackPortfolio.js:55`), so `"true"` reads as **off**.
- Repro (`r6-probe` test "R6 A1"): `policy_center_enabled='1'`, `portfolio_site_scope_reads='1'`, `export_policy_strict='1'`, `access_require_approval='1'`; super1 `PUT /api/reports/config` `{"portfolio_site_scope_reads":true,"export_policy_strict":true,"access_require_approval":true,"reason":"…"}` → **200**; `report_config` now `"true"` ×3; `scopeOn` false. Journal records `config_changed from "1" to "true"` (detectable, not prevented). The Policy Center itself normalises (`{value:true}` → `'1'`), and `PUT /api/teams-sla/settings` normalises (`b.enabled ? '1':'0'`), so the hole is the generic PUT. With the center **off** the same request silently disables the control too (operator footgun: the admin believes they saved "on").
- Why P2 (not P1): super_admin only, journalled, center off in the pilot plan (`docs/business-readiness/PLAN-PILOTE.md`); but it directly answers HD-S04 again: **the center's double control is not yet reliable**; P1 the day InfoSec accepts four-eyes as a compensating control.
- Regression test to add: for every four-eyes key with `strict_value '1'`, `PUT /api/reports/config {key: true}` (and `"true"`, `1`, `"1 "`, `"on"`) with center on either answers 409 or stores exactly `'1'`; a unit test that `blockedKeys` compares the value `setConfig` will actually store.
- Fix direction (not applied): canonicalise in one place — `setConfig` stores `true/false` as `'1'/'0'` (or rejects non-string values for flag keys), and `blockedKeys` compares the post-canonical value; optionally validate four-eyes keys against their catalogue domain. Rollback risk low.

Carried P2: R1-F3, R1-F4, R1-F5 (partial) (§0).

### P3
- **N-R6-2** Business-case freeze: a CR is value-bound on `budget` only; the same single use also rewrites `charter` / `business_need` / `budget_reference` (repro `r6-freeze`: CR "Second licence, +100 USD" → edit budget 1100→1200 **and** charter "A completely different project scope now, unrelated." → 200). Bind the CR to the frozen fields it names (CR scope), or require a CR with no budget impact for text fields. `expected_value` was not persisted through `PUT /api/governance/portfolio/project` in this probe (stays null), so not exercised.
- **T-R6-1** `tests/pg-helpers.js:98` silently ignores a run id containing `-`; the seat brief's `security-r6` therefore produces unattributable DB names, defeating the run-scoped sweep (P11 AUD-8). Accept `[a-z0-9_-]` (normalised) or warn loudly.
- `tools/governance/apply-values.js:65` and other CLIs write `report_config` without `fourEyesGuard` (operator shell; `tools/ops/activate-switches.js` does require a second operator) — document or route through the guard.
- `GET /policy-center.html` shell to admin — cosmetic, unchanged.
- R1-F7, F8 still open (not re-tested).

## 4. Optimistic claims challenged
- "Fix 21: shared four-eyes guard on **all** config routes" — true for the set of callers; the guard compares a normalised value that is not what is stored → N-R6-1. The static caller test (`tests/four-eyes-guard.test.js`) cannot see this class.
- "Approver independence after credential resets" — confirmed for password reset, e-mail edit and bulk e-mail remap (3 variants).
- "Single-use, value-bound change requests" — single-use and race-safe confirmed; "value-bound" covers the budget amount only.
- "Lots-on authz probe" — confirmed green; it arms L14–L16 only (20 keys), outbound/kill-switch keys and `ppm_change_requests_enabled` stay off, so CR routes rest on their own smoke tests and my probes.

## 5. Per P03 lot — AI panel recommendation, not a decision

| Lot | Recommendation |
|---|---|
| L01 Daily work | GO PILOT |
| L02 Portfolio reading | CONDITIONAL — R1-F2 decided by Finance/InfoSec and recorded |
| L03 Change control | GO PILOT (N-R5-3 fixed; N-R6-2 P3 noted) |
| L04 Scheduling/collab | GO PILOT |
| L05 Time, money, benefits | CONDITIONAL (pilot plan already NO-GO) — R1-F2 + R1-F5 (partial) |
| L06 Plan exchange | CONDITIONAL — not reviewed in depth by this seat |
| L07 Roadmap publication | CONDITIONAL — one executed roadmap-share test with amounts seeded |
| L08 Governance cadence | GO PILOT |
| L09 KPI trust | GO PILOT |
| L10 Reporting rhythm | GO PILOT |
| L11 Site ops evidence | CONDITIONAL — R1-F5 sentinels for certified asset money |
| L12 Access hardening | CONDITIONAL — break-glass drill evidence + InfoSec gate (N-R5-5 fixed); N-R6-1 also lets the generic PUT disable `access_require_approval` with a boolean |
| L13 Ops resilience / identity (incl. `policy_center_enabled`) | **CONDITIONAL; NO-GO for relying on the center's four-eyes** until N-R6-1 is fixed (answer to HD-S04: keep off, or enable without relying on it); pair with R1-F3 / HD-S05 / D-15 |
| L14 Portfolio intake register | CONDITIONAL — tied to L02/L05 money decision |
| L15 Adoption Lot B | GO PILOT (lots-on probe green) |
| L16 Portfolio phase 2 (Lot 6) | GO PILOT from this seat (N-R5-4 fixed); malware scanning of documents remains an open operator decision |
| Portfolio Lots 2–5 switches | GO PILOT for Lots 2–4; Lot 5 GO PILOT from this seat (N-R5-2, N-R5-3 fixed; N-R6-2 P3) |

## 6. Human gates still empty in this area (`docs/sdp360/completion/RELEASE-GATES.md`, rows verified empty at e82d95ba)
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08) — Information Security (row 8)
- Security — threat model and findings register (G27) — Information Security (row 9)
- CAB — dependency release D-11 / PostgreSQL-only cutover PO-08 (row 10)
- Signing key and CI action SHAs D-12 (G-09) — Information Security + CI owner (row 11)
- Connectors D-07/D-08/D-09, dash-key clients D-15 — platform owners (row 20; R1-F3, HD-S05)
- Finance — budgets and benefits (G14) — Finance (row 21; R1-F2)
- Production deployment GO/NO-GO — CAB (row 24)
- Penetration test / accepted analysis (E-B05, X-B-03) — Information Security (row 25)
- Business-readiness register rows in this area still blank: HD-S04 (Policy Center double control — see N-R6-1), HD-S05 (dash key), HD-G13.

No approval, signature or production readiness is claimed or implied by this file.
