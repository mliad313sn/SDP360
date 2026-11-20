# Load / soak run — observation (E-Q04)

> Throwaway database, synthetic data, one machine. **No threshold** — a person sets SLOs (docs/ops/LOAD-TEST.md).

- Target: http://127.0.0.1:3595 · sessions: 5 · duration: 180 s · scenarios: reports, helpdesk, field, export, pages, deck
- Generated: 2026-11-20T20:23:59.595Z · commit: 3ee4dd23 · server started at: 2026-11-20T20:20:46.320Z
- Requests: 1316 · throughput: 7.3 req/s · errors: 110 (8.4 %) · 5xx: 0
- Server RSS: 152 MB at start → 373 MB at end (max 387 MB)
- DB connections (pg_stat_activity, this database): max 26 open · max 9 active (p95 7) · max 0 waiting on a lock · 90 samples

| Step | n | p50 (ms) | p95 (ms) | p99 (ms) | errors | 5xx | statuses |
|---|---|---|---|---|---|---|---|
| deck.all_sites_monthly | 108 | 5697 | 8759 | 10043 | 0 | 0 | 200×108 |
| deck.weekly | 108 | 427 | 1025 | 1425 | 0 | 0 | 200×108 |
| export.risk_register | 110 | 127 | 290 | 389 | 0 | 0 | 200×110 |
| field.envelope | 110 | 173 | 365 | 417 | 110 | 0 | 400×110 |
| helpdesk.data | 110 | 125 | 284 | 336 | 0 | 0 | 200×110 |
| pages.health_deps | 110 | 80 | 246 | 310 | 0 | 0 | 200×110 |
| pages.inspections | 110 | 117 | 273 | 487 | 0 | 0 | 200×110 |
| pages.meetings | 110 | 143 | 346 | 464 | 0 | 0 | 200×110 |
| pages.sync_status | 110 | 82 | 241 | 449 | 0 | 0 | 200×110 |
| reports.list | 110 | 232 | 468 | 596 | 0 | 0 | 200×110 |
| reports.open | 110 | 206 | 502 | 629 | 0 | 0 | 200×110 |
| reports.save_section | 110 | 233 | 490 | 579 | 0 | 0 | 200×110 |

## API latency per route template (F-UX-05) — observation only, no threshold

| Route | n | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---|---|---|---|
| GET /api/data/requests-raw | 110 | 125 | 284 | 336 |
| GET /api/health/deps | 110 | 80 | 246 | 310 |
| GET /api/inspection/list | 110 | 117 | 273 | 487 |
| GET /api/meetings/list | 110 | 143 | 346 | 464 |
| GET /api/reports | 110 | 232 | 468 | 596 |
| GET /api/reports/:id | 110 | 206 | 502 | 629 |
| GET /api/reports/:id/pptx | 108 | 427 | 1025 | 1425 |
| GET /api/reports/monthly/all-sites/:y/:m/pptx | 108 | 5697 | 8759 | 10043 |
| GET /api/risk-register-export | 110 | 127 | 290 | 389 |
| GET /api/sync/status | 110 | 82 | 241 | 449 |
| PUT /api/field/outbox/:id | 110 | 173 | 365 | 417 |
| PUT /api/reports/:id/infra | 110 | 233 | 490 | 579 |

## Per route class (P05) — observation only; the class comparison is a separate checker

| Class | n | p50 (ms) | p95 (ms) | p99 (ms) | error % | 5xx |
|---|---|---|---|---|---|---|
| deck_generation | 216 | 1563 | 7441 | 9991 | 0 | 0 |
| export | 110 | 127 | 290 | 389 | 0 | 0 |
| page_data | 660 | 141 | 432 | 556 | 0 | 0 |
| sync | 110 | 82 | 241 | 449 | 0 | 0 |
| write | 220 | 192 | 448 | 570 | 50 | 0 |
