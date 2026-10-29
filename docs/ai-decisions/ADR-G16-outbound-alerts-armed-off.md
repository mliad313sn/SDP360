# ADR-G16 — engagement alerts: outbound channels armed OFF, one STOP switch

Status: accepted (technical; arming is an operator act) · 2026-10-29 · reviewers: ITIL owner + CISO personas

## Context
Every other sender in the platform is armed OFF by default, but `engagement.alerts` sent e-mail, Teams and webhook
messages as soon as SMTP or a URL was configured — configuring SMTP for reports would also start alert e-mails.

## Decision
`alert_external_enabled` (default `'0'`) must be `'1'` for e-mail / Teams / webhook alert channels;
`notifications_stop='1'` halts them whatever the arm flag says. In-app notifications are internal and unaffected.
Proof: `tests/alert-outbound-arm.test.js` (fails on the previous code: 1 mail + 2 posts with nothing armed).

## Rollback
Set `alert_external_enabled='1'` (operator), or revert the guard in `services/engagementJobs.js`.
