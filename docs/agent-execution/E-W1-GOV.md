# E-W1-GOV — plan E bundle W1-GOV (E-I01, E-I04, E-G02, E-G03, E-G04, E-G05)

Source: `docs/audits/2026-11-05-expert-audit/CROSSCHECK-2-VIGPR.md` (§d prompts), plan `PLAN-E.md` (migrations 070, 071).
Every behaviour change is behind a `report_config` switch defaulting to today's behaviour, with a PILOT-PROFILE row
(`docs/ops/FLAG-REGISTER.md` regenerated). PostgreSQL only. Nothing is approved, adopted, certified or sent by code.

| Goal / audit action | Verdict | What changed | Test proof |
|---|---|---|---|
| E-I01 — audit I-01 (SLA/OLA reconciliation, prep) | FIXED (prep; decision HUMAN) | `services/slaRegister.js` (pure: per site × tech_group, resolution SLA under BOTH `slaDefinition` modes, first-reply SLA, counts, cancelled excluded, empty denominator = UNKNOWN, documented Zoho profile "to be confirmed by the ITSM owner", OLA = UNKNOWN); `tools/reports/sla-register.js` (one `BEGIN READ ONLY` transaction rolled back, `.env` first, `--fixture`); `docs/ops/SLA-REGISTER.md` generated from the fictitious fixture `tests/fixtures/sla-register.json` only | `tests/sla-register.test.js` 8/8 · `reports-cli-dotenv` green |
| E-I04 — audit I-04, P-07 link half, catalogue R07 | FIXED (switch `incubation_rfi_link_enabled`, `0`) | migration **070** `rfi_requests.source_meeting_id` (unique where not null); `meetings-db.getIncubationSource` (read helper); `governanceStore.rfiFromMeeting` (idempotent, concurrent-safe, PV refused, no project created, ledger event `from_meeting`) + `rfiLineage`; routes `GET/POST /api/governance/rfi/from-meeting/:id`, `GET /rfi/:id/lineage` (editor of the session's site / admin tier; 404 while off); RFI card on `meeting.html` (incubation mode only); R07 note | `tests/incubation-rfi-link.smoke.test.js` 4/4 |
| E-G02 — audit G-02, X-G-01 | FIXED (switch `obligations_include_decisions`, `0`) | `obligations.compose` takes `decisions`: own line, or ONCE under the commitment (`governance:<ref>` link) / session action (`decision_ref`) it produced; `registers.decisions` read/null only when asked; every line carries `href` + `focus`; `focusHref()`; `obligations.html?focus=` highlights the line | `tests/obligations-decisions.test.js` 4/4 · `obligations.smoke` 4/4 |
| E-G03 — audit G-03, catalogue A13 | FIXED (switch `agenda_cron_enabled`, `0`; policy `governance.quorum_min` default empty) | migration **071** `meeting_sessions.attendance`, `meeting_cadences.draft_agenda*`; `services/sessionAttendance.js` (present/absent/excused, quorum: not recorded / not defined / quorate / NOT quorate); `PUT /sessions/:id/attendance` (secretary, chair, deputies, committee); minutes print attendance + quorum ("quorum not defined" when empty); cockpit attendance panel (FR texts); `services/agendaDrafts.js` + job `governance.agenda_drafts` (Mon 05:10) storing a DRAFT per cadence due this week — no session created, nothing sent; `GET /cadences/:id/draft-agenda`; policy coverage probe | `tests/session-attendance.test.js` 6/6 · `governance-routes.smoke` 9/9 · `governance-policy-coverage` 33/33 · `connector-register` green |
| E-G04 — audit G-04 (structure) | FIXED (switch `controls_register_enabled`, `0`) | migration **071** `gov_controls`, `gov_control_tests`; `services/controlRegister.js` (seed = 4 CANDIDATES for checks the code runs: restore drill, role audit, secrets check, sync health — never adopted; missing period = `not_run`; pass needs an http(s) evidence link; tester ≠ owner; a fail opens ONE commitment `control_weakness` only when `commitments_enabled = 1`); routes in `routes/policies.js` (read committee; status change admin + 10-char reason, logged); panel on `policies.html` | `tests/control-register.smoke.test.js` 4/4 |
| E-G05 — audit G-05 (prep) | FIXED (doc) | `tools/agent/score-methodology.js` (`--check`) → `docs/ops/SCORE-METHODOLOGY.md`: thresholds, bands, weights, window, gate, switch, models read from the modules; composite formula quoted from the source; "nothing certified", D-03 OPEN | `tests/score-methodology.test.js` 3/3 |

Neighbour run (62 files: governance, meetings, obligations, policies, flag register, readme truth, i18n, a11y,
authz-route-matrix, server-size-budget, await-precedence, report catalogue, pg governance/meetings): **416 pass, 0 fail, 0 skipped**.

## Deviations
- E-I04: incubation RFIs use the existing kind `governance` (the RFI kind list is unchanged; scoring stays provisional at the default rubric 2/2/1).
- E-G02: back-links are provided by `focus` keys + `focusHref()` and the page highlight; adding the "see in obligations" link on each register page (commitments, handoffs, actions registers) is left — PARTIAL on that half.
- E-G03: quorum is a governance POLICY (nullable int, protected), as the goal says, not a report_config key. Adopting/retiring a control (E-G04) is API-only (no button), on purpose.
- E-G04 and E-G03 share migration 071 (two numbers for three schema changes).
- server.js untouched: the draft job is registered in `services/sync/jobs.js`; the agenda compiler is handed over by `routes/governance.js` at mount.

## Left for a person
- ITSM owner / KPI committee: reference resolution definition, per-site Zoho profiles, thresholds, OLA per resolver group and owners (E-I01); run the CLI on production and keep the output out of git.
- PMO: incubation scoring criteria; arming `incubation_rfi_link_enabled` (E-I04).
- Committee: the quorum value per site, the authorised minutes distribution list, arming `agenda_cron_enabled` (E-G03); arming `obligations_include_decisions` (E-G02).
- GRC: adopt / retire controls, frequencies, owners and testers (E-G04).
- KPI committee: D-03 and adoption of the documented thresholds and weights (E-G05).
- Browser review of the new surfaces (meeting.html RFI card, cockpit attendance panel, policies control panel, obligations focus).
