# P11 round 7 — fix lot fix/p11-r7-audit-ops (audit + operations + data seats)

AI-authored engineering evidence — not an independent human review. No approval, signature, production readiness or
field acceptance is claimed, and no human cell of the business-readiness pack was filled. Base `7634066e` (trunk, contains
fixes 25–31). Findings from `/home/user/qual/out/r7-audit.md` (R7-A1, R7-A2, R6-A3 residual, PLAN-PILOTE lag),
`/home/user/qual/out/r7-operations.md` (O-7, O-8, O-5) and `/home/user/qual/out/r7-data-kpi.md` (F-32). Design:
`docs/ai-decisions/ADR-P11-R7-anchor-kid-token-binding.md`.

**Failing first.** `tests/p11-r7-audit-ops.test.js` (11 tests) was run with the product changes stashed (migrations
applied, code at base): **11/11 failed** — O-7 failed with `restore drill FAILED: 1 table(s) differ` (the real race:
a writer inserting into `system_log` during the drill), the others on the asserted behaviour. With the fix: 11/11 pass.

| Finding | Sev | Fix | Regression test |
|---|---|---|---|
| **O-7** monthly restore drill compared the restored copy with live counts taken minutes after the dump → spurious FAIL on a live server | P2 | `services/backup.openDumpSnapshot`: a `REPEATABLE READ READ ONLY` transaction exports its snapshot, counts the 10 main tables **in it**, and `pg_dump --snapshot=<id>` (via `tools/pg/dump-db.js`) dumps exactly that state; counts go to `<dump>.counts.json` (pruned with its dump). `tools/pg/restore-drill.js` compares with those counts; a dump with no sidecar falls back to live counts and the report says so. Best effort: if the snapshot cannot be opened the dump runs as before. | `p11-r7-audit-ops` "writes during the restore drill…" (writer every 2 ms during `run({backupFirst:true})`, real pg_dump/psql) + sidecar prune test |
| **O-8 / F-32** signed anchors broke permanently after `SDP_CONFIG_KEY` rotation / restore onto another key; no key read "advisory ok" | P2 / P3 | Migration **137**: `audit_chain_anchors.kid` + append-only `audit_chain_meta`. Rows under another kid = "unverifiable (key rotated)" (never forged), still constraining the chain; the nightly job logs `audit_chain_key_rotated` and re-anchors under the current key; a shortened chain behind a rotation stays `broken`. Signed anchors + no key → `unverifiable`. Rotation documented in `docs/ops/EXPLOITATION.md`, `docs/ops/INCIDENT-RESPONSE.md`, `docs/DB_RECOVERY.md`, `RUNBOOK-EXPLOITATION.md`. | `p11-r7-audit-ops` O-8 ×2, F-32, pure kid test; `audit-chain-r6` updated (no key + signed = unverifiable, intended change) |
| **R7-A2** (a) shadow schema with an empty anchor table → ok "signed"; (b) sig column dropped + matching anchor → "advisory ok" | P3 (P2 until hardened) | `resolveLedgerSchema`: two search-path schemas holding ledgers/anchors → unverifiable; migration-time `ledger_schema` must match; meta table elsewhere but not here → unverifiable; empty anchor table = `none`. Signed anchors ever written (meta marker, kid, nightly event) + no sig column → unverifiable. `harden-audit-grants.sql` adds `kid` and hands `audit_chain_meta` to `sdp_audit_owner`. **Not claimed fixed beyond the DBA hardening step (CAB):** an unhardened owner can drop all these facts together. | `p11-r7-audit-ops` R7-A2 (a) (incl. fake marker, shadow alone on the path, env pin still ok) and (b) |
| **R7-A1** operator token forgeable by a direct INSERT with the app DB login | P3 (P2 as approval evidence) | Migration **138**: `operator_tokens.binding` = HMAC (key derived from `SDP_CONFIG_KEY`, not in the DB) over token hash, account, purpose, expiry. `check()` refuses a missing/wrong binding and a token without an `operator_token_issued` event; no key → refused (route 409). Policy Center list shows token evidence; approval of a request naming an unverifiable token → 409. | `p11-r7-audit-ops` R7-A1; `activate-switches-r6-impersonation.smoke` +2 (CLI refuses the round-7 forgery, forged request row refused at approval and shown as unverifiable, genuine token shown verified, no key → 409) |
| **R6-A3 residual** dossier check ignored transitive dependencies of cited scripts | P3 | `tools/release/gate-dossiers.js`: the local require/import closure of every cited script is hashed (`script_deps` in the manifest, 471 files, ~1 s) and checked for change / disappearance. | `p11-r7-audit-ops` R6-A3 gap (temp tree + real tree: `services/auditChain.js` recorded, a changed hash flagged) |
| **O-5** blocking budget check passed with one class measured | P3 | `perf-budget-check.js`: in blocking mode any budget class without a sample fails (warn mode warns). CI sets blocking only through `vars.PERF_BUDGETS_BLOCKING` (default `0`). | `p11-r7-audit-ops` O-5; `perf-budget-check` r6 case updated to the new rule |
| PLAN-PILOTE lag (fix 26 "non fusionné", fix 29 "pas fusionné") | P3 | AI-written cells of `docs/business-readiness/PLAN-PILOTE.md` (L12, L13, activation tool) updated; `business-readiness-check.js --write` then `--check` green. Human cells untouched. | `business-readiness` |

