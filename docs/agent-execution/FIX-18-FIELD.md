# P11 round 4 — fix lot fix/p11-r4-field (UX / field)

AI-authored engineering evidence — not an independent human review. No approval, signature, production readiness or
field acceptance is claimed. Base `536e5187`. Findings from `/home/user/qual/out/r4-ux-field.md` (repros
`r4-ux-field-attack.test.js`, `r4-ux-field-navwalk.test.js`). Every fix ships ON (defect fix); each new test was run and
seen FAILING before the fix, passing after.

| Finding | Sev | Cause | Fix | Regression test |
|---|---|---|---|---|
| F-10 viewer-tier field tech reopens / moves a MEETINGS action from the field app | P3 (P2 if field techs are viewer-tier) | the r3 F-9 restriction applied to `source:'inspection'` only | field path: a meetings action takes only a terminal status of the shared `statusTransfer.DONE` list (resolved, cancelled, demand, helpdesk_ticket; legacy `closed` → resolved). A reopen / move (open, in_progress, blocked, on_hold) is refused 400 `meetings_action_status` — that change stays on the web register, which requires `editor` of the site. Same site scope (`userSites.inScope`) and same transfer justification (`statusTransfer.validate`) as before | `tests/field-r4-action-rules.smoke.test.js` (F-10 ×2) |
| F-11 field action ids reveal existence and owning site | P3 | "action not found" (400) answered before the scope check; scope refusal named the site | one refusal for a missing id and an out-of-scope id: 403, reason `action_unavailable`, same text, no site code | same file (F-11) |
| F-2 residual: an action re-created by the inspection editor is overwritten by an old envelope without `base_status` | P3 | the editor re-inserts actions without an audit row, so `last_status_change_at` was empty | `inspection-db.getActionParent` also returns `row_changed_at` (GREATEST(created_at, updated_at)); for an envelope without `base_status` and with a `client_ts`, a row changed after that time → 409 `action_changed`, nothing written (a comment-only update does not bump the row) | same file (F-2) |
| F-4 refusals without a reason code reach the phone in English | P3 | only 3 reasons had a phone text | every field outbox refusal carries a reason (`services/fieldOutbox.js REFUSAL_REASONS`, 29 codes incl. a generic fallback by error code and route-level refusals); `public/field/app.js` `reasonText()` has an FR/EN text for each (via `FT()` + `public/field/i18n.js`); service worker cache `field-v12` | `tests/field-r4-refusal-reasons.test.js` (3), `tests/field-french.test.js` |
| F-12 (partial) script-built texts of the Lot A daily list pages stay English with `ui_i18n_pages=1` | P3 | the page dictionaries covered static markup only | toasts / empty states / row buttons / table heads / prompt / alert prefixes added to the RUNTIME part of the five page dictionaries; a message with a dynamic part goes through `uiT()` (page helper over `I18nText.t`). `runtimeInSource: true` turned on for the five pages in `tests/i18n-coverage.test.js` | `tests/i18n-lota-runtime.test.js` (10), `tests/i18n-coverage.test.js` (+5) |
| F-13 the nav-walk test did not cover the Policy Center entry | P3 | `policy_center_page` missing from "all page switches on"; no PRIMARY route | both lines added + a guard that the policy turns on EVERY `policy:` key of `_shell.js` | `tests/adoption-lota-nav-authz.test.js` (+1) |
| F-14 intake tab: English warnings, read-only blanks, orphan label | P3 | `x.message` printed as-is; disabled empty controls; `<label for>` on a `<p>` | warnings translated by `code` (EN/FR in the tab's string table, server text kept for an unknown code); read-only renders `<output>` with the value, the value state (TBC / not applicable) or "—"; `affected_sites` gets a `<span>` heading | `tests/ppm-intake-r4-ux.test.js` (3) |

Out of scope / left to humans:
- French descriptions and titles for the 331 Policy Center catalogue rules: a glossary task for a French-speaking
  owner (D-2), not machine-written here. The French glossary (`docs/ux/GLOSSARY-FR.md`) stays PROPOSED until a
  coordinator validates it; the new FR strings follow it and are equally PROPOSED.
- Chart labels drawn on a canvas and the content of the exported PPTX decks on the five pages stay English.
- F-5 legacy rows: `node tools/field/inspection-action-status-check.js` must still be run in prod by a human.
- F-3 residual (IndexedDB copies after session expiry) not addressed in this lot.
- Whether pilot field techs should be `editor` of their site (governs who may reopen actions) is a Security / Sponsor
  decision (RELEASE-GATES G-03…G-08).

Behaviour changes to note: a phone that sends a reopen of a meetings action now gets a terminal "refused" (the honest
app never offers it); a legacy envelope (no `base_status`) closing an inspection action that the editor re-saved after
it was queued now ends as a conflict for the user to review, instead of overwriting.
