# P11 seat ux-field — ROUND 2 findings

**AI review — not an independent human review.** Seat: UX / field (role journeys, French, accessibility, design budget,
offline field app, home queue). Frozen SHA `b2e85cd08860a57526442797ac711e2fc9defc3a` (clone `/home/user/qual/ux-field`,
`git rev-parse HEAD` checked). Round-1 file `/home/user/qual/out/ux-field.md` (SHA 7eee8955) was read, not modified.
No product file modified. Throwaway attack tests: `/home/user/qual/out/r2-ux-field-attack.smoke.test.js` (run from a
scratch `tests/` folder so `_pg-boot.mjs` provisions a database) and `/home/user/qual/out/r2-ux-field-dlg.js`.
Round-1 repro files were not kept under `out/`; the original repros were rewritten from the round-1 text (cases R1-F1, R1-F2 in the attack file).

## 0. Round-1 findings — fix verification

| R1 finding | Fix commits | Original repro at b2e85cd | Verdict |
|---|---|---|---|
| F-1 (P1) field envelope overwrites a SUBMITTED inspection of another user | e59ecce, 38a01a3, f117f5a | R1-F1: `PUT /api/field/outbox/<uuid>` by `viewer+field-tech` with the f_id of a submitted inspection (author 1) → **409**, row unchanged `{"status":"submitted","key_observations":"ORIGINAL OBS"}`. Field ids now carry 48 random bits (`fieldInspectionId`, app.js:264) | **PARTIAL** — the other-author and collision paths are closed, but the "same author replay" exemption compares only `meta`, so an author can still un-submit and rewrite findings → new F-6 (P2) |
| F-2 (P2) a stale queued status change overrides a later server change | e59ecce, 38a01a3 | R1-F2: envelope with `client_ts` = now−1 h, no base_status, after a coordinator moved it to In Progress → **409**, status stays `In Progress`. New phones send `base_status` | **FIXED** for honest clients. Residual: no base_status + future/absent `client_ts` still overwrites (A2/A3), and a status change written outside `addActionUpdate` is invisible to the legacy check (A4). Only reachable with a crafted or legacy envelope → P3 note |
| F-3 (P2) authenticated `/api/` answers kept in Cache Storage after session expiry | 38a01a3, f117f5a | `public/field/sw.js:22-26` is now network-only for `/api/`, CACHE_VERSION `field-v10`, `activate` deletes every other cache; browser unit test 6 "service worker stores no /api/ answer" passes in my e2e run | **FIXED**. Residual P3: the previous user's `bootstrap:<user>` / `dash:<user>:<site>` IndexedDB entries stay at rest after an expiry without logout (they are never shown to the next user, since keys are per user; `auth.js __logout` clears them only on an explicit logout) |
| F-4 (P3) English strings reach French-first field users | none | `app.js:73,78,250,253` still throw English literals; the new conflict texts from the server (`routes/field.js` "…already exists on the server…", "this action was changed on the server since it was queued…") are shown as-is in `last_error` | **NOT FIXED** (and slightly widened by the new 409 messages) |

## 1. Evidence re-run (round 2)

