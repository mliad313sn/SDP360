# P11 round 9 — fix lot fix/p11-r9-field (UX / field seat: F-32, F-33)

AI-authored engineering evidence — not an independent human review. No approval, signature, production readiness or
field acceptance is claimed, and no human cell of the business-readiness pack was filled. Base `928ca8f0` (trunk).
Findings from `/home/user/qual/out/r9-ux-field.md` (F-32 P2, regression from fix 35; F-33 P3); repros
`r9-ux-field-flushqueue.spec.js` (browser) and R9-N2 / R9-N3 of `r9-ux-field-attack.test.js`.

**Failing first.** Each new test was run against the base version of the product file it covers (that file restored
from `HEAD`, the tests unchanged):

- `tests/p11-r9-field-fixes.test.js` (4, runs the page's own drain functions in a VM) against base
  `public/inspection.html`: **4/4 failed** — the drained open form kept `server_version` `v1` while the server was at
  `v2`; the stored draft kept `v1`; two concurrent drains both sent `v1`; no shared write-back.
- `tests/e2e/f2-inspection-queue-version.spec.js` (real Chromium, real server, PostgreSQL) against base
  `public/inspection.html`: **failed** on its first step — Save now #1 whose retry was stored by the queue reported
  `false` ("Server queued"), the same path that made the next Save now a false 409 in the review.
- `tests/p11-r9-field-fixes.smoke.test.js` (3) against base `inspection-db.js`: **3/3 failed** (R9-N2: editor 2's
  action and its comment deleted by a versionless save; a removal named by a versionless client deleted an action
  carrying another editor's history; an old draft with derived ids deleted an action by omission).

With the fix: 4/4, 1/1 and 3/3 pass.

| Finding | Sev | Fix | Regression test |
|---|---|---|---|
| **F-32** a save stored by the offline queue drain (`flushQueue`) left the form on its old `server_version`, so the user's next Save now was refused 409 "changed by someone else" although nobody else saved; "Save now #1" also said "Server queued" although the server had the data; same after a reload (boot drain) | P2 | `public/inspection.html`: the write-back Save now did after a successful save (stamp stored action ids, refresh status/owner bases, merge `kept_rows`, clear applied removals, take `version`, rebuild `known_action_ids` from `action_ids` + `kept_rows`, refresh `base_fp`) is now ONE function, `applySaveOutcome(st, out, sentActions, sentRemoved)`, used by **both** `forceSyncNow` and the queue drain. The drain applies it to the copy it sent: the open form (then persists it locally, clears the dirty flag, shows the kept-row notices) or the stored draft (`DRAFTS.put`). Drains are **serialised** (`flushQueue` chains `flushQueueOnce` on a promise): boot, Save now and the sync pill can start one at the same time, and two drains sending the same draft with the same version would make the second a false conflict — each drain now uses the version the previous one stored. `forceSyncNow` reports success when its own immediate drain stored the inspection (no more "Server queued" for data the server has). | unit (VM over the page's own functions): open form takes version / ids / base; a queued draft that is not open is updated in the store and a second drain sends the returned version; two concurrent drains never resend the consumed version; static wiring. Browser journey `f2-inspection-queue-version`: abort → drained → Save now 200; offline twice → two drains together → no 409 → Save now 200; offline → reload → boot drain stores → Save now 200; no dialog |
| **F-33** clients that send no `server_version` (a tab opened before fix 35, an old offline draft) still saved last-write-wins and could delete another editor's action and its history | P3 | `inspection-db.js` `_upsertActionsPg`: a save of an **existing** inspection with no `server_version` (`versionless`) **never deletes a stored action by omission** — every unmatched row is kept and returned in `kept_rows` (the current form merges them and its next save names them). An explicit `removed_action_ids` entry deletes the action only when it has **no history written by someone else** (`insp_action_updates.author_id` different from the saver, or unknown); otherwise it is kept too. Updates and additions are unchanged. A save **with** a version keeps the full fix-35 behaviour (version check, removal by name). New inspections and the field app (create-only, identical replay) are unaffected. | smoke: R9-N2 (versionless tab: editor 2's action + comment kept and returned, own update and addition applied); versionless removal deletes own/no-history actions, keeps one commented by editor 2; old draft with derived ids keeps an omitted action, the current form still removes a named one |

Updated assertions (wording moved, not weakened): `p11-r8-field-fixes.test.js` now finds `server_version = out.version`
in `applySaveOutcome` and `inspection_changed` in `flushQueueOnce`; `p11-r7-field-fixes.test.js` finds
`mergeKeptRows(st, out.kept_rows)`; `inspection-local-draft.test.js` builds the drain body (`flushQueueOnce` + its two
helpers). `docs/kpi/DECISION-KPIS-PROPOSAL.md` re-anchored (`inspection-db.js:1209`). No migration, no route added.

## Transition rule for old clients (F-33 residual)

A versionless client is now safe for **actions** (nothing of anyone else is deleted), but it still cannot detect that
the inspection changed: its header fields, findings and notes overwrite whatever another editor saved meanwhile
(whole-inspection last-write-wins for those fields, as before). Such clients need **one reload** of the inspection page
(assets are versioned; `inspection.html` is no-cache) to get full conflict detection. Offline drafts created before
fix 35 have no `server_version`: Save now them before other people edit the same inspection, or reopen the inspection
from the server first. Refusing versionless saves of existing inspections outright (409 after a transition window) was
not done: it would strand offline drafts; it remains an option for a human product decision.

## Tests run (this worktree, PostgreSQL throwaway databases `*fix38*`)

- New: `p11-r9-field-fixes` 4/4, `p11-r9-field-fixes.smoke` 3/3, e2e `f2-inspection-queue-version` 1/1.
- Related: `inspection*`, `pg-inspection`, `soft-delete*`, `field-*`, `p11-r7-field*`, `p11-r8-field*`, `i18n-coverage`,
  `ui-design-ratchet`, `a11y-*`: 312/312 green. Every test file naming `inspection.html` / `inspection-db`, the field
  browser tests, `await-precedence`, `monolith-ratchet`: 303 pass, 0 fail (6 skipped by design).
- `kpi-docs-links`, `readme-truth`, `e2e-harness`, `persona-matrix`: green. Inventories regenerated (`ui-inventory`,
  `inventory` + `--strict`, `evidence-manifest`), suite manifest +7 (total 6057), eslint clean.
- E2E journeys: 44/44 + 8/8 browser units green (closing line below).

## Residuals and human decisions left (not decided here)

- Whether to refuse versionless saves of existing inspections after a transition window (product decision).
- The reapply notes of the review stay open: a local edit to an action the other editor deleted is dropped without
  notice; the `__conflict_backup` copy has no restore UI and is never cleaned (P3).
- Field UAT (A2-01…A2-07), the pilot rule ("after deploy, reload open inspection tabs"), CAB deployment: human.

**E2E closing line:** `npm run test:e2e -- --runs=1` (Chromium 1248): **44/44 journeys** (including the new
`f2-inspection-queue-version`) + **8/8 browser unit tests GREEN**.
