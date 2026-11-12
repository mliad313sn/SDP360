# E-W2-SRV — Plan E wave 2, server.js bundle (E-S02, E-A07, E-Q07, E-B07, E-B08, E-D07)

Branch `goal/w2-srv` (from `sdp-waves` at `03a7460`, not rebased). Migration used: **076** only.
Every new switch defaults to today's behaviour, has a PILOT-PROFILE row marked as a proposition, and appears in the
regenerated `docs/ops/FLAG-REGISTER.md`. Nothing here is an approval, a production action or a field acceptance.
`server.js`: 7 011 → 7 003 lines (budget lowered 7 012 → 7 003).

## Verdict table

| Goal | Audit action | Verdict | Proof (tests, all on throwaway PostgreSQL) |
|---|---|---|---|
| E-S02 | S-02 (1) consumer inventory | FIXED (tool) | `tools/security/dashkey-consumers.js`; `tests/dashkey-only-routes.smoke.test.js` "E-S02 consumer report" (route × source × days, key never printed) |
| E-S02 | S-02 (2) key-only scope | FIXED behind switch | `services/dashKeyScope.js`, `dashkey_scope_mode` open (default) / shadow / restrict + `dashkey_allowed_routes`; dashkey_call logging moved out of the `/api/` gate. Smoke: open unchanged, shadow logs one row a day and answers, restrict → 401 on an unlisted route, listed/prefix route passes, a browser request (Origin) is never affected |
| E-S02 | X-SEC-01 (3) no key in browsers | FIXED behind switch | `ui_inject_dash_key` '1' (default) / '0' → pages get `window.__akWithheld=true` instead of the key. `tests/api-key-injection.smoke.test.js` (g): index / analytics / reports / executive / executive-report served without the key, data calls (`/api/ping`, `/api/data/*`, `/api/cache/status`, `/api/reports`, `/api/reports/auth/me`) succeed with the cookie only. The deck builder's "session not recognised" banner reads the marker |
| E-A07 | A-07 journal every config change | FIXED (ON, defect) | `services/configJournal.js`; PUT `/api/reports/config` and `set-ui-policy.js --apply` write one `config_changed` row per actually changed key, secrets `{key, change:set|cleared}` only, optional `reason`. `tests/config-change-journal.test.js` (4) + `.smoke` (3): changed → one row, unchanged → none, re-save → none, secret value never stored |
| E-A07 | X-A-02 history | FIXED | `GET /api/reports/config/history?key=&limit=` (super_admin; viewer 403, anonymous 401) |
| E-A07 | X-A-04 switch prerequisites | FIXED (warnings only) | `services/switchPrereqs.js` → `warnings[]` in the PUT answer and the CLI dry run, "Prerequisites" column in FLAG-REGISTER. `tests/switch-prereqs.test.js` (3). Nothing is blocked, no owner named |
| E-Q07 | Q-07 dependency health | FIXED (agent part) | `GET /api/health/deps` (admin tier), `services/healthDeps.js`: PostgreSQL SELECT 1, Zoho token state (never the token), SMTP configured (never probed → unknown), sync jobs vs `FRESHNESS_HOURS`, last backup, restore drill, disk free. No outbound call. `tests/health-deps.test.js` (4) + `.smoke` (2): viewer 403, unknown items unknown, stale job stale. Only the existing `routes/health` mount line changed |
| E-Q07 | SLO proposal | PREPARED | `docs/ops/SLO-PROPOSAL.md` — every target `UNKNOWN — to be approved by SRE` |
| E-B07 | B-07 in-app feedback | FIXED behind switch | `ui_feedback_enabled` '0' → no button, every route 404. Migration `076_product_feedback.sql`, `routes/feedback.js`, `public/lib/feedback.js` (textContent only), shell button, answers on Home ▸ My work. `tests/feedback.smoke.test.js` (2): off → 404; on → submit/list/triage, anonymous row has no user id, XSS payload kept as text, triage journalled; `tests/feedback-shell.test.js` (3) |
| E-B08 | B-08 / X-B-01 stale block | FIXED behind switch | `ai_commentary_stale_block` '0'; `services/aiStaleGate.js` reuses publication's freshness gate; `generateRun` and the regenerate route keep the deterministic text with `error:'sources stale — AI commentary not generated'` (system_log row). `tests/ai-commentary-stale.test.js` (4): off → output identical (snapshot), on + stale/never synced → deterministic + reason, no model call |
| E-B08 | X-B-02 number check on `/api/ai/analyze` | PARTIAL | `services/aiAnalyzeGuard.js` wired with one line: `verification {verified, offending}` when the request carries `facts` (metadata only, reply never dropped; `facts` never forwarded to the provider). `tests/ai-analyze-guard.test.js` (3). **The deck builder page does not send `facts` yet** (`public/executive-report.html` untouched) — the page-side display is deferred |
| E-D07 | D-09 data-quality board | FIXED behind switch | `ui_data_quality_page` '0' → page + API 404, no nav entry. `services/dataQuality.js` (pure), `routes/dataQuality.js` (admin tier), `public/data-quality.html` + `public/lib/data-quality-page.js`. `tests/data-quality.test.js` (2): missing source → UNKNOWN, no score invented; `.smoke` (2): off 404, admin 200 / viewer 403. Router added to the existing myWork mount line, page to the existing `_htmlCache` line |

Neighbour suites run green: flag-register, readme-truth, server-size-budget, error-shape (ratchet unchanged, every new
error through `httpError.fail`), await-precedence, authz-route-matrix (AUTHZ-MATRIX regenerated), html-pages-before-static,
ui-design-ratchet (no hex literal added), i18n-coverage (`data-quality.html` listed as English admin page), a11y-static,
shell-navigation / skip-link, ui-policy (+ me smoke), admin-superadmin-gate, reporting-routes, report-studio-routes,
ai-commentary, health-version, my-work-route, agent-inventory. Last combined run: 90 + 13 + 16 tests, 0 fail, 0 skipped.

## Deviations

- E-S02: the e2e journeys with `ui_inject_dash_key=0` were NOT run (bundles run in parallel; the full e2e suite was not to
  be run). The cookie-only proof is the API smoke (g). Run `tests/e2e` once with the switch at 0 on the TEST instance.
- E-B07: `uiPolicy` gained `feedback` and `data_quality_page` (so the shell can hide entries); `tests/ui-policy*.js` updated.
- E-D07: the page and API are both 404 while the switch is 0 (spec named the page; the API follows so the board is fully
  hidden). The session check runs before the switch gate so a key-only probe still gets 401 (dash-key route census unchanged).
- E-A07: `ai_commentary_stale_block`, `ui_feedback_enabled`, `ui_data_quality_page`, `dashkey_scope_mode=restrict`,
  `ui_inject_dash_key=0` also carry prerequisites in `switchPrereqs.js` (plain words, no owner).

## Left for a person

- Integration owner + Security owner: name every key-only consumer from `node tools/security/dashkey-consumers.js --days=30`,
  give each its own key/quota, choose `shadow` then `restrict`, and `ui_inject_dash_key=0` after one browser pass on TEST.
- SRE: approve (or not) each SLI target in `docs/ops/SLO-PROPOSAL.md`; wire an external probe to `GET /ready`.
- PO: who answers feedback (B-05 RACI) before `ui_feedback_enabled=1`.
- Owner (AI): deck-builder page change to send `facts` and display `verification.offending`; `ai_commentary_stale_block=1`
  only matters once a provider is switched on.
- Data owner: a steward per source on the data-quality board; decide the two proposed warn lines (80 % / 50 %).
