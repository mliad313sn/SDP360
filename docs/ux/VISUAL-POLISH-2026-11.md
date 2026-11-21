# Visual polish 2 — progress file (branch `feat/visual-polish-2`)

AI UX committee review — not user research. This file lets a successor resume: the container restarts about every
40 minutes, so every finished item is committed and noted here.

Reports: `/home/user/ux-committee/{visual,site-coordinator,executive,admin,a11y-fr,ia-value,field}.md`.
How to run one e2e journey: `PG_ADMIN_URL=postgres://sdptest:sdptest-local-only@localhost:5432/postgres SDP_TEST_RUN_ID=polish2
E2E_ARTIFACT_DIR=/tmp/claude-0/polish2-e2e node --test --test-force-exit --test-concurrency=1 tests/e2e/<spec>` (start PostgreSQL first).

## Priority 1 — trunk e2e red after the first polish merge

| Journey | Cause | Fix | State |
|---|---|---|---|
| T7 French help | the shell help entry is now the contextual "?" (`help.html#chapter`), no bare `a[href="help.html"]` | spec follows the new entry (`a.shell-help`, anchor asserted) | green |
| V1 viewport | legacy bodies wrapped in `<main class="edv-main">` (display:contents, no box) — the helper skipped it and found nothing | `tests/e2e/fixtures/layout.js` steps INTO a display:contents element; the 6 known 320 px overflows fixed, allow-list emptied (ceiling 0) | green |
| UAT S1, S2, S7, S8 | same layout helper (the UAT fixture measures each visited page with it) | none beyond the helper | green (run one by one, 2026-11-21) |

All 44 e2e journeys were then run one by one on this branch (2026-11-21): 44 pass.

## Priority 2 — committee findings (state per seat)

Legend: **done-1** = handled by the first four polish commits (merged in the trunk before this branch);
**done-2** = handled on this branch; **partial** = part done, the rest named; **not done** = reason given.

### Field seat (`field.md`, 25 findings)

| # | Finding | State |
|---|---|---|
| F1 | Quick inspection overflows (495 px page) | done-2 — label on top, 5-column grid, `main{overflow-x:clip}`, short labels ≤ 480 px with the full word in `aria-label` |
| F2 | Pressed status has no severity colour | done-2 — ok / minor / major / critical / n-a colours (AA, white text) + ✓ + left border on the row |
| F3 | Action register unreadable on a phone | done-2 — card layout under 720 px, list before the charts (`inspection-actions.html`, same fix on `meetings-actions.html`) |
| F4 | French UI with English content | done-2 — areas, categories, checklist items and status labels from the lookups' French fields; tiles, kinds, sources, action statuses (SDPLabels), dashboard titles; validation in the page language (no browser bubble) |
| F5 | Unstyled dialogs, `window.confirm` | done-2 — bottom sheets; one confirmation sheet naming its target (discard, send as me, clear) |
| F6 | Raw file input | done-2 — "Take a photo" / "Gallery" buttons, 88 px thumbnails with size and a remove button, several photos from the gallery; 300 KB limit and low-bandwidth rule unchanged |
| F7 | Outbox shows machine data | done-2 — one card per entry: state + kind, plain title, relative time, reason on a tinted block, buttons on their own row; uuid / inspection id / exact timestamp under "Details"; header counter hidden at 0, amber when waiting, red when a decision is needed |
| F8 | Sunlight contrast | done-2 — green #15803D, amber #B45309, red #B91C1C, muted #4B5563, active tab text #B4410E; ● / ⚠ on the network pill |
| F9 | Low-bandwidth toggle misaligned (inline style) | done-2 — `.check` class; no inline style left in `index.html` or `app.js` |
| F10 | Bottom nav text-only, clips at 320 px | done-2 — icon + one-word label, safe-area padding, badge on Home when the outbox is not empty |
| F11 | Open actions: no context, tight destructive button | done-2 — card (source + status pills, description, owner, due date with days late); primary Close full width; "Cancel this action" as a text button on its own row, justification still mandatory. Not done: sort overdue first (the row order is pinned by a browser test; left as is) |
| F12 | Feedback off-screen | done-2 — `#msg` is a toast above the bottom bar; a success fades after 5 s, an error stays; the checklist is outlined and scrolled to |
| F13 | `inspection.html` opens on tools | done-2 (phone) — header tools on one row, save bar on one sticky line, print options hidden under 720 px; first field at ~390 px instead of ~600 px. Not done: a "⋯" menu |
| F14 | Touch targets under 44 px | done-2 — inputs 48 px / 16 px text, chips, mic, save link, signature buttons ≥ 44 px, status buttons a 3 × 2 grid |
| F15 | 17 category tabs stacked | done-2 — one horizontally scrolling sticky chip row |
| F16 | Doubled EN/FR labels | done-2 — `lib/oneLanguage.js` shows the half that matches the interface language (labels, section titles, options, buttons, placeholders, tiles); stored option values are unchanged. Labels that never had a French half follow the page dictionary switch (`ui_i18n_pages`, a human decision) |
| F17 | Technical strings | done-2 — dates through SDPFormat, "count" dropped, tracker empty state |
| F18 | Language switch in the header | done-2 — moved to the Home card; the network status is larger |
| F19 | Home tiles | done-2 — 3 equal tiles, tappable, overdue in red when > 0 |
| F20 | Sync gives no progress | done-2 — `aria-busy` + "Syncing…" |
| F21 | Native selects | done-2 — styled select with a chevron, 48 px |
| F22 | Inspector retyped | done-2 — prefilled from the signed-in user of the bootstrap (per-user cache) |
| F23 | Queue next to Clear | done-2 — full-width primary; Clear is a text button with a confirmation naming what is cleared |
| F24 | No way back to SDP360 | done-2 — link on the Home card |
| F25 | Field app is one of six chips on Home | not done — `home.html` ordering is shared with the adoption work (landing per profile already sends a technician to the field app, journey B1) |
| data | "0 count" beside an "NA" pill | done-2 — null = "—"; a measured 0 stays 0; the RAG pill is shown only for GREEN / AMBER / RED (NA = no threshold on that metric) |

