# P11 seat ux-field — ROUND 7 (re-check) findings

**AI review — not an independent human review.** Seat: UX / field (role journeys, French, accessibility, design budget,
offline field app, home queue). Frozen SHA `7ea49070d687679109c3c91ef29a8f744835f10c` (clone `/home/user/qual/ux-field`,
`git log -1` = `7ea49070`; the tree differs only by the removed `docs/agent-execution/` narratives, which were not read).
Earlier round files (`r6-` … `ux-field.md`) read, not modified. No product file modified. Nothing pushed, merged or tagged.
No human decision filled. All test runs used `SDP_TEST_RUN_ID=uxfieldr7`; test databases came from `tests/_pg-boot.mjs`
(one per file, dropped at exit); `tools/test/drop-test-dbs.js` not run. PostgreSQL was down at start and was started with
`service postgresql start` (PG 16 in this container).

Throwaway files (none committed):
- `/home/user/qual/out/r7-ux-field-attack.test.js` (+ log `/home/user/qual/out/r7-ux-field-attack.log`): round-6 repros R6-N1/R6-N2 re-run, new R7-N1, R7-N2, R7-N4 (R7-N3 was a dead probe, ignore). Run from `/tmp/claude-0/p11attack-r7/uxf/tests/` with the prescribed NODE_OPTIONS (absolute clone paths).
- `/home/user/qual/out/r7-ux-field-hd.js`: old substring filter vs new `siteMatches` on 31 site spellings.

Fixes reviewed for this seat: fix 28 `5043849b` (merged `0fc56a0a`: F-21…F-24). Also read for regressions in my area:
fix 25 site-awareness helpdesk cell (`public/site-awareness.html`), fix 26 change-request scope field (`project.html`,
`ppmWorkbench.js`), fix 29 Policy Center operator-token card (`policy-center.html`, `policyCenterPage.js`).

## 0. Round-6 findings: were the fixes made?

