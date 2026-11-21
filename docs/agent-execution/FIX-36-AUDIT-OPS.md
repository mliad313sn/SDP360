# P11 round 8 — fix lot fix/p11-r8-audit-ops (audit + operations + data seats)

AI-authored engineering evidence — not an independent human review. No approval, signature, production readiness or
field acceptance is claimed, and no human cell of the business-readiness pack was filled. Base `7afb9536` (trunk).
Findings from `/home/user/qual/out/r8-audit.md` (R8-A1, R8-A2, AUD-4), `/home/user/qual/out/r8-operations.md` (O-11,
O-12, O-13, O-5 residual) and `/home/user/qual/out/r8-data-kpi.md` (R8-4). Design:
`docs/ai-decisions/ADR-P11-R8-anchor-rotation-resume.md`. Scope kept away from the parallel fixes 34 (governance store,
RAID, risk exposure, Policy Center decide/apply atomicity, operatorTokens comment) and 35 (inspection, field, sessions,
i18n): in `routes/policyCenter.js` only the token-evidence check of the approve route changed.

**Failing first** (product changes stashed, tests kept, PostgreSQL 16 test cluster, `SDP_TEST_RUN_ID=fix36`):
- `tests/p11-r8-audit-ops.test.js` with `services/auditChain.js` at base → chain tests **6/6 failed** (R8-A2 repro read
  "anchor history missing"/resumed, O-11 resumed, control lacked the kid history, O-12 had no remedy message).
- same file with `services/backup.js`, `tools/pg/restore-drill.js`, `tools/test/perf-budget-check.js`,
  `docs/ops/perf-budgets.json` at base → O-13 ×2 and O-5 **3/3 failed**.
- `tests/p11-r8-policy-center.smoke.test.js` with `routes/policyCenter.js` at base → **2/2 failed** (approve answered
  **200** instead of 409 — the R8-5 forged `source='cli'` row was approved).
With the fix: 9/9 and 2/2 pass.

| Finding | Sev | Fix | Regression test |
|---|---|---|---|
| **R8-A2 / O-11 / R8-4** nightly "key rotation" resume re-baselined a truncated ledger (owner deletes tail + all anchors, inserts made-up-kid anchors) and absorbed an invented kid into a real rotation | P3 (P2 until hardened) | `services/auditChain.js`: (1) **kid history** — `recordAnchors` writes `kid:<kid>` to the append-only `audit_chain_meta` when it signs, the anchor event carries `kid`; (2) a pending foreign kid **not** in that history = `unknown key id` → `unverifiable`, `unknown_kids`, no result-level `key_rotated`, **no resume**; (3) **high-water mark** — when no current-key anchor is verified (deleted, or rotation pending) the highest position the job logged as anchored in System Logs constrains the ledger → a shorter ledger is `broken`. Genuine rotation (job signed under A, now B) still resumes. Residuals (unhardened owner rewrites everything; app role may pre-insert a `kid:` row; System Logs not append-only) stated in the ADR. | `p11-r8-audit-ops`: R8-A2 repro → `broken`; repro + scrubbed System Logs → `unknown key id`, nightly throws, 0 rotation events; O-11 invented kid during real rotation → no resume; control genuine rotation → resumes + ok; known prior kid cannot launder a truncation |
| **O-12** database hardened before migration 137 (no `kid` column) fails `unverifiable` every night after a rotation, runbook silent | P3 | `verify` adds an `anchor_error` naming the remedy (re-run `tools/pg/harden-audit-grants.sql`); `docs/ops/EXPLOITATION.md`, `docs/DB_RECOVERY.md`, `docs/business-readiness/RUNBOOK-EXPLOITATION.md` (D2) say: re-run the hardening script after migration 137, before any rotation, and let one ordinary night run under the current key first. | `p11-r8-audit-ops` O-12 (kid column hidden → message + nightly throw naming the script) |
| **R8-A1** a `source='cli'` Policy Center request naming no operator token was approvable | P3 | approve route: a request filed outside the web session flow (`source='cli'` or the CLI's `filed by activate-switches` marker) must name a verifiable token; otherwise **409** + `policy_approval_refused` ("cli request without operator token evidence"). Residual: a default-source plain-reason row is indistinguishable from a web request (PC-log, open). | `p11-r8-policy-center.smoke` ×2 (forged `cli` row 409, value unchanged, refusal logged; marker-only row 409; web-flow request still 200) |
| **O-13** drill trusted any sidecar; off-site copy carried no counts | P3 | `backup.runBackup` writes `dump_sha256` + `dump_bytes` in `<dump>.counts.json` (streamed hash) and copies the counts file off-site next to the dump; `backup.dumpCountsFor` trusts it only when name, size and sha256 match; `restore-drill` notes "IGNORED: <reason>" and uses **live counts, labelled**; a pre-fix counts file (no hash) is used after a name check and flagged unbound. | `p11-r8-audit-ops` O-13 pure (name / size / sha mismatch, unbound, absent) + real pg_dump: binding, off-site copy, drill report on a mismatched counts file |
| **O-5 residual** blocking budget check passed with n = 1 per class | P3 | `perf-budget-check.js`: `insufficient_sample` below `min_samples_per_class` (5, **PROPOSED**, in `docs/ops/perf-budgets.json`; per-class `min_samples` override); blocking fails, warn mode warns; an over-budget row stays `over`. | `p11-r8-audit-ops` O-5; `perf-budget-check` F-07 case passes `minSamples:1` explicitly (its subject is the 4xx split) and asserts the default flags 2 samples |
| **AUD-4** center OFF: one super_admin relaxes controls | P2 → partial (policy) | **No behaviour change** (policy decision). Already listed as pending human decisions **HD-S14** (AUD-2/AUD-4, `REGISTRE-DECISIONS-HUMAINES.md`, human cells blank) and HD-S04 (turn the center on). `business-readiness-check.js --write` / `--check` green. | `business-readiness` |

## Migrations

None. The kid history uses the existing append-only `audit_chain_meta` (migration 137).

## Tests run (AI-run, this worktree)

- Related suites (audit-chain*, audit-grants*, activate-switches*, policy-center-*, backup*, restore*, perf-budget*,
  pg-migrate*, ppm-rollback-scripts, rollback-scripts-transactional, business-readiness*, gate-dossiers, p11-r6-*,
  p11-r7-*, p11-r8-*): 214 tests, 211 pass; the 3 failures were the gate-dossier freshness checks, expected before the
  dossiers are regenerated for this commit (re-run after regeneration — see the commit after this one).
- Inventory / readme / monolith / KPI-doc / traceability / route-authz / CSP / flag / switch / policy-catalogue tests:
  79/79. `npx eslint .` clean. `flag-register`, `switch-lots`, `policy-catalogue --check` OK; inventory and evidence
  manifest regenerated; suite manifest +11 (total 6029).

## Human decisions left (not filled)

- G01: who holds the app DB login and `SDP_CONFIG_KEY`; G02 threat model (take in R8-A1/R8-A2 residuals).
- DBA / CAB: apply (or re-apply after migration 137) `tools/pg/harden-audit-grants.sql` + `SDP_LEDGER_SCHEMA`.
- Whether an unrecorded key id may ever be recorded by hand (`kid:<kid>` in `audit_chain_meta`) and by whom.
- SRE owner: the minimum sample count per budget class (5 is PROPOSED); G-11 off-site drill behaviour.
- HD-S04 (Policy Center on) and HD-S14 (AUD-2/AUD-4) — still blank.
