# P11 round 7 — fix lot fix/p11-r7-security (security seat)

AI-authored engineering evidence — not an independent human review. No approval, signature, production readiness or
field acceptance is claimed, and no human cell of the business-readiness pack was filled. Base `7ea49070` (trunk,
contains fixes 25–29). Findings from `/home/user/qual/out/r7-security.md` (repro `r7-probe.test.js` R7-2). The new tests
were run against the base tree and seen FAILING (5/5 of `tests/p11-r7-security.smoke.test.js`; the two route tests with
`expected 400 / actual 200` for the repro and `expected 200 / actual 400` for the blank switch), then passing.

| Finding | Sev | Cause | Fix | Regression test |
|---|---|---|---|---|
| N-R7-1 a "stricter-looking" numeric value that its reader rejects was applied by ONE super_admin while the Policy Center was on (`auth_pbkdf2_iterations` 600000 → 10000000, reader fell back to 100000; `auth_account_throttle_max` 3 → 0 / -5, reader fell back to 10) | P2 | `needsSecondPerson` judged direction with `Number(next)` only; the catalogue had no `max` for the hash cost and no `min` for the throttle; each reader kept private bounds | One table `services/policyRanges.js` (min / max / integer, no dependency) for the five numeric four-eyes keys with a `strict_direction` (`auth_pbkdf2_iterations` 100000–5000000, `auth_account_throttle_max` 1–1000, `auth_account_throttle_window_min` 1–1440, `breakglass_session_minutes` 5–1440, `emergency_access_max_hours` 1–24 — the bounds the readers already applied). Read by: the readers (`reports-db.js _pbkdf2Target`, `services/accountThrottle.js`, `services/breakglassGuard.js`, `services/emergencyAccess.js`); the generic write path (`services/reportConfig.canonicalValue` → typed 400 before the four-eyes guard, exponent / non-integer / out of range refused, stored as the plain integer); the Policy Center (`policyCatalogue.build` takes min/max/integer from the table, `validateConfigValue` refuses with 400 — so PUT and the import dry run mark the value `invalid` — and `needsSecondPerson` fails closed on an out-of-range value as a second guard). `docs/ops/policy-catalogue.json` declares the same bounds; `tools/agent/policy-catalogue.js --check` fails (`badRange`) if the file and the table drift or if a four-eyes `strict_direction` key has no range | `tests/p11-r7-security.smoke.test.js` (catalogue file = built entry = table for every strict-direction four-eyes key; each reader accepts exactly min…max; 25 out-of-range values refused by the center, the config write path and never "stricter"; the reviewer repro through the real server → 400, nothing stored, readers keep 600000 / 3, an in-range stricter value stays immediate, import dry run `invalid`, generic PUT 400) |
| Fix 26 side effect: one switch sent as `''` refused the whole settings form (400) | P3 | `canonicalValue` treated `''` as garbage | `''` / blanks for a switch = "not sent": `canonicalValue` returns `undefined`, `canonicalPatch` drops the key, `fourEyesGuard.blockedKeys` sees no change. Garbage (`null`, `'maybe'`, `[]`, `{}`, `2`, `'1 0'`) stays a 400; a real change (`'0'` on a strict key while the center is on) is still the typed 409. The admin cards in `public/reports.html` send `'1'/'0'` from their checkboxes; the blank case comes from other clients / hand-built calls | `tests/p11-r7-security.smoke.test.js` (P3 case) + `tests/report-config-switch-canonical.test.js` (`''` moved from BAD to "not sent", `canonicalPatch` drops it) |
| Register row HD-S04 still said fix 26 was not merged | P3 | stale AI-written text | `tools/release/business-readiness.source.js` HD-S04: subject, options and recommendation (AI-written cells only) now say round 7 (AI review), N-R6-1 fixed by fix 26 (merged), N-R7-1 addressed by fix 31 to be re-verified, and the known limit that a CLI holding the database URL writes outside the control; `business-readiness-check.js --write` then `--check` | `--check` green; human cells (decision, decider, date, signature) unchanged and blank |

Audit of the other numeric four-eyes keys (`node -e` over `policyCatalogue.build()`): `xof_usd_rate`,
`asset_money_certify_min_sites`, `asset_money_certify_min_pct`, `sync_truncation_tolerance_pct`,
`soft_delete_retention_days`, `access_recert_orphan_days` have no `strict_direction` — their rule is
`second_person_always`, so any change needs a second super_admin and the direction bypass does not apply.

## Pending human decision — NOT decided here (R1-F2 / SEC-F2)

Fix 26 added two route patterns to `KNOWN_OUTCOME_MONEY` in `tests/_rbac-matrix-core.js` so the committee-member
persona may read money there without failing the authorisation probe:

- `GET /api/governance/ppm/project/:id/changes` (a change request's `impact_budget`);
- `GET /api/governance/ppm/project/:id/documents` and `.../documents/:docId/download` (title / file of a money document).

Its code comment called this "not a separate decision". That was an AI classification: it **extends** the pending
R1-F2 exception (committee-member reads portfolio amounts, GAP-MATRIX invariant 2) to new routes. This lot does not
remove or confirm it; the comment now says the extension is undecided. The decision belongs to **Finance + Information
Security** (R1-F2 / SEC-F2, release-gate rows 8 and 21): the request put to them must list the four route patterns
(portfolio reads, budget periods, change-request list, money documents list/download), not two.

## Commands run

PostgreSQL (shared cluster on 5432), `SDP_TEST_RUN_ID=fix31`, prescribed NODE_OPTIONS:
`p11-r7-security.smoke` (base: 5 fail; fix: 5 pass), then four-eyes-guard, report-config*, policy-center-*,
p11-r6-security.smoke, activate-switches*, auth-*, session-*, business-readiness, authz-* (non-outcome), plus
access-revocation, approver-provenance, emergency-access*, entra-deprovision, password-work-factor, pg-reports-auth,
sso-*, p6-decisions-access, decision-lifecycle-p6, flag-decisions, uat-amdec-workflows, agent-inventory, readme-truth,
kpi-docs-links; `authz-outcomes.smoke` + `authz-outcomes-lots-on.smoke` (no route added or changed). Regenerated /
checked: policy catalogue, switch lots, flag register, RACI seed (`--check`), `tests/.suite-manifest.json` (+5),
inventory (+ strict), evidence manifest, README size block, KPI document citations (11 line numbers re-anchored after
`reports-db.js` gained one line), business-readiness register, gate dossiers (last). `npx eslint .` clean.

Left open / human: HD-S04 (turn the Policy Center on or not, after a re-check of fix 31); R1-F2 / SEC-F2 as above;
CLIs with a database URL (`tools/governance/apply-values.js`) stay outside the four-eyes control by construction.
