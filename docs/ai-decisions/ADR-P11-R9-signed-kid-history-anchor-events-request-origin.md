# ADR-P11-R9 — Signed kid history, signed anchor events, append-only audit_chain log rows, Policy Center request origin signatures

**Status:** AI decision (reversible engineering detail), 2026-11-21. Not a business approval, not a security sign-off,
not a production-readiness statement.
**Context:** P11 round 9 findings O-14 / R9-2 / security observation (kid history writable by the app role), O-16
(unsigned high-water mark), R9-A1 (owner launders on an unhardened database), R9-A2 / N-R9-1 (token evidence keyed on a
forgeable `source`, replayable), R9-A4 / O-15 / R9-3 (unbound counts file), R9-A5 (non-numeric sample count), O-17
(login 500 during a DB outage). Fix 39 (`docs/agent-execution/FIX-39-AUDIT-OPS.md`). Supersedes the kid-history rule
(`kid:<kid>` meta rows) of ADR-P11-R8 §1 and its `source='cli'` / reason-marker check (§3); everything else stands.

## 1. Signed kid history (O-14, R9-2)

**Problem.** The nightly job trusted any `audit_chain_meta` row `kid:<kid>`; the app role keeps `INSERT` on that table
even once hardened (the job writes it), so the same login that can append a forged anchor could also make its kid
"known" and get the forged row absorbed into a rotation.

**Options considered.** (a) Revoke INSERT from the app role and write through a `SECURITY DEFINER` function owned by
the audit owner — rejected as the primary control: the function cannot check an HMAC without the key, so it would only
move the forgery one call away. (b) Sign the kid history with a key derived from `SDP_CONFIG_KEY` (outside the
database) — chosen.

**Decision.**
- A kid becomes "known" only through an **attestation** `kidatt:<attested kid>:<attester kid>:<hmac>` whose HMAC
  (key = HMAC(anchor key, `sdp-audit-chain-kid-history-v1`)) verifies under a key the server **holds**: the current
  `SDP_CONFIG_KEY` or the previous one, `SDP_CONFIG_KEY_OLD` (the variable `reencrypt-secrets.js` already uses). The
  signature sits in the meta KEY, so a row inserted beforehand can never pre-empt the job's row in the append-only
  table. Legacy `kid:` rows and invalid attestations are ignored and counted (`evidence_ignored.kid_rows`).
- The job writes a self-attestation of its kid every signed night, and on a resume re-attests every kid it trusted
  under the new key — a chain of rotation entries (A→B attested by B; at B→C, C re-attests A and B).
- **Why the previous key is needed.** After a rotation the job holds only the new key; an attestation signed by the old
  key cannot be checked without it, and nothing the job wrote under the old key can be verified under the new one. The
  instruction "sign the rotation only if A was previously signed" is therefore implemented as: the job verifies A's
  history (and A's anchor signatures — a row claiming kid A with a wrong signature is `broken`) with
  `SDP_CONFIG_KEY_OLD`, or a human holding the **current** key records the decision with
  `tools/pg/audit-chain-accept-rotation.js --kid=… --i-confirm-documented-rotation` (the tool refuses without the
  confirmation flag; it never decides).
- **Behaviour change, stated:** a rotation (or a restore onto a server with another key) no longer resumes on its own
  from a plain meta row: the operator keeps `SDP_CONFIG_KEY_OLD` for one nightly run (runbook updated), or uses the tool.
  Until then the job fails `unverifiable` with the remedy in the error — fail closed, alert raised.

## 2. Signed anchor events (O-16)

**Decision.** The nightly `audit_chain_anchor` event carries `hwm_sig` = HMAC over (schema, kid, the logged positions)
under a key derived from `SDP_CONFIG_KEY`. The high-water mark (and the "ledger was anchored" list) is built only from
events whose signature verifies under a key the server holds; unsigned / altered events are ignored and counted
(`evidence_ignored.log_events`). With **no** key on the server nothing can be signed: anchors are advisory and events
are read as before (unchanged behaviour of the keyless mode). Events signed under the previous key count only while
`SDP_CONFIG_KEY_OLD` is set; the job's own new events take over the next night.

## 3. Append-only audit_chain rows in system_log (R9-A1) — migration 140

A `BEFORE UPDATE OR DELETE` trigger on `system_log` refuses any UPDATE touching an `audit_chain%` row and silently keeps
such rows on DELETE (row trigger returns NULL), so the 7-year retention purge still removes every other row and never
fails. TRUNCATE is not guarded (the test harness truncates the table). `tools/pg/harden-audit-grants.sql` now hands
`system_log` and the guard function to `sdp_audit_owner` (the app role keeps SELECT, INSERT, DELETE) — a DBA / CAB step.
**Residual, stated, not fixed:** on an UNHARDENED database the owner can still disable the trigger and erase anchors,
audit_chain events and meta rows; with §1–§2 it can no longer make a forged kid known or a forged event count without
the key. Whoever holds `SDP_CONFIG_KEY` and the database can forge everything (G01 / HD-S04 separation of duties —
human decision).

## 4. Policy Center request origin signatures (R9-A2, N-R9-1) — migration 140

**Problem.** Fix 36 detected "CLI-filed" requests from `source='cli'` (no writer ever set it) or a reason marker — both
chosen by the forger — and token evidence did not bind the token to the request (replayable).

**Decision.** `policy_change_requests` gains `origin` ('web' | 'cli'), `origin_sig`, `operator_token_id`;
`operator_tokens` gains `bound_request_ids`. Only `services/policyChangeStore.create` writes requests: it inserts the
row, signs it (HMAC keyed from `SDP_CONFIG_KEY` over id, requester, time, origin, key, scope, values, reason, token id —
`services/policyOrigin.js`) and, for a CLI request, binds the consumed operator token to the new id, in one transaction.
Approval of **every** `pc-` request verifies the signature first (409 "request not created by a trusted path"),
whatever the `source` value; a CLI-origin request also needs a token issued by the server, of the same account,
consumed, and bound to THIS request id (a replay → 409). Without `SDP_CONFIG_KEY` nothing is filed (409, fail closed).
**Requests pending before migration 140 carry no signature and are refused**: reject and re-file (safe default chosen
over a migration-time back-signing that would launder rows of unknown provenance). Governance proposals (`gp-`, own
table) are unchanged and out of this decision.

## 5. Small items
- Restore drill: a counts file that names no dump or carries no sha256 is ignored (live counts, labelled); the false
  "only its dump name was checked" note is gone (R9-A4 / O-15 / R9-3).
- Perf budgets: a non-numeric sample count is `insufficient_sample` (R9-A5).
- Login: a DB connection error anywhere in the password login route is 503 `database_unavailable` (O-17); a wrong
  password stays 401.

**Rollback.** Code: revert the commit. Schema: `db/postgres_rollback/140_audit_ops_signatures_drop.sql` (manual, one
transaction) — after it, every Policy Center approval is refused until the columns are back.
