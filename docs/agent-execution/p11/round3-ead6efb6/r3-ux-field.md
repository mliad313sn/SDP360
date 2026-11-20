# P11 seat ux-field — ROUND 3 findings

**AI review — not an independent human review.** Seat: UX / field (role journeys, French, accessibility, design budget,
offline field app, home queue). Frozen SHA `ead6efb6439296a34915b7d9a47f7011cd15fa82` (clone `/home/user/qual/ux-field`,
`git rev-parse HEAD` checked; only the removed `docs/agent-execution/` narratives differ from the tree). Round-2 file
`r2-ux-field.md` and round-1 file `ux-field.md` were read, not modified. No product file modified.
Throwaway files (not committed): `/home/user/qual/out/r3-ux-field-attack.test.js` (run from the scratch folder
`/tmp/claude-0/p11attack-r3/uxf/tests/` so `_pg-boot.mjs` provisions its own database) and `/home/user/qual/out/r3-ux-field-dlg.js`.
Fix commits reviewed: `fcf0fab` (server: vocabulary, replay, client_ts), `c2768a4` (client: buttons, dialog, French), plus `41328be` (repro tests).

## 0. Round-2 findings — fix verification (repros re-run at ead6efb6)

| R2 finding | Repro at ead6efb6 | Verdict |
|---|---|---|
| **F-5 (P1)** field Demand/Ticket/Cancel on an inspection action stored as an open/overdue status | R2-A5: `demand` → **400** `reason=inspection_action_status`, stored stays `Open`; `helpdesk_ticket` → **400**, stays `Open`; `cancelled` → 200 stored canonical **`Cancelled`**, not overdue, not in home queue. Web route `POST /api/inspection/actions/:id/update {status_change:'demand'}` → **400 VALIDATION** (R3-N2); variant `in_progress` → stored `In Progress`. Field UI (`app.js` renderActions) shows Close + Cancel(`Cancelled`) only for inspection actions. Open/overdue SQL now `lower(status) NOT IN ('closed','cancelled')` | **FIXED**. Residual (P3, ops): rows written before the fix stay as stored; `tools/field/inspection-action-status-check.js` only LISTS them (read-only, by design) — someone must run it in prod and have owners close/cancel the `demand`/`helpdesk_ticket` rows, which keep inflating overdue counts until then |
| **F-6 (P2)** same-author replay un-submits / rewrites a submitted inspection | R2-A1: **409** `inspection_exists`, row stays `submitted`, finding stays `critical`. R2-A1b: **409**, coordinator's raised severity kept. `routes/field.js` now compares the whole stored state + status | **FIXED** |
| **F-7 (P3)** dialog Cancel blocked by `required` textarea | Real `#dlg` markup from `public/field/index.html` in Chromium: Cancel with empty comment → dialog closed, `returnValue=cancel`; empty Confirm still blocked (correct); `aria-labelledby="dlg-title"` present. Unit `field-actions-dialog-browser` green | **FIXED** |
| **F-4 (P3)** English strings reach French-first field users | The three conflict/vocabulary refusals now carry `reason` and are translated (`refusalText`, i18n.js); app-thrown literals translated. But every refusal **without a reason** still falls back to the server's English text: R3-N4 cross-site `403 "action belongs to SGO"`, missing action `400 "action not found"`, plus `validateActionPayload` / `statusTransfer.validate` texts (e.g. ticket-number format), upload errors, wrong-author 403 | **PARTIAL** |
| F-2 residual (P3 note) legacy envelopes without base_status | Future `client_ts` → **409**, missing `client_ts` → **409** (fixed). Still: `client_ts` up to +5 min accepted by design (skew window); a status changed through the inspection **editor** (`saveInspection`, no `insp_action_updates` row) is still invisible → R2-A4 **200**, `In Progress` overwritten by `Closed` | **PARTIAL** (crafted/legacy envelopes only; honest phones send `base_status`) — stays P3 |

## 1. Evidence re-run (round 3)

