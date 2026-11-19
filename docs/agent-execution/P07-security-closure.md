# P07 — Security closure and penetration-test readiness (evidence)

Lot `p07-security`, branch `qual/p07-security` from `e8900a7` (relaunch; every item below was re-verified at this
branch's HEAD, nothing taken from the lost first run). **This is not a penetration test and does not state that the
application has no vulnerability.** All reviews in this file are AI reviews, not a human security sign-off (RL-07).
No P0 found → no stop.

## 1. Open security items at HEAD

| Id | Item (source) | Status at HEAD | Owner (role) | What closes it |
|---|---|---|---|---|
| RL-01 | Historical PostgreSQL superuser value in git history (THREAT-MODEL, EX-01) | **open**. `secret-scan.js`: current tree clean; `--history`: 3 credential-shaped additions (`92a6a68`, `214c0d1` config.psd1; `5f82968` CI throwaway container). ROTATION-RECORD: every row UNKNOWN, history decision empty | security owner + DBA + repository owner | rotation on every cluster (EX-01 §3), history option A/B/C recorded |
| RL-02 | 16 key-only routes, callers unknown (D-15) | **open**, inventory re-confirmed (§5) | platform / integration owner | caller list from 30 days of `dashkey_call` logs, then restrict |
| RL-03 | No department-level access model (D-14) | open | PO + data owners | policy |
| RL-04 | DB owner can alter audit triggers | open (DBA step, rehearsed SQL exists) | DBA | protected role split in production |
| RL-05 | Production signing key absent | open | release owner | D-11/D-12 key ceremony |
| RL-06 | No load / soak baseline | open (P05 lane) | QA + infra | authorised staging |
| RL-07 | No human security sign-off | open | security owner | review of THREAT-MODEL + this dossier + an independent test |
| A-28 | CSP still report-only on legacy pages | **progressed**: 55 pages are candidates for the strict policy, 6 blocked (§2); enforcement stays a setting | security owner | report-only run, then `csp_strict_pages` |
| A-28 | `SDP_PDF_SANDBOX=1` server test; enc:v3 decision; Dependabot in GitHub settings | open (human, unchanged) | system owner / security owner / repo admin | per ADR-A28 |
| TM §4 "still open" | stuck `applying` entry action; expired session cache on shared phone; ticket requester names not in AI redaction; digit-only password redaction | unchanged (PO / data owner, AI off) | as listed in THREAT-MODEL | — |
| TM #21-24 | found and fixed in this lot (session tokens in list/URL, break-glass name public, tracker ignored `csp_strict_pages`, shell inline logout) | **fixed, tested** | — | — |
| TM #25 | dev previews served on the production origin with `unsafe-eval` + CDN origins (full installer only) | **open** | release owner | exclude from the installer bundle |
| Supply chain | `npm audit --omit=dev`: 0 vulnerabilities; full tree (dev): 3 moderate (dev only, not shipped — residual E4 "dev dependencies not audited at high") | as stated | — | — |

## 2. Content security policy

Inventory tool extended (no new tool): `tools/security/csp-journey-report.js` now writes an **All pages** section
in `docs/security/CSP-JOURNEYS.md` — every page under `public/`, its inline scripts, markup handlers, **handlers
built inside JS strings** by its own inline scripts and by the same-origin scripts it loads (the old scan missed
these: the shell's log-out pill was one, on every page), whether the server nonces its inline scripts
(`sendHtmlPage`), and a readiness. Result at HEAD: **63 pages — strict 2, candidate 55, blocked 6**.

Blocked (largest work last): `/analytics.html` (16 markup handlers), `/executive-report.html` (50 + 8 script-built),
`/executive.html` (65 + 10), `/index.html` (51 + 5), `/inspection.html` (40 + 19), `/reports.html` (184 + 80,
incl. `lib/reports-backups.js`). These are the heavily-edited legacy pages; not touched this round.

Migrated this round: `public/_shell.js` (log-out by delegated listener) and `public/help.html` (language buttons) —
both behaviour-identical. `public/project.html` was not edited (P09 lane); it is a candidate today, and the ratchet
test will fail if a later change adds an inline handler to it or to any other non-blocked page.

Mechanism unchanged: `report_config.csp_strict_pages` (default `''` = today). **PROPOSED value** (not applied; the
security owner decides after a report-only week with `SDP_CSP_REPORT_ONLY=1` and the `--violations` export) — the
candidate list printed at the end of the All-pages section of `CSP-JOURNEYS.md`.

Proof: `tests/csp-candidate-pages.smoke.test.js` boots the real app, sets the whole candidate list, and for each
served candidate (52 of 55; `data-quality`, `itsm-integrations-plan`, `workspace-settings` are behind off switches)
checks: nonce-only `script-src` with no origin, every inline script carries the request nonce, no markup handler,
no `javascript:` URL, no foreign script. It found the tracker defect (#23) on its first run. Limits: a static scan
cannot see scripts loaded later at run time, nor handlers a library builds — the report-only run is the proof for
those; no headless browser is installed in this container, so no browser run was made.

## 3. Single sign-on

`tests/session-security.smoke.test.js` (real app, password path) — `sso_mode` `off` and `available`: password
sign-in open to every account, break-glass name not published; `only`: a normal account is refused even with the
right password (403, no session), the break-glass account signs in, the use is written to the security journal
(`breakglass_login`); `only` with no break-glass account configured: **nobody** can sign in with a password.
Existing proofs: `sso-routes.smoke` (off: SSO routes 404), `sso-settings` (resolution, legacy flag), `sso-entra`
(token/PKCE), `sso-login` / `sso-provisioning` / `sso-grant-merge`. Deprovisioned Entra account:
`tests/entra-deprovision.test.js` "apply 1: disabled / deleted accounts deactivated (session refused)" — passes at
HEAD; break-glass is never sent to Graph. The OIDC callback itself (state/nonce/PKCE replay against a live tenant)
needs a TEST Entra registration: scenario 3 of the pentest.

**What `sso_mode = only` switches off** (for the security owner's decision — not taken here):
- password sign-in for every account except `sso_breakglass_user`; the login page hides the password form;
- every account without a linked Entra identity is locked out until linked (Admin ▸ Users e-mail / SSO mapping);
- during an Entra or network outage only the break-glass account can sign in (each use is a risk event; with
  `breakglass_timebox_enabled = '1'` it needs a reason and the session is capped in minutes);
- **if `sso_breakglass_user` is empty, nobody** — set and test the break-glass account before switching;
- not affected: dash-key server-to-server calls, external API consumer keys, share links, scheduled jobs, the field
  app (uses the same session as the browser); the leaver job (`entra_deprovision_enabled/_apply`) is independent.

## 4. Sessions

| Control | Test |
|---|---|
| fixation — a planted cookie/header token is never adopted; login issues a new one | `session-security.smoke` test 1 (new) |
| reuse after logout | `session-security.smoke` test 2 (new) |
| after deactivation | `access-revocation.smoke` "deactivating an account ends its open session" (existing) + `--pentest` deactivated account |
| after role removal | `access-revocation.smoke` "removing a privileged role…" (existing) |
| forced logout (and a viewer cannot) | `session-security.smoke` test 3 (new) + test 7 (by `session_ref`, own session refused, unknown ref 404) |

## 5. Public and key-only routes

Public (8, `authz-matrix.json`): `/health`, `/ready`, `POST /api/reports/auth/login`, `/api/auth/config`,
`/api/auth/sso/login`, `/api/auth/sso/callback`, `/api/exec/summary`, `/api/actions/open` (own Meridian key) — each
has a recorded reason; all eight are needed (probes, sign-in, SharePoint Exec View, Meridian). Retiring
`/api/actions/open` is possible if Meridian stays dormant (decision of the integration owner; key empty in prod
per the project memory).

Key-only (16, pinned by `tests/dashkey-only-routes.smoke.test.js`, passing): in-repo callers re-searched at HEAD
in `public/`, `routes/`, `services/`, `tools/` — `GET /api/ping` (executive.html, with session; tools/agent/authz-walk.js),
`GET /api/data/major-inc-by-cat` (executive-report.html, with session); **the other 14 `/api/data/*` have no in-repo
caller**. Same as DASHKEY-CLIENTS.md. **Proposal**: move those 14 to session-only once 30 days of `dashkey_call`
journal show no external caller (platform owner fills the column, D-15). Nothing changed.

## 6. Secrets

`node tools/security/secret-scan.js`: no credential in tracked files. `--history`: the three known additions
(values not shown). ROTATION-RECORD.md and the EX-01 history decision: **all fields empty** (human gate). A person
must rotate: the PostgreSQL superuser on every cluster that used the EX-01 value (production server shared with
4MyPeople, TEST, training/demo, developer machines with a production copy) and tell the other holders (4MyPeople
installer config, vault, runbooks); review `pg_hba.conf` and superuser logins since 2026-07-13; record the history
decision (recommendation in EX-01 §4: A). Recommended at the same time (not evidence of exposure): any integration
key ever pasted outside Admin (Zoho refresh token, Meraki, SMTP) — per the owners' records.

## 7. Supply chain

`xlsx` 0.20.3 from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`: lockfile integrity `sha512-oLDq3jw7…` —
tarball fetched 2026-11-19 and hashed: **identical**. SBOM (`tools/release/sbom.js`, 133 components) carries the
hash and the distribution URL. Offline copy: `tools/installer-build/download-cache.ps1` step 4b downloads it into
the installer cache and deletes it if its sha512 differs from the lockfile. The console installer already ships
`node_modules` (xlsx included). Pinned by `tests/supply-chain-xlsx.test.js`.

## 8. Tester package

`docs/security/PENTEST-SCOPE.md` § Tester package: TEST-instance build, one account per role
(`node tools/demo/seed-demo.js --pentest`, 21 synthetic accounts incl. multi-site, site-less, deactivated —
`tests/demo-seed.test.js` proves every matrix role is covered and the removal is exact), the authz matrix, the
scenario list (scenario 9 updated to the CSP state at HEAD), and the rules-of-engagement table **left empty** for
the security owner and system owner.

## Commands run (this lot)

All targeted, PostgreSQL 16 local throwaway (`PG_ADMIN_URL=…sdptest…`); the full suite was NOT re-run here (preamble:
the orchestrator runs it at merge).

| Command | Result |
|---|---|
| `shell-logout-no-inline` before fix | 3/3 fail; after: pass |
| `csp-candidate-pages.smoke` first run | fail on `/activity-tracker.html` (#23), then `/field/index.html` (test too strict on src scripts — test corrected); after fix 2/2 pass, 52/55 served |
| `session-security.smoke` test 7 before fix | fail "a full session token is in the list"; test 5 extension fail on break-glass name; after fixes 7/7 |
| shell suites (feedback-shell, shell-navigation, shell-skip-link, shell-nav-r4, i18n-shell-charts) | 48 pass |
| csp-journey-report (9), csp-strict-pages-config, csp-headers.smoke, help-*, a11y-static, csp-no-inline-handlers-new-pages | pass |
| access-denied-log.smoke, authz-route-matrix, dashkey-only-routes.smoke (6), sso-routes.smoke (4), server-size-budget, no-message-leak, sbom (4), supply-chain-xlsx (3), demo-seed (5) | pass (two runs hit "too many clients" from parallel agents and were re-run) |
| `node tools/security/csp-journey-report.js --check` | up to date |
| `node tools/agent/inventory.js` + `--strict` | regenerated |
| `npm audit --omit=dev` / full | 0 / 3 moderate (dev only) |
| `npx eslint` on every touched file | clean |

## Changed

Files: `public/_shell.js`, `public/help.html`, `public/reports.html` (one attribute: `session_ref`),
`routes/adminUsers.js`, `server.js` (2 lines: tracker override script-src, break-glass name), `tools/security/csp-journey-report.js`,
`tools/demo/seed-demo.js`, `tools/installer-build/download-cache.ps1`, docs (`CSP-JOURNEYS.md` generated,
`PENTEST-SCOPE.md`, `THREAT-MODEL.md`, inventory), tests (4 new files, 2 extended, manifest).
Migrations: none. Switches: none added, none flipped (`csp_strict_pages` default stays `''`). The three defect fixes
ship on (preamble rule), each with a failing-first test.

## Human decisions now unblocked

1. Security owner: run report-only (`SDP_CSP_REPORT_ONLY=1`) for a week, then set `csp_strict_pages` (PROPOSED list).
2. Security owner: `sso_mode` — the switch-off list above; set and test the break-glass account first.
3. Platform owner: D-15 for the 14 key-only routes with no in-repo caller.
4. Security owner + DBA + repo owner: EX-01 rotation rows and the history decision.
5. Release owner: exclude the dev previews from the full installer (#25).
6. Security owner + system owner: sign the rules of engagement and commission the independent test.
