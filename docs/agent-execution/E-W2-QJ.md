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

## E-Q09 — Persona journeys for the agent committee (CROSSCHECK-3 §8.1 gaps)

> Automated, synthetic organisation, throwaway PostgreSQL, Chromium with every external request blocked.
> **This is NOT user acceptance** — it never replaces UAT, the screen-reader session or any RELEASE-GATES signature.

| Journey | Verdict | Proof (spec — 2 consecutive runs green, 0 external requests, 0 page errors) |
|---|---|---|
| c1 coordinator enters a tracker value + signs a PV (server-time stamp persisted) | FIXED (journey) | `tests/e2e/c1-coordinator-tracker-pv.spec.js` — value 7 typed in the Input tab is stored under her site code; both signature stamps persisted; browser clock forced to 1999 never reaches the DB, stored value within 10 min of now |
| c2 Group IT manager: worst gap → site overdue action → update | FIXED (journey) | `tests/e2e/c2-groupit-worst-gap-action.spec.js` — Houndé first on the resolution-SLA ranking, overdue filter, status → in_progress stored with the manager as author, shown after reload |
| c3 Finance: `certified:false` + site with no currency | FIXED (journey) | `tests/e2e/c3-finance-not-certified.spec.js` — "Non certifié" band with the excluded line counted, Assafo amount "—" (never $0.00); viewer refused the amounts (403). Switches set only in the throwaway DB |
| c4 PMO: demand → project, capacity conflict, benefit check | PARTIAL | `tests/e2e/c4-pmo-demand-project-benefit.spec.js` — RFI → triage → accepted → project (2nd conversion 409); benefit realised; self-verification 403; verified by another member; shown on the project's Benefits tab. **Capacity conflict: `capacity_enabled` is not built** — the journey asserts the switch is absent (update C4 when it exists) |
| c5 super_admin removes a role → next request refused → security log export | FIXED (journey) | `tests/e2e/c5-superadmin-role-removal-log.spec.js` — the target's existing session is refused the admin route at the next call (viewer routes still work); System Logs shows `user_role_changed`; CSV export line names target + super_admin; demoted user 403 on export |

`docs/ops/PERSONA-JOURNEYS.md` updated (tracker, PV, role change, security journal now covered; Group IT / Finance /
PMO rows added; delivery-setting journey and capacity conflict stay "not covered"). `tests/evidence-baseline.test.js`
green. Generated METRIC-WIDGET-MAP / METRIC-LINEAGE regenerated (a new test mentions a metric key).

**Findings recorded by the journeys (not fixed — out of this bundle's files):**
- C2: the Helpdesk ranking row has no link to the site's action register (the manager navigates by site code). The
  assertion pins today's state; flip it when a link is added.
- C1: the PV stamp buttons paint the BROWSER time optimistically; a second stamp clicked before the first save's
  reload finished was lost in an early version of this journey (the reload repaints the stored header). A person
  clicking twice quickly can lose the second signature — candidate UX defect for `public/meeting.html` (disable both
  stamp buttons while a save is in flight).
- C5: a role change takes effect on the next request (good); a password change does not end sessions (see E-Q03).

**Not run:** `tools/test/run-e2e.js --runs=2` over the WHOLE e2e suite (bundles run in parallel — the coordinator runs it
after merge). The five new specs were run twice in a row with `--test-concurrency=1`.

## Left for a person
- Decide on session ending / throttling for password change (E-Q03).
- Decide whether the ranking should link to the action register (C2) and fix the double-stamp race (C1).
- Build or drop the capacity feature (C4) — the journey records its absence.
- Run the full `run-e2e.js --runs=2` after merge.
