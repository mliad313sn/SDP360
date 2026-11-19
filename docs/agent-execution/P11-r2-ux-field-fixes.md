# P11 round 2 — UX/field seat fixes (F-5, F-6, F-2 residual, F-7, F-4)

AI work, not an independent human review. Branch `qual/p11-fix8`. Source finding file: `/home/user/qual/out/r2-ux-field.md`.
Defect fixes, shipped ON (no switch).

| Finding | Root cause | Fix | Proof (failing before, passing after) |
|---|---|---|---|
| F-5 (P1) | Field app offered `→ Demand / → Ticket / Cancel` (lowercase `cancelled`) on inspection actions; no write path checked the inspection vocabulary; overdue/open SQL compared `'Closed'`/`'Cancelled'` case-sensitively | `inspection-db.normalizeActionStatus` (Open · In Progress · Closed · Cancelled, case/space variants mapped) enforced in `addActionUpdate` (web register route + field) and `saveInspection` (typed VALIDATION 400); field route refuses with `reason: inspection_action_status`; terminal checks `lower(a.status) NOT IN ('closed','cancelled')`; field app shows Close + Cancel(`Cancelled`) only for inspection actions (SW cache `field-v11`) | `tests/field-inspection-action-status.smoke.test.js` 1-5, `tests/field-actions-dialog-browser.test.js` |
| F-6 (P2) | Same-author replay exemption compared only `meta` | Exemption requires the stored `state_json` to equal the full payload (stable JSON) and the stored status to equal the payload status — any other content, or a row edited since, is 409 | smoke tests 6-8 (+ existing `field-outbox-conflict.smoke` 6/6) |
| F-2 residual (P3) | Without `base_status`, a missing or future `client_ts` skipped the check | Missing / future (> now + 5 min) `client_ts` loses to any recorded server status change | smoke tests 9-10 |
| F-7 (P3) | Dialog Cancel was `type=submit` against a `required` textarea | `formnovalidate` on Cancel; `aria-labelledby="dlg-title"` | browser test |
| F-4 (P3) | English thrown literals in `app.js`; server conflict text shown as-is | Thrown texts through `FT()` with French entries; server refusals carry `reason` + `detail`, the app renders them in the user's language | `tests/field-french.test.js` (new test 5), browser test (French 409) |

## Repair note (no live data changed)
Rows stored before this fix keep their status. `node tools/field/inspection-action-status-check.js [--json]` is
READ-ONLY: it lists inspection actions outside the vocabulary, with the canonical status a case variant maps to.
A lowercase `cancelled` row is already counted as finished by the new case-insensitive checks. A `demand` /
`helpdesk_ticket` row has no inspection equivalent: its owner closes or cancels it in the Inspection Actions register
(audit thread). Running it on a live system and deciding those rows is a human step.

## Not addressed
A4 (status changed through the inspection editor leaves no `insp_action_updates` row, so the legacy `client_ts`
check cannot see it) — only reachable with a legacy envelope lacking `base_status`; left as noted.
