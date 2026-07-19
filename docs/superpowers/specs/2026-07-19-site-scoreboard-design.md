# Unified Operational Site Scoreboard (on the IT Review) — Design Spec

**Date:** 2026-07-19
**Status:** Approved (design) — pending spec review + user review before planning.
**Branch (impl):** `feat/site-scoreboard` (from `main`).

## Goal

A per-site **operational scoreboard** the Service Desk Manager can project in the monthly meeting and auto-mail to coordinators — a single comparable RAG score per site that combines the **four operational worlds**: helpdesk (SLA), inspections (conformity), meetings (5-Engagements), assets (data-hygiene effort). The point is peer accountability: every site sees where it stands against the others, so nobody wants to be last.

It is grafted onto the existing **IT Review Dashboard** (`it-review.html`) as an **additive** panel, and it drives a **scheduled coordinator e-mail** (full leaderboard, each coordinator's own row highlighted).

## The non-negotiable framing (his model is untouched)

The IT Review already renders the **author's authoritative** per-site scores — `sbDims` (`services/siteScore.js`, RAG 70/45) and `composite` (`services/siteComposite.js`, RAG 75/55) — both over **meetings + inspection only, no helpdesk, no assets**. **This scoreboard does NOT touch, extend, or retune either.** It is OURS, additive, riding in via the SAME `opts.extras` mechanism as the existing Helpdesk & Changes panel:

- `buildReviewVals(D, opts)` (`services/reviewDashboard.js`) with NO extras emits **exactly the author's 61 keys**. Our panel adds **only** `sbuRows` + `sbuNote` when `opts.extras.scoreboard` is present. It **never re-enters** `sbs`/`comps`/`codes` (the scoring path) — it structurally **cannot** reach his numbers.
- `tests/review-fidelity.test.js` enforces this: the no-extras call must deep-equal his 61 keys, and a second test pins the WITH-extras additions to a **declared allowlist** — extended from `['hdNote','hdRows']` to `['hdNote','hdRows','sbuRows','sbuNote']`.
- We edit **neither** `siteScore.js` nor `siteComposite.js`.

**Labelling (on the page):** his panel stays "Score programme (modèle de référence)"; ours is clearly **"Scoreboard opérationnel — 4 dimensions (helpdesk · inspections · réunions · actifs)"**. The two may show a different RAG for the same site — that is two lenses, by design (the project already ships `sbDims` and `composite` disagreeing). No reconciliation is attempted or needed.

## User decisions (locked)

- **Weighting:** **weighted, helpdesk heavier — Helpdesk 40 % · Inspections 20 % · Réunions 20 % · Actifs 20 %**, a **fixed documented constant** (NOT a config knob).
- **Missing data:** score = weighted mean over the **present** dimensions only, weights **renormalized** to sum to 1 over the present dims; a coverage note "basé sur N/4 dimensions". A site with **0 present dimensions → `applicable:false` ("non applicable")** — never a false 0.
- **RAG:** **green ≥ 75 · amber 55–74 · red < 55**.
- **Delivery:** the page AND the scheduled coordinator e-mail now (the composer feeds both).
- **E-mail form:** each coordinator receives the **full leaderboard, their own site highlighted** (the peer-pressure artefact). Armed OFF by default; never sends to an unconfirmed recipient.

---

## Substrate (verified — reuse map)

| Dimension | Ready 0-100 per site? | Source |
|---|---|---|
| **Assets** | ✅ direct | `assets-db.js getEffortLeaderboard({asOf}).rows[].effort_score` (0-100, keyed by a free-form `site` string) |
| **Meetings** | ✅ (0-1 → ×100) | `meetings-db.js insights({from,to,site}).site_leaderboard[].score` (mean of E1/E2/E3/E5, 0-1) |
| **Helpdesk** | ✅ monthly | `reports-db.js getCalendarMonthlyHelpdesk(site_id, year, month).sla_res_pct` (0-100 resolution SLA; null when no verdict) |
| **Inspections** | ⚠️ derive — SAME FORMULA as the page, month-scoped | `getSiteScoreInputs(code,…).findings` is **critical+major COUNT only** (no total) — can't yield a ratio. Use the SAME formula the on-page `inspSiteRows` uses — `100 × ok / applicable` (`applicable` = findings status ≠ `'na'`, `ok` = status `'ok'`) — from `inspection-db.js aggregate({site,from,to}).findingStatus` (`[{status,n}]`): `applicable = Σn where status≠'na'`, `ok = n where status='ok'`; present iff `applicable>0` → `round(100×ok/applicable)`, else null. **Note the window differs deliberately:** his `inspSiteRows` runs over `D.findings` (all-time, un-windowed — `reviewData.js` keeps the full history on purpose), while the scoreboard is **month-scoped like all its other 3 dims**. So the two conformity numbers may differ by window; that is stated in `sbuNote` ("scoreboard = mois courant"), same as the project's existing "score window ≠ report window, both surfaced with their window stated" doctrine. We do NOT claim numeric agreement — we use a recognizable method over the scoreboard's own monthly window. |

- **Site crosswalk:** `reports-db.js site_module_codes(site_id, module, code)` + `getSiteIdByModuleCode(module, code)` → `{site_id, name, zoho_group}`. The reporting suite pins the **meetings** namespace as canonical (`services/siteReportDeps.js MODULE_NS='meetings'`) and resolves `site_id`/`zoho_group` from it. We do the same: iterate the meetings-namespace site codes, resolve each once, then fan out to the four readers.
- **Assets reconciliation:** `getEffortLeaderboard` is keyed by the free-form `asset_effort_history.site` label, NOT `site_id`. We add an **`assets` namespace to `site_module_codes`** (seeding the distinct AP labels → `site_id`) and join effort rows by `getSiteIdByModuleCode('assets', label).site_id`, then match the iterated canonical site by `site_id` (NOT an accent-fold guess). A site with no matching effort row → assets dimension **absent** (null), not 0. **Many-labels-to-one-site:** SGO is "Sabodala-Massawa" — seed BOTH `Sabodala` and `MASSAWA` labels → the same SGO `site_id`; when >1 effort row resolves to one `site_id`, combine into one assets score by **asset-weighted mean** (weight each row's `effort_score` by its `total` asset count; fall back to a simple mean if `total` is absent) — do NOT let the crosswalk be last-write-wins.
- **Scheduled-email plumbing (all present):** `reportSchedule.js` (`TYPES`, `cliFor`), `reportDirectory.js` (`resolveRecipient(db, siteCode, kind)` + `neverSendUnconfirmed`), `mailer.js`, `reportSentLog.js`, `reportConfig.js` (DEFAULTS/KEYS arm toggles). **Exemplar to copy:** `services/assetHygieneReport.js` (`buildHygieneDigest`) + `tools/reports/send-hygiene.js` (`decideHygieneSend` gate, **armed-off, gate-FIRST — a disarmed run composes/mails/logs nothing**, exports `{decide*, main}`).

---

## Architecture

```
IT Review page  (it-review.html)  — additive panel "Scoreboard opérationnel"
  server.js GET /api/reports/review-data
    → loadReviewData(asOf) → D  (meetings+inspection only; NO helpdesk/assets)
    → loadScoreboardData({codes, month, asOf, deps})   ← NEW glue, gathers the 4 dims per site
        · helpdesk : getCalendarMonthlyHelpdesk(site_id, y, m).sla_res_pct
        · meetings : insights({from,to,site}).site_leaderboard[].score ×100
        · inspections : conformity% = 100×ok/applicable from aggregate().findingStatus (month-scoped)
        · assets   : getEffortLeaderboard({asOf}).rows[] matched by site name
      → services/siteScoreboard.js  buildSiteScoreboard(perSite, {prev})   ← PURE
    → buildReviewVals(D, { …, extras: { …hd…, scoreboard } })
        → emits sbuRows + sbuNote  (allowlist-guarded; his 61 keys untouched)

Scheduled e-mail (monthly)
  tools/reports/send-scoreboard.js  (armed-off, decideScoreboardSend gate, dedup, --preview)
    → services/siteScoreboardReport.js  buildScoreboardDigest(scoreboard, {period, highlightSite})
    → per confirmed coordinator recipient (reportDirectory) → mailer → reportSentLog
```

### 1) PURE composer — `services/siteScoreboard.js`

All the scoring math, no DB, deterministic (caller passes everything in).

```
const WEIGHTS = { helpdesk: 0.40, inspections: 0.20, meetings: 0.20, assets: 0.20 };  // fixed, documented
const RAG = { green: 75, amber: 55 };  // >=75 green, >=55 amber, else red

buildSiteScoreboard(perSite, { prev } = {}) → {
  rows: [ {
    code, name,
    score,                 // weighted mean over PRESENT dims, weights renormalized; null if none
    rag,                   // 'green'|'amber'|'red'|null
    applicable,            // false when 0 present dims
    dims: { helpdesk:{value,rag}|null, inspections:{…}|null, meetings:{…}|null, assets:{…}|null },
    coverage: { present, total: 4 },
    delta,                 // score − prev score, or null
    rank                   // 1-based over applicable rows, score desc (tie → code asc)
  } ],
  fleet_avg,               // mean of applicable scores (null if none)
  most_improved,           // applicable row with max positive delta, else null
  needs_attention,         // lowest applicable score < 55 (red), else null
}
```
- `perSite` = `[{ code, name, helpdesk, inspections, meetings, assets }]` where each dim is a number 0-100 **or null** (absent). Values clamped to [0,100] defensively.
- **Weighted mean with renormalization:** `present = dims with a non-null value`; `score = round( Σ(WEIGHTS[d]·value[d]) / Σ(WEIGHTS[d]) over present )`. 0 present → `score=null, applicable=false, rag=null`.
- Each present dim gets its own RAG via the same 75/55 thresholds (so the cell colours in the mockup).
- `delta`: needs `prev` = a prior `perSite`-shaped map keyed by code (the previous month's inputs run through the same weighting). No prev for a site → `delta=null`. `most_improved`/`needs_attention` ignore null-delta / non-applicable rows.
- Exported so both the page glue and the e-mail composer call the SAME function.

### 2) Glue reader — `loadScoreboardData({ month, asOf, deps })`

Lives next to `loadReviewExtras` (in `services/reviewData.js` or a new `services/scoreboardData.js`), deps-injected for tests. For the report **month** (default = the month of `asOf`):
- Resolve the site list from the **meetings** namespace (`listSiteModuleCodes('meetings')` / iterate + `getSiteIdByModuleCode`).
- Per site, gather the four dims (each may be null):
  - **helpdesk** = `getCalendarMonthlyHelpdesk(site_id, year, month)` — the reader returns **null (the whole object)** when the site has no `zoho_group`, so **null-guard the object** (`const hd = getCalendarMonthlyHelpdesk(...); helpdesk = hd ? hd.sla_res_pct : null;`) — `sla_res_pct` is also null when there's no verdict.
  - **meetings** = `insights({from,to,site:code}).site_leaderboard` row `.score × 100` (the score is **0-1** → ×100; null when the site has no engagement row).
  - **inspections** = the page's `ok/applicable` conformity (see the substrate table): from `aggregate({site,from,to}).findingStatus`, `applicable = Σn where status≠'na'`, `ok = n where status='ok'`; present iff `applicable>0` → `round(100 × ok/applicable)`, else null. **Reuses the on-page `inspSiteRows` definition so the two agree.**
  - **assets** = the `effort_score` from `getEffortLeaderboard({asOf})` whose `site` label maps to this site. **There is NO `assets` namespace in `site_module_codes` today** — so add one: extend `_SITE_MODULE_CODES_SEED` (`reports-db.js`, sqlite + the pg `1016` seed) with an `assets` namespace mapping the distinct `asset_effort_history.site` AP labels (`HOUNDE`, `MANA`, `Sabodala`, `MASSAWA`, `LAFIGUE`, `KALANA`, `ITY`, …) to their `site_id`, so the crosswalk is **uniform** (`getSiteIdByModuleCode('assets', label)`), NOT an accent-fold guess (fold alone silently mis-maps mining sites — the documented `*_aliases` pitfall). An unmatched label → assets dimension null (coverage 3/4), never 0 or a crash.
- Also gather the **previous month**'s four dims the same way → `prev` (for Δ). Cheap; monthly, not a hot path.
- Return `{ perSite, prev, month, window }` for `buildSiteScoreboard`.
- **Window:** monthly. `from`/`to` = first/last day of the month (the windowed readers), `asOf` = month-end (or today for the current month); helpdesk uses `(year, month)` directly. Honestly heterogeneous (SLA% is calendar-month, effort is point-in-time) — the note states the window.

### 3) Page integration (additive, allowlist-guarded)

- **Independent gathering + gating (review #1).** The existing helpdesk block in `buildReviewVals` is gated on `if (extras)` (truthiness, and `opts.extras` has NO default) and emits `hdRows`/`hdNote`. Refine to **null-safe sub-key gates**: `if (extras && extras.helpdesk)` and a parallel `if (extras && extras.scoreboard)` emitting `sbuRows`/`sbuNote` (write it null-safe — a bare `extras.helpdesk` THROWS on the no-extras 61-key path). The two panels are then independent (a scoreboard failure never drops helpdesk). Backward-compatible: the existing test input `extras:{helpdesk,changes}` still emits exactly `hdRows`/`hdNote` (no `extras.scoreboard` → no `sbu*`); the no-extras path still emits exactly his 61 keys. Neither block enters `sbs`/`comps`/`codes`.
- The route `GET /api/reports/review-data` (`server.js`) gathers helpdesk (`loadReviewExtras`) and the scoreboard (`loadScoreboardData`) in **SEPARATE try/catches** and composes `extras = {}` then conditionally `extras.helpdesk = …` / `extras.scoreboard = …` — a throw in one gather drops only its own panel, never the other, never a 500. (Do NOT compose `extras` from one shared try — a scoreboard throw would then also drop helpdesk, and `hdRowsOf` on an empty `hd` renders all-dashes instead of hiding.)
- `it-review.html` AND **`docs/reference/it-review-dashboard.template.html`** (the file the render backstop parses — editing only `it-review.html` leaves the panel with ZERO grammar coverage): a NEW panel, the whole thing (heading included) wrapped in `<sc-if value="{{ sbuRows }}">` (degrade path: no extras → `sbuRows` undefined → panel dropped). Titled "Scoreboard opérationnel — 4 dimensions", per site: rank · site · **global** (RAG pill + score) · helpdesk · inspections · réunions · actifs (each a RAG chip) · Δ; plus the coverage/method note + fleet avg + most-improved/needs-attention callouts. Reuses ONLY the renderer's 3 primitives (`{{ }}`/`<sc-for>`/`<sc-if>`), nesting ≤2 deep — **no new renderer features**. A null dim cell renders "—". The drop path emits `sbuRows` **undefined** (never `[]`, which is truthy → a headed empty table); `codes` is non-empty so a built scoreboard always has rows.
- `tests/review-fidelity.test.js`: (a) the existing no-/helpdesk-extras assertions stay (the added keys are still exactly `['hdNote','hdRows']` when `extras.scoreboard` is absent); (b) **add a WITH-scoreboard case** — pass `extras:{helpdesk, changes, scoreboard:<built>}` and assert the added keys over the 61 are exactly the allowlist `['hdNote','hdRows','sbuRows','sbuNote']`. Without a scoreboard payload in the test input, `sbu*` are never emitted and the assertion is meaningless.

### 4) Scheduled coordinator e-mail

- **PURE `services/siteScoreboardReport.js`** — `buildScoreboardDigest(scoreboard, { period, highlightSite })` → `{ subject, html }`. The full leaderboard as an HTML table, the `highlightSite` row emphasised; a short "où se situe votre site" line; the method + coverage note. **No money.** Plain words (no jargon). Bilingual-friendly FR.
- **`tools/reports/send-scoreboard.js`** — mirrors `send-hygiene.js`: **GATE FIRST** (`decideScoreboardSend(cfg)` — refuses unless `scoreboard_send_enabled==='1'`), then per **confirmed** coordinator recipient (`reportDirectory.resolveRecipient(db, siteCode, 'coordinator')`, honouring `neverSendUnconfirmed`) compose with that site highlighted → `mailer` → `reportSentLog` (`report_type='scoreboard'`, `site_code=<site>`, per (period, site) dedup). `--preview` renders without sending. Optional manager/group CC. Exports `{ decideScoreboardSend, main }`, entrypoint-guarded (`if (require.main === module)`), so it's unit-testable.
- **`reportSchedule.js`**: add `'scoreboard'` to `TYPES` + `cliFor('scoreboard') → send-scoreboard.js` (the coordinator/group CLI path is byte-unchanged).
- **`reportConfig.DEFAULTS`**: add `scoreboard_send_enabled: '0'` (+ optional `scoreboard_group_cc: ''`). MUST be in DEFAULTS or `setConfig` silently drops the admin's write (documented trap).
- **Admin card** on `reports.html` (admin+): arm toggle + schedule + Preview / Send-now, reusing the hygiene card pattern.

---

## Testing

- **`tests/site-scoreboard.test.js`** (pure `siteScoreboard.js`) — pinned cases: weighted mean with all 4 present (verify helpdesk's 40 % dominates); renormalization with 3 present (weights re-sum to 1 — a site missing assets scores on helpdesk/inspections/meetings renormalized to 0.5/0.25/0.25); coverage `present/total`; 0 present → `applicable:false`, score/rag null; per-dim RAG at the 75/55 boundaries; rank ties (score equal → code asc); Δ from `prev` (positive, negative, null when no prev); `most_improved`/`needs_attention`/`fleet_avg` incl. the all-null / no-red cases.
- **`tests/scoreboard-data.test.js`** — the glue against seeded meetings/inspection/helpdesk/effort readers (DI stubs shaped like the REAL readers — per the pitfall, a stub that mis-shapes a reader passes while the wiring is wrong; assert against `getCalendarMonthlyHelpdesk`/`insights`/`getSiteScoreInputs`/`getEffortLeaderboard`'s real return shapes). Site-code crosswalk resolves; a site missing a dimension yields null (not 0); assets name-match works and an unmatched label → null.
- **`tests/review-fidelity.test.js`** — extended: no-extras call still deep-equals the author's 61 keys; with-scoreboard extras adds ONLY `sbuRows`/`sbuNote` (allowlist).
- **`tests/review-render.test.js`** (the renderer BACKSTOP) — it parses `docs/reference/it-review-dashboard.template.html` and today calls `buildReviewVals(EM, {view,…})` with **no extras**, so `sbuRows` is undefined → the panel's `sc-if` is falsy → the inner `sc-for`/bindings are **skipped, never parsed**. So (a) the panel MUST be added to the reference template too, AND (b) **extend the backstop with a WITH-scoreboard pass**: call `buildReviewVals(EM, {…, extras:{ scoreboard: buildSiteScoreboard(<a small fixture perSite>) }})` so `sbuRows` is a real array and the panel's loops actually get parsed and asserted clean. Without this pass the new panel ships with zero grammar coverage (the documented "12/12 unit tests green while matching 0 of 32 loops, page inert" trap).
- **`tests/send-scoreboard.test.js`** — `decideScoreboardSend` armed-off refuses (composes/mails/logs nothing); armed + confirmed recipient composes; dedup blocks a second same-period send; unconfirmed recipient is skipped.
- **`tests/report-config-scoreboard.test.js`** — `scoreboard_send_enabled` in DEFAULTS/KEYS.
- **Browser-verify** the IT Review panel (renders alongside his scoreboard, real RAGs, coverage note, Δ badges, a null dim shows "—", his panel unchanged; zero console errors).
- Full review suite + await-precedence green.

## Error handling / edge cases

- Scoreboard gather throws → the route's try/catch drops the panel (his dashboard renders normally); never a 500.
- 0 present dims → `applicable:false` (non applicable), never a 0 that reads as "measured zero".
- A dimension null vs 0: **null = "not measured this month"** (renders "—", excluded from the weighted mean); **0 = "measured, scored zero"** (counts). The four readers must return null (not 0) for genuinely-absent data — the glue enforces this per dimension (helpdesk null when no verdict; meetings null when no engagement row; inspections null when 0 inspections; assets null when unmatched).
- Weight renormalization guards `Σ present weights > 0` (0 present already handled by `applicable:false`).
- Δ null when no previous-month data (a new site, or first month).
- E-mail: armed-off by default; unconfirmed recipient skipped; dedup per (period, site); `--preview` never sends/logs.
- Site sets may differ between his scoreboard and ours (ours may include office/asset sites his `codes` omits, or omit sites with no meetings code). Additive rows — his `sbRows` are unaffected.

## Non-goals (YAGNI)

- No new renderer primitives (the 3-primitive grammar is fixed).
- No config-knob weights (fixed 40/20/20/20 constant this version).
- No composite-history/snapshot table for Δ (recompute the previous month on the fly; a stored trend can come later like the effort snapshot).
- No change to `siteScore.js` / `siteComposite.js` / his 61 keys.
- The mobile asset-capture flow is explicitly deferred (separate future sub-project).
- No per-technician scoreboard (this is site-level).

## Known-pitfall touchpoints (carry into the plan)

- `opts.extras` is allowlist-guarded and MUST NOT reach `sbs`/`comps`/`codes`; extend the fidelity allowlist to exactly `['hdNote','hdRows','sbuRows','sbuNote']`.
- Wrap the whole added panel (heading included) in `<sc-if value="{{ sbuRows }}">` — the renderer has no mechanism to remove static markup, so the degrade path would otherwise render a headed empty table.
- Per-site helpdesk scopes by `tech_group` (via `site_id`), NEVER `request_records.site`; resolve `site_id` from `site_module_codes` first.
- Meetings `insights().site_leaderboard[].score` is **0-1** → ×100.
- null (not measured) ≠ 0 (measured zero) — the whole coverage/renormalization contract depends on it.
- Config key `scoreboard_send_enabled` MUST be in `reportConfig.DEFAULTS`.
- The send CLI MUST be entrypoint-guarded (`require.main === module`) or `require()`-ing it in the test executes it (the documented "1 test passed, ran 0" trap). It must resolve recipient rows per-backend the way `send-hygiene.js` does (`reportDirectory.resolveRecipient` throws if handed an un-awaited pg Promise row set — follow the hygiene CLI's `initPg*`/await pattern).
- **Inspection conformity uses the page's `ok/applicable` FORMULA** (from `aggregate().findingStatus`), NOT a `critical+major` ratio — `getSiteScoreInputs().findings` is the crit+major COUNT with no denominator. It is **month-scoped** (like the scoreboard's other 3 dims), whereas his `inspSiteRows` is all-time; `sbuNote` states the scoreboard window so the two aren't read as a contradiction.
- **Add an `assets` namespace to `site_module_codes`** (mapping the AP `asset_effort_history.site` labels → `site_id`) — accent-folding the free-form assets label alone silently mis-maps mining sites (the `*_aliases` pitfall); unmatched label → assets dim null (coverage 3/4), never 0.
- `getCalendarMonthlyHelpdesk` returns **null (the whole object)** for a site with no `zoho_group` — null-guard the object before reading `.sla_res_pct`.
- Gate each extras panel on its OWN sub-key (`extras.helpdesk` / `extras.scoreboard`) from INDEPENDENT try/catches — a shared try or a truthiness gate lets a scoreboard failure drop the helpdesk panel.
