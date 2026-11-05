# SEC-01 — secure-SDLC control pass (2026-11-05)

Branch `goal/sec-01` (sdp-waves `d5b8da5` merged in, fast-forward). Sandbox evidence only — no approval, no
production claim. Every real finding was fixed with a failing-first test; theoretical items are documented.

## Controls run

| # | Control | Tool / command | Result | Action |
|---|---|---|---|---|
| 1a | npm advisories (prod) | `npm audit --omit=dev` | 0 vulnerabilities | none |
| 1b | npm advisories (all) | `npm audit` | 0 vulnerabilities | none |
| 1c | Non-registry dep | `xlsx` from cdn.sheetjs.com 0.20.3 (not audited by npm) | ≥ 0.20.2 → past CVE-2023-30533 (proto pollution) and the ReDoS fixed in 0.20.2 | none |
| 1d | Python (exec-pptx) | `tools/exec-pptx/requirements.txt` review | `pillow>=10.0` allowed versions with CVE-2023-50447 (fixed 10.2.0) and CVE-2024-28219 (fixed 10.3.0) | floor raised to `pillow>=10.3.0`; matplotlib 3.9 / python-pptx 1.0 / numpy 2 no known advisory |
| 1e | Vendored browser libs | `public/vendor/VENDOR.json` | chart.js 4.4.1, chartjs-plugin-datalabels 2.2.0, react/react-dom 18.3.1, Libre Franklin 5.3.0 — no known advisory; sha256-pinned by tests/vendor-libs.test.js. The only CDN scripts (dashboard-preview: react dev 18.3.1, @babel/standalone 7.29.0) carry SRI `integrity` | none |
| 2a | Secrets, tracked tree | `node tools/security/secret-scan.js` | clean (release gate) | none |
| 2b | Secrets, whole tree incl. tests/docs (normally skipped) | scanner rules over every tracked file (scratch script) | ~60 hits, all throwaway fixtures (tests/*, installer tests, `devpass` default of tests/pg-helpers.js, CI `postgres`) — classified Info | none |
| 2c | Secrets, history | `node tools/security/secret-scan.js --history` + `git log --all -p` grep for PATs/API keys/private keys | **3 hits**: `5f82968` ci.yml `ci-only-password` (CI throwaway, Info); `92a6a68` + `214c0d1` `tools/installer/config.psd1` `StandardPgSuperPassword` = `OneE…` (28 chars) — the PostgreSQL **superuser appliance password** (4MyPeople standard), removed from the tree in `95984c5` but **still in history**. No PAT / API key / private key ever committed (`sk-ant-...` hits are placeholders). The local test-cluster URL (scratch-only) is not in any commit. | **person**: rotate that superuser password on every server using it; history rewrite is NOT done (boundary) |
| 3a | Lint + eslint-plugin-security | `npx eslint .` (plugin already a devDep) | clean | none |
| 3b | child_process sinks | manual review | all `execFile`/`spawn` with argv arrays; schedules validate type/cadence/day/time by allow-list before `schtasks`; `serviceControl` uses `shell:true` on Windows with constant args only | none |
| 3c | SQL built from input | grep of template-literal SQL | identifiers come from allow-lists / fixed configs; LIMIT values clamped numbers; values always `?` | none |
| 3d | Path traversal | blobStore `_resolve` (relative-path guard), `safeFilename.safeJoin`, field uploads (owner + status checks) | no gap | none |
| 3e | SSRF | `services/safeUrl` on admin-set URLs (Teams, Meraki, OpManager, SDP); Zoho/Anthropic URLs are constants | no gap | none |
| 3f | Open redirect | `login.html` `location.replace(next)` with raw `?next=` | **REAL** — see F1 | fixed |
| 3g | Route authorisation | `tools/qa/route-matrix.js` against a throwaway PG db | the probe itself was **broken** (F2); after the fix: viewer gets 403 on 274 routes; 3 real gaps (F3) | fixed |
| 3h | CSRF | `services/originGuard` (Origin allow-list on state-changing requests) + `SameSite=Lax` httpOnly cookie | adequate | none |
| 3i | Headers / CSP | server.js + `services/sessionAuth.cspDirectives` | XFO DENY, nosniff, Referrer-Policy, HSTS, CSP `frame-ancestors 'none'`, `object-src 'none'`; non-strict pages keep `script-src 'unsafe-inline'` (tracked as A-28) | Info |
| 3j | Session cookie | `report_token`: httpOnly, `Secure` behind TLS (`netBinding.cookieSecure`), SameSite=Lax, 24 h | ok | none |
| 3k | Login throttle | per-IP persistent limiter (10/15 min, all attempts) | no per-account cap — F4 | built behind switch |
| 3l | Password hashing | PBKDF2-SHA512, 100 000 iterations, per-user salt | below OWASP 2023 (210 000) | Low — accept now; rehash-on-login is a separate change |
| 3m | Error leakage | `services/httpError.fail` → `{error:'internal_error', correlation_id}` on 5xx | ok; `/api/save-charts` returned the absolute server path (fixed in F3) | — |
| 3n | Prototype pollution | merges use spread / `Object.assign({}, …)`; no recursive merge of request bodies | no realistic path | none |
| 4 | CI | `.github/workflows/*.yml`, `dependabot.yml` | every action SHA-pinned; top-level `permissions: contents: read`, job-level escalation only where needed; no `pull_request_target`; secrets only via env; Dependabot for npm + actions. Low: `release.yml` passes the signing password on the `signtool` command line inside the runner (masked in logs, ephemeral runner) and interpolates `needs.package.outputs.version` into `run:` (tag-derived, maintainers only) | Low, documented |

## Findings

| ID | Severity | Finding | Fix / decision | Test |
|---|---|---|---|---|
| F1 | **High** | `public/login.html` followed `?next=` raw: a link to the REAL login page (`?next=https://evil…` or `?next=javascript:…`) redirected a freshly signed-in user off-site, or ran script in the dashboard origin | `Landing.safeNext()` (public/lib/landing.js): same-origin relative page only; anything else → role landing | `tests/login-next-redirect.test.js` (3, failed before) |
| F2 | Medium (control gap) | `tools/qa/route-matrix.js` probed `POST /api/reports/auth/logout` in registration order with the shared viewer session, so **414 of 643** later routes answered 401 and were never probed as a viewer — false assurance | session-ending routes probed last (`probeOrder`) | `tests/route-matrix-probe-order.test.js` (1) |
| F3a | Medium | `POST /api/notes`: any signed-in viewer overwrote the Executive Scorecard's shared commentary (page is `executive|scorecard-viewer`, scorecard-viewer is read-only) | `requireExecutiveOrSuperAdmin`; GET unchanged | `tests/sec01-route-roles.smoke.test.js` |
| F3b | Medium | `POST /api/save-charts`: any viewer wrote up to 50 MB to `data/chart_images.json` (disk fill) and the answer carried the server's absolute path; no page calls it | `requireRole('report-author')`, path dropped from the answer | same |
| F3c | Low | `GET /api/orgs`, `/api/workspaces`, `/api/views`, `/api/debug/raw-test`: Zoho tenant diagnostics (org/workspace ids, every view name, raw upstream headers) driven with the service token by any viewer; no page calls them | `requireSuperAdmin` | same |
| F4 | Medium | (parity with 1.11 `services/authThrottle.js`) login throttle per IP only and counts every attempt | `services/accountThrottle.js` — failed attempts per account in the existing `rate_limit_hits` table (scope `login-user`, no migration); over the cap → 429 without checking the password; success clears. **Switch `auth_account_throttle_enabled` = `0` (today)**, `auth_account_throttle_max` 10, `auth_account_throttle_window_min` 15. Fails open on a store error (per-IP limiter still applies) | `tests/login-account-throttle.smoke.test.js` (2) |
| F5 | Medium (latent) | (parity) field outbox `ticket` sent `p.site` to SDP unchecked: a site-scoped user could open a request naming any site or none. Inert while `sdp_api_write_enabled=0` | defect fix: a non-admin must name one of their own sites (canonical name sent); admin tier unscoped | `tests/field-ticket-site-scope.test.js` (2, failed before) |
| F6 | High (exposure, needs a person) | PG superuser appliance password in history (`92a6a68`, `214c0d1`) | **rotate**; history rewrite would need a separate authorised operator action | — |
| F7 | Info | Entra deprovisioning (parity: 1.11 `services/entraDeprovision.js`) does not exist here. SSO is dormant and the account is local + pre-provisioned, so a leaver's Entra disable already blocks the Microsoft sign-in, but **not** a password sign-in (`SSO_MODE=available/off`) and not a live 24 h session | **not built** — needs a Graph application permission (`User.Read.All`) the owner must grant; recommend a separate goal: nightly job behind `entra_deprovision_enabled='0'`, inert without SSO config, dry-run first | — |
| F8 | Low | PBKDF2 100k iterations | accept; propose 210k + rehash on next login | — |
| F9 | Info | `POST /api/reports/action/:uid/*` answer 404 before 403 (existence of a uid is observable) | accept (uids are random UUIDs) | — |

Viewer READ scope (125 GET routes answering 200 to a plain viewer, e.g. survey verbatims, assets inventory without
money) is the documented design ("viewer is a broad reader"); not changed here — a data-classification decision.

## Dependabot PRs (open on GitHub, assessed only — none taken here)

| PR | Bump | Assessment |
|---|---|---|
| #5 | nodemailer 10.1.7 → 10.3.1 | minor, **safe to take** after CI |
| #11 | playwright 1.56.1 → 1.64.1 (dev) | safe for CI; e2e browser download changes |
| #12 | codeql-action 3.26.6 → 4.39.1 | major of the action; v3 is being retired — take, keep SHA pin |
| #4 / #3 / #7 | upload-artifact 7 / download-artifact 8 / setup-node 7 | majors: upload+download must move **together** (artifact v4+ format); setup-node 7 needs a runner check. Take as one reviewed change |
| #2 | action-gh-release 3 | major; release job only — review inputs |
| #8 | express 5 | **not safe** as-is: path-to-regexp v6 syntax, `req.query` getter, error handling — needs a migration goal |
| #10 | eslint 10 | **not safe** as-is: flat-config/plugin compatibility (eslint-plugin-security, globals) to verify |
| #9 | pptxgenjs 4 | **not safe** as-is: PPTX golden fingerprint must be re-proved |
| #6 | dotenv 18 | major; default `quiet`/logging changes — low risk but review |

## Tests run (PostgreSQL, sandbox)

29 files, **126 pass / 0 fail / 0 skipped**: the 5 new files + authz-route-matrix, csp-headers/csp-report/
csp-no-inline-handlers, flag-register, readme-truth, api-key-injection, field-routes/field-outbox, landing,
business-only-boundary, dashkey-only-routes, rate-limit, report-config, sso-login, sso-routes, identity-log,
system-log-routes, secret-scan, await-precedence, html-pages-before-static, no-message-leak, exec-nav-consolidated,
catalogue-dry-run. `npx eslint` on every touched JS: clean. Route-matrix probe re-run after F2/F3 on a throwaway db.

## Left for a person
- Rotate the PostgreSQL superuser appliance password (F6) wherever it is in use; decide on a history rewrite.
- Decide `auth_account_throttle_enabled` (Security owner).
- Grant / refuse the Graph permission for an Entra deprovisioning job (F7).
- Take the safe Dependabot PRs; plan migrations for express 5 / eslint 10 / pptxgenjs 4.
