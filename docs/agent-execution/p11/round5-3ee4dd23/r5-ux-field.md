# P11 seat ux-field — ROUND 5 findings

**AI review — not an independent human review.** Seat: UX / field (role journeys, French, accessibility, design budget,
offline field app, home queue). Frozen SHA `3ee4dd23cbe661488f3f693a302358fb62eba6a0` (clone `/home/user/qual/ux-field`;
`git rev-parse HEAD` checked before and after the runs; the tree differs only by the removed `docs/agent-execution/`
narratives, which were not read). Earlier round files (`r4-`, `r3-`, `r2-ux-field.md`, `ux-field.md`) were read and not
modified. No product file modified. Nothing pushed, merged or tagged. No human decision filled.

Throwaway files (none committed):
- `/home/user/qual/out/r5-ux-field-attack.test.js` (the copy that ran is in `/tmp/claude-0/p11attack-r5/uxf/tests/`): R5-N1.
- `/home/user/qual/out/r5-ux-field-hsd.js` (+ inline variants): R5-N2, the Helpdesk site default.
- `/tmp/claude-0/p11attack-r5/uxf/tests/r4attack.test.js` and `r3rerun.test.js`: the round-4 and round-3 repros, re-run unchanged at 3ee4dd23.
- Test databases come from `tests/_pg-boot.mjs` (one per file, dropped at exit). `tools/test/drop-test-dbs.js` was not run.

Fix reviewed for this seat: `5b2753aa` "fix(field,ux): P11 r4 F-10/F-11/F-2/F-4/F-12/F-13/F-14", merged as fix 18 (`5cd05654`).
Fixes 14 to 17 touch no file in my area.

## 0. Round-4 findings: were the fixes made?

| R4 finding | Repro at 3ee4dd23 | Verdict |
|---|---|---|
| **F-10 (P3/P2 conditional)**: a field-tech could reopen or move a MEETINGS action from the field route | R4-N1: `resolved→open` → **400** `rejected` (`meetings_action_status`). `open→blocked` → **400**. The stored value stays `resolved`. The web register still answers 403 to the same viewer | **FIXED** |
| **F-11 (P3)**: action ids revealed whether an action exists and which site owns it | R4-N3: another site's inspection id, a missing inspection id, another site's meetings id and a missing meetings id all return **403** `action_unavailable`, "this action does not exist or is not in your scope", with no site code | **FIXED on the field route.** The web routes (`routes/meetings.js:361`, `routes/inspection.js:255`) still say "Action belongs to SGO". They require `editor`, and the round-4 fix scoped itself to the field route. Note only |
| **F-4 (P3, partial)**: refusals without a `reason` reached the phone in English | R3-N4: every refusal now carries a `reason` (`fieldOutbox.REFUSAL_REASONS` + `fallbackReason`). `public/field/app.js` `reasonText()` maps them to EN/FR texts. `field-r4-refusal-reasons` passes | **FIXED** |
| **F-2 residual (P3)**: a status changed through the editor was invisible to old envelopes with no `base_status` | R2-A4 → **409** (`In Progress` kept; it was 200 at e43d11d5). Future or missing `client_ts` → 409 (unchanged) | **FIXED**, but the fix uses `row_changed_at`, which depends on the inspection editor's DELETE + INSERT of actions. That design causes the new **F-15** below |
| **F-12 (P3)**: French gaps behind `ui_i18n_pages` | Every string I listed in round 4 (`No data yet.`, `This cannot be undone.`, `No repeat finding.`, `Verify`, `No actions match the current filter.`, `Excel downloaded`…) is now in the page dictionaries. `i18n-lota-runtime` (10 tests) passes, and `runtimeInSource` is on. Policy Center: still **0 of 331** `description_fr`, left to the human glossary owner on purpose | **PARTIAL**: Lot A FIXED. Policy Center FR still open (human content, P3) |
| **F-13 (P3)**: the nav walk did not cover the Policy Center entry | `adoption-lota-nav-authz`: "all page switches on policy covers every policy-gated menu entry" passes (5/5) | **FIXED** |
| **F-14 (P3)**: intake tab: English warnings, empty read-only fields, orphan label | `ppm-intake-r4-ux` passes (3/3): read-only shows "—", no `<label for>` points at a `<p>`, warnings are shown in French by code | **FIXED** |
| F-3 residual: a previous user's IndexedDB copies stay at rest after the session expires without a logout | No commit addressed it. Not re-tested | open, P3 |
| F-5 ops step: legacy `demand` / `helpdesk_ticket` rows on inspection actions | R2-A5 behaviour on new data still correct (`demand` → 400, `cancelled` → stored `Cancelled`, not overdue, not in the home queue) | Ops step still owed by a human (run `tools/field/inspection-action-status-check.js` in prod) |

