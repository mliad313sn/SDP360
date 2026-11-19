# Load / soak run — observation (E-Q04)

> Throwaway database, synthetic data, one machine. **No threshold** — a person sets SLOs (docs/ops/LOAD-TEST.md).

- Target: http://127.0.0.1:3592 · sessions: 5 · duration: 180 s · scenarios: reports, helpdesk, field, export, pages
- Generated: 2026-11-19T19:42:48.709Z · commit: b2e85cd · server started at: 2026-11-19T19:37:06.223Z
- Requests: 24315 · throughput: 135 req/s · errors: 2431 (10 %) · 5xx: 0
- Server RSS: 118 MB at start → 321 MB at end (max 323 MB)
- DB connections (pg_stat_activity, this database): max 16 open · max 5 active (p95 2) · max 2 waiting on a lock · 89 samples

| Step | n | p50 (ms) | p95 (ms) | p99 (ms) | errors | 5xx | statuses |
|---|---|---|---|---|---|---|---|
| export.risk_register | 2431 | 30 | 66 | 96 | 0 | 0 | 200×2431 |
| field.envelope | 2431 | 37 | 80 | 121 | 2431 | 0 | 400×2431 |
| helpdesk.data | 2431 | 22 | 54 | 78 | 0 | 0 | 200×2431 |
| pages.health_deps | 2430 | 32 | 69 | 93 | 0 | 0 | 200×2430 |
| pages.inspections | 2430 | 28 | 61 | 89 | 0 | 0 | 200×2430 |
| pages.meetings | 2430 | 35 | 78 | 111 | 0 | 0 | 200×2430 |
| pages.sync_status | 2430 | 21 | 52 | 75 | 0 | 0 | 200×2430 |
| reports.list | 2434 | 39 | 82 | 118 | 0 | 0 | 200×2434 |
| reports.open | 2434 | 31 | 72 | 108 | 0 | 0 | 200×2434 |
| reports.save_section | 2434 | 46 | 96 | 161 | 0 | 0 | 200×2434 |

## API latency per route template (F-UX-05) — observation only, no threshold

| Route | n | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---|---|---|---|
| GET /api/data/requests-raw | 2431 | 22 | 54 | 78 |
| GET /api/health/deps | 2430 | 32 | 69 | 93 |
| GET /api/inspection/list | 2430 | 28 | 61 | 89 |
| GET /api/meetings/list | 2430 | 35 | 78 | 111 |
| GET /api/reports | 2434 | 39 | 82 | 118 |
| GET /api/reports/:id | 2434 | 31 | 72 | 108 |
| GET /api/risk-register-export | 2431 | 30 | 66 | 96 |
| GET /api/sync/status | 2430 | 21 | 52 | 75 |
| PUT /api/field/outbox/:id | 2431 | 37 | 80 | 121 |
| PUT /api/reports/:id/infra | 2434 | 46 | 96 | 161 |

## Per route class (P05) — observation only; the class comparison is a separate checker

| Class | n | p50 (ms) | p95 (ms) | p99 (ms) | error % | 5xx |
|---|---|---|---|---|---|---|
| export | 2431 | 30 | 66 | 96 | 0 | 0 |
| page_data | 14589 | 31 | 71 | 104 | 0 | 0 |
| sync | 2430 | 21 | 52 | 75 | 0 | 0 |
| write | 4865 | 41 | 89 | 143 | 50 | 0 |
