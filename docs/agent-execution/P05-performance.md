# P05 — Performance budgets and service levels (qualification evidence)

> **AI-produced evidence (agent, 2026-11-19).** Synthetic data on a throwaway database in an agent sandbox.
> Nothing here is a production measurement, an approved budget or an approved SLO: every target is
> `UNKNOWN — to be approved by SRE`. The budgets in `docs/ops/perf-budgets.json` are a **proposal**
> (`approved_by: null`). The full suite was **not** re-run by this lot (preamble rule); see the
> orchestrator's latest full-suite run. Targeted tests are listed at the end.

## 1. Environment

| Item | Value |
|---|---|
| Machine | 4 vCPU Intel Xeon @ 2.10 GHz, 15 GB RAM, Linux sandbox (not the Windows Server of production) |
| Node.js | v22.23.5 (CI uses Node 24; production runs Node 24 on Windows) |
| PostgreSQL | 16.15, default settings (shared_buffers 128 MB, max_connections 100) — PostgreSQL 17 is the target, not measured here |
| Processes | server (`node server.js`, PORT 34561, 127.0.0.1) and load harness (`tools/test/load.js`) in **separate** processes; PostgreSQL on the same host |
| Commit | branch `qual/p05-perf` from `11d831a` (fixes measured at `4695da02`, soak at `c841d195`) |
| Pools | `services/pgDb.js` default `PG_POOL_MAX=10` per module pool; up to 28 connections were open at once |
| Outbound | none — Zoho keys empty, no SMTP, no connector |

## 2. Dataset

The owner has **not declared a production scale**. The 100 000-ticket rehearsal set was used, as instructed:
`tools/test/scale-run.js prepare` → migrations + `tools/pg/explain-hot.js` seed on the throwaway database
`sdp_test_p05perf`:

| Table | Rows |
|---|---|
| request_records | 100 000 (6 groups, 2025-01-01 → 2025-12-14) |
| system_log | 100 000 |
| field_outbox | 20 000 |
| weekly_reports | 1 248 (13 sites × 96 weeks, all `submitted`) |
| Database size | 78 MB after seed (migrate 1.1 s, seed 2.6 s) |

Not covered by this set: asset tables, meetings / inspections volumes, change and survey tables, attachments.
Those pages were exercised with the seeded (near-empty) volumes only.

## 3. Workload

One throwaway account (`p05_load`, super_admin because submitted reports are frozen for every other role),
one session token reused by 5 virtual sessions (`LOAD_TOKENS`; the login limiter allows 10 sign-ins / 15 min).
Each session loops its scenarios back to back, no think time:

| Scenario | Requests |
|---|---|
| reports | `GET /api/reports` → `GET /api/reports/:id` → `PUT /api/reports/:id/infra` (same rows back) |
| helpdesk | `GET /api/data/requests-raw` (14.6 MB JSON — the Helpdesk page data) |
| pages | `GET /api/meetings/list`, `/api/inspection/list`, `/api/sync/status`, `/api/health/deps` |
| export | `GET /api/risk-register-export?month=` |
| deck | `GET /api/reports/:id/pptx` (weekly) + `GET /api/reports/monthly/all-sites/2025/2/pptx` |
| field | `PUT /api/field/outbox/:uuid` — a **test envelope with no action id**: the apply step rejects it (400) by design; only the outbox ledger is exercised. These 400s are the whole `write` error rate below. |

Runs: a 15-minute soak (**shortened from the 1 h of the prompt**, because disk and CPU are shared with other
agents) with every scenario, and a 2-minute control run without decks or field envelopes.

## 4. Results

### 4.1 Measured bottleneck fixed — all-sites monthly deck

`GET /api/reports/monthly/all-sites/:y/:m/pptx`, single request, idle server:

| Stage | Duration (3 requests) |
|---|---|
| Before (`11d831a`) | 22.2 s · 22.8 s · 22.0 s |
| After fix 1 — calendar helpdesk reader in **one scan** (`reports-db._getCalendarMonthlyHelpdeskPg`, 11 statements → 1) | 5.8 s · 5.5 s · 6.4 s |
| After fix 2 — sites read **concurrently** (`server.js`, `Promise.all` over the sites, deck order unchanged) | 3.7 s · 3.3 s · 3.8 s |

