> AI review — not an independent human review. P11 round 7, seat operations, SHA 7ea49070, throwaway DB sdp_test_p11ops_r7 (dropped).

# Load / soak run — observation (E-Q04)

> Throwaway database, synthetic data, one machine. **No threshold** — a person sets SLOs (docs/ops/LOAD-TEST.md).

- Target: http://127.0.0.1:3597 · sessions: 5 · duration: 180 s · scenarios: reports, helpdesk, field, export, pages, deck
- Generated: 2026-11-21T01:44:01.764Z · commit: 7ea49070 · server started at: 2026-11-21T01:40:17.959Z
- Requests: 2160 · throughput: 11.8 req/s · errors: 180 (8.3 %) · 5xx: 0
- Server RSS: 152 MB at start → 403 MB at end (max 406 MB)
- DB connections (pg_stat_activity, this database): max 28 open · max 10 active (p95 7) · max 0 waiting on a lock · 91 samples

| Step | n | p50 (ms) | p95 (ms) | p99 (ms) | errors | 5xx | statuses |
|---|---|---|---|---|---|---|---|
| deck.all_sites_monthly | 180 | 3664 | 4880 | 5623 | 0 | 0 | 200×180 |
| deck.weekly | 180 | 249 | 570 | 653 | 0 | 0 | 200×180 |
| export.risk_register | 180 | 76 | 179 | 270 | 0 | 0 | 200×180 |
| field.envelope | 180 | 102 | 217 | 320 | 180 | 0 | 400×180 |
| helpdesk.data | 180 | 79 | 171 | 244 | 0 | 0 | 200×180 |
| pages.health_deps | 180 | 45 | 136 | 218 | 0 | 0 | 200×180 |
| pages.inspections | 180 | 57 | 171 | 262 | 0 | 0 | 200×180 |
| pages.meetings | 180 | 83 | 199 | 361 | 0 | 0 | 200×180 |
| pages.sync_status | 180 | 41 | 124 | 233 | 0 | 0 | 200×180 |
| reports.list | 180 | 125 | 291 | 346 | 0 | 0 | 200×180 |
| reports.open | 180 | 142 | 300 | 395 | 0 | 0 | 200×180 |
| reports.save_section | 180 | 159 | 334 | 424 | 0 | 0 | 200×180 |

## API latency per route template (F-UX-05) — observation only, no threshold

| Route | n | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---|---|---|---|
| GET /api/data/requests-raw | 180 | 79 | 171 | 244 |
| GET /api/health/deps | 180 | 45 | 136 | 218 |
| GET /api/inspection/list | 180 | 57 | 171 | 262 |
| GET /api/meetings/list | 180 | 83 | 199 | 361 |
| GET /api/reports | 180 | 125 | 291 | 346 |
| GET /api/reports/:id | 180 | 142 | 300 | 395 |
| GET /api/reports/:id/pptx | 180 | 249 | 570 | 653 |
| GET /api/reports/monthly/all-sites/:y/:m/pptx | 180 | 3664 | 4880 | 5623 |
| GET /api/risk-register-export | 180 | 76 | 179 | 270 |
| GET /api/sync/status | 180 | 41 | 124 | 233 |
| PUT /api/field/outbox/:id | 180 | 102 | 217 | 320 |
| PUT /api/reports/:id/infra | 180 | 159 | 334 | 424 |

## Per route class (P05) — observation only; the class comparison is a separate checker

| Class | n | p50 (ms) | p95 (ms) | p99 (ms) | error % | 5xx |
|---|---|---|---|---|---|---|
| deck_generation | 360 | 869 | 4703 | 5507 | 0 | 0 |
| export | 180 | 76 | 179 | 270 | 0 | 0 |
| page_data | 1080 | 81 | 255 | 338 | 0 | 0 |
| sync | 180 | 41 | 124 | 233 | 0 | 0 |
| write | 180 | 159 | 334 | 424 | 0 | 0 |
