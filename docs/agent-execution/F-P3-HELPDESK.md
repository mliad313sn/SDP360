# F-P3-HELPDESK — A7 (stop flattering the SLA) + A8 (voice of the user)

Bundle P3 of the 2026-11-12 goal programme (`docs/audits/2026-11-12-goal-programme/`). Branch `goal/p3-helpdesk`,
base `7f8c68b`. PostgreSQL only. Nothing here is deployed; the headline-definition switch is OFF (today's behaviour).

## 1. Gap matrix (after this bundle)

### A7 — Stop flattering the SLA

| Clause | Status | Evidence | Fix made |
|---|---|---|---|
| "Open & breached" count | IMPLEMENTED | rule `public/lib/slaDual.js` `openResBreached` / `openFrBreached`; SQL mirror `services/slaDefinition.js` `OPEN_RES_BREACHED_SQL` / `OPEN_FR_BREACHED_SQL`; readers `reports-db.js` `_getCalendarMonthlyHelpdeskPg` (`sla_res_open_breached`, `sla_reply_open_breached`) and `_getMonthlyHelpdeskHistoryPg` (`Open Breached (resolution)` / `(first response)`); browser `dashboard-shared.js` `dualSlaRates`; weekly cards `server.js` `/api/reports/helpdesk-charts` (`res_open_breached`, `fr_open_breached`) | new |
| Dual compliance rate (closed-only vs incl. open past target), resolution + first response | IMPLEMENTED | `SlaDual.dual()`; `sla_res_pct_incl_open` / `sla_reply_pct_incl_open` (+ `*_den_incl_open`), `% of SLA Violated (incl. open past target)`, `res_ok_pct_incl_open` / `fr_ok_pct_incl_open`, payload `sla_compliance_incl_open` / `frt_sla_incl_open`, Exec View `value_pct_closed_only` / `value_pct_incl_open` | new |
| Label closed-only metric explicitly | IMPLEMENTED | Helpdesk tiles "(closed tickets only)" / "(responded tickets only)"; scorecard "(closed tickets only)"; Exec View "Answered within SLA (closed tickets only)"; site report weekly cards + monthly table headers; `sla_definition: 'closed_only'` on reader + payload | new |
| Align helpdesk tiles, weekly report, scorecard, Exec View on the same definition | IMPLEMENTED (one rule, two adapters) | browser rows and server SQL both follow `slaDual.js` (the SQL is its documented mirror); the calendar reader computes the rates through `SlaDual.dual()` itself | — |
| PROVE: hand-computed fixture matches both rates | IMPLEMENTED | `tests/sla-dual.test.js` (browser, 11-ticket fixture: 66.7 % / 33.3 %, 3 open & breached; FR 66.7 % / 50 %), `tests/sla-dual-pg.test.js` (same fixture in PostgreSQL: 67 / 33, boundary + on-hold + cancelled + no-rule + stale pending flag) | — |
| PROVE: no tile mixes definitions | IMPLEMENTED | `tests/sla-tile-definitions.test.js` — every `data-metric-key=*sla*` tile carries `data-sla-definition`; each SLA card/label on index / executive / exec-view / reports names its definition; the other rate rides below, labelled | — |
| Headline choice = KPI-committee decision | IMPLEMENTED-DARK | `report_config sla_headline_definition` default `closed_only` (`services/reportConfig.js`), reaches the browser as `__uiPolicy.sla_headline` (`services/uiPolicy.js`) and the Exec View through `mapHelpdeskKpis` cfg; PILOT-PROFILE row + regenerated FLAG-REGISTER | — |

Rule details (`public/lib/slaDual.js` header): open & breached = open (not closed, not cancelled) **with an SLA rule** (flag or
due time) and EITHER the stored flag late OR (not on hold AND due strictly before as-of). As-of = the period's exclusive end, or
now while it runs. A ticket due exactly at as-of has not missed it; on hold = SLA paused (only the flag counts — the
`isResOverdue` semantics for open tickets). First response: open, not cancelled, unanswered, flag late (no first-response
due time is synced). Server side also excludes a closed `request_status` with a stale `pending_status = 1` (the 2026-08-03
ageing guard). No base → null.

### A8 — Voice of the user

| Clause | Status | Evidence | Fix made |
|---|---|---|---|
| CSAT/NPS tiles per site and group | IMPLEMENTED | `GET /api/survey/voice-tiles` (`routes/survey.js`) → pure `services/voiceTiles.js` over `reports-db.getSurveyVoiceTilesDB`; Helpdesk page panel "Voice of the user" (by Site / by Group) | new |
| Response rate (denominator stated) | IMPLEMENTED | `response_rate_definition`: scored replies on tickets created in the month ÷ those tickets that are closed; null when nothing closed | new |
| Trend | IMPLEMENTED | 6-month CSAT/NPS per tile (`trend`, null months stay null) | new |
| Verbatim drill-down permission-filtered | IMPLEMENTED | `/api/survey/voice` filters the fleet cache per request by the caller's groups (`services/siteGroups.js`); `?groups=` only narrows; `/api/survey/:id/answers` and `/api/survey` list filtered in SQL (`_surveyGroupClause`) | **invariant-1 hole closed** |
| Scores perimeter (kpis, by-dimension, summary) | IMPLEMENTED | non-admin → own groups (requested ∩ own), never the fleet caches | new |
| Link to helpdesk volumes | IMPLEMENTED | each tile carries tickets created / closed (the response-rate base), same page as the helpdesk KPIs | new |
| PROVE: no response ≠ 0 | IMPLEMENTED | `tests/survey-perimeter.smoke.test.js` (quiet site: csat/nps null, state `no_responses`; trend month null) | — |
| PROVE: site perimeter on verbatims | IMPLEMENTED | same file: editor sees only site A's verbatim, admin all, site-less none; foreign reply answers read as none (no existence oracle) | — |
| PROVE: sync failure shows unknown | IMPLEMENTED | same file: `sync_metadata` failure newer than the last success → `freshness.state = 'unknown'` + cause, every tile `unknown`; never-run sync → unknown | — |
| Métier accounts 403 | unchanged | the new route is outside `services/businessGuard.js` ALLOWED → 403 (live router walk `tests/business-only-boundary.smoke.test.js`) | — |

## 2. Code changes (wired end-to-end)

- `public/lib/slaDual.js` (new UMD rule) · `public/lib/dashboard-shared.js` `dualSlaRates` · `services/slaDefinition.js` SQL mirror + `monthAsOfIso`.
- `reports-db.js`: calendar reader + monthly history carry the A7 fields; survey readers take `groups`; new `getSurveyVoiceTilesDB`.
- `services/execSummary.js` (both rates, headline switch), `services/reportPayload.js` (incl-open fields, `sla_definition`), `services/metricRegistry.js` (pass-through), `services/reportConfig.js` + `services/uiPolicy.js` (switch).
- `services/siteGroups.js` (extracted from `server.js`, now shared by helpdesk-live/charts and survey), `services/voiceTiles.js`, `routes/survey.js`.
- UI: `public/index.html` (both SLA tiles + Voice panel + drill), `public/executive.html` (scorecard SLA tile), `public/exec-view.html`, `public/reports.html` (weekly SLA cards, monthly table — not the infra prefill region).
- Docs: `docs/kpi/FORMULA-REFERENCE.md` (A7 rows), PILOT-PROFILE + FLAG-REGISTER, chart inventory, re-anchored KPI docs.

## 3. Tests

New: `sla-dual` (8), `sla-dual-pg` (3), `sla-tile-definitions` (6), `survey-perimeter.smoke` (5). Updated: `ui-policy`,
`ui-policy-me.smoke` (new `sla_headline` key, default `closed_only`). Regression run listed in the final report.
Goldens (PPTX fingerprint, monthly e-mail) were **not** regenerated — the deck/e-mail renderers do not read the new fields.

## 4. Rollout note

- **Additive by default**: the headline numbers are unchanged (closed-only, now labelled); the incl-open rate and the
  open & breached count appear beside them. The survey perimeter fix changes what non-admin accounts see (fewer verbatims and
  scores — their own sites only): that is the invariant, not an option.
- **Canary site**: Houndé (HGO) coordinator account — check the two SLA tiles, the Voice panel and the drill-down show only HGO.
- **Rollback trigger**: (a) incl-open rate missing/`—` on a site with tickets after a full requests sync, or a breach count
  that disagrees with SDP's "overdue open" view by > 5 %; (b) a coordinator sees another site's verbatim. Rollback = redeploy
  the previous ZIP (no migration, no data written).
- **Switch**: `sla_headline_definition` (KPI committee, default `closed_only`) — changing it only swaps the big number.
- **Owner**: KPI committee (headline definition); Service & Support Manager (helpdesk tiles, Voice panel); data-protection
  officer may review verbatim visibility rules.
- `scorecard-viewer` accounts without the admin tier and without a site now see **no** verbatims/scores on the survey routes
  (invariant 1: no site = nothing site-scoped). If executives without admin rely on the Customer Voice tab, give them a site or the
  admin tier — a human decision.

## 5. Value metrics to instrument (before / after)

- **True breach count**: open & breached (resolution, first response) per site per month — baseline = today's closed-only
  violation count; the gap between the two rates is the "flattering" margin.
- **MTTR**, **backlog aging** (existing readers) — watch they move with the open-breach count.
- **CSAT trend** and **response rate** per site (voice tiles), correlation with backlog (inbound/closed on the same tile).

## 6. Residual gaps

- No registry metric keys for the incl-open rates (fields travel on the record; publishing them as `helpdesk.*_incl_open`
  metrics + KPI docs is a KPI-committee follow-up).
- Deck builder (`executive-report.html`), PPTX decks and the monthly/weekly e-mails still show only the closed-only rate
  (goldens intentionally unchanged); the payload now carries the incl-open fields for a later render.
- Open & breached on the browser uses `isClosed` (pending flag first); the server additionally treats a closed status with a
  stale `pending_status = 1` as closed — a 2026-08-03 data repair makes both agree.
- The verbatim drill-down filters by reply month, the tile by ticket-creation month (both stated on screen).
- Scorecard tile uses the incl-open rate only on server month rows (`/api/data/monthly-summary`); raw-aggregation paths stay
  closed-only and say so.
- Browser E2E (login-gated pages) not run by the agent — user step.
