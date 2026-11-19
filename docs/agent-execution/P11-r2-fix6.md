# P11 round 2 — fixes N-01, N-02, N-03, R2-N1 (AI agent, not a human sign-off)

Branch `qual/p11-fix6` from `cfe76f66`. Findings: `/home/user/qual/out/r2-operations.md` (N-01..N-03),
`/home/user/qual/out/r2-security.md` (R2-N1). Every fix is a defect fix and ships ON (no switch).
Each new test was run against the pre-fix code first (failing) and after the fix (passing).

| Finding | Cause | Fix | Test (before → after) |
|---|---|---|---|
| N-01 (P1) requests 1000 → 810 permanent | incremental filter (Last Updated > last sync) never re-inserts rows deleted by a sub-tolerance partial run; CAB had the same gap (filter on requested time) | `zoho-sync.js`: requests and CAB also upsert every live id missing locally (`reports-db.listStoredIds`, same pattern as the survey self-heal). Change rows were already fully upserted each run. | `tests/zoho-sync-truncation-anchor.test.js` "N-01 requests" (1000→810→1000 without force) and "N-01 CAB" (100→85→100): fail → pass |
| N-02 (P2) ratchet 100→81→66… | guard compared each fetch to the CURRENT local count | `services/sync/truncationGuard.js`: baseline = max(stored, anchor); anchor = last count the source confirmed (`nextAnchor`: a lossy run never lowers it; a run that lost nothing count-wise sets it, so a genuine shrink is accepted once two consecutive exports agree). Stored in `sync_truncation_anchors` (migration `db/postgres/sync/113_truncation_anchors.sql`). Wired for requests, change, cab, survey, and the assets views (live deps). An unreadable anchor table falls back to the old stored-only rule (never blocks a sync). | same file: requests ratchet (2nd partial refused, 810 kept), survey repro (66 refused at run 2), assets ratchet (66 refused), genuine shrink accepted after confirmation: fail → pass |
| N-03 (P2) `/ready` 200 on read-only DB | `/ready` only read | `routes/health.js`: one catalogue read `pg_is_in_recovery()` + `transaction_read_only`; read-only or standby → 503 `{ok:false, db:true, writable:false}`. Healthy answer keeps the public shape `{ok, db, last_job_at}`. | `tests/ready-readonly.test.js` (stub + real PG `ALTER DATABASE … SET default_transaction_read_only=on` on the throwaway DB, reset after): 3 fail → pass; `ready-probe.smoke` unchanged green |
| R2-N1 (P2) subscriptions leak other sites / executive pack | `subscribe()` checked nothing; `generateScheduledReports` filtered on `s.site_id`, a column the subscriptions table does not have; publish-time notification notified every subscriber too | `services/reportVisibility.js` = ONE rule (`canReadRun` = the report studio's `visibleRun` read rule: authors any run; others only PUBLISHED runs of their sites or council runs as committee member; `canSubscribeTemplate`: site → account with a site, council → committee member, executive → authors). `POST /api/engagement/subscriptions` (report_template) → 404 unknown / 403 out of audience. Scheduled jobs and `POST …/runs/:id/publish` notify only `readableSubscribers` (current roles + sites, inactive accounts skipped) — pre-existing subscriptions can no longer leak. `routes/reportStudio.js groupRunReadable` delegates to the shared rule. | `tests/report-subscription-scope.smoke.test.js` (3): fail → pass. `tests/jobs-reports-send.test.js` updated: it pinned the leaky behaviour (a site-less subscriber told about every site); now asserts drafts reach authors only, deactivated author skipped, `withheld` counted |

Behaviour change to note (R2-N1): scheduled runs are drafts, so non-author subscribers are no longer told
"… ready for review" — they could never open those runs anyway (visibleRun refuses drafts). They are told at
publish time, for runs they may read. Job result gains `withheld`.

Not done / for humans: the tolerance value (20 %) and the "two consecutive exports confirm a shrink" rule are
engineering defaults, PROPOSED — SRE policy owner to confirm. N-04 (`isNew` string compare) not in scope.
Full suite not re-run (shared PostgreSQL; orchestrator runs it at merge).
