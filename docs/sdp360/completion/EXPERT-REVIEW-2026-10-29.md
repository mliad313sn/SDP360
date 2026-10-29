# Expert review — security (CISO / CISSP) and dashboard design, 2026-10-29

Two independent reviews of the consolidation branch, asked for by the requester: one security officer
(CISSP lens — authorisation, separation of duties, integrity of evidence, web hardening, outbound calls),
one data-visualisation / dashboard designer (clarity of figures, honest empty states, hierarchy, phone use).
Every finding below is either fixed on the branch with a test, or listed as open with its reason.

## Security — findings and outcome

| # | Severity | Finding | Outcome | Proof |
|---|---|---|---|---|
| S1 | Medium | An admin could name any deputy: themselves, or a deputy for a super_admin, a role holder or a meeting chair — authority handed over without a super_admin | Fixed: nobody names themselves; a deputy for an admin-tier account, a governance role holder or a cadence chair / secretary is a super_admin decision (fails closed if the check cannot run) | `tests/governance-roles.smoke.test.js` |
| S2 | Medium | Regrouping a site (country / business unit) could relax protected rules without the two-person approval | Fixed: the move is refused (409 `RELAXES_PROTECTED`, logged as a risk, nothing moved) while two-person approval is on; set the site values first. Same rule in `tools/governance/apply-values.js` | `tests/governance-policy-groups.smoke.test.js`, `tests/governance-values.test.js` |
| S3 | Medium | Calendar days (which pause the overdue rules) had no reason, no cap, platform-wide days open to the admin tier, and a non-numeric site id gave a 500 | Fixed: reason required, site validated, platform-wide days super_admin only, at most `CALENDAR_MAX_DAYS_PER_YEAR` (20) days per site and year for the admin tier | `tests/governance-roles.smoke.test.js` |
| S4 | Medium | The pages an anonymous visitor reaches (login, Exec View, share links) allowed scripts from two CDNs | Fixed: nonce + `'self'` only on those pages | `tests/csp-headers.smoke.test.js` |
| S5 | Low-Med | No explicit cross-site check on state-changing requests (only SameSite=Lax) | Fixed: `services/originGuard.js` refuses a browser POST / PUT / PATCH / DELETE from another origin or marked `Sec-Fetch-Site: cross-site`; server-to-server calls (no Origin) unaffected | `tests/origin-guard.test.js` |
| S6 | Low | Outbound URLs were checked once, then resolved again at connect time (DNS rebinding); a caller could pass `maxRedirects` | Fixed: connect-time lookup re-checks the address (caller TLS settings kept); guard options applied last | `tests/safe-url.test.js` |
| S7 | Low | A negative / fractional `?limit=` reached a `LIMIT` clause (500) | Fixed: every interpolated limit floored and clamped to ≥ 1 | `tests/limit-clamp.test.js` |
| S8 | Low | `/api/save-pptx` answered with the server's absolute path and stored any body | Fixed: only a ZIP-container body is stored; the answer names the file only | — |
| S9 | Low | The roles screen gave committee members everybody's site list | Fixed: names only below the admin tier | `tests/governance-roles.smoke.test.js` |
| S10 | Low | `apply-values.js --as=` accepted an inactive super_admin | Fixed: active account required | — |
| S11 | Low | The DBA script moved the audit tables to a separate owner but left the trigger functions with the application role, which could replace them to switch append-only / the hash chain off | Fixed: `sdp_append_only()`, `sdp_hash_chain()`, `sdp_chain_payload(jsonb)` move to `sdp_audit_owner` too; a later migration redefining them is a DBA step | `tests/audit-grants-rehearsal.test.js` |

Open, by design (not code): `'unsafe-inline'` remains on the authenticated legacy pages (progressive work, the
ratchet `tests/csp-inline.test.js` stops it spreading); the session cookie stays SameSite=Lax (Strict would break
SSO return and links from e-mail).

## Dashboard design — findings and outcome

| # | Finding | Outcome |
|---|---|---|
| D1 | Header nav overflowed under the user pill (laptop and phone) | Labels collapse to icons below 1400 px (title / aria-label kept); on a phone the icons move to a second full-width row; the user pill shows an initial |
| D2 | Tiles with no data looked like a value | "Not measured" tiles are quiet (grey, no RAG) and series with no point say so instead of drawing an empty axis |
| D3 | RAG relied on colour alone | Dots carry ✓ / ! / ✕ with an accessible label; RAG colours are tokens (`--rag-*`) |
| D4 | Single figures had no context | Target (coloured by its own RAG) and the change against the previous period (▲ / ▼, "pts" for %, good / bad by the KPI's direction) under every value |
| D5 | Per-site bars in arbitrary order, unmeasured sites mixed in | Worst first (RAG then value), % bars on a 0-100 scale, unmeasured sites folded into one line |
| D6 | The site selector implied fleet figures | The status line says which site the single figures are for and how many sites the per-site charts cover |
| D7 | Obligations: red even at zero, a total that silently missed a switched-off register | Red only when overdue > 0; a partial total is marked as such |
| D8 | Executive scorecard stuck on "Loading…" when a source is off; unusable on a phone | Loaders settle to "— not available"; phone layout wraps filters, two KPI columns, tables scroll inside their card |
| D9 | Governance tables pushed the page sideways on a phone | Tables scroll inside their card |

Verified in a browser at 1280 px and 390 px (no horizontal page scroll on the pages checked) and by
`tests/dashboard-design.test.js` (ordering, labels, context line, previous-period windows).
