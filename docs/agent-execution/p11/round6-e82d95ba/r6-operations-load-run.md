> AI review — not an independent human review. P11 round 6, seat operations, SHA e82d95ba, throwaway DB sdp_test_p11ops_r6 (dropped).

# Load / soak run — observation (E-Q04)

> Throwaway database, synthetic data, one machine. **No threshold** — a person sets SLOs (docs/ops/LOAD-TEST.md).

- Target: http://127.0.0.1:3596 · sessions: 5 · duration: 180 s · scenarios: reports, helpdesk, field, export, pages, deck
- Generated: 2026-11-20T22:45:26.422Z · commit: e82d95ba · server started at: 2026-11-20T22:36:01.923Z
- Requests: 1534 · throughput: 8.5 req/s · errors: 128 (8.3 %) · 5xx: 0
- Server RSS: 132 MB at start → 384 MB at end (max 387 MB)
- DB connections (pg_stat_activity, this database): max 26 open · max 9 active (p95 7) · max 0 waiting on a lock · 90 samples

| Step | n | p50 (ms) | p95 (ms) | p99 (ms) | errors | 5xx | statuses |
|---|---|---|---|---|---|---|---|
| deck.all_sites_monthly | 127 | 4912 | 7483 | 8045 | 0 | 0 | 200×127 |
| deck.weekly | 127 | 355 | 866 | 1243 | 0 | 0 | 200×127 |
| export.risk_register | 128 | 114 | 234 | 297 | 0 | 0 | 200×128 |
| field.envelope | 128 | 138 | 276 | 445 | 128 | 0 | 400×128 |
| helpdesk.data | 128 | 126 | 250 | 385 | 0 | 0 | 200×128 |
| pages.health_deps | 128 | 62 | 274 | 412 | 0 | 0 | 200×128 |
| pages.inspections | 128 | 81 | 236 | 419 | 0 | 0 | 200×128 |
| pages.meetings | 128 | 111 | 270 | 285 | 0 | 0 | 200×128 |
| pages.sync_status | 128 | 55 | 231 | 279 | 0 | 0 | 200×128 |
| reports.list | 128 | 201 | 417 | 601 | 0 | 0 | 200×128 |
| reports.open | 128 | 197 | 445 | 542 | 0 | 0 | 200×128 |
| reports.save_section | 128 | 242 | 449 | 708 | 0 | 0 | 200×128 |

## API latency per route template (F-UX-05) — observation only, no threshold

| Route | n | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---|---|---|---|
| GET /api/data/requests-raw | 128 | 126 | 250 | 385 |
| GET /api/health/deps | 128 | 62 | 274 | 412 |
| GET /api/inspection/list | 128 | 81 | 236 | 419 |
| GET /api/meetings/list | 128 | 111 | 270 | 285 |
| GET /api/reports | 128 | 201 | 417 | 601 |
| GET /api/reports/:id | 128 | 197 | 445 | 542 |
| GET /api/reports/:id/pptx | 127 | 355 | 866 | 1243 |
| GET /api/reports/monthly/all-sites/:y/:m/pptx | 127 | 4912 | 7483 | 8045 |
| GET /api/risk-register-export | 128 | 114 | 234 | 297 |
| GET /api/sync/status | 128 | 55 | 231 | 279 |
| PUT /api/field/outbox/:id | 128 | 138 | 276 | 445 |
| PUT /api/reports/:id/infra | 128 | 242 | 449 | 708 |

## Per route class (P05) — observation only; the class comparison is a separate checker

| Class | n | p50 (ms) | p95 (ms) | p99 (ms) | error % | 5xx |
|---|---|---|---|---|---|---|
| deck_generation | 254 | 1344 | 7070 | 7992 | 0 | 0 |
| export | 128 | 114 | 234 | 297 | 0 | 0 |
| page_data | 768 | 116 | 365 | 493 | 0 | 0 |
| sync | 128 | 55 | 231 | 279 | 0 | 0 |
| write | 128 | 242 | 449 | 708 | 0 | 0 |
