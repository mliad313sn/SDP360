# P11 seat ux-field — ROUND 6 (confirmation) findings

**AI review — not an independent human review.** Seat: UX / field (role journeys, French, accessibility, design budget,
offline field app, home queue). Frozen SHA `e82d95baf7fa4b554003d32f89e02d634216c1de` (clone `/home/user/qual/ux-field`;
`git log -1` = `e82d95ba` before and after; the tree differs only by the removed `docs/agent-execution/` narratives, which
were not read). Earlier round files (`r5-`, `r4-`, `r3-`, `r2-ux-field.md`, `ux-field.md`) read, not modified. No product
file modified. Nothing pushed, merged or tagged. No human decision filled. All test runs used `SDP_TEST_RUN_ID=ux-field-r6`;
test databases came from `tests/_pg-boot.mjs` (one per file, dropped at exit); `tools/test/drop-test-dbs.js` not run.

Throwaway files (none committed):
- `/home/user/qual/out/r6-ux-field-attack.test.js` (+ log `r6-ux-field-attack.log`): R6-N1, R6-N2. Ran from `/tmp/claude-0/p11attack-r6/uxf/tests/`.
- `/home/user/qual/out/r6-ux-field-r5rerun.log`: round-5 repro `r5-ux-field-attack.test.js` (R5-N1) re-run unchanged at e82d95ba.
- `/tmp/claude-0/p11attack-r6/uxf/hsd2.js`, `hg.js`: F-16 / F-17 re-checks (plus `node /home/user/qual/out/r5-ux-field-hsd.js` unchanged).

Fixes reviewed for this seat: fix 23 `e6a6c07c` (F-15…F-20). Also read for regressions in my area: fix 21 `f20d0129`
(field inspection-id generic refusal) and fix 22 `51b71b47` (503 `database_busy`, auth.js keeps the session).

## 0. Round-5 findings: were the fixes made?

| R5 finding | Repro at e82d95ba | Verdict |
|---|---|---|
| **F-15 (P1)** inspection-form save re-creates every action, deletes its history, voids a queued phone close | R5-N1 re-run unchanged: `bootstrap id 1 \| after resave ids [[1,"Open"]] \| audit rows before 1 after {"n":1} \| phone close 200 {"action_id":1,"status":"Closed"}` (round 5: id 1→2, history 1→0, phone 403). New `field-r5-inspection-action-upsert.smoke` passes | **FIXED** (see new R6-N1 / R6-N2: two residual edge cases in the new merge, P2/P3) |
| **F-16 (P2)** Helpdesk own-site default drops other spellings | `r5-ux-field-hsd.js`: every documented site, 0 missed. Inline pairs: `['OUAGADOUGOU','Ouaga']` → `Ouaga` (filter covers both); `['LAFIGUE - SML','Lafigue']` → `Lafigue`; `['HGO','Hounde Mine']` → no default, All Sites kept, note listing both spellings. `helpdesk-site-default-r5` passes | **FIXED.** Residual P3 notes in §3 (F-21) |
| **F-17 (P3)** Home group card "no late project" on undated portfolio | `hg.js`: all open undated → "— non mesuré : aucune date de fin saisie (2)"; some undated → "aucun projet en retard (1 sans date de fin — non mesuré(s))"; all done / empty → "aucun projet en retard" (correct, measured). EN equivalent. `home-group-late-undated-r5` passes | **FIXED** |
| **F-18 (P3)** portfolio pages not in a11y floor; "OK" button / EN fallback labels | `tests/a11y-static.test.js` NEW_PAGES now lists `portfolio-register.html`, `portfolio-decisions.html`, `portfolio-phase2.html` (passes, E2). Button = `T.apply` ("Apply filters" / "Appliquer les filtres"); fallback labels have FR | **FIXED** |
| **F-19 (P3/P2 cond.)** reviewer assigned by raw user id; no confirm on checklist | `ppmReview.js` renders a `<select>` of eligible accounts (name + role) from `candidates` (same `selfApprovalRefusal` rule as the assign route, `routes/governanceReview.js:40-48` vs `:75`); empty choice is a no-op; `confirm()` before apply-template. `portfolio-lot5.smoke` passes | **FIXED** (raw id input only if the list is absent) |
| **F-20 (P3)** UAT rows not executable; no row for F-15 | `RECETTE-UAT.md` A2-05/A2-06 rewritten as observable checks; **A2-07** added (re-save during a queued close → same id, comment kept, close applies or conflicts, never "out of scope") | **FIXED** (rows still unsigned — human) |
| F-3 residual (IndexedDB copies after session expiry without logout) | no commit; not re-tested | open, P3 |
| F-5 ops step (legacy `demand`/`helpdesk_ticket` inspection-action rows) | no change | human ops step still owed |
| F-12 Policy Center FR content (0/331 `description_fr`) | no change | P3, human glossary owner (D-2) |

