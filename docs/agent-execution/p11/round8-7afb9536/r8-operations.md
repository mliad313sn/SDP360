# P11 qualification — ROUND 8 (re-check) — seat: operations (Operations / SRE)

**AI review — not an independent human review.** AI panel seat "operations". No live system was touched, no product
code was modified, nothing was pushed, merged or tagged, and no human decision was filled in. Frozen SHA:
`7afb9536ae3e38273aeff47307a78c49637dbd94` (clone `/home/user/qual/operations`, HEAD `7afb9536`). The
agent-execution narratives were not read (only code, tests, docs/ops, RELEASE-GATES, gate dossiers). Earlier round
files were not changed. The host PostgreSQL cluster is **16** (target 17).

Throwaway work: `/tmp/claude-0/p11ops-r8/` (scripts in `scripts/`; outputs `e1.out`, `drill1.out`, `e4.out`,
`load.*`, `ready.log`, `pb-*.out`). Databases I created: `sdp_test_p11ops_r8` (20 000 tickets, `scale-run.js prepare`),
dropped by name with `scale-run.js drop`; the drill target `sdp_drill_tvhcwolv` and the scale-run restore target were
dropped by the tools; the 44-file evidence run used `SDP_TEST_RUN_ID=operationsr8` and **left 0 databases** (checked by
name: 0 matches for `%operationsr8%`, `%p11ops_r8%`, `sdp_drill_%` after cleanup). Env file, credentials file, data dir
(860 MB synthetic photo store) and backups deleted. Shared host: latencies are not comparable across rounds.

## 0. Round-7 findings re-checked at 7afb9536 (fix 33 and related)

| R7 | Claimed fix | Repro re-run at 7afb9536 | Verdict |
|---|---|---|---|
| **O-7 (P2)** monthly restore drill compares live counts taken minutes after the dump → spurious FAIL on a live server | `services/backup.js openDumpSnapshot`: REPEATABLE READ tx, `pg_export_snapshot()`, main tables counted in it, `pg_dump --snapshot=<id>`, sidecar `<stamp>.counts.json`; drill uses the sidecar (falls back to live counts with a note) | Same setup as r7: my own `node server.js` on 127.0.0.1:3598, 860 MB store under `SDP_DATA_DIR/blobs`, a failed login every 2 s (writes `system_log`), then `restore-drill.run({backupFirst:true})` in-process (`scripts/drill-lag.js`). `system_log` was 20 000 before; **sidecar 20 006 = restored 20 006 → ok**; live was 20 011 after. **PASS (database + file store)**, 58 s. | **FIXED** (P3 residuals below: sidecar not bound to its dump; offsite copies carry no sidecar; one 378 ms event-loop stall during the drill — r7 max 92 ms) |
| **O-8 (P2)** signed anchors break permanently after `SDP_CONFIG_KEY` rotation / one unkeyed night | migration 137 `kid` column + `audit_chain_meta`; foreign-kid rows "unverifiable (key rotated)", still constrain; `nightly()` logs `audit_chain_key_rotated` and re-anchors; no key → unverifiable, nothing unsigned written | Rewritten repro through the REAL `nightly(rdb)` job (`scripts/anchor-nightly.js`) on my DB: n1/n2 key A ok (12 anchors); n3 after rotation to B → **ok, `audit_chain_key_rotated` from kid 22545d76… to d8478304…, 12 re-anchored**; n4 ok; n5 key missing → `unverifiable` (fail, nothing written); n6 key back → ok; n7 rotation back to A → ok with a rotation event; n8 ok. Events: anchor 7, key_rotated 2, unverifiable 1. | **FIXED** (P3 residuals O-11, O-12 below) |
| **O-5 (P3, partial)** blocking budget check passes with one class measured | fail when any budget class is unsampled in blocking mode | r7 `one.json` (1 class of 5): blocking → **exit 1** "4 of 5 budget class(es) have no sample". `empty.json` → exit 1. New attempt: every class with **n = 1, p95 = 1 ms** → blocking **exit 0**. `DESIGNED_4XX` still excludes every `field.envelope` 400. | **FIXED** for the claim; residual P3 (no minimum sample size) |
| **O-9 (P3)** three blob-root resolvers; `SDP_BLOB_ROOT` honoured by backup only | — | `grep SDP_BLOB_ROOT`: still only `services/blobBackup.js:38`; app `blobStore.js` and drill unchanged | NOT FIXED (P3) |
| **O-10 (P3)** drill file-store check not independent of backup enumeration | — | not in the fix diff | NOT FIXED (P3) |
| `openDump` / `rewriteSchema` synchronous in-process | — | not in the diff; the 378 ms stall seen in this round's drill is consistent with it | NOT FIXED (P3) |
| Carried P3s: N-12 residuals (no statement timeout on user routes; `/itsm-integrations-plan.html` → login on DB_BUSY), project-document blob folder on hard delete, pilot-metrics actor filter, N-04, N-05, F-06, F-08, F-09, F-10, unsealed rollback files without keys, DB-credential holders can write switches directly | — | not in the fix diffs | NOT FIXED (P3), not re-tested |

