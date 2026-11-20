# P11 seat ux-field — ROUND 4 findings

**AI review — not an independent human review.** Seat: UX / field (role journeys, French, accessibility, design budget,
offline field app, home queue). Frozen SHA `e43d11d5738dc4af650bd06715c54e6927f1649e` (clone `/home/user/qual/ux-field`,
`git rev-parse HEAD` checked before and after the container restart; only the removed `docs/agent-execution/` narratives
differ from the tree). Round-3/2/1 files (`r3-ux-field.md`, `r2-ux-field.md`, `ux-field.md`) read, not modified. No product file
modified, nothing pushed / merged / tagged, no human decision filled.

Throwaway files (not committed):
- `/home/user/qual/out/r4-ux-field-attack.test.js`: round-4 attacks R4-N1…N4. It runs from `/tmp/claude-0/p11attack-r4/uxf/tests/`, and `_pg-boot.mjs` gives it its own database.
- `/tmp/claude-0/p11attack-r4/uxf/tests/r3rerun.test.js`: the round-3 attack file, re-run unchanged at e43d11d5.
- `/home/user/qual/out/r4-ux-field-navwalk.test.js`: a copy of `tests/adoption-lota-nav-authz.test.js` with `policy_center_page` added to its "all switches on" policy.

Fix commit reviewed for this seat: `42d9ac55` "fix(field): terminal 400 for VALIDATION, close/cancel only for inspection
actions, no cross-site status oracle (P11 R3 F-8, F-9, R2-N3)", merged in fix 11 (`35065f98`). Fixes 10, 12 and 13 touch
no file in my area (sync, migrate, kpi, deck, ppm, health, backup).

## 0. Round-3 findings — were the fixes made?

The round-3 repros were re-run unchanged at e43d11d5.