Cause: the deck reads the monthly data of each of the 13 sites, and each read ran eleven sequential seq-scans
of `request_records` (counts and averages on the same month window), one site after the other. Fix 1 folds
each statement's WHERE into a `FILTER` clause of a single aggregate; the values are pinned byte-for-byte by
`tests/perf-calendar-helpdesk-scan.test.js` (values captured from the old reader, then the scan count asserted
— it failed with "read 11 times" before the fix). `tests/pptx-monthly-golden.test.js`, both figure-parity
suites and `pg-reports-aggregates` stay green. Both fixes are defect fixes and ship ON (no switch).

### 4.2 Soak — 15 minutes, 5 sessions, every scenario

3 003 requests · 3.3 req/s · 247 errors (all the rejected test envelopes, 400) · **0 5xx** ·
server RSS 162 MB → 454 MB (max 485 MB) · DB connections max 28 open, max 17 active (p95 15), **0 waiting on a lock**.

| Class | n | p50 ms | p95 ms | p99 ms | error % |
|---|---|---|---|---|---|
| page_data | 1 504 | 521 | 1 160 | 1 434 | 0 |
| sync | 250 | 295 | 777 | 1 272 | 0 |
| write | 499 | 824 | 1 375 | 1 590 | 49.5 (test envelopes) |
| export | 250 | 210 | 603 | 906 | 0 |
| deck_generation | 500 | 1 617 | 14 522 | 15 829 | 0 |

| Step | p50 ms | p95 ms | p99 ms |
|---|---|---|---|
| deck.all_sites_monthly | 11 410 | 15 334 | 16 085 |
| deck.weekly | 548 | 1 330 | 1 538 |
| helpdesk.data | 667 | 1 256 | 1 525 |
| reports.open | 801 | 1 328 | 1 532 |
| pages.meetings | 525 | 1 049 | 1 256 |

### 4.3 Control — 2 minutes, 5 sessions, no decks, no field envelopes

4 086 requests · 33.9 req/s · 0 errors · RSS 245 → 345 MB · DB connections max 12 open, **max 1 active**.

| Class | p50 ms | p95 ms | p99 ms |
|---|---|---|---|
| page_data | 97 | 451 | 777 |
| sync | 52 | 243 | 368 |
| write | 117 | 502 | 673 |
| export | 69 | 304 | 583 |

`helpdesk.data` p95 714 ms (it serialises 14.6 MB), `pages.meetings` p95 500 ms, `reports.open` p95 323 ms.

### 4.4 Slow queries and plans

`log_min_duration_statement = 200 ms` on the throwaway database during the soak: 336 statements over 200 ms.
319 of them are the new single-scan calendar reader (median 218 ms, max 482 ms) — **26 ms alone** (EXPLAIN
ANALYZE below), slow only because five concurrent decks run thirteen of them each. 12 are the calendar Top-10
reader (median 216 ms), 5 the raw request list (median 256 ms).

```
Parallel Seq Scan on request_records (actual rows=672 loops=2)
  Filter: tech_group = '…' AND (created_time)::date >= '2025-02-01' AND (created_time)::date <= '2025-02-28'
  Rows Removed by Filter: 49328
Execution Time: 25.695 ms
```

The `created_time::date` predicate cannot use `idx_rr_created` (text cast). A sargable range
(`created_time >= ? AND created_time < ?`) or an index on `(tech_group, created_time)` would remove the scan;
both change SQL/schema shared by many readers and are **left to the DBA** (see `ADR-E-A05-index-proposals.md`).

`tools/test/scale-run.js plans` (EXPLAIN ANALYZE of the hot readers, idle):

| Reader | Top node | Exec ms | Seq scans > 10k rows |
|---|---|---|---|
| ageing_by_site | Sort | 124.0 | none |
| ageing_by_group | Sort | 89.8 | none |
| calendar_monthly_helpdesk | Aggregate | 125.8 | none |
| site_helpdesk_window | Seq Scan | 73.4 | request_records (100 000 scanned, 1 344 kept) |
| report_list_filtered | Sort | 4.3 | none |
| field_outbox_by_status | Aggregate | 12.2 | field_outbox (20 252 scanned, 10 173 kept) |
| system_log_list | Limit | 6.7 | none |

### 4.5 Findings not changed (reported, not fixed)

