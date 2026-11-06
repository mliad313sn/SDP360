# E-W0-SRV — expert audit of 5 Nov 2026, wave 0 (server.js serial lot)

Bundle W0-SRV of plan E (`docs/audits/2026-11-05-expert-audit/PLAN-E.md`): E-A01 → E-A01b → E-D02.
Branch `goal/w0-srv`. Tests run on PostgreSQL only (throwaway database per test file).

## server.js line count

| Step | Lines (`split('\n')`, what the budget test counts) | Budget (`tests/server-size-budget.test.js`) |
|---|---|---|
| Before (d38fa41 / 0839f51) | 7 909 | 7 910 |
| After E-A01 (survey routes) | 7 314 | 7 314 |
| After E-A01b (tracker routes) | 7 088 | 7 088 |
| After E-D02 (site routes) | **7 012** | **7 012** |

897 lines freed (`wc -l` reports one less: 7 011).

## Verdicts

| Goal / audit action | Verdict | Proof |
|---|---|---|
| E-A01 — `/api/survey*` (11 routes + helpers) moved to `routes/survey.js`, one mount line, byte-identical handlers | FIXED | `tests/survey-routes.smoke.test.js` (6) green **before and after** the move; `tests/authz-route-matrix.test.js` green and `docs/ops/AUTHZ-MATRIX.md` identical apart from the date line |
| audit A-01 (slice) / Q-03 (survey routes untested) | FIXED | same smoke: 401 anonymous, cache clears viewer 403 / admin 200, `/debug` 404 outside dev, empty-DB shapes of summary/kpis/by-dimension/voice/list/answers |
| E-A01b (1) — `/api/tracker/{load,save,import-dept-meetings,export,reset,delete-year}` moved to `routes/tracker.js` | FIXED | `tests/tracker-routes.smoke.test.js` (6): 401s, load super_admin 200 / viewer 403, save/export 400, reset 501 on PG, delete-year viewer + tracker-editor 403, GET preview unchanged; matrix unchanged; `tracker-load-scope.smoke`, `tracker-save-site-scope.smoke`, `pg-tracker` green |
| X-Q-01 — year deletion on PG had no snapshot, no journal, no test | FIXED (defect, ON) | `tracker-db.deleteTrackerYear` exports every row the cascade removes (`tracker_years`, `tracker_pillars`, `tracker_activities`, `tracker_targets_v2`, `tracker_inputs_v2`) inside the delete transaction, writes it as JSON through `services/blobStore.js` (module `tracker`, owner `year-<y>-<ts>`), returns the ref as `backup_path` + `counts`; a failed export throws → transaction rolled back → route 400. Route writes `system_log` (`category:'tracker'`, `action:'tracker_year_deleted'`, `risk:1`, details = counts, years_after, backup_path). Tests: `tests/tracker-delete-year.test.js` (2: blob holds the removed rows; forced failure leaves the year intact) + the two delete-year cases of the route smoke (journal row; unwritable blob dir → 400, year still present) |
| E-D02 (1) — `/api/reports/sites*` moved to `routes/sites.js` | FIXED | `tests/sites-routes.smoke.test.js` (5): list shape + include_inactive gate, create (executive), edit (super_admin), duplicate 400, 404, soft delete — the parity cases passed before the move |
| E-D02 (2) — `time_zone` editable, validated, audited | FIXED | `reports-db.updateSite` accepts `time_zone` (Intl-validated via `services/siteTimeZone.isValidTz`; invalid → 400; `''` clears = today's UTC path; never defaulted); PUT audits before/after; smoke: invalid 400 + unchanged, valid stored and read back by `siteTimeZone(row,'1')`, audit row before/after, clear → null |
| E-D02 (2) — `country` editable | PARTIAL (deliberate) | country stays on the existing `PUT /api/governance/sites/:id/hierarchy` (country is a governance grouping key; that route enforces the two-person rule when a move relaxes protected rules). A second write path in `updateSite` would bypass it. The card shows country read-only with a pointer |
| E-D02 (3) — site card shows/edits both + onboarding link | FIXED | `public/reports.html`: time zone input (super_admin, edit modal), country read-only, links: export CSV / JSON / onboarding checklist. i18n-coverage + reports.html static suites green. Browser check not done (login-gated) |
| E-D02 (4) — site master export | FIXED | `GET /api/reports/sites/master[?format=csv]` (super_admin): id, name, active, country, business unit, time zone, currency (`asset_site_currency`), Zoho group, codes per module; unmapped = null. Pure `services/siteMaster.js` (CSV through `csvSafe`, registered as a delegate in `tests/csv-guard-coverage.test.js`). Smoke: admin 403, JSON row, CSV header |
| X-SEC-03 — server.js budget headroom | FIXED | 2 → 898 lines of headroom freed for E-S02 / E-D07 / E-B07 / E-B08 / E-Q07 |

## Notes / deviations

- Migration 067 (assigned) was **not used**: `sites.country` (036) and `sites.time_zone` (066) already exist.
- `docs/agent-execution/INVENTORY.*` not regenerated (worker rule: done at merge) — the E-A01 goal text asked for it.
- Blobs: `services/blobStore.js` resolves its root at load time, and the test preload loads it before a test file can set
  `SDP_DATA_DIR`, so the two tracker tests write into the worktree's `data/blobs/tracker` (git-ignored) and remove it after.
- `blobStore` gained the `application/json` ↔ `.json` mapping (additive).
- The tracker delete-year snapshot is a **file** under `data/blobs`; it is covered by whatever backs up the data folder,
  not by the pg_dump.

## Left for a person

- Enter each site's real time zone (and country through Governance ▸ site hierarchy) — Owner + Finance, gate 8.
  No time zone is guessed; `site_local_calendar` stays `'0'`.
- Browser check of the site card (time zone field, export links) with a super_admin session.
- Decide retention for `data/blobs/tracker/*` year snapshots (they are never purged automatically).