| # | Command | Result | SHA | Status |
|---|---|---|---|---|
| E1 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PG_ADMIN_URL=… npm run test:e2e -- --runs=1` (19:28→19:53 UTC). Log: `/home/user/qual/out/r2-ux-field-e2e.log` | 42/42 journeys pass, 0 fail, 0 skipped; browser units 7/7 (adds `field-sw-no-api-cache`); `[e2e] GREEN`, EXIT=0 | b2e85cd0 | **verified** |
| E2 | Prescribed NODE_OPTIONS, `node --test --test-force-exit --test-concurrency=4` on `i18n-coverage`, `ui-design-ratchet`, `a11y-legacy-ratchet`, `a11y-static`, all `field-*` (14 files incl. the new `field-outbox-conflict.smoke` and the browser units), `home-queue*` (5 files) | 157/157 pass, 0 fail, 0 skipped, 0 todo (no PG connection exhaustion with max_connections 400) | b2e85cd0 | **verified** |

Verified: 2/2 assigned evidence items. Not verified: 0.

## 2. Claims attacked (round 2: one new claim per capability)

| Capability | Claim | Attack | Outcome |
|---|---|---|---|
| Field outbox — inspection | "the field path never rewrites an inspection it did not create; a field-tech never un-submits a record; only the author's capture replayed **unchanged** applies" (routes/field.js:160-168, test file header) | A1: author (viewer+field-tech) saved a submitted inspection with `net__0 = critical`; sends a NEW uuid with identical `meta`, `items.net__0 = ok`, no status. A1b: same after a coordinator raised the finding to critical (meta untouched) | **Broken** → F-6. A1: `200 applied`, status `submitted → draft`, critical → ok. A1b: `200 applied`, the coordinator's severity raise replaced by the tech's older finding |
| Field outbox — action | "a change made elsewhere is a 409" | A2 future `client_ts`, A3 no `client_ts`, both without `base_status`; A4 status changed through the inspection editor (no `insp_action_updates` row) | All three `200`, status overwritten → P3 note (crafted / legacy envelopes only; honest phones send base_status) |
| Field actions + home queue + register | "transfer statuses (demand / helpdesk_ticket) exist for meetings issues/actions only; the home queue never shows a done item as open; overdue counts exclude finished actions" | A5: field app's `→ Demand`, `→ Ticket`, `Cancel` buttons on an **inspection** action (app.js:326 renders them for both sources) | **Broken** → F-5 |
| Service worker | "never caches /api/" | Read sw.js + browser unit test 6 | Holds |
| French | field app French-first | grep thrown literals + new 409 texts | Gap persists (F-4) |
| Accessibility / dialog UX | justification dialog is usable by keyboard/mouse | Chromium: open `#dlg` (same markup as field/index.html:67), click **Cancel** with empty comment | **Broken** → F-7 (dialog stays open: `required` textarea blocks the `type=submit value=cancel` button; only Escape closes it). Dialog also has no `aria-labelledby` to `#dlg-title` |
| Design budget / i18n ratchets | ratchets green | E2 | Holds |

## 3. Findings

### F-5 — P1: a field "Demand / Ticket / Cancel" on an inspection action is stored as a status the rest of the platform treats as OPEN and OVERDUE
- **Where:** `public/field/app.js:322-327` offers `helpdesk_ticket`, `demand`, `cancelled` for every action, inspection included;
  `routes/field.js` action apply passes the string to `inspection-db.addActionUpdate` with no vocabulary check (the web route
  `routes/inspection.js:242-262` does not check either); inspection actions use `Open / In Progress / Closed / Cancelled`
  (case-sensitive). Overdue/open SQL `inspection-db.js:941,948,996` = `a.status != 'Closed' AND a.status != 'Cancelled'`;
  home queue `public/lib/homeQueue.js:38` `INSP_DONE = ['closed','cancelled']`. Project rule: transfer statuses apply to
  `md_issues` + `md_actions` only.
- **Reproduce:** test A5 in `r2-ux-field-attack.smoke.test.js` (field-tech on Hounde, inspection action due 2026-01-10, `base_status:'Open'`):
  - `status_change:'demand'` → 200, stored `demand`, **in the overdue list**, **open in the home queue**
  - `status_change:'cancelled'` → 200, stored lowercase `cancelled`, **in the overdue list** (SQL compares `'Cancelled'`), not in the home queue
  - `status_change:'helpdesk_ticket'` + ticket → 200, stored `helpdesk_ticket`, overdue + open in the home queue
- **Effect:** an action the field user believes finished inflates `overdue_actions` (inspection aggregate / dashboards) and
  stays on the home queue forever — a wrong number shown as truth. Pre-existing since step 10 (`c426b73`), not introduced by the fixes; missed in round 1.
- **Fix:** for `source:'inspection'` show only Close (+ a Cancel mapped to `Cancelled`), and validate the inspection status
  vocabulary server-side (field and web routes): reject or normalise anything outside `Open|In Progress|Closed|Cancelled`.
