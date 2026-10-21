# 04 — Canonical commitment: domain model, lifecycle, API, migration (2027 Goal 02)

Status: vertical slice on `main`, behind `commitments_enabled` (default `'0'`). Nothing here is
"deployed" or "accepted" until the deploy marker and the Committee say so (see 00-CURRENT-STATE).

## 1. Why

Meetings, incubation, inspections, report follow-ups, SDP tickets/changes and the portfolio each keep
their own action list. The Site Actions hub reads them; it does not answer "was the business need
actually met, and who confirmed it?". A **commitment** is that answer: one record per thing the
business is owed, linked to every source that contributes to it, closed only by an independent
reviewer with evidence. Source systems stay the owners of their own records — SDP360 never edits them.

## 2. Entities (ERD)

```
commitments 1───* commitment_source_links   (source_system, source_id, relation)  UNIQUE(commitment_id, source_system, source_id)
     │  1───* commitment_events          append-only: at, actor, action, from_status, to_status, details
     │  1───* evidence_items             file_ref (blobStore) | url, sha256, size, mime, version, superseded_by, retention_class
     └  1───* closure_verifications      attempt, reviewer, decision accepted|rejected_for_rework|residual_risk_accepted, reason
```

| Table | Key columns |
|---|---|
| `commitments` | `uid` (UUID), `kind` (business_need · inspection_finding · control_weakness · operational_risk · issue · corrective_action · improvement · decision), `title`, `site_id` (canonical `sites.id`), `department`, `process`, `impact_dimension`, `priority`, `severity` (low…critical), `accountable_owner`, `execution_owners` (JSON list), `reviewer`, `due_date`, `baseline_due_date`, `exception_approved_by/at/reason`, `treatment_plan`, `status`, `technical_completed_at`, `verified_at/by`, `version`, `created_by/at`, `updated_at` |

Source keys: `meetings:<md_actions.id>`, `meetings:issue:<md_issues.id>`, `inspection:<insp_actions.id>`,
`report:<action_items.uid>`, `sdp_ticket:<display id>`, `sdp_change:<id>`, `governance:<ref>`, `portfolio:<key>`.

## 3. Lifecycle (services/commitmentLifecycle.js — the only place a status changes)

| From | To | Who | Reason |
|---|---|---|---|
| captured | triaged · committed | site editor / admin (severity rule) | — |
| captured · triaged · committed · in_progress · blocked · deferred | cancelled_with_reason | site editor | required |
| triaged | committed · deferred | site editor | deferred: required |
| committed | in_progress · blocked · deferred | site editor | blocked/deferred: required |
| in_progress | awaiting_verification (= technical completion) · blocked · deferred | site editor | — |
| blocked | in_progress · committed | site editor | — |
| deferred | triaged · committed | site editor | — |
| awaiting_verification | verified_closed · rejected_for_rework · accepted_risk_exception | **reviewer** | reject / accept-risk: required |
| rejected_for_rework | in_progress · awaiting_verification | site editor | — |
| reopened | triaged · committed · in_progress | site editor | — |
| verified_closed · accepted_risk_exception | reopened | **reviewer** | required |
| cancelled_with_reason | reopened | admin tier | required |

- **Reviewer** = the user named in `reviewer`, or the admin tier — and NEVER the accountable owner, an
  execution owner or the creator (super_admin included).
- **Severity rule**: `high`/`critical` cannot leave `captured`, nor enter `committed`, without an owner,
  a due date (or an exception approved by the admin tier, not by the owner/creator) and a treatment plan.
- Technical completion stamps `technical_completed_at`; only `verified_closed` stamps `verified_at`.
- A source's closed status only ever *suggests* `awaiting_verification` (`sourceStatusSuggestion`).
- Every write bumps `version`; a writer holding an older version gets **409**.

## 4. API (routes/commitments.js, all `requireReportSession`, flag off → 404)

| Method · path | Rule |
|---|---|
| `GET /api/commitments?status=&kind=&site=` | admin tier: all · others: own sites + where named reviewer/owner · site-less: nothing |
| `GET /api/commitments/metrics?site=` | draft metrics; another site → 403 |
| `GET /api/commitments/:id` | out of scope → 404; includes `allowed` transitions |
| `POST /api/commitments` | editor of `site_id` / admin; idempotent on `source {system,id}` (200 + `created:false`) |
| `PUT /api/commitments/:id` | editor; `version` required; due-date change needs `reason` |
| `POST /api/commitments/:id/transition` | `{to, version, reason}` — table above |
| `POST /api/commitments/:id/exception` | admin tier, not the owner/creator |
| `POST·DELETE /api/commitments/:id/links` | editor |
| `POST /api/commitments/:id/evidence` | raw body (Content-Type = mime, X-Filename) or JSON `{url}` (https); editor, owner, executor or reviewer; 415 on a refused type or a body that does not match it, 413 over 10 MB |
| `GET /api/commitments/:id/evidence/:eid` | download, `X-Content-SHA256` |

Site Actions hub: with the flag on, rows linked to a commitment carry `commitment {id, status, awaiting_verification}`.

## 5. Metrics (draft — pending Committee, D-04)

`commitments.verified_on_time_pct` = verified_closed with verified date ≤ due date ÷ verified_closed with a due date.
`commitments.technical_vs_verified` = verified_closed ÷ commitments with `technical_completed_at`. Empty denominator → `null` (UNKNOWN).

## 6. Migration, backfill and rollback

1. Deploy: `021_commitments.sql` is applied by `db/migrate.js` (pg) / `SQLITE_DDL` (sqlite). Additive; no existing table altered.
2. Dry-run: `node tools/pg/commitments-backfill.js` → JSON report (proposals, per-site counts, duplicates, skipped). Nothing is written.
3. Review the report with the site leads; then `node tools/pg/commitments-backfill.js --apply` (idempotent; creates `captured` commitments only).
4. Enable: set `commitments_enabled = '1'`.

Rollback: set `commitments_enabled = '0'` → behaviour identical to before (routes 404, no hub field). To remove the data,
dump first, then run `db/postgres_rollback/021_commitments_drop.sql` by hand and delete its `schema_migrations` row. Source
records are never modified, so nothing else needs restoring.

## 7. Not done in this slice

Department-level RBAC (D-14), retention purge, A15 escalation, governance-cockpit agenda integration, writing a commitment
status back to SDP (CAB), and wiring the draft metrics into `/api/metrics` resolution (the reader exists; the metrics
endpoint does not inject a commitment store yet).
