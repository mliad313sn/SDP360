# P11 fix 9 — NEW-1 (residual of AUD-1): commitment four-eyes over the whole history

Source: `/home/user/qual/out/r2-audit.md` NEW-1 (P1). AI engineering fix; not an approval of D-04 / G07.

## Cause
Round-1 fix (`824b869`) excluded the people recorded in the **submission snapshot** (taken when the work reaches
`awaiting_verification`) and refused re-pointing the reviewer only when a submission existed. An owner who, BEFORE
submission, moved `accountable_owner` to someone else and `reviewer` to themselves was in no snapshot: the executor
submitted normally and the former owner closed it (`CLOSED by it.owner`, reproduced on PostgreSQL).

## Fix (ships ON; behind the dark switch `commitments_enabled` like the whole module)
- `services/commitmentStore.js` `historyOf(c)`: from the append-only `commitment_events`, every identity that has
  EVER been owner / executor (current values + `changes.{from,to}` of every update), creator (row + `created`
  event actor + snapshot) or submitter (actor of every `→ awaiting_verification` + snapshot). An older update
  event that lists `accountable_owner` / `execution_owners` in `fields` without `changes` counts its **actor** as a
  past owner / executor. Attached to every read as `c.history`.
- `services/commitmentLifecycle.js` `isSelf`: also true for anyone in `c.history` → verify / reject /
  accept-risk refused (403) for them, admin tier included; deputies inherit it (principals recursion unchanged).
- `update()`: setting `reviewer` to anyone in that set (or an owner/executor named by the same patch) is refused
  with 403 **at any status** (previously only once a submission existed).
- Unchanged: transitions table, other edits, create, the AUD-1 snapshot.

## Tests (failing before, passing after)
- `tests/commitment-store.test.js` — new `pg: NEW-1 …`: the exact sequence (coord.x creates; it.owner commits,
  starts, then `update({accountable_owner:'someone.else', reviewer:'it.owner'})` before submission) → 403; the
  two-step variant (owner moved away, then reviewer=self) → 403; executor / creator as reviewer → 403; it.exec
  submits; former owner (also as admin) cannot verify / reject / accept-risk; submitter cannot verify; an
  independent reviewer closes. Legacy event (fields only, actor `legacy.owner`) → cannot become reviewer nor
  verify; unrelated edits still pass. Red at `42bc79e` ("Missing expected rejection"), green after the fix.
- `tests/commitments-routes.smoke.test.js` — same sequence over `PUT /api/commitments/:id` +
  `/transition`: red without the services change, green with it.
- Round-1 AUD-1 repro (`pg: AUD-1 …`) re-run: green.
- Targeted run: commitment-*, commitments-*, uat-committee, home-queue*, governance-roles*, obligations* →
  98/98 pass, 0 skipped. Full suite NOT re-run (parallel-seat rule).

## Residual
NEW-3 (G07 dossier should cite `tests/commitment-store.test.js` and this residual) is not addressed here.
Identity matching remains string-based (username / name / e-mail / id); a reviewer typed under an alias not
known to the event log is not caught — same limit as before.
