# Load / soak run — observation (E-Q04)

> Throwaway database, synthetic data, one machine. **No threshold** — a person sets SLOs (docs/ops/LOAD-TEST.md).

- Target: http://127.0.0.1:3593 · sessions: 5 · duration: 180 s · scenarios: reports, helpdesk, field, export, pages, deck
- Generated: 2026-11-20T07:32:29.295Z · commit: ead6efb · server started at: 2026-11-20T07:28:51.435Z
- Requests: 4404 · throughput: 24.3 req/s · errors: 367 (8.3 %) · 5xx: 0
- Server RSS: 117 MB at start → 434 MB at end (max 435 MB)
- DB connections (pg_stat_activity, this database): max 30 open · max 7 active (p95 3) · max 0 waiting on a lock · 90 samples

| Step | n | p50 (ms) | p95 (ms) | p99 (ms) | errors | 5xx | statuses |
|---|---|---|---|---|---|---|---|
| deck.all_sites_monthly | 367 | 1877 | 2359 | 3045 | 0 | 0 | 200×367 |
| deck.weekly | 367 | 114 | 197 | 298 | 0 | 0 | 200×367 |
| export.risk_register | 367 | 30 | 63 | 89 | 0 | 0 | 200×367 |
| field.envelope | 367 | 36 | 72 | 128 | 367 | 0 | 400×367 |
| helpdesk.data | 367 | 28 | 64 | 100 | 0 | 0 | 200×367 |
| pages.health_deps | 367 | 16 | 51 | 77 | 0 | 0 | 200×367 |
| pages.inspections | 367 | 27 | 66 | 88 | 0 | 0 | 200×367 |
| pages.meetings | 367 | 35 | 85 | 100 | 0 | 0 | 200×367 |
| pages.sync_status | 367 | 18 | 57 | 78 | 0 | 0 | 200×367 |
| reports.list | 367 | 61 | 118 | 156 | 0 | 0 | 200×367 |
| reports.open | 367 | 51 | 127 | 166 | 0 | 0 | 200×367 |
| reports.save_section | 367 | 52 | 107 | 161 | 0 | 0 | 200×367 |

## API latency per route template (F-UX-05) — observation only, no threshold

| Route | n | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---|---|---|---|
| GET /api/data/requests-raw | 367 | 28 | 64 | 100 |
| GET /api/health/deps | 367 | 16 | 51 | 77 |
| GET /api/inspection/list | 367 | 27 | 66 | 88 |
| GET /api/meetings/list | 367 | 35 | 85 | 100 |
| GET /api/reports | 367 | 61 | 118 | 156 |
| GET /api/reports/:id | 367 | 51 | 127 | 166 |
| GET /api/reports/:id/pptx | 367 | 114 | 197 | 298 |
| GET /api/reports/monthly/all-sites/:y/:m/pptx | 367 | 1877 | 2359 | 3045 |
| GET /api/risk-register-export | 367 | 30 | 63 | 89 |
| GET /api/sync/status | 367 | 18 | 57 | 78 |
| PUT /api/field/outbox/:id | 367 | 36 | 72 | 128 |
| PUT /api/reports/:id/infra | 367 | 52 | 107 | 161 |

## Per route class (P05) — observation only; the class comparison is a separate checker

| Class | n | p50 (ms) | p95 (ms) | p99 (ms) | error % | 5xx |
|---|---|---|---|---|---|---|
| deck_generation | 734 | 308 | 2201 | 2674 | 0 | 0 |
| export | 367 | 30 | 63 | 89 | 0 | 0 |
| page_data | 2202 | 33 | 96 | 135 | 0 | 0 |
| sync | 367 | 18 | 57 | 78 | 0 | 0 |
| write | 734 | 42 | 97 | 154 | 50 | 0 |
