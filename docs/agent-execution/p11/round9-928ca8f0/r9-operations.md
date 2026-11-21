# P11 qualification — ROUND 9 (re-check) — seat: operations (Operations / SRE)

**AI review — not an independent human review.** AI panel seat "operations". No live system was touched, no product
code was modified, nothing was pushed, merged or tagged, and no human decision was filled in. Frozen SHA:
`928ca8f03c0680acfb2b3eb0c871ba286934c8dd` (clone `/home/user/qual/operations`, HEAD `928ca8f0`; `git status` shows
only the removed agent-execution narratives). Narratives were not read. Earlier round files were not changed. Host
PostgreSQL cluster is **16** (target 17). Shared host: latencies are not comparable across rounds.

Throwaway work: `/tmp/claude-0/p11ops-r9/` (scripts in `scripts/`: `anchor-r9.js`, `upgrade.js`, `drill-offsite.js`,
`proxy.js`; outputs `e1.out`, `e4.out`, `load.*`, `ready.log`, `server.log`, `rep1/`, `rep2/`). Databases I created and
dropped by name with `scale-run.js drop`: `sdp_test_p11ops_r9` (20 000 tickets), `sdp_test_p11ops_r9_hwm`,
`sdp_test_p11ops_r9_upgrade`, `sdp_test_p11ops_r9_upg2` (100 tickets each). The drill targets were dropped by the tool.
The evidence run used `SDP_TEST_RUN_ID=operationsr9` and left 0 databases. After cleanup: 0 matches for
`%p11ops_r9%`, `%operationsr9%`, `sdp_drill_%`. Env file, credentials files, data dir, backups and off-site copies
deleted; my server (pid 23316) and TCP proxy stopped.

## 0. Round-8 findings re-checked at 928ca8f0 (fix 36 and related)

| R8 | Claimed fix | Repro at 928ca8f0 | Verdict |
|---|---|---|---|
| **O-11 (P3)** forged anchor row with invented kid absorbed into an automatic "rotation" | Resume only to a kid recorded in `audit_chain_meta` (`kid:<kid>`, written by `recordAnchors`); unknown kid → `unverifiable`, no resume | `scripts/anchor-r9.js <repo> bypass`, real `nightly()`: n1 key A ok (records `kid:8b7c…`); switch to key B, INSERT anchor row with kid `ffff…`/garbage sig → **n2 FAIL "unknown key id … does NOT resume"** (fix holds for the r8 attack). Then one more INSERT, `audit_chain_meta (k,v) = ('kid:ffff…', 'signed by the nightly job …')` → **n3 OK, re-anchored 12, `from_kids` = [real, ffff…]**. `tools/pg/harden-audit-grants.sql:113` grants the app role `SELECT, INSERT` on `audit_chain_meta`, so the attacker of r8 (app-role INSERT on the anchor table) can also write the "known kid" list. | **PARTIAL** — see O-14 |
| **O-12 (P3)** DB hardened before migration 137: rotation fails every night, runbook silent | `verify` adds an `anchor_error` naming the remedy (re-run `harden-audit-grants.sql`); EXPLOITATION states the ordering | Read: `noKidRemedy` branch in `services/auditChain.js` and the new EXPLOITATION paragraph ("re-run … after deploying migration 137 and before any key rotation"); covered by `tests/p11-r8-audit-ops.test.js` (green in E1). Not re-run on a hardened DB (no superuser hardening run here). | **FIXED** (by reading + test; not independently reproduced) |
| **O-13 (P3)** drill sidecar not bound to its dump; off-site copy has no sidecar | Sidecar records `dump_sha256`/`dump_bytes`; `dumpCountsFor` ignores a mismatching file; sidecar copied off-site | (a) unit probe `bk/`: other name → ignored; altered dump (+1 byte) → ignored "written for a dump of 9 bytes, this file has 10"; bound file → used. (b) End to end `scripts/drill-offsite.js` on my server with a failed-login writer every 1 s: `restore-drill.run({backupFirst:true, offsitePath})` → **PASS**, off-site dir holds `….sql.gz.enc` **and** `….counts.json`; second drill on the **off-site copy** → **PASS, "Reference counts were taken in the dump's own snapshot"**, `system_log` snapshot 20 007 = restored 20 007 while live was 20 015. | **FIXED** (P3 residual O-15: a counts file with no `dump` field / blank sha is accepted "unbound") |
| **O-5 residual (P3)** blocking budget check passes with n = 1 per class | `min_samples_per_class: 5` (PROPOSED) → `insufficient_sample`, blocking fails | Every class n = 1, p95 1 ms → blocking **exit 1** "5 budget class(es) measured with fewer samples than the minimum". Classes without `n` → `no_sample`, blocking **exit 1**. String `n:"1"` → insufficient. | **FIXED** (`field.envelope` 400s still never enter a budget class — unchanged, P3) |
| O-9 (`SDP_BLOB_ROOT` honoured by backup only), O-10 (drill file-store check not independent), sync `openDump`/`rewriteSchema` synchronous | — | not in the fix diffs (`git diff 7afb9536..928ca8f0 --stat`); drill max event-loop lag this round 174 ms | NOT FIXED (P3) |
| Carried P3s (N-12 residuals, project-document blob folder, pilot-metrics actor filter, N-04, N-05, F-06, F-08..F-10, unsealed rollback files, DB-credential holders writing switches) | — | not in the fix diffs | NOT FIXED (P3), not re-tested |

