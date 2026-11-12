# Plan F amendment — bundle R2-QUEUE (progressive queue "S1" on Home + shared navigation)

Branch `goal/r2-queue` (from `da33991`, after the F2-UX merge). Scope: REBUILD-SPEC **R3** (progressive action queue
"S1" on Home) and **R4** (shared navigation), plus the two items R1-PROFILES left for this bundle (shell link to
`workspace-settings.html`; Home reads the person's workspace profile). Re-specified from
`docs/audits/2026-11-12-enterprise-review/REBUILD-SPEC.md` — no review.1 code was seen or copied. Engineering evidence only:
nothing here is an approval, a field acceptance or a production-readiness statement. Every behaviour is behind a switch
whose default is today's behaviour; no switch was turned on outside throwaway test databases. No migration.

## Verdicts

| Spec item | Verdict | What changed | Test proof |
|---|---|---|---|
| R3 — one queue of the person's AUTHORISED work across sources | BUILT, switch `ui_home_queue` = `0` | New `public/lib/homeQueue.js` (UMD, pure + `mount()`). Sources read through the EXISTING readers, no new route: meeting actions `GET /api/meetings/actions?site=`, inspection actions `GET /api/inspection/actions?site=`, report follow-ups (Site Actions register `GET /api/reports/site-actions?site=`, report group), commitments `GET /api/commitments` (kept to the person's own sites), "Awaiting me" (F-PRODUCT-07 block of `/api/me/work`: commitments to verify, handoffs, benefits, decisions due ≤ 7 d, PVs to sign). The site list is Home's own (`/api/me/work`: the person's sites, ≤ 12). Owner kept on every line; late first, then due date. | `tests/home-queue.test.js` (9) |
| R3 — sources load independently, each with its own state | BUILT | States `loading · available · unknown · stale · partial · denied`, each a symbol + a word + an `aria-label` (`role="img"`), never colour alone. 403 → denied; 404 (module switched off) → unknown "not switched on" (no retry offered); some sites fail → partial "k of n sites"; a refresh that fails after a good read → stale "kept from HH:MM" with the last items kept; site list unreadable → unknown + retry re-reads `/api/me/work`. Per-source retry button; focus returns to it; requests go through a pool of 4. | `tests/home-queue.test.js` (states, stale, pool, retry) |
| R3 — limits stated: 12 sites, 150 results, register fallback | BUILT | `LIMITS = { sites: 12, shown: 150 }`; the card says so and links the Site Actions register; "N of M items shown" and "N more site(s) not read" when cut. A line whose exact page cannot be built safely (deep link fails its pattern) opens its register and is marked "(register)"; deep links = `meeting.html?id=`, `inspection.html?id=`, `reports.html?report=`, `commitments.html?id=`, the awaiting block's own checked links. | `tests/home-queue.test.js` (limits, deep / register) |
| R3 — never another site's items for an editor (two sites) | BUILT and tested on PostgreSQL | Only Home's own site codes are requested; a row naming another site is dropped client-side (belt), and the server already refuses (braces). | `tests/home-queue-two-sites.smoke.test.js` (3, real `server.js`): editor of HGO sees HGO's late action, never MGO's, the queue never asked for MGO; the three readers answer 403 for MGO; a tampered queue asking for MGO reads "denied" with 0 lines; an admin's Home stays "your sites". |
| R3 — French, 320 px | BUILT | EN/FR table in the lib (Home is self-translated, `tests/i18n-coverage` lists it); CSS with tokens only; one column under 480 px, wrapping state rows, 36 px targets. | `tests/e2e/r2-home-queue.spec.js` (Chromium, throwaway PG, switches on): queue at 320 px and 1440 px with no layout problem, French words, site B never shown, 5 named states; `tests/e2e/v1-viewport-layout.spec.js` (switches off) still green. |
| R1 leftover — Home uses the workspace profile | BUILT | `home-page.js` calls `window.WorkspaceProfiles.load(lang)` ONLY while `workspace_profiles_enabled` reaches the browser (`uiPolicy.workspace_profiles`, not a `ui_*` key, like `ux_events`). Profile → shortcuts = its visible destinations (Home excluded, href pattern-checked), default site first, `compact` density class, `queue: false` (business) hides the queue. `null` (switch off, 404, error) = today's Home with no extra request. `load()` gained an optional `lang` (labels in French). | `tests/home-queue-page.test.js` (4): both off = only `/api/me/work` read; queue on reads only Home's sites; profile reorders / hides / never adds; profile switch on but API 404 = today's Home. |
| R1 leftover — shell link to `workspace-settings.html` | BUILT | "My workspace" / « Mon espace » link in the header actions, only while `workspace_profiles` = `1`. | `tests/shell-nav-r4.test.js` |
| R4 — one active destination from route + query + fragment; exactly one `aria-current` per landmark | BUILT, extends F-UX-02 (`ui_nav_active_from_url` = `0`) | Not forked: `activeFor()` keeps F-UX-02's rule (address decides when `data-current` names no entry) and adds: an address naming an entry by `?key=` / `#fragment` wins over the page's static attribute (`reports.html#admin`); an in-page `#` change re-renders the header (one listener, switch on only). A plain path never overrides a valid `data-current` (F-UX-02 test kept). | `tests/shell-nav-r4.test.js` (5): off = today; `#admin` → admin entry current; every menu entry of 5 roles addressed by its own link → ≤ 1 `aria-current` in the primary nav AND the breadcrumb nav; F-UX-02 tests in `tests/shell-navigation.test.js` unchanged and green. |
| R4 — compatible links carry the current site | BUILT, switch `ui_nav_carry_site` = `0` | When the address carries a valid `?site=CODE`, menu, finder and workspace links to the four pages that read it (`site-actions`, `obligations`, `meetings-actions`, `inspection-actions`) carry it; an explicit site is never replaced, a malformed code never carried, other pages untouched. Grants nothing: each page checks the right. | `tests/shell-nav-r4.test.js`; browser: `tests/e2e/r2-home-queue.spec.js` |

