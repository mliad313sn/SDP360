# Load / soak run — observation (E-Q04)

> Throwaway database, synthetic data, one machine. **No threshold** — a person sets SLOs (docs/ops/LOAD-TEST.md).

- Target: http://127.0.0.1:3594 · sessions: 5 · duration: 180 s · scenarios: reports, helpdesk, field, export, pages, deck
- Generated: 2026-11-20T14:01:01.724Z · commit: e43d11d5 · server started at: 2026-11-20T13:52:29.351Z
- Requests: 1536 · throughput: 8.5 req/s · errors: 128 (8.3 %) · 5xx: 0
- Server RSS: 120 MB at start → 382 MB at end (max 386 MB)
- DB connections (pg_stat_activity, this database): max 28 open · max 8 active (p95 5) · max 0 waiting on a lock · 90 samples

| Step | n | p50 (ms) | p95 (ms) | p99 (ms) | errors | 5xx | statuses |
|---|---|---|---|---|---|---|---|
| deck.all_sites_monthly | 128 | 5046 | 7220 | 7368 | 0 | 0 | 200×128 |
| deck.weekly | 128 | 314 | 687 | 900 | 0 | 0 | 200×128 |
| export.risk_register | 128 | 106 | 294 | 350 | 0 | 0 | 200×128 |
| field.envelope | 128 | 142 | 299 | 427 | 128 | 0 | 400×128 |
| helpdesk.data | 128 | 110 | 212 | 364 | 0 | 0 | 200×128 |
| pages.health_deps | 128 | 66 | 223 | 368 | 0 | 0 | 200×128 |
| pages.inspections | 128 | 86 | 233 | 407 | 0 | 0 | 200×128 |
| pages.meetings | 128 | 107 | 262 | 374 | 0 | 0 | 200×128 |
| pages.sync_status | 128 | 62 | 201 | 261 | 0 | 0 | 200×128 |
| reports.list | 128 | 193 | 417 | 544 | 0 | 0 | 200×128 |
| reports.open | 128 | 168 | 458 | 646 | 0 | 0 | 200×128 |
| reports.save_section | 128 | 199 | 455 | 558 | 0 | 0 | 200×128 |

## API latency per route template (F-UX-05) — observation only, no threshold

| Route | n | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---|---|---|---|
| GET /api/data/requests-raw | 128 | 110 | 212 | 364 |
| GET /api/health/deps | 128 | 66 | 223 | 368 |
| GET /api/inspection/list | 128 | 86 | 233 | 407 |
| GET /api/meetings/list | 128 | 107 | 262 | 374 |
| GET /api/reports | 128 | 193 | 417 | 544 |
| GET /api/reports/:id | 128 | 168 | 458 | 646 |
| GET /api/reports/:id/pptx | 128 | 314 | 687 | 900 |
| GET /api/reports/monthly/all-sites/:y/:m/pptx | 128 | 5046 | 7220 | 7368 |
| GET /api/risk-register-export | 128 | 106 | 294 | 350 |
| GET /api/sync/status | 128 | 62 | 201 | 261 |
| PUT /api/field/outbox/:id | 128 | 142 | 299 | 427 |
| PUT /api/reports/:id/infra | 128 | 199 | 455 | 558 |

## Per route class (P05) — observation only; the class comparison is a separate checker

| Class | n | p50 (ms) | p95 (ms) | p99 (ms) | error % | 5xx |
|---|---|---|---|---|---|---|
| deck_generation | 256 | 905 | 7070 | 7363 | 0 | 0 |
| export | 128 | 106 | 294 | 350 | 0 | 0 |
| page_data | 768 | 112 | 374 | 539 | 0 | 0 |
| sync | 128 | 62 | 201 | 261 | 0 | 0 |
| write | 256 | 161 | 397 | 558 | 50 | 0 |