## 1. Evidence re-run (round 6)

| # | Command | Result | SHA | Status |
|---|---|---|---|---|
| E1 | `SDP_TEST_RUN_ID=ux-field-r6 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PG_ADMIN_URL=… E2E_ARTIFACT_DIR=/tmp/claude-0/r6uxf-e2e-art npm run test:e2e -- --runs=1`, log `/home/user/qual/out/r6-ux-field-e2e.log` (first line = SHA) | **43/43** journeys pass, 0 fail, 0 skipped; browser unit tests **8/8** (incl. SW stores no `/api/` answer, French refusal dialog, quota error, review step). `[e2e] GREEN`, `EXIT=0`. Ran 22:35–22:56 UTC 2026-11-20 | e82d95ba | **verified** |
| E2 | Prescribed NODE_OPTIONS, `node --test --test-force-exit --test-concurrency=4` on 23 files: `i18n-coverage`, `ui-design-ratchet`, `a11y-legacy-ratchet`, `a11y-static`, the 14 non-browser `field-*` (incl. new `field-r5-inspection-action-upsert.smoke`) and the 5 `home-queue*`. The 5 `field-*-browser` files run inside E1. Log `/home/user/qual/out/r6-ux-field-units.log` (first line = SHA) | **204/204** pass, 0 fail, 0 skipped, EXIT=0 | e82d95ba | **verified** |
| E3 (fix checks, outside the assigned globs) | `helpdesk-site-default-r5`, `home-group-late-undated-r5`, `portfolio-lot5.smoke`, `adoption-lota-nav-authz`, `i18n-lota-runtime` | 28/28 pass | e82d95ba | verified (supports §0 only) |

Verified: **2 of 2** assigned evidence items. Not verified: **0**.

## 2. New break attempts (round 6 — one per capability, preferring code changed by fixes 19–24)

