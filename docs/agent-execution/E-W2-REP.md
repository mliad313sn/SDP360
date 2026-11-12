# E-W2-REP — Plan E wave 2, reporting & alerting bundle (E-R01, E-R02, E-R04, E-R05, E-R06, E-R07)

Branch `goal/w2-rep` (from `sdp-waves` at `03a7460`). No migration used (none assigned, none needed).
Not touched: `server.js`, `reports-db.js`, `public/reports.html`. Nothing is approved by this work; every new
switch ships at today's behaviour and has a PILOT-PROFILE row; `docs/ops/FLAG-REGISTER.md` regenerated.

## Verdict table

| Goal | Audit action | Verdict | What changed | Proof |
|---|---|---|---|---|
| E-R01 | R-01 report contract fields | FIXED (structure) | `services/reportCatalogue.js`: every report carries `owner_role` (`to be named` — no owner invented), `validation` (review step the code enforces, — when none), `test` (test files proving the content), `delivery_proof` (`report_sent_log` / `report_runs` / `notifications` / `none`); new "Report contracts" table in the regenerated `docs/sdp360/completion/REPORT-ALERT-CATALOGUE.md` | `tests/report-catalogue.test.js` (+2): a report with a sender and status ≠ missing must list a test file, every listed file must exist, no owner invented |
| E-R02 | R-02 A01 | FIXED behind switch | `a01_missing_due_date` ('0'): with '1', a serious open commitment without a due date and without a live exception raises A01 under its own episode key `A01:<id>:due` (`commitmentEscalation.conditions`, `commitmentStore.escalate`, `escalationRouting` reads the switch itself — no server.js change) | `tests/report-rules-completion.test.js` (switch off = nothing; on = keys, lapsed exception counts as none, dedup) |
| E-R02 | R-02 A03 / A04 | FIXED (in-app, inside `commitments_enabled`) | `services/commitmentNotices.js` (pure) + `routes/commitments.js`: technical completion notifies the named reviewer (username/e-mail only, never full name) or the `commitments.reviewer` holders; rejection notifies the accountable owner with the reason; the author is never told about their own act; nothing while `notifications_stop`='1'; best effort (never fails the transition) | `tests/report-rules-completion.test.js` (pure) + `tests/commitments-routes.smoke.test.js` (+2: real route writes A03/A04 rows; STOP writes none) |
| E-R02 | R-02 A10 | PARTIAL | `a10_gate_lead_days` ('' = off) feeds `ppmAlerts.findExceptions` kind `gate_approaching` (proposal/approval → start date; in progress → planned end), used by the armed `ppm-alerts` job (`ppm_alerts_enabled`); skipped under STOP. No funding-review / renewal date exists in the schema → not raised | `tests/report-rules-completion.test.js` (null/invalid = off, lead window, past/missing date none, stable key) |
| E-R04 | R-04 / X-R-02 visibility | FIXED (ON) + alert behind switch | `services/deliveryFailures.js`: `/api/sync/health` gains `delivery` (report_sent_log `fail` rows + failed `publish.*` runs, last 14 d; recipients as a count only; errors redacted — no URL/address/token); `public/system-logs.html` "Failed deliveries" table. `delivery_failure_alert_enabled` ('0'): hourly sweep sends ONE sync-alert per batch of new failures (watermark), never retries | `tests/delivery-failures.test.js` (5) + `tests/sync-routes.smoke.test.js` (+1: fail listed, ok not, no address) |
| E-R05 | R-05 business pulse (prep) | PARTIAL (doc, by design) | `docs/ops/BUSINESS-PULSE-DRAFT.md`: proposed questions, scale, anonymity options, link to commitments — every line "proposal"; R14 stays `missing` in the catalogue with a pointer | doc only |
| E-R06 | R-06 / A05 reminders | FIXED behind switch (A05 missing → partial) | `services/scheduleReminders.js` (pure): latest PV per site × department `next_meeting_date`, cadences (ISO weekday, effective range), and (with `schedule_inspection_interval_days`) last inspection + interval; site local date via `siteTimeZone`; one reminder per item and date (`A05:<kind>:<ref>:<due>` in `notifications.source_ref`); recipients = active editors of the site. Job `engagement.schedule_reminders` (daily 06:50) via `engagementJobs.bindJobs().reminders`; `schedule_reminders_enabled` ('0'), `schedule_reminder_lead_days` ('' = off), STOP respected | `tests/schedule-reminders.test.js` (8, incl. the live PostgreSQL readers) |
| E-R07 | R-07 sober alerting | FIXED (metrics ON for admin) + 2 switches | `GET /api/engagement/alert-noise` (admin tier): per rule fired, distinct sites, multi-site, notified, read, read rate (labelled read ≠ acknowledgement; null when nothing notified), median minutes to read (null when nothing read). `alert_group_by_rule` ('0'): digest folds one rule into one line listing sites. `alert_quiet_hours` ('' = none, UTC `HH:MM-HH:MM`): non-critical firings deferred (state restored so they fire after the window), critical never deferred. `alertEngine` stays pure | `tests/alert-noise.test.js` (7) + `tests/engagement-routes.smoke.test.js` (+1: 403 for viewer, shape) |

## Test proof

Final focused run on PostgreSQL 16 (throwaway DB per file): 29 files, **210 pass / 0 fail / 0 skipped** — the
touched files, their neighbours (commitment escalation/lifecycle, governance roles, ppm alerts + CLI, sync
drift/schedule/registry, alert engine/arm/dry-run, engagement store) and the guards `flag-register`, `readme-truth`,
`error-shape` (ratchet unchanged, all new denials go through `httpError.fail`), `server-size-budget`,
`authz-route-matrix`, `await-precedence`, `ui-design-ratchet` (no new hex literal), `i18n-coverage`. eslint clean on
every touched file. `tests/.suite-manifest.json` updated (+34 tests).

## Deviations

- E-R02 A01: the switch is read inside `escalationRouting` (best effort, read error = today) because server.js may
  not be edited in this bundle. **Deferred to W2-SRV (optional):** pass `missingDueDate` and `engStore` explicitly
  from server.js; today `routes/commitments.js` builds its own engagement store lazily.
- E-R02 A10: the schema has no funding-review or renewal date; the reminder covers stage gates only (start date
  for approval, planned end for closure).
- E-R04: `report_sent_log` stores no error text, so report-send rows show no error; publish-run errors are redacted.
- E-R06: cadence weekday follows the cockpit's ISO convention (1 = Monday … 7 = Sunday).
- E-R07: quiet hours are UTC (not per site); a deferred firing is not recorded until it fires after the window.
- `docs/ops/AUTHZ-MATRIX.md` regenerated with the new route in the E-R07 commit; INVENTORY not regenerated (merge).

## Left for a person

- Name owners and audiences for R01–R16 (D-13); confirm the validation steps listed.
- Decide and arm: `a01_missing_due_date`, `a10_gate_lead_days`, `delivery_failure_alert_enabled` (needs
  `sync_alert_recipients` — X-R-02 / D-13), `schedule_reminders_enabled` + lead days + inspection interval,
  `alert_group_by_rule`, `alert_quiet_hours`. All are proposals in PILOT-PROFILE, none approved.
- Business pulse: approve questions, scale, anonymity, tool and periodicity (R14) — nothing has been sent.
- Browser check of the System Logs "Failed deliveries" table and of the A03/A04/A05 notifications in the
  notification centre (pages behind a session).
