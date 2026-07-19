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
| **Inspections** | ⚠️ derive | from `inspection-db.js getSiteScoreInputs(siteCode, from, to)` → `{inspections, findings}` (or `aggregate({site,from,to})`) |

- **Site crosswalk:** `reports-db.js site_module_codes(site_id, module, code)` + `getSiteIdByModuleCode(module, code)` → `{site_id, name, zoho_group}`. The reporting suite pins the **meetings** namespace as canonical (`services/siteReportDeps.js MODULE_NS='meetings'`) and resolves `site_id`/`zoho_group` from it. We do the same: iterate the meetings-namespace site codes, resolve each once, then fan out to the four readers.
- **Assets reconciliation:** `getEffortLeaderboard` is keyed by the free-form `asset_effort_history.site` label, NOT `site_id`. We map that label to the canonical site by name/alias (via `site_module_codes` if an `assets` namespace exists, else an accent/case-folded name match against `getSiteIdByModuleCode(...).name`). A site with no matching effort row → assets dimension **absent** (null), not 0.
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
        · inspections : conformity% derived from getSiteScoreInputs(code, from, to)
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
  - **helpdesk** = `getCalendarMonthlyHelpdesk(site_id, year, month).sla_res_pct` (null when no verdict).
  - **meetings** = `insights({from,to,site:code}).site_leaderboard` row `.score × 100` (null when the site has no meeting engagement data).
  - **inspections** = conformity %: present iff `getSiteScoreInputs(code, from, to).inspections > 0`; `conformity = round(100 × (1 − criticalMajor / max(1, totalFindings)))` where `criticalMajor`/`totalFindings` come from the same `findings` bucket (0 findings on an inspected site → 100). Absent (no inspection in window) → null. **(The exact field names are pinned against `getSiteScoreInputs`/`aggregate` during implementation — the intent is: "share of findings that are not critical/major, on sites that were actually inspected".)**
  - **assets** = the `effort_score` from `getEffortLeaderboard({asOf})` whose `site` label matches this site (accent/case-folded name/alias match); null if unmatched.
- Also gather the **previous month**'s four dims the same way → `prev` (for Δ). Cheap; monthly, not a hot path.
- Return `{ perSite, prev, month, window }` for `buildSiteScoreboard`.
- **Window:** monthly. `from`/`to` = first/last day of the month (the windowed readers), `asOf` = month-end (or today for the current month); helpdesk uses `(year, month)` directly. Honestly heterogeneous (SLA% is calendar-month, effort is point-in-time) — the note states the window.

### 3) Page integration (additive, allowlist-guarded)

- The route `GET /api/reports/review-data` (`server.js`) calls `loadScoreboardData` alongside `loadReviewExtras` (both in the existing try/catch — a scoreboard failure just drops the panel, never 500s), and passes the built scoreboard into `buildReviewVals` via `opts.extras.scoreboard`.
- `buildReviewVals` (`reviewDashboard.js`), in the SAME additive block that emits `hdRows`/`hdNote`, emits `sbuRows` (the scoreboard rows, shaped for the template) + `sbuNote` (method + coverage + window string) **only when `opts.extras.scoreboard` is present**. It does not enter `sbs`/`comps`/`codes`.
- `it-review.html`: a NEW panel (a `<sc-if value="{{ sbuRows }}">` wrapping a `<sc-for>` table — heading included, so the degrade path renders nothing when absent) titled "Scoreboard opérationnel — 4 dimensions", showing per site: rank · site · **global** (RAG pill + score) · helpdesk · inspections · réunions · actifs (each a RAG chip) · Δ. Plus the coverage/method note + fleet avg + most-improved/needs-attention callouts. Reuses the renderer's 3 primitives (`{{ }}`/`<sc-for>`/`<sc-if>`) — **no new renderer features** (the renderer is a fixed 3-primitive grammar; see the pitfalls). A cell with a null dim renders "—".
- `tests/review-fidelity.test.js` allowlist extended to `['hdNote','hdRows','sbuRows','sbuNote']`.

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
- **`tests/review-render.test.js`** (the renderer BACKSTOP) — the new panel's `<sc-for>`/`<sc-if>` parse correctly against the real template in all views (this is the ONLY thing that catches an inert page — never skip it).
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
- The send CLI MUST be entrypoint-guarded (`require.main === module`) or `require()`-ing it in the test executes it (the documented "1 test passed, ran 0" trap).
- Dual-backend readers are await-covered (`tests/await-precedence.test.js`); the glue awaits every reader.
