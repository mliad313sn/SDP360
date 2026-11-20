# P11 qualification — ROUND 4 — seat: operations (Operations / SRE)

**AI review — not an independent human review.** AI panel seat "operations". No live system touched, no product
code modified, nothing pushed/merged/tagged, no human decision filled. Frozen SHA: `e43d11d5738dc4af650bd06715c54e6927f1649e`
(clone `/home/user/qual/operations`, `git rev-parse HEAD` confirmed; agent-execution narratives not read).
The round-1, r2 and r3 files were not changed. Throwaway proofs are in `/tmp/claude-0/p11ops-r4/` (new) and the r3 repros are reused
from `/tmp/claude-0/p11ops-r3/` and `/tmp/claude-0/p11attack-r3/ratchet-double.js` (mine in r3). Throwaway DB
`sdp_test_p11ops_r4` (`tools/test/scale-run.js prepare --rows=20000`) was dropped by name at the end, after confirming that 0 databases
matching `sdp_test_p11ops_r4%` remained. The restore round-trip target is dropped by scale-run itself. The cred/env files were deleted.
No other database was touched. The host was shared with other seats (load average 12-13 during my load run), so latency figures are
**not comparable** with round 3.

## 0. Round-3 findings re-checked at e43d11d (fixes 10–13)

| R3 | Claimed fix | Repro re-run at e43d11d | Verdict |
|---|---|---|---|
| **N-02r (P2)** the anchor is re-set by any run with fetched ≥ stored, so the ratchet still works | 60d16efb / fix 10 (`nextAnchorState`: the anchor only moves up, a lower count is `pending` and needs an operator confirmation, `tools/sync/confirm-shrink.js`, migration sync/114) | (a) `ratchet-double.js` on my own DB gives 100 → 81 → 81 with the anchor kept at 100. The 66-row runs are then **refused** ("fetched 66 rows but 81 are stored, last confirmed 100") 6 times, and the table stays at 81. (b) The pure sequence 81, 82, 66, 67, 54, 55, 44 (`guard-pure.js`) is accepted for 81 and 82; **66 and every later value is REFUSED** and the table stays at 82. | **FIXED** (default config). Residuals: see §2 sync row (P3) |
| **N-06 (P2)** `/ready` is unbounded under a table lock and drains the pool | 18f1d96c / fix 13 (SET LOCAL statement/lock timeout 1 s, single in-flight probe, hard timer, 2 s fail cache) | `n06b.sh` holds `ACCESS EXCLUSIVE` on `sync_metadata` for 45 s, then sends **30** anonymous `/ready` in parallel. All 30 get **503 in about 0.9–1.0 s**. A login during the lock gets **200 in 0.115 s**. Five later `/ready` calls get 503 in about 1.0 s. After release, `/ready` answers 200. | **FIXED** |
| **N-08 (P2)** the freshness SLI drops a job that never succeeded and reads 100 % | b9267fea | `sli-neverok.js` gives `value null` and both jobs are listed (`zoho.requests` = `never_ok`) | **FIXED** (residual: new N-09 below) |
| **N-07 (P3)** `latestDump`/`prune` use name order, so an operator file wins | 6ba34945 (`isDumpName` = exact stamp regex) | `bk-latest.js`: `latest = …20261119T000000Z`, `prune(keep=1)` deletes only the older real dump, and `before-upgrade.sql` is ignored (kept, never read) | **FIXED** |
| **F-04 (P2)** anonymous `/health` exposes Zoho OAuth state | a7565f27 | `curl /health` gives `{"status":"ok","uptime":"14s"}` only. The detail moved to admin `/api/health/deps zoho_detail` | **FIXED** |
| **F-05 (P2)** backup in plaintext without `SDP_BACKUP_KEY` | 6ba34945 | `bk-key.js`: no key gives **REFUSED `BACKUP_KEY_MISSING`, pg_dump not spawned, 0 files**. `ALLOW_PLAINTEXT=true` is still refused. `ALLOW_PLAINTEXT=1` writes a plaintext dump with `plaintext_override:true`. | **FIXED** (the code default is now refuse; the override remains a human policy choice) |
| F-07 (P2) noisy load evidence | — | load: the `write` class is still OVER (50 % = by-design `field.envelope` 400) | **NOT FIXED** |
| F-07b (P3) positional arg ignored in blocking mode | — | `PERF_BUDGETS_BLOCKING=1 perf-budget-check.js <json>` prints "nothing to check" and exits 0 | **NOT FIXED** |
| N-04, N-05, F-06, F-08, F-09, F-10 (P3) | — | not in the fix diff | NOT FIXED (P3, accepted as later) |

## 1. Evidence re-run at e43d11d (command · result)