## 1. Evidence re-run at 7afb9536 (command · result)

Env: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres SDP_TEST_RUN_ID=operationsr8`,
`NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit --test-concurrency=4 <files>`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | 44 files: activate-switches(+r6 impersonation smoke), assets-sync(-status smoke), audit-chain, audit-chain-r6, auth-db-busy.smoke, backup-encrypt/job/schedule, blob-backup(-r6), boot-integrity, db-restore, health-deps(.smoke), health-public, health-version(-provenance,.smoke), **p11-r7-audit-ops**, perf-baseline, perf-budget-check, perf-calendar-helpdesk-scan, pg-pool-acquire-timeout, pg-pool-idle-error, ready-probe.smoke, ready-readonly, ready-timeout, report-config-switch-canonical, restore-drill(-admin-card,-full), rollback-scripts-transactional, sli-readings, sync-drift, sync-jobs-registry, sync-routes.smoke, sync-runner, sync-schedule, sync-skip-semantics, sync-write-fence, zoho-sync-survey-truncation, zoho-sync-truncation-anchor, zoho-sync-truncation-guard | **263 tests, 263 pass, 0 fail, 0 skip**, 192 s, exit 0. 0 test DBs left. Log `/tmp/claude-0/p11ops-r8/e1.out` | VERIFIED |
| E2 | Load: own `node server.js` on 127.0.0.1:3598 against `sdp_test_p11ops_r8` (fresh clone boots — boot integrity holds in practice); `tools/test/load.js --sessions=5 --duration=180 --scenarios=reports,helpdesk,field,export,pages,deck --pid --pg-stat-url` | 1 848 requests, 10.1 req/s, **0 × 5xx**; the 154 errors are all designed `field.envelope` 400s. Class p95: page_data 305 ms, sync 214, write 436, export 248, deck_generation 5 657 (all-sites monthly p95 6.5 s). RSS 120 → 416 MB. Max 28 DB connections, 0 lock waits. `/ready` every 3 s: **60/60 = 200**, max 0.26 s. Table: `/home/user/qual/out/r8-operations-load-run.md`. (First attempt refused with 429: my own failed-login writer from the O-7 repro had used the persistent login budget — the limiter works; I cleared `rate_limit_hits` on my throwaway DB only.) | VERIFIED (observation; shared host) |
| E3 | `perf-budget-check.js --load=<E2 json>`, warn and blocking | 5/5 classes sampled and within the PROPOSED budgets, exit 0 both modes; budgets still `approved_by: null` | VERIFIED |
| E4 | `scale-run.js restore --db=sdp_test_p11ops_r8` | 229 tables, 47 987 rows, encrypted, **0 mismatches**, 34 s (incl. 860 MB store); target dropped | VERIFIED |
| E5 | Restore drill, in-process job path, 860 MB store, concurrent writes | PASS (O-7 row above) | VERIFIED |
| E6 | Round-7 repros (§0) | as in §0 | VERIFIED |
| E7 | Installer PowerShell suite (`tools/installer/tests/run-all.ps1`) | no `pwsh` on the host; scripts read only | NOT VERIFIED |
| E8 | Soak > 3 min, production volume, external `/ready` SLI, multi-GB store on the real Windows server (junctions, antivirus, disk), PG17 | not run | NOT VERIFIED |

Counts: **6 verified, 2 not verified.**

## 2. New break attempts at 7afb9536 (one per capability, aimed at code changed by fixes 30–33)

| Capability · claim | Attack | Outcome |
|---|---|---|
| Restore drill (fix 33 O-7): "a PASS compares the restored copy with what the dump captured" | Live writes during the whole drill (above); then by reading: `readDumpCounts(dumpFile)` loads `<stamp>.counts.json` and never checks its `dump` field against the file; `copyOffsite` copies only the dump | Holds under live writes. Residuals (P3, O-13): an orphaned/mismatched sidecar is trusted; a drill run on an offsite copy brought back has no sidecar and silently returns to live counts (the r7 false-FAIL behaviour, with a note in the report). |
| Audit-chain job (fix 33 O-8): "a rotation resumes; a forged row is never ok" | (a) On my DB, as the **app role** (still has INSERT on the anchor table after hardening): inserted an anchor row with an invented kid `ffff…`, garbage sig, content matching the chain, during a real rotation | (a) `nightly` → **ok**, one `audit_chain_key_rotated` event whose `from_kids` lists both the real old kid **and the invented one**; the chain is re-anchored and green. The forged row is not flagged anywhere except inside that event. → **O-11 (P3)** |
| same | (b) app-role INSERT of an invented-kid row claiming 1 000 more rows than exist | (b) **broken** every night (constraint from an unverifiable row): an app-role INSERT can turn the control red permanently (append-only table → only a DBA can clear it). Same as r7 for any forged row — not a regression; noted. |
| same | (c) DB hardened **before** migration 137 (137 only emits a NOTICE when the anchor table is owned by `sdp_audit_owner`, so no `kid` column), then rotation — pure `chooseAnchor(..., {kidColumn:false})` + `verify` code path `rotatedOnly … && kidColumn` | (c) `unverifiable (key rotated)`, `rotatedOnly` false → `nightly` never resumes → the job fails `unverifiable` **every night** until the DBA re-runs `harden-audit-grants.sql` (which now adds `kid`). `EXPLOITATION.md` says "the following nights are ordinary ok runs" without that condition. → **O-12 (P3)** |
| Perf budgets (fix 33 O-5) | All five classes with n = 1 | blocking exit 0 → residual P3 (no minimum n) |
| Activation tokens (fix 33 R7-A1, ops angle) | Read: binding HMAC keyed from `SDP_CONFIG_KEY`; CLI loads `.env`; tokens refused without key; tokens issued before a key rotation become invalid (fail closed, 10-min TTL) | Holds for operations (security seat owns the forgery angle) |
| Boot integrity (new files `services/policyRanges.js`, `services/passwordWorkFactor.js`, migrations 137/138) | Booted `server.js` from the clean clone on a freshly migrated throwaway DB; boot-integrity test | Holds (server `/ready` 200; E1 green) |
| Backup/restore round trip | `scale-run restore` with the new snapshot path | Holds (0 mismatches) |
| Health / ready under load | `/ready` polled during load and during the 860 MB drill | Holds (60/60, max 0.26 s) |
| Sync / truncation guards (not touched by fixes 30–33) | E1 truncation + skip + fence suites | Holds |

## 3. Findings (round 8)

### P0 — none.

### P1 — none.

### P2 — none open in this area (r7 O-7 and O-8 FIXED, see §0).

### P3
- **O-11 — An app-role INSERT of an anchor row with an invented key id is absorbed into an automatic "key rotation".**
  `services/auditChain.js chooseAnchor` classifies any row whose `kid` differs from the current key as "foreign"
  (`:153-156`); `verify` sets `rotatedOnly` when every non-ok ledger is merely `key_rotated`; `nightly` then writes new
  anchors and returns ok. Repro: `node /tmp/claude-0/p11ops-r8/scripts/anchor-fakekid.js <repo>` on a throwaway DB
  (step a). The baseline is not lowered (the last current-key anchor and the foreign row's content still constrain), so
  no tampering is hidden; but a forged row ends as an "expected" rotation event, and a real rotation event can carry a
  forged kid unnoticed. Suggested: have `reencrypt-secrets.js --apply` record the expected new kid in `audit_chain_meta`
  and only auto-resume to a recorded kid (anything else = `unverifiable`, operator acknowledgement). Test: invented kid
  without a recorded rotation must not re-anchor. Rollback risk: low.
- **O-12 — Rotation on a database hardened before migration 137 fails `unverifiable` every night until the DBA re-runs
  the hardening script.** Migration 137 skips the `kid` column with a NOTICE when the anchor table belongs to
  `sdp_audit_owner`; `rotatedOnly` requires `kidColumn`. The runbook (`docs/ops/EXPLOITATION.md`, rotation bullet) should
  state "re-run `harden-audit-grants.sql` after deploying migration 137, before any rotation"; or `verify` could flag the
  missing `kid` column as its own actionable error. Low likelihood (gate D2 not yet run anywhere).
- **O-13 — Drill sidecar trust.** `readDumpCounts` ignores the recorded `dump` name; offsite copies carry no sidecar
  (drill on a restored offsite copy falls back to live counts → false FAIL on a busy server, with a note). Suggest
  checking `j.dump === basename(dumpFile)` and copying the sidecar offsite (or embedding counts in the encrypted dump).
- **O-5 residual** — blocking budget check has no minimum sample size (n = 1 per class passes); `field.envelope`
  writes still never enter a budget class.
- **O-9, O-10, sync `openDump`/`rewriteSchema`** (one 378 ms event-loop stall observed during the drill), and the
  carried P3 list in §0 — unchanged.

## 4. Per P03 lot touching operations — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L13 Operations resilience (incl. `policy_center_enabled`) | **GO PILOT** (AI panel recommendation, not a decision) | Both r7 P2s fixed and re-verified end to end (drill PASS under concurrent writes with an 860 MB store; rotation resumes the audit chain through the real nightly job). Tests 263/263, restore 0 mismatches, `/ready` 60/60 under load. Remaining items are P3 (O-11..O-13, O-9, O-10). General deployment still needs G-11 and the capacity gate (below), PG17 and a soak on the real server. |
| Business-readiness pack (runbook B2/B4/D1, EXPLOITATION) | **CONDITIONAL** (AI panel recommendation, not a decision) | The rotation paragraph now describes the anchor behaviour; add the O-12 ordering note (re-run hardening after migration 137) and say a drill on an offsite copy uses live counts (O-13). |
| Activation tooling (`activate-switches`) | **GO PILOT** (AI panel recommendation, not a decision) | Unchanged for this seat; tokens now fail closed without `SDP_CONFIG_KEY`. |
| Policy Control Center | **GO PILOT on activation** (AI panel recommendation, not a decision) | Unchanged for this seat. |
| L10 Reporting rhythm (connector health) / L11 Site operations evidence (ops part) | **GO PILOT** (AI panel recommendation, not a decision) | Freshness SLI, sync runner and truncation guards hold (E1). |
| Portfolio Lots 2–6 (ops part: migrations and rollbacks) | **GO PILOT** (ops part only) (AI panel recommendation, not a decision) | Migrations 137/138 apply on a fresh DB and survive backup/restore (E4); rollbacks transactional (E1). |
| Others | out of this seat's area — no recommendation. |

## 5. Human gates still empty in this area (`docs/sdp360/completion/RELEASE-GATES.md` at 7afb9536 — decision columns blank)
- Backup / restore RPO-RTO (G-11) — CAB + SRE: file-store retention and size, link policy, offsite drill behaviour (O-13).
- Capacity — load / soak result accepted (E-B05) — SRE + DBA; `docs/ops/perf-budgets.json` still PROPOSED, `approved_by: null`; no soak, no production-size store, test cluster PG16 not PG17.
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05).
- Penetration test / accepted analysis (E-B05, X-B-03).
- CAB — dependency release D-11 / PostgreSQL-only cutover PO-08; Production deployment GO/NO-GO; DBA execution of `harden-audit-grants.sql` (runbook D2, not run here; must follow migration 137 — O-12).
- Policy decisions surfaced, **not** filled: statement timeout, `SYNC_TRUNCATION_SHRINK_CONFIRMATIONS`, `SDP_BACKUP_ALLOW_PLAINTEXT`, `restore_drill_full`, file-store backup target / retention / size limit, whether `SDP_BLOB_ROOT` is supported, SLO targets and a minimum sample size for blocking budgets, who may issue operator tokens, whether an unrecorded key rotation may auto-resume the audit chain (O-11).

*AI review — not an independent human review. AI panel recommendations are not decisions.*
