# Emergency access drill on TEST (audit S-06) — PROPOSITION, TO BE RUN BY PEOPLE

Prepared by E-S06 on 2026-11-06. Code: C-22 (`services/emergencyAccess.js`, `services/emergencyAccessStore.js`,
`routes/access.js`). Run on the **TEST instance only**, by two named super_admins (granter ≠ reviewer) and one
beneficiary account. Nothing here has been run by an agent. Record the results in the change record, not here.

| Role in the drill | Person |
|---|---|
| Granter (super_admin) | UNKNOWN |
| Reviewer (another super_admin) | UNKNOWN |
| Beneficiary (a non-admin test account) | UNKNOWN |
| Observer reading system_log | UNKNOWN |

## Steps and expected evidence

| # | Step | Expected result | Expected system_log row (category `identity`, risk 1) |
|---|---|---|---|
| 0 | Admin ▸ settings: `emergency_access_enabled` = `1` on TEST | Emergency tab appears on `/access.html` for super_admins | config change row |
| 1 | Granter tries to grant emergency access to themselves | Refused (403) | none |
| 2 | Granter grants the beneficiary one role for 25 hours | Refused / capped at 24 h (hard cap) | none |
| 3 | Granter grants the beneficiary one role for 2 hours with a reason | Granted; beneficiary's next request has the role | `access_emergency_granted` (emergency id, request id, roles) + `user_role_changed` (via access_request) |
| 4 | Beneficiary uses the role | Allowed while in force; a qualification prerequisite is still refused if configured | — |
| 5 | Wait for the hour (or set 1 h) — job `access.emergency_expiry` (every 10 min) | Role removed; the open session loses it on the next request | `access_emergency_expired` + `user_role_changed` (via access_grant_expired) |
| 6 | Granter tries to record the review | Refused (granter cannot review) | none |
| 7 | Reviewer records the review `justified` with notes ≥ 10 characters | Recorded; review no longer overdue | `access_emergency_reviewed` (outcome, overdue flag) |
| 8 | A grant left unreviewed for more than 2 working days | Listed under `/api/access/emergencies/overdue` | — |
| 9 | Switch `emergency_access_enabled` back to `0` | Emergency routes answer 404 again | config change row |

Pass = every row as expected. Any difference is a finding for the security owner. Hash-chained events for every
step are in `access_request_events` (verified nightly by job `audit.chain_verify`).
