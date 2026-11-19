# P11 qualification — Security seat

**AI review — not an independent human review.** Reviewer seat: security (authorization, site scope, money exposure,
sessions/SSO, CSP, secrets, supply chain, public/key-only routes). I did not write this code and did not modify it.

- Frozen SHA: `7eee8955568c0bcab2a6329f838ee432ffca9fd1` (clean clone `/home/user/qual/security`, verified with `git rev-parse HEAD`).
- `docs/agent-execution/` narratives were removed from the clone and NOT read.
- Raw logs: `/home/user/qual/out/sec-logs/` (outcomes.log, batch.log, rerun.log, probe.log, p11probe.test.js.txt = throwaway probe, not committed anywhere).
- Environment: PostgreSQL shared with five other seats (max_connections raised to 400 mid-run); Linux, Node from `/home/user/SDP360/node_modules`.

---

## 1. Evidence re-run (command · result · SHA)

Test command prefix for every row: `NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>`, `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, SHA `7eee895`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | `tests/authz-outcomes.smoke.test.js` (23 personas × every method of every /api route, money sentinel scan, snapshot equality with `docs/ops/authz-outcomes.json`, switch-narrowing step) | 5/5 pass, 308 s. Money scan: 2 982 non-reader 2xx bodies scanned, 28 reader bodies carry the sentinel (positive control works), **6 known exception hits, all `f:committee-member` on `/api/governance/portfolio*`** (see F2) | VERIFIED |
| E2 | `authz-matrix-json`, `authz-route-matrix`, `authz-handler-checks`, `rbac-external-writes`, `rbac-matrix.smoke`, `rbac-mutation.smoke`, `rbac-scope-frozen.smoke`, `rbac-ui-gates`, `rbac-write-scope.smoke`, 7 × `csp-*`, `session-security.smoke`, `secret-scan` (17 files) | 1st run: 85 tests, 83 pass, 2 file-level failures (`rbac-matrix.smoke`, `rbac-write-scope.smoke`) with `error: sorry, too many clients already` (PG 53300) | VERIFIED (83) |
| E3 | Re-run of the two failed files alone after max_connections=400 | 18/18 pass → the E2 failures are **environmental** (shared PG exhaustion), not product | VERIFIED |
| E4 | `node tools/security/secret-scan.js --check` | "no credential in the tracked files", exit 0 | VERIFIED |
| E5 | `node tools/security/csp-journey-report.js --check` | "CSP journeys: up to date", exit 0 | VERIFIED |
| E6 | `node tools/security/retention-inventory.js --check` (extra) | up to date, exit 0 | VERIFIED |
| E7 | `npm audit --omit=dev` | found 0 vulnerabilities | VERIFIED (at review time; registry-dependent) |
| E8 | `tools/security/authz-divergence-report.js`, `dashkey-consumers.js` | no `--check` mode; not run | NOT VERIFIED |
| E9 | Adjacent suites not assigned to this seat (`access-revocation`, `dashkey-only-routes`, `export-share-boundary`, SSO/Entra, `route-authz`) | not run by me | NOT VERIFIED |

Counts: **7 verified, 2 not verified.** No full suite was run (not assigned).

---

## 2. Claims I tried to break (throwaway probe, scratchpad only)

Probe file copied for audit at `/home/user/qual/out/sec-logs/p11probe.test.js.txt`; run against the real app booted on its own throwaway PG database.

| # | Claim | Attack | Outcome |
|---|---|---|---|
| A1 | AUTHZ-MATRIX row `POST /api/engagement/share` = "admin, editor — userSites" (share links are site-scoped) | Site-A **editor** asks for a public share link of a **published, group-wide (site_id NULL), executive-audience** report run; then GET `/share/<token>` with no session | **BROKEN.** 200 + token (72 h TTL default, up to 90 days); anonymous GET returns 200 with the group report HTML. See F1. |
| A8 | Report runs are scoped to the reader's sites | Site-A **viewer** GET `/api/report-studio/runs/:id` on the same executive-audience group run | 200 — any session reads group/executive runs in-app (part of F1) |
| A9 | Viewers cannot create share links | viewer POST share | 403 — holds |
| A2 | Metrics are site-scoped for non-admin | site-A editor `GET /api/metrics/helpdesk.resolution_sla_pct?site=<B>` | 403 — holds |
| A3 | External API: no key in URL, key required | `/ext/v1/metrics?api_key=x`, no key, `/ext/odata/Values` | 400 / 401 / 401 — holds |
| A4 | Dash key is not a browser credential; key alone does not open session routes | key + `Origin`; key alone; key alone on `/api/data/requests-raw` | 401 / 200 (`/api/ping`) / 401 — holds |
| A5 | `/api/exec/summary` is public and PII-free | anonymous GET, scan for requester/technician/email/subject/password/token keys | 200, none found — holds (shallow key scan only) |
| A6 | Editor cannot share another site's dashboard | editor share `direction` with site_id = B | 400 (no published version in a fresh DB) — **inconclusive**, the site check was not reached |
| A7 | Session token never accepted from the query string | `/api/reports/auth/me?token=…`, `?report_token=…` | 401 / 401 — holds |
| R1 | Roadmap publication share "never amounts" (L07) | code reading of `routes/governanceRoadmapAudience.js` + `services/roadmapAudience.js` | `sharedHtml` → `visible(snapshot,{money:false})` strips `MONEY_FIELDS`; shares limited to site/programme audiences; publication liveness re-checked at view time — holds by reading, **not executed** (switch off by default) |
| R2 | Session token not readable by page JS | code reading login route | token only in httpOnly cookie (`res.json({user})`), SameSite=lax — holds |

---

## 3. Findings

### P0 — none found
(F1 would be P0 if the server were reachable from outside the corporate network; the deployment notes say it sits behind IIS on an internal hostname. That reachability is an **assumption** I could not verify.)

### P1 — must fix before pilot

**F1 (P1) — A site-scoped editor can publish any group-wide report run to an anonymous public link; any session reads executive-audience group runs.**
- Where: `routes/engagement.js:91` — the report-run branch only refuses `!isAdmin(u) && r.site_id != null && !hasSite(...)`; a run with `site_id NULL` passes for every editor. Same pattern in `routes/reportStudio.js:63` (`visibleRun`): a published run with `site_id NULL` is readable by every session regardless of template `audience` (`executive`).
- Not gated by any switch: share links are live with the default config (`services/engagementStore.js:96`, no `*_enabled` check).
- Contradicts `docs/ops/AUTHZ-MATRIX.md:508` ("editor — userSites") and the threat-model I3 row. The outcome probe (E1) does not catch it because its seed has no site-less published run.
- Reproduce: create editor on site A; as author/admin generate + publish a run from a template with `audience: executive` and no site; as the editor `POST /api/engagement/share {target_kind:'report_run', target_key:<id>}` → 200 token; `GET /share/<token>` without cookie → 200 with the fleet report.
- Regression test to add: in `tests/export-share-boundary.smoke.test.js` (or the rbac outcome seed) — a site-less published run: editor share → 403; viewer `GET /api/report-studio/runs/:id` of an `executive`-audience run → 403; admin share → 200.
- Fix direction (recommendation, not applied): site-less run ⇒ admin tier (or report-author) only for share; read of a run gated on template audience.
- Rollback risk of the fix: low (narrows); existing links created by editors keep working until expiry — revoke them on deploy.

**F2 (P1, policy pending — human decision) — committee-member (no admin, no finance-viewer) reads portfolio amounts on 6 endpoints.**
- Evidence: E1 money scan known-exception hits: `GET /api/governance/portfolio`, `/deck.pptx`, `/project/:id`, `/project/:id/history`, `/report.html`, `/workbook.xlsx` as `f:committee-member`. Recorded as `KNOWN_OUTCOME_MONEY` in `tests/_rbac-matrix-core.js:480` with "policy decision pending".
- Inconsistent with the platform's own invariant elsewhere: roadmap publications explicitly deny committee members amounts (`governanceRoadmapAudience.js:44`). Same principal, two answers.
- This is a business policy, not something an AI may decide. Blocking for L02/L05/L07 pilots until Finance/InfoSec record the decision (RELEASE-GATES "Finance" + "Security — access policy" rows, both empty).
- Regression test exists and is honest: it fails when the exception stops reproducing, forcing a docs update.

### P2 — before general deployment

**F3 (P2) — Dash key injected into every session page by default and not tied to an account.** `ui_inject_dash_key='1'`, `dashkey_scope_mode='open'` (`services/reportConfig.js:532`). Any signed-in viewer can copy `window.__ak` from `index.html`/`executive.html`/`reports.html`/`analytics.html`/`executive-report.html` and keep calling the key-only routes (`/api/ping` + 9 fleet `/api/data/*` aggregates per `tests/dashkey-only-routes.smoke.test.js:16`) from a script after the account is deactivated, without site scope, until the key is rotated. Mitigated: key-only reach is pinned and logged (A4 confirmed key alone does not open session routes). Fix exists as switches (`restrict` + `ui_inject_dash_key=0`); needs the D-15 consumer inventory (Connectors row, empty).

**F4 (P2) — CSP: only 2 built-in strict pages (`/login.html`, `/exec-view.html`) + share view out of 62 HTML pages; all others `script-src 'self' 'unsafe-inline'`** (`services/sessionAuth.js:23,57`). Defence in depth only (session cookie is httpOnly — R2), but a stored XSS on any other page runs with the victim's session. The ratchet tests (E2) prevent regression, not the residual. Report-only switch `_cspReportOnly` is off by default.

**F5 (P2) — Money sentinel coverage is partial.** `MONEY_SENTINELS` seed only asset amounts + portfolio budget (`_rbac-matrix-core.js:476`). Finance actuals batches, time entries/EVM, budget periods beyond the one regex, WAN SLA credit amounts are not seeded, so a leak on those paths would pass E1. Code shows `/api/finance/actuals/*` gated by "admin role required" (batch.log), but that is a reading, not an outcome proof.

### P3 — later

- **F6** A6 inconclusive: dashboard share to another site was not exercised past "no published version"; add a seeded published dashboard to the probe.
- **F7** `/api/exec/summary` PII check here is a key-name scan only; the PII whitelist is enforced by `buildExecSummary` reading, not by a value-level test against seeded PII.
- **F8** Legacy pages still read `localStorage.report_token` (`public/access.js:8`, etc.) — harmless today (never written), dead path worth removing to avoid a future regression.

---

## 4. Optimistic claims challenged

- "Share links are site-scoped (userSites)" — false for site-less runs (F1).
- "Amounts: admin tier + finance-viewer only" (L05/L11 risk text) — false today for committee-member on the portfolio (F2); the test suite records it as an exception rather than a failure.
- "authz-outcomes covers every route for 23 personas" — true for reachability, but outcomes depend on the seed; objects the seed does not create (site-less runs, finance batches) are not exercised (F1, F5).
- E2 first-run red was environmental; I would not have accepted a green claim without the E3 rerun.

---

## 5. Per P03 lot — AI panel recommendation, not a decision

| Lot | Security-relevant content | Recommendation |
|---|---|---|
| L01 Daily work | none specific to this seat | GO PILOT (no security blocker found by this seat) |
| L02 Portfolio reading | `portfolio_site_scope_reads` narrows; committee money exception (F2) | CONDITIONAL — F2 policy decided and recorded |
| L03 Change control | site editors write plans (rbac-write-scope green) | GO PILOT |
| L04 Scheduling/collab | no finding | GO PILOT |
| L05 Time, money, benefits | money surfaces; sentinel coverage partial (F5); F2 | CONDITIONAL — F2 decided + finance/EVM sentinels added to the outcome probe |
| L06 Plan exchange | external connectors (credentials) — not reviewed in depth | CONDITIONAL — not reviewed by this seat |
| L07 Roadmap publication | public link "never amounts" holds by reading (R1); F1 is the same share subsystem | CONDITIONAL — F1 fixed first; one executed test of the roadmap share with amounts seeded |
| L08 Governance cadence | no finding | GO PILOT |
| L09 KPI trust | site scope on metrics holds (A2) | GO PILOT |
| L10 Reporting rhythm | report runs / shares (F1) | CONDITIONAL — F1 fixed |
| L11 Site ops evidence | asset money display (admin + finance-viewer) | CONDITIONAL — F5 sentinels for certified asset money |
| L12 Access hardening | throttle, grants, break-glass, export policy; lock-out risk | CONDITIONAL — break-glass drill evidence + InfoSec gate; switches are the right direction |
| L13 Ops resilience / identity | Entra deprovision dry run; F3 interacts (key survives deactivation) | CONDITIONAL — pair with F3 (D-15) |

Overall for this seat: **no lot that exposes shared reports or money should go to pilot before F1 is fixed and F2 is decided.**

## 6. Human gates still empty in this area (`docs/sdp360/completion/RELEASE-GATES.md`)

All rows are empty at `7eee895`. In this seat's area:
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08) — Information Security
- Security — threat model and findings register (G27) — Information Security
- Signing key and CI action SHAs D-12 (G-09) — Information Security + CI owner
- Connectors D-07/D-08/D-09, dash-key clients D-15 — Platform/infra owners (F3)
- Finance — budgets and benefits (G14) — Finance (F2)
- Penetration test / accepted analysis (E-B05, X-B-03) — Information Security
- QA lead — CI green on target SHA, skipped tests reviewed (E-B05) — QA lead
- Production deployment GO/NO-GO — CAB

No approval, signature or production readiness is claimed or implied by this file.
