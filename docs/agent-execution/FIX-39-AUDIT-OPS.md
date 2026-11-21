# P11 round 9 — fix lot fix/p11-r9-audit-ops (audit + operations + data + security seats)

AI-authored engineering evidence — not an independent human review. No approval, signature, production readiness or
field acceptance is claimed, and no human cell of the business-readiness pack was filled. Base `ce4cbe9d` (trunk).
Findings from `/home/user/qual/out/r9-audit.md` (R9-A1, R9-A2, R9-A4, R9-A5), `/home/user/qual/out/r9-security.md`
(N-R9-1, `audit_chain_meta` INSERT observation), `/home/user/qual/out/r9-operations.md` (O-14, O-15, O-16, O-17) and
`/home/user/qual/out/r9-data-kpi.md` (R9-2, R9-3). Design: `docs/ai-decisions/ADR-P11-R9-signed-kid-history-anchor-events-request-origin.md`.
Scope kept away from the parallel fix 38 (`public/inspection.html` offline queue, `inspection-db.js` save path).

**Failing first** (PostgreSQL 16 test cluster, `SDP_TEST_RUN_ID=fix39`):
- `tests/p11-r9-audit-ops.test.js` at base code (migration 140 absent) → **8/9 failed**: O-14 ×4 (an app-role `kid:`
  row made the forged kid known; no signed attestation; no `SDP_CONFIG_KEY_OLD` path; no old-key signature check),
  O-16 (the forged unsigned event broke the chain at the rotation), R9-A1 (audit_chain rows updatable/deletable), R9-A4
  (nameless / hashless counts files accepted "unbound"), R9-A5 (`n:'x'` → `within`). The 9th (O-16 control) is a
  regression guard and passed at base, as it should.
- `tests/p11-r9-audit-ops.smoke.test.js` with the product files stashed → **5/5 failed** (forged rows with
  `source` 'web' / 'CLI' / 'cli ' / 'session' / default approved with 200; no origin signature; no token binding; login
  during a DB outage answered 500).
With the fix: 9/9 and 5/5 pass.

| Finding | Sev | Fix | Regression test |
|---|---|---|---|
| O-14 / R9-2 / sec. observation — kid history forgeable by the app role | P3 | Kid history signed: `kidatt:<kid>:<attester>:<hmac>` keyed from `SDP_CONFIG_KEY`; plain `kid:` rows and invalid attestations ignored (`evidence_ignored.kid_rows`); resume needs `SDP_CONFIG_KEY_OLD` (old anchors' signatures checked) or `tools/pg/audit-chain-accept-rotation.js` (human, current key, confirmation flag); resumes re-attest trusted kids under the new key (chain). Hardening script: INSERT kept on purpose (job writes as app role), reason documented | `p11-r9-audit-ops.test.js` O-14 ×4; r7/r8 rotation tests realigned (they now set `SDP_CONFIG_KEY_OLD`) |
| O-16 — one forged `system_log` event arms a false "broken" | P3 | `audit_chain_anchor` events carry `hwm_sig`; HWM and "anchored ledgers" read only from events signed by a held key; others ignored and counted (`evidence_ignored.log_events`); keyless servers unchanged (advisory) | O-16 + O-16 control |
| R9-A1 — unhardened owner launders | P3 (P2 until hardened) | Migration 140: `system_log` audit_chain rows — UPDATE refused, DELETE keeps them (purge unaffected). Hardening script hands `system_log` + guard function to `sdp_audit_owner` (app keeps SELECT/INSERT/DELETE). With O-14/O-16 a forged kid row no longer re-baselines without the key. **Residual stated** (ADR §3, EXPLOITATION): unhardened owner can still disable the trigger and erase evidence; key + DB holder can forge | R9-A1 test; `audit-grants-rehearsal` (app role cannot update/truncate/un-guard, purge still works) |
| R9-A2 / N-R9-1 — token evidence keyed on a forgeable `source`, replayable | P3 | Migration 140: `origin`, `origin_sig`, `operator_token_id` on requests, `bound_request_ids` on tokens. `policyChangeStore.create` signs every request (`services/policyOrigin.js`) and binds the consumed CLI token to the new id in one transaction. Approval verifies the signature for EVERY `pc-` request (409 "request not created by a trusted path"), then for CLI origin a server-issued, same-account, consumed token bound to THIS id (replay → 409). No key → nothing filed. Pending pre-140 requests refused (re-file) | smoke R9-A2 ×3, N-R9-1; `p11-r8-policy-center.smoke` realigned |
| R9-A4 / O-15 / R9-3 — unbound counts file trusted | P3 | `dumpCountsFor` refuses a file without `dump` or `dump_sha256` (live counts, labelled); misleading "only its dump name was checked" note removed | R9-A4; `p11-r8-audit-ops` O-13 realigned |
| R9-A5 — non-numeric sample count rated within | P3 | `!(Number(o.n) >= min)` | R9-A5 |
| O-17 — login during DB outage → 500 | P3 | The whole password-login handler runs in one try; `fail(res, asUnavailable(e) \|\| e)` → 503 `database_unavailable`; wrong password stays 401 | smoke O-17 |

**Migration.** `db/postgres/reports/140_audit_ops_signatures.sql` (additive, idempotent); manual rollback
`db/postgres_rollback/140_audit_ops_signatures_drop.sql` (BEGIN/COMMIT), listed in `tests/ppm-rollback-scripts.test.js`.

**Tests run** (`PG_ADMIN_URL=…sdptest…`, `SDP_TEST_RUN_ID=fix39`): audit-chain*, audit-grants*, p11-r7-audit-ops,
p11-r8-audit-ops, p11-r8-policy-center, activate-switches*, policy-center-*, four-eyes-guard, backup*, restore*,
perf-budget*, auth-*, login*, session*, pg-migrate*, ppm-rollback-scripts, rollback-scripts-transactional,
business-readiness*, soft-delete*, p11-r9-audit-ops* (257 tests, green except gate-dossiers freshness, regenerated
after commit); plus every test file touching `kid:`, the policy request routes, `makePolicyChangeStore`,
`dumpCountsFor`, perf-budget-check, the login route, the hardening script or `system_log` (284 tests; 3 failures
fixed by giving those suites an `SDP_CONFIG_KEY`, now green).

**Behaviour changes operators must know** (runbook `docs/ops/EXPLOITATION.md` updated):
- A key rotation (or restore onto another key) no longer resumes the audit chain from a plain meta row: keep the old
  key in `SDP_CONFIG_KEY_OLD` for one nightly run, or run the accept tool after confirming the rotation.
- Policy Center requests pending at deployment must be rejected and filed again.

**Human decisions left (not taken here):** applying `tools/pg/harden-audit-grants.sql` in production (DBA / CAB);
separation of duties between holders of the DB login and of `SDP_CONFIG_KEY` (G01 / HD-S04); whether the
`SDP_CONFIG_KEY_OLD` window and the accept tool are an acceptable rotation procedure; the governance-proposal (`gp-`)
table is not origin-signed (out of scope, stated in the ADR).
