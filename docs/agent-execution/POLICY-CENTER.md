# Policy Control Center — evidence

Branch `feat/policy-center` (worktree `/home/user/w/policy-center`), not pushed, not merged. Decision record:
`docs/ai-decisions/ADR-POLICY-CENTER.md`. Everything is behind `policy_center_enabled` (default `'0'`): with the
switch off, the page and every `/api/policy-center/*` route answer 404 and no code path changes (tested).

## What exists after this lot

| Piece | File |
|---|---|
| Catalogue (hand-maintained half: category, risk, four-eyes, accepted values, units/bounds) | `docs/ops/policy-catalogue.json` |
| Catalogue maintenance / completeness check (`--bootstrap` adds missing keys, never overwrites) | `tools/agent/policy-catalogue.js` |
| Run-time catalogue (defaults, types, descriptions, PROPOSED recommendations + owner roles, consumers, validation, four-eyes rule) | `services/policyCatalogue.js` |
| Four-eyes request store (migration 120) | `services/policyChangeStore.js`, `db/postgres/reports/120_policy_change_requests.sql` (+ manual rollback in `db/postgres_rollback/`) |
| API (9 routes) + page route | `routes/policyCenter.js` (mounted on an existing `server.js` line before `express.static`; server.js line count unchanged at 5708) |
| Page (no inline script, built-in strict CSP, FR/EN, tokens only — 0 hex literals) | `public/policy-center.html`, `public/lib/policyCenterPage.js` |
| Nav entry (Configure ▸ Policy control center, admin, only when the switch is on) | `public/_shell.js`, `services/uiPolicy.js` (`policy_center_page`) |
| Help §31 EN + FR | `public/help.html` |

## Catalogue size and coverage

- Code: 296 report_config keys (295 + the new switch) + 37 governance policies = 333.
- Catalogued 330, excluded 3 with a reason (`wan_poll_last_run`, `wan_poll_first_run`, `teams_sla_last_run` — runtime
  state written by pollers, not policies). Missing: 0. Plus 7 KPI RAG policies listed read-only (KPI policy builder).
- Categories: governance 50 · reporting 49 · integrations 51 · access 45 · ppm 42 · kpi (incl. money/FX) 30 · interface 26 ·
  data 21 · field 6 · operations 6 · retention 4. (One extra category, *User interface & language*, for `ui_*` keys —
  ADR §3.)