Env: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `NODE_OPTIONS="--require tools/test/blocking-stdio.js --require tests/_default-env.js --import file://tests/_pg-boot.mjs" node --test --test-force-exit --test-concurrency=4 <files>`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | 35 files: activate-switches, assets-sync(-status.smoke), backup-encrypt/job/schedule, boot-integrity, db-restore, health-deps(.smoke), health-public, health-version(-provenance,.smoke), perf-baseline, perf-budget-check, perf-calendar-helpdesk-scan, ready-probe.smoke, ready-readonly, **ready-timeout**, restore-drill(-admin-card,-full), sdp-manager-probe, sdp-manager.smoke, sli-readings, sync-drift, sync-jobs-registry, sync-routes.smoke, sync-runner, sync-schedule, sync-skip-semantics, sync-write-fence, zoho-sync-survey-truncation, zoho-sync-truncation-anchor, zoho-sync-truncation-guard | **199 tests, 199 pass, 0 fail, 0 skip**, 225 s, exit 0. Log: `/tmp/claude-0/p11ops-r4/e1.out` | VERIFIED |
| E2 | Load: my own `node server.js` on PORT 3594 against `sdp_test_p11ops_r4` (20k tickets). Command: `tools/test/load.js --sessions=5 --duration=180 --scenarios=reports,helpdesk,field,export,pages,deck --pid --pg-stat-url` | 1 536 req, 8.5 req/s, **0 × 5xx**. The 128 errors (8.3 %) are all by-design `field.envelope` 400. p95: page_data 374 ms, sync 201, write 397, export 294, **deck_generation 7 070 ms** (all-sites monthly deck p50 5.0 s, against 1.9 s in R3 — measured on a host at load average 12-13, so **not comparable**). RSS 120 → 382 MB. Max 28 DB connections, **0 lock waits**. `/ready` was sampled every 3 s during the run: **60/60 = 200**, max 0.18 s. Table: `/home/user/qual/out/r4-operations-load-run.md` | VERIFIED (observation) |
| E3 | `perf-budget-check.js --load=<json>` | page_data, sync, export and deck_generation are within budget; write is OVER (by-design 400s). Exit 0 in warn mode, exit 1 with `PERF_BUDGETS_BLOCKING=1` | VERIFIED |
| E4 | `scale-run.js restore --db=sdp_test_p11ops_r4` (includes migrations 117 and 120) | 222 tables, 47 965 rows, encrypted=true, **0 mismatches**, 11.2 s; the target was dropped | VERIFIED |
| E5 | R3 repros (section 0) | as above | VERIFIED |
| E6 | `tools/ops/activate-switches.js` on my own DB: `--plan`, `--apply --lots=L01,L02 --rollback-dir=…`, then one key changed by hand, then `--rollback` | 20 switches applied with 20 `config_changed` journal rows. The rollback restored 19 and **reported the hand-changed key as a conflict and left it alone**. 39 journal rows in total. | VERIFIED |
| E7 | Installer PowerShell (`tools/installer/tests/run-all.ps1`) | no `pwsh` on the host, so not executed | NOT VERIFIED |
| E8 | Soak longer than 3 min, production volume, an external `/ready` availability SLI | not run | NOT VERIFIED |

Counts: **6 verified, 2 not verified.**

## 2. New claims attacked at e43d11d (one per capability; none of them repeats an earlier attack)

