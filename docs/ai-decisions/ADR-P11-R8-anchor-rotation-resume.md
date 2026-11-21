# ADR-P11-R8 — Audit-chain rotation resume needs a known prior key and an un-shortened ledger; CLI-filed requests need token evidence

**Status:** AI decision (reversible engineering detail), 2026-11-21. Not a business approval, not a security sign-off.
**Context:** P11 round 8 findings R8-A2 (audit, P3 / P2 until hardened), O-11 and O-12 (operations, P3), R8-4 (data,
P3), R8-A1 (audit, P3), O-13 and the O-5 residual (operations, P3). Fix 36 (`docs/agent-execution/FIX-36-AUDIT-OPS.md`).
Supersedes the "resume when the only problem is a rotation" rule of ADR-P11-R7 §1; everything else in that ADR stands.

## 1. Rotation resume (R8-A2, O-11, R8-4) — no migration

**Problem.** ADR-P11-R7 let the nightly job resume after a key rotation whenever every non-ok ledger was merely
"key rotated" and every foreign-kid anchor's content still held. The owner of an unhardened database could delete the
tail of a ledger, delete **every** anchor (current-key ones included — the only verified baseline), insert anchors under
a made-up kid matching the shortened chain, and the next nightly run re-anchored the truncated ledger: `ok`, `signed`.
An app-role insert of an invented-kid row during a real rotation was likewise absorbed into the rotation event (O-11).

**Decision.**
- **Kid history.** When the nightly job writes signed anchors it records `kid:<kid>` in `audit_chain_meta`
  (append-only; SELECT + INSERT only for the app role once hardened) and puts the kid in its `audit_chain_anchor`
  System Log event. The job holds the current key, so it is the only party that can truthfully say "this key signed".
- **Unknown kid.** A pending foreign anchor (written after the last current-key anchor) whose kid is not in the kid
  history is **`unknown key id`**: the ledger is `unverifiable`, the result carries `unknown_kids`, `key_rotated` is NOT
  set at result level and the job does **not** resume. An anchor under an unknown kid therefore never yields `ok` and
  never triggers a resume on its own. Kid-less foreign rows count as kid `legacy`, known only if `kid:legacy` was
  recorded.
- **High-water mark.** With no anchor verified under the current key (anchors deleted, or a rotation pending), the
  highest position the nightly job logged as anchored `ok` in System Logs (`audit_chain_anchor` events of the same
  schema: rows, last id, head) constrains the ledger like an anchor. A ledger shorter than that position — or whose
  logged last row is gone or rewritten — is **`broken`**, never re-baselined. Foreign-kid anchor rows of any kid keep
  constraining the chain as before (ADR-P11-R7). The check is applied only on that path so that ordinary nights keep the
  signed current-key anchor as their baseline.
- **Genuine rotation still resumes:** the job signed under kid A on this deployment (kid A recorded), the key becomes B,
  the ledgers are not shorter than any logged/anchored position → `audit_chain_key_rotated`, re-anchor under B, `ok`.
  A restore on a server with another key resumes too, because the meta table travels in the dump.
- **Operator path for a legitimate but unrecorded kid** (key rotated before the first nightly run of this fix): the DBA
  confirms the rotation and records it by hand — `INSERT INTO audit_chain_meta (k, v) VALUES ('kid:<kid>', '<who, date,
  reason>')`. That is a human act, not something the job does; it is documented in `docs/ops/EXPLOITATION.md`.

**Residual (stated, not claimed fixed).**
- The **owner of an unhardened database** can still disable the triggers and rewrite the anchor table, the meta table
  (including adding a `kid:` row for a made-up kid) and System Logs, then let the job resume: nothing the job reads is
  out of that role's reach. `tools/pg/harden-audit-grants.sql` (DBA / CAB step) and `SDP_LEDGER_SCHEMA` remain the
  control; without them the anchors are evidence against the application role, not against the database owner.
- The **app role on a hardened database** can INSERT into `audit_chain_meta`, so it could pre-record an invented kid
  before inserting an anchor under it. The record is append-only and visible; content constraints still hold (no
  baseline can be lowered); the high-water mark still catches a truncation. A signed kid history (keyed outside the
  database) is a possible later step, not done here.
- System Logs is not append-only: deleting the `audit_chain_anchor` events removes the high-water mark source. The
  unknown-kid rule still blocks the R8-A2 path in that case (proved by test); with a known kid and scrubbed logs only
  the remaining anchors constrain.

## 2. Database hardened before migration 137 (O-12)

Migration 137 cannot add the `kid` column to an anchor table owned by `sdp_audit_owner`; the job then cannot resume
after a rotation. `verify` now adds an `anchor_error` naming the remedy (re-run `tools/pg/harden-audit-grants.sql`,
which adds the column) when a rotation is pending and the column is missing; the runbooks say to re-run the hardening
script after migration 137 and before any rotation.

## 3. CLI-filed Policy Center requests (R8-A1)

**Problem.** The approve route checked operator-token evidence only when a request's reason named a token, so a row
inserted straight into `policy_change_requests` (`source='cli'`, no token named) was approvable.

**Decision.** A request filed outside the web session flow — `source = 'cli'`, or a reason carrying the CLI's
`filed by activate-switches` marker — must name a verifiable operator token (binding + issuance event + same account,
fix 33); otherwise approval answers **409** and logs `policy_approval_refused`. Since fix 29 every genuine CLI request
names its token. Only the evidence check changed; the decide/apply code is untouched.

**Residual.** A row inserted with the default `source` and a plain reason is indistinguishable from a web request; the
fix for that is to chain or make append-only `policy_change_requests` (PC-log, still open). The same DB login can also
write `report_config` directly, so the impact remains a forged second-person record, not an escalation.

## 4. Restore drill counts (O-13) and budget samples (O-5 residual)

- `<dump>.counts.json` records the dump's sha256 and size; the drill (`backup.dumpCountsFor`) uses it only when name,
  size and sha256 match, otherwise it says the file was IGNORED and uses live counts, labelled. A counts file written
  before this fix (no hash) is used after a name check and flagged as unbound. The off-site copy now copies the counts
  file next to the dump.
- `tools/test/perf-budget-check.js`: a class measured with fewer than `min_samples_per_class` samples (default 5,
  **PROPOSED**, the SRE owner decides; per-class `min_samples` override) is `insufficient_sample`, never `within`;
  blocking mode fails on it. An over-budget row stays `over` whatever the sample count.

## Reversal

Revert the fix-36 commit. No migration, no data rewrite: the `kid:` meta rows written meanwhile are harmless extra facts.
