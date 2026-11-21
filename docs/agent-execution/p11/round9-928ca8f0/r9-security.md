# P11 qualification — Security seat — ROUND 9 (re-check)

**AI review — not an independent human review.** Reviewer seat: security. I did not write this code and did not modify it. No push, merge, tag, live system or human decision field was touched. Nothing here approves, signs or declares anything production-ready.

- Frozen SHA: `928ca8f03c0680acfb2b3eb0c871ba286934c8dd` (clone `/home/user/qual/security`; `git status` shows only the intentionally removed `docs/agent-execution/` narratives — not read). Fixes reviewed: `git log 7afb9536..928ca8f0` (fix 34 `af7a18ba`, fix 35 `1c570b05`/`c37c59c6`, fix 36 `2e1f3a54`, `bcc729eb`). Security-relevant code read: `services/policyChangeStore.js` (`failed` status), `routes/policyCenter.js:170-215` (R8-A1 CLI-filed check, N-R8-1 catch), `services/operatorTokens.js` (comment, `evidenceForRequest`), `services/httpError.js` (`asUnavailable`), `server.js:1105-1110, 3258-3262`, `services/businessGuard.js`, `inspection-db.js` (`server_version`, `known_action_ids`, `_assertVersionPg`), `routes/inspection.js:392-398`, `services/auditChain.js` (kid history / hwm), `tools/pg/harden-audit-grants.sql`.
- Earlier rounds unchanged: `security.md`, `r2-`…`r8-security.md`.
- Raw logs: `/home/user/qual/out/sec-logs/r9-outcomes.log`, `r9-batch.log`, `r9-batch2.log`, `r9-pcroutes-1.log`, `r9-pcroutes-2.log`, `r9-tools.log`, `r9-probe.log`. Throwaway probe: `/tmp/claude-0/p11attack-r9/tests/r9-probe.test.js` (copied into the clone's `tests/` only for its run, deleted right after, never committed).
- Env: shared PostgreSQL 16/main on 5432, `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `SDP_TEST_RUN_ID=securityr9*`, node_modules symlinked. After the runs `SELECT datname FROM pg_database WHERE datname LIKE '%securityr9%'` → 0 rows (the harness dropped its own per-file DBs; nothing dropped by hand).

## 0. Round-8 findings — fixed or not (repros re-run at 928ca8f0)

| R8 item | Trunk claim | Re-test | Verdict |
|---|---|---|---|
| **N-R8-1 (P3)** approval whose apply fails left `approved`, no journal row | fix 34: mark `failed` with the cause, journal `policy_change_failed` | `r9-probe` R9-1: legacy pending `auth_pbkdf2_iterations 100000→10000000` filed by super1, super2 approves → **400** "maximum 5000000", stored stays `100000`, row → **`failed`**, `decision_reason` = "approve legacy request \| apply failed: …", one `policy_change_failed` row (request, from, to, approver reason, cause), **no** `policy_change_approved` row. Re-approve and reject of the failed row → 409 "request is failed". `GET /requests?status=failed` lists it. | **FIXED** |
| **N-R8-2 (P3, doc)** operator-token "control" = read access to `.env` | fix 34: comment states the residual | `services/operatorTokens.js:9-18` now names DB-login + `SDP_CONFIG_KEY` (same `.env`) as the residual and points to InfoSec / G01 / HD-S04 | **FIXED as text**; the separation-of-duties decision itself is still a **human** item (HD-S04 decision columns blank) |
| R1-F2 (P1 policy) money exposure to committee | human decision | `tests/_rbac-matrix-core.js` exception list unchanged | **NOT FIXED — human decision** (Finance + InfoSec) |
| R1-F3 (P2) dash key injected / scope open | — | `services/reportConfig.js:609` `dashkey_scope_mode:'open'`, `ui_inject_dash_key:'1'` | NOT FIXED (HD-S05 / D-15 blank) |
| R1-F4 (P2) CSP strict on few pages | — | `STRICT_PAGES` still 6 (`services/sessionAuth.js:23`) | NOT FIXED |
| R1-F5 (P2) money sentinels partial | — | `MONEY_SENTINELS` 12 (`tests/_rbac-matrix-core.js:497`), abbreviated renderings still unmatched | PARTIAL (unchanged) |
| CLIs with a DB URL write `report_config` outside the guard (P3) | — | unchanged; and `report_config` / `policy_change_requests` / `operator_tokens` are not covered by `tools/pg/harden-audit-grants.sql` (only the ledgers, anchors and `audit_chain_meta`) | accepted limitation (unchanged) |
| `GET /policy-center.html` shell to admin | — | not re-tested | cosmetic, open |

## 1. Evidence re-run at 928ca8f0 (command · result)

Prefix: `SDP_TEST_RUN_ID=securityr9… PG_ADMIN_URL=… NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | `tests/authz-outcomes.smoke.test.js` + `tests/authz-outcomes-lots-on.smoke.test.js` | **10/10 pass**, 0 skip, 7 m 42 s, exit 0 | VERIFIED |
| E2 | 35 files in one run: authz-handler-checks, authz-matrix-json, authz-route-matrix, csp-candidate-pages.smoke, csp-headers.smoke, csp-journey-report, csp-no-inline-handlers-new-pages, csp-report.smoke, csp-strict-pages-config, rbac-external-writes, rbac-matrix.smoke, rbac-mutation.smoke, rbac-scope-frozen.smoke, rbac-ui-gates, rbac-write-scope.smoke, secret-scan, session-security.smoke, four-eyes-guard, p11-r6-security.smoke, p11-r7-security.smoke, **p11-r8-policy-center.smoke**, **p11-r8-audit-ops**, **p11-r8-field-fixes.smoke**, report-config-switch-canonical, approver-provenance, policy-center-control-switches, policy-center-four-eyes-bypass.smoke, policy-center-four-eyes-direction, policy-center-routes.smoke, policy-center-catalogue, access-revocation.smoke, activate-switches, activate-switches-r6-impersonation.smoke, audit-chain-r6, audit-chain | run 1: **195/197**, 2 fail (both in `policy-center-routes.smoke`: tests 134 "low-risk change … journalled" — history row `legacy→explicit` absent; 137 "export/import" — `ui_week_labels` plan `unchanged` instead of `apply`; both consistent with `ui_week_labels` already `explicit` at test start). That file alone: **6/6 twice**. Whole batch run 2: **197/197**, exit 0. | VERIFIED (with one non-reproducible flake — §3 P3-T) |
| E3 | `node tools/security/secret-scan.js --check` | "no credential in the tracked files", exit 0 | VERIFIED |
| E4 | `node tools/security/csp-journey-report.js --check` | up to date, exit 0 | VERIFIED |
| E5 | `node tools/security/retention-inventory.js --check` | up to date, exit 0 | VERIFIED |
| E6 | `node tools/agent/policy-catalogue.js --check` | OK — 353 catalogued, 3 excluded, exit 0 | VERIFIED |
| E7 | `npm audit --omit=dev` | found 0 vulnerabilities (registry state 2026-11-21) | VERIFIED |
| E8 | R8 repro + R9 attacks: `r9-probe` (4 tests) | executed, 4/4 test bodies ran, exit 0 (findings are in logged values) | VERIFIED |
| E9 | `tools/security/authz-divergence-report.js`, `dashkey-consumers.js` | not run (need `PG_URL` in `.env` / no `--check`) | NOT VERIFIED |
| E10 | SSO/Entra, dashkey-only-routes, export-share-boundary, route-authz suites (not assigned) | not run | NOT VERIFIED |

**8 verified, 2 not verified.** No full suite (not assigned).

## 2. Break attempts at this SHA (one per capability, preferring code changed by fixes 34–36)

| Capability | Claim | Attack | Outcome |
|---|---|---|---|
| Policy Center failed-apply (fix 34) | "never left approved; key freed; journalled" | R9-1 above + re-approve / reject the failed row | **holds** |
| CLI-filed request needs token evidence (fix 36, R8-A1) | "a request filed outside the web session flow must name the operator token that authenticated it … one with no token evidence is a row written straight into the table" | rows written straight into `policy_change_requests` (DB login only), `auth_account_throttle_enabled 1→0` (a weakening four-eyes change), requester super1, approved by super2: **A** marker, no token → 409 ✔; **B** `source='cli'`, no marker → 409 ✔; **C** `source='CLI'` → **200 approved, throttle disabled**; **D** marker with U+2011 hyphen → **200 approved**; **E** no marker, default source → **200 approved**; **F** marker naming a **genuine, already-consumed** operator token #1 of super1 → **200 approved**; **G** a second forged request replaying the same token #1 → **200 approved** | **does not hold as worded** → **N-R9-1** (P3, see §3). Note: the CLI never sets `source='cli'` (grep: no writer), so the `source` branch is dead code today. |
| DB outage → 503 (fix 35, F-30) | "a DB stall or outage is 503, never unauthorised" — and never a bypass | R9-3: `validateSession` throwing `ECONNREFUSED`, `08006`, `57P01`, `53300`, "Connection terminated unexpectedly", and a non-connection `XX000`; probes: `/auth/me` (viewer), policy-center catalogue with a garbage token, super1 write, inspection list | **holds** — connection classes → 503 `database_unavailable` on every route, **no request proceeded**, no driver text/host/port in bodies; `XX000` → 500 "Auth check failed" / 401 (no bypass). Server log carries the message with correlation id only. |
| Inspection optimistic concurrency (fix 35, F-29) | version / known ids never leak across sites; no cross-site write | R9-4: super creates a Mana inspection; HGO editor saves the Mana id with a stale and with the correct `server_version` (naming HGO site, then Mana site); editor GET | **holds** — every save 403 "Cross-site save blocked" before the version check (no `inspection_changed`, no `server_version` in the answer), Mana actions intact, GET 403. |
| Audit kid history (fix 36, R8-A2) | "only the job, which holds the key, writes it" | read `tools/pg/harden-audit-grants.sql:110-113`: the app role keeps `INSERT` on `audit_chain_meta` | observation — a DB-login holder can register `kid:<anything>`; impact bounded because hardened ledgers and anchors are append-only (no truncation to re-baseline) and the system_log high-water mark also constrains. Comment is optimistic; not a separate finding (ops seat owns the chain). |
| Money / scope outcomes Lots 1–6 | no amount sentinel to a non-reader, lots on or off | E1 re-run | holds (committee exception = R1-F2) |

## 3. Findings (round 9)

### P0 — none.

### P1 — none open in code. R1-F2 stays a **policy** blocker (human decision, Finance + InfoSec).

### P2 — no new P2. Carried: R1-F3, R1-F4, R1-F5 (partial).

### P3

**N-R9-1 (P3) — fix-36 "CLI-filed requests need token evidence" is bypassable by anyone who can write the table, and token evidence is replayable.**
- Where: `routes/policyCenter.js:181` detects a CLI request by `source === 'cli'` (case-sensitive, and no code path ever writes `'cli'` — `tools/ops/activate-switches.js` files through `makePolicyChangeStore.create`, default `source='policy_center'`) or the reason regex `/filed by activate-switches/i`; `services/operatorTokens.js:100-107` `evidenceForRequest` checks only that the token id named in the reason has an issuance event, a valid binding and the same account — not that the token was consumed **for this request**, nor that it is used once, nor the time window.
- Repro (`r9-probe` R9-2, logs `r9-probe.log`): `policy_center_enabled='1'`; with the DB login only, insert pending requests `auth_account_throttle_enabled 1→0` as super1 via `makePolicyChangeStore(...).create` (+ `UPDATE … SET source='CLI'` for case C); super2 `POST /api/policy-center/requests/pc-N/approve` → C, D, E, F, G all **200 approved**, throttle disabled each time, journalled as a normal `policy_change_approved`. F/G reuse genuine token #1 (issued by super1 over HTTP, already consumed once).
- Impact: no new capability for the attacker (the app role can already UPDATE `report_config` directly — not covered by the hardening script), but the **four-eyes register and journal can be made to show a weakening as "requested by super1 (token-verified), approved by super2"**, and the approver UI shows the forged row's operator-token evidence as valid. The fix-36 sentence overstates what is enforced.
- Regression test to add: approve (i) `source='CLI'`, (ii) a reason without the marker but `source` unset, (iii) a reason replaying an already-used token id → expect 409 for (iii) at least; record token→request binding (e.g. `operator_tokens.used_for_request_id` set at consumption, checked at approval) and treat `source` case-insensitively / set `source='cli'` in the CLI writer.
- Rollback risk: low (approval-path check only). Recommendation: either bind the token to the request at consumption, or reword the claim to "detects naïve forgeries; a DB-login holder can forge" and add it to HD-S04's known limits.

**P3-T (test hygiene) — `policy-center-routes.smoke` flaked once in a batch** (tests 134 / 137 fail when `ui_week_labels` is already `explicit` at start), not reproduced alone (2/2) nor in a full batch rerun (197/197). Cause not established (a concurrent run of my probe with another run id was in progress). A test that assumes the default state of a shared config key should set it explicitly in its own setup.

Other P3 carried: CLIs with a DB URL write `report_config` outside the guard (accepted); `GET /policy-center.html` shell to admin (cosmetic); kid-history comment optimistic (observation above); R1-F7, F8 (not re-tested).

## 4. Optimistic claims challenged
- "A failed Policy Center apply is marked failed and journalled" — **confirmed**.
- "Token evidence required for every CLI-filed Policy Center request" — **not as worded**: the `source` branch is dead, the marker is spoofable/omittable, and a genuine token's evidence can be replayed on any number of forged requests (N-R9-1).
- "503 instead of 401 on a DB outage" — confirmed, and confirmed not to open a bypass on the routes probed.
- "Unseen inspection actions are never deleted; stale saves 409" — the security side (no cross-site leak or write) confirmed; correctness side belongs to the field seat.
- "Kid history is written only by the job" — the app role can also insert it (bounded impact).

## 5. Per P03 lot — AI panel recommendation, not a decision

| Lot | Recommendation |
|---|---|
| L01 Daily work | GO PILOT |
| L02 Portfolio reading | CONDITIONAL — R1-F2 decided by Finance/InfoSec |
| L03 Change control | GO PILOT |
| L04 Scheduling/collab | GO PILOT |
| L05 Time, money, benefits | CONDITIONAL — R1-F2 + R1-F5 (partial) |
| L06 Plan exchange | CONDITIONAL — not reviewed in depth by this seat |
| L07 Roadmap publication | CONDITIONAL — one executed roadmap-share test with amounts seeded |
| L08 Governance cadence | GO PILOT |
| L09 KPI trust | GO PILOT |
| L10 Reporting rhythm | GO PILOT |
| L11 Site ops evidence (incl. inspections F-29/F-30 security side) | CONDITIONAL — R1-F5 sentinels for certified asset money; F-29/F-30 security side holds |
| L12 Access hardening | CONDITIONAL — break-glass drill evidence + InfoSec gate (rows 8/9/25) |
| L13 Ops resilience / identity (incl. `policy_center_enabled`) | **GO PILOT on TEST** from this seat (N-R8-1 fixed; N-R9-1 is register integrity against a DB-login holder); production reliance waits for HD-S04 (human, including the `.env` separation of duties and N-R9-1), R1-F3 / HD-S05 / D-15 |
| L14 Portfolio intake register | CONDITIONAL — tied to L02/L05 money decision |
| L15 Adoption Lot B | GO PILOT (lots-on probe green) |
| L16 Portfolio phase 2 (Lot 6) | GO PILOT from this seat; document malware scanning remains an operator decision |
| Portfolio Lots 2–5 switches | GO PILOT |

## 6. Human gates still empty in this area (`docs/sdp360/completion/RELEASE-GATES.md`, verified empty at 928ca8f0)
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08) — Information Security
- Security — threat model and findings register (G27) — Information Security
- CAB — dependency release D-11 / PostgreSQL-only cutover PO-08
- Signing key and CI action SHAs D-12 (G-09) — Information Security + CI owner
- Connectors D-07/D-08/D-09, dash-key clients D-15 — platform owners (R1-F3, HD-S05)
- Finance — budgets and benefits (G14) — Finance (R1-F2)
- Production deployment GO/NO-GO — CAB
- Penetration test / accepted analysis (E-B05, X-B-03) — Information Security
- Business-readiness register rows in this area, decision columns still blank: HD-S04, HD-S05, HD-S09, HD-S14, HD-G13.

No approval, signature or production readiness is claimed or implied by this file.