### Visual seat (`visual.md`)

| # | Finding | State |
|---|---|---|
| F1 | Brand font missing | done-1 (tokens import the font) + done-2 (the two ITSM pages). The four remaining pages without tokens are 11-line redirect stubs |
| F2 | No shared component layer | done-1 (components) + partial-2 — the duplicated `.btn`/control rules of 6 pages moved to `body.edv-house`. Not done: 13 pages still define their own `.btn` (assets, executive, deck builder, inspection, inspections, it-review, login, reports, trackers, dashboards, dashboard-composer; portfolio and project belong to the PMO work). Each needs a visual pass page by page |
| F3 | Meetings hero on a phone | done-1 |
| F4 / F8 | Rainbow KPI borders, gradient strips, purple | done-1; done-2: a scorecard tile whose value is not measured carries no colour (`lib/kpiUnknown.js`) |
| F5 | Emoji as icons | done-1 (shell, tabs) + done-2 — 219 emoji replaced by Lucide SVG on 15 pages (17 icons added, placeholders hydrated when scripts render them). Kept: 🟢🟡🔴 RAG, 😊😐😟 CSAT, ✓ ✕ ⚠, emoji inside share / prompt texts and in JS toasts |
| F6 | Icon-only top nav | done-1 |
| F7 | Provenance box | done-1 (compact strip; scope, window and unknown visible) |
| F9, F17, F19, F20 | Type scale, widths, elevation, radii | partial — tokens exist (done-1); not applied page by page here |
| F10 | Four kinds of tab bar | partial — module tabs shared; in-page tabs of assets / tracker / admin unchanged |
| F11 | Header logo | done-1 |
| F12 | Unstyled native controls | partial-2 — field app, inspection phone layout, house pages |
| F13 | Policy Center raw JSON | done-1 |
| F14 | Empty / loading states | partial — helpdesk (done-1), tracker entry on the phone (done-2) |
| F15 | Helpdesk filter wall | not done — needs a design decision on which filters fold |
| F16 | Semantic button colours | partial-2 — field app |
| F18 | Bilingual inline labels | done-2 on the inspection form (oneLanguage); meeting.html handled by its dictionary |
| F21 | Status badges | partial — `.edv-badge` exists; pages not migrated |
| F22 | Raw codes in tables | done-1 (system logs) + done-2 (roles as words, WAN attribution, claim history, site overview) |
| F23 | US date inputs | not fixable in the page: a native date input follows the browser locale |
| F24 | Motion | done-1 (reduced-motion rule) |