| Capability | Claim | Attack | Outcome |
|---|---|---|---|
| Inspection actions upsert (fix 23, F-15) | "three-way merge keeps a register/phone status the form did not change; a stale tab never reverts a close" | **R6-N1**: phone closes action 1. Editor opens the inspection (`GET /api/inspection/:id` overlays `Closed` into the form), deliberately sets it back to `Open`, saves | Save answers **200**, stored stays **Closed**, reload shows Closed. The merge base is the stored *form state* (`prevActions[r.ord]`), which the phone close never updated (`Open`), so a deliberate reopen equal to that stale base is read as "unchanged" and dropped silently. A **second** identical save then works (the first save rewrote the base to `Closed`). Same logic applies to `owner`. → **F-22 (P2)** |
| Same, id-less fallback | "match id, else ord+text, then text" (old local copies / offline-queued saves without ids) | **R6-N2**: two actions with the same text "Check UPS" (Alice id 2, Bob id 3); comment on Bob's (id 3); an id-less save keeps only Bob's row | Matched by ord 0 + text → **Alice's row id 2 survives with Bob's values; Bob's row id 3 is deleted with its comment** (`insp_action_updates` for ids 2,3: `[]`). Requires id-less payload + duplicate text (transitional: browser copies from before the fix, field replays strip ids). → **F-23 (P3)** |
| Field outbox under DB stall (fix 22, N-12) | "a DB_BUSY lookup answers 503 database_busy, never 401/500; nothing logs out" | Static review of `public/field/app.js:230-246` against `services/httpError.js:21` (not executed) | 503 without `offline` → entry `failed`, retried at next sync (`:169`) — no loss, no logout. But `last_error = j.error` = raw code **`database_busy`** shown on the phone line (`:123`) in EN and FR; `reasonText` has no case for it. → **F-24 (P3)** |
| Field inspection id refusal (fix 21) | "a foreign or unused non-field id gets one identical refusal; legacy queued ids can be re-keyed" | Read `routes/field.js:166-182` + `public/field/app.js:181,306,443` | Holds: one generic 409 `inspection_exists`; the phone's "copy as new" re-keys with `fieldInspectionId` (matches `FIELD_INSPECTION_ID`). The phone text for this reason still says "already exists on the server" even for an unused legacy id — wording only, not a finding |
| Helpdesk own-site default (fix 23, F-16) | "picks a spelling covering every same-site spelling, else All Sites + note" | Constructed lists where the shortest covering spelling is a substring of ANOTHER site's spelling (`['MANA','MANAGEMENT']`, `['ITY','CITY OFFICE']`) | Picks `MANA` / `ITY`; the page's upper-case substring filter then also includes `MANAGEMENT` / `CITY OFFICE` (over-inclusion). Not present in today's documented spellings. The "why All Sites" note is set only as the select's `title` tooltip — not visible on touch or to most keyboard/screen-reader users. → **F-21 (P3)** |
| Reviewer picker (fix 23, F-19) | "committee picks from eligible accounts" | Compared `reviewerCandidates` with the assign route | Same rule, so the picker cannot offer someone the route refuses. Lists every active account incl. viewers / field techs (up to 500, no search). Approver independence (fix 21, `approverProvenance`) is not applied to the list; it is enforced at decision time (`reviewStore.js:47`). Usability note only |
| Home group card (fix 23, F-17) | "undated = not measured" | Missing `status`, all-done, empty gantt (`hg.js`) | Holds |
| Service worker, design budget, i18n, a11y ratchets, home queue | ratchets green, `/api/` never cached | E1 (browser units), E2 | Holds (see E1/E2) |

## 3. Findings (round 6)

**P0: 0 · P1: 0 · P2: 1 (F-22) · P3: F-21, F-23, F-24, plus F-3 / F-5 / F-12 carried over.**

### F-22 — P2: an editor's deliberate reopen (or owner change) in the inspection form of an action closed from a phone or the register is silently dropped on the first save
- **Where:** `inspection-db.js` `_upsertActionsPg`, the three-way lines
  `if (base && _actNorm(base.status || 'Open') === _actNorm(st) && _actNorm(r.status) !== _actNorm(st)) st = r.status || st;` (same for `owner`).
  `base` = the form state stored at the last form save; a phone/register close changes `insp_actions` but not `state_json`. Meanwhile `_getInspectionPg` overlays the stored status into the form, so the editor sees `Closed`.
- **Reproduction:** `R6-N1` in `/home/user/qual/out/r6-ux-field-attack.test.js` (run with the prescribed NODE_OPTIONS from a tests directory). Output:
  `phone close 200 Closed | form sees [[1,"Closed","Tech"]] | reopen save 200 | stored … "status":"Closed" | form after reload [[1,"Closed"]] | 2nd reopen save 200 | stored … "status":"Open"`.
- **Impact:** an editor's edit is lost with a 200 and no message; the form keeps showing `Open` until reload. Not data loss of evidence, not a wrong number, but a silent discard of a human action on a live path. Low frequency (reopen from the form of a phone-closed action).
- **Fix:** take the base from the stored row status at read time (send `base_status`/`base_owner` per action with the form, or update `state_json` when the field/register route changes an action), or answer 409 "changed meanwhile" instead of silently keeping the stored value.
- **Regression test:** extend `field-r5-inspection-action-upsert.smoke` with: phone close → read → set Open → save → assert stored `Open` (or a typed 409).
- **Rollback risk:** low–medium (merge logic only; pg-only path).

