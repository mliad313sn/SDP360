# SDP Dashboard — Module remediation programme (control plane)

Source: *SDP Dashboard — Final Analysis and Module-by-Module Remediation /goal Library* (27 Oct 2026).
Operating state: **DEVELOPMENT ONLY — NOT APPROVED FOR PRODUCTION.** Nothing here is a release,
UAT, security-approval, performance or accessibility certification.

## Run log

### Run 1 — 2026-10-28 · M00 Phase 0 + M01 baseline + first M02 P0 fix

| Field | Value |
|---|---|
| Base | `samaziz679/sdp-dashboard` `main` @ `758a996` (shallow clone), working branch `claude/confident-pascal-03veex` |
| Environment | Linux container, Node v22.22.0, npm 10.9.4, sqlite only (no PostgreSQL, no prod snapshot, no Python/matplotlib) |
| Batch 2 inputs | **ABSENT from the repository**: `GAP-BACKLOG.csv`, `CHART-CONTRACT-REGISTER.csv`, `PERSONA_AUDIT_BATCH2.md`, `TEST_EVIDENCE_BATCH2.md`, `batch2-*.log`, `browser-persona-smoke.json`. F01-F24 and the 41 chart contracts could therefore NOT be imported — IDs are reserved, not invented (see TRACEABILITY.md). **BLOCKED** until supplied. |

