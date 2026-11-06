# E-W2-ITSM — Plan E wave 2, ITSM bundle (E-I02, E-I03, E-I06)

Branch `goal/w2-itsm` (from `sdp-waves`). Migration number used: **074 only** — `db/postgres/reports/074_pir_reviews.sql`
(E-I03) and `db/postgres/inspection/074_insp_action_verify.sql` (E-I06; the inspection area runs after `reports`, so the
`insp_actions` columns could not live in a reports-area file — same precedent as `inspection/049`). Every new switch
defaults to today's behaviour and has a PILOT-PROFILE row; FLAG-REGISTER, REPORT-ALERT-CATALOGUE, AUTHZ-MATRIX,
INVENTORY regenerated. No edit to `server.js`, `reports-db.js`, `public/reports.html`.

## Verdict

| Goal / audit action | Verdict | Proof |
|---|---|---|
| E-I02 — recurring-incident candidates, site (Zoho group) × category × sub-category, threshold from `problem_candidate_min` (empty = none) | FIXED (shadow, `problem_candidates_enabled`='0') | `tests/problem-candidates.test.js` (5: empty threshold → none, open+closed counted, cancelled apart, no Zoho group → null, `(none)` grouping) · `tests/problem-candidates.smoke.test.js` (3: switch 0 → 404 list + promote, other site 403, group scope ignores `request_records.site`, promote idempotent, key/site mismatch 400) |
| E-I02 — "promote to commitment" reusing the commitment creation, owner chosen by a person | FIXED | new source system `problem_candidate` (`<site>\|<cat>\|<sub>`, site-checked like meetings/inspection sources); panel on `public/commitments.html` asks for the owner; wording "candidate — causality not validated" |
| E-I02 — "one appended reader in reports-db.js" | DEVIATION | `reports-db.js` belongs to W2-RDB: the PG reader `loadSiteIncidents` lives in `services/problemCandidates.js` (via `rdb.pgHandle()`, `substr(created_time,1,10)` filter). Can be moved to reports-db at merge if wanted |
| E-I03 — `pir_reviews` record (decisions, window, before/after counts, linked commitments, author, sign-off) | FIXED (`pir_reviews_enabled`='0') | `tests/pir-review.test.js` (3: after = null until the window elapses, measured 0 when elapsed, idempotent create, stale version 409, SELF_REVIEW, sign-off freezes / read-only) · `tests/pir-review.smoke.test.js` (2: switch 0 → 404, other site 404, non-MI 404, RCA from UDF, author cannot sign, another site editor can) |
| E-I03 — RCA/CA/PIR/LL shown from the existing UDF readers | FIXED | detail route reads `udf_json` with `roadmapEvidence.INCIDENT_UDF_VARIANTS`; list from `getMajorIncidentsHistory(12)` |
| E-I03 — catalogue R15 updated + doc regenerated | FIXED | `tests/report-catalogue.test.js` + `catalogue-dry-run` green |
| E-I06 — repeat findings (≥2 of the site's last N submitted inspections, N from `insp_repeat_window`, empty = off) on inspections.html | FIXED (`insp_repeat_findings`='0') | `tests/inspection-repeat.test.js` (4) · smoke: window empty → nothing, N=3 → repeat, other site 403 |
| E-I06 — closing a Critical/High action needs a verifier who did not close it | FIXED (`insp_action_verify_enabled`='0') | `tests/inspection-verify.smoke.test.js` (3): switch 0 → close unchanged + response shape unchanged + verify/repeat 404; switch 1 → "awaiting verification", SELF_VERIFY 403, other site 403, Medium 400, independent verify OK, verification survives the form re-save |
| E-I06 — catalogue R06 updated | FIXED | `services/reportCatalogue.js` R06 gates + note |

Neighbour runs (PostgreSQL 16 local, per-file throwaway DB): 219 / 219 pass, 0 skipped — inspection*, pg-inspection,
soft-delete-inspection, commitments-routes.smoke, commitment-source-scope.smoke, report-catalogue, catalogue-dry-run,
error-shape (ratchet 446 unchanged — new denials use `httpError.fail`), ui-design-ratchet (no new hex), readme-truth,
flag-register, await-precedence, authz-route-matrix, i18n-coverage, server-size-budget, a11y-static,
html-pages-before-static, site-actions*, migrate*.

## Known limits (stated, not hidden)

- A Critical/High action closed **in the inspection form** (not through the register) records no `closed_by`; the
  verify route then falls back to the last "Closed" audit row and reports `closer_known:false` when there is none.
- Problem candidates read incidents only (`request_type` contains "Incident"); ServiceDesk Plus Problem records are
  not synced (X-I-01) — no connector or view was added.
- The PIR record has no PDF; the before/after counts are computed live until sign-off, then frozen.

## Left for a person

- **E-I02**: the recurrence threshold `problem_candidate_min`; who is problem owner; whether the SDP/Analytics admin
  publishes a Problem view (X-I-01). Turning `problem_candidates_enabled` on.
- **E-I03**: who signs a PIR review and the business sponsor per major incident; turning `pir_reviews_enabled` on.
- **E-I06**: the window N (`insp_repeat_window`) and which priorities need independent verification (built: Critical
  and High); turning the two switches on.
- Browser review of the three panels (commitments.html candidates + PIR, inspections.html repeat findings,
  inspection-actions.html verify) with real accounts — not exercised here.
