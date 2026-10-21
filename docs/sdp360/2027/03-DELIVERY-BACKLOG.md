# 03 — Delivery backlog (P0 / P1 / P2)

Aligned on Goals 02–05 of `briefs/2026-10-21-MASTER-GOAL-2027.md`. Gap IDs refer to [01-GAP-REGISTER.md](01-GAP-REGISTER.md); decision IDs to [02-DECISION-LOG.md](02-DECISION-LOG.md). All migrations are **additive** (new tables/columns, `IF NOT EXISTS`, sqlite + `db/postgres/<module>/NNN_*.sql`), behind feature flags, with a dry-run before any write path is switched on.

## Priority matrix

Scores 1 (low) – 5 (high); complexity and dependencies are inverse (5 = easy / none). Rank = sum.

| Epic | Impact | Exposure ↓ | Stakeholders | Data ready | Complexity | Deps | Rank |
|---|---|---|---|---|---|---|---|
| E0 Platform truth & release controls | 4 | 4 | 3 | 5 | 5 | 5 | 26 |
| E1 Canonical commitment + source links | 5 | 5 | 5 | 4 | 2 | 4 | 25 |
| E2 Serious-finding control (A01/A02) | 5 | 5 | 4 | 4 | 4 | 3 | 25 |
| E3 Independent verified closure | 5 | 4 | 5 | 3 | 3 | 2 | 22 |
| E4 Freshness → UNKNOWN + publication suppression (A08) | 4 | 5 | 4 | 4 | 3 | 4 | 24 |
| E5 Routines calendar (planned/held/logged/accepted) | 4 | 3 | 4 | 3 | 3 | 3 | 20 |
| E6 Friday exception cockpit (R02/A13) | 4 | 4 | 3 | 3 | 3 | 2 | 19 |
| E7 Draft 5-dimension scorecard (shadow) | 4 | 3 | 5 | 2 | 3 | 1 | 18 |
| E8 Report catalogue + release workflow | 4 | 3 | 5 | 3 | 2 | 2 | 19 |
| E9 Native portfolio lifecycle | 4 | 2 | 4 | 2 | 1 | 2 | 15 |
| E10 OpManager coverage matrix / Meraki decision | 3 | 3 | 3 | 2 | 3 | 1 | 15 |
| E11 Benefits ledger | 3 | 2 | 4 | 1 | 2 | 1 | 13 |

## P0

### E0 — Platform truth & release controls (Goal 01, done in part)
- **Problem:** version drift and undocumented skips made "what is running" unanswerable. **Roles:** Product Owner, Platform Lead.
- **Done here:** E0.1 versions aligned + `tests/version-consistency.test.js`; E0.2 `feature-matrix.json` + `tests/feature-matrix.test.js`.
- **Remaining:** E0.3 authenticated `GET /api/health/version` (package version + `APP_VERSION`) in `routes/health.js` (no `server.js` change needed beyond existing mount); E0.4 dependency bump for the 2 high advisories (D-11); E0.5 unit tests for `services/engagementJobs.js` `publishScheduled` with a stubbed Graph transport (G6.4/G6.6).
- **Rollback:** revert commit; no data touched.

### E1 — Canonical commitment and source-link graph (Goal 02)
- **Problem:** five action registers, five terminal rules (G1.1, G1.2). **Roles:** Group IT Ops, site IT leads, department heads.
- **Code to extend:** `services/siteActionsRegister.js` (becomes the linked view), `routes/siteActions.js`, `public/site-actions.html`; new pure `services/commitmentLifecycle.js` (state machine captured → triaged → committed → in_progress → awaiting_verification → verified_closed + blocked/deferred/cancelled_with_reason/rejected_for_rework/reopened/accepted_risk_exception).
- **DB:** `commitments`, `commitment_source_links` (unique `(source_kind, source_id)`), `commitment_events` (append-only), optimistic `version` column.
- **API:** `GET/POST /api/commitments`, `POST /api/commitments/:id/transition` (idempotency key), `POST /api/commitments/:id/links`; RBAC by site via `services/userSites.js`.
- **UI:** commitment column in Site Actions; no new top-level register.
- **Tests:** pure state-machine table test; route smoke incl. cross-site 403; pg parity; dry-run backfill report (duplicate impact) before write path enabled.
- **Migration/rollback:** backfill in dry-run mode only first; feature flag `commitments_enabled`; drop flag to revert (source rows untouched). **Deps:** D-04 for verification semantics.

### E2 — Serious-finding control (A01/A02)
- Server-side rule in `inspection-db.js` save + `meetings-db.js` issues: HIGH/critical requires owner, due date or approved exception; nightly escalation job in `services/sync/jobs.js` through the runner; dedup key `(finding, kind)` like `services/slaAlertLog.js`. Tests: unit + smoke. Flag `serious_finding_rule`.

### E3 — Independent verified closure
- `closure_verifications` (reviewer, decision, reason, timestamp, evidence refs); technical completion timestamp separate. Reviewer ≠ executor enforced server-side. Deps: D-04.

### E4 — Freshness → UNKNOWN and publication suppression (A08)
- Shared reader helper over `routes/sync.js` freshness (`FRESHNESS_HOURS`); metric readers return `null` + `stale:true`; `reports.*` and `publish.connectors` jobs refuse authoritative release when a source is stale and emit a platform alert via `services/sync/alerts.js`. Tests: stale fixture → warning, not publication.

## P1

- **E5 Routines calendar** — extend `meeting_cadences`/`meeting_sessions` (`services/governanceStore.js`) with effective-date cadence, exception records and four states; inspection and incubation sessions linked. Tests: no-show never counted as held. Deps: D-01 (cadence numbers proposed only).
- **E6 Friday exception cockpit** — R02 pack from governance + commitments + E4 freshness; decisions linked to commitments. Deps: E1, E4.
- **E7 Draft scorecard (shadow)** — register five dimension metrics in `services/metricRegistry.js` with `status:'draft'`; dashboard/report/PPTX read the same reader; dual-run vs current site scores. No publication before D-01/D-02/D-03.
- **E8 Report catalogue** — R01, R02, R04, R10, R11 first in `routes/reportStudio.js`; extend `report_runs` statuses to approved/released/archived with immutable snapshot; Teams/SharePoint release only from `released`. Deps: D-13, E4.
- **E9 Native portfolio lifecycle** — `portfolio_*` tables gain lifecycle, gate decisions, budget declarations with provenance; Meridian retired (D-07).
- **E10 OpManager coverage matrix** — `routes/opmanager.js` coverage per site × asset class; "NOT MONITORED" rendering; Meraki decision D-06.
- **E12 A01–A16 rule set** — map each rule to `alert_rules` or a runner job with owner/cooldown/dedup/flag.

## P2

- **E11 Benefits ledger** (forecast/measured/verified/sustained, Finance validation flag).
- **E13 Audience landing views** via `services/dashboardData.js` definitions.
- **E14 Pilot & UAT pack** (D-05).
- **E15 Runtime/audit polish** — auditor period freeze, roadmap tool folding (G3.5).