| R6 finding | Repro at 7ea49070 | Verdict |
|---|---|---|
| **F-22 (P2)** form reopen of a phone-closed action silently dropped | R6-N1 re-run unchanged: `phone close 200 Closed | form sees [[1,"Closed","Tech"]] | reopen save 200 | stored … "status":"Open" | form after reload [[1,"Open"]]` (round 6: stayed Closed). R7-N2: an untouched status keeps the phone close and is reported (`kept:[8]`, stored Closed). New `field-r6-inspection-action-merge.smoke` passes | **FIXED.** Residual design note R7-N2b in §2 (a stale tab's *deliberate* change overwrites a later phone close without warning — by design, P3 note). Old local copies without `base_status` still use the round-6 rule (transitional) |
| **F-23 (P3)** id-less fallback attaches the wrong row on repeated texts | R6-N2 re-run: Bob's id 3 and its comment survive; Alice's row is no longer overwritten; `kept_ambiguous` reported | **PARTIAL.** The exact round-6 case is fixed, but (a) **R7-N1**: the kept rows and their history are deleted at the very NEXT save from the same tab (the form only toasts "reload"); (b) **R7-N4**: equal counts with a reordered/replaced id-less list still cross-attach history (Bob's comment ends up on Carol's action). → **F-25 (P3)** |
| **F-21 (P3)** Helpdesk note tooltip-only; substring over-inclusion | `r7-ux-field-hd.js`: `MANA` no longer matches `MANAGEMENT`, `ITY` no longer `CITY OFFICE`; aliases fold `Ouaga`=`OUAGADOUGOU`, `Houndé`=`HOUNDE`=`HGO`. Note is now a visible `role=status` span with `aria-describedby`, EN/FR. `helpdesk-site-match-r6`, `helpdesk-site-default-r5` pass | **FIXED.** Side effects in §2 (F-26, P3) |
| **F-24 (P3)** phone shows raw `database_busy` | `public/field/app.js` `serverErrorText`: EN/FR texts for `database_busy`, 429, `internal_error`, other 5xx, entry kept as "will retry", `Retry-After` honoured; `field-r6-transient-errors` passes | **FIXED.** Residual: no backoff on a persistent 5xx (F-27, P3) |
| F-3 residual (IndexedDB copies after session expiry without logout) | no change | open, P3 |
| F-5 ops step (legacy `demand`/`helpdesk_ticket` inspection-action rows) | no change | human prod ops step still owed |
| F-12 Policy Center FR content | no change | P3, human glossary owner (D-2) |

## 1. Evidence re-run (round 7)

| # | Command | Result | SHA | Status |
|---|---|---|---|---|
| E1 | `SDP_TEST_RUN_ID=uxfieldr7 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PG_ADMIN_URL=… E2E_ARTIFACT_DIR=/tmp/claude-0/r7uxf-e2e-art npm run test:e2e -- --runs=1`, log `/home/user/qual/out/r7-ux-field-e2e.log` (first line = SHA) | **43/43** journeys pass, 0 fail, 0 skipped; browser unit tests **8/8** (incl. SW stores no `/api/` answer, French refusal dialog, quota error, review step). `[e2e] GREEN`, `EXIT=0` | 7ea49070 | **verified** |
| E2 | Prescribed NODE_OPTIONS, `node --test --test-force-exit --test-concurrency=4` on 25 files: `i18n-coverage`, `ui-design-ratchet`, `a11y-legacy-ratchet`, `a11y-static`, the 16 non-browser `field-*` (incl. new `field-r6-inspection-action-merge.smoke`, `field-r6-transient-errors`) and the 5 `home-queue*`. The 5 `field-*-browser` files run inside E1. Log `/home/user/qual/out/r7-ux-field-units.log` (first line = SHA) | **211/211** pass, 0 fail, 0 skipped, EXIT=0 | 7ea49070 | **verified** |
| E3 (fix checks, outside the assigned globs) | `helpdesk-site-match-r6`, `helpdesk-site-default-r5`, `home-group-late-undated-r5` | 10/10 pass | 7ea49070 | verified (supports §0 only) |

Verified: **2 of 2** assigned evidence items. Not verified: **0**.

## 2. New break attempts (round 7 — one per capability, preferring code changed by fixes 25–29)

| Capability | Claim | Attack | Outcome |
|---|---|---|---|
| Inspection actions merge, id-less (fix 28, F-23) | "kept rather than deleted — no action and no history is ever attached to, or deleted for, the wrong row" | **R7-N1**: stored A(Alice), B(Bob, comment). Tab with an old id-less copy saves `[B]` → `kept_ambiguous:[5,6]`, rows 7,5,6. The tab then does what `inspection.html forceSyncNow` does (stamps `action_ids` / `action_states`, no reload) and saves again with a notes edit | Save 2 answers 200, `kept_ambiguous:[]`; **rows 5 and 6 are DELETED, Bob's comment gone** (`history of original ids []`). The client never receives the kept rows (only a toast "Reload the inspection"), so its next save — or Submit — no longer names them and the id-based delete removes them. The regression test only checks after a reload. → **F-25 (P3)** |
| Same, equal counts | "equal counts stay unambiguous, matched in order" | **R7-N4**: stored [Alice, Bob(comment)], id-less save [Bob, Carol] (same text, A removed, C added) | Matched in order: row 10 now shows Bob, **row 11 shows Carol and carries Bob's comment**; `kept_ambiguous:[]`, no warning. → part of **F-25** |
| Inspection merge, loaded base (fix 28, F-22) | "a deliberate change wins; an untouched value keeps the phone value" | **R7-N2**: tab loads (base Open) → phone closes → tab edits notes only → saves; then the same stale tab sets In Progress | Notes-only save keeps Closed and reports `kept_server_value:[8]` (holds). Deliberate In Progress from the stale tab overwrites the phone close with `kept:[]` and no "changed meanwhile" notice. By the stated design; the phone comment stays in history. UX note only (an editor reopening a just-closed action without knowing it was closed) |
| Helpdesk site filter (fix 28, F-21) | "whole words + alias fold, never a raw substring" | Old vs new on 31 spellings (`r7-ux-field-hd.js`) | Holds for MANA/ITY. Changes for **every** user, not behind `ui_helpdesk_site_default`: selecting `HOUNDE` now also counts `HGO`/`Houndé`; `LAFIGUE - SML` counts all Lafigue; `SABODALA - MASSAWA` folds to SGO and counts all Sabodala; `Ouaga` no longer counts `Ouaga2000`. Mostly corrections, but the Helpdesk site numbers move without a switch or release note. → **F-26 (P3)** |
| Field transient errors (fix 28, F-24) | "transient = kept, retried later" | Static read of `public/field/app.js` `scheduleRetry` / `entryError` / `sendOne` (not executed) | A deterministic server 500 (`internal_error`, e.g. a payload that always throws) is retried **every 5 s for ever** (floor 5 s, no backoff, no attempt cap), each attempt logging a server error with a new correlation id. Before the fix it waited for the next sync trigger. → **F-27 (P3)** |
| Inspection form toasts (fix 28, French) | page French coverage | grep `public/lib/i18n/inspection.fr.js` | The two new toasts ("N action(s) were changed meanwhile…", "…could not be matched safely…") are English-only and built with a number prefix, so the exact-match dictionary cannot translate them even with `ui_i18n_pages=1`. Same for `ppmWorkbench.js` "May rewrite:" (fix 26). → part of **F-28 (P3)** |
| Site awareness helpdesk cell (fix 25) | the open-overdue count is explained | read `site-awareness.html` | "· N open overdue" is visible (EN/FR); the explanation of the worst-of-two colour is a `title` tooltip only — the same accessibility gap F-21 just fixed on the Helpdesk page. → part of **F-28 (P3)** |
| Policy Center operator token card (fix 29) | usable, bilingual | read `policy-center.html` / `policyCenterPage.js` | EN/FR strings present; token shown once in a `<pre>`, stays on screen until reload (no copy button, no clear). Security aspects not reviewed by this seat. No finding |
| Change-request scope field (fix 26) | usable | read `project.html`, `services/ppmWorkbench.js` | Free-text API identifiers (`charter, business_need, …`); unknown names get a 400 listing the valid ones. Usability note: a multi-select would avoid typing identifiers. No finding |
| Service worker, design budget, i18n, a11y ratchets, home queue | ratchets green, `/api/` never cached, home queue unchanged by fixes 25–29 (`git diff` touches no home-queue file) | E1, E2 | Holds (see E1/E2) |

## 3. Findings (round 7)

**P0: 0 · P1: 0 · P2: 0 · P3: F-25, F-26, F-27, F-28, plus F-3 / F-5 / F-12 carried over.**

### F-25 — P3: id-less action matching still loses or cross-attaches history (F-23 partial)
- **Where:** `inspection-db.js` `_upsertActionsPg` (id-less block and the final delete loop); `public/inspection.html` `forceSyncNow` (handles `kept_ambiguous` with a toast only).
- **Reproduction:** `R7-N1` and `R7-N4` in `/home/user/qual/out/r7-ux-field-attack.test.js`. Outputs:
  `R7-N1 save1 200 {"ids":[7],"kept_amb":[5,6]…} | rows [7,5,6]` then `save2 200 {"kept_amb":[]} | rows [{"id":7…}] | history of original ids []`;
  `R7-N4 … after [{"id":10,…"owner":"Bob"},{"id":11,…"owner":"Carol"}] | history [{"action_id":11,"body":"Bob comment"}]`.
- **Impact:** comment/status history deleted or attached to the wrong action. Only reachable with an id-less payload to an existing inspection (browser copies saved before fix 23; the field path only creates) and repeated action texts — transitional, low frequency; hence P3 like F-23.
- **Fix:** after a save that reports `kept_ambiguous`, force a reload of the form (or merge the server's `state.actions` into the tab) before any further save; for equal counts, match id-less rows by text+owner+due, and treat a remaining mismatch as ambiguous.
- **Regression test:** extend `field-r6-inspection-action-merge.smoke` with "second save from the same tab without reload keeps the kept rows" and the [A,B]→[B,C] case.
- **Rollback risk:** low.

### F-26 — P3: Helpdesk site filter behaviour changed for all users without a switch
- `public/index.html` `_siteOk` replaces the substring filter in the three Helpdesk filters unconditionally. Selecting one spelling now counts every alias spelling (and `SABODALA - MASSAWA` folds into Sabodala; `Ouaga` stops matching `Ouaga2000`). Mostly a correction, but visible Helpdesk numbers per site change on deployment. Mention it in the release note / UAT row, and decide whether a combined label such as `SABODALA - MASSAWA` should fold to one site (alias table owner).

### F-27 — P3: field phone retries a persistent server error every 5 seconds
- `public/field/app.js` `scheduleRetry`: floor 5 s, cap 120 s only when the server sends `Retry-After`; no exponential backoff and no attempt counter for `internal_error`. Add backoff (e.g. 5 s → 10 → 30 → 120, then wait for the next manual / online sync). Static finding, not executed.

### F-28 — P3: new texts outside the French / accessibility floor
- `inspection.html` kept/ambiguous toasts and `ppmWorkbench.js` "May rewrite:" are English-only (number-prefixed strings cannot be dictionary-matched). `site-awareness.html` helpdesk-colour explanation is tooltip-only. Add FR via a template function and render the explanation as visible text.

### Carried over
- F-3 residual (IndexedDB after expiry without logout): P3. F-5: human prod ops step. F-12 Policy Center FR content: P3, human owner (D-2).

## 4. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | AI panel recommendation, not a decision |
|---|---|
| L01 Daily work journey (landing, home queue, nav, `ui_i18n_pages`) | **GO PILOT** (English journey; E1/E2). **CONDITIONAL** with `ui_i18n_pages=1` pending French glossary validation by a French-speaking coordinator (D-2) and F-28 texts |
| L11 Site operations evidence + always-on field outbox | **GO PILOT.** F-22 fixed and re-proven. Pilot rule until F-25 is fixed: after a "could not be matched safely" toast, reload the inspection before saving again. F-5 legacy check still to run in prod. Field UAT (A2-01…A2-07) unsigned |
| L13 Operations resilience (Policy Center UX) | **CONDITIONAL**: usable (operator-token card bilingual); French catalogue content still missing (human) |
| L14 Portfolio register / intake / data quality | UX side **GO PILOT**; PMO review of PROPOSED reference lists still required |
| L15 Adoption Lot B | **GO PILOT** for landing / freshness / group card. Helpdesk site default: **GO PILOT** (F-21 fixed); announce the unconditional filter change (F-26) |
| L08 Governance (Lot 5 review workflow, change-request scope) | UX side **GO PILOT**; functional/security not reviewed by this seat |
| L16 Portfolio phase 2 | UX floor pinned (a11y-static) and FR parity hold; functional behaviour not reviewed by this seat |
| L02–L07, L09, L10, L12 | not reviewed by this seat |

## 5. Human gates still empty in my area (`docs/sdp360/completion/RELEASE-GATES.md` at 7ea49070 — every decision cell blank)
- Pilot sites D-05 and field UAT (G-16/G-35): Sponsor + Group IT.
- Product — business acceptance: Sponsor / PO.
- Business witness project (E-B05): PMO.
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05): QA lead.
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08): Information Security.
- Dashboard and tracker reviewers (G-23/G-24, DEC-6.x): Committee.
- KPI definitions and thresholds (G-12) — covers the PROPOSED `helpdesk-fleet-sla` bands shown on site awareness: KPI Committee.
- Production deployment GO/NO-GO: CAB.
- Not RELEASE-GATES rows but still owed by a human: French glossary validation (D-2; Policy Center FR content), PMO review of L14 reference lists, the F-5 legacy-row check in prod, signing the `RECETTE-UAT.md` rows (all blank; this seat filled nothing).

*AI review — not an independent human review.*
