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
  - **Δ from prev:** pass `prev` = `{ SML: {helpdesk:80,inspections:80,meetings:70,assets:60} }` (a map code→perSite-shaped inputs); prev SML score = `round(0.4*80+0.2*80+0.2*70+0.2*60)=74`, so SML current 78 → `delta = 78 − 74 = 4`; a site absent from `prev` → `delta:null`.
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

## Task 1: The pure assets-label alias + effort fold (NO DB change)

**Why not a `site_module_codes` namespace (review C1):** that table's PK is `(site_id, module)` — it CANNOT hold two `assets` labels (`Sabodala` + `MASSAWA`) for one site. So the label→canonical-code map is a small **in-code constant** with a **fold helper**, unit-tested, no schema change. The map keys AP labels to the **meetings-namespace code** (the canonical iteration key the glue already uses), so an effort row resolves to the same key the site list is iterated by.

**Files:**
- Create: `services/scoreboardAliases.js`
- Test: `tests/scoreboard-aliases.test.js`

- [ ] **Step 1 — failing test.** Require `../services/scoreboardAliases`. Assert:
  - `assetLabelToCode('HOUNDE') === 'HGO'`, `'MANA' → 'MGO'`, `'Sabodala' → 'SGO'`, `'MASSAWA' → 'SGO'`, `'LAFIGUE' → 'SML'`, `'ITY' → 'SMI'`, `'KALANA' → 'KGO'` (use the meetings-namespace code — confirm Kalana's meetings code via `listSiteModuleCodes('meetings')` during impl; if Kalana has no meetings code it simply won't match a site and its assets dim is null, which is safe). Case/accent-fold tolerant (`'hounde'`, `'Houndé'` → `'HGO'`). Unknown label → `null`.
  - `foldEffortByCode(rows)` where `rows = [{site:'HOUNDE', effort_score:52}, {site:'MASSAWA', effort_score:40}, {site:'Sabodala', effort_score:66}, {site:'NOPE', effort_score:10}]` → a `Map` `{ HGO:52, SGO:53 }` (SGO = **simple mean** of the two folded labels `round((40+66)/2)=53`; `NOPE` unknown → dropped). A single-label site → its own value. Empty rows → empty map.
  Run → FAIL.
- [ ] **Step 2** FAIL. **Step 3 — implement `services/scoreboardAliases.js`:**
  - `const ALIAS = { hounde:'HGO', mana:'MGO', sabodala:'SGO', massawa:'SGO', lafigue:'SML', ity:'SMI', kalana:'KGO', /* offices as discovered */ };` `const fold = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();`
  - `assetLabelToCode(label){ return ALIAS[fold(label)] || null; }`
  - `foldEffortByCode(rows){ const acc = new Map(); for (const r of (rows||[])) { const code = assetLabelToCode(r.site); if (!code) continue; const cur = acc.get(code) || {sum:0,n:0}; cur.sum += Number(r.effort_score)||0; cur.n++; acc.set(code, cur); } const out = new Map(); for (const [code,{sum,n}] of acc) out.set(code, n>0 ? Math.round(sum/n) : null); return out; }` (**simple mean** — `getEffortLeaderboard` rows carry NO `total`/asset-count field, review C2; the fold is a plain mean, and 1:1 sites are unaffected).
  - Export `{ assetLabelToCode, foldEffortByCode, ALIAS }`.
- [ ] **Step 4** PASS + `node -e "require('./services/scoreboardAliases')"`. **Step 5 — commit:** `feat(scoreboard): asset-label alias + effort fold (in-code, simple mean)`.

---

## Task 2: The glue reader (`loadScoreboardData`)

**Files:**
- Create: `services/scoreboardData.js`
- Test: `tests/scoreboard-data.test.js`