## Migrations

- `db/postgres/reports/137_audit_chain_anchor_kid.sql` (additive, idempotent; adds `kid` only when the app role owns the
  table — else a NOTICE, the hardening script adds it) → rollback `db/postgres_rollback/137_audit_chain_anchor_kid_drop.sql`.
- `db/postgres/reports/138_operator_token_binding.sql` → rollback `db/postgres_rollback/138_operator_token_binding_drop.sql`.
- Both listed in `tests/ppm-rollback-scripts.test.js` (round-trip proved) and transactional (`rollback-scripts-transactional`).

## Behaviour changes operators must know (AI statement, to be read by humans)

- Without `SDP_CONFIG_KEY`: operator tokens are refused (fail closed) and, once signed anchors exist, the nightly chain
  job fails `unverifiable` until the key is back.
- After a key rotation the next nightly run writes an `audit_chain_key_rotated` event — expected after a rotation,
  suspicious otherwise.
- `tools/pg/dump-db.js` (part of the installer-related file set) gains an optional `--snapshot=<id>` argument; without
  it the dump is unchanged.

## Residuals and human decisions left (not decided here)

- G01 access policy: who holds the application database login and `SDP_CONFIG_KEY` (whoever holds both can still forge
  a token or an anchor); who may run `activate-switches --apply`.
- DBA / CAB: apply `tools/pg/harden-audit-grants.sql` and set `SDP_LEDGER_SCHEMA=public` in `.env` — the real control
  for R7-A2 and for the rotation residual (an unhardened owner can force a "rotation" event, but cannot lower the
  baseline).
- G05 / G-11: RPO-RTO, drill policy; `docs/ops/perf-budgets.json` still PROPOSED (approved_by empty).
- Carried P3s not addressed here: PC-log (`policy_change_requests` mutable, not chained), F-25, O-9, O-10, N-12.
- `tools/pg/restore-rehearsal.js` still does not exercise anchors (F-32 test suggestion) — covered instead by the unit
  tests above; left as is.

## Commands run

PostgreSQL 16 shared cluster on 5432 (target is 17), `SDP_TEST_RUN_ID=fix33`, prescribed NODE_OPTIONS. Suites:
`p11-r7-audit-ops`, `audit-chain`, `audit-chain-r6`, `audit-grants-rehearsal`, `activate-switches`,
`activate-switches-r6-impersonation.smoke`, backup-*, blob-backup*, db-restore, restore-drill*, gate-dossiers,
perf-budget-check, business-readiness, pg-migrate*, ppm-rollback-scripts, rollback-scripts-transactional,
policy-center-*, p11-r6-*, p11-r7-*, authz matrices/outcomes, readme-truth, kpi-docs-links, flag-register,
agent-inventory. Generators: flag-register, inventory (+ `--strict`), switch-lots / policy-catalogue `--check`,
evidence-manifest, business-readiness `--write/--check`, gate-dossiers regenerate + `--check`. `npx eslint .` clean.
