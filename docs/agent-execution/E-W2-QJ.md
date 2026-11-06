# E-W2-QJ — evidence (plan E wave 2, bundle W2-QJ: E-Q03, E-Q09)

All tests run on a throwaway PostgreSQL schema (`tests/_pg-boot.mjs`); no SMTP, Zoho, Meraki, Meridian or Task
Scheduler call is made (transports, stores and the backup-schedule module are injected/stubbed).

## E-Q03 — Tests for untested critical routes and jobs (audit Q-03, X-Q-03)

| Audit action | Verdict | Proof |
|---|---|---|
| `POST /api/meetings/reset` super_admin only | FIXED (test) | `tests/critical-routes.smoke.test.js` — 401 anon, 403 admin/editor, 200 super_admin + lookups re-seeded |
| `POST /api/cache/clear` (+ `GET /api/cache/status`) | FIXED (test) | same file — viewer/editor 403, admin 200 |
| `GET/POST /api/admin/backup-schedule`, `POST /api/admin/backup-now` (stubbed backup) | FIXED (test) | same file — super_admin only, a refused call never reaches the module, list capped at 20, bad schedule 400, `dbOnly` coerced |
| `POST /api/reports/auth/change-password` | FIXED (test) | same file — fields required, old password checked, ≥ 8 chars, old password stops working. **As coded: there is NO throttle and the current session is NOT ended** — recorded, not changed (server.js / reports-db.js are out of this bundle) |
| `POST /api/kpi-policies/validate` | FIXED (test) | same file — valid/invalid definitions, nothing stored |
| meetings import template / preview (no write) | FIXED (test) | same file — viewer + site-less editor 403, xlsx returned, preview of the template writes nothing |
| `/ext/odata/Sites` | already covered | `tests/api-contract-ext.test.js` (not duplicated) |
| jobs `reports.weekly` / `reports.monthly` | FIXED (test) | `tests/jobs-reports-send.test.js` — crons, freshness, cadence passed, no binding → recorded skip; `generateScheduledReports`: only the cadence's templates with a PUBLISHED dashboard, one run per active site, site subscribers only for their site |
| jobs `engagement.alerts / digest / digest_weekly`, `publish.connectors` (`notifications_stop` halts) | FIXED (test) | `tests/jobs-engagement.test.js` — wiring, error = failed run, stop halts digest and publish, publish off unless `publish_cron_enabled='1'`, digest one mail per subscriber with e-mail, connectors self-skip counted |
| jobs `meraki.wan_events`, `meraki.wan_events_5m`, `meraki.wan_poller` (config missing → self-skip) | FIXED (test) | `tests/jobs-meraki-skip.test.js` — tools return `{skipped:true}` with no client call; jobs ok/0 rows; error result fails the run. Also `meridian.resources` (dormant) |

**Deviation (spec vs code):** the goal text describes `reports.weekly/monthly` as "armed off → skipped with reason; armed
with injected mailer → one send per confirmed recipient, dedup lane". The code does not do that: those two jobs are the
Report Studio scheduled runs (`services/engagementJobs.js generateScheduledReports`) — they have no arm switch and send no
e-mail; they generate runs and notify subscribers in-app. The coordinator/weekly e-mails with confirmed recipients and the
dedup lane are separate CLIs (`tools/reports/send-*.js`, Task Scheduler) already covered by their own tests. The tests pin
what the jobs really do.

**Counts (INVENTORY regenerated in branch):** routes without test reference 48 → **35**; jobs without test reference 10 → **0**.

Run: `critical-routes.smoke` 7, `jobs-engagement` 8, `jobs-meraki-skip` 5, `jobs-reports-send` 4 — all pass; neighbours
`sync-jobs-registry`, `agent-inventory`, `test-runner-guard`, `error-shape`, `await-precedence`, `kpi-policy-routes.smoke` green
(61 pass / 0 fail / 0 skip together).

Left for a person: decide whether a password change should end the user's other sessions and be throttled (today it does
neither) — a behaviour change for the W2-SRV / W2-RDB owners, behind a switch.