## Decisions (reversible engineering details)

1. **No new server route** for the queue: every source is an existing, already site-scoped reader, so the queue cannot
   widen anything (and `server.js`, outside this bundle, is untouched). Cost: up to 3 × 12 + 1 requests, pooled by 4.
2. **Commitments are limited to Home's own sites**; commitments the person must verify elsewhere arrive through "Awaiting
   me" (F1-GOV scope rules, unchanged).
3. **"stale"** = a refresh failed after a good read (the last read stays on screen with its time). The readers carry no
   collection timestamp of their own, so no other staleness can be stated honestly.
4. Switches went through `services/uiPolicy.js` (the existing browser channel) — two `ui_*` keys added and
   `workspace_profiles` exposed; `tests/ui-policy*.test.js` updated for the new keys (their defaults are today's).
5. Two small edits outside the owned list, both needed by the goals: `public/home.html` (container, script tags, token
   CSS — also fixes the 340 px minimum card width under 480 px) and `public/_shell.css` (link style).
   `public/workspace-settings.html` (R1): the two density radios got `aria-labelledby` — the F-UX-10 a11y ratchet
   (`a11y-legacy-ratchet`) was red on head for that page (`unlabelled_control=2`).

## Tests run (PostgreSQL 16 local test cluster; focused set, not the full suite)

- New: `home-queue` 9, `home-queue-page` 4, `home-queue-two-sites.smoke` 3, `shell-nav-r4` 5 (+ `tests/.suite-manifest.json`
  4792 → 4813); browser `tests/e2e/r2-home-queue.spec.js` 1 (mapped in `docs/ops/PERSONA-JOURNEYS.md`).
- Focused + ratchets, one run: **253 / 253 pass** — a11y-legacy-ratchet, a11y-static, agent-inventory, authz-route-matrix,
  await-precedence, brand-buttons, csp-no-inline-handlers-new-pages, error-shape (no new 4xx/5xx `.json`), exec-nav-consolidated,
  feedback-shell, flag-register, html-pages-before-static, i18n-coverage, i18n-shell-charts, landing, my-work(+route smoke),
  readme-truth, reflow-known, server-size-budget, shell-*, ui-design-ratchet (0 new hex), ui-policy(+me smoke),
  ux-events.smoke, workspace-* (3), home-page-blocks, report-config, kpi-docs-links, evidence-baseline.
- Browser: `v1-viewport-layout.spec.js` (switches off, 16 pages × 5 widths) and `r2-home-queue.spec.js` (switches on) green.
- Regenerated, not hand-edited: `docs/ops/FLAG-REGISTER.md`, `docs/ux/CHART-INVENTORY.md`, `docs/ops/AUTHZ-MATRIX.md`
  (route count from merged bundles). Hand-edited: `docs/ops/pilot/PILOT-PROFILE.md` (2 rows + F-UX-02 row extended).

## Left for people

- **Defect on head, not fixable here (`server.js` is F1-SEC's):** the R1 wiring line
  `app.use(require('./routes/workspace')(…))` landed at `server.js` line ~1500 **inside the trailing `//` comment** of the
  myWork/dataQuality line, so `/api/workspace/*` and `workspace-settings.html` are never mounted — even with
  `workspace_profiles_enabled` = `1` they answer 404 and Home behaves as today (tested). Move it to its own line.
- PO / UI policy owner: browser review in EN and FR at 320 px and with a screen reader before setting `ui_home_queue`,
  `ui_nav_active_from_url`, `ui_nav_carry_site` to `1` for the pilot cohort (PILOT-PROFILE rows).
- PO: confirm the queue's source list and order (meetings · inspections · report follow-ups · commitments · awaiting me)
  and the 12 / 150 limits.
