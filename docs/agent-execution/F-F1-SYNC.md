# Plan F — bundle F1-SYNC — evidence

Branch `goal/f1-sync` (from `sdp-waves` `722818b`). Goals, in order: F-ARCH-01 (merged with F-DATA-01), F-ARCH-09,
F-DATA-02, F-DATA-03. No migration. `server.js`, `reports-db.js` and `public/reports.html` are not touched.
Nothing here is an approval, a certification or a production statement.

## Verdict table

| Goal / audit action | Verdict | What changed | Test proof |
|---|---|---|---|
| F-ARCH-01 + F-DATA-01 — a skipped or unconfigured sync is recorded as a success (E04; ARCH C1-C3, N2, N3; DATA C07-C09) | FIXED (defect, no switch) | `services/sync/jobs.js`: `legacyJob` returns a typed skip (`skipped: true` or `skipped: '<reason>'`; a number is a count, not a skip) — no rows, no watermark. `services/sync/syncRunner.js`: terminal status `skipped`, reason in `meta.skipped`, watermark untouched, event `sync_skipped`. `services/sync/syncStore.js`: `health()` adds `last_skipped` + `skip_reason`; `last_ok` stays status `ok` only. `routes/sync.js`: status `not_configured` (optional job) / `skipped` (mandatory job), `last_ok` = last real collection, summary counts both. `services/sync/alerts.js`: an optional job whose newest run is a skip is not paged; a mandatory one ages and the alert names the skip. `public/system-logs.html`: the two new states are labelled. `db/postgres/sync/001_init.sql`: comment only. | `tests/sync-skip-semantics.test.js` (9, new), `tests/sync-runner.test.js` (+1), `tests/sync-routes.smoke.test.js` (+1, real PostgreSQL store, health + run log + publish gate reader). 13 assertions red before the change, green after. |
| — publication gate, dashboards, ext API, drift, data-quality board, pilot value table read a skip as FRESH | FIXED by the above | No change in `services/publishGate.js`: all of them read `status = 'ok'` runs only, which a skip no longer produces. | `sync-skip-semantics`: gate UNKNOWN with skips only; STALE 72 h after the last real collection whatever the skips; drift history holds no zero-row run. |
| — tests that pinned the defect | UPDATED | `tests/sync-jobs-registry.test.js` (G05 case: skip = `skipped`), `tests/jobs-meraki-skip.test.js` (3 Meraki jobs + Meridian), `tests/jobs-engagement.test.js`, `tests/jobs-reports-send.test.js` now expect `skipped`, no successful run, no watermark. | same files, green |
| F-ARCH-09 — `/ready` ignores runner jobs (N7) | FIXED (defect, no switch) | `routes/health.js`: `last_job_at` = the later of the legacy `sync_metadata` stamp and the newest successful `sync_runs` finish time (`syncStore.lastOkAt()`); skips and errors do not count; same public shape. | `tests/ready-probe.smoke.test.js` (4, new); `tests/api-key-injection.smoke.test.js` (d) still green |
| F-DATA-02 — WAN metrics ignore the window and the sub-site (DATA N1) | FIXED (defect, no switch) | `services/metricRegistry.js` reader `wan.latest_site`: site-level rows only (`sub_site` empty); with a window, the weekly snapshot whose period contains the window's first day, none → null; without a window, the latest snapshot (as before) and the record carries `period_start`. Four formula texts updated; `METRIC-LINEAGE.md` regenerated. | `tests/metrics-registry.test.js` (+3), `tests/dashboard-figure-parity.test.js` (+1: 4-week trend 99.9 / 96.4 / gap / 91.2, past week = its own figure). 4 red before, green after. |
| F-DATA-03 — published metrics that can never be computed (DATA N2) | PARTIAL — wiring FIXED and ON; the two programme values stay off behind `metric_programme_readers` = `0` (today) | New `services/metricDeps.js`: `build()` (full reader deps incl. `programme` and `commitmentStore`), `complete()` (adds `programme` to a route-style deps object without requiring any module), `integrity()` / `wiringOf()`. `registry.resolve()` calls `complete()`, so the six routes are wired without being edited. `load()` logs each published metric that cannot be computed. Lineage sheet has a "Reader wiring" row. Models untouched: score = `siteScore.computeSiteScore` on `siteReportDeps.scoreInputs`; composite = `siteScoreboard` on `scoreboardData`. Records carry `certified: false`. | `tests/metric-registry-integrity.test.js` (8, new, real readers on PostgreSQL): every published seed metric resolves without "reader not wired"; switch 0 = null as today; switch 1 = same number as the site report's score / the scoreboard row. |