### Site coordinator seat (`site-coordinator.md`)

P1-1 … P1-8: done-1 (empty KPI not green, meetings hero, PV editor sideways scroll, tracker month, tracker phone grid,
home order, PV validation). P1-7 (report editor in French) follows `ui_i18n_pages`.
P2-12 emoji: done-2. P2-13 native buttons: partial (see visual F2). P2-9, P2-10, P2-11, P2-14 … P2-17, P3: done-1 for
P2-10 and P2-14; the others not done here (report editor action row, save feedback, reports landing — each is a
workflow change of the weekly report, to be decided with a coordinator).

### Executive seat (`executive.md`)

F1 done-1 · F2 done-1 (labels) · F3 partial (done-1 chrome) · F4 partial · F5 partial (one door, tabs — done-1; tiles neutral —
done-2) · F6 PMO work (portfolio) · F7 done-1 (print rules) · F8 done-1 · F9 done-1 · F10 disclosed on the page (ported model, not
moved) · F11 not done · F12 partial · F13 done-2 · F14 done-2 ("Computing…" → "—", no colour on unknown) · F15 partial (done-2:
no colour contradiction on an unknown tile) · F16–F18 not done (chart and panel layout) · F19 done-1 · F20–F25 not done.

### Admin seat (`admin.md`)

P1-1 done-1 · P1-2 done-1 · P1-3 done-1 · P1-4 done-1 · P1-5 done-1 · P1-6 done-1 + done-2 (roles as words) · P2-1 done-2 (one
scope heading) · P2-2 done-2 (rail and group tabs in English, French in the dictionary) · P2-8 done-1 · P2-12 done-1 · P3-8
done-2 (icons). Not done: P2-3 … P2-7, P2-9 … P2-11, P3-1 … P3-7 (users table features, inline site editing, four-eyes badges,
policy list grouping, API key reveal dialog, dormant connectors) — each is a feature, not polish.

### Accessibility and French seat (`a11y-fr.md`)

F1 a configuration decision (not taken here) · F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12, F13, F15, F17, F19, F20, F21,
F22: done-1 · F12 done-2 as well (one interface locale for `toLocale*` on 11 files) · F16 done-2 (the six 320 px overflows
are fixed, the allow-list is empty) · F17 done-2 (`<main>` + h1 on helpdesk, h1 on reports and scorecard) · F18 partial
(field app) · F23 not done (the French checklist lines drop the ranges: the source data `inspection-init.json`) · F24, F25
not done · F14 glossary applied by the French-quality merge.

### IA and value seat (`ia-value.md`)

F1 … F5, F8, F9, F12, F15: done-1 · F6 done-1 + done-2 (no "(help §NN)" text; the "?" opens the chapter for 15 more
pages) · F7 done-1 · F10 done-1 · F11 done-1 · F13, F14 partial · F16 partial · F17 done-2 · F18, F19, F20 not done.

## Checks run on this branch (2026-11-21)

- e2e journeys: 44 specs run one by one (`node --test --test-force-exit --test-concurrency=1 tests/e2e/<spec>`), on the
  final code. The layout helper (`tests/e2e/fixtures/layout.js`) was changed twice, each time because the check's
  selector was what broke, not the page: it steps into a `display:contents` `<main>`, and it does not take a
  1 × 1 px assistive-technology heading for a content block.
- browser tests: the 6 `tests/*-browser.test.js` files.
- unit suite: every `tests/*.test.js` in 6 alphabetical chunks (954 files). Six failures on the first pass, all
  expected by the changes and fixed: three gate-dossier freshness checks (dossiers regenerated last), one tile
  parity regex pinned to `toLocaleString()`, two admin-card tests pinned to the French group labels.
- `npx eslint .`; inventories, README size block, chart inventory, CSP journey report, persona matrix, page inventory
  and KPI citations regenerated.

