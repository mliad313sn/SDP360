# P11 seat ux-field — ROUND 9 (re-check) findings

**AI review — not an independent human review.** Seat: UX / field (role journeys, French, accessibility, design budget,
offline field app, home queue). Frozen SHA `928ca8f03c0680acfb2b3eb0c871ba286934c8dd` (clone `/home/user/qual/ux-field`,
`git log -1` = `928ca8f0`; the tree differs only by the removed `docs/agent-execution/` narratives, which were not read).
Earlier round files (`r8-` … `ux-field.md`) read, not modified. No product file modified. Nothing pushed, merged or tagged.
No human decision filled. Every test run used `SDP_TEST_RUN_ID=uxfieldr9`; test databases come from `tests/_pg-boot.mjs`
or the e2e fixture (one per file, dropped at exit; none named `uxfieldr9` left afterwards); `tools/test/drop-test-dbs.js`
not run. PostgreSQL was down at start and was started with `service postgresql start` before any test.

Throwaway files (none committed, copies kept in `/home/user/qual/out/`):
- `r9-ux-field-attack.test.js` (+ log `r9-ux-field-attack.log`, first line = SHA, 19/19 run, the tests only print):
  the round-6/7/8 repros re-run unchanged, plus R9-N1…R9-N8. Run from `/tmp/claude-0/p11attack-r9/uxf/tests/`.
- `r9-ux-field-fleet.test.js` (R9-N8b, group user on `/api/site-awareness/fleet`).
- `r9-ux-field-flushqueue.spec.js` (+ log `r9-ux-field-flushqueue.log`): a real-browser journey on `inspection.html`
  built on the repository's e2e harness (throwaway database, Chromium, outbound blocked).

Fixes reviewed for this seat: fix 35 (`1c570b05`, merged `c37c59c6`: F-29, F-30, F-31) and the soft-delete filter on the
version reader (`bcc729eb`). Fixes 34 and 36 touch no file in my area except `public/lib/ppmGovernanceW3.js` labels
(covered by F-31) — not reviewed further here.

## 0. Round-8 findings: were the fixes made?

| R8 finding | Repro at 928ca8f0 | Verdict |
|---|---|---|
| **F-29 (P2)** stale editor's save deletes another editor's actions + history | **R8-N1** unchanged: stale editor 1 now gets **409**, editor 2's two actions and the register comment stay (`hist NEW2 [{"action_id":14,"body":"comment on NEW2"}]`). **R9-N1** (current form shape: GET carries `server_version` + `known_action_ids`): 409 `reason:"inspection_changed"` with the current version, row, `state_json` and `updated_at` unchanged. **R9-N4** three parallel saves from one base version → `[200,409,409]` (row lock works). **R8-N4** stale id-aware tab → 409. **R9-N6** a phone close does not make the form stale (save 200, close kept, `kept_server_value:[31]`); a save onto a soft-deleted inspection → 409 "was deleted". Unit checks `p11-r8-field-fixes(.smoke)` pass | **FIXED** for the current form. Residuals: R9-N2 / R9-N3 (clients without `server_version`, transition only, P3 **F-33**) and a regression on the offline-queue path (**F-32**, below) |
| **F-30 (P3)** (a) Sync now did not resend parked entries; (b) DB outage answered 401 | (b) **R8-N5**: `validateSession` throwing `ECONNREFUSED` → **503 `database_unavailable`**, pool busy → 503 `database_busy` + Retry-After 5. **R9-N7**: `ECONNREFUSED`, `57P01`, "Connection terminated unexpectedly", `53300` → 503 `database_unavailable` Retry-After 5 on the field outbox, field bootstrap, inspection list, home queue and site-awareness fleet; a plain error still 401 (correct). Phone text "You are still signed in" EN/FR present. (a) `public/field/app.js`: the Sync button calls `flush({force:true, rearm:true})`; `rearmEntry` resets `server_error` → `failed`, attempts 0. Static read: re-arm is in memory, persisted only when that entry is sent; if a busy answer stops the round the later entries stay parked and the next Sync now re-arms them again — no loss | **FIXED** |
| **F-31 (P3)** hard-coded "5" in the helpdesk rule; insufficient cell unmarked; W3 cards no FR | **R9-N8b**: `/api/site-awareness/fleet` (executive) returns `helpdesk_min_closed: 5` = `kpiRag` policy value; `hdTip()` substitutes it, unknown → "N (the proposed minimum)", never a made-up number. Insufficient cell now carries "too few closed tickets to judge" (EN/FR). Project summary cards have FR entries (`project.fr.js`, test passes) | **FIXED** |
| F-3 residual (IndexedDB after expiry without logout) | no change | open, P3 |
| F-5 ops step (legacy inspection-action rows) | no change | human prod ops step still owed |
| F-12 Policy Center FR content | no change | P3, human glossary owner (D-2) |

