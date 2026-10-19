# ADR-002 — One scheduling registry for every background job

**Status**: Accepted — implemented (Step 1, 2026-10-19) · **Author**: AI agent · **Approval**: product committee (to record)
**Supersedes**: the scattered `cron.schedule(...)` calls of v1 and the Task Scheduler `SDP-Report-*` tasks created without `/RU SYSTEM`.

## Context
v1 scheduled work in four places: `node-cron` calls inside `server.js`, Windows Task Scheduler tasks created by `services/reportSchedule.js`, pollers with their own locks, and manual admin buttons. Failures were invisible (no run log), overlapping runs corrupted data (the 2026-09-11 doubled report rows), and a task created without `/RU SYSTEM` never ran for six weeks without anyone noticing (CLAUDE.md pitfall of 2026-09-21).

## Decision
Every scheduled job is declared once in `services/sync/jobs.js` and executed by `services/sync/schedule.js`: overlap lock, exponential retry honouring `Retry-After`, run log, failure mirrored to `system_log`, health exposed by `GET /api/sync/health` and alerted after two consecutive failures or when a job is older than its freshness window. A job **never throws out of the runner** and is **never started twice in parallel**.

## Consequences
- Adding a job = one entry in the registry (id, cron, freshness, handler). A job elsewhere is a review defect (`tests/sync-jobs-registry.test.js`).
- Task Scheduler is no longer used for application jobs; the only Windows task left is the pm2 service itself.
- Health has a single screen (System Logs ▸ Sync health) and a single CLI (`sdp-manager status`).
