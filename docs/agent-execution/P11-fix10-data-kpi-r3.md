# P11 fix 10 — data-kpi round 3 findings (F-14, N-02r, F-10, F-04, F-03, F-02, F-05)

AI fix work, not an independent review. Branch `qual/p11-fix10`, PostgreSQL 16 test cluster (PG17 not verified).
Every fix ships ON (defect fixes); the only new switch is an opt-in SRE policy that defaults to today's safer rule.

| ID | Cause | Fix | Test (failed before, passes after) |
|---|---|---|---|
| F-14 / N-02r (P2) | `nextAnchor` reset the anchor whenever `fetched ≥ stored`; `stored` had already been lowered by the previous lossy run, so alternating (1000/810/820/660…), grow-by-one (81, 82, 83…) and repeated-cap (81, 81, 66, 66…) exports all ratcheted the table down | `services/sync/truncationGuard.js` `nextAnchorState`: anchor moves up/stays on `fetched ≥ anchor`; a lower count is only recorded as `pending` (+ consecutive count). Lowering = operator `tools/sync/confirm-shrink.js --job=… [--count=N] --apply` (dry run by default), or opt-in PROPOSED SRE policy `SYNC_TRUNCATION_SHRINK_CONFIRMATIONS=N≥2`. Migration `sync/114_truncation_anchor_pending.sql` (additive, idempotent) | `tests/zoho-sync-truncation-anchor.test.js` (17): pure sequences 1000/810/820/660/670/540, 100→…→44, repeated cap, grow-by-one; PG e2e requests (alternating + repeated cap), survey operator confirmation, CLI |
| F-10 (P2) | `compare` returned RECONCILED when nothing was compared; column check read `rows[0]` (skipped with zero rows); `SET TRANSACTION READ ONLY` outside a transaction | verdict `NOT_COMPARABLE` (exit 3) when no readable export row; header-only export exits 3 before any DB read; columns read from the header; SELECT inside `BEGIN READ ONLY` | `tests/kpi-reconcile-source.test.js` (7) |
| F-04 (P2) | `monthOf` read every slashed date day-first | ambiguous `a/b/yyyy` (both ≤ 12, different) → null, counted in `totals.ambiguous_dates`, unless `--date-order=dmy\|mdy` | same file |
| F-03 (P2) | migrator re-executed any applied script whose bytes changed → backfills 039/066 re-ran over user data | changed applied script that writes data is reported and NOT re-executed; DDL-only keeps re-apply contract; markers `-- migrate:rerun-on-change` / `-- migrate:run-once`. `docs/ai-decisions/ADR-P11-F03-migrator-changed-scripts.md`, ETAPE-02 wording updated | `tests/pg-migrate-changed.test.js` (2) |
| F-02 (P2) | server fallback `_tracker()` scored no input as red, empty periods/averages as 0, missing prev as 0 pp; `loadTracker()` unawaited (Promise on PG → always the all-zero default) | missing input not scored, unmeasured site left out, fleet/pillar/avg/delta null, `await` added; `render.py` prints "—" and skips nulls in the trend text | `tests/report-payload-tracker-null.test.js` (4, incl. a real render.py run) |
| F-05 (P2, partial) | missing baseline/dossier read silently as "nothing reviewed" / ENOENT | `unknown-sweep --check` and both tests name the missing file and say it is not a code regression. Re-homing out of `docs/agent-execution/` not done | manual: baseline moved away → exit 1 with the message |

Not done: F-05 re-home + sweep scope (render.py / browser), F-15 (deck outside lineage), P3 items.
Human decisions now unblocked / needed: SRE — whether to arm `SYNC_TRUNCATION_SHRINK_CONFIRMATIONS` (PROPOSED, off)
and who may run `confirm-shrink.js`; data owners — `--date-order` of each export before a reconciliation sheet counts.
Full suite not re-run by this agent (targeted files only).
