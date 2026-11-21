# P11 seat ux-field — ROUND 8 (re-check) findings

**AI review — not an independent human review.** Seat: UX / field (role journeys, French, accessibility, design budget,
offline field app, home queue). Frozen SHA `7afb9536ae3e38273aeff47307a78c49637dbd94` (clone `/home/user/qual/ux-field`,
`git log -1` = `7afb9536`; the tree differs only by the removed `docs/agent-execution/` narratives, which were not read).
Earlier round files (`r7-` … `ux-field.md`) read, not modified. No product file modified. Nothing pushed, merged or tagged.
No human decision filled. All test runs used `SDP_TEST_RUN_ID=uxfieldr8`; test databases come from `tests/_pg-boot.mjs`
(one per file, dropped at exit); `tools/test/drop-test-dbs.js` not run. PostgreSQL was down at start and was started with
`service postgresql start`; a first e2e launch fired before PG accepted connections (all red with "[pg-boot] PostgreSQL is
required" — log kept at `/tmp/claude-0/r8-e2e-falsestart.log`, not counted) and was re-run once PG was ready.

Throwaway files (none committed):
- `/home/user/qual/out/r8-ux-field-attack.test.js` (+ log `/home/user/qual/out/r8-ux-field-attack.log`, 11/11 run, the
  tests only print): round-6/7 repros R6-N1, R6-N2, R7-N1, R7-N2, R7-N4 re-run unchanged, plus R8-R7N1-newform, R8-N1…R8-N5.
  Run from `/tmp/claude-0/p11attack-r8/uxf/tests/` with the prescribed NODE_OPTIONS (absolute clone paths).
- `/tmp/claude-0/p11attack-r8/retry.js`: extracts and executes `retryPlan` from `public/field/app.js` (the shipped source).

Fixes reviewed for this seat: fix 32 `fcc4d77c` (merged `94637391`: F-25…F-28). Also read for regressions in my area:
fix 30 UI touches (`public/site-awareness.html` tip, `public/lib/kpiRag.js` `min_closed`, `public/lib/ppmGovernanceW3.js`
card label), fix 33 UI touch (`public/lib/policyCenterPage.js` operator-token note). Fix 31 touches no public file.

## 0. Round-7 findings: were the fixes made?

| R7 finding | Repro at 7afb9536 | Verdict |
|---|---|---|
| **F-25 (P3)** id-less action matching loses or cross-attaches history | **R7-N1** (old naive tab, no merge): save1 `kept_amb:[4]`, Bob's row id 5 matched on text+owner+due and keeps "Bob comment"; save2 from the same tab (ids stamped, no reload) → `kept_amb:[4]`, rows `[5,4]`, history intact (round 7: rows deleted, history `[]`). **R8-R7N1-newform** (emulating the new `mergeKeptRows`): kept row merged, save2 keeps both, save3 deletes Alice's kept row only when named in `removed_action_ids`. **R7-N4** ([A,B(comment)] → id-less [B,C]): Bob id 8 keeps his comment, Carol is a new row 9, Alice id 7 kept and reported (round 7: Bob's comment landed on Carol). **R8-N4**: a flagged kept row survives a save from another id-aware tab that never saw it. `p11-r7-field-fixes(.smoke)` 11/11 pass | **FIXED.** Residuals: R8-N3 (conservative duplicates, by design, no finding) and R8-N1 (pre-existing editor-vs-editor lost update, new finding **F-29**, not caused by fix 32) |
| **F-26 (P3)** Helpdesk site filter changed for all users without a switch | `docs/ops/RELEASE-NOTE-HELPDESK-SITE-FILTER.md` (marked "prepared by AI — to be validated"), CHANGELOG entry, business-readiness row `HD-O15`; behaviour unchanged (not reverted); `helpdesk-site-match-r6`, `helpdesk-site-default-r5` pass | **FIXED as documented** (release note). Still owed by a human: announce to site coordinators; alias-table owner decides whether `SABODALA - MASSAWA` folds to one site |
| **F-27 (P3)** phone retries a persistent server error every 5 s | `retry.js` on the shipped `retryPlan`: persistent 500 → `5,10,20,40,80,160,300,GIVEUP` (≈615 s, then "server error — needs attention", red pill, counted as stuck, Try again resets); busy/429 keeps the server's pace (Retry-After clamped 5…120 s, no attempt counted); Retry-After 600 on a 500 → 300 s cap; malformed attempts/Retry-After fall back to 5 s. EN/FR labels present | **FIXED.** Residual UX note in §2 (F-30 P3: after a >10 min outage every queued entry needs its own Try again; Sync now does not resend `server_error` entries) |
| **F-28 (P3)** new texts outside the French / accessibility floor | `inspection.html` toasts now go through `uiF('{n} …')`, both templates present in `public/lib/i18n/inspection.fr.js`; "May rewrite:" is its own text node with FR in `project.fr.js`; site-awareness colour rule is visible text (`#sa-fleet-hd-note`, `role=note`) referenced by `aria-describedby` from each helpdesk cell, EN/FR; `i18n-coverage` + `a11y-static` pass | **FIXED.** Small residuals in §2 (F-31 P3) |
| F-3 residual (IndexedDB copies after session expiry without logout) | no change (the field app has no logout path) | open, P3 |
| F-5 ops step (legacy `demand`/`helpdesk_ticket` inspection-action rows) | no change | human prod ops step still owed |
| F-12 Policy Center FR content | no change to the catalogue content; the new fix-33 operator-token note is EN/FR | P3, human glossary owner (D-2) |

Round-6 repros re-run as regression checks: R6-N1 (form reopen of a phone-closed action) still applied (`stored … "Open"`);
R6-N2 (duplicate text, id-less) Bob's row and comment survive; R7-N2 (untouched status keeps phone close, `kept:[6]`) holds,
and the stale tab's deliberate change still wins without notice (round-7 design note R7-N2b, unchanged).

## 1. Evidence re-run (round 8)

| # | Command | Result | SHA | Status |
|---|---|---|---|---|
| E1 | `SDP_TEST_RUN_ID=uxfieldr8 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PG_ADMIN_URL=… E2E_ARTIFACT_DIR=/tmp/claude-0/r8uxf-e2e-art npm run test:e2e -- --runs=1`, log `/home/user/qual/out/r8-ux-field-e2e.log` (first line = SHA) | **43/43** journeys pass, 0 fail, 0 skipped; browser unit tests **8/8** (incl. SW stores no `/api/` answer, French refusal dialog, quota error, review step). `[e2e] GREEN`, `EXIT=0` | 7afb9536 | **verified** |
| E2 | Prescribed NODE_OPTIONS, `node --test --test-force-exit --test-concurrency=4` on the 25 assigned non-browser files: `i18n-coverage`, `ui-design-ratchet`, `a11y-legacy-ratchet`, `a11y-static`, 16 `field-*` (non-browser) and 5 `home-queue*`. The `field-*-browser` files run inside E1. Log `/home/user/qual/out/r8-ux-field-units.log` (first line = SHA) | **211/211** pass, 0 fail, 0 skipped, EXIT=0 | 7afb9536 | **verified** |
| E3 (fix checks, outside the assigned globs) | `p11-r7-field-fixes`, `p11-r7-field-fixes.smoke`, `helpdesk-site-match-r6`, `helpdesk-site-default-r5`; log `/home/user/qual/out/r8-ux-field-fixchecks.log` | 19/19 pass, EXIT=0 | 7afb9536 | verified (supports §0 only) |

Verified: **2 of 2** assigned evidence items. Not verified: **0**.

## 2. New break attempts (round 8 — one per capability, preferring code changed by fixes 30–33)

| Capability | Claim | Attack | Outcome |
|---|---|---|---|
| Inspection actions, id-less matching (fix 32, F-25) | "match only on an unambiguous key, never by order; an id-less payload never deletes a row with history" | **R8-N3**: stored [Check UPS/Alice, Check UPS/Bob(comment)]; id-less payload [`'  check   ups '`/Alice, Check UPS/`'bob '` with a changed due] | Alice matched on normalised text+owner+due (id 18 kept). Bob's variant: full key fails (due), text key not unique → new row 20, Bob id 19 kept with his comment, `kept_ambiguous:[19]`. No history lost or misattached; a visible duplicate the user must clean (the toast says so). Holds |
| Same, history protection | "a row with history is never deleted by an id-less payload" | **R8-N2**: three stored rows, one with history; id-less payload names only the first | Row without history deleted, row with history kept and returned in `kept_rows`. Holds as stated |
| Inspection actions, id-aware save (fix 32 context) | docstring: "rows absent from the payload are deleted (as the user removed the action)" | **R8-N1**: editors 1 and 2 load the same inspection; editor 2 adds two actions and saves; one gets a register comment; editor 1 (stale) edits notes only and saves | 200, `kept_rows:[]`, no warning: **both of editor 2's actions are deleted, and the register comment with them** (`hist NEW2 []`). The whole inspection is last-write-wins (no version check in `_saveInspectionPg`). Pre-existing (not introduced by fix 32), but it contradicts the "as the user removed the action" assumption. → **F-29 (P2)** |
| Field retry back-off (fix 32, F-27) | "persistent 500 backs off and stops after 8 attempts; busy keeps server pace" | `retry.js` executes the shipped `retryPlan` (sequences above) + static read of `flush` / `applyServerError` / outbox buttons | Holds. Side effects: page load / `online` / Sync now call `flush({force:true})`, which resends `failed` entries immediately regardless of `next_try_at` (acceptable, user-triggered); `server_error` entries are never resent by Sync now or by coming back online — only per-entry Try again. → **F-30 (P3)** |
| Field — server unreachable | the phone tells the truth about why a send failed | **R8-N5**: `rdb.validateSession` made to throw `ECONNREFUSED` (PostgreSQL down), PUT `/api/field/outbox/:uuid` | Answer **401 `Unauthorized`** (the r5 N-12 guard maps only `DB_BUSY` to 503; any other session-lookup error becomes 401 at `server.js:1108`). The phone then shows "Session expired — sign in again" during a database outage. Entries are kept (no loss). Pool-acquire timeout correctly gives 503 `database_busy` + Retry-After 5. → part of **F-30 (P3)** |
| French / a11y (fix 32, F-28; fix 30 label) | new texts are translated and visible | grep `public/lib/i18n/*.fr.js` for the new/changed strings; read `site-awareness.html` | Fix-32 strings present in FR. Fix 30 relabels a project summary card "Active risks + issues · high · blocked tasks" (`ppmGovernanceW3.js:54`) — that card set (and its neighbours) has no FR entry (pre-existing gap, not a regression). The site-awareness note hard-codes "5 closed tickets" while the threshold lives in `kpiRag.js` `min_closed` (PROPOSED) — a later change of the policy leaves the visible rule wrong. The cell itself does not mark `insufficient` (grey dot + value such as `1/3`, explained only by the generic note). → **F-31 (P3)** |
| Policy Center operator-token note (fix 33) | approver sees whether a CLI request's token was issued by the server | read `policyCenterPage.js` `tokenNote` | EN/FR, escaped, `data-token-ok` marker. Security semantics not reviewed by this seat. No finding |
| Vue Groupe helpdesk cell (fix 30) | the colour rule shown matches the code | compare the tip text with `services/siteHelpdeskSla.js fleetCell` | Text matches the code (worse of two bands, `min_closed` base, red/amber cap from either band). Only the hard-coded number (F-31). Holds |
| Service worker, design budget, a11y ratchets, home queue | ratchets green, `/api/` never cached, home queue unchanged by fixes 30–33 (`git diff 7ea49070..7afb9536` touches no home-queue file) | E1, E2 | Holds (E1 43/43 + 8/8, E2 211/211) |

## 3. Findings (round 8)

**P0: 0 · P1: 0 · P2: F-29 · P3: F-30, F-31, plus F-3 / F-5 / F-12 carried over.**

### F-29 — P2: a stale editor's save deletes actions another editor added, with their history (whole-inspection last-write-wins)
- **Where:** `inspection-db.js` `_saveInspectionPg` (no version / `updated_at` check; `state_json` replaced) and `_upsertActionsPg` (final delete loop: an id-aware payload deletes every unmatched row that is not flagged / not named-text / not removed).
- **Reproduction:** `R8-N1` in `/home/user/qual/out/r8-ux-field-attack.test.js`. Output:
  `R8-N1 after editor2 200 [{"id":12…"A1"},{"id":13…"NEW by editor2"},{"id":14…"NEW2 by editor2 …"}]` then
  `R8-N1 stale editor1 save 200 {"kept_amb":[],"kept_server_value":[],"kept_rows":[]} | rows [{"id":12…"A1"}] | hist NEW2 []`.
- **Impact:** two people (or two tabs of one person) editing the same inspection: the later save silently removes the other's new actions and their comment/status history (and, by the same mechanism, overwrites their findings/notes in `state_json`). No warning on either side. Pre-existing since before fix 15; fix 32 made deletion explicit (`removed_action_ids`) only for "kept unmatched" rows. Not on the phone path (the field app only creates inspections and updates action status/comments).
- **Pilot rule until fixed:** one editor per inspection at a time; reload before editing an inspection someone else may have touched.
- **Fix:** delete an action only when the form names it in `removed_action_ids` (now available) — treat every other unmatched stored row as kept and return it in `kept_rows`; and/or a version check (`base_updated_at`) answering 409 with the server copy.
- **Regression test:** two loads → B adds an action (+ comment) → A saves notes only → assert B's action and comment remain and A receives it in `kept_rows`.
- **Rollback risk:** low (additive keep rule); the 409 variant needs form handling.

### F-30 — P3: field phone after a server outage
- (a) After ≈10 minutes of 5xx every queued entry is parked as "server error — needs attention"; Sync now and coming back online do not resend those, each needs its own Try again (`public/field/app.js` `flush` filter `pending|failed`). Suggest Sync now also re-arms `server_error` entries.
- (b) With PostgreSQL unreachable the session lookup error becomes **401**, so the phone says "Session expired — sign in again" (`server.js:1108`, `services/businessGuard.js:40` map only `DB_BUSY`). Map connection errors (`ECONNREFUSED`, `57P01`, …) to 503 as well. Repro `R8-N5`. No data loss.

### F-31 — P3: small French / clarity residuals
- `public/site-awareness.html` `g_hd_tip` hard-codes "5" (EN/FR) while `min_closed` is a PROPOSED value in `public/lib/kpiRag.js`; build the text from the policy. An `insufficient` helpdesk cell is not marked as such (grey dot + value).
- `public/lib/ppmGovernanceW3.js` project summary cards (incl. the relabelled "Active risks + issues · high · blocked tasks") have no FR dictionary entries (pre-existing).

### Carried over
- F-3 residual (IndexedDB after expiry without logout): P3. F-5: human prod ops step. F-12 Policy Center FR content: P3, human owner (D-2).

## 4. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | AI panel recommendation, not a decision |
|---|---|
| L01 Daily work journey (landing, home queue, nav, `ui_i18n_pages`) | **GO PILOT** (English journey; E1/E2). **CONDITIONAL** with `ui_i18n_pages=1` pending French glossary validation by a French-speaking coordinator (D-2) |
| L11 Site operations evidence + always-on field outbox | **GO PILOT** with the pilot rule "one editor per inspection at a time" (F-29). F-22/F-25/F-27 fixed and re-proven. F-5 legacy check still to run in prod. Field UAT (A2-01…A2-07) unsigned |
| L13 Operations resilience (Policy Center UX) | **CONDITIONAL**: usable, operator-token note bilingual; French catalogue content still missing (human) |
| L14 Portfolio register / intake / data quality | UX side **GO PILOT**; PMO review of PROPOSED reference lists still required |
| L15 Adoption Lot B | **GO PILOT** for landing / freshness / group card; Helpdesk site filter change documented (release note to be announced by a human) |
| L08 Governance (Lot 5 review workflow, change-request scope) | UX side **GO PILOT**; functional/security not reviewed by this seat |
| L16 Portfolio phase 2 | UX floor pinned (a11y-static) and FR parity hold (W3 summary cards English-only, F-31); functional behaviour not reviewed by this seat |
| L02–L07, L09, L10, L12 | not reviewed by this seat |

## 5. Human gates still empty in my area (`docs/sdp360/completion/RELEASE-GATES.md` at 7afb9536 — every decision cell blank)
- Pilot sites D-05 and field UAT (G-16/G-35): Sponsor + Group IT.
- Product — business acceptance: Sponsor / PO.
- Business witness project (E-B05): PMO.
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05): QA lead.
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08): Information Security.
- Dashboard and tracker reviewers (G-23/G-24, DEC-6.x): Committee.
- KPI definitions and thresholds (G-12) — covers the PROPOSED `helpdesk-fleet-sla` bands and `min_closed: 5` shown on site awareness: KPI Committee.
- Production deployment GO/NO-GO: CAB.
- Not RELEASE-GATES rows but still owed by a human: French glossary validation (D-2; Policy Center FR content), PMO review of L14 reference lists, the F-5 legacy-row check in prod, announcing the Helpdesk site-filter change (HD-O15) and the alias decision for combined labels, signing the `RECETTE-UAT.md` rows (all blank; this seat filled nothing).

*AI review — not an independent human review.*