What was NOT verified: the items marked done-1 were taken from the first four commit messages and spot-checked on
screenshots, not re-tested one by one. Nothing here is user research or field acceptance.

## Screenshots

`docs/ux/polish-shots/` — before (commit `5588a2ba`) and after, desktop 1440 px and phone 390 px, and the contact
sheet `before-after.png`. Screenshots are for a person to look at; nothing is compared automatically.

## Visual polish 3 — log (branch `feat/visual-polish-3`, based on trunk `b09825fb`)

Scope: every row above marked "not done" or "partial". One line per finished item, committed as it lands. Helper scripts
used while working (not committed): `/tmp/claude-0/polish3/ut.sh <test files>` and `/tmp/claude-0/polish3/shoot.sh`
(screenshots through the e2e harness).

| Item | State |
|---|---|
| Field F25 | done-3 — for a field technician the field app is the first shortcut on Home and the one primary button (`lib/home-page.js` `fieldFirst`); other roles unchanged |
| Field F11 (sort) | done-3 — open actions sorted by due date, most overdue first, undated last (stable). The browser test now sends an undated and a later action first and asserts the order; its two original rows keep their place (same due date) |
| Field F13 ("⋯" menu) | done-3 — Rename and Delete of `inspection.html` sit behind one "More actions" menu |
| Inspection Type blank after reload | fixed — the default option is stored when the type was never changed (`_defaultType`, called after the form is filled and after the lookups replace the options) |
| Native `confirm()` / `prompt()` (admin P1-2, visual F12) | done-3 — deck builder, inspection, inspections, PV editor, meetings import, meetings setup, reports (16 confirmations + the revert reason) and the Backups card ask through `ReasonDialog.confirm` / `ask` / `form`: the dialog names its target (report, site, user, preset, file…), follows the page language, starts on Cancel for a destructive action, and Enter on Cancel no longer confirms. If the dialog library did not load the answer is "no". e2e T2 and F2 follow the in-page dialog (they used to accept / count browser dialogs) |
| Deck builder size budget | the page styles moved to `public/executive-report.css` (loaded where the `<style>` block was): the page is 444 KB, 29 KB under its 473 591-byte budget |
| Visual F15 (helpdesk filter wall) | done-3 — first row: period mode, Site, Group, Report week; Category, Priority, Status, Type, Impact, Mode and Trend fold behind "More filters" (count badge, state remembered); an active secondary filter shows as a removable chip that calls the control's own handler. CSV and Risk Register exports are one "Export" menu. Filtering itself is untouched |
| Coordinator P2-9 (save signal) | done-3 — report editor: one signal next to the title, "Saving…" → "Saved at HH:MM" (stays) → "Not saved — retry" (a button). No success toast on top of it; an autosave failure is no longer silent. The five section "Save …" buttons are secondary "Save now" |
| Coordinator P2-10 (green tabs) | done-3 — one completeness rule per tab (`_sectionComplete`), applied on open and after every save; a tick (✓) with the colour; "n / 5 sections complete" beside the status. An action list saved empty on purpose counts as complete (so the automatic "ready" status behaves as before) |
| Coordinator P2-11 (action row) | done-3 — one primary "+ Add Action", one "Import" menu (previous week, Meetings / Inspections, CSV file, template, allowed values), "Merge duplicates" under "more". Same buttons, ids and handlers |
| Coordinator P2-17 (reports landing) | done-3 — lead card "Weekly report due: W45 (dates) · site · status" with the page's one primary button "Continue W45" / "Start W45" / "Open W45" (it uses the picker's own open/create path). The picker stays below for another week. One status vocabulary on list, editor and lead card = the words Home shows (`reportStatusLabel` = server `weeklyLabel`, tested for parity) |
| Coordinator P2-14 (home contradictions) | done-3 — the site card says "Unsigned PVs of the site", the awaiting-me block "PVs waiting for my signature" (they count different things); "oldest 0 days" → "oldest opened today / N days ago" (it is the age since opening, not days late) |
| Admin P2-5 (users table) | done-3 — search (done-1) + Role / Site / Status filter lists (client-side, `lib/tableFilter.js` facets), a "Sign-in" column (Microsoft SSO / Password — the `has_entra` flag the API already returns), status as a badge, a pill for Super admin. **Last sign-in: not shown** — `GET /api/reports/users` does not return it and a date is never invented (it would need an API change) |
| Admin P2-6 (sites table) | done-3 within the existing route — the row's Save appears (as the primary) only once its Zoho group was edited and the row is marked; same `PUT /api/reports/sites/:id`. A drawer / multi-row save was not built (no route for a batch save) |
| Admin P2-7 (four-eyes visible) | done-3 — each admin field whose key is a four-eyes rule carries "Needs a second approver" (or "Change pending — second approver (pc-N)") linking to the Policy Center, read from `/api/policy-center/catalogue`; no request and no badge while the center is off. Display only |
| Admin P2-4 (secret state) | done-3 — "Set" / "Not set" badge beside SMTP password, SSO client secret, Meridian keys, Meraki and OpManager keys, Teams-SLA and Analytics secrets. `GET/PUT /api/reports/config` adds `secrets_set` (a boolean per secret key, computed before blanking; no part of a value) |
| Admin P2-9 (policy list) | done-3 — category chips with counts; one collapsible block per category (closed on arrival, opened by a search / filter), heading shows rules · deviating · awaiting approval; label + control wrap together |
| Admin P2-10 (phone) | done-3 — under 880 px the section list folds into "Section: <name>" above the panel; UAT S7 opens the fold before walking the panels |
| Admin P3-5 (API key) | done-3 — `ReasonDialog.reveal`: read-only field, Copy, "I have stored it" unlocks Close; the key is no longer written in the status line and is removed from the DOM on close |
| Executive F5 / F15 (one KPI tile) | done-3 — `.exec-kpi` in `brand/components.css`, modelled on the IT Review band (ruled neutral cell, caps label, 32 px tabular value, status as dot / pill, no coloured stripe, gradient or lift). Under `<body class="exec-house">` the Scorecard, Exec View, Site overview and Executive Home tiles take the same rules — one definition, no markup rewrite, no value touched |
| Executive: four homes, one door | done-3 — the Executive tab strip (one flat menu entry, done-1) now lists all five pages: Overview · IT Review · Scorecard · Site overview · Public summary, and is mounted on Site overview too (executive roles only). The menu switch `ui_exec_nav` is unchanged (a product-owner setting) |
| Executive F7 (print) | done-3 on top of done-1 — shared print block: A4 landscape, a printed title line (`data-print-title`), tab strips / filters / fixed footer hidden, tiles not split across pages. Printed-by / time is not printed (CSS cannot know it; the browser header carries date and URL) |
| Executive F2 (21 % vs 54 %) | already done-1 — both tiles say what they measure ("fleet score (selected period)" / "Fleet score · last month with data"); no formula changed |
| Executive F3 | done-3: Period is a list (same values the free-text field suggested); "Objective lights" is a heading, not a box. **Not done — data rule:** default Site = "Group": the server never mixes sites into a single tile (design review B3), so there is no group value to select |
| Executive F4 / F24 | done-3 — Scorecard bar: Export and Share visible, author tools under "More"; the six "Click Analyze & Fill" placeholders read "No commentary yet." with one hint line |
| Executive F11 / F22 | done-3 — IT Review site filter shows site names (from the model's own rows; code as tooltip); KPI band 4 columns on a tablet, 2 on a phone. The model is untouched (fidelity tests green) |
| Executive F16 / F17 / F23 | done-3 — empty panels shrink to their message; unmeasured sites are named on one line (from two up) instead of a wall of grey cells — still listed, still counted; a stale tile has a solid rule and its "Stale" pill |
| Executive F18 (charts) | done-3 — `lib/chartNoData.js` (Scorecard, Site overview, System Logs): "No data for this period" instead of an empty 0–1.0 axis, "Not enough data for a trend — N of 3 periods" instead of a lone dot, whole ticks on count axes |
| Executive F20 / F21 | done-3 — Exec View pillar bars carry their band (colour + word, thresholds from `lib/kpiRag.js`); Site overview opens on the Group view for a group user with no site |
| Executive F25 / F6 | PMO pages (portfolio) — handled by the PMO UX merge |
