# ADR-G16 — engagement alerts: outbound channels armed OFF, one STOP switch

Status: accepted as an AI technical decision · 2026-10-29 · reviewed by AI specialist personas (ITIL, CISO), **not** by the named human owners · severities pending service-owner confirmation · arming any channel is an operator act

## Context
Every other sender in the platform is armed OFF by default, but `engagement.alerts` sent e-mail, Teams and webhook
messages as soon as SMTP or a URL was configured — configuring SMTP for reports would also start alert e-mails.

## Decision
`alert_external_enabled` (default `'0'`) must be `'1'` for e-mail / Teams / webhook alert channels;
`notifications_stop='1'` halts them whatever the arm flag says. In-app notifications are internal and unaffected.
Proof: `tests/alert-outbound-arm.test.js` (fails on the previous code: 1 mail + 2 posts with nothing armed).

## Rollback
Set `alert_external_enabled='1'` (operator), or revert the guard in `services/engagementJobs.js`.

## Addendum (same day) — severity and dry run
- **Severity** `info | warning | critical` on every rule (migration `041_alert_severity.sql`, default `warning`;
  an unknown value is refused, a missing one reads as `warning`, never silently `info`). The firing stores the
  severity it fired with, so editing the rule later does not rewrite history. The e-mail subject, Teams card and
  webhook body carry it. The seeded severities are a **proposal** of the delivery team (critical = major incident,
  critical-risk inspection; info = asset housekeeping) until the service owner confirms. The WAN rules stay
  `warning`: they read the weekly % Time Up, an operational figure, **not** the contract (total outages in service
  hours, `services/wanSla.js`); no rule measures the contract yet. Cool-downs now match the metric window (weekly
  count → 7 days, monthly count → 30 days) so one event is announced once. Migration 041 corrects the existing seeded
  rules only in the run that adds the column; a replay never overwrites an admin's later choice.
- **Dry run** `POST /api/engagement/rules/evaluate?dry=1` (admin): returns what would fire, the in-app and e-mail
  audience, why an outbound channel is blocked (arm flag off / STOP) and what configuration is missing; rules in
  cool-down are listed and flagged rather than hidden. It saves no state, no firing, no notification and sends
  nothing. Teams/webhook URLs are never echoed. "Evaluate now" (a real run) asks for confirmation.
- Alternatives rejected: a numeric priority (no shared meaning across modules); a dry run that records firings
  flagged "dry" (pollutes the false-positive rate the admin page shows).
- Rollback: the column is additive; dropping the `severity` read restores the previous behaviour.