1. **Decks run in the request process.** With decks in the mix, page-data p95 goes from 451 ms to 1 160 ms
   and DB active connections from 1 to 17: PPTX building (pptxgenjs + zip) and its reads compete with every
   other request on the same event loop. Moving deck generation to a worker or a queue is a design change
   (P06 owns the server.js refactor); five simultaneous all-sites decks take 11–16 s each.
2. **Helpdesk page data is 14.6 MB per request** (`/api/data/requests-raw`, whole table in memory). It is
   fast on loopback (p95 714 ms) but its cost is bytes over the network and memory per request; a paged or
   windowed endpoint is a product/design decision (an earlier windowing attempt did not help, per CLAUDE.md).
3. **No memory leak observed in 15 minutes**, but RSS grew 162 → 454 MB and stayed high; a 1 h+ soak and a
   heap snapshot comparison are still needed before saying anything about leaks.
4. Up to **28 open connections** from one server (one pool per module, `PG_POOL_MAX` 10 each) on a
   `max_connections` of 100: a second server or the replica scripts must be counted against that limit.

## 5. Budgets (PROPOSED) and CI

`docs/ops/perf-budgets.json` — status PROPOSED, `approved_by: null`. Rule used: the vision figure where one
exists (API p95 < 800 ms, first usable page < 3 s), otherwise the control-run p95 rounded up with headroom.

| Class | p95 budget | Basis |
|---|---|---|
| page_data | 800 ms | vision figure; control 451 ms, with decks 1 160 ms |
| sync | 800 ms | status read; control 243 ms |
| write | 1 000 ms | control 502 ms |
| export | 2 000 ms | control 304 ms, soak 603 ms |
| deck_generation | 10 000 ms | single all-sites deck 3.3–3.8 s; 5 at once 15 s |
| page (browser, first usable) | 3 000 ms | vision figure, from the browser-journey artefacts |

Each class also proposes `error_rate_pct ≤ 1` and `five_xx_max 0`.

- Checker: `tools/test/perf-budget-check.js --load=<load.js --json> | --e2e=<artefacts dir>`.
- CI: step **"Performance budgets (warn mode until approved)"** after the performance baseline
  (`.github/workflows/ci.yml`), reading the browser-journey artefacts. It prints `OVER` rows and exits 0.
- **Switch to blocking:** set the repository variable `PERF_BUDGETS_BLOCKING=1` (GitHub → Settings →
  Variables). The SRE owner decides when, after approving the figures in the JSON (`approved_by`, `approved_at`).
- On this run: control run within every budget; soak over on page_data, write (test envelopes) and decks.

## 6. Service level indicators — 30-day reading

`GET /api/health/deps` (admin tier) now carries `sli_30d` (`services/sliReadings.js`), one item per SLI of
`docs/ops/SLO-PROPOSAL.md`. Every item has `value`, `unit`, `basis` and `target: "UNKNOWN — to be approved by SRE"`;
a reading the server cannot make is `null` with the reason — never 0, never a colour.

| SLI | Reading | Window |
|---|---|---|
| Sign-in | share of login answers without a 5xx (in-process counter `services/sliCounters.js`) + login_success / login_failed counts from system_log | counter since server start (stated), counts 30 days |
| Availability | `null` — needs the external probe below | — |
| Sync freshness | per job, share of time its last ok run was inside `FRESHNESS_HOURS`; value = worst job | 30 days, from the job's first ok run if younger |
| Scheduled delivery | ok/resent ÷ attempts in `report_sent_log` (attempts, not due sends — stated) | 30 days |
| Field apply | applied ÷ settled outbox entries (pending excluded) + hand resolutions | 30 days |
| Database latency | p95 of `SELECT 1` timings taken by `/ready` and `/api/health/deps` | since server start (stated) |
| Backups | age of the last ok `db.backup` run, ok/failed runs, restore drills | 30 days |
| Disk | `null` — no history kept; the current reading stays `items.disk` | — |

Live check on the rehearsal server: sign-in 100 % (1 answer), database latency p95 2.5 ms (5 samples), field
apply 0 % of 252 settled (all test envelopes, rejected by design), backups `null` (no backup job ran there).

### External probe on `/ready` (described, not built — no connector)

- Probe `GET https://<dashboard host>/ready` every **60 s** from **outside the server** (a monitoring tool the
  SRE chooses), timeout 10 s, no credentials (the route is unauthenticated and returns only `{ok, db, last_job_at}`).
