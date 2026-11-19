# P11 seat ux-field — findings

**AI review — not an independent human review.** Seat: UX / field (role journeys, French, accessibility, design budget,
offline field app, home queue). Frozen SHA `7eee8955568c0bcab2a6329f838ee432ffca9fd1` (clone `/home/user/qual/ux-field`,
`git rev-parse HEAD` checked at start and after the worker restart). No product file was modified; attack tests lived in the
scratchpad only and were never committed.

## 1. Evidence re-run

| # | Command | Result | SHA | Status |
|---|---|---|---|---|
| E1 | `npm run test:e2e -- --runs=1` (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, PG_ADMIN_URL local), started 15:16:46Z, finished 15:33:15Z | 42/42 journeys pass, 0 fail, 0 skipped; browser units 6/6 (field-queue-badge, field-review-step, field-storage + 1); `summary.problems = []`; GREEN | 7eee8955 | **verified** |
| E1b | Same command, second run requested by the coordinator after the worker restart | 42/42 journeys, 6/6 browser units, GREEN | 7eee8955 | **verified** |
| E2 | Unit tests: `i18n-coverage`, `ui-design-ratchet`, `a11y-legacy-ratchet`, `a11y-static`, `field-*` (non-browser, 10 files), `home-queue*` (5 files), with the prescribed NODE_OPTIONS | 1st pass in parallel: 124/134, the 10 failures were **all** `sorry, too many clients already` (PG 53300, max_connections 100 shared with other seats) | 7eee8955 | environment noise |
| E2b | The 4 failing files again with `--test-concurrency=1` (`field-routes.smoke`, `home-queue-extra-route.smoke`, `home-queue-page`, `ui-design-ratchet`) | 20/20 pass | 7eee8955 | **verified** |

Count: E1 + E2/E2b verified (2 evidence items, 154 unit + 42 journey + 6 browser-unit tests reproduced green). Nothing in my
assigned list is left "not verified" except E1b if §6 says so.

## 2. Claims attacked

