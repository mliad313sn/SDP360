# ADR-P07 — Security closure choices (AI decision, reversible engineering only)

Status: accepted by the agent for engineering details; every business / risk decision is left PROPOSED.
Context: prompt P07 (security closure, pentest readiness). Evidence: `docs/agent-execution/P07-security-closure.md`.

## Decisions

1. **Extend the existing CSP journey report instead of a new inventory tool.** One generated file
   (`docs/security/CSP-JOURNEYS.md`, `--check` in place) now also lists every page and the inline handlers built
   inside JS strings. A ratchet test freezes the blocked set (6 pages) so it can only shrink.
   *Reversal:* drop the All-pages section; the journey section is unchanged.
2. **"Candidate" counts inline `<script>` blocks as fine when the page is rendered by `sendHtmlPage`**, because the
   server adds the request nonce to them on strict pages (`services/sessionAuth.nonceScripts`). Handlers (markup or
   script-built) and `javascript:` URLs always block. A report-only run remains the acceptance proof.
3. **No page is enforced by this lot.** `csp_strict_pages` stays `''`; the candidate list is a PROPOSAL for the
   security owner (RELEASE-GATES: no invented approval).
4. **Three defects fixed on (preamble: defect fixes ship on), each failing-first:** session tokens in the
   active-sessions list / DELETE URL → opaque `session_ref` (full token still accepted for API clients, so no client
   breaks); break-glass name no longer public (field kept, always null); the tracker path override honours
   `csp_strict_pages`.
5. **`seed-demo --pentest` instead of a new account script**: same production refusal, same inventory and exact
   removal; default run unchanged.
6. **Offline xlsx tarball verified against the lockfile hash in the cache script** (delete on mismatch) rather than
   committing the tarball (2.4 MB binary, licence copy questions) — the console installer already ships `node_modules`.

## Not decided here (human)

`csp_strict_pages` value; `sso_mode`; D-15 key-only retirement; EX-01 rotation and history; excluding the dev
previews from the installer; the pentest rules of engagement and sign-off.
