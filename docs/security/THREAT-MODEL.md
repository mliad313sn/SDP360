# SDP360 — threat model and risk ledger (G03)

Status 2026-10-29. Method: STRIDE per entry point, built from the code (not from the documentation). Each
mitigation names the file that implements it and the test that proves it. A residual risk names the owner who
must accept or close it. **Not a penetration test**: nothing here was run against a live system (G21 rule).

## 1. System and trust boundaries

```
 Browser (staff, field phone)  ──TLS (IIS)──▶  Node/Express (Windows service)  ──▶  PostgreSQL 17 (local)
 External consumers (/api/v1, /ext, OData) ─┘          │
                                                       ├──▶ Zoho Analytics / SDP Cloud API (read)
                                                       ├──▶ OpManager (read, on-prem), Meraki cloud (read)
                                                       ├──▶ Teams / SMTP / SharePoint (outbound, armed OFF)
                                                       └──▶ AI provider (OFF by default)
```

Boundaries: (B1) internet/LAN → IIS; (B2) IIS → Node (loopback only, `services/netBinding.js`); (B3) Node →
PostgreSQL (application role, not superuser); (B4) Node → external services (outbound allow-list); (B5) imported
files (xlsx/csv/AD/Defender exports) → database.

## 2. STRIDE by entry point

| # | Entry point | Threat | Mitigation (file) | Proof (test) | Residual |
|---|---|---|---|---|---|
| S1 | Login (password) | Spoofing: credential stuffing | persistent login limiter `services/rateLimit.js`; PBKDF2-SHA512 (100 000 rounds), constant-time compare, unknown users cost the same | `tests/rate-limit.test.js`, `tests/password-compare.test.js` | MFA only through Entra SSO (SSO is dormant until the app registration exists) |
| S2 | Session cookie | Spoofing: stolen token | `httpOnly`, `Secure`, `SameSite=Lax`; server-side session table checked on every request, disabled user refused at the next call | `tests/auth-cookie.smoke.test.js`, `tests/access-revocation.smoke.test.js` | token lifetime 24 h |
| S3 | Dash key (server-to-server) | Spoofing: shared key reuse | constant-time compare (`services/safeCompare.js`); key-only routes pinned to 16 (`tests/dashkey-only-routes.smoke.test.js`); every key-only call logged | same | **D-15**: owner must list the real callers, then the routes can be restricted |
| T1 | Writes (POST/PUT/PATCH/DELETE) | Tampering via cross-site request | Origin / Sec-Fetch-Site check (`services/originGuard.js`) + SameSite=Lax | `tests/origin-guard.test.js` | no CSRF token (accepted: same-origin app, modern browsers) |
| T2 | Object writes (reports, meetings, inspections, commitments, handoffs…) | Tampering with another site's data | site authorisation helpers (`services/userSites.js`, `_authorizeReportWrite`, route guards) | `tests/authz-route-matrix.test.js`, `tests/rbac-write-scope.smoke.test.js` and 10 site-scope suites | department-level grants do not exist (D-14) |
| T3 | Audit trail | Tampering with evidence | append-only triggers + hash chain (`db/postgres/reports/034_audit_hash_chain.sql`, `services/auditChain.js`), nightly anchor | `tests/audit-chain.test.js` | DBA-owned roles: the application owner can still drop triggers (G04: protected grants are a DBA step) |
| T4 | Imports (xlsx/csv) | Tampering: formula injection reaching a later export | exports neutralise formula cells (`public/lib/csvSafe.js`) | `tests/csv-safe.test.js`, `tests/csv-guard-coverage.test.js` | imports are not filtered; harmless while every export goes through `csvSafe` |
| R1 | Any refused call | Repudiation of probing | 401/403 written to the security log per actor + route (G02) | `tests/access-denied-log.smoke.test.js` | 12-month retention |
| I1 | Reads by id / by site | Information disclosure across sites | central read guard (`server.js` `_REPORT_ID_READ`, `_SITE_ID_READ`) + per-module scope | `tests/report-read-scope.smoke.test.js` and site-scope suites | `/api/risk-register-export` and `/api/sync/*` are session-only (no site data by site, by design) |
| I2 | Asset money | Disclosure of financial values | `requireMoneyRead` (admin / finance-viewer) | `tests/assets-money-scope.smoke.test.js` | portfolio budget fields are visible to every session (G12) |
| I3 | Share links / external API | Disclosure after revocation | hashed tokens, expiry ≤ 90 days, view caps, revocation (`services/engagementStore.js`); per-consumer API keys | `tests/engagement-store.test.js`, `tests/export-share-boundary.smoke.test.js` | links are bearer tokens, not signed per recipient |
| I4 | AI commentary | Disclosure of ticket text to a cloud model | `AI_PROVIDER=off` by default; facts-only input, sites pseudonymised for cloud (`services/aiCommentary.js`) | `tests/ai-commentary.test.js` | the interactive deck-builder proxy has no name/e-mail redaction (G20) |
| I5 | Secrets at rest / in git | Disclosure | `SDP_CONFIG_KEY` encryption of stored secrets (scrypt v2), secret scan blocking in CI and release (`tools/security/secret-scan.js`) | `tests/secret-scan.test.js`, `tests/config-secrets*.test.js` | **historical superuser password in git history** — rotation + history decision (`EX-01-CREDENTIAL-INCIDENT.md`) |
| D1 | Login, exports, heavy reports | Denial of service | throttle, body limits per route, job lock (one run per job) | `tests/sync-runner.test.js` | no load test yet (G21) |
| E1 | Role gates | Elevation | `requireRole([...])`, hierarchy in `reports-db.userHasRole`; every new route is probed anonymously and as viewer | `tests/authz-route-matrix.test.js` | — |
| E2 | Outbound webhooks (SSRF) | Elevation into the internal network | `services/safeUrl.js`: https only, private/loopback/metadata ranges refused, re-checked at connect time (DNS rebinding), no redirects, host allow-list | `tests/safe-url.test.js` | allow-listed hosts are not re-checked at connect time |
| E3 | TLS to OpManager | Man-in-the-middle | verification on; `opmanager_tls_insecure` is an explicit admin opt-in, CA bundle preferred | `tests/opmanager-client.test.js` | — |
| E4 | Supply chain | Malicious dependency / action | lockfile + `npm ci`; `npm audit --audit-level=high` blocking; every GitHub Action pinned by SHA; CodeQL; SBOM in every release (`tools/release/sbom.js`) | `tests/sbom.test.js`, `tests/ci-config.test.js` | dev dependencies are not audited at `high` (not shipped) |

