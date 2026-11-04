# A-05 — Meetings actions: one status vocabulary (evidence)

Date: 2026-11-04 · branch `goal/a-05` · sandbox only (no production access).

## What changed
- `public/lib/statusTransfer.js`: `normalizeMeetingStatus` ('closed' any case → 'resolved', other codes trimmed/lowercased) and `optionsHtml` (stored code always stays selected; unknown code shown as "<label> (legacy)").
- Server normalises at the door: `meetings-db.js` (`addActionUpdate`, `addIssueUpdate`, `saveMeeting` issue + action rows) and `routes/field.js` `action()` for meetings actions.
- Field app sends `resolved` for meetings actions; service worker cache `field-v3`.
- Editors (`meeting.html` issues + actions, `site-actions.html` meetings/incubation/issue rows, `meetings-actions.html`, `meetings-issues.html`) use `optionsHtml`.
- Repair CLI `tools/pg/normalize-action-status.js` (dry run default, `--apply`, `--restore=<file>`). No SQL migration (db/migrate.js would apply it at boot).
- No new setting.

## Tests (PostgreSQL throwaway databases)
- Before the fix: 13 of 28 targeted tests failed (normaliser, options builder, field smoke, pg-meetings A-05 case, static checks).
- After: status-transfer-normalize 6/6, meeting-status-options 5/5, normalize-action-status-cli 1/1;
  field-routes.smoke, pg-meetings, status-transfer.smoke, audit-meetings-integrity, field-pwa-static, field-french, await-precedence: 49 pass / 0 fail / 0 skipped.

## Dry run (throwaway database seeded with one legacy row; no dev database on this machine)
```
md_actions 1 row(s) with status 'closed'
  #1  HGO_IT_PV_2026-09  HGO  status="closed"  closed_at=2026-09-11 10:00:00
md_issues  0 row(s) with status 'closed'
Dry run — nothing changed. Re-run with --apply (after a restore point) to rewrite these rows.
```

## Left for a person
- Production: restore point (`_sdp_admin.cmd` option 5), `node tools/pg/normalize-action-status.js` (dry run), check the count, then `--apply`. Rollback: `--restore=data/status-backups/<file>.json`.
- Deploy needs pm2 stop → start (meeting.html is boot-cached); users Ctrl+F5; field phones pick up `field-v3`.
- One field technician closes a meetings action in the field app and confirms it shows Resolved in the PV.
