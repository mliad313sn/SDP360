# Load / soak harness (E-Q04, audit Q-04 — preparation)

`tools/test/load.js` drives N concurrent signed-in sessions against a running server and reports p50 /
p95 / p99 latency per step, error rate, 5xx count and the server's resident memory. Node `http` only —
no new dependency. **No threshold is set anywhere**: SLO targets are `UNKNOWN — to be approved`
(see the SLO proposal when it exists); this document records observations.

## Run it

```bash
# a throwaway server on 127.0.0.1 (never production), with a throwaway account
LOAD_USER=load_user LOAD_PASS=… node tools/test/load.js --target=http://127.0.0.1:3456 \
  --sessions=5 --duration=120 --pid=<server pid> --out=load.md --json=load.json
# soak: the same with --duration=3600 (or more)
```

- **Target guard**: only `127.0.0.1`, `localhost`, `::1`. Any other host is refused unless
  `--target-confirm=<exact host>` repeats it — pointing load at a staging server is a decision a person
  takes (and announces); production is never a target.
- **Sign-in**: one login per session at start. The login limiter allows 10 per 15 min per address, so keep
  `--sessions` ≤ 10 or pass existing tokens through `LOAD_TOKENS=t1,t2,…`.
- **Scenarios** (`--scenarios=reports,helpdesk,field,export`): report list → open → save a section
  (the same infra rows written back) · Helpdesk page data (`/api/data/requests-raw`) · a fresh field
  envelope (`PUT /api/field/outbox/:uuid`; `LOAD_FIELD_ACTION_ID=<meetings action id>` makes it a real
  comment-only action update, otherwise the apply step rejects it and only the ledger is exercised) ·
  Risk Register export.
- **Memory**: the server exposes no memory figure, so RSS is read from `/proc/<pid>/status` when `--pid`
  is given; otherwise it is reported `UNKNOWN`.
- Every session writes: audit rows, system_log rows, field outbox rows. Use a throwaway database.

## Local observation — 2026-11-06 (agent sandbox, not a measurement of production)

Booted with the browser-journey recipe (`tests/e2e/fixtures/server.js`: throwaway PostgreSQL 16 database,
every migration, seeded users and one report per site), one editor+field account, 5 sessions × 120 s,
`LOAD_FIELD_ACTION_ID` set. **The harness ran in the same Node process as the server**, so the RSS below
includes the harness itself and 25 000 retained samples. Machine: 4 vCPU Xeon @ 2.1 GHz, 17 GB RAM.

- Target: http://127.0.0.1:42645 · sessions: 5 · duration: 120 s · scenarios: reports, helpdesk, field, export
- Generated: 2026-11-06T09:33:22.925Z · commit: d51b714 · server started at: 2026-11-06T09:31:21.609Z
- Requests: 25028 · throughput: 208.5 req/s · errors: 0 (0 %) · 5xx: 0
- Server RSS: 150 MB at start → 313 MB at end (max 313 MB)

| Step | n | p50 (ms) | p95 (ms) | p99 (ms) | errors | 5xx | statuses |
|---|---|---|---|---|---|---|---|
| export.risk_register | 4169 | 18 | 35 | 51 | 0 | 0 | 200×4169 |
| field.envelope | 4170 | 29 | 59 | 150 | 0 | 0 | 200×4170 |
| helpdesk.data | 4170 | 13 | 28 | 40 | 0 | 0 | 200×4170 |
| reports.list | 4173 | 15 | 31 | 45 | 0 | 0 | 200×4173 |
| reports.open | 4173 | 21 | 42 | 59 | 0 | 0 | 200×4173 |
| reports.save_section | 4173 | 26 | 56 | 224 | 0 | 0 | 200×4173 |

Reading: no error and no 5xx over 25 000 requests; the save step's p99 (224 ms) is the widest tail. The
RSS rise (150 → 313 MB in two minutes) is not interpretable from this run (harness + server share the
process, synthetic data); a soak against a separately started server with `--pid` is the measurement to
make before any conclusion.

## Left for a person

- Choose the staging host and window for a real run (`--target-confirm`), and who is told.
- Set SLO targets (latency per step, error rate, memory growth over a soak) — none are proposed here.
- A soak of several hours on production-like volumes (restored copy, data owner's agreement).
