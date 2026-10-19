# Legacy one-off operational scripts

These Windows `.cmd` / `.bat` / Node scripts were inherited from `samaziz679/SDP-Dashboard`,
where they lived in the repository root. They are **one-off staging, diagnostic and clean-up
helpers** tied to a specific production date (`_stage_palier2_phase3_to_prod.cmd`,
`_deploy_full_20260605.cmd`, `_diag_meetings_dupes.js`, …). None of them is referenced by
`server.js`, the installer (`tools/installer`) or the packager (`tools/deploy`).

They are kept for forensic value only. Do **not** run them against a current instance without
reading them first: several hard-code `C:\Apps\SDP-Dashboard\` paths and SQLite database names
that pre-date the PostgreSQL cutover.

Scripts that ARE still referenced by live tooling stay in the repository root on purpose:

| File | Referenced by |
|---|---|
| `_sdp_admin.cmd` | installer, `tools/pg/*`, `public/help.html`, frozen-lots register |
| `_pm2_restart_prod.cmd` | `tools/deploy/make-deploy-zip.ps1`, `apply-on-prod.cmd` |
| `_pm2_recover_prod.cmd` | `tools/installer/Install-SDP.ps1` |
| `_restore_db.cmd` | Activity Tracker recovery banner (`App.jsx`) |
| `_audit_tracker_dualwrite.js` | mirrored by `tracker-db.js` (keep in sync) |

The SDP360 roadmap (Phase 1) replaces the staging scripts with the versioned deploy package in
`tools/deploy` plus CI (`.github/workflows/ci.yml`); the dedupe/diagnostic scripts are superseded
by the sync run log (`sync_runs`) and the natural-key dedup in `services/sync/syncRunner.js`.
