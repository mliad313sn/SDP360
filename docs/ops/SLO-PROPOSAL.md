# SLO proposal — SDP360 (E-Q07, audit Q-07)

**PROPOSITION — nothing here is approved.** Every target below is `UNKNOWN — to be approved by SRE`.
The agent prepared the indicators (SLIs) and the place where each is measured today; choosing a
target, an error budget and an alert is a decision of the SRE / service owner.

Live readings: `GET /api/health/deps` (admin tier, `routes/health.js`, composed by `services/healthDeps.js`).
It never calls an outside system: PostgreSQL `SELECT 1`, the in-memory Zoho token state, SMTP *configured*
(never probed), sync jobs against their declared freshness window (`services/sync/jobs.js`
`FRESHNESS_HOURS`), the last `db.backup` run, the last restore drill (system_log `restore_drill`), and the
data directory's free disk. A reading the server does not have is `unknown` — never green.

| Service | SLI (proposed) | How it is measured today | Target |
|---|---|---|---|
| Sign-in | share of `POST /api/reports/auth/login` answered without a 5xx, per 30 days | system_log `login_success` / `login_failed` (category auth) + server error log | UNKNOWN — to be approved by SRE |
| Application availability | share of 1-minute probes where `GET /ready` answers 200 | external probe (not built — no monitoring tool connected) | UNKNOWN — to be approved by SRE |
| Sync freshness | share of time each sync job's last ok run is inside its `freshnessHours` | `/api/health/deps` `sync_jobs[]`, `/api/sync/health` | UNKNOWN — to be approved by SRE |
| Scheduled-report delivery | share of scheduled sends recorded `ok`/`resent` vs due sends, per month | `report_sent_log.result` + the schedule (`reportSchedule.js`) | UNKNOWN — to be approved by SRE |
| Field apply success | share of field outbox entries applied without manual resolution | field outbox (`services/fieldOutbox.js`) + `field_outbox_resolve` rows | UNKNOWN — to be approved by SRE |
| Database | `SELECT 1` latency p95 | `/api/health/deps` `items.postgres.latency_ms` (one reading per call) | UNKNOWN — to be approved by SRE |
| Backups | age of the last ok `db.backup` run; restore drill within its window | `/api/health/deps` `items.backup`, `items.restore_drill` | UNKNOWN — to be approved by SRE |
| Disk | data-dir free space | `/api/health/deps` `items.disk.free_pct` — the 10 % line in the code is a PROPOSITION only | UNKNOWN — to be approved by SRE |

Left for a person: approving each target and error budget, choosing who is paged, and wiring an
external probe to `GET /ready` (no monitoring connector exists in this repository).
