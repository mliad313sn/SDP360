# Release runbook — governance consolidation (branch `claude/sdp360-consolidation`)

Every step below is a human gate (CAB, DBA, committee). Each one is prepared, scripted and tested; nothing
here was run against production. Order matters.

| # | Step | Who | How | Proof it is ready |
|---|---|---|---|---|
| 1 | Review and merge | Release owner | PR from `claude/sdp360-consolidation` to `main` | CI green on the head; full suite 2,918 tests on PostgreSQL, 0 failed |
| 2 | Backup | DBA | `node tools/pg/dump-db.js` (or the nightly encrypted backup) | `docs/DB_RECOVERY.md` |
| 3 | Deploy | Ops (CAB) | ZIP from `tools/deploy/make-deploy-zip.ps1` → `_apply_on_prod.cmd` → `pm2 stop` / wait / `pm2 start` (never `reload`) → `tools/deploy/mark-deployed.cmd`; installer files stay out (DEC-2) | `docs/sop/SOP-deploy.md` |
| 4 | Migrations 027 → 038 | automatic at boot (`db/migrate.js`) | additive, idempotent; 034 chains the existing audit rows once | CI step "Apply schema migrations on a fresh database" |
| 5 | Audit-table ownership | DBA, as superuser, change window | `psql "$SUPERUSER_URL" -v app_role=<app role> -f tools/pg/harden-audit-grants.sql` (roll-back written in the file) | `tests/audit-grants-rehearsal.test.js` runs the script on a real cluster: the app role still reads and appends, cannot update, delete, truncate, disable a trigger or replace the trigger functions |
| 6 | Chain check | Ops | `GET /api/governance/audit-chain` → every table `ok: true`; the job `audit.chain_verify` runs nightly | `tests/audit-chain.test.js` |
| 7 | Committee values | Committee, applied by a super_admin | fill `tools/governance/values.example.json` (roles, deputies, matrix, calendar, KPI targets, policies, site groups, site codes, switches) → `node tools/governance/apply-values.js values.json` (simulation) → `--apply --as=<super_admin>` | `tests/governance-values.test.js`: one wrong row writes nothing; relaxations become two-person proposals; a re-run repeats nothing |
| 8 | Approve relaxations | a SECOND super_admin | Governance policies ▸ Proposals | `tests/governance-policy-routes.smoke.test.js` |
| 9 | Coverage gaps | Committee | Governance ▸ Roles: "Gaps" must be empty before arming notifications; also in the oversight CSV (`role_gap`) | `tests/governance-roles.smoke.test.js` |
| 10 | Switches (D-04, DEC-4, #39) | Committee | `handoff_notify_enabled`, `commitment_notify_enabled`, `handoffs.commitment_ledger`, then `site_codes_from_registry` once `GET /api/governance/site-codes` shows no difference | `tests/site-code-registry.smoke.test.js`, `tests/obligations.smoke.test.js` |
| 11 | Remove the hard-coded site maps | Developer, after step 10 has run in production for one reporting cycle | delete `SITE_MAP` from `tracker-db.js` / `inspection-db.js` and the fallback in `services/siteCodeRegistry.js` | the diff endpoint must stay empty |
| 12 | Second company | Committee | confirm: a second company = a separate instance (own database, own `.env`); countries and business units cover one company | `docs/sdp360/completion/COMMITTEE-REVIEW-2026-10-28.md` #49 |

Roll-back: steps 7-10 are data (end / revoke / retire / switch off — all in the admin screens, every change
in the history); step 5 has its own roll-back lines; steps 3-4 are additive (the previous ZIP and the
backup restore the previous state).
