# Unified Operational Site Scoreboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A per-site operational scoreboard (weighted composite of helpdesk · inspections · réunions · actifs) grafted **additively** onto the IT Review Dashboard, plus a scheduled coordinator e-mail — without ever touching the author's authoritative `sbDims`/`composite` models.

**Architecture:** A PURE `services/siteScoreboard.js` does the weighting/RAG/coverage math. A glue reader `loadScoreboardData` gathers 4 per-site sub-scores from existing readers + a new `assets` site-code namespace. It rides into the IT Review via the existing `opts.extras` mechanism (allowlist-guarded, so the author's 61 keys are untouched). A `send-scoreboard.js` CLI + admin card mail it to coordinators (armed-off, dedup).

**Tech Stack:** Node + Express + better-sqlite3/PostgreSQL, `node --test`, the IT Review 3-primitive renderer (`public/it-review.js`), the reporting-suite scheduler + directory + mailer.

**Spec:** `docs/superpowers/specs/2026-07-19-site-scoreboard-design.md` (READ it — the additive contract, the 4 readers' exact shapes, the null-vs-0 rule, and the known-pitfall touchpoints are there).

**Branch:** `feat/site-scoreboard` (from `main`).

## Ground rules (every task)
- Commit after every green step (`git commit --no-verify` — a post-commit hook prints deploy noise + harmless "failed to delete .git/worktrees" permission errors; IGNORE them, the commit succeeds; confirm with `git rev-parse --short HEAD`).
- Run one test file: `node --test --test-force-exit tests/<file>.test.js`.
- The author's model is NEVER edited: do not touch `services/siteScore.js` / `services/siteComposite.js`, and the no-extras `buildReviewVals` output must stay exactly his 61 keys (`tests/review-fidelity.test.js` enforces this — keep it green).
- Dual-backend readers are await-covered (`tests/await-precedence.test.js` must stay 5/5).
- null = "not measured" (excluded from the weighted mean); 0 = "measured zero" (counts). The glue enforces null for genuinely-absent data per dimension.

---

## Task 0: The pure composer (`services/siteScoreboard.js`)

**Files:**
- Create: `services/siteScoreboard.js`
- Test: `tests/site-scoreboard.test.js`

- [ ] **Step 1 — write the failing test** (`tests/site-scoreboard.test.js`). Require `../services/siteScoreboard`. `perSite` rows are `{code, name, helpdesk, inspections, meetings, assets}` each a number 0-100 OR null. Assert `buildSiteScoreboard(perSite, {prev})`:
  - **All 4 present, weights bite:** `[{code:'SML', name:'Lafigué', helpdesk:90, inspections:80, meetings:70, assets:60}]` → `score = round(0.40*90 + 0.20*80 + 0.20*70 + 0.20*60) = round(36+16+14+12)=78`; `rag:'green'` (≥75); `coverage:{present:4,total:4}`; `applicable:true`; `rank:1`.
  - **Renormalization (3 present):** `[{code:'HGO', name:'Houndé', helpdesk:80, inspections:60, meetings:70, assets:null}]` → present weights sum 0.40+0.20+0.20=0.80 → `score = round((0.40*80+0.20*60+0.20*70)/0.80)=round((32+12+14)/0.80)=round(72.5)=73`; `coverage:{present:3,total:4}`; the `assets` dim is null.
  - **Only helpdesk present → score == helpdesk:** `[{code:'X',name:'X',helpdesk:64,inspections:null,meetings:null,assets:null}]` → `score:64` (renorm of a single weight), `coverage.present:1`.
  - **0 present → non applicable:** `[{code:'Z',name:'Z',helpdesk:null,inspections:null,meetings:null,assets:null}]` → `score:null, rag:null, applicable:false, coverage:{present:0,total:4}`.
  - **Per-dim RAG at boundaries:** a row with `helpdesk:75` → `dims.helpdesk.rag:'green'`; `55` → `'amber'`; `54` → `'red'`.
  - **Rank + ties:** two sites both score 60 → ranked by `code` asc; a higher score ranks first. Non-applicable rows get no rank (or rank null) and are excluded from `fleet_avg`.
  - **Δ from prev:** pass `prev` = `{ SML: {helpdesk:80,inspections:80,meetings:70,assets:60} }` (a map code→perSite-shaped inputs); SML current 78 vs prev score (compute prev the same way = round(0.4*80+…) ) → `delta = 78 − prevScore`; a site absent from `prev` → `delta:null`.
  - **most_improved / needs_attention / fleet_avg:** `most_improved` = applicable row with the max POSITIVE delta (null if none positive / all null); `needs_attention` = the lowest-scoring applicable row with `score < 55` (red) (null if none); `fleet_avg` = round(mean of applicable scores), null if none applicable.
  - **Clamp:** a stray `helpdesk:120` clamps to 100 defensively.
  Run → **FAIL** (module missing). Paste the failing output.

- [ ] **Step 2** run → confirm FAIL.

- [ ] **Step 3 — implement `services/siteScoreboard.js`:**
  - `const WEIGHTS = { helpdesk:0.40, inspections:0.20, meetings:0.20, assets:0.20 };` `const DIMS = Object.keys(WEIGHTS);` `const G=75, A=55;`
  - `const clamp = v => v==null ? null : Math.max(0, Math.min(100, Number(v)));`
  - `const ragOf = s => s==null ? null : (s>=G ? 'green' : (s>=A ? 'amber' : 'red'));`
  - `scoreOne(row)`: for each DIM, `v = clamp(row[d])`; collect present `{d,v}` (v != null); `wsum = Σ WEIGHTS[d]`, `dot = Σ WEIGHTS[d]*v`; `present.length ? round(dot/wsum) : null`. Build `dims[d] = v==null ? null : {value:v, rag:ragOf(v)}`. `coverage = {present: present.length, total: 4}`. `applicable = present.length>0`.
  - `buildSiteScoreboard(perSite, {prev}={})`: map each row → `{code, name, score, rag:ragOf(score), applicable, dims, coverage, delta}`. `delta`: if `prev[code]` → `score − scoreOne(prev[code]).score` (both non-null) else null. Sort applicable rows by `score` desc then `code` asc, assign `rank` 1-based; non-applicable rows get `rank:null`, appended after. `fleet_avg = applicable.length ? round(mean of applicable scores) : null`. `most_improved` = applicable row with max delta where delta>0, else null. `needs_attention` = applicable row with the min score where score<55, else null (tie → code asc). Return `{ rows, fleet_avg, most_improved, needs_attention }`.
  - Export `{ buildSiteScoreboard, WEIGHTS }`.

- [ ] **Step 4** run `node --test --test-force-exit tests/site-scoreboard.test.js` → **PASS** (all cases). Syntax: `node -e "require('./services/siteScoreboard')"`.

- [ ] **Step 5 — commit:** `feat(scoreboard): pure weighted composite (renormalized coverage + RAG + Δ)`.

---

## Task 1: The `assets` site-code namespace

**Files:**
- Modify: `reports-db.js` (`_SITE_MODULE_CODES_SEED` + the pg seed)
- Test: `tests/scoreboard-assets-namespace.test.js` (small)

- [ ] **Step 1 — failing test.** READ `reports-db.js` around `_SITE_MODULE_CODES_SEED` (~line 555) and the pg seed (~1016) + `getSiteIdByModuleCode(module, code)` (~1524) + `listSiteModuleCodes(module)` (~1551) + `DEFAULT_SITES` (~575). In `tests/scoreboard-assets-namespace.test.js`: boot a throwaway sqlite reports.db (copy the harness from an existing reports-db test, e.g. `tests/report-config-*.test.js` or a sites test), then assert: `getSiteIdByModuleCode('assets','HOUNDE')` resolves to the same `site_id` as `getSiteIdByModuleCode('meetings','HGO')` (Houndé); `getSiteIdByModuleCode('assets','MANA')` == meetings 'MGO'; both `getSiteIdByModuleCode('assets','Sabodala')` AND `getSiteIdByModuleCode('assets','MASSAWA')` resolve to the SGO site_id; an unknown label → null. Run → FAIL.

- [ ] **Step 2** FAIL. **Step 3 — implement:** add an `assets` namespace to `_SITE_MODULE_CODES_SEED` (and the pg seed if it's a separate literal) mapping the distinct AP `asset_effort_history.site` labels to the canonical site names/ids — at minimum `HOUNDE→Houndé, MANA→Mana, Sabodala→Sabodala(SGO), MASSAWA→Sabodala(SGO), LAFIGUE→Lafigué, KALANA→Kalana, ITY→Ity` and the offices if present (`Ouagadougou`, `Dakar`, `ABIDJAN`, …). Follow the EXACT seed row shape the other namespaces use (module, code, site key) — READ how tracker/meetings rows are seeded and mirror it; the seed resolves a site by name to `site_id` in the seed loop, so map each AP label to the canonical site NAME the seed loop expects. (If `MASSAWA` must fold into SGO but there's no Massawa site row, map its label to Sabodala's site — the test pins this.)

- [ ] **Step 4** PASS + `node -e "new Function(require('fs').readFileSync('reports-db.js','utf8'))"` + `node --test --test-force-exit tests/await-precedence.test.js` → 5/5. **Step 5 — commit:** `feat(scoreboard): assets namespace in site_module_codes (AP labels → canonical site)`.

---

## Task 2: The glue reader (`loadScoreboardData`)

**Files:**
- Create: `services/scoreboardData.js`
- Test: `tests/scoreboard-data.test.js`

- [ ] **Step 1 — failing test.** `loadScoreboardData({ month, asOf, deps })` gathers, per site, the 4 dims + the previous month → `{ perSite, prev, month, window }`. **Inject the readers via `deps`** (DI) so the test controls them without a DB, but shape each stub EXACTLY like the real reader (per the pitfall — a mis-shaped stub passes while the wiring is wrong). Stubs:
  - `deps.listSiteModuleCodes('meetings')` → `[{code:'HGO', site_id:2, name:'Houndé'}, {code:'MGO', site_id:5, name:'Mana'}, {code:'SGO', site_id:1, name:'Sabodala'}]` (mirror the real `{site_id, code, ...}` shape).
  - `deps.getSiteIdByModuleCode('assets', label)` → resolve `'HOUNDE'`→{site_id:2}, `'MANA'`→{site_id:5}, `'MASSAWA'`→{site_id:1}, `'Sabodala'`→{site_id:1}, unknown→null.
  - `deps.getCalendarMonthlyHelpdesk(site_id, y, m)` → for site 2 `{sla_res_pct:74, …}`, site 5 `{sla_res_pct:70}`, site 1 **null (whole object)** (no zoho_group).
  - `deps.getMeetingsInsights({from,to})` → `{ site_leaderboard: [{site_code:'HGO', score:0.60}, {site_code:'MGO', score:0.50}] }` (0-1; SGO absent). (Wrap `meetings-db.insights` so the glue calls `deps.getMeetingsInsights` once per window, not per site.)
  - `deps.getInspectionAggregate({site, from, to})` → for HGO `{findingStatus:[{status:'ok',n:8},{status:'minor',n:2},{status:'na',n:1}]}` (applicable=10, ok=8 → 80), for MGO `{findingStatus:[]}` (applicable 0 → null), SGO `{findingStatus:[{status:'ok',n:5},{status:'na',n:0}]}` (→100).
  - `deps.getEffortLeaderboard({asOf})` → `{rows:[{site:'HOUNDE', effort_score:52, total:100}, {site:'MASSAWA', effort_score:40, total:50}, {site:'Sabodala', effort_score:66, total:150}]}` (HGO→52; SGO has TWO labels MASSAWA+Sabodala → asset-weighted mean = round((40*50+66*150)/(50+150))=round((2000+9900)/200)=round(59.5)=60; MGO unmatched → null).
  Assert `loadScoreboardData({month:{year:2026,m:7}, asOf:'2026-07-31', deps})`:
  - `perSite` for HGO = `{code:'HGO', name:'Houndé', helpdesk:74, inspections:80, meetings:60, assets:52}`.
  - MGO = `{…, helpdesk:70, inspections:null, meetings:50, assets:null}` (aggregate empty → null; effort unmatched → null).
  - SGO = `{…, helpdesk:null (null-object guarded), inspections:100, meetings:null (absent from leaderboard), assets:60 (weighted mean of the 2 labels)}`.
  - `prev` present (the glue ran the same gather for month 6) — assert one prev value to prove the previous-month path fires (stub the deps to return the same shape for both windows, or a `month`-aware stub).
  - No throw when a reader returns null/empty. Run → FAIL.

- [ ] **Step 2** FAIL. **Step 3 — implement `services/scoreboardData.js`:**
  - `async function loadScoreboardData({ month, asOf, deps })`: resolve the site list via `deps.listSiteModuleCodes('meetings')`. Compute the month window `{from, to}` (first/last day of `month`) and the previous month window. Build the effort index ONCE per window: `const effIdx = indexEffort(await deps.getEffortLeaderboard({asOf}), deps.getSiteIdByModuleCode)` → a `Map<site_id, {sumWeighted, sumWeight}>` accumulating `effort_score` weighted by `total` (fallback weight 1) across all rows whose label resolves to that site_id; the final per-site assets score = `sumWeight>0 ? round(sumWeighted/sumWeight) : null`. Fetch meetings insights ONCE per window (`deps.getMeetingsInsights({from,to})`) → a `Map<site_code, score×100>`.
  - Per site, assemble `{code, name, helpdesk, inspections, meetings, assets}`:
    - helpdesk: `const hd = await deps.getCalendarMonthlyHelpdesk(site_id, month.year, month.m); helpdesk = hd ? hd.sla_res_pct : null;` (**null-object guard**).
    - inspections: from `await deps.getInspectionAggregate({site: code, from, to})` → `applicable = Σn where status!=='na'`, `ok = n where status==='ok'`; `applicable>0 ? round(100*ok/applicable) : null`.
    - meetings: `meetingsMap.get(code) ?? null` (already ×100).
    - assets: `effIdx per site_id` (computed above).
  - Run the SAME assembly for the previous month → `prev` as a `Map/obj` code→perSite inputs (for Δ).
  - Return `{ perSite, prev, month, window:{from,to} }`. `await`-correct throughout (the readers are async on the pg path).
  - Export `{ loadScoreboardData }`.

- [ ] **Step 4** PASS + await-precedence 5/5 + `node -e "require('./services/scoreboardData')"`. **Step 5 — commit:** `feat(scoreboard): loadScoreboardData glue (4 dims + prev month, null-safe)`.

---

## Task 3: Wire into the IT Review page (additive, allowlist-guarded)

**Files:**
- Modify: `services/reviewDashboard.js` (the `opts.extras` block), `server.js` (the `/api/reports/review-data` route), `public/it-review.html`, `docs/reference/it-review-dashboard.template.html`
- Test: `tests/review-fidelity.test.js` (extend), `tests/review-render.test.js` (extend backstop)

- [ ] **Step 1 — failing fidelity + render tests.**
  - Extend `tests/review-fidelity.test.js`: keep the existing no-extras (61 keys) + helpdesk-only (`+['hdNote','hdRows']`) assertions. ADD a case passing `extras:{ helpdesk:<existing stub>, changes:<existing stub>, scoreboard: require('../services/siteScoreboard').buildSiteScoreboard([{code:'SML',name:'Lafigué',helpdesk:90,inspections:80,meetings:70,assets:60}], {}) }` and assert the keys added over the author's 61 are EXACTLY `['hdNote','hdRows','sbuRows','sbuNote']` (sorted).
  - Extend `tests/review-render.test.js` (the BACKSTOP): add a pass that calls `buildReviewVals(EM, {view:'dashboard', period, site, asOf, extras:{ scoreboard: buildSiteScoreboard([{code:'SML',name:'Lafigué',helpdesk:90,inspections:80,meetings:70,assets:60}],{}) }})` and runs the SAME render-the-reference-template assertion the existing backstop uses — so the new panel's `<sc-for>`/`<sc-if>` actually get parsed against `docs/reference/it-review-dashboard.template.html`.
  Run both → FAIL (`sbuRows`/`sbuNote` not emitted; panel not in the reference template).

- [ ] **Step 2** FAIL. **Step 3 — implement:**
  - `services/reviewDashboard.js`: in the extras block (READ how `hdRows`/`hdNote` are emitted, ~line 790), change the gate to **null-safe sub-key** form and add the scoreboard branch: `if (opts.extras && opts.extras.helpdesk) { ex.hdRows = …; ex.hdNote = …; }` and `if (opts.extras && opts.extras.scoreboard) { const sb = opts.extras.scoreboard; ex.sbuRows = sb.rows.map(shapeRowForTemplate); ex.sbuNote = <method + coverage + "scoreboard = mois courant" window string>; }`. `shapeRowForTemplate` flattens a scoreboard row into template-friendly fields (strings + the 4 dim cells as `{value|'—', rag}` + a Δ display string like `▲ +6` / `▼ −4` / `—`). Do NOT enter `sbs`/`comps`/`codes`.
  - `server.js` `GET /api/reports/review-data`: gather helpdesk (existing `loadReviewExtras`) and the scoreboard (`loadScoreboardData`) in **SEPARATE try/catches**, compose `const extras = {}; try { extras.helpdesk = …; extras.changes = …; } catch {} try { extras.scoreboard = buildSiteScoreboard((await loadScoreboardData({month, asOf, deps})).…, {prev}); } catch (e) { console.error('[review scoreboard]', e.message); }` then pass `extras` into `buildReviewVals`. (Wire real `deps` = the actual reader functions; the month = the month of `asOf`.)
  - `public/it-review.html` AND `docs/reference/it-review-dashboard.template.html`: add the panel, the WHOLE thing wrapped in `<sc-if value="{{ sbuRows }}">` (heading inside), titled "Scoreboard opérationnel — 4 dimensions (helpdesk · inspections · réunions · actifs)". A `<sc-for>` over `sbuRows` renders per row: rank · site · a global RAG pill (`{{ score }}` + rag class) · 4 dim cells (each `{{ dims.helpdesk.value }}` with the rag class, "—" when null) · Δ. Add the `sbuNote` + fleet-avg + most-improved/needs-attention callouts. Use ONLY `{{ }}`/`<sc-for>`/`<sc-if>`, ≤2 nesting. Label it clearly vs his "Score programme" panel.

- [ ] **Step 4** run both tests → PASS. Then `node --test --test-force-exit tests/review-fidelity.test.js tests/review-render.test.js tests/review-data.test.js tests/await-precedence.test.js` → all green (his 61 keys still exact). Syntax: `node -e "new Function(require('fs').readFileSync('server.js','utf8'))"` + `new Function` on reviewDashboard.js.

- [ ] **Step 5 — VERIFY IN BROWSER (mandatory).** `preview_start` the dev server, mint an admin PG session, ensure some meetings/inspection/helpdesk/effort data exists for a couple of sites (seed if thin), **restart (stop+start — `_htmlCache`)**, open `/it-review.html`:
  - The new "Scoreboard opérationnel" panel renders BELOW/ALONGSIDE his "Score programme" scoreboard; his panel is unchanged.
  - Real RAG pills + the 4 dim chips; a null dim shows "—"; the coverage note + Δ badges + callouts render.
  - Switch view (dashboard/scoreboard/brief) — the panel appears where intended and nothing else breaks.
  - **Zero console errors.** Screenshot.

- [ ] **Step 6 — commit:** `feat(scoreboard): additive Scoreboard opérationnel panel on the IT Review`.

---

## Task 4: The scheduled coordinator e-mail

**Files:**
- Create: `services/siteScoreboardReport.js`, `tools/reports/send-scoreboard.js`
- Modify: `services/reportSchedule.js` (TYPES + cliFor), `services/reportConfig.js` (DEFAULTS), `public/reports.html` (admin card)
- Test: `tests/site-scoreboard-report.test.js`, `tests/send-scoreboard.test.js`, `tests/report-config-scoreboard.test.js`

- [ ] **Step 1 — failing tests.**
  - `tests/report-config-scoreboard.test.js`: `require('../services/reportConfig')` → `DEFAULTS.scoreboard_send_enabled === '0'` and `KEYS.includes('scoreboard_send_enabled')`.
  - `tests/site-scoreboard-report.test.js`: `buildScoreboardDigest(scoreboard, {period:'2026-07', highlightSite:'MGO'})` (scoreboard = a `buildSiteScoreboard(...)` result) → `{subject, html}`; assert `subject` mentions the month; `html` contains every applicable site's row, the `highlightSite` row is emphasised (e.g. a marker class/text), the coverage note is present, and **no `$` glyph** (`assert(!html.includes('$'))`). A `null`-score (non applicable) site renders "non applicable", not "0".
  - `tests/send-scoreboard.test.js` (copy the `tests/send-hygiene.test.js` harness): `decideScoreboardSend({scoreboard_send_enabled:'0'})` → false (a disarmed run composes/mails/logs NOTHING — assert the mailer + log stubs were never called); `decideScoreboardSend({scoreboard_send_enabled:'1'})` → true; an armed run with a CONFIRMED coordinator recipient composes + mails + records to `reportSentLog`; an UNCONFIRMED recipient is skipped (never mailed); a second same-(period,site) run is deduped (not re-sent). Use DI stubs for `mailer`/`reportDirectory`/`reportSentLog` (mirror send-hygiene).
  Run → FAIL.

- [ ] **Step 2** FAIL. **Step 3 — implement:**
  - `services/reportConfig.js`: add `scoreboard_send_enabled: '0',` to `DEFAULTS` (near `hygiene_send_enabled`). (`KEYS = Object.keys(DEFAULTS)` auto-includes it.)
  - `services/siteScoreboardReport.js`: PURE `buildScoreboardDigest(scoreboard, {period, highlightSite})` → `{subject, html}`. The full leaderboard as an HTML table (rank · site · global · 4 dims · Δ), the `highlightSite` row emphasised, a "où se situe votre site" line, the method + coverage note, plain FR words, **no `$`**, no money. Export it.
  - `tools/reports/send-scoreboard.js`: mirror `tools/reports/send-hygiene.js` EXACTLY — `decideScoreboardSend(cfg)` (refuses unless `scoreboard_send_enabled==='1'`), **GATE FIRST** (a disarmed run does nothing), then gather the scoreboard (`loadScoreboardData`→`buildSiteScoreboard`), and per **confirmed** coordinator recipient (`reportDirectory.resolveRecipient(db, siteCode, 'coordinator')`, honour `neverSendUnconfirmed`, **await the pg row resolution the way send-hygiene does**) compose with that site highlighted → `mailer` → `reportSentLog.record({report_type:'scoreboard', site_code, period})`; skip if `alreadySentToday(db,'scoreboard',site,period)`. `--preview` renders without sending/logging. Export `{ decideScoreboardSend, main }`, entrypoint-guarded (`if (require.main === module) main()...`).
  - `services/reportSchedule.js`: add `'scoreboard'` to `TYPES`; extend `cliFor` so `cliFor('scoreboard')` → the `send-scoreboard.js` path (mirror how `'hygiene'` maps to `send-hygiene.js`).
  - `public/reports.html`: an admin card (admin+) "📊 Scoreboard opérationnel" — arm toggle (`scoreboard_send_enabled` via `/api/reports/config`, both save+load lines) + schedule (reuse the hygiene card's schedule controls, type `'scoreboard'`) + Preview / Send-now buttons (reuse the hygiene endpoints' pattern; if a `POST /api/reports/scoreboard/send?preview=` is needed, add it mirroring the hygiene send route — READ how hygiene's send-now + preview are wired and copy).

- [ ] **Step 4** run all three tests → PASS + await-precedence 5/5 + syntax checks on the new files + `tests/report-schedule*.test.js` (if present) green (the coordinator/hygiene CLI paths unchanged). **Step 5 — commit:** `feat(scoreboard): scheduled coordinator email (armed-off, dedup) + admin card`.

---

## Task 5: Regression + CLAUDE.md + finish

- [ ] **Step 1 — regression** `node --test --test-force-exit tests/site-scoreboard*.test.js tests/scoreboard-*.test.js tests/send-scoreboard.test.js tests/report-config-scoreboard.test.js tests/review-fidelity.test.js tests/review-render.test.js tests/review-data.test.js tests/await-precedence.test.js` → green. (Boot-heavy smoke files may show a non-deterministic file-wrapper flake on combined runs — confirm each file green ALONE, per the documented cross-file flake.)
- [ ] **Step 2 — CLAUDE.md** Current-State entry (2026-07-19): the additive operational scoreboard on the IT Review (4-dim weighted 40/20/20/20, renormalized coverage, RAG 75/55) — his `sbDims`/`composite` untouched, allowlist-guarded (`sbuRows`/`sbuNote`), fidelity + render-backstop extended; the pure `siteScoreboard.js` + `scoreboardData.js` glue + the `assets` site-code namespace + the scheduled coordinator email. Pitfall rows: (a) the scoreboard rides `opts.extras` and MUST NOT reach `sbs`/`comps`/`codes` — the fidelity allowlist is exactly `['hdNote','hdRows','sbuRows','sbuNote']`; (b) inspection conformity uses the page's `ok/applicable` formula but is MONTH-scoped (his is all-time) — stated in `sbuNote`, not a bug; (c) the `assets` namespace maps AP labels → site_id (Massawa folds into SGO by asset-weighted mean) — never accent-fold alone; (d) the new panel must live in BOTH `it-review.html` and the reference template, and the render backstop needs a with-scoreboard pass or the panel ships with zero coverage. Point at this plan + spec.
- [ ] **Step 3 — commit**, then finish-a-development-branch (merge to `main`).

---

## Done criteria
- [ ] Pure `siteScoreboard.js` — weighted mean, renormalization, coverage, RAG, rank, Δ, non-applicable; unit-tested.
- [ ] `assets` site-code namespace resolves AP labels → canonical site_id (Massawa → SGO).
- [ ] `loadScoreboardData` gathers the 4 dims + prev month, null-safe, await-covered; glue tested against real-shaped stubs.
- [ ] Additive IT Review panel (allowlist-guarded); his 61 keys + `sbDims` untouched; fidelity + render-backstop green; **browser-verified**.
- [ ] Scheduled coordinator email (armed-off, gate-first, dedup, confirmed-recipients-only, preview); admin card; config key in DEFAULTS.
- [ ] Full suite green; CLAUDE.md + pitfalls; merged.