| Capability · claim | Attack | Outcome |
|---|---|---|
| Packaging / boot (new lot Policy Center): the center enforces four-eyes on the high-risk report_config rules (`routes/policyCenter.js`, `services/policyCatalogue.js`) | `tools/deploy/make-update-package.js listRuntimeFiles()` was checked for the files the catalogue reads at runtime. Then `pc-nodocs.js` simulated a packaged install (reads under `docs/ops/` fail). | **BROKEN.** `docs/ops/policy-catalogue.json` and `docs/ops/FLAG-REGISTER.json` are **not in the update package** (`EXCLUDE_PREFIXES` contains `docs/`). In the repo, 78 report_config keys are four-eyes (for example `authz_enforce_caps`, `dashkey_scope_mode`, `emergency_access_enabled`, `csp_strict_pages`). In a packaged install there are **0**: `four_eyes=false`, `needsSecondPerson=false`, `category=null`, no min/max, no recommendation, and the 3 `excluded` runtime-state keys become editable. The failure is silent (`readJson` falls back). → **N-10** |
| Sync: "cumulative loss since the last confirmed count is bounded by the tolerance" (fix 10) | (a) `guard-pure.js` with `SYNC_TRUNCATION_SHRINK_CONFIRMATIONS=2` (env, PROPOSED) and a repeated cap 81, 81, 81, 66, 66, 66, 54. (b) An anchor store whose get/set throw. (c) `confirm-shrink.js --count=999999` (dry run). | (a) Accepted down to 54, so the policy knob re-opens the ratchet for a deterministic cap. This is **documented in the code** as the trade-off. (b) Accepted 100 → 36 with only a `console.warn` ("stored-only guard"). (c) The tool accepts a count **above** the anchor, so a typo blocks every later sync (fail-closed). → P3 notes |
| Health: "/ready answers whether we can serve" under ordinary traffic (not a probe flood) | `lock-user.sh` locks `weekly_reports` (ACCESS EXCLUSIVE, 45 s) while 15 authenticated `GET /api/reports` run, then sends `/ready`, a login and `/api/sync/status` | `/ready` answers **503 timeout in 2.0 s** (holds). All 15 report reads wait **43 s**, and the login waits **38 s** (pool starvation). The app pool has no `connectionTimeoutMillis` and no statement timeout (`services/pgDb.js:82`). → N-11 (P3) |
| Health under deck load | `/ready` sampled 60× during the deck load run | Holds: 60/60 200, max 0.18 s (no false 503 from the new 1 s statement timeout) |
| SLI: "a job's history starts at its first ok run" (`services/sliReadings.js`) | `sli-latefirst.js`: `zoho.requests` fails 696 times over 29 days, then has its **first ever** ok run 1 h ago | **BROKEN.** `sync_freshness.value = 100`, `zoho.requests fresh_pct 100, measured_from = 1 h ago`. The errors before the first ok are ignored, so a job that was dead for a month reads 100 %. → **N-09** |
| Backup: "refused BEFORE pg_dump without a usable key" (fix 13) | `bk-key.js`: a key of 16 spaces, `ALLOW_PLAINTEXT=true`, and a fake dump smaller than 1 KB | Holds for the missing key and `=true`. A 16-space key is accepted as "encrypted" (P3). A dump smaller than 1 KB is rejected but **left on disk**, and its name matches `isDumpName`, so `latestDump` would pick it (P3). |
| Ops tooling (new): activate-switches rollback is safe | E6 + a hand change between apply and rollback | Holds (conflict reported, not overwritten). P3: an entry with `from == null` is rolled back to a literal `'0'`/`false` row, which pins the value instead of returning to "default". |
| Boot integrity: migrations 117/120 are applied, round-trip and are reversible | E1 boot-integrity + E4 restore + rollback scripts present in `db/postgres_rollback/117_*`, `120_*` | Holds |

## 3. Findings (round 4)

### P0 — none.

### P1
**N-10 — The Policy Control Center loses its four-eyes rules, categories and bounds in every packaged install, because its catalogue lives under `docs/`, which the update package excludes.**
- Where: `services/policyCatalogue.js:20-21` (`CATALOGUE_FILE`/`REGISTER_FILE` under `docs/ops/`, read at runtime with a silent fallback at line 25) and `tools/deploy/make-update-package.js:35-37` (`EXCLUDE_PREFIXES` includes `docs/`).
- Repro: `node -e "const m=require('./tools/deploy/make-update-package.js');const f=m.listRuntimeFiles();console.log(f.includes('docs/ops/policy-catalogue.json'))"` prints `false`. Then `node /tmp/claude-0/p11ops-r4/pc-nodocs.js <clone> hide` shows `four-eyes entries: 0` and `authz_enforce_caps four_eyes=false needsSecond=false`. The same script with `show` gives 78 entries and `four_eyes=true`.
- Impact: once `policy_center_enabled=1` on a server installed from a package, a single super_admin can apply high-risk access changes (capability enforcement, dash-key scope, emergency access, CSP) through the center, which advertises four-eyes. Nothing warns that the rules are missing. The legacy admin cards were never four-eyes, so this is not a new bypass of an existing boundary. It is, however, a control shown as present that is absent, on the very lot that introduces it. P1 **for activating `policy_center_enabled`**; while the switch is off (default) it has no effect.
- Test to add: a packaging test asserting that every file read at runtime by `services/` or `routes/` is in `listRuntimeFiles()`, or move the catalogue next to the code. And `policyCatalogue.build()` must fail closed (center refuses writes / reports `catalogue_missing`) when the catalogue file is unreadable.
- Rollback risk: none (data file location). Same class, pre-existing and lower impact: `services/connectorReadings.js:97` reads `docs/sdp360/completion/CONNECTOR-REGISTER.csv`, so connector owners are blank in a packaged install (P3).

### P2
**N-09 — The sync-freshness SLI ignores failures before a job's first successful run: a job dead for 29 days that succeeds once reads 100 %.**
- Where: `services/sliReadings.js` `compose` (`start = max(from, first ok)`; `errors` are only used when there are no ok times).
- Repro: `node /tmp/claude-0/p11ops-r4/sli-latefirst.js <clone>` prints `value 100`, `zoho.requests measured_from 2026-11-20T07:00Z fresh_pct 100` despite 696 errors in the window.
- Impact: the observation surface (`/api/health/deps sli_30d`) contradicts its "never green on an unmeasured period" rule. It is not on a RAG path, hence P2.
- Test to add: when a job has errors in the window before its first ok, `measured_from` = first run (ok or error) and the failing span counts as not fresh.
- Rollback risk: none.