- [ ] **Step 1 — failing test.** `loadScoreboardData({ month, asOf, deps })` gathers, per site, the 4 dims + the previous month → `{ perSite, prev, month, window }`. **Inject the readers via `deps`** (DI) so the test controls them without a DB, but shape each stub EXACTLY like the real reader (per the pitfall — a mis-shaped stub passes while the wiring is wrong). Stubs:
  - `deps.listSiteModuleCodes('meetings')` → `[{code:'HGO', site_id:2, name:'Houndé'}, {code:'MGO', site_id:5, name:'Mana'}, {code:'SGO', site_id:1, name:'Sabodala'}]` (mirror the real `{site_id, code, ...}` shape).
  - `deps.getSiteIdByModuleCode('assets', label)` → resolve `'HOUNDE'`→{site_id:2}, `'MANA'`→{site_id:5}, `'MASSAWA'`→{site_id:1}, `'Sabodala'`→{site_id:1}, unknown→null.
  - `deps.getCalendarMonthlyHelpdesk(site_id, y, m)` → for site 2 `{sla_res_pct:74, …}`, site 5 `{sla_res_pct:70}`, site 1 **null (whole object)** (no zoho_group).
  - `deps.getMeetingsInsights({from,to})` → `{ site_leaderboard: [{site:'HGO', score:0.60}, {site:'MGO', score:0.50}, {site:'SGO', score:null}] }` — **the real `meetings-db.insights` leaderboard keys the code on `.site`** (it aliases `m.site_code AS site`), NOT `.site_code`; `.score` is 0-1 and can be **null** (review C3/I2). (Wrap `meetings-db.insights` so the glue calls it once per window, not per site.)
  - `deps.getInspectionAggregate({site, from, to})` → wraps `inspection-db.aggregate`; HGO `{findingStatus:[{status:'ok',n:8},{status:'minor',n:2},{status:'na',n:1}]}` (applicable=10, ok=8 → 80), MGO `{findingStatus:[]}` (applicable 0 → null), SGO `{findingStatus:[{status:'ok',n:5}]}` (→100).
  - `deps.getEffortLeaderboard({asOf})` → `{rows:[{site:'HOUNDE', effort_score:52, baseline_score:50, delta:2, rank:1}, {site:'MASSAWA', effort_score:40, baseline_score:38, delta:2, rank:3}, {site:'Sabodala', effort_score:66, baseline_score:64, delta:2, rank:2}], most_improved:null, needs_attention:null}` — **the real row shape is `{site, effort_score, baseline_score, delta, rank}` with NO `total`** (review C2). HGO→52; SGO folds MASSAWA+Sabodala via `foldEffortByCode` → **simple mean** `round((40+66)/2)=53`; MGO unmatched → null.
  Assert `loadScoreboardData({month:{year:2026,m:7}, asOf:'2026-07-31', deps})`:
  - `perSite` for HGO = `{code:'HGO', name:'Houndé', helpdesk:74, inspections:80, meetings:60, assets:52}`.
  - MGO = `{…, helpdesk:70, inspections:null, meetings:50, assets:null}` (aggregate empty → null; effort unmatched → null).
  - SGO = `{…, helpdesk:null (null-object guarded), inspections:100, meetings:null (score was null → NOT 0), assets:53 (mean of the 2 folded labels)}`.
  - `prev` present (the glue ran the same gather for month 6) — assert one prev value to prove the previous-month path fires (stub the deps to return the same shape for both windows, or a `month`-aware stub).
  - No throw when a reader returns null/empty. Run → FAIL.