- Success = HTTP 200 **and** body `ok:true`; a 503, a timeout or a TLS error is a failed probe.
- Availability = successful probes ÷ probes over 30 days; keep the raw results ≥ 30 days.
- Optionally alert on 3 consecutive failures; read `last_job_at` to spot a server that answers but runs no job.
- Who is paged and the target are SRE decisions.

## 7. Restore drill (own throwaway database only)

`tools/test/scale-run.js restore`: count every table of `sdp_test_p05perf` → `services/backup.runBackup`
(pg_dump + gzip + AES with a throwaway key) → create `sdp_test_p05perf_restored` →
`services/dbRestore.restoreDatabase` (one transaction, confirmation phrase) → recount every table → drop the
restored database. Never run against a live database.

| Step | Run 1 | Run 2 |
|---|---|---|
| Count source (218 tables, 226 048 rows) | 3.5 s | 2.7 s |
| Backup (dump 29.8 MB → stored 3.3 MB, encrypted) | 1.4 s | 1.0 s |
| Create target | 0.3 s | 0.1 s |
| Restore | 4.4 s | 2.4 s |
| Reconcile (recount) | 3.8 s | 2.1 s |
| **Total measured steps** | **13.4 s** | **8.3 s** |
| Wall clock incl. tool start and clean-up | 37 s | 14.8 s |
| Row mismatches | 0 | 0 |

## 8. Gate dossiers

### Capacity gate

| Input | Status |
|---|---|
| Declared production scale (tickets, users, sites, concurrent sessions) | **missing — owner to declare**; this run used the 100 000-ticket rehearsal set |
| Latency per route class at that scale | measured on synthetic data, this sandbox only (§4) |
| Budgets | PROPOSED (`perf-budgets.json`), not approved; CI warn mode |
| Known limits | decks in-process (§4.5-1), 14.6 MB helpdesk payload (§4.5-2), 28 connections per server (§4.5-4) |
| Soak | 15 min only; 1 h+ soak and heap comparison still needed |
| Production-like run (Windows Server, Node 24, PostgreSQL 17, real volumes) | **not done — needs an approved staging target** |
| Decision | open — SRE / service owner |

### Backup / restore gate

| Input | Status |
|---|---|
| RTO input | restore of 78 MB / 226 k rows: 2.4–4.4 s restore, 8–13 s for the whole drill on this sandbox. Scale linearly at your own risk: a production dump must be timed on staging |
| RPO input | the nightly `db.backup` job → worst case ≈ 24 h of data plus the time since the last ok run; `sli_30d.backups` now shows the age of the last ok run. Shorter RPO needs WAL archiving / the replica (`docs/ops/REPLICA-RESTORE.md`) |
| Integrity | 0 row mismatch on 218 tables, both runs; encrypted dump with trailer check |
| RTO / RPO targets | **UNKNOWN — to be approved by SRE / service owner** |
| Production restore drill | not done (never run on a live system by an agent) |

## 9. Commands

```bash
export PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres     # disposable cluster only
node tools/test/scale-run.js prepare                                  # dataset + account (cred file 0600 in tmpdir)
node tools/test/scale-run.js env > env.sh                             # then boot server.js in its own process
LOAD_TOKENS=t,t,t,t,t node tools/test/load.js --target=http://127.0.0.1:34561 --sessions=5 --duration=900 \
  --scenarios=reports,helpdesk,pages,export,deck,field --pid=<server pid> --pg-stat-url=<db url> --json=soak.json
node tools/test/perf-budget-check.js --load=soak.json
node tools/test/scale-run.js plans
node tools/test/scale-run.js restore
node tools/test/scale-run.js drop                                     # drops only sdp_test_p05perf
```

Targeted tests (all green): `perf-calendar-helpdesk-scan` (1), `pg-reports-aggregates`, `pptx-monthly-golden`,
`figure-parity-five-surfaces`, `dashboard-figure-parity`, `site-local-calendar-readers`, `site-report-deps`,
`sli-readings` (5), `perf-budget-check` (4), `load-harness`, `perf-baseline`, `health-deps`, `health-deps.smoke`,
`health-version.smoke`, `explain-hot`, `ci-config`, `await-precedence`, `server-size-budget`,
`authz-matrix-json`, `authz-route-matrix`, inventory tests. `npx eslint` clean on every changed file.
