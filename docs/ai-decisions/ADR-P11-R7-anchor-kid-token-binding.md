# ADR-P11-R7 — Audit anchor key identifiers, strict ledger schema, and server-bound operator tokens

**Status:** AI decision (reversible engineering detail), 2026-11-21. Not a business approval, not a security sign-off.
**Context:** P11 round 7 findings O-8 (operations, P2), F-32 (data, P3), R7-A2 (audit, P3 / P2 until hardened) and
R7-A1 (audit, P3 / P2 if used as approval evidence). Fix 33 (`docs/agent-execution/FIX-33-AUDIT-OPS.md`).

## 1. Anchor key identifiers (O-8, F-32) — migration 137

**Problem.** Anchors were HMAC-signed with a key derived from `SDP_CONFIG_KEY`. After the documented key rotation (or a
restore on a server with another key) every old row was "forged"; the nightly job never anchors over a non-ok chain and
the anchor table is append-only, so the job failed every night forever. With no key at all, signed anchors read
"advisory" and the chain read ok.

**Decision.**
- Each anchor row records `kid` = first 16 hex of `HMAC(anchorKey, 'sdp-audit-chain-anchor-kid-v1')` — an
  identifier of the key, never the key.
- Classification (`services/auditChain.chooseAnchor`): kid = current kid → verified (bad signature = **forged**);
  another kid → **foreign**: "unverifiable (key rotated)", never forged, never the baseline; a kid-less signed row
  (written before migration 137) that does not match → foreign if it predates every kid-bearing row, forged after one.
- Foreign rows still **constrain** the live chain (their row count / anchored row must hold): a forged "other key" row
  can only add conditions, never lower the baseline; the last row signed by the current key stays the baseline.
- The nightly job, when the ONLY problem is a rotation (chain hashes intact, every constraint held, key + sig + kid
  columns present), logs `audit_chain_key_rotated` (old kids, new kid, ledgers) and writes new anchors under the current
  key; the chain resumes. A shortened chain behind a "rotation" stays `broken` and nothing is re-anchored.
- Signed anchors present and no key → `unverifiable` (the job fails and alerts; nothing unsigned is written meanwhile).

**Residual (stated, not hidden).** A holder of the application database login on an UNHARDENED database can insert an
anchor under a made-up kid and force an `audit_chain_key_rotated` event; it cannot lower the baseline, and the event is
visible in System Logs. The DBA hardening script (`tools/pg/harden-audit-grants.sql`, CAB step) remains the control.

## 2. Strict ledger schema and signature-column removal (R7-A2) — migration 137

**Decision.** `resolveLedgerSchema`: `SDP_LEDGER_SCHEMA` wins; otherwise `current_schema()`, and (a) without the env pin,
two schemas of the search path holding a ledger or an anchor table → `unverifiable`; (b) `audit_chain_meta`
(append-only, created by migration 137 with `ledger_schema = current_schema()` at migration time) must name the resolved
schema, and a meta table that exists elsewhere but not in the resolved schema → `unverifiable`. An empty anchor table
is labelled `none`, never `signed`. If signed anchors were ever written (`audit_chain_meta.signed_anchors`, a `kid` on
a row, or a nightly event) and the `sig` column is missing → `unverifiable`, never "advisory ok".

**Residual.** The owner of an unhardened database can drop the meta table, the kid column and the system_log events
together. Full protection requires `harden-audit-grants.sql` (it now also adds `kid` and hands `audit_chain_meta` to
`sdp_audit_owner`) and `SDP_LEDGER_SCHEMA=public`. Not claimed fixed beyond that.

## 3. Server-bound operator tokens (R7-A1) — migration 138

**Problem.** A token row inserted directly with the application database login (which `activate-switches` needs anyway)
was accepted: one person could file a four-eyes request "as" a colleague and approve it.

**Decision.**
- `operator_tokens.binding` = `HMAC(key derived from SDP_CONFIG_KEY, [token_hash, user_id, purpose, expires_at])`. The
  key is not in the database, so a row written with the database login cannot carry a valid binding.
- `check()` refuses a missing / wrong binding and a token with no `operator_token_issued` event naming its id; it consumes
  only after both checks. Without `SDP_CONFIG_KEY`, issuing and checking are refused (fail closed; route answers 409).
- The Policy Center request list shows, for a request whose reason names an operator token, whether the token has an
  issuance event, a valid binding and the requester's account; approval of such a request is refused (409) when any of
  the three fails.

**Residual.** Someone who holds BOTH the database login AND `SDP_CONFIG_KEY` (the server's `.env`) can still forge a
token; that is the server's own identity. A request row inserted without naming a token is shown with no token
evidence (PC-log, carried P3: `policy_change_requests` is not chained). Who holds those credentials is the G01 access
policy decision — not taken here.

## Rollback

`db/postgres_rollback/137_audit_chain_anchor_kid_drop.sql`, `db/postgres_rollback/138_operator_token_binding_drop.sql`
(manual, transactional), then revert the code. After rolling 138 back, every token is refused until the code is
reverted too.
