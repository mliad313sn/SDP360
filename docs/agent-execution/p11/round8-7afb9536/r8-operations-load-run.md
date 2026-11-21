> AI review — not an independent human review. P11 round 8, seat operations, SHA 7afb9536, throwaway DB sdp_test_p11ops_r8 (dropped after the run). Shared host: latencies are not comparable across rounds. /ready polled every 3 s during the run: 60/60 = 200, max 0.26 s.

# Load / soak run — observation (E-Q04)

> Throwaway database, synthetic data, one machine. **No threshold** — a person sets SLOs (docs/ops/LOAD-TEST.md).

- Target: http://127.0.0.1:3598 · sessions: 5 · duration: 180 s · scenarios: reports, helpdesk, field, export, pages, deck
- Generated: 2026-11-21T03:43:39.686Z · commit: 7afb9536 · server started at: 2026-11-21T03:36:38.170Z
- Requests: 1848 · throughput: 10.1 req/s · errors: 154 (8.3 %) · 5xx: 0
- Server RSS: 120 MB at start → 416 MB at end (max 417 MB)
- DB connections (pg_stat_activity, this database): max 28 open · max 10 active (p95 7) · max 0 waiting on a lock · 91 samples

| Step | n | p50 (ms) | p95 (ms) | p99 (ms) | errors | 5xx | statuses |
|---|---|---|---|---|---|---|---|
| deck.all_sites_monthly | 154 | 4016 | 6465 | 7049 | 0 | 0 | 200×154 |
| deck.weekly | 154 | 302 | 734 | 803 | 0 | 0 | 200×154 |
| export.risk_register | 154 | 81 | 248 | 300 | 0 | 0 | 200×154 |
| field.envelope | 154 | 120 | 278 | 417 | 154 | 0 | 400×154 |
| helpdesk.data | 154 | 94 | 232 | 285 | 0 | 0 | 200×154 |
| pages.health_deps | 154 | 57 | 207 | 306 | 0 | 0 | 200×154 |
| pages.inspections | 154 | 70 | 196 | 257 | 0 | 0 | 200×154 |
| pages.meetings | 154 | 102 | 196 | 242 | 0 | 0 | 200×154 |
| pages.sync_status | 154 | 42 | 214 | 354 | 0 | 0 | 200×154 |
| reports.list | 154 | 173 | 354 | 415 | 0 | 0 | 200×154 |
| reports.open | 154 | 168 | 380 | 510 | 0 | 0 | 200×154 |
| reports.save_section | 154 | 202 | 436 | 623 | 0 | 0 | 200×154 |

## API latency per route template (F-UX-05) — observation only, no threshold

| Route | n | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---|---|---|---|
| GET /api/data/requests-raw | 154 | 94 | 232 | 285 |
| GET /api/health/deps | 154 | 57 | 207 | 306 |
| GET /api/inspection/list | 154 | 70 | 196 | 257 |
| GET /api/meetings/list | 154 | 102 | 196 | 242 |
| GET /api/reports | 154 | 173 | 354 | 415 |
| GET /api/reports/:id | 154 | 168 | 380 | 510 |
| GET /api/reports/:id/pptx | 154 | 302 | 734 | 803 |
| GET /api/reports/monthly/all-sites/:y/:m/pptx | 154 | 4016 | 6465 | 7049 |
| GET /api/risk-register-export | 154 | 81 | 248 | 300 |
| GET /api/sync/status | 154 | 42 | 214 | 354 |
| PUT /api/field/outbox/:id | 154 | 120 | 278 | 417 |
| PUT /api/reports/:id/infra | 154 | 202 | 436 | 623 |

## Per route class (P05) — observation only; the class comparison is a separate checker

| Class | n | p50 (ms) | p95 (ms) | p99 (ms) | error % | 5xx |
|---|---|---|---|---|---|---|
| deck_generation | 308 | 806 | 5657 | 7010 | 0 | 0 |
| export | 154 | 81 | 248 | 300 | 0 | 0 |
| page_data | 924 | 99 | 305 | 405 | 0 | 0 |
| sync | 154 | 42 | 214 | 354 | 0 | 0 |
| write | 154 | 202 | 436 | 623 | 0 | 0 |