## Deviations from the goal texts

1. **F-DATA-02, week anchor.** The goal says "the snapshot whose `period_start` is `win.from`". Snapshots are stored on
   Zoho weeks (Sunday start, `tools/meraki/sync-wan.js` → `getWeekRange`), registry weeks start on Monday, so an exact
   match would never hit. The reader takes the snapshot whose period **contains** the window's Monday (6 of 7 days in
   common). A snapshot keyed on the Monday also matches.
2. **F-DATA-02, sub-site filter in JS.** `reports-db._wanWhere` has no `sub_site` filter and `reports-db.js` is not
   editable in this wave; the reader filters the rows it receives.
3. **F-DATA-03, routes not edited.** The goal lists six route files to switch to the shared builder. Several belong to
   other bundles of this wave (`routes/dashboards.js`, report studio). The same effect is obtained inside
   `registry.resolve()` through `metricDeps.complete()`; `metricDeps.build()` exists for the routes to adopt later.
4. **F-DATA-03, "not wired" is now an error string.** A programme metric resolved with deps that cannot supply
   `programme` (a stub without `mdb` / `idb`) returns `error: 'reader not wired: …'` instead of a silent null.
5. **F-ARCH-01, optional job that lost its configuration (ARCH N3).** Its `last_ok` now stops moving, health shows
   `not_configured` with the last real date and the publication gate turns STALE. It is deliberately **not** paged
   (F-DATA-01 guardrail: no page on a skip of an optional job). Whether such a loss should send one notice is a
   decision for the service owner.
6. **Commit footer.** The session instruction names the co-author line used on these commits; it differs from the
   one printed in the older worker rules.

## Operational notes (for the merge and for operations)

- **Existing rows.** Runs recorded before this change keep `status = 'ok'` with 0 rows for past skips. They stop
  counting as fresh when they age past the job window (≤ 30 h for the Meraki / OpManager jobs; 8 days for the weekly
  jobs; 33 days for `db.restore_drill`). No migration was assigned, so nothing rewrites them.
- **Health page after deployment.** Optional jobs that self-skip (engagement without binding, purge and expiry jobs
  left off, Meraki without a key) will read `not_configured` instead of `ok`. That is the intended reading.
- **Stored metric rows.** `metric_registry` rows in a database win over the seed, so the new WAN formula text shows
  only where the row is not already stored. The reader fix applies everywhere.
- `tests/connector-register.test.js` "scheduled jobs map to connectors" fails on the base commit too
  (`engagement.schedule_reminders` has no connector row) — not caused by this bundle, not fixed here.
- Generated files regenerated in the branch: `FLAG-REGISTER.md`, `METRIC-LINEAGE.md`, `METRIC-WIDGET-MAP.md`,
  `INVENTORY.*`. `tests/.suite-manifest.json`: 3 new files, total 4491 → 4518.

## Left for a person

- Decide `metric_programme_readers` = `1` (KPI committee + the author of the two models; D-01..D-03 are open). The
  code computes; it certifies nothing.
- Decide whether an optional source that was configured and then lost its key should raise one notice (deviation 5).
- Meraki / OpManager keys on the target environment: only a real configured run proves collection (ARCH C20).
- When `reports-db.js` is open again: add `sub_site` / period filters to `_wanWhere` so the WAN reader stops
  filtering in JS; switch the six routes to `metricDeps.build()`.
- Optional clean-up of historical zero-row "ok" skip rows in `sync_runs` (needs a reviewed migration number).
