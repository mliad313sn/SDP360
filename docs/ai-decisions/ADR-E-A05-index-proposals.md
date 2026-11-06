# ADR-E-A05 — Index proposals from the synthetic EXPLAIN report

- Status: **PROPOSED** (agent, 2026-11-05). Not approved; no index was created.
- Context: audit A-05 asked for query plans on realistic volumes. `tools/pg/explain-hot.js` ran
  `EXPLAIN (ANALYZE, BUFFERS)` on seven hot readers over 100 000 synthetic tickets, 100 000 system_log rows
  and 20 000 field outbox rows (`docs/agent-execution/EXPLAIN-SYNTHETIC.md`).
- Decision owner: the DBA / product owner, after the same script runs on a copy with production volumes
  (a restored snapshot, by the data owner). Synthetic distributions differ from production.

## Observations

| Reader | Plan on synthetic data | Note |
|---|---|---|
| `_getSiteHelpdeskWindowPg` | **Seq Scan** of `request_records` (100 000 read, ~1 300 kept), ~22 ms | `substr(created_time,1,10) BETWEEN` cannot use `idx_rr_created`, and there is no index on `tech_group`. Documented trade-off (CLAUDE.md pitfall "created_time is TEXT"). |
| `outboxStats` (field) | Seq Scan of `field_outbox` (20 000 read) | Only `(user_id, received_at)` is indexed; the admin window filters on `received_at` alone. Small table today. |
| ageing by site / group, calendar monthly | Bitmap index scans on `pending_status` / `created_time` | Acceptable at this volume. |
| report list, system_log list | Index / nested loop, < 1 ms | Nothing to propose. |

## Proposals (none applied)

1. **`request_records (tech_group, created_time)`** — would serve the per-site window readers if they were
   rewritten to the sargable form `created_time >= ? AND created_time < ?` (exclusive upper bound, same
   result as `substr … BETWEEN`). Two changes together: a reader rewrite (tested for equality on the
   window edges) and a migration with `CREATE INDEX CONCURRENTLY`. Gain is only worth it if the production
   plan shows the same sequential scan at production volume.
2. **`field_outbox (received_at)`** — only if the outbox grows past ~100 000 rows (purge keeps 90 days).
3. No change to the ageing / calendar readers.

## Consequences

- Each index costs write time on the hourly ticket sync (upserts on `request_records`). Measure the sync
  before/after on the restored copy.
- Migration numbers are assigned per bundle (PLAN-E); this ADR assigns none.
