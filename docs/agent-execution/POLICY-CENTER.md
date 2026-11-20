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
