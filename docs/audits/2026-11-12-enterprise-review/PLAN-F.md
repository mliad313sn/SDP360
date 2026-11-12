# Plan F — PO consolidation of the expert committee (12 Nov 2026)

Inputs: the gap analysis "SDP360 Analyse comparative et trajectoire entreprise" (12 Nov 2026), the vision and AI prompt pack
"Enterprise Operations Platform Modernization" v2.0 (9 Nov 2026), and the four panel reports in this folder
(`PANEL-PRODUCT.md`, `PANEL-ARCH.md`, `PANEL-UX.md`, `PANEL-DATA.md`). The committee is an AI committee: it assesses and
proposes; nothing here is an approval, a signature, a field acceptance or a production-readiness statement.

## 1. What the committee established

| Panel | Claims checked | Confirmed | Refuted | Already fixed | Needs review.1 artifact | New findings |
|---|---|---|---|---|---|---|
| Product / ITIL / PMO | 28 | 17 | 0 | 1 | 7 | 12 |
| Architecture / security / DevOps / QA | 24 | 10 | 1 | 4 | 4 | 1 P0 + others |
| UX / design / adoption | 30 | 19 | 1 | 2 | 4 | 12 |
| Data / BI / KPI | 22 | 11 | 0 | 2 | 4 | 13 |

Facts that drive the plan:
- **The installed build `2.0.0-alpha.16+review.1` is not in this repository or in any GitHub branch** (no `workspace-settings.html`,
  no migrations 078/079, no profile engine, no native workbench). Everything that depends on it is parked until the artifact
  is supplied (E01, E03 on the review.1 workbench, E06 profile engine, F-UX-08, F-PRODUCT-10). Migrations **078/079 are reserved** for it.
- **E04 confirmed and wider than documented**: a skipped/unconfigured sync is recorded as a success with a new watermark
  (`services/sync/jobs.js`, `services/sync/syncRunner.js`), which makes dashboards, the publish gate and the ext API read FRESH.
- **E07 confirmed**: three different allocation rules (server, UI, new capacity view).
- **New P0**: `GET /api/sample/:viewId` is open to any session and bypasses the PII filter.
- **New P0**: WAN metrics ignore the window and the sub-site; two published programme metrics are never computable.
- Accessibility defects: French pages announced as English; `aria-current` missing on flat links; every state badge is a live region.

## 2. PO decisions (engineering scope only)

1. Plan E wave 2 is merged first (done for 7 of 8 bundles; W2-UX in flight). Plan F starts on top of it.
2. Duplicate goals are merged: F-ARCH-01 = F-DATA-01; F-PRODUCT-03 = F-DATA-09.
3. Defect fixes ship ON. Behaviour or policy changes ship behind a `report_config` switch whose default is today's behaviour.
4. Not executed by agents: F-ARCH-10 (release policy — release manager), F-UX-08 and F-PRODUCT-10 (need the review.1 artifact).
5. Migrations: 078/079 reserved; plan F uses 080+ as assigned below.

## 3. Bundles

| Bundle | Goals (in order) | Owns | Migrations |
|---|---|---|---|
| F1-SYNC | F-ARCH-01(+F-DATA-01), F-ARCH-09, F-DATA-02, F-DATA-03 | services/sync/*, routes/sync.js, services/metricRegistry.js, services/publishGate.js | — |
| F1-SEC | F-ARCH-02, F-ARCH-03, F-ARCH-04, F-ARCH-06 | **server.js** (only this bundle) | — |
| F1-PPM | F-PRODUCT-01, F-PRODUCT-02, F-PRODUCT-09, F-PRODUCT-03(+F-DATA-09), F-PRODUCT-04, F-DATA-10 | services/projectSchedule.js, public/lib/ppmVisuals.js, routes/governancePpm.js, portfolio/project pages | 080, 081 |
| F1-DATA | F-DATA-04, F-DATA-05, F-DATA-06, F-DATA-07, F-DATA-08, F-DATA-11, F-DATA-12 | report generator/analysis, routes/dashboards.js, services/reportPayload.js | — |
| F1-GOV | F-PRODUCT-06, F-PRODUCT-05, F-PRODUCT-07, F-PRODUCT-08 | governance decisions, departments, My work, pilot tools | 082, 083 |
| F1-OPS | F-ARCH-05, F-ARCH-08, F-ARCH-07 | tools/pg restore drill, tools/agent inventory, package.json / CI | — |
| F2-UX (after W2-UX merge) | F-UX-01, 02, 03, 09, 11, 04, 10, 05, 06, 07, 12 | public/_shell.js, public/lib/stateBadge.js, home, **public/reports.html** | 084 |

Shared-file rule: `services/reportConfig.js`, `docs/ops/pilot/PILOT-PROFILE.md`, `tests/.suite-manifest.json` are append-only for every
bundle (the merge reconciles). `reports-db.js` is not owned by any bundle in this wave: a goal that needs it adds a reader in its own
service module (as W2-ITSM did) or lists the change as deferred.

## 4. After the bundles

- Full suite, the browser journeys twice, CI.
- User-representative committee (AI-run, 8 seats, on a synthetic organisation) → `docs/audits/2026-11-05-expert-audit/UAT-COMITE-UTILISATEURS.md`.
  It is **not** user acceptance.
- Release dossier and the Word executive report are updated.

## 5. Decisions that stay with people

See section (f) of each panel report. The ones that block a pilot: supplying the review.1 artifact; portfolio access exceptions
(IAM + PMO); the allocation convention (PMO); the Finance verifier and benefit method (Finance); KPI committee membership and the
two decision KPIs; integration credentials (Meraki, Zoho/SDP Cloud); performance budgets; pilot cohort; signing and CAB.
