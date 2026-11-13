# F-w4-connectors — optional external PPM connectors (PPM parity W4, rows J3 / J4)

Base `80a0340`, branch `goal/w4-connectors`. Design: `docs/ppm/W4-CONNECTORS.md`; ADR:
`docs/ai-decisions/ADR-W4-CONNECTORS-optional-external-ppm.md`.

| Clause | Built | Proof |
|---|---|---|
| 1. P6 XER import / export | `services/ppm/xer.js` (pure parser + writer, PROJECT/CALENDAR/PROJWBS/TASK/TASKPRED/CURRTYPE, `clndr_data` work week + exceptions); routes `GET …/project.xer`, `POST …/xer/import[?apply=1]` reusing the MSPDI import flow (empty project, dry run, apply = committee) | `tests/ppm-xer.test.js` (5: mapping, golden round-trip fixed point on `tests/fixtures/ppm/fictitious-p6.xer`, native re-schedule, warnings, hostile input); smoke XER test (export → dry run → 403 viewer apply → committee apply → 409 non-empty) |
| 2. .mpp converter hook | `services/ppm/mppConverter.js` (absolute path, no shell chars, executable; OLE2 magic; ≤ 25 MB; execFile argument array, `shell:false`, timeout, minimal env, 0700 temp dir always removed); `POST …/mpp/import` → 501 + how-to while `ppm_mpp_converter_cmd` is empty | `tests/ppm-mpp-converter.test.js` (5, real fake shell converters: not configured, validation, upload checks, success + cleanup, exit / no output / timeout); smoke .mpp test (501, NOT_OLE2, conversion dry run) |
| 3. Jira / Azure DevOps read-only pull | migration `112_ppm_external_connectors` (+ rollback, in `tests/ppm-rollback-scripts.test.js`); `workItemSync.js` (pure map + plan), `workItemClient.js` (injectable transport, default safeUrl), `externalLinkStore.js` (opt-in, links, idempotent apply via the governance store); routes `GET/PUT …/work-items/:system`, `POST …/sync[?apply=1]`, `GET …/connectors/status`; secrets `ppm_jira_api_token`, `ppm_azdo_pat` in `_SECRET_BLANK_KEEP`; base URLs in the outbound-URL guard | `tests/ppm-work-item-sync.test.js` (6); smoke Jira/ADO test (opt-in required, plan-write gate, not-configured, dry run writes nothing, apply, idempotent re-apply, upstream change → 1 update, read-only verbs only, status committee-only, no secret echoed, opt-out); `tests/rbac-external-writes.test.js` lists the WIQL POST |
| 4. Switches | `ppm_xer_enabled`, `ppm_mpp_import_enabled` (+ `ppm_mpp_converter_cmd`), `ppm_jira_sync_enabled`, `ppm_azdo_sync_enabled` (+ connection keys) all `'0'`/`''` in DEFAULTS; `/features` keys `xer`, `mpp_import`, `jira_sync`, `azdo_sync`; PILOT-PROFILE rows; FLAG-REGISTER regenerated; project page panel `public/lib/ppmConnectorsUi.js` (only when a switch is on) + French entries in `public/lib/i18n/project.fr.js` | smoke test 1 (all 404 while off, features false, native task write still works); flag-register, readme-truth |
| 5. Evidence + matrix | this file, ADR, W0-MATRIX-ENGINE rows J3 / J4 updated with honest status | — |

## Shared files touched (minimal)
`routes/ppmEngine.js` (MSPDI import body extracted into `refuseImport` / `finishImport`, exposed as `h.ppmEngine`; the
MSPDI response gains `source`), `services/ppm/engineStore.js` (`importModel` takes `source`, default `'mspdi'`),
`routes/governancePpm.js` (registration + features), `routes/adminConfig.js` (2 URL keys in the outbound guard),
`services/reportConfig.js`, `public/project.html` (one script tag + one mount line), `tests/rbac-external-writes.test.js`.

## Tests run (PG 16 local, throwaway DBs)
- New: ppm-xer 5/5, ppm-work-item-sync 6/6, ppm-mpp-converter 5/5, ppm-connectors-routes.smoke 4/4.
- Neighbours: inventory-strict, flag-register, flag-decisions, error-shape, await-precedence, server-size-budget,
  readme-truth, ui-policy*, simplicity-budget, ppm-rollback-scripts (incl. 112), report-config-encryption, ppm-mspdi,
  authz-*, rbac-*, cross-site read/write/object sweeps, ppm-engine-routes.smoke, ppm-w3.smoke, safe-url,
  e2e-outbound-guard, teams-sla-config — green.
- `i18n-coverage` "project.html: every static text…" fails **before and after this lot** (37 W3 strings without a
  French entry — Simplified, Expert, DCMA…); verified by running it with this lot's `project.html` change stashed.
  Not in this lane.
- `npx eslint .` clean.

## Not done / human decisions
- No real Primavera, .mpp/MPXJ, Jira tenant or Azure DevOps organisation was used — fake fixtures / transports only.
- Installing a converter (MPXJ licence), Jira / ADO service accounts and tokens, and which projects may opt in.
- No scheduled sync job (manual "Sync now"); connector-health page not extended (status endpoint instead).
