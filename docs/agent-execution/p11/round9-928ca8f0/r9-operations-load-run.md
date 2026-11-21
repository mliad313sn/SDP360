> AI review — not an independent human review. P11 round 9, seat operations, SHA 928ca8f0, throwaway DB sdp_test_p11ops_r9 (dropped after the run). Shared host: latencies not comparable across rounds. /ready polled every 3 s during the run: 60/60 = 200, max 0.20 s.

# Load / soak run — observation (E-Q04)

> Throwaway database, synthetic data, one machine. **No threshold** — a person sets SLOs (docs/ops/LOAD-TEST.md).

- Target: http://127.0.0.1:3599 · sessions: 5 · duration: 180 s · scenarios: reports, helpdesk, field, export, pages, deck
- Generated: 2026-11-21T05:53:08.935Z · commit: 928ca8f0 · server started at: 2026-11-21T05:48:04.990Z
- Requests: 1700 · throughput: 9.4 req/s · errors: 142 (8.4 %) · 5xx: 0
- Server RSS: 120 MB at start → 405 MB at end (max 405 MB)
- DB connections (pg_stat_activity, this database): max 25 open · max 8 active (p95 7) · max 0 waiting on a lock · 90 samples

| Step | n | p50 (ms) | p95 (ms) | p99 (ms) | errors | 5xx | statuses |
|---|---|---|---|---|---|---|---|
| deck.all_sites_monthly | 140 | 3899 | 8665 | 9134 | 0 | 0 | 200×140 |
| deck.weekly | 140 | 234 | 695 | 781 | 0 | 0 | 200×140 |
| export.risk_register | 142 | 105 | 195 | 297 | 0 | 0 | 200×142 |
| field.envelope | 142 | 134 | 250 | 466 | 142 | 0 | 400×142 |
| helpdesk.data | 142 | 117 | 227 | 360 | 0 | 0 | 200×142 |
| pages.health_deps | 142 | 77 | 251 | 421 | 0 | 0 | 200×142 |
| pages.inspections | 142 | 108 | 248 | 347 | 0 | 0 | 200×142 |
| pages.meetings | 142 | 122 | 269 | 361 | 0 | 0 | 200×142 |
| pages.sync_status | 142 | 77 | 220 | 309 | 0 | 0 | 200×142 |
| reports.list | 142 | 251 | 493 | 636 | 0 | 0 | 200×142 |
| reports.open | 142 | 270 | 469 | 499 | 0 | 0 | 200×142 |
| reports.save_section | 142 | 235 | 436 | 531 | 0 | 0 | 200×142 |

## API latency per route template (F-UX-05) — observation only, no threshold

| Route | n | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---|---|---|---|
| GET /api/data/requests-raw | 142 | 117 | 227 | 360 |
| GET /api/health/deps | 142 | 77 | 251 | 421 |
| GET /api/inspection/list | 142 | 108 | 248 | 347 |
| GET /api/meetings/list | 142 | 122 | 269 | 361 |
| GET /api/reports | 142 | 251 | 493 | 636 |
| GET /api/reports/:id | 142 | 270 | 469 | 499 |
| GET /api/reports/:id/pptx | 140 | 234 | 695 | 781 |
| GET /api/reports/monthly/all-sites/:y/:m/pptx | 140 | 3899 | 8665 | 9134 |
| GET /api/risk-register-export | 142 | 105 | 195 | 297 |
| GET /api/sync/status | 142 | 77 | 220 | 309 |
| PUT /api/field/outbox/:id | 142 | 134 | 250 | 466 |
| PUT /api/reports/:id/infra | 142 | 235 | 436 | 531 |

## Per route class (P05) — observation only; the class comparison is a separate checker

| Class | n | p50 (ms) | p95 (ms) | p99 (ms) | error % | 5xx |
|---|---|---|---|---|---|---|
| deck_generation | 280 | 836 | 6321 | 8835 | 0 | 0 |
| export | 142 | 105 | 195 | 297 | 0 | 0 |
| page_data | 852 | 137 | 422 | 522 | 0 | 0 |
| sync | 142 | 77 | 220 | 309 | 0 | 0 |
| write | 142 | 235 | 436 | 531 | 0 | 0 |