- [ ] **Step 2** FAIL. **Step 3 — implement `services/scoreboardData.js`** (`require('./scoreboardAliases')` for the fold; the real server-side `deps` are `meetings-db.insights` (NOT `getMeetingsInsights`), `inspection-db.aggregate`, `reports-db.{listSiteModuleCodes,getCalendarMonthlyHelpdesk}`, `assets-db.getEffortLeaderboard` — DI KEY names below are the glue's own, wired to those in Task 3):
  - `async function assembleMonth({ monthObj, from, to, asOf, deps })`: resolve the site list via `deps.listSiteModuleCodes('meetings')` (rows `{code, site_id, name}`). Fetch ONCE per window: `const effMap = require('./scoreboardAliases').foldEffortByCode((await deps.getEffortLeaderboard({asOf})).rows)` (Map code→mean effort, **simple mean, no `total`**); `const insights = await deps.getMeetingsInsights({from,to}); const mtgMap = new Map(); for (const r of (insights.site_leaderboard||[])) mtgMap.set(r.site, r.score == null ? null : r.score*100);` (**key on `r.site`; guard null before ×100** — review C3/I2).
  - Per site, assemble `{code, name, helpdesk, inspections, meetings, assets}`:
    - helpdesk: `const hd = await deps.getCalendarMonthlyHelpdesk(site_id, monthObj.year, monthObj.m); const helpdesk = hd ? hd.sla_res_pct : null;` (**null-OBJECT guard**).
    - inspections: `const agg = await deps.getInspectionAggregate({site: code, from, to}); const fs = agg.findingStatus||[]; const applicable = fs.filter(x=>x.status!=='na').reduce((a,x)=>a+x.n,0); const ok = fs.filter(x=>x.status==='ok').reduce((a,x)=>a+x.n,0); const inspections = applicable>0 ? Math.round(100*ok/applicable) : null;`
    - meetings: `mtgMap.has(code) ? mtgMap.get(code) : null`.
    - assets: `effMap.has(code) ? effMap.get(code) : null`.
  - `loadScoreboardData({ month, asOf, deps })`: compute the month window `{from,to}` (first/last day) + the previous month window; `perSite = await assembleMonth({monthObj:month, from, to, asOf, deps})`; `prevRows = await assembleMonth({monthObj:prevMonth, from:prevFrom, to:prevTo, asOf:prevAsOf, deps})`; `prev = Object.fromEntries(prevRows.map(r=>[r.code, r]))`. Return `{ perSite, prev, month, window:{from,to} }`. `await`-correct throughout.
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
  - `services/reviewDashboard.js`: in the extras block (READ how `hdRows`/`hdNote` are emitted ~line 790 AND how his `sbRows` builds a `cells` array ~line 747), change the gate to **null-safe sub-key** form and add the scoreboard branch: `if (opts.extras && opts.extras.helpdesk) { ex.hdRows = …; ex.hdNote = …; }` and `if (opts.extras && opts.extras.scoreboard) { const sb = opts.extras.scoreboard; ex.sbuRows = sb.rows.map(shapeRowForTemplate); ex.sbuNote = { text: <method + "scoreboard = mois courant" window string>, fleet_avg: sb.fleet_avg ?? '—', most_improved: sb.most_improved?.name || '—', needs_attention: sb.needs_attention?.name || '—' }; }`. **Exactly TWO added keys — `sbuRows` + `sbuNote`** (`sbuNote` is an OBJECT carrying the callouts, bound single-dot in the template: `{{ sbuNote.fleet_avg }}` / `{{ sbuNote.most_improved }}` / `{{ sbuNote.text }}` — one dot, renderer-legal). Do NOT enter `sbs`/`comps`/`codes`.
  - **`shapeRowForTemplate` — the renderer resolves a plain key or ONE dot only (`{{ r.cells }}`, `{{ c.val }}`), NEVER two dots (`{{ dims.helpdesk.value }}` renders EMPTY and the backstop won't catch it — review I1).** So flatten each scoreboard row to a `cells` array exactly like his `sbRows` (his template does `<sc-for list="{{ r.cells }}" as="c">{{ c.val }}` with per-cell `{val, bg, fg, tip}`): `{ rank, name, score: score??'—', scoreBg:<rag colour>, delta:<'▲ +6'/'▼ −4'/'—'>, cells: [ {val: helpdesk??'—', bg:<rag>}, {val: inspections??'—', bg:<rag>}, {val: meetings??'—', bg:<rag>}, {val: assets??'—', bg:<rag>} ] }`. A null dim → `val:'—'`, neutral bg. The template binds only `{{ r.rank }}`, `{{ r.name }}`, `{{ r.score }}`, `{{ r.delta }}` and the inner `<sc-for list="{{ r.cells }}" as="c">{{ c.val }}` — single-dot throughout.
  - `server.js` `GET /api/reports/review-data`: gather helpdesk (existing `loadReviewExtras`) and the scoreboard in **SEPARATE try/catches**, compose `const extras = {}; try { extras.helpdesk = …; extras.changes = …; } catch(e){ console.error('[review helpdesk]', e.message); } try { const sd = await require('./services/scoreboardData').loadScoreboardData({ month, asOf, deps }); extras.scoreboard = require('./services/siteScoreboard').buildSiteScoreboard(sd.perSite, { prev: sd.prev }); } catch (e) { console.error('[review scoreboard]', e.message); }` then pass `extras` into `buildReviewVals`. Wire real `deps` = `{ listSiteModuleCodes: rdb.listSiteModuleCodes, getCalendarMonthlyHelpdesk: rdb.getCalendarMonthlyHelpdesk, getMeetingsInsights: (a)=>require('./meetings-db').insights(a), getInspectionAggregate:(a)=>require('./inspection-db').aggregate(a), getEffortLeaderboard: require('./assets-db').getEffortLeaderboard }`; `month = {year, m}` of `asOf`.
  - `public/it-review.html` AND `docs/reference/it-review-dashboard.template.html`: add the panel, the WHOLE thing wrapped in `<sc-if value="{{ sbuRows }}">` (heading inside), titled "Scoreboard opérationnel — 4 dimensions (helpdesk · inspections · réunions · actifs)". `<sc-for list="{{ sbuRows }}" as="r">` renders per row: `{{ r.rank }}` · `{{ r.name }}` · a global pill `{{ r.score }}` · the 4 dim cells via a nested `<sc-for list="{{ r.cells }}" as="c">{{ c.val }}</sc-for>` · `{{ r.delta }}`. Add the callouts via single-dot binds `{{ sbuNote.text }}` · `{{ sbuNote.fleet_avg }}` · `{{ sbuNote.most_improved }}` · `{{ sbuNote.needs_attention }}`. Use ONLY `{{ }}`/`<sc-for>`/`<sc-if>`, single-dot bindings, ≤2 nesting. Label clearly vs his "Score programme" panel. (Allowlist stays exactly `['hdNote','hdRows','sbuRows','sbuNote']` — `sbuNote` is one object key.)

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
  - `tools/reports/send-scoreboard.js`: mirror **only the SCAFFOLDING** of `send-hygiene.js` (gate-FIRST, `require.main===module` entrypoint guard, `module.exports = { decideScoreboardSend, main }`, the pg-init/await pattern) — **NOT its recipient model**. Hygiene is a GROUP sender (one list, `site_code='GROUP'`); the scoreboard is **per-coordinator** (review I3):
    - `decideScoreboardSend(cfg)` gates on the **ARM FLAG ONLY** — `cfg.scoreboard_send_enabled === '1'` (there is NO `scoreboard_recipients` list; recipients come from the directory). GATE FIRST — a disarmed run composes/mails/logs nothing.
    - When armed: gather the scoreboard ONCE (`loadScoreboardData`→`buildSiteScoreboard`), then **loop the sites**; per site resolve the coordinator recipient `const rcpt = reportDirectory.resolveRecipient(db, siteCode, 'coordinator')` (returns null for unconfirmed → **skip**, honouring `neverSendUnconfirmed`; **await/resolve the row per-backend the way send-hygiene does** — `resolveRecipient` throws on an un-awaited pg Promise). Skip if `reportDirectory` returns nothing OR `reportSentLog.alreadySentToday(db, 'scoreboard', siteCode, period)`. Compose `buildScoreboardDigest(scoreboard, { period, highlightSite: siteCode })` (full board, that site highlighted) → `mailer` → `reportSentLog.record(db, { report_type:'scoreboard', site_code: siteCode, period, recipients:[rcpt], result:'sent' })` (**note the leading `db` arg** — review M1).
    - `--preview` renders (e.g. the first/one site's digest) without sending or logging.
  - `services/reportSchedule.js`: add `'scoreboard'` to `TYPES`; extend `cliFor` so `cliFor('scoreboard')` → the `send-scoreboard.js` path (mirror how `'hygiene'` maps to `send-hygiene.js`).
  - `server.js`: add `POST /api/reports/scoreboard/send?preview=1|0` (`requireReportSession, requireAdmin`) → `require('../tools/reports/send-scoreboard').main({ preview, force })` — mirror the existing hygiene send route `POST /api/assets/hygiene/send` (READ it + copy the shape). (Confirmed: the hygiene route exists and is the template.)
  - `public/reports.html`: an admin card (admin+) "📊 Scoreboard opérationnel" — arm toggle (`scoreboard_send_enabled` via `/api/reports/config`, **both save+load lines**) + schedule (reuse the hygiene card's schedule controls, type `'scoreboard'`) + Preview / Send-now buttons → `POST /api/reports/scoreboard/send?preview=1|0` (mirror `previewHygiene`/`sendHygieneNow`). **No recipients field** — recipients come from the per-site coordinator directory (existing Sites/Directory admin), not this card.

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