## 3. Risk ledger (open items needing a named owner)

| Id | Risk | Likelihood / impact | Owner | Precondition to close |
|---|---|---|---|---|
| RL-01 | Historical PostgreSQL superuser password readable in git history | high / high | security owner + DBA | rotation on every cluster that used it (EX-01 §3) |
| RL-02 | 16 key-only routes with unknown external callers | medium / medium | integration owner | D-15 caller list, then restrict |
| RL-03 | No department-level access model | medium / medium | PO + data owners | D-14 policy (who sees which department) |
| RL-04 | Application DB owner can alter audit triggers | low / high | DBA | protected role split on the production cluster |
| RL-05 | Production signing key absent (packages unsigned) | medium / high | release owner | D-11/D-12 key ceremony |
| RL-06 | No load / soak baseline | medium / medium | QA + infra | authorised staging (G21) |
| RL-07 | No human CISO / security sign-off on the release | medium / high | security owner | review of this threat model and the release candidate |

## 4. Independent security review of the 2026-10-29 changes (CISSP lens, read-only) — outcome

No critical or high finding. Medium/low findings and their fix (all with a regression test):

| # | Finding | Fix | Test |
|---|---|---|---|
| 1 | anonymous probing of many paths could flood the refusal log and grow memory | anonymous refusals keyed on ip + status; at most 20 rows per ip per 10 min; bounded maps | `tests/access-denied-log.smoke.test.js` |
| 2 | stage-gate SoD compared the owner to the username only; owner could be swapped around an approval | owner matched on username, full name or e-mail; owner frozen from approval, sponsor from execution; role changes in the ledger | `tests/project-schedule.test.js`, `tests/ppm-project-lifecycle.smoke.test.js` |
| 3 | a session token in a refused path could be logged in full | long opaque path segments cut to 8 characters | `tests/access-denied-log.smoke.test.js` |
| 4 | CSV/XLSX/PPTX exports and share links did not use the frozen publication; publish + freeze not atomic | every format and share links served from `report_publications`; a failed freeze reverts the run to reviewed | `tests/report-release.smoke.test.js` |
| 5 | STOP switch ignored digests and scheduled publication | `notifications_stop` checked by every engagement job | `tests/alert-outbound-arm.test.js` |
| 6 | RFI → project not atomic; project deletion not in the ledger | one INSERT carrying `rfi_id` (unique index); deletion recorded with its budget | `tests/ppm-project-lifecycle.smoke.test.js` |
| 7 | status editable around the stage gates | status follows the stage once out of proposal (409 STATUS_BY_STAGE) | same |
| 8 | finance-viewer could read every RFI decision trail | RFI history is committee-only | same |
| 9 | a replayed idempotency key could name another step | key bound to its step (409 otherwise) | `tests/handoffs.smoke.test.js` |
| 10 | refused correction left an orphan run; one withdrawn run could be corrected twice | checks before generating; one correction per withdrawn run | `tests/report-release.smoke.test.js` |
| 11 | append-only triggers can be dropped by the table owner; TRUNCATE not blocked | **DBA step** on the production cluster: application role not owner, no TRUNCATE (rehearsed SQL in `tests/audit-grants-rehearsal.test.js`); the hash chain + nightly anchor detect a rewrite meanwhile | — |

This is an AI specialist review, not a human CISO sign-off: the sign-off stays a release gate (RL-07).
