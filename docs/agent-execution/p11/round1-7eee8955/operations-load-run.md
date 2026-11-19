# Load / soak run — observation (E-Q04)

> Throwaway database, synthetic data, one machine. **No threshold** — a person sets SLOs (docs/ops/LOAD-TEST.md).

- Target: http://127.0.0.1:3591 · sessions: 5 · duration: 180 s · scenarios: reports, helpdesk, field, export, pages
- Generated: 2026-11-19T18:11:47.802Z · commit: 7eee895 · server started at: 2026-11-19T18:08:11.951Z
- Requests: 27515 · throughput: 152.8 req/s · errors: 2750 (10 %) · 5xx: 0
- Server RSS: 116 MB at start → 326 MB at end (max 326 MB)
- DB connections (pg_stat_activity, this database): max 15 open · max 3 active (p95 2) · max 0 waiting on a lock · 89 samples

| Step | n | p50 (ms) | p95 (ms) | p99 (ms) | errors | 5xx | statuses |
|---|---|---|---|---|---|---|---|
| export.risk_register | 2750 | 27 | 58 | 81 | 0 | 0 | 200×2750 |
| field.envelope | 2750 | 34 | 73 | 109 | 2750 | 0 | 400×2750 |
| helpdesk.data | 2750 | 20 | 47 | 69 | 0 | 0 | 200×2750 |
| pages.health_deps | 2750 | 28 | 57 | 79 | 0 | 0 | 200×2750 |
| pages.inspections | 2750 | 24 | 57 | 78 | 0 | 0 | 200×2750 |
| pages.meetings | 2750 | 30 | 66 | 96 | 0 | 0 | 200×2750 |
| pages.sync_status | 2750 | 18 | 45 | 65 | 0 | 0 | 200×2750 |
| reports.list | 2755 | 34 | 67 | 99 | 0 | 0 | 200×2755 |
| reports.open | 2755 | 27 | 62 | 95 | 0 | 0 | 200×2755 |
| reports.save_section | 2755 | 42 | 84 | 182 | 0 | 0 | 200×2755 |

## API latency per route template (F-UX-05) — observation only, no threshold

| Route | n | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---|---|---|---|
| GET /api/data/requests-raw | 2750 | 20 | 47 | 69 |
| GET /api/health/deps | 2750 | 28 | 57 | 79 |
| GET /api/inspection/list | 2750 | 24 | 57 | 78 |
| GET /api/meetings/list | 2750 | 30 | 66 | 96 |
| GET /api/reports | 2755 | 34 | 67 | 99 |
| GET /api/reports/:id | 2755 | 27 | 62 | 95 |
| GET /api/risk-register-export | 2750 | 27 | 58 | 81 |
| GET /api/sync/status | 2750 | 18 | 45 | 65 |
| PUT /api/field/outbox/:id | 2750 | 34 | 73 | 109 |
| PUT /api/reports/:id/infra | 2755 | 42 | 84 | 182 |

## Per route class (P05) — observation only; the class comparison is a separate checker

| Class | n | p50 (ms) | p95 (ms) | p99 (ms) | error % | 5xx |
|---|---|---|---|---|---|---|
| export | 2750 | 27 | 58 | 81 | 0 | 0 |
| page_data | 16510 | 27 | 61 | 87 | 0 | 0 |
| sync | 2750 | 18 | 45 | 65 | 0 | 0 |
| write | 5505 | 38 | 80 | 138 | 50 | 0 |