- Risk: 130 high. Four-eyes: 77 report_config keys (direction rule) + the governance store's protected rules.
- Descriptions: 245 of 330 have one from the code (85 report_config keys have no comment in reportConfig.js — shown as
  "no description in the code yet", not invented). French descriptions: the 37 governance policies only; the 293
  report_config descriptions are English-only in the code and the page says so in French ("description disponible en
  anglais seulement"). All page chrome is FR/EN.
- Recommendations: 188 rules carry a recommendation from FLAG-REGISTER.json, every one labelled PROPOSED; the others
  read "no recommendation yet". Owner roles are PROPOSED. No threshold or owner was invented.
- Consumers: files where the key is referenced (repository scan). Keys without `_` or `.` (`from`, `transport`,
  `formats`…) are marked "not scanned — too generic" instead of a noisy list.

## What is per-site capable (and what is not)

- Per site: the governance parameters marked `siteScoped` (handoffs, meetings, publication/report four-eyes and reasons,
  commitments escalation, calendar, quorum…). Consumers read them through `governancePolicy.forContext({ siteId })`.
  Tested: a site value set through the center is returned by `forContext` for that site and not for another.
- Platform only: every report_config key (no consumer reads a per-site value — none is offered) and the governance
  freshness limits (properties of a source). A site scope on those answers 400.
- Group (country / business unit) scopes stay in policies.html; the center does not expose them.

## Four-eyes rules

- report_config key flagged `four_eyes`: moving it **away from the code default** creates a pending request
  (reason ≥ 10 characters); another super_admin approves/rejects (requester refused by user id and by normalised
  identity); the requester may withdraw; requests lapse after 7 days; approval re-validates the value and refuses
  (`stale`) if the stored value changed since the request. Returning to the default is immediate. One pending request
  per rule.
- Governance parameter: the governance store's rule — relaxing a protected parameter is a two-person proposal
  (`governance.dual_approval_relaxations`), and tightening too when `governance.dual_approval_tightening` is on.
  The center lists and decides those proposals through the store (`gp-<id>`).
- Secrets: never returned, written, exported or imported by the center.
- Nothing fills a human decision field (`docs/ops/flag-decisions.json`, RELEASE-GATES); approvals are acts of
  logged-in users.

## Audit

- report_config change → `system_log` `config/config_changed` (configJournal; reason prefixed `[policy-center]`;
  secrets as set/cleared). Request lifecycle → `policy_change_requested / _approved / _rejected / _cancelled / _stale`
  (risk 1). Governance change → the governance history table + `policy_changed` / `policy_change_proposed`.
  Export → `export/policy_center_export`. Profile import → `policy_profile_imported`.
- `GET /api/policy-center/rules/:key/history` merges the journal and the request table (who, when, old, new, reason,
  second person).

## Environment profile import

Dry run returns a per-row plan (`unchanged · apply · four_eyes · governance_check · invalid · forbidden · unknown`) and a
SHA-256 `plan_hash`; applying needs `confirm: true` + the same hash and a reason (≥ 10). Rows go through the same
pipeline (four-eyes rows become requests). Tested.

## Tests run (targeted; no full suite — other agents share the disk)

| File | Result |
|---|---|
| `tests/policy-center-catalogue.test.js` (new) | 6 / 6 |
| `tests/policy-center-routes.smoke.test.js` (new) | 6 / 6 |
| `tests/ppm-rollback-scripts.test.js` (120 added to the proved set) | 2 / 2 |
| `tests/authz-matrix-json.test.js`, `tests/authz-route-matrix.test.js` (regenerated) | 7 / 7 |
| `tests/authz-outcomes.smoke.test.js` (regenerated, 9 added rows) | 5 / 5 |
| i18n-coverage, ui-design-ratchet, csp-no-inline-handlers-new-pages, a11y-static, no-native-dialogs, help-* | green |
| ui-policy, ui-policy-me.smoke, shell-navigation, shell-nav-r4, i18n-shell-charts, exec-nav-consolidated, feedback-shell | 43 / 43 |
| switch-lots, switch-lots-rollback, csp-candidate-pages.smoke, csp-headers.smoke, csp-strict-pages-config, governance-policy-routes.smoke, report-config, value-scoreboard-routes.smoke | green |
| flag-register, inventory-reachability, inventory-strict, agent-inventory, monolith-ratchet, server-size-budget, error-shape, express5-route-syntax | green |

Full-suite result: not re-run here (orchestrator runs it at merge).

## Changed authz outcome rows (docs/ops/authz-outcomes.json, all additions)

```
GET  /api/policy-center/catalogue            UUUFFFFFFFFFFFFFFFFFAAA
GET  /api/policy-center/export               UUUFFFFFFFFFFFFFFFFFAAA
GET  /api/policy-center/requests             UUUFFFFFFFFFFFFFFFFFAAA
GET  /api/policy-center/rules/:key/history   UUUFFFFFFFFFFFFFFFFFNNN   (N = unknown probe key → 404)
POST /api/policy-center/import               UUUFFFFFFFFFFFFFFFFFFFV
POST /api/policy-center/requests/:id/approve UUUFFFFFFFFFFFFFFFFFFFV
POST /api/policy-center/requests/:id/cancel  UUUFFFFFFFFFFFFFFFFFFFV
POST /api/policy-center/requests/:id/reject  UUUFFFFFFFFFFFFFFFFFFFV
PUT  /api/policy-center/rules/:key           UUUFFFFFFFFFFFFFFFFFFFN
```
Reads: admin tier only; writes: super_admin only; anonymous refused. No existing row changed.

## Other side effects

- `kpi-builder.html` is now linked (from the KPI category of the center) → removed from the `KNOWN_DEAD_ENDS` ratchet
  in `tools/agent/inventory.js` (the ratchet only shrinks).
- `/policy-center.html` added to the built-in strict-CSP list (`services/sessionAuth.js`).
- The new dark switch is classified in PROPOSED lot L13 (`docs/ops/switch-lots.json`, SWITCH-LOTS.md regenerated); FLAG-REGISTER regenerated (no decision field filled).

## What remains (human decisions — not filled here)

- Arming `policy_center_enabled` (owner: PROPOSED Platform owner / super_admin).
- Reviewing the engineering risk / four-eyes classification in `policy-catalogue.json` (130 high, 77 four-eyes).
- French descriptions for the 293 report_config keys (content work; the code has English comments only).
- Business recommendations for the 142 rules showing "no recommendation yet".

---

## Fix 14 — P11 round 4 security findings (N-R4-1, N-R4-2, N-R4-4, N-R4-3) + operations N-10 (AI evidence)

**AI evidence, not an independent human review.** Branch `fix/p11-r4-security`, worktree `/home/user/w/fix14`. No push,
merge, tag, live system or human decision field touched. Each new test was run against the unfixed code first (FAIL)
and after the fix (PASS) — the unfixed run used `git stash` of the non-test files.

| Finding | Fix | Test (fails before, passes after) |
|---|---|---|
| N-R4-1 (P2) four-eyes relaxable by one super_admin (reset to weak default; legacy PUT) | `docs/ops/policy-catalogue.json` gives 41 four-eyes keys a `strict_value` / `strict_direction`; `needsSecondPerson` is immediate ONLY towards it; reset to a weak default → request; a four-eyes key with no strict side → always a second person (fail closed). `policy_center_enabled` is now four-eyes (strict '1'). Legacy `PUT /api/reports/config` refuses a CHANGED four-eyes key with typed 409 `CONFLICT` while the center is on (unchanged with it off; re-sent unchanged fields still save). Catalogue tool refuses bad strict markers. | `tests/policy-center-four-eyes-direction.test.js` (4), `tests/policy-center-four-eyes-bypass.smoke.test.js` tests 2–3 |
| N-R4-2 (P2) center reads open to admin | catalogue / export / requests / history `requireSuperAdmin`; page + nav entry super_admin; ADR §10 | bypass smoke test 4; `policy-center-routes.smoke` updated |
| N-R4-4 (P3) hostile input → 500 | kpi diff validates `against` + ids; `kpiPolicyStore.get` refuses non-integer ids (400); tracker rollback validates `n`; `removePortfolio` unknown kind typed `INVALID`; `reportSchedule` validation errors typed; `reports-db.getReport` returns null for a non-numeric id (`/api/reports/action-departments` → 404 instead of 500) | `tests/hostile-input-r4.smoke.test.js` (5) |
| N-R4-3 (P3) Latin-alpha confusable | Latin look-alikes (ɑ, IPA letters, small capitals, stroked/dotless) added to the refusal-side skeleton; the Policy Center requester refusal now uses `skeletonKey`. `identityKey` (also used to GRANT reviewer rights and resolve accounts) deliberately stays strict. | `tests/commitment-lifecycle.test.js` two N-R4-3 tests |
| N-10 (P1, operations) catalogue under `docs/` absent from packaged installs | `tools/deploy/make-update-package.js` `RUNTIME_DOCS` ships `docs/ops/policy-catalogue.json`, `docs/ops/FLAG-REGISTER.json`, `docs/sdp360/completion/CONNECTOR-REGISTER.csv`; `policyCatalogue.build()` fails closed when the catalogue is missing/corrupt (every editable report_config rule four-eyes, `catalogue_missing` + page error); catalogue tool refuses a catalogue not in the package | `tests/policy-center-packaged.test.js` (4, incl. a scan of `path.join(…,'docs',…)` runtime reads) |

Changed authz outcome rows (`docs/ops/authz-outcomes.json`): policy-center catalogue/export/requests `…FFFFFFAAA` →
`…FFFFFFFFA` and history `…NNN` → `…FFN` (admin tier now 403); E→V (500 → 400) on
`DELETE /api/governance/portfolio/:kind/:id`, `GET /api/kpi-policies/:id/diff`, `POST /api/trackers/:key/rollback/:n`,
`PUT /api/reports/schedule`. `AUTHZ-MATRIX.md` / `authz-matrix.json`: the 4 center reads move from
`requireAdmin`/`ops.operate` to `requireSuperAdmin`/`platform.settings.manage`.

Runs: targeted batch 428/428 (policy-center, authz-enforce/handler-checks, error-shape, report-config*, commitment*,
kpi-polic*, tracker*, trackers, governance*, report-schedule*, schedule-reminders, export-policy-routes.smoke, a11y,
i18n, no-native-dialogs); post-N-10 batch 213/213 (policy-center incl. packaged, hostile, update-package, switch-lots,
readme-truth, test-runner-guard, flag-register, inventory, authz matrices, route-authz, rbac-ui-gates);
authz-outcomes 5/5. `npx eslint .` clean. Full suite not run (orchestrator).

Not solved here (recorded): `tools/ops/activate-switches.js` and direct DB writes bypass four-eyes (operator with DB
credentials); the strict side of each key is an engineering classification for Information Security to review;
R1-F2/F3/F4/F5 untouched (human decisions); R2-N3 residual unchanged.
