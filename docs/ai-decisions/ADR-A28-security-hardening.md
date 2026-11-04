# ADR-A28 — Security hardening: CSP report-only, enc:v3 secret boxes, private PDF temp dirs, Dependabot

Status: AI technical decision · 2026-11-04 · **proposal, not approved** — every switch ships OFF (today's
behaviour). Turning any of them on is a decision of the security owner, never of the agent. Nothing here is
production-ready until a person has run the steps under "Left for a person".

## Context (verified in code at goal/a-28)
- One enforcing CSP; normal pages keep `script-src 'self' 'unsafe-inline'` because of inline event handlers.
  There was no report-only policy and no report endpoint, so nobody knows how far the code is from a nonce-only CSP.
  B-01 already moved every library same-origin, so the target policy needs no CDN origin.
- `enc:v2` secret boxes use scrypt with a fixed salt and no AAD: a box copied from one `report_config` row to
  another (`smtp_pass` ↔ `meraki_api_key`) still decrypts.
- PDF rendering wrote `sdp-report-<site>-<period>.html/.pdf` into the shared temp folder and never removed them.
- No Dependabot configuration; SBOM and `npm audit` already exist in CI (not duplicated).

## Decision — four independent, revertible commits

| Part | Switch (.env) | Default (= today) | On |
|---|---|---|---|
| A-28a CSP report-only | `SDP_CSP_REPORT_ONLY=1` (read at boot) | no `Content-Security-Policy-Report-Only`, no endpoint | non-strict, non-override pages also send a report-only policy with `script-src 'self' 'nonce-…'` + `report-uri`/`Reporting-Endpoints`; their inline `<script>` tags get the nonce; `POST /api/security/csp-report` exists |
| A-28b enc:v3 | `SDP_CONFIG_BOX_VERSION=3` | new secrets sealed as `enc:v2` | new secrets sealed as `enc:v3:<salt>:<iv>:<tag>:<ct>` (scrypt with a random 16-byte salt per box, AAD = key name) |
| A-28c PDF temp | `SDP_PDF_SANDBOX=1` (sandbox only) | `--no-sandbox` kept | Chromium runs sandboxed |
| A-28d deps | — | — | `.github/dependabot.yml` (npm + actions, weekly, ≤ 5 PRs) |

- The report endpoint is unauthenticated by nature: mounted only with the switch, before the `/api` gate and the
  global JSON parser; accepts `application/csp-report` / `application/reports+json` only (415), ≤ 16 KB (413),
  60 requests/min/IP (429), answers an empty 204, stores only directive + blocked **origin** + document **path**
  (no query, long tokens cut), one `system_log` row (`security` / `csp_violation`) per triple and day, ≤ 2000/day.
  Note: `security` is a governance log category (7-year retention) — volume is bounded by the per-day dedupe.
- The private PDF directory (`fs.mkdtempSync(<tmp>/sdp-pdf-)`, random file names) is always removed (success,
  failure, timeout). Reading boxes: v1, v2 (both layouts) and v3 all read; a v3 box needs the passphrase **and**
  the key name, otherwise `null` (read as empty, logged) — never the ciphertext.
- `reencrypt-secrets.js --to=v3` (dry-run by default) is refused unless `SDP_CONFIG_BOX_VERSION=3`;
  `--to=v2` is the rollback path before running an older build (an older build cannot read v3).

## Enforcement path (later goal, not this one)
Report-only for ≥ 1 week → review the `csp_violation` rows (they are the inventory of inline handlers to move to
`addEventListener`) → fix → a separate goal flips the enforcing policy. Exact `package.json` pins were not made
(the lockfile already pins resolved versions; `npm ci` could not be run in the agent worktree).

## Left for a person
- Set `SDP_CSP_REPORT_ONLY=1` in prod `.env`, `pm2 stop` → wait → `start`, read `csp_violation` rows for a week.
- Optionally test `SDP_PDF_SANDBOX=1` with one manual coordinator preview send on the server.
- enc:v3: restore point → `SDP_CONFIG_BOX_VERSION=3 node tools/pg/reencrypt-secrets.js --to=v3` (dry run) →
  `--apply`, with `SDP_CONFIG_BOX_VERSION=3` set in `.env` before the restart. Rollback: restore point, or
  `--to=v2 --apply` with the switch unset.
- Enable Dependabot alerts/PRs in the GitHub repository settings if not already on.