Registers produced: [MODULE-REGISTER](MODULE-REGISTER.md) · [PAGE-INVENTORY](PAGE-INVENTORY.md) ·
[RBAC-MATRIX](RBAC-MATRIX.md) · [PERSONA-COVERAGE](PERSONA-COVERAGE.md) · [TEST-MATRIX](TEST-MATRIX.md) ·
[TRACEABILITY](TRACEABILITY.md) · [RISKS](RISKS.md) · [RELEASE-GATES](RELEASE-GATES.md) · [DAG](#dependency-dag)

Verified inventory (counted from source, not estimated): **27** route modules in `routes/` · **74** HTML pages ·
**511** registered Express routes, **449** under `/api` · **19** pages referencing external hosts ·
**670** JS files + **55** inline scripts parse (`npm run lint` syntax stage).

### M01 evidence (commands + exits)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npm ci` | 0 | better-sqlite3 + xlsx (vendored tgz) install cleanly on Node 22 — the Batch 2 dependency block **does not reproduce** here |
| 2 | `npm test` (no env) | 1 | 2561 tests · 2392 pass · **62 fail** · 2 cancelled · 105 skipped |
| 3 | `DASH_USER=… DASH_PASS=… npm test` | 1 | 2550 · 2438 pass · **1 fail** · 2 cancelled · 109 skipped |
| 4 | `npm run lint` | 0 | syntax OK + eslint clean (after this run's changes) |
| 5 | `npm run audit` (before) | 1 | 1 high: `body-parser <1.20.9` GHSA-27r3-jxmh-p828 |
| 6 | `npm audit fix --omit=dev` → `npm run audit` | 0 | body-parser 1.20.9, 0 vulnerabilities (lockfile only) |

Classification of non-passes:
- **61 of 62 (run 2)** — `ENVIRONMENT`: suites boot `reports-db` which refuses to seed without `DASH_USER`/`DASH_PASS`. Not a product defect; CI must export them (WP-M01-001).
- **1 (run 3)** `tests/frontend-build.test.js` — `ENVIRONMENT`, caused in this run by `--omit=dev` pruning esbuild; after `npm ci` it passes.
- **2 cancelled** `tests/send-weekly-report.test.js` (tests 34-35, "promise still pending") — `FAILED / pre-existing`: reproduces identically on the untouched base. WP-M01-002.
- **105-109 skipped** — `BLOCKED`: 79 "no pg", 16 "Postgres not reachable", 9 "no prod-snapshot", 3 Windows-only packaging, 1 python. The pg parity half of the suite has NOT run in this environment.
- Migrations, SAST beyond eslint-plugin-security, and browser E2E: **NOT RUN** (no PG, no approved nonproduction browser target).

### M02 — F-M02-001 (P0) fixed in source

**Finding:** `sendHtmlPage(…, injectApiKey=true)` embedded `window.__ak='<DASHBOARD_API_KEY>'` into
`/`, `/index.html`, `/executive.html`, `/analytics.html`, `/reports.html`, `/executive-report.html`
for **any** visitor, including anonymous ones (`auth.js` redirects to login only *after* the HTML,
key included, has been delivered). The key alone passes the global `/api` gate and reached **19 routes**
with no session (route probe, RBAC-MATRIX "Dash-key-only"): `/api/data/*` Zoho proxies (13),
`/api/risk-register-export`, `/api/orgs`, `/api/workspaces`, `/api/data/ticket-volume`,
`/api/data/changes{,-it}`, `/api/ping`.

**Fix:** `server.js` `sendKeyedHtmlPage(req,res,…)` injects the key only when the request carries a
valid session (`x-report-token` header or `report_token` cookie, validated via `rdb.validateSession`).
Signed-in behaviour is unchanged (login sets the cookie).

**Evidence:** `tests/dashkey-injection.smoke.test.js` — 18 assertions (6 page URLs × anonymous / forged cookie / valid cookie).
On the base commit: **12 fail** (leak reproduced). With the fix: **18 pass**. `tests/route-authz.smoke.test.js` still green.
Status: **TESTED_SYNTHETICALLY** — needs staging verification + rotation of the existing production key (human gate, RISKS R-01).

### Run 2 — 2026-10-28 · repository moved to `mliad313sn/SDP360`

Full history (1236 commits from `samaziz679/sdp-dashboard`) pushed to `mliad313sn/SDP360` branch
`claude/confident-pascal-03veex`; that is now `origin` for all further work.
- WP-M01-001 FIXED — `npm test` preloads `tests/_default-env.js` (throwaway creds, never overrides). Suite with no `.env`: **0 fail** (was 62).
- WP-M01-002 FIXED — the 2 cancelled `send-weekly-report` tests were a test artifact; now 10/10.
- WP-M02-002 REVIEWED — the 31 guard-less routes are classified in TRACEABILITY.md; 19 dash-key-only routes remain an owner decision.
- WP-M02-003 DONE — T-M02-004 fails CI if any new route answers the dash key without a session.

### Run 3 — 2026-10-28
- WP-M02-004 — `tests/cross-site-object-writes.smoke.test.js`: a site-A editor is refused on every site-B meetings/inspection id-keyed write (action/issue update, add action, sign, delete, export) and the object is verified unchanged server-side; positive control on own site. Handlers already enforced it — no source change. Proven by a mutation check.
- Branch on `samaziz679/sdp-dashboard`: deletion requested by the user; the session proxy refuses ref deletion → to be deleted in the GitHub UI.

## Dependency DAG

Validated against the repository (no deviation from the roadmap order found yet):

```
M00 ─┬─ M01 deps/CI ── (env WP-M01-001/002 open)
     ├─ M03 page inventory ── (PAGE-INVENTORY done; owner/persona per page open)
     └─ M04 shared contracts
            ▼
     M02 authn/authz ── F-M02-001 fixed · WP-M02-002 (31 guard-less routes) open
       ├─ M02A model ─ M02B admin UX ─ M02D lifecycle ; M02C perf (needs M19)
       ├─ M06 business-only · M14 exports · M15 actions
       └─ M05 · M07 · M08 · M09→M10 · M11→M12 · M13
            ▼
     M16 integrations + M17 CSP/assets → M18 a11y · M19 perf · M20 recovery → M21 UAT → M22 release board
```

## Next dependency-safe work packages
1. **WP-M02-005** — same object-substitution sweep for trackers (`/entries`, `/import`), field (`/inspections/:id`, `quick-actions`), cockpit `actions/:id`, engagement `fires/:id/comments`, reports `action/:uid/*`.
2. **DEC-06 / R-02** — decide whether the 19 dash-key-only routes move behind a session (needs inventory of external X-Dash-Key clients).
3. **T-M01-005** — run the pg half (`PG_TESTS_REQUIRED=1`) in a nonprod with PostgreSQL.
4. Obtain the Batch 2 artifacts (blocks F01-F24 + 41 chart-contract import, M05).