Carried, not fixed: **F-07** (noisy load evidence: the write class is OVER because of by-design 400s).

### P3
- **N-11** The app PostgreSQL pool has no `connectionTimeoutMillis` and no statement timeout. Under a long table lock, ordinary traffic queues without limit (43 s reads, 38 s login in my repro). `/ready` now reports this correctly (503). Test: a bounded wait for a pool client / statement timeout on user routes. This is SRE policy.
- Truncation guard residuals: (a) `SYNC_TRUNCATION_SHRINK_CONFIRMATIONS≥2` re-opens a cap-driven ratchet (documented trade-off; it must stay a decided SRE policy, not a default). (b) An unreadable anchor store degrades silently to the stored-only guard (console warning only; should log to `system_log`/alerting). (c) `confirm-shrink --count` accepts a value above the current anchor ("confirm shrink" can raise it, so a typo blocks the sync).
- Backup: (a) a passphrase made of whitespace (16 spaces) is accepted as a key. (b) A dump smaller than 1 KB is rejected but not deleted, and its name is a managed dump name, so `latestDump`/drill could select it.
- activate-switches: a rollback of an entry with `from == null` writes a literal `'0'` row (it pins the value instead of following future defaults).
- Runtime reads of `docs/` beyond N-10 (connector owners) — see N-10.
- Load observation: all-sites deck p95 7.1 s at load average 13 (shared host, not comparable). No soak run, so not verified.
- Carried: N-04, N-05, F-06, F-07b, F-08, F-09, F-10.

## 4. Per P03 lot touching operations — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L13 Operations resilience | **CONDITIONAL** (AI panel recommendation, not a decision) | All four round-3 P2s in this area are fixed and reproduced: N-02r, N-06, N-08, F-04/F-05. Tests 199/199; restore 0 mismatches; `/ready` bounded and stable under load. Conditions: (1) G-11 RPO/RTO and the capacity gate approved by humans; (2) the SRE decides the truncation shrink policy (operator-confirm vs N confirmations) and the plaintext override; (3) N-10 fixed **before** `policy_center_enabled` is part of any activated lot (it is proposed in L13). |
| Policy Control Center (`policy_center_enabled`, classified L13) | **NO-GO for activation on a packaged install until N-10 is fixed** (AI panel recommendation, not a decision) | The four-eyes and bound rules disappear in the package. GO PILOT is acceptable on a git-checkout install only after a human confirms the catalogue file is present. |
| Activation tooling (`tools/ops/activate-switches.js`) | **GO PILOT** (AI panel recommendation, not a decision) | Plan, apply and rollback verified with journal rows and conflict detection; outbound switches are skipped by default; the password stays off the command line with `--db-url=env`. |
| L10 Reporting rhythm (connector health part) | **CONDITIONAL** (AI panel recommendation, not a decision) | N-08 fixed, but N-09 can still show 100 % freshness for a job that was dead until yesterday. |
| L11 Site operations evidence (WAN/assets) | **GO PILOT** (AI panel recommendation, not a decision) | The truncation guard now refuses cumulative loss and the assets guard still holds. |
| L14 Portfolio intake (migration 117) | ops part only: **GO PILOT** (AI panel recommendation, not a decision) | The migration applies, survives backup/restore, and has a manual rollback script. Functional review belongs to the PPM seat. |
| Others | out of this seat's area — no recommendation. |

## 5. Human gates still empty in this area (`docs/sdp360/completion/RELEASE-GATES.md` at e43d11d — every decision column is blank)
- Backup / restore RPO-RTO (G-11) — CAB + SRE (row 12).
- Capacity — load / soak result accepted (E-B05) — SRE + DBA (row 27). `docs/ops/perf-budgets.json` still has status PROPOSED and `approved_by: null`.
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05) (row 26).
- Penetration test / accepted analysis (E-B05) — Information Security (row 25); N-10 and N-11 are relevant.
- Security — access policy CG-01/CG-02, authz matrix (row 8); relevant to the Policy Center four-eyes (N-10).
- CAB — dependency release / PostgreSQL-only cutover (row 10) and the production GO/NO-GO (row 24).
- Policy decisions surfaced here, **not** filled: the truncation shrink rule (`SYNC_TRUNCATION_SHRINK_CONFIRMATIONS`), the plaintext backup override (`SDP_BACKUP_ALLOW_PLAINTEXT`), the minimum backup key quality, pool/statement timeouts, SLO targets, and which lot activates `policy_center_enabled`.
