# Changelog

## 2.0.0-alpha.2 — 2026-10-19 — Étape 1 : synchronisations fiables et observables
- One cron registry (`services/sync/jobs.js` + `schedule.js`): every scheduled job runs through the shared runner (overlap lock, exponential retry with Retry-After, run log, failure mirrored to `system_log`).
- Truncation guard before every Zoho reconciliation (`zoho-sync.js assertNotTruncated`): a partial export can no longer cascade into a mass delete.
- Alerts (`services/sync/alerts.js`): e-mail / Teams after 2 consecutive failures and when a job is older than its freshness window (once per 24 h). Config keys `sync_alert_enabled`, `sync_alert_recipients`, `sync_alert_teams_url` (secret), `sync_truncation_tolerance_pct`.
- `GET /api/sync/health` merges runner runs with legacy `sync_metadata` and labels each job ok / stale / error / never / idle.
- System Logs ▸ new "Sync health" tab.
- Meraki client keeps the HTTP status on errors so 429/5xx are retried.

## 2.0.0-alpha.1 — 2026-10-19
- Fork of SDP-Dashboard v1.11; sync runner, KPI/RAG registry, tracker and dashboard engines (foundations), CI, governance documents.
