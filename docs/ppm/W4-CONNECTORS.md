# W4-CONNECTORS — optional interoperability with external PPM tools

**Boundary (user decision 2026-11-12, `.claude/rules/SDP360_BOUNDARIES.md`):** external PPM connectors are allowed
ONLY as optional extras. The native project / programme / portfolio tool works with every switch below at `0`
(the default), and no native feature reads anything these connectors write. Forbidden connectors stay forbidden
(Pronto, OT/HSE, ISP, Nutanix, external backup, Defender API).

| Switch (default `0`) | What it opens | Who |
|---|---|---|
| `ppm_xer_enabled` | `GET …/project/:id/project.xer` (export) · `POST …/project/:id/xer/import[?apply=1]` | read scope · plan writer (dry run) / committee (apply) |
| `ppm_mpp_import_enabled` | `POST …/project/:id/mpp/import[?apply=1]` through `ppm_mpp_converter_cmd` | plan writer / committee |
| `ppm_jira_sync_enabled` | `GET/PUT …/project/:id/work-items/jira`, `POST …/work-items/jira/sync[?apply=1]` | read scope · plan writer |
| `ppm_azdo_sync_enabled` | the same under `…/work-items/azdo` | read scope · plan writer |
| any of them | `GET /api/governance/ppm/connectors/status` | committee / admin tier |

All paths are under `/api/governance/ppm/`. `GET /api/governance/ppm/features` reports `xer`, `mpp_import`,
`jira_sync`, `azdo_sync`; the project page shows its "External planning tools (optional)" panel only then.

## Primavera P6 XER (file format)
`services/ppm/xer.js` (pure). Tables read/written: PROJECT, CALENDAR (work week + exceptions from `clndr_data`),
PROJWBS (→ summary tasks), TASK, TASKPRED, CURRTYPE. Not carried: resources/assignments (RSRC/TASKRSRC), baselines,
UDFs, activity codes, secondary constraints, expected finish — every drop is a named warning (`file_warnings` on
import, `X-XER-Warnings` header on export). Hours ↔ days use the calendar day length (default 8 h). The import is the
SAME flow as MSPDI (`routes/ppmEngine.js` `refuseImport` / `finishImport` → `engineStore.importModel`, event
`xer_imported`): empty project only, dry run by default, apply = committee, a cycle refuses the apply.

## .mpp through a local converter
No binary .mpp parser exists for Node and we ship no licensed library. An administrator may install one (for example
MPXJ) and point `ppm_mpp_converter_cmd` at an executable that takes two arguments `<in.mpp> <out.xml>` and writes
MS-Project XML. Example wrapper — UNTESTED, illustrative (Linux; adapt the jar path — the MPXJ licence and its installation are a human
decision):

```sh
#!/bin/sh
exec java -cp /opt/mpxj/mpxj.jar:/opt/mpxj/lib/* net.sf.mpxj.sample.MpxjConvert "$1" "$2"
```

Rules (`services/ppm/mppConverter.js`): nothing runs while the command is empty (HTTP 501 with this how-to); the
path must be absolute, a regular executable file, with no spaces or shell characters; the upload must be an OLE2
compound file ≤ 25 MB; the command runs with an argument array and **no shell**, a 60 s timeout, a minimal
environment, in a private temp dir (0700) that is always removed. The output is then parsed as MSPDI and imported
like an MSPDI file (`mpp_imported`). Without a converter, save the plan from MS Project as XML and use the MSPDI import.

## Jira / Azure DevOps — read-only pull
* **Connection** (super_admin, `PUT /api/reports/config`): Jira `ppm_jira_base_url`, `ppm_jira_user` (Cloud e-mail;
  empty = a Server/Data Center PAT sent as Bearer), secret `ppm_jira_api_token`; Azure DevOps `ppm_azdo_org_url`,
  `ppm_azdo_project`, secret `ppm_azdo_pat`. Secrets are redacted on read, blank-kept and encrypted at rest; the base
  URLs pass the outbound-URL guard (https, no private address unless allow-listed).
* **Opt-in per project** (`PUT …/work-items/:system {scope}`): a Jira project key (`ABC` → `project = "ABC"`) or a
  JQL; an Azure DevOps area path (`UNDER`). `{enabled:false}` opts out (links are kept, nothing more is pulled).
* **Sync** (`POST …/sync`): reads (Jira `GET /rest/api/2/search`, paged; Azure DevOps one WIQL query POST + batched
  `GET workitems`), at most 2,000 items, maps each item to a task (status `todo | in_progress | done | cancelled`,
  progress 100 when done else **unknown**, estimate in hours, due date; Azure DevOps start + target dates only
  together → manual dates) and plans: create / update / unchanged / deleted locally / missing upstream. Without
  `?apply=1` nothing is written. Apply creates or updates native tasks through the governance store (same validation
  and audit) and records links keyed by project × system × external key — a second apply with the same data changes
  nothing. Owned fields: name, status, progress, effort, deadline, dates — a non-null upstream value overwrites; a
  null never clears a native value. A task deleted natively is never resurrected; an item gone upstream is only
  reported.
* **Never** written back to the external tool. Tested with fake transports only: **no real Jira or Azure DevOps
  tenant was used.**

Migration `112_ppm_external_connectors` (rollback `db/postgres_rollback/112_ppm_external_connectors_drop.sql`).