## 1. Evidence re-run (round 5)

| # | Command | Result | SHA | Status |
|---|---|---|---|---|
| E1 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PG_ADMIN_URL=… E2E_ARTIFACT_DIR=/tmp/claude-0/r5uxf-e2e-art npm run test:e2e -- --runs=1`. Ran 20:16 to 20:37 UTC 2026-11-20. Log: `/home/user/qual/out/r5-ux-field-e2e.log` | **43/43** journeys pass, 0 fail, 0 skipped. This includes the new `b1-adoption-lotb-landing` journey (round 4 had 42). Browser unit tests **8/8**. `[e2e] GREEN`, `EXIT=0` | 3ee4dd23 | **verified** |
| E2 | Prescribed NODE_OPTIONS, `node --test --test-force-exit --test-concurrency=4` on 22 files: `i18n-coverage`, `ui-design-ratchet`, `a11y-legacy-ratchet`, `a11y-static`, the 13 non-browser `field-*` files (including the new `field-r4-action-rules.smoke` and `field-r4-refusal-reasons`) and the 5 `home-queue*` files. The 5 `field-*-browser` files ran inside E1. Log: `/home/user/qual/out/r5-ux-field-units.log` (first line = SHA) | **196/196** pass, 0 fail, 0 skipped, EXIT=0 | 3ee4dd23 | **verified** |
| E3 (fix check, outside the assigned globs) | `adoption-lota-nav-authz`, `i18n-lota-runtime`, `ppm-intake-r4-ux` | 18/18 pass | 3ee4dd23 | verified (supports §0 only) |

Verified: **2 of 2** assigned evidence items. Not verified: **0**.

## 2. New claims attacked (round 5: one per capability, earlier attacks not repeated)

| Capability | Claim | Attack | Outcome |
|---|---|---|---|
| Field actions vs inspection editor | "a status changed on the server is never overwritten; the phone's work is either applied or refused with a reason" (F-2 fix, `routes/field.js`) | **R5-N1**: an action is listed in the field bootstrap (id 1). The coordinator adds a comment in the register, then changes only the observations and saves the inspection form again (`POST /api/inspection/save`, action unchanged). The phone then sends its queued close with `base_status:'Open'` | The re-save **re-created the action under a new id** (1 → 2, still Open). The **comment trail was deleted** (`insp_action_updates`: 1 row before, 0 rows after, removed by `ON DELETE CASCADE`). The phone's close got a terminal **403 `action_unavailable` "this action does not exist or is not in your scope"**: the technician's close is lost, and the message is misleading. → **F-15** |
| Adoption Lot B: Helpdesk opens on own site (`ui_helpdesk_site_default`) | "the Helpdesk opens on the person's site (shared site-alias fold)" | **R5-N2**: ran `pickOption` against the real ticket spellings listed in the project notes, then against same-site spelling pairs, and compared with the page's filter (`index.html:699`, upper-case substring) | Real spelling list: every site picks an option whose filter covers all its spellings. **Holds today.** It breaks when the sorted first spelling is not a substring of the others: `['OUAGADOUGOU','Ouaga']` picks `OUAGADOUGOU` and drops the `Ouaga` tickets; `['HGO','Hounde Mine']` picks `HGO`; `['LAFIGUE - SML','Lafigue']` picks `LAFIGUE - SML`. The tiles then show a site subtotal without those tickets. → **F-16** |
| Adoption Lot B: Home group card (`ui_home_group_variant`) | "a call that answers nothing usable reads '— not measured', never 0, never green" (`homeGroup.js` header) | Fed `lateProjects` the gantt of a portfolio where no project has an end date | Shows **"aucun projet en retard"** ("no late project"). Late status cannot be measured without an end date, so this is a reassuring verdict on unknown data. Decisions without an overdue count correctly omit the overdue part. → **F-17** |
| Portfolio Lot 3 register (a11y/FR) | "strict-CSP page, EN/FR, sticky header, frozen identity columns, unknown shows —" | Static review of `portfolio-register.html`, `portfolioRegister.js` and the page script. Applied the `a11y-static` floor rules to the 3 new portfolio pages. Checked EN/FR key parity of their tables | **Holds**: `aria-sort` on the sorted header, `scope=col/row`, the scroll region is focusable and labelled, `role=status`, filters drawn once (focus kept), 59/37/37 keys with FR for all. Gap: the three pages are **not in `a11y-static` NEW_PAGES**, so the floor is not pinned for them; they are only declared `SELF_TRANSLATED` in `i18n-coverage`. Small items: the button label "OK" and the English fallback filter labels. → **F-18** (P3) |
| Portfolio Lot 5 review panel | "offers the actions the server allows this user" (`ppmReview.js`) | Read the panel UI | Functional, EN/FR complete. Usability: **assigning a reviewer requires typing a numeric database user id** ("Reviewer user id"). "Apply the proposed review checklist" has no confirmation. → **F-19** (P3; P2 before general deployment of `ppm_review_workflow_enabled`) |
| Business-readiness UAT (field part) | `RECETTE-UAT.md` A2-05 and A2-06 are executable field UAT steps | Compared the steps with what the field app offers | A2-05 (close another site's action) and A2-06 (reopen a resolved meetings action) **cannot be performed through the app**: bootstrap lists only own-site, not-done actions, and the UI offers no reopen. A business tester would need a crafted request. No UAT row covers F-15. → **F-20** (P3) |
| Service worker, design budget, i18n and a11y ratchets | `field-v12`, no `/api/` answer cached; ratchets green | E1 (browser units), E2 | Holds |

## 3. Findings (round 5)

**P0: 0 · P1: 1 (F-15) · P2: 1 (F-16, conditional on L15) · P3: F-17, F-18, F-19, F-20, plus F-3 / F-5 / F-12 (Policy Center) carried over.**

### F-15 — P1: an inspection-form save re-creates every corrective action. The action's audit trail is deleted and a queued field close is lost
- **Where:** `inspection-db.js` ~867-884 (`saveInspection`): `DELETE FROM insp_actions WHERE inspection_id = ?`, then INSERT again from `state.actions`. E-I06 keeps only `closed_by` / `verified_*` for still-Closed actions. `insp_action_updates.action_id … ON DELETE CASCADE` (`db/postgres/inspection/001_init.sql:104`). The fix-18 comment in `_getActionParentPg` acknowledges the DELETE + INSERT.
- **Reproduction:** `R5-N1` in `/home/user/qual/out/r5-ux-field-attack.test.js` (Houndé editor `r5_ed` + viewer/field-tech `r5_tech`; run with the prescribed NODE_OPTIONS from a tests directory). Output:
  `bootstrap id 1 | after resave ids [[2,"Open"]] | audit rows before 1 after {"n":0} | phone close 403 {"error":"this action does not exist or is not in your scope","reason":"action_unavailable"}`.
- **Impact (live path):** any "Save now" or Submit of an inspection that has actions, including an editor re-opening and modifying a submitted inspection since lot 4b, does three things. (a) It deletes the comment and status-change history recorded in the actions register. (b) It changes action ids, which breaks register and home-queue links held by open tabs. (c) It turns every phone close queued against the old id into a terminal refusal whose text wrongly says "not in your scope". No status is overwritten, but technician work and audit evidence are lost silently. By the brief's definition this is a P0 candidate (data loss on a live path). I classify it **P1** because the phone's close is refused and visible, not silently overwritten, and because the behaviour predates this round. The security/data seat should confirm whether `insp_action_updates` is used as closure evidence; if it is, raise it to P0.
- **Fix:** upsert `insp_actions` by id (round-trip `id` in the form state), as `saveMeeting` has done for meetings since audit F2. Keep `row_changed_at` for real edits only.
- **Regression tests:** a smoke test that adds a comment, re-saves the inspection with the action unchanged, and asserts the same id and an intact `insp_action_updates`. A second test asserts that the queued field close then applies (200).
- **Rollback risk:** medium. The form, `_kept` matching and the PPTX path all read actions; the change needs a pg parity test.

### F-16 — P2 (P1 if `ui_helpdesk_site_default` is part of the L15 pilot): the Helpdesk "own site" default can silently drop the site's other ticket spellings
- **Where:** `public/lib/helpdeskSiteDefault.js` `pickOption` selects ONE dropdown value (the first in sort order whose fold key matches). `index.html:699/1015/1132` then filters by upper-case **substring** of that raw value, not by the fold key.
- **Reproduction:** `node /home/user/qual/out/r5-ux-field-hsd.js` (holds on today's documented spellings). Inline variant: options `['OUAGADOUGOU','Ouaga']` with site `Ouagadougou` picks `OUAGADOUGOU`; the `Ouaga` tickets are missed. Same pattern for `['HGO','Hounde Mine']` and `['LAFIGUE - SML','Lafigue']`.
- **Impact:** the tiles read as "my site", but they are a partial count, and nothing on the page warns about it. The selector shows only one raw spelling.
- **Fix:** when the default applies, filter by `SiteAliases.siteFoldKey(r.Site) === key` (or add a synthetic option "Site (all spellings)").
- **Test:** `pickOption` plus the filter, with the three pairs above.
- **Rollback risk:** low (the switch is off by default).

### F-17 — P3: Home group card says "no late project" when lateness cannot be measured
- `homeGroup.lateProjects` counts projects with no `end_date` as "not late" (`portfolioEvidence.ganttRows`: `late = end_date && …`). Fix: count the undated projects and show "N sans date de fin — non mesuré" when all, or some, are undated. Switch `ui_home_group_variant` is off by default.

### F-18 — P3: new portfolio pages not pinned by the accessibility floor test
- `portfolio-register.html`, `portfolio-decisions.html` and `portfolio-phase2.html` pass the `a11y-static` floor today (checked by hand) but are not in `NEW_PAGES`. Add them. Also translate the "OK" button and the fallback filter labels (`Year`, `Type`, …) in the register page.

### F-19 — P3 (P2 before general deployment of the review workflow): reviewer assignment by raw user id
- `public/lib/ppmReview.js`: "Reviewer user id" is a number input. Committee members do not know database ids, and a typo assigns another person; the server checks four-eyes, not intent. Fix: a person picker (name + role, filtered to eligible reviewers) and a confirmation before "Apply the proposed review checklist".

### F-20 — P3: field UAT rows that a business tester cannot execute; no row for F-15
- `docs/business-readiness/RECETTE-UAT.md` A2-05 and A2-06 describe negative tests the app's UI does not expose. Rewrite them as "verify the action does not appear / no reopen button", or move them to the security test plan. Add a row: "the coordinator saves the inspection while a field close is queued → the close applies and the comment history is kept" (fails today, F-15).

### Carried over
- F-3 residual (IndexedDB copies after the session expires without a logout): P3, no change.
- F-5: human ops step in prod, still owed.
- F-12 Policy Center French content (0/331 `description_fr`): P3, owner = human glossary owner (D-2).
- Note: the web register routes still name the owning site in 403 texts (editor-gated). Not a round-4 F-11 scope item.

## 4. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | AI panel recommendation, not a decision |
|---|---|
| L01 Daily work journey (role landing, home queue, nav, `ui_i18n_pages`) | **GO PILOT** for the English journey (43/43 e2e, home-queue units green, nav walk covers Policy Center). **CONDITIONAL** with `ui_i18n_pages=1`: Lot A runtime FR is done, but the glossary still needs validation by a French-speaking coordinator (D-2) |
| L11 Site operations evidence (`field_review_step`, `field_task_timing`, inspection switches) and the always-on field outbox | **CONDITIONAL**: F-10/F-11/F-4/F-2 are fixed, but **F-15** (inspection-form save deletes action history and voids queued field closes) must be fixed before pilot field techs close inspection actions from phones, or the pilot rule must forbid re-saving an inspection that has open actions. The F-5 legacy check also has to be run in prod |
| L13 Operations resilience (Policy Center UX side) | **CONDITIONAL**: usable, admin-only, nav guard fixed. French catalogue content still missing (human) |
| L14 Portfolio intake register / data quality / register and executive dashboard | UX side: **GO PILOT** for the register (accessibility and FR hold; F-18 is P3). The intake F-14 is fixed. PMO review of the PROPOSED reference lists is still required |
| L15 Adoption Lot B (profile landing, group Home, freshness strip, Helpdesk own site) | **CONDITIONAL**: landing and freshness are OK (nav walk + B1 journey). Keep `ui_helpdesk_site_default` off until F-16 is fixed or the site spellings are verified per site. F-17 is P3 |
| L08 Governance (Lot 4 decision agenda, Lot 5 review workflow) | UX side only: **CONDITIONAL** for `ppm_review_workflow_enabled` (F-19). Otherwise not reviewed by this seat |
| L16 Portfolio phase 2 | UX static floor and FR parity hold. Functional behaviour not reviewed by this seat: no recommendation beyond "UX floor OK" |
| L02–L07, L09, L10, L12 | not reviewed by this seat (L09 UX unchanged since round 4: GO PILOT UX-only) |

## 5. Human gates still empty in my area (`docs/sdp360/completion/RELEASE-GATES.md` at 3ee4dd23, every decision cell blank)
- Pilot sites D-05 and field UAT (G-16/G-35): Sponsor + Group IT. Covers F-15 and F-20.
- Product — business acceptance: Sponsor / PO
- Business witness project (E-B05): PMO
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05): QA lead
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08): Information Security
- Dashboard and tracker reviewers (G-23/G-24, DEC-6.x): Committee
- Production deployment GO/NO-GO: CAB
- Not RELEASE-GATES rows, but still owed by a human: the French glossary validation (D-2; Policy Center FR content), the PMO review of the intake/register reference lists (L14), running the F-5 legacy-row check in prod, and signing the UAT rows in `RECETTE-UAT.md` (all blank; this seat filled nothing).

*AI review — not an independent human review.*