| # | Command | Result | SHA | Status |
|---|---|---|---|---|
| E1 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PG_ADMIN_URL=… npm run test:e2e -- --runs=1` (≈21:05→21:28 UTC 2026-11-19). Log `/home/user/qual/out/r3-ux-field-e2e.log` | 42/42 journeys pass, 0 fail, 0 skipped; browser units 8/8; `[e2e] GREEN`, EXIT=0 | ead6efb6 | **verified** |
| E2 | Prescribed NODE_OPTIONS, `node --test --test-force-exit --test-concurrency=4` on `i18n-coverage`, `ui-design-ratchet`, `a11y-legacy-ratchet`, `a11y-static`, 16 `field-*` files (incl. new `field-actions-dialog-browser`, `field-inspection-action-status.smoke`), 5 `home-queue*` — 25 files. Log `/home/user/qual/out/r3-ux-field-units.log` | 170/170 pass, 0 fail, 0 skipped, 0 todo | ead6efb6 | **verified** |

Verified: 2/2 assigned evidence items. Not verified: 0. (`chart-a11y.test.js` is not in the `a11y-*` glob and was not run by this seat.)

## 2. New claims attacked (round 3 — one per capability, not repeating round 2)

| Capability | Claim | Attack | Outcome |
|---|---|---|---|
| Field outbox — inspection | "every write path refuses a status outside the inspection vocabulary" with a clean refusal | R3-N1: crafted inspection envelope whose `actions[0].status='demand'` | Refused (nothing stored) but via `code:'VALIDATION'`, which the outbox catch does not map → **500 `internal_error`**, outbox status `failed` (= retryable); resend → 500 again. A phone holding such an entry retries forever. → **F-8 (P3)** — honest phones always send `actions: []` |
| Field outbox — replay | "own capture replayed unchanged still applies" | R3-N5: identical payload resent under a NEW uuid | 200 applied, no false conflict; same-uuid resend → 200 duplicate | **Holds** |
| Field actions | refusal text "an inspection action can only be closed or cancelled from the field app" | R3-N3: field-tech (viewer + field-tech) sends `Closed → Open`, then `Open → In Progress` with `base_status` | Both **200**: the field route lets a viewer-tier account **reopen** a closed (possibly verified) inspection action. The UI never offers it, but the server does not enforce what the message claims; the web register requires `editor` for the same change. → **F-9 (P3; P2 if field-techs are viewer-tier at pilot)** |
| French | field app French-first for refusals | R3-N4: cross-site action, missing action, meetings ticket | Raw English server text shown (no `reason`) → F-4 PARTIAL |
| Dialog / a11y | Cancel works empty; dialog named | Chromium on real markup | Holds |
| Home queue | inspection done = closed/cancelled case-insensitive | Unit `home-queue*` + A5 (`Cancelled` excluded, `Open` included) | Holds for new rows; legacy rows → F-5 residual |
| Service worker / design budget / i18n ratchet | `field-v11`, no `/api/` cached; ratchets green | E1 browser unit 7, E2 | Holds |

## 3. Findings (round 3)

**P0: 0 · P1: 0 · P2: 0 (F-9 conditional) · P3: F-4 (partial), F-8, F-9, F-2/F-5 residual notes.**

### F-8 — P3: an out-of-vocabulary action status inside a field INSPECTION envelope is a 500 / retry-forever, not a refusal
- Where: `inspection-db.js:_actionStatusError` sets `code:'VALIDATION'`; `routes/field.js` outbox catch handles `CONFLICT|INVALID|FORBIDDEN|REJECTED|WRITE_DISABLED` only → `status:'failed'`, HTTP 500.
- Repro: `R3-N1` in the attack file (PUT `/api/field/outbox/<uuid>` kind inspection, `actions:[{status:'demand',…}]`) → 500 twice, server log `[http-error …] 500 "demand" is not an inspection action status`.
- Fix: map `VALIDATION` to rejected/400 in the outbox catch (or throw `INVALID` with `reason:'inspection_action_status'`). Test: add the case to `field-inspection-action-status.smoke`. Rollback risk: nil.

### F-9 — P3 (P2 if pilot field-techs are viewer-tier): the field route lets a field-tech reopen / move any inspection action, contrary to its own refusal message
- Where: `routes/field.js` action apply — vocabulary checked, but no restriction to `Closed`/`Cancelled` for `source:'inspection'` and no editor check, while `routes/inspection.js:245` requires `editor`.
- Repro: `R3-N3` → `Closed→Open` 200, `Open→In Progress` 200.
- Fix: for `source:'inspection'` on the field path accept only `Closed` and `Cancelled` (what the UI offers). Rollback risk: low.

### F-4 — P3 (partial, carried): reason-less refusals still English (see §0).

### Residual notes (P3 / ops)
- F-5 legacy rows: run `node tools/field/inspection-action-status-check.js` against prod before pilot; owners decide each `demand`/`helpdesk_ticket` row (human/ops step, not done by this seat).
- F-2 residual: editor-path status change still invisible to legacy envelopes without `base_status`.
- R2 F-3 residual (previous user's IndexedDB copies at rest after an expiry without logout) — not re-tested this round, no fix commit seen.

**Round 3 totals: P0 0 · P1 0 · P2 0 · P3 3 (F-4 partial, F-8, F-9) + notes. Round-2: F-5 FIXED, F-6 FIXED, F-7 FIXED, F-4 PARTIAL, F-2 residual PARTIAL.**

## 4. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | Recommendation |
|---|---|
| L01 Daily work journey (role landing, home queue, nav) | **GO PILOT** — 42/42 journeys, home-queue units green, F-5 closed for new data; condition: legacy-row check run in prod |
| L09 KPI trust read-only (UX side) | **GO PILOT** (UX only; inspection overdue counts correct for new data, legacy rows need the check — KPI seat to confirm) |
| L11 Site operations evidence (field_review_step, field_task_timing, insp switches) | **CONDITIONAL** — GO PILOT once F-9 is fixed or pilot field-techs are editors of their site, and the legacy status check has been run |
| (no lot) field outbox / service worker — always on | **GO PILOT** — round 1/2 data-loss and overwrite findings closed; F-8/F-4 are P3 |
| L06 PMO extras (`ppm_offline_edit_enabled`) | not reviewed by this seat — no recommendation |

## 5. Human gates still empty in my area (RELEASE-GATES.md at ead6efb6 — decision cells blank)
- Pilot sites D-05 and field UAT (G-16/G-35) — Sponsor + Group IT
- Product — business acceptance — Sponsor / PO
- Business witness project (E-B05) — PMO
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05)
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08) — relevant to F-9 (role on the field action path)
- Dashboard and tracker reviewers (G-23/G-24, DEC-6.x) — Committee
- Production deployment GO/NO-GO — CAB
