# P11 round 5 — fix lot fix/p11-r5-field (UX / field)

AI-authored engineering evidence — not an independent human review. No approval, signature, production readiness or
field acceptance is claimed. Base `0e97838e`. Findings from `/home/user/qual/out/r5-ux-field.md` (repro R5-N1 in
`r5-ux-field-attack.test.js`, R5-N2 in `r5-ux-field-hsd.js`). Every fix ships ON (defect fix); each new test was run
and seen FAILING before the fix, passing after (F-15: 0/4 before, 4/4 after).

| Finding | Sev | Cause | Fix | Regression test |
|---|---|---|---|---|
| F-15 an inspection-form save re-created every corrective action (new ids, `insp_action_updates` history deleted by cascade, queued phone close → final 403 "not in your scope") | P1 | `_saveInspectionPg` did `DELETE FROM insp_actions` + INSERT from `state.actions` | `_upsertActionsPg` (PostgreSQL, inside the save transaction): match by a numeric `id` of THIS inspection, else (old form state / queued offline save) same ord + text, then same text; UPDATE matched rows, INSERT new ones, DELETE only rows absent from the payload. `updated_at` moves only on a real edit (the field F-2 replay reads it). `closed_at` kept while terminal, stamped on a new close, cleared on a reopen; `closed_by` / verification kept only while Closed (E-I06). Three-way merge on status and owner: a value the form did not change since its last save keeps what the register or a phone set meanwhile (a stale tab no longer reverts a close). The stored form state now carries the ids and effective status/owner; `getInspection` overlays them on `state.actions` (row ord i = action i); the save answers `action_ids` and `inspection.html` stamps them on the rows it sent. An id of another inspection is ignored (never touched). `getInspectionForFieldReplay` strips the ids so a phone replay of its own capture still matches | `tests/field-r5-inspection-action-upsert.smoke.test.js` (4: R5-N1 same id + history + queued close 200; edit/remove/add round-trip; register close not reverted, explicit reopen works; foreign id untouched) |
| F-16 Helpdesk "own site" default kept one spelling and dropped the others | P2 | one dropdown value chosen; the page filters by an upper-case substring of it | `pickResult()`: among the spellings that fold to the person's site, pick one contained in all the others (`Ouaga` covers `OUAGADOUGOU`, `Lafigue` covers `LAFIGUE - SML`); none (`HGO` / `Hounde Mine`) → All Sites stays and the select's title says why (EN + FR in `index.fr.js`). `pickOption` keeps its signature | `tests/helpdesk-site-default-r5.test.js` (3), `tests/adoption-lotb-home.test.js` |
| F-17 Home group card said "no late project" with no end dates | P3 | projects without an end date counted as "not late" | `lateProjects` returns `open` / `undated`; all open projects undated → "— not measured: no end date recorded (n)"; some undated → "no late project (n without end date — not measured)". Separate string table so fix19's edits to the same file (worst-sites coverage) merge cleanly | `tests/home-group-late-undated-r5.test.js` (2) |
| F-18 new portfolio pages not pinned by the accessibility floor | P3 | missing from `NEW_PAGES` | `portfolio-register.html`, `portfolio-decisions.html`, `portfolio-phase2.html` added; register "OK" button → "Apply filters" / "Appliquer les filtres", French fallback filter labels | `tests/a11y-static.test.js` (+3) |
| F-19 reviewer assignment by raw user id | P3 | number input | GET review state gives the committee (only) `candidates` = active accounts the assign route would accept (not requester, owner or sponsor), name + role only; the panel shows a picker (raw id input kept only if the list is absent); "Apply the proposed review checklist" asks for confirmation. Server validation unchanged (active user + independence, 400/409) | `tests/portfolio-lot5.smoke.test.js` (+4 assertions) |
| F-20 UAT rows A2-05 / A2-06 not performable from the app; no row for F-15 | P3 | negative tests needing a crafted request | rewritten as what a tester can see (only own-site open actions; no reopen in the field app — crafted requests belong to the security plan); new A2-07 "re-save the inspection while a phone close is queued" | `node tools/release/business-readiness-check.js --check` |

Behaviour changes to note:
- Saving the inspection form no longer reverts a status or an owner changed in the register / on a phone since the
  form's last save. The form now shows the stored status and owner when it is loaded from the server.
- A queued phone close against an action the coordinator only re-saved (no edit) now applies (200) instead of a
  final 403. If the action WAS edited in the form after the phone queued its change, an envelope without
  `base_status` still ends as a 409 conflict (F-2 rule unchanged).

Not done in this lot (left open, reported):
- F-3 residual (IndexedDB copies of a previous user after the session expires without a logout) — needs a design
  choice on how long offline work is kept for a user who has not logged out; not trivial.
- F-5 legacy rows: `node tools/field/inspection-action-status-check.js` must be run in prod by a human.
- F-12 Policy Center French content: human glossary owner (D-2).
- Whether reviewer candidates should also be restricted to a reviewer role is a governance policy decision (today
  any active independent account, as the assign route already accepted).