Regression checks: R6-N1, R6-N2, R7-N1, R7-N4, R8-R7N1-newform, R8-N2, R8-N3 behave as in round 8. R7-N2b (round-7 design
note: a stale tab's deliberate status change silently won) now answers **409** — improved by fix 35.

## 1. Evidence re-run (round 9)

| # | Command | Result | SHA | Status |
|---|---|---|---|---|
| E1 | `SDP_TEST_RUN_ID=uxfieldr9 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PG_ADMIN_URL=… E2E_ARTIFACT_DIR=/tmp/claude-0/r9uxf-e2e-art npm run test:e2e -- --runs=1`, log `/home/user/qual/out/r9-ux-field-e2e.log` (first line = SHA) | **43/43** journeys pass, 0 fail, 0 skipped; browser unit tests **8/8** (SW stores no `/api/` answer, French review step, quota error, 360 px prefill). `[e2e] GREEN`, `EXIT=0` | 928ca8f0 | **verified** |
| E2 | Prescribed NODE_OPTIONS, `node --test --test-force-exit --test-concurrency=4` on the 25 assigned non-browser files (`i18n-coverage`, `ui-design-ratchet`, `a11y-legacy-ratchet`, `a11y-static`, 16 `field-*`, 5 `home-queue*`); log `/home/user/qual/out/r9-ux-field-units.log` | **211/211** pass, 0 fail, 0 skipped, EXIT=0 | 928ca8f0 | **verified** |
| E3 (fix checks, outside the assigned globs) | `p11-r8-field-fixes`, `p11-r8-field-fixes.smoke`, `p11-r7-field-fixes`, `p11-r7-field-fixes.smoke`; log `/home/user/qual/out/r9-ux-field-fixchecks.log` | 21/21 pass, EXIT=0 | 928ca8f0 | verified (supports §0 only) |

Verified: **2 of 2** assigned evidence items (+ E3). Not verified: **0**. Note: no fix-35 test landed in the assigned globs;
the new concurrency tests live in `p11-r8-field-fixes*` (E3) and none of them covers `flushQueue` (see F-32).

## 2. New break attempts (round 9 — one per capability, preferring code changed by fixes 34–36)

| Capability | Claim | Attack | Outcome |
|---|---|---|---|
| Inspection form concurrency (fix 35, F-29) | "409 inspection_changed = someone else saved since this form loaded" | **R9-flushqueue** (real browser, `inspection.html`): user's Save now #1 fails once (network abort) → the form's own immediate `flushQueue()` retry stores the edit (server version moves) but the form keeps its old `server_version`; user edits again and clicks Save now #2 | Save #2 → **409**, dialog "Someone else saved this inspection after you opened it. Your changes were NOT sent." and status "⚠ Not saved: changed by someone else" — **nobody else saved**. Log: `saves ["aborted",200,409]`, `form version UNCHANGED (old)`, `server f_obs edit 1`. Server-side twin R9-N5 (`200` then `409` with the version the form still holds). → **F-32 (P2)** |
| Same — version bypass | "unseen actions never deleted" | **R9-N2** client with neither `server_version` nor `known_action_ids` (a tab opened before the deploy) ; **R9-N3** old local draft without `server_version` (form derives known ids) | R9-N2: 200, editor 2's action **and its comment deleted**, editor 2's `f_obs` lost (old behaviour, transition only). R9-N3: actions protected (`kept_rows`), but editor 2's meta edit overwritten (whole-inspection last-write-wins without a version). → **F-33 (P3)** |
| Same — race / soft delete | one winner under concurrency | R9-N4 (3 parallel saves), R9-N6 (soft-deleted target) | Holds: `[200,409,409]`; deleted → 409 |
| Reapply flow (fix 35) | "reapply only what the user changed, never drops a server action" | code read of `reapplyLocalEdits` + `handleInspectionConflict` | Holds for the base_fp case (`base_status` travels with the local row, so an untouched stale status still keeps a phone close). Notes: without `base_fp` (pre-fix draft) every local field overrides the server's (part of F-33); an action deleted by the other editor and edited here is dropped without notice; the conflict backup (`<id>__conflict_backup` in the draft store) has no UI to restore it and is never cleaned (P3 note, in F-33) |
| Field phone DB outage (fix 35, F-30) | never "Session expired" during a DB outage | R9-N7 (four error shapes × five routes) | Holds (table §0) |
| Field Sync now re-arm (F-30a) | Sync now resends parked entries | static read | Holds (§0) |
| Site awareness rule (F-31) | visible rule quotes the policy minimum | R9-N8b | Holds (`helpdesk_min_closed: 5`) |
| SW / design budget / a11y / i18n / home queue | ratchets green, `/api/` never cached | E1, E2 | Holds (43/43 + 8/8, 211/211) |

## 3. Findings (round 9)

**P0: 0 · P1: 0 · P2: F-32 · P3: F-33, plus F-3 / F-5 / F-12 carried over.**

### F-32 — P2 (regression from fix 35): the user's own queued save makes their next Save now a false "changed by someone else" conflict
- **Where:** `public/inspection.html` `flushQueue()` (≈ line 3980): on a successful `postSave(draft)` it only `dequeue(id)`s — it does not write `out.version` / `known_action_ids` / `base_fp` back into the draft (or into `state` when `id === currentId`). `forceSyncNow()` refreshes them, but its failure branch `enqueue(id)` and then `await flushQueue()` retries immediately; the boot `flushQueue()` drains queued drafts the same way.
- **Reproduction:** `/home/user/qual/out/r9-ux-field-flushqueue.spec.js` (run: `cd /home/user/qual/ux-field && SDP_TEST_RUN_ID=… PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PG_ADMIN_URL=… E2E_ARTIFACT_DIR=/tmp/x node --test --test-force-exit <spec>`). Output: `Save now #1 -> false | saves ["aborted",200] | form version UNCHANGED (old) | server f_obs edit 1` then `Save now #2 -> false | saves ["aborted",200,409] | dialogs ["Someone else saved this inspection after you opened it. Your changes were NOT sent. …"]`.
- **Impact:** a field user on a flaky link (pilot scope, L11) is told someone else changed their inspection when nobody did; every save after a queue drain is refused until they go through reload-and-reapply. No data loss (the drained save is stored; OK reapplies the local edit on top; Cancel keeps the local copy), but the message is false and the "Save now #1" status also says "Server queued" although the server has the data. The same happens after a page reload that drains the queue at boot (draft keeps its old version).
- **Fix:** in `flushQueue`, after a successful save apply the same refresh as `forceSyncNow` (`server_version = out.version`, `known_action_ids` from `action_ids`+`kept_rows`, `base_fp`, stamp action ids) to `state` when current, else to the stored draft (`DRAFTS.put`).
- **Regression test:** the spec above as a journey (fail one save, let the queue drain, save again → expect 200 and no dialog); plus a static/unit check that `flushQueue` writes `server_version` back.
- **Rollback risk:** low (client only, additive).

### F-33 — P3: clients without a version still save last-write-wins
- `_saveInspectionPg` checks the version only when `server_version` is sent. A tab opened before the deploy (R9-N2) still deletes another editor's actions and their history and overwrites their findings/notes; an old local draft (R9-N3) keeps actions safe (derived `known_action_ids`) but overwrites the other editor's meta. Transition-only for tabs (`inspection.html` is no-cache), but offline drafts created before the deploy can live long.
- Reapply notes: without `base_fp` every local value is reapplied over the server's; a local edit to an action the other editor deleted is dropped silently; the `__conflict_backup` copy is not reachable from the UI and never deleted.
- **Pilot rule:** after deploy, ask users to reload open inspection tabs and to Save now any offline draft before others edit the same inspection. Optional fix: refuse (409) a save of an existing inspection with no `server_version` once a transition window has passed, or treat it as "keep every unmatched field/action".

### Carried over
- F-3 residual (IndexedDB after expiry without logout): P3. F-5: human prod ops step. F-12 Policy Center FR content: P3, human owner (D-2).

## 4. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | AI panel recommendation, not a decision |
|---|---|
| L01 Daily work journey (landing, home queue, nav, `ui_i18n_pages`) | **GO PILOT** (English journey; E1/E2). **CONDITIONAL** with `ui_i18n_pages=1` pending French glossary validation by a French-speaking coordinator (D-2) |
| L11 Site operations evidence + always-on field outbox | **CONDITIONAL**: F-29/F-30 fixed and re-proven, but F-32 shows a false conflict to field users after any flaky save — fix before the field pilot or brief pilot users ("after a failed save, reload the inspection before saving again; the 'someone else saved' message after your own retry is a known defect"). Plus the F-33 transition rule. F-5 legacy check still to run in prod. Field UAT (A2-01…A2-07) unsigned |
| L13 Operations resilience (Policy Center UX) | **CONDITIONAL**: usable, bilingual notes; French catalogue content still missing (human) |
| L14 Portfolio register / intake / data quality | UX side **GO PILOT**; PMO review of PROPOSED reference lists still required |
| L15 Adoption Lot B | **GO PILOT** (landing / freshness / group card; helpdesk rule now quotes the policy minimum). Helpdesk site-filter release note still to be announced by a human |
| L08 Governance | UX side **GO PILOT**; functional/security not reviewed by this seat |
| L16 Portfolio phase 2 | UX floor and FR parity hold (W3 cards now translated); functional behaviour not reviewed by this seat |
| L02–L07, L09, L10, L12 | not reviewed by this seat |

## 5. Human gates still empty in my area (`docs/sdp360/completion/RELEASE-GATES.md` at 928ca8f0 — every decision cell blank)
- Pilot sites D-05 and field UAT (G-16/G-35): Sponsor + Group IT.
- Product — business acceptance: Sponsor / PO.
- Business witness project (E-B05): PMO.
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05): QA lead.
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08): Information Security.
- Dashboard and tracker reviewers (G-23/G-24, DEC-6.x): Committee.
- KPI definitions and thresholds (G-12) — incl. PROPOSED `helpdesk-fleet-sla` bands and `min_closed: 5` shown on site awareness: KPI Committee.
- Production deployment GO/NO-GO: CAB.
- Not RELEASE-GATES rows but still owed by a human: French glossary validation (D-2; Policy Center FR content), PMO review of L14 reference lists, the F-5 legacy-row check in prod, announcing the Helpdesk site-filter change (HD-O15), signing the `RECETTE-UAT.md` rows (all blank; this seat filled nothing).

*AI review — not an independent human review.*