- **Regression test:** field-routes smoke: inspection action + `demand` → 400; `cancelled` → stored `Cancelled`, absent from overdue.
- **Rollback risk:** low. Existing bad rows need a dry-run data check (count `insp_actions.status NOT IN (...)`).

### F-6 — P2 (P1 if pilot field-techs are not editors of their site): the same-author replay exemption lets a field-tech un-submit and rewrite its own submitted inspection
- **Where:** `routes/field.js:164-168` — `sameCapture = created_by === u.id && stableJson(existing.meta) === stableJson(p.meta)`;
  `items`, `actions`, photos and `status` are not compared and the stored status is not checked.
- **Reproduce:** tests A1/A1b (attack file). A1: `200 applied`, `submitted → draft`, finding `critical → ok`. A1b: coordinator's
  edit of the findings (meta untouched) is silently reverted by the tech's resend, record stays `submitted`.
- **Reachability:** honest phones re-send a lost answer under the SAME uuid (ledger returns duplicate), so this needs a crafted
  request with a new uuid by an authenticated author — a viewer-tier account gets an editor-only power on a submitted record.
- **Fix:** accept the replay only when the stored row is identical to the payload (full stable hash of the stored state, or
  the ledger entry for the original uuid), and never when the stored status is submitted/closed unless the user is editor+.
- **Regression test:** add to `field-outbox-conflict.smoke`: same author, same meta, different items → 409, row unchanged.
- **Rollback risk:** low.

### F-7 — P3: justification dialog "Cancel" does nothing until a comment is typed
- `public/field/index.html:67`: both buttons are `type=submit`; the `required` textarea blocks the Cancel submit. Reproduced in
  Chromium (`r2-ux-field-dlg.js` → `open after Cancel click: true`). Fix: `formnovalidate` on Cancel; add `aria-labelledby="dlg-title"`.

### Notes (P3)
- F-2 residual (A2/A3/A4): legacy envelopes without `base_status` rely on a client-supplied `client_ts` (future accepted by `validateEnvelope`) and on `insp_action_updates` rows only.
- F-3 residual: previous user's IndexedDB `bootstrap:`/`dash:` copies at rest after an expiry without logout; `kvSet('site', …)` is not per user.
- F-4 not fixed (see §0).

**Round 2 totals: P0: 0 · P1: 1 (F-5) · P2: 1 (F-6) · P3: 2 (F-4, F-7) + notes.** Round-1: F-1 PARTIAL, F-2 FIXED, F-3 FIXED, F-4 NOT FIXED.

## 4. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | Recommendation |
|---|---|
| L01 Daily work journey (role landing, home queue, nav) | **CONDITIONAL** — journeys and units green, but the home queue shows field-"transferred" inspection actions as open (F-5); fine for pilot if F-5 is fixed or inspection transfer buttons are hidden |
| L09 KPI trust read-only (UX side: i18n pages, chart a11y) | **GO PILOT** (UX only; note F-5 inflates inspection overdue counts that KPI pages may read — KPI seat to confirm) |
| L11 Site operations evidence (field_review_step, field_task_timing, insp switches) | **CONDITIONAL** — fix F-5 before field UAT; F-6 before general deployment (or before pilot if field-techs are viewer-tier) |
| (no lot) field outbox / service worker — always on | **CONDITIONAL** on F-5; F-1/F-2/F-3 of round 1 now closed for honest clients |
| L06 PMO extras (`ppm_offline_edit_enabled`) | not reviewed by this seat — no recommendation |

## 5. Human gates still empty in my area (RELEASE-GATES.md at b2e85cd — every decision cell blank)
- Pilot sites D-05 and field UAT (G-16/G-35) — Sponsor + Group IT
- Product — business acceptance — Sponsor / PO
- Business witness project (E-B05) — PMO
- Dashboard and tracker reviewers (G-23/G-24, DEC-6.x) — Committee
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05)
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08) — relevant to F-6 (role check on the field inspection path)