### F-21 — P3: Helpdesk default — note is tooltip-only; possible over-inclusion
- `public/lib/helpdeskSiteDefault.js`: show the "several spellings" note as visible text (e.g. a `role=status` line under the selector), not only `selectEl.title`. Over-inclusion when the chosen spelling is a substring of another site's spelling (`MANA` ⊂ `MANAGEMENT`) — theoretical today; a fold-key filter in `index.html:699/1015/1132` would remove both risks. Switch `ui_helpdesk_site_default` is off by default.

### F-23 — P3: id-less fallback can attach the wrong row when action texts repeat
- `_upsertActionsPg` matches ord+text first. With duplicate texts and an id-less payload, a removed action's row survives under another's values and the kept action's history is deleted (R6-N2). Transitional (old local copies, field replays). Fix: when a text is ambiguous (≥2 stored rows), match ord+text+owner/due, or refuse the id-less save with a 409 asking to reload.

### F-24 — P3: field phone shows raw `database_busy`
- `public/field/app.js:240` stores `j.error` as `last_error`; add a `database_busy` (and generic 5xx) case to `reasonText`/`refusalText` with EN/FR text ("server busy — will retry automatically"). Static finding, not executed.

### Carried over
- F-3 residual (IndexedDB after expiry without logout): P3. F-5: human prod ops step. F-12 Policy Center FR content: P3, human owner (D-2).

## 4. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | AI panel recommendation, not a decision |
|---|---|
| L01 Daily work journey (landing, home queue, nav, `ui_i18n_pages`) | **GO PILOT** (English journey; E1/E2). **CONDITIONAL** with `ui_i18n_pages=1` pending French glossary validation by a French-speaking coordinator (D-2) |
| L11 Site operations evidence + always-on field outbox | **GO PILOT** on the round-5 blocker (F-15 fixed and re-proven). Pilot rule until F-22 is fixed: a reopen of a phone-closed action is done in the actions register, not the inspection form (or saved twice). F-5 legacy check still to run in prod. Field UAT (A2-01…A2-07) unsigned |
| L13 Operations resilience (Policy Center UX) | **CONDITIONAL**: usable; French catalogue content still missing (human) |
| L14 Portfolio register / intake / data quality | UX side **GO PILOT** (F-18 fixed). PMO review of PROPOSED reference lists still required |
| L15 Adoption Lot B | **GO PILOT** for landing / freshness / group card (F-17 fixed). `ui_helpdesk_site_default`: **CONDITIONAL** — under-inclusion fixed; verify per-site spellings at activation (F-21) |
| L08 Governance (Lot 5 review workflow) | UX side **GO PILOT** for `ppm_review_workflow_enabled` (F-19 fixed); functional/security not reviewed by this seat |
| L16 Portfolio phase 2 | UX floor pinned (a11y-static) and FR parity hold; functional behaviour not reviewed by this seat |
| L02–L07, L09, L10, L12 | not reviewed by this seat |

## 5. Human gates still empty in my area (`docs/sdp360/completion/RELEASE-GATES.md` at e82d95ba — every decision cell blank)
- Pilot sites D-05 and field UAT (G-16/G-35): Sponsor + Group IT (covers A2-07 / F-22).
- Product — business acceptance: Sponsor / PO.
- Business witness project (E-B05): PMO.
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05): QA lead.
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08): Information Security.
- Dashboard and tracker reviewers (G-23/G-24, DEC-6.x): Committee.
- Production deployment GO/NO-GO: CAB.
- Not RELEASE-GATES rows but still owed by a human: French glossary validation (D-2; Policy Center FR content), PMO review of L14 reference lists, the F-5 legacy-row check in prod, signing the `RECETTE-UAT.md` rows (all blank; this seat filled nothing).

*AI review — not an independent human review.*
