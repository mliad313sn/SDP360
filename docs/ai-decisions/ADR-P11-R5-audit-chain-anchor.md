# ADR-P11-R5 — Audit ledgers: schema-qualified verification, daily anchor, no shadow schema

- **Status:** accepted for engineering (AI decision, reversible, sandbox). Not a DBA, CAB or security approval: applying
  `tools/pg/harden-audit-grants.sql` in production stays a human DBA action in a CAB window.
- **Date:** 2026-11-20 · **Author:** Claude (AI) · **Review:** AI self-review only — not an independent review.
- **Context:** P11 round 5 audit (AI review, kept outside the repository): R5-A3 — the database-owner app role
  could `CREATE SCHEMA shadow`, copy a ledger's shape there and set its own `search_path`; new sessions then wrote and
  verified an empty shadow chain that reported `ok`. AUD-2 (open since round 1) — the nightly chain verify logged the
  chain heads but never compared them with the previous day, so a tail delete or a `TRUNCATE` left a valid (shorter or
  empty) chain.

## Decisions

1. **Detect, by comparison with yesterday (AUD-2).** New append-only table `audit_chain_anchors` (migration
   `db/postgres/reports/131_audit_chain_anchor.sql`, rollback `db/postgres_rollback/131_audit_chain_anchor_drop.sql`):
   one row per ledger per nightly run (last id, head hash, row count). `services/auditChain.verify` fails a ledger
   whose row count shrank, whose anchored row is gone, or whose anchored row carries another hash. `nightly()` writes a
   new anchor only over a chain that verified — the last good anchor stays the reference after a break.
2. **Read schema-qualified (R5-A3).** Every ledger read names the ledger schema (`SDP_LEDGER_SCHEMA` in `.env`, else
   `current_schema()`); if the unqualified name — what the writers use — resolves to another table (pg_temp, or a
   schema earlier on the search path), the ledger is reported `shadowed` (ok:false). `sdp_hash_chain()` reads the
   previous hash from `TG_TABLE_SCHEMA` (redefined by migration 131 while the app role still owns it, and by the
   hardening script otherwise).
3. **Prevent (hardening script).** The script hands the **database** to `sdp_audit_owner` (an owner could re-grant
   itself `CREATE`; a non-owner cannot), revokes `CREATE` on other schemas, pins the app role's `search_path` in the
   database, and hands `audit_chain_anchors` to `sdp_audit_owner` with `SELECT, INSERT` for the app role.

## Consequences

- After hardening, restores (`services/dbRestore.js`) and the restore drill's schema fallback need the DBA connection.
- Residual: a session-local temporary table can shadow a name for that session only — reported by the verify.
- Without `SDP_LEDGER_SCHEMA` and before hardening, an attacker who can run DDL as the app role could still point
  `current_schema()` at a copy (anchors included); the env pin plus the hardening close that. Documented in
  `docs/ops/EXPLOITATION.md`.
- Rollback: the rollback script drops the anchors (the check is blind again); the hardening script header lists the
  ownership rollback commands.
