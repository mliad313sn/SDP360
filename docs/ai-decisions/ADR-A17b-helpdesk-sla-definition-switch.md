# ADR-A17b — helpdesk SLA definition switch and deck zero policy

Status: built, **switched to today's behaviour** · 2026-11-04 · the choice belongs to the KPI committee (not approved)

## Context
The browser rule `isResOverdue` (`public/lib/dashboard-shared.js`) decides "resolution SLA missed" by comparing
the resolved (or completed) time with the due time and only falls back to the stored Overdue Status flag; every
server reader trusts the stored `request_records.overdue_status`. A stale flag makes them disagree (pinned by
`tests/uat-itsm-figures.test.js` ITSM-07 and `tests/sla-definition-parity.test.js`). Aligning the server changes
every server-side SLA figure, so it is a KPI decision. Separately, the Group IT deck payload keeps the server's
count when the browser sends 0 for some KPIs (`KEEP_SERVER_WHEN_BROWSER_IS_ZERO`, user request 2026-06-04).

## Decision (code only — the values are the committee's)
- `services/slaDefinition.js` (pure): `resOverdueRow(row, mode)` and `resOverdueSql(mode)` for
  `flag` (default, today) and `due_vs_resolved` (browser rule; constant SQL, mode never interpolated).
- `report_config helpdesk_sla_definition` = `flag` | `due_vs_resolved` (default `flag`). Consumed by
  `getMonthlyHelpdeskHistory(n, { slaDefinition })`, called with the configured value by `services/execSummary.js`.
- `report_config exec_payload_zero_policy` = `keep_server` | `browser_wins` (default `keep_server`).
  `services/reportPayload.js mergeBrowserKpis` — `browser_wins` trusts every browser value (0 included), sets
  `fcr_rate` null when the browser did not compute it and `_unknown_as_dash`; `tools/exec-pptx/render.py` then
  prints "—" for the verdict tiles (FCR, Res. SLA, FRT SLA) that arrived unknown (`tools/exec-pptx/kpi_fmt.py`).
- Doctrine fixes in `getMonthlyHelpdeskHistory` (no switch): first-response violations use the same
  `IN ('true','1','yes')` set as the other readers; a month with no closed / responded ticket returns `null`
  instead of a fake `0`. Every consumer already handles `null` (execSummary guards `closed > 0`;
  `executive.html` uses `parseFloat(...) || 0` / `isNaN → null`).

## Readers still on the stored flag (follow-up if the committee chooses `due_vs_resolved`)
`getCalendarMonthlyHelpdesk` (site reports, Group IT deck server KPIs), `getRequestMetrics`, `getSlaTrendDB`,
`getSlaByCategoryDB`, `getSiteHelpdeskWindow`, the ageing / SLA-violation readers in `reports-db.js`, the
weekly/monthly PPTX helpdesk slides (via `getCalendarMonthlyHelpdesk`), the scoreboard helpdesk dimension.

## Rollback
Set the two keys back to `flag` / `keep_server` (or never change them). The doctrine fixes are reverted with
the commit. No schema change.