## 1. Evidence re-run at 928ca8f0 (command · result)

Env: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres SDP_TEST_RUN_ID=operationsr9`,
`NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit --test-concurrency=4 <files>`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | 46 files: the r8 set of 44 (activate-switches(+r6 smoke), assets-sync(-status smoke), audit-chain(-r6), auth-db-busy.smoke, backup-encrypt/job/schedule, blob-backup(-r6), boot-integrity, db-restore, health-deps(.smoke), health-public, health-version(-provenance,.smoke), p11-r7-audit-ops, perf-baseline, perf-budget-check, perf-calendar-helpdesk-scan, pg-pool-acquire-timeout, pg-pool-idle-error, ready-probe.smoke, ready-readonly, ready-timeout, report-config-switch-canonical, restore-drill(-admin-card,-full), rollback-scripts-transactional, sli-readings, sync-drift, sync-jobs-registry, sync-routes.smoke, sync-runner, sync-schedule, sync-skip-semantics, sync-write-fence, zoho-sync-survey-truncation, zoho-sync-truncation-anchor, zoho-sync-truncation-guard) **+ http-error + p11-r8-audit-ops** | **278 tests, 278 pass, 0 fail, 0 skip**, 249 s, exit 0; 0 test DBs left. Log `/tmp/claude-0/p11ops-r9/e1.out` | VERIFIED |
| E2 | Load: own `node server.js` on 127.0.0.1:3599 (fresh clone boots against a freshly migrated DB via a local TCP proxy) ; `tools/test/load.js --sessions=5 --duration=180 --scenarios=reports,helpdesk,field,export,pages,deck --pid --pg-stat-url` | 1 700 requests, 9.4 req/s, **0 × 5xx**; 142 errors = all designed `field.envelope` 400s. Class p95: page_data 422 ms, sync 220, write 436, export 195, deck_generation 6 321 (all-sites monthly p95 8.7 s, r8 6.5 s — shared host). RSS 120 → 405 MB. Max 25 DB connections, 0 lock waits. `/ready` every 3 s: **60/60 = 200**, max 0.20 s. Table: `/home/user/qual/out/r9-operations-load-run.md`. (First attempt 429 — my failed-login writer had used the persistent login budget; cleared `rate_limit_hits` on my throwaway DB only, as in r8.) | VERIFIED (observation) |
| E3 | `perf-budget-check.js --load=<E2 json>`, warn and blocking | 5/5 classes within PROPOSED budgets, n ≥ 140 each, exit 0 both modes; budgets `approved_by: null` | VERIFIED |
| E4 | `scale-run.js restore --db=sdp_test_p11ops_r9` | 229 tables, 47 795 rows, encrypted, **0 mismatches**, 6.9 s; target dropped | VERIFIED |
| E5 | Restore drill in-process, concurrent writes, plus drill on the off-site copy | PASS ×2 (O-13 row) | VERIFIED |
| E6 | DB outage behaviour (fix 35 F-30, ops angle) — TCP proxy cut under my running server | §2 | VERIFIED |
| E7 | Round-8 repros (§0) | as in §0 (O-12 by reading + test only) | VERIFIED (O-12 partly) |
| E8 | Installer PowerShell suite (`tools/installer/tests/run-all.ps1`) | no `pwsh` on host; read only | NOT VERIFIED |
| E9 | Soak > 3 min, production volume, multi-GB store on the real Windows server, PG17, external `/ready` SLI | not run | NOT VERIFIED |

Counts: **7 verified, 2 not verified.**

## 2. New break attempts at 928ca8f0 (one per capability, aimed at code changed by fixes 34–36)

| Capability · claim | Attack | Outcome |
|---|---|---|
| Audit chain (fix 36): "resumes only to a KNOWN prior key; an unknown kid is never resumed" | App-role INSERT of `kid:<forged>` into `audit_chain_meta` (granted INSERT after hardening) next to the forged anchor | **Broken** — resumes and re-anchors (O-14, P3). Baseline not lowered, nothing hidden; the "known kid" list is as forgeable as the anchor row it is meant to vet, and the runbook calls that INSERT "a human decision". |
| Audit chain (fix 36): "the highest position the job logged in system_log constrains a truncated ledger" | `scripts/anchor-r9.js <repo> hwm`: one app-role `logEvent` (`audit_chain_anchor`, `anchored:1`, ledger rows = real + 500) — nothing else touched | Same-key nights stay ok (anchor present, hwm unused). **First documented rotation → `broken` "row count shrank from 500 … (highest position the nightly job logged)", every night** (n3, n4). A single unsigned, app-writable log row silently arms a permanent red that only fires on the next legitimate rotation (O-16, P3 — new vector introduced by fix 36; same class as r8 (b)). `system_log` read window is the last 400 events. |
| Audit chain upgrade path | `scripts/upgrade.js`: anchors written by the r8 code (git archive of 7afb9536), then key rotated before any fix-36 night | `unverifiable "unknown key id"` every night until a DBA records the kid. **Documented** in EXPLOITATION ("let at least one ordinary nightly run complete under the current key before rotating it"). Holds as designed. |
| Restore drill (fix 36 O-13): "a counts file is used only when it belongs to this dump" | Sidecar with no `dump` field, and with `dump_sha256: ""` | Both accepted `unbound` (the note says "only its dump name was checked" — when the field is absent nothing was checked). O-15, P3; needs write access to the backup dir, which can replace the dump anyway. |
| Perf budgets (fix 36) | n = 1 per class; classes without n; string n | All blocking exit 1. Holds. |
| DB outage (fix 35 F-30): "503 database_unavailable instead of 401; the browser is not logged out" | Server on a proxy, proxy cut (ECONNREFUSED) with a live session | `/ready` 503 `db:false`; `/api/reports`, `/api/inspection/list`, `/api/data/requests-raw`, `/api/health/deps`, `/api/reports/auth/me` → **503 `database_unavailable` + correlation id**; proxy back → `/ready` 200 and the SAME session cookie gets 200 on `/api/reports` within 3 s. Residual: **`POST /api/reports/auth/login` during the outage → 500 `internal_error`** (`server.js:3798` `catch(e){ fail(res, e) }` does not use `asUnavailable`). O-17, P3. |
| Boot integrity (migration 139, fix 34/35 code) | Booted `server.js` from the clean clone on a freshly migrated throwaway DB; boot-integrity test | Holds (`/ready` 200; E1 green). |
| Backup/restore round trip | `scale-run restore` | Holds (0 mismatches). |
| Health / ready under load | `/ready` polled during load | Holds (60/60, max 0.20 s). |
| Sync / truncation guards (untouched by fixes 34–36) | E1 truncation + skip + fence suites | Holds. |

## 3. Findings (round 9)

### P0 — none.
### P1 — none.
### P2 — none.

### P3
- **O-14 — "Known kid" list is app-role writable (O-11 only partially fixed).** `recordAnchors` writes `kid:<kid>` into
  `audit_chain_meta`, and `harden-audit-grants.sql:113` grants the app role INSERT on that table; the r8 attacker can
  add the forged kid there and the job resumes. Repro: `PG_URL=<throwaway> node /tmp/claude-0/p11ops-r9/scripts/anchor-r9.js <repo> bypass`
  → n2 FAIL (unknown kid), n3 OK after the meta INSERT. EXPLOITATION wrongly presents that INSERT as an operator-only,
  human step. Suggested: sign the `kid:` meta value with the key it names (an HMAC only the key holder can produce), or
  record known kids in a table the app role cannot write; test: an app-role-inserted `kid:` row must not make a kid
  "known". Rollback risk: low. No tampering is hidden (baseline still constrains).
- **O-16 — Unsigned `system_log` high-water mark can be forged to break the chain at the next legitimate rotation.**
  Repro: `… anchor-r9.js <repo> hwm`. One app-writable event with an inflated `rows` makes every post-rotation night
  `broken` until the ledger grows past the forged figure (DBA cannot delete append-only rows). Not a hiding vector;
  availability/false-alarm only. Suggested: take the hwm only from events that carry a signed anchor (`signed_written`
  + verifiable signature over the logged position), or ignore events whose `rows` exceed the ledger by more than a
  rotation can explain and report them as suspicious rather than "broken".
- **O-15 — Drill accepts an unbound counts file with no `dump` field / blank sha** (`services/backup.js dumpCountsFor`).
  Suggested: require `dump` to be present and equal; treat blank `dump_sha256` as absent only for files older than fix 36.
- **O-17 — Login during a DB outage answers 500 `internal_error`, not 503 `database_unavailable`** (`server.js` login
  route catch). Repro: §2 proxy cut, then `POST /api/reports/auth/login`. The user sees "internal error" instead of
  "retry"; no data effect.
- **O-5 residual** — `field.envelope` writes never enter a budget class (unchanged).
- **O-9, O-10, sync `openDump`/`rewriteSchema`** and the carried P3 list in §0 — unchanged.

## 4. Per P03 lot touching operations — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L13 Operations resilience (incl. `policy_center_enabled`) | **GO PILOT** (AI panel recommendation, not a decision) | No P0–P2. O-13 and O-5 fixed and re-verified end to end (drill on the off-site copy PASS under concurrent writes; blocking budgets refuse thin samples). E1 278/278, restore 0 mismatches, `/ready` 60/60 under load, DB outage → 503 with session preserved and recovery in 3 s. Audit-chain residuals (O-14, O-16) are app-role-forgery P3s with no hidden tampering. General deployment still needs G-11, the capacity gate, PG17 and a soak on the real server. |
| Business-readiness pack (EXPLOITATION / runbook B2/B4/D1) | **CONDITIONAL** (AI panel recommendation, not a decision) | O-12 ordering note and O-13 off-site behaviour now documented. Correct the rotation paragraph: the `kid:` INSERT is not operator-only while the app role holds INSERT on `audit_chain_meta` (O-14); mention that a forged log event can block a rotation (O-16). |
| Activation tooling / Policy Control Center (ops angle) | **GO PILOT** (AI panel recommendation, not a decision) | Unchanged for this seat; CLI token-evidence change owned by the security seat. |
| L10 Reporting rhythm (connector health) / L11 Site operations evidence (ops part) | **GO PILOT** (AI panel recommendation, not a decision) | Freshness SLI, sync runner, truncation guards hold (E1). |
| Portfolio Lots 2–6 (ops part: migrations / rollbacks, incl. migration 139) | **GO PILOT** (ops part only) (AI panel recommendation, not a decision) | Migrations up to 139 apply on a fresh DB and survive backup/restore (E4); rollbacks transactional (E1). |
| Field lot (ops part: DB-outage behaviour) | **GO PILOT** (ops part only) (AI panel recommendation, not a decision) | 503 instead of 401 verified live; login-500 residual is P3 (O-17). |
| Others | out of this seat's area — no recommendation. |

## 5. Human gates still empty in this area (`docs/sdp360/completion/RELEASE-GATES.md` at 928ca8f0 — decision columns blank)
- Backup / restore RPO-RTO (G-11) — CAB + SRE (row 12).
- Capacity — load / soak result accepted (E-B05) — SRE + DBA (row 27); `docs/ops/perf-budgets.json` still PROPOSED, `approved_by: null`, `min_samples_per_class: 5` PROPOSED; no soak, no production-size store, test cluster PG16.
- QA lead — CI green on the target SHA, skipped tests reviewed (row 26).
- Penetration test / accepted analysis (row 25).
- CAB — dependency release D-11 / PostgreSQL-only cutover PO-08 (row 10); Production deployment GO/NO-GO (row 24); DBA execution of `harden-audit-grants.sql` after migration 137 (runbook D2, not run here).
- Policy decisions surfaced, **not** filled: statement timeout, `SYNC_TRUNCATION_SHRINK_CONFIRMATIONS`, `SDP_BACKUP_ALLOW_PLAINTEXT`, `restore_drill_full`, file-store backup target/retention/size, `SDP_BLOB_ROOT` support, SLO targets and the minimum sample count for blocking budgets, who may record a prior key id in `audit_chain_meta` (and with what control, O-14).

*AI review — not an independent human review. AI panel recommendations are not decisions.*