| R3 finding | Repro result at e43d11d5 | Verdict |
|---|---|---|
| **F-8 (P3)**: a field inspection envelope carrying `actions[].status='demand'` got a 500 and was retried forever | R3-N1 → **400** `status:'rejected'`, `reason:'inspection_action_status'`. Resending the same uuid → 200 `duplicate:true, status:'rejected'` (terminal, not retried). Nothing is stored | **FIXED** |
| **F-9 (P3, P2 if field-techs are viewer-tier)**: a field-tech could reopen or move an inspection action from the field route | R3-N3: `Closed→Open` → **400**, `Open→In Progress` → **400**, stored value stays `Closed`. R4-N4: a comment alone (no `status_change`) → 200; `' closed '` → stored `Closed` | **FIXED for inspection actions.** The same hole is still open for **meetings** actions (new finding F-10 below) |
| **R2-N3** (round-2 security note fixed in the same commit): a 409 on another site's inspection id named its status | R4-N2: another site's id → 409 with a generic message, no `detail.status`, the stored row unchanged (`SGO`, `submitted`). Own-site id → 409 that still names the status (intended) | **FIXED for inspection ids.** Action ids still reveal the site that owns them (F-11) |
| **F-4 (P3, partial)**: refusals without a `reason` reach the phone in English | R3-N4 unchanged: `403 "action belongs to SGO"`, `400 "action not found"` (also for a meetings ticket on a missing id). No `reason`, so the phone shows the server's English text | **NOT FIXED** (no commit addressed it), still PARTIAL |
| F-2 residual (P3 note): a status changed through the editor is invisible to old envelopes that carry no `base_status` | R2-A4 → **200**, `In Progress` overwritten by `Closed`. Future `client_ts` and missing `client_ts` → 409 (unchanged, fixed earlier). `client_ts` +4 min → 200 (accepted within the clock-skew window) | **NOT FIXED**, still P3 (crafted or legacy envelopes only) |
| F-5 residual (ops): rows saved before the fix still carry `demand` / `helpdesk_ticket` | Behaviour on new data still correct (R2-A5: demand/helpdesk_ticket → 400, cancelled → `Cancelled`, not overdue, not in the home queue). Legacy rows are only listed by the read-only tool | **Ops step still open**: `tools/field/inspection-action-status-check.js` must be run in prod by a human |
| R2 F-3 residual (a previous user's IndexedDB copies stay at rest after the session expires without a logout) | No fix commit, not re-tested | open, P3 |

## 1. Evidence re-run (round 4)

| # | Command | Result | SHA | Status |
|---|---|---|---|---|
| E1 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PG_ADMIN_URL=… npm run test:e2e -- --runs=1`, run 13:48 → 14:12 UTC 2026-11-20. Log: `/home/user/qual/out/r4-ux-field-e2e.log` | **42/42** journeys pass (0 fail, 0 skipped); browser unit tests **8/8**; `[e2e] GREEN`, `EXIT=0` | e43d11d5 | **verified**. The run finished before the container restart, as the log shows |
| E2 | Prescribed NODE_OPTIONS, `node --test --test-force-exit --test-concurrency=4` on 25 files: `i18n-coverage`, `ui-design-ratchet`, `a11y-legacy-ratchet`, `a11y-static`, the 16 `field-*` files and the 5 `home-queue*` files. Log: `/home/user/qual/out/r4-ux-field-units.log` (its first line is the SHA) | **184/184** pass, 0 fail, 0 skipped, 0 todo, EXIT=0 (round 3 had 170) | e43d11d5 | **verified** |

Verified: 2 of 2 assigned evidence items. Not verified: 0. `chart-a11y.test.js`, `adoption-lota-*` and `persona-matrix` are
outside the assigned globs and were not run as evidence. `adoption-lota-nav-authz` was run as an attack only (§2).

## 2. New claims attacked (round 4: one per capability, no round-1 to round-3 attack repeated)

| Capability | Claim | Attack | Outcome |
|---|---|---|---|
| Field actions, **meetings** source | (implied by the F-9 fix) "from the field app an action is only closed/cancelled; reopening is the web register's job (editor of the site)" | R4-N1: a viewer-tier field-tech sends a meetings action `resolved → open` (`base_status:'resolved'`), then `open → blocked` | Both **200 applied**, now `blocked`. The **same user is refused 403** by `POST /api/meetings/actions/:id/update` (`editor` required). → **F-10** |
| Field, cross-site oracle | "no cross-site status oracle" (42d9ac55) | R4-N2 (inspection id) and R4-N3 (action ids, both sources) | Inspection id: holds. Action ids: another site's id → `403 "action belongs to SGO"`; a missing id → `400 "action not found"`. That tells a caller whether an id exists and which site owns it. → **F-11** |
| Field, comments | "comments still accepted" after F-9 | R4-N4 | Holds |
| Navigation, Adoption Lot A | "menu = route roles: no menu entry leads to a 403, for any persona" (`tests/adoption-lota-nav-authz.test.js`) | Same walk with `policy_center_page:'1'` added to its "all page switches on" policy | The guard itself **fails** (`menu entry policy-center has no primary route in PRIMARY`): the new Policy Center entry was never walked. With `'policy-center.html': 'GET /api/policy-center/catalogue'` added, all personas pass (catalogue snapshot `UUUFFF…FAAA`: admin, exec and super allowed, everyone else outside the admin menu). **The claim holds; the coverage gap is F-13** |
| One reporting week, Adoption Lot A | "the same day shows ONE week on Home, the report picker and Helpdesk" | Ran `ReportingWeek.dueWeek` at 2026-07-11 23:30 UTC under `TZ=UTC` and `TZ=Europe/London` | The helper is local-time sensitive (UTC → W26, London → W27). But the picker reads `/api/reports/current-week` and Home reads the server's year/week, so no page computes the due week in the browser. **Holds** (the server's timezone decides) |
| French, Adoption Lot A daily list pages | "French dictionaries for the daily list pages" (inspections, inspection actions, meetings, meeting actions, issues log) | Static scan: whole-text strings in each page's inline scripts (toasts, empty states, buttons) compared with the page dictionary plus `common.fr.js` | The commit scopes itself to static markup plus scope wording, and that part is true. Still missed, so they stay English when `ui_i18n_pages=1`: inspections 11 strings (`No data yet.`, `This cannot be undone.`, `No repeat finding.`…), inspection-actions 13 (`Verify`, `No actions match the current filter.`, `Excel downloaded`…), meetings 4, meetings-actions 12, issues 5. → **F-12** |
| Portfolio intake tab (L14, switch off) | "FR/EN, tokens only, blank stays unknown ('—')" | Read `public/lib/ppmIntake.{js,css}`, `services/ppm/intakeFields.js` | Tokens only: holds (no raw colour). FR: the tab text is translated, but the save **warnings** come from the server in English only (`ROLES_SAME_PERSON`, `ROLES_OVERLAP`, `BUDGET_ZERO`; a `code` exists but is not used for translation). Read-only view: blank fields render as empty disabled inputs, not "—", which contradicts the tab's own sub-title. `<label for="in-affected_sites">` points at a `<p>`, which cannot carry a label (orphan label). → **F-14** |
| Policy Center (L13, switch off) | "help §31 EN/FR"; page FR | Static check of `policyCenterPage.js` against `docs/ops/policy-catalogue.json` | Controls are labelled, the message area has `role=status`/`aria-live`, and the page is admin-only (menu and route agree). In French, **0 of 331** catalogue rules have `description_fr`, so every description shows English plus the "FR missing" marker, and titles are English key names. This is honest (marked as missing), not hidden. → noted in F-12 (P3) |
| Service worker / design budget / i18n and a11y ratchets | `field-v11`, no `/api/` answer cached; ratchets green | E1 browser unit 7, E2 | Holds (no change to `public/field` or the service worker since ead6efb6) |

## 3. Findings (round 4)

**P0: 0 · P1: 0 · P2: 0 (F-10 is conditional, as F-9 was) · P3: F-10, F-11, F-12, F-13, F-14, plus F-4 (partial) and F-2 / F-3 / F-5 residuals carried over.**

### F-10 — P3 (P2 if pilot field-techs are viewer-tier): the field route lets a field-tech reopen or move any MEETINGS action
- Where: `routes/field.js` `action()`. The F-9 restriction to `Closed`/`Cancelled` applies to `source:'inspection'` only. For `source:'meetings'` it accepts any `md_statuses` code after `normalizeMeetingStatus`, and does not check for `editor`. The web route `routes/meetings.js:346` requires `editor`.
- Repro: `R4-N1` in `/home/user/qual/out/r4-ux-field-attack.test.js` (meeting HGO, action `resolved`; field-tech viewer + `field-tech` on Houndé). Field PUT `resolved→open` → 200 applied; `open→blocked` → 200; the same token on `POST /api/meetings/actions/:id/update` → 403.
- The honest app never offers this: bootstrap lists only actions not yet done, and the UI offers Close, Ticket, Demand and Cancel. Only a crafted or modified envelope reaches it. It still reverses a closure that a coordinator may have verified, through a viewer account.
- Fix: for `source:'meetings'` on the field path, accept only `resolved`, `helpdesk_ticket`, `demand` and `cancelled`, with a translated `reason`. Test: add the R4-N1 case to `field-inspection-action-status.smoke`. Rollback risk: low.

### F-11 — P3: field action ids reveal whether an action exists and which site owns it
- Where: `routes/field.js` `action()`. `action not found` (400) is returned before the scope check, and the scope refusal names `parent.site_code`. The web route `routes/meetings.js:360` also names the site.
- Repro: `R4-N3`: another site's ids (inspection and meetings) → `403 "action belongs to SGO"`; a missing id → `400 "action not found"`.
- Fix: answer one generic refusal for "missing or out of scope" (same code, no site code). Same spirit as the R2-N3 fix.

### F-12 — P3: French gaps behind `ui_i18n_pages` (switch off by default)
- Runtime strings on the Lot A daily list pages (counts above) and the Policy Center catalogue (0/331 FR descriptions, English titles) stay English. The glossary is still PROPOSED and must be validated by a French-speaking coordinator (owner D-2).
- Fix: add the full-text runtime strings to each page dictionary (`runtimeInSource: true` in `tests/i18n-coverage.test.js` would pin them), plus FR titles and descriptions in the catalogue.

### F-13 — P3: the "zero menu entry leads to a 403" walk test does not cover the Policy Center entry
- `tests/adoption-lota-nav-authz.test.js` POLICIES "all page switches on" omits `policy_center_page`, and PRIMARY has no `policy-center.html` entry. If someone turns the switch on in the test, the guard fails on its own precondition. Behaviour today is correct (proved with the patched copy). Fix: add both lines, so the guard covers every policy-gated entry.

### F-14 — P3: intake tab (L14) — English warnings, read-only blanks, one orphan label
- `services/ppm/intakeFields.js:143-145`: warning messages are English-only; `ppmIntake.js save()` prints `x.message` into the French UI.
- Read-only mode shows unknown values as empty disabled controls, not "—".
- `fieldHtml()` emits `<label for="in-affected_sites">` for a `<p>` (no labelable target).
- Fix: translate by `code` on the page, render "—" for empty values in read-only mode, and use a `<span>` heading for `affected_sites` (as for `business_need`).

### Carried over (P3 / ops)
- F-4 partial: refusals without a `reason` are still English on the phone (see §0).
- F-2 residual: a status changed through the editor is invisible to legacy envelopes that carry no `base_status`.
- F-3 residual: a previous user's IndexedDB copies stay at rest after the session expires without a logout.
- F-5 legacy rows: run `node tools/field/inspection-action-status-check.js` against prod before the pilot; owners decide what to do with each `demand` / `helpdesk_ticket` row. This is a human / ops step; this seat did not do it.

**Round 4 totals: P0 0 · P1 0 · P2 0 · P3 5 new (F-10 to F-14) plus carried notes. Round 3: F-8 FIXED, F-9 FIXED (inspection only), R2-N3 FIXED (inspection id only), F-4 still partial, F-2 residual not fixed.**

## 4. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | Recommendation (AI panel recommendation, not a decision) |
|---|---|
| L01 Daily work journey (role landing, home queue, nav, `ui_i18n_pages`) | **GO PILOT** for the English journey: 42/42 e2e, home-queue units green, menu = route roles holds. **CONDITIONAL** if `ui_i18n_pages=1` is part of the pilot: F-12 runtime strings and coordinator validation of the glossary come first |
| L09 KPI trust read-only (UX side) | **GO PILOT** (UX only). Never-synced shown as "—" is in place on Helpdesk tiles. The KPI seat confirms the numbers |
| L11 Site operations evidence (`field_review_step`, `field_task_timing`, inspection switches) | **CONDITIONAL**: GO PILOT once F-10 is fixed or pilot field-techs are editors of their site, and once the F-5 legacy check has been run in prod |
| L13 Operations resilience (includes `policy_center_enabled`) | UX side: **CONDITIONAL**. Usable and admin-only, but French content is missing (F-12) and the nav guard needs F-13. Other aspects belong to other seats |
| L14 Portfolio intake register (`ppm_intake_register_enabled`) | UX side: **CONDITIONAL**: F-14 (FR warnings, read-only "—"), plus the PMO review of the PROPOSED reference lists that the switch plan names as a prerequisite |
| (no lot) field outbox / service worker, always on | **GO PILOT**: no data-loss or overwrite finding is open; F-11 and F-4 are P3 |
| L02–L08, L10, L12 | not reviewed by this seat — no recommendation |

## 5. Human gates still empty in my area (`docs/sdp360/completion/RELEASE-GATES.md` at e43d11d5, every decision cell blank)
- Pilot sites D-05 and field UAT (G-16/G-35): Sponsor + Group IT
- Product — business acceptance: Sponsor / PO
- Business witness project (E-B05): PMO
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05): QA lead
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08): Information Security. This gate covers F-10 and F-11 (role and scope on the field action path)
- Dashboard and tracker reviewers (G-23/G-24, DEC-6.x): Committee
- Production deployment GO/NO-GO: CAB
- Not a RELEASE-GATES row, but still owed by a human: validation of the French glossary (`ui_i18n_pages`, owner D-2), the PMO review of the intake reference lists (L14), and running the F-5 legacy-row check in prod.