| Claim | Attack | Outcome |
|---|---|---|
| C1 Outbox is exactly-once, author-bound, cross-site safe | Throwaway route test: other account sends same uuid; envelope without `author` from another account | Holds: 403 "uuid belongs to another user"; no-author envelope from a Mana editor for an HGO-only tracker is rejected (`no writable unit`) |
| C2 A field entry cannot damage a record it may not change | Field-tech (`viewer` + `field-tech`, site Hounde) sends an `inspection` envelope reusing the `f_id` of an existing **submitted** Hounde inspection | **Broken** → F-1 |
| C3 "A change made elsewhere is a 409, never overwritten" (the step-10 rule quoted in the session's project instructions; the code itself declares `CONFLICT_POLICY = last-write-wins`) | Coordinator moves an inspection action to `In Progress`; a field close queued 1 h earlier syncs afterwards | **Broken** vs the published sentence → F-2 |
| C4 Shared phone: offline data of the previous person is never shown | Read `sw.js`, `app.js bootstrap()`, `auth.js __logout`, `login.html` | Bootstrap holds (stale answer of another username is refused; logout wipes `/api/` cache + `kv`). Gap when the session simply expires (no logout) → F-3 |
| C5 Field app is French-first | Every `FT('…')` key in `app.js` vs `i18n.js` DICT | 62/62 keys present. Gap: thrown messages and server refusal texts bypass FT → F-4 |
| C6 Every field control is labelled | Static scan of `public/field/index.html` | Holds (all 14 controls labelled, implicit `<label>` wrapping; no empty buttons) |
| C7 Home queue never shows another site / marks done items open | Read `homeQueue.js` (`sameSite`, `INSP_DONE`/`MEETING_DONE` lowercase compare, `merge` cut at 150) | Holds; nothing broken |

## 3. Findings

### F-1 — P1 (P0 if any `field-tech` account exists on a live instance): a field entry overwrites a SUBMITTED inspection, and a viewer-tier field-tech gets an editor power
- **Where:** `routes/field.js:150-171` (`APPLY.inspection` → `idb().saveInspection(p, codes, …)`), `inspection-db.js:764-790`
  (only deleted-row and cross-site checks; no submitted lock, no version), compare `routes/inspection.js:362-366`
  (web route requires `editor`). `docs/ops/AUTHZ-MATRIX.md:693` lists `PUT /api/field/outbox/:uuid` with **no object check**.
- **Reproduce** (throwaway test under `<scratch>/tests/`, harness copied from `tests/field-routes.smoke.test.js`):
  1. `idb.saveInspection({meta:{f_id:'EM-IT-20261019-0202', f_site:'Hounde (HGO)', f_obs:'ORIGINAL OBS', …}, status:'submitted', …}, null, 1)`
  2. as `fd_tech` (`viewer`+`field-tech`, site Hounde): `PUT /api/field/outbox/<uuid>` `{kind:'inspection', author:'fd_tech', payload:{meta:{f_id:'EM-IT-20261019-0202', f_site:'Hounde (HGO)', f_obs:'overwritten', …}, items:{}}}`
  3. Result: `200 {"ok":true,"status":"applied"}`; row before `{"status":"submitted","key_observations":"ORIGINAL OBS"}`,
     after `{"status":"draft","key_observations":"overwritten"}` — state_json/findings replaced, record un-submitted.
- **Accidental path too:** the field app mints `EM-IT-<YYYYMMDD>-<1000..9999>` (`public/field/app.js:267`), the same shape as the
  web form, so two inspections of one site on one day collide with probability ~k²/18000 and the later one silently replaces the earlier.
- **Fix:** refuse (409, kept on the phone as `conflict`) when the target id exists and was not created by this envelope chain
  (or exists with status submitted/closed), and require `editor` for any update of an existing inspection; mint a collision-free id (uuid suffix).
- **Regression test to add:** in `tests/field-routes.smoke.test.js`: submitted inspection + field envelope same `f_id` → 409, row unchanged;
  field-tech update of an existing draft created by someone else → 409/403.
- **Rollback risk:** low (adds a refusal; queued envelopes become visible conflicts instead of silent overwrites).

### F-2 — P2: stale queued field status change overrides a later server-side change (last-write-wins)
- **Where:** `services/fieldOutbox.js:17` (`action: 'last-write-wins'`), `routes/field.js:180-191`.
- **Reproduce:** inspection action `Open` → `idb.addActionUpdate(id,{status_change:'In Progress', body:'Reopened: cable not certified'})`
  → field `PUT` with `client_ts` 1 h earlier, `status_change:'Closed'` → `200 applied`, status `In Progress` → `Closed`.
  Both updates remain in the audit trail (no row lost), so not data loss, but the register now shows the stale verdict as truth
  and the coordinator is not told.
- **Fix:** send the status the phone saw (`base_status`) and answer 409 `conflict` when the server status changed since; or
  at minimum correct the published "409, never overwritten" sentence and show "changed since you queued it" in the outbox.
- **Regression test:** field-routes smoke: server change after `client_ts` → 409 + no status change.
- **Rollback risk:** low.

### F-3 — P2: authenticated API answers stay in Cache Storage when a session expires without logout
- `public/field/sw.js:19-23` caches every successful same-origin `GET /api/*` (network-first). `auth.js __logout` wipes them, but
  `login.html` does not, so after an expiry the next person on the phone inherits the previous user's cached
  `/api/field/bootstrap` and `/api/dashboards/field-site/data?site=…` at rest (readable with dev tools; `loadDash`, unlike
  `bootstrap`, does not check the cached answer's user). The step-10 rule in the project instructions says the SW "caches the
  field app only, never `/api/`" — the code does cache `/api/` GETs.
- **Fix:** key/stamp cached API answers by user and wipe `/api/` entries on login when the username differs; or stop caching `/api/` in the SW (the app already keeps its own per-user `kv`).
- **Test:** browser unit: user A cached, session expires, B logs in → no `/api/` entry of A remains.

### F-4 — P3: English strings reach French-first field users
- `app.js` errors `'cached data of another user'`, `'session of another user'`, `'cannot read image'`, `'bootstrap failed'`
  shown via `msg(e.message)`; server refusals (`inspection is for X, your scope is …`, `no writable unit for your account`)
  shown raw in the outbox `last_error`. `i18n-coverage` does not see them (they are not FT keys).
- **Fix:** route through `FT` / map server error codes to dictionary entries. **Test:** extend `field-french.test.js` to scan `new Error('…')` literals.

### Observation (no severity)
- Gate dossiers carry target SHA `ccaeb0a3`, not the frozen `7eee8955`; their "evidence cited" counts were not re-derived for this SHA.
- The parallel unit run hit PG `max_connections=100`; the CI/qualification harness has no guard against that (now 400).

**P0: 0 · P1: 1 (F-1) · P2: 2 · P3: 1.**

## 4. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | Switches in my area | Recommendation |
|---|---|---|
| L01 Daily work journey (`ui_role_landing`, `ui_home_queue`, `ui_home_blocks`, nav switches, feedback) | home queue, role landing | **GO PILOT** — journeys u*/uat-s1…s7/r2-home-queue green, home-queue unit/smoke green, no defect found |
| L09 KPI trust read-only (`ui_i18n_pages`, `ui_kpi_*`, `ui_url_filters`, annotations) | French pages, chart a11y | **GO PILOT** (UX side only; KPI certification is G06, another seat) |
| L11 Site operations evidence (`field_review_step`, `field_task_timing`, insp switches) | field | **CONDITIONAL** — the switches themselves are fine, but the always-on field outbox carries F-1: fix F-1 (or keep `field-tech` accounts off the pilot / pilot users editor-only) before field UAT |
| L06 PMO extras (`ppm_offline_edit_enabled`) | offline edit | not reviewed in depth by this seat — **no recommendation** |
| (no lot) field outbox / service worker — not switch-gated | field | **CONDITIONAL** on F-1 fix; F-2/F-3 before general deployment |

## 5. Human gates still empty in my area (RELEASE-GATES.md, all decision cells blank at this SHA)

- Pilot sites D-05 and field UAT (G-16/G-35) — Sponsor + Group IT (dossier G11)
- Product — business acceptance — Sponsor / PO (G15)
- Business witness project (E-B05) — PMO (G21)
- Dashboard and tracker reviewers (G-23/G-24, DEC-6.x) — Committee (G09; publication of `field-site` dashboard)
- QA lead — CI green on target SHA, skipped tests reviewed (G19)
- Security — access policy / authz matrix (G01) — relevant to F-1 (field outbox has no object check in the matrix)

## 6. Addendum — second e2e run (coordinator request after restart)

Second run at the same SHA (2026-11-19T18:07:51.029Z → 2026-11-19T18:25:36.938Z problems []): 42/42 journeys pass, 0 fail, 0 skipped; browser units 6/6; GREEN, EXIT=0. Two consecutive green runs — E1b **verified**; no flake observed.
