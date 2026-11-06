# E-W2-RDB — plan E wave 2, bundle W2-RDB (E-D03, E-S05, E-A02)

Agent-run on throwaway PostgreSQL schemas with fictitious data. Nothing here is a user acceptance, an approval or
a production record. Migration used: **077** only.

## Verdict

| Goal / audit action | Verdict | Proof |
|---|---|---|
| E-D03 (audit D-04) — local calendar for the remaining site-window readers | **FIXED behind `site_local_calendar`** (existing switch, default `0` = UTC) | `reports-db.js`: `_getCalendarMonthlyTop10Pg`, `_getSiteHelpdeskWindowPg` (site-report weekly chart / window metrics), `_getHelpdesk6MonthHistoryPg` raw path (the calendar path already followed D-07); helpers `localDateSql` / `readerTz` in `services/siteTimeZone.js`. At `1` each response carries `time_zone`. `tests/site-local-calendar-readers.test.js` (2): London 00:30 BST on 1 Sept → September / 1 Sept window at `1`, August at `0`; Dakar (UTC+0) unchanged; column wins; invalid zone → UTC; switch off restores UTC |
| E-S05 (audit S-08 hash part, X-SEC-02) — password work-factor upgrade path | **FIXED behind `auth_pbkdf2_iterations`** (default `100000` = today, nothing rehashed) | migration `db/postgres/reports/077_password_iterations.sql` (`users.password_iterations`, NULL = 100000; also execed in `initPgReports` before the default-admin seed); `hashPassword(p, salt, iterations)`, `passwordMatches` uses the stored count, unknown user hashed at the target; `_loginPg` rehashes once (guarded on the old hash) when stored < target; create / change / admin reset store the target; target < 100000, invalid or > 5 000 000 → 100000. `tests/password-work-factor.test.js` (5): legacy NULL row logs in untouched at default; target 210000 rehashes once, next login verifies at 210000, wrong password never rehashes, lowering the target never downgrades or locks out; set/change/reset store the target |
| E-A02 (audit A-02 first slice) — extract one inline block of `public/reports.html` | **DEFERRED** | The goal edits `public/reports.html`, which this wave reserves for W2-UX. Nothing was changed. To be run by the bundle owning `reports.html` (or after this wave's merge) |

### Response shape at the default (byte-identical rule)

At `site_local_calendar = '0'` the SQL of all three readers is the previous text and **no `time_zone` key is
added** (asserted in the test). Deviation from the goal wording "each response carries the zone used": the zone is
carried only when a local zone is applied (at `0` it is UTC by definition), so golden / PPTX fingerprints stay
unchanged. The calendar-month helpdesk reader (D-07) now also carries `time_zone` when one is applied.

### Measured PBKDF2-SHA512 cost (sandbox, 4 vCPU, Node 22, 5 runs each, `crypto.pbkdf2Sync`)

| Iterations | median | min | max |
|---|---|---|---|
| 100 000 (today) | 41.4 ms | 40.9 ms | 41.9 ms |
| 210 000 | 85.9 ms | 85.8 ms | 86.3 ms |

A sign-in at 210 000 costs ~45 ms more CPU (twice: once more on the single upgrade login). Sandbox figure only —
not measured on the production server.

## Tests

- `site-local-calendar-readers`, `pg-reports-aggregates`, `site-time-zone`, `uat-amdec-multinational-data`,
  `pptx-monthly-golden`, `site-window-readers`, `site-report-helpdesk-weekly`, `await-precedence`: 58 tests,
  54 pass, 0 fail, 4 skipped (the allowlisted "no prod-snapshot" skips of `site-window-readers`).
- `password-work-factor`, `password-compare`, `sso-login`, `login-account-throttle.smoke`, `pg-migrate`,
  `report-config`, `await-precedence`, `flag-register`, `readme-truth`: 37 tests, 37 pass, 0 fail, 0 skipped.
- `error-shape`, `secret-scan`: green. eslint clean on the touched JS. No route added (authz matrix / server size
  unaffected; server.js untouched).
- `tests/.suite-manifest.json` +2 and +5; `docs/ops/FLAG-REGISTER.md` regenerated; PILOT-PROFILE rows updated
  (`site_local_calendar` scope) and added (`auth_pbkdf2_iterations`).

## Left for a person

- Gate 8: switch `site_local_calendar` only if a non-UTC site is reported and its zone is confirmed (Owner + Finance).
- The PBKDF2 target value (crypto review; PROPOSITION e.g. 210000) and the CPU budget on the production server.
- Throttle activation `auth_account_throttle_enabled` (gate 14).
- E-A02 to be executed by the owner of `public/reports.html`.
