# Weekly report email + assets worklist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Steps use checkbox (`- [ ]`) syntax.

**Goal:** Email the **authored** per-site weekly report to that site's **confirmed**
recipients each week, with an assets-hygiene worklist appended and the existing PPTX
attached.

**Architecture:** A new `weekly_report` type riding the existing delivery rails
(`reportDirectory` / `reportSentLog` / `mailer` / `reportSchedule`). Data comes from
`getReport()` — the authored snapshot, replayed, never re-queried. Email HTML is a new
composer built on helpers extracted from the monthly template.

**Tech Stack:** Node + Express, better-sqlite3 / PostgreSQL dual-backend,
`node --test`, nodemailer, pptxgenjs. **Shell is PowerShell** — env vars are
`$env:NAME='v'; cmd`, not `NAME=v cmd`.

**Spec:** `docs/superpowers/specs/2026-07-21-weekly-report-email-design.md` (rev 2).

**Branch:** `feat/weekly-report-email` from `main`.

---

## Ground rules (violating any is a defect, not a style choice)

1. **Await every hop.** `getSiteIdByModuleCode`, `listReports`, `getReport`,
   `listSites`, `getHygieneSummary`, `getEffortLeaderboard` are **async under
   postgres**. `tests/await-precedence.test.js` must stay **5/5**.
2. **Never pass a falsy `site_id` to `listReports`.** `if (site_id)` drops the filter
   and returns **every site's** report — in **both** backends (`reports-db.js:2072`
   sqlite, **`:2556` pg**). This is a cross-site data leak.
3. **The child key is `helpdesk`**, not `helpdesk_data`, and it defaults to `{}`.
4. **`result` vocabulary is exactly** `'ok'` | `'resent'` | `'fail'`.
5. **New config keys MUST be in `reportConfig.DEFAULTS`** (`services/reportConfig.js:5`)
   or `setConfig` silently drops the admin's save (`:66`).
6. **Table-based email HTML only** — no flex/grid/custom properties
   (`coordinator.js:8-11`).
7. Run tests: `node --test --test-force-exit <files>` from the repo root.

### Corrected line numbers (the spec has some stale ones — trust THIS table)

| Thing | Correct location |
|---|---|
| `getPreviousWeek()` | `reports-db.js:948` — **exported**, returns `{year, week}` |
| `getISOWeek` | `reports-db.js:912` — **module-private, NOT exported.** Do not `require` it |
| `sendCoordinatorReport` hardcoded in the send route | `server.js:4942` |
| 120 s send cap | `server.js:4933` |
| `getWeekSummaryData` status+active gate | **`reports-db.js:4689`** (pg fork repeats at `:4705`) |
| `_meetingsSummaryForSite` | `server.js:6033-6040` (**8 lines**, not exported) |
| Admin rail super_admin gates | `reports.html:4819-4824` |
| `saveScheduleRow` declaration | `reports.html:5911` |
| Monthly email fixture to copy | `tests/report-template-coordinator.test.js:12-42` |

---

## File structure

| File | Responsibility |
|---|---|
| `services/reportTemplates/_primitives.js` | **NEW.** Shared email helpers + palette. |
| `services/reportTemplates/coordinator.js` | **MODIFY.** Requires primitives. Output **byte-identical**. |
| `services/reportTemplates/weekly.js` | **NEW.** `composeWeekly(data)`. Pure. |
| `services/weeklyReportData.js` | **NEW.** Resolution chain, status gate, assets fold. |
| `services/sendWeeklyReport.js` | **NEW.** Sender. |
| `tools/reports/send-weekly.js` | **NEW.** CLI. |
| `services/reportConfig.js` | **MODIFY.** `weekly_report_send_enabled`. |
| `services/reportSchedule.js` | **MODIFY.** `TYPES` (`:14`) + `cliFor` (`:19`). |
| `services/sendCoordinator.js` | **MODIFY.** Delete the dead cadence `kind` only. |
| `tools/reports/send-reports.js` | **MODIFY.** Stop passing `kind`. |
| `server.js` | **MODIFY.** `POST /api/reports/weekly/send`. |
| `public/reports.html` | **MODIFY.** Schedule row + panel surfaces + Coordinator monthly-only. |

> **`SUPPORTED_TYPES` (`send-reports.js:14`) is deliberately N/A** — `cliFor` routes
> `weekly_report` to its own CLI, so it never passes through `send-reports.js`. The
> spec's ten-surface table lists it; do not add it there.

---

## Task 0 — Kill the dead cadence `kind` (independent live defect)

**Files:** Modify `services/sendCoordinator.js`, `tools/reports/send-reports.js`,
`server.js`; existing tests must stay green.

- [ ] **Step 1 — Prove it is dead.** Run:
  `grep -rn "period.kind\|p\.kind" services/siteReport.js services/siteReportDeps.js`
  Expected: **no hits**. (Confirmed: only `public/site-report.js:40` reads a `kind`,
  display-only.) If a real read exists, STOP and report.
- [ ] **Step 2 — Remove it.** `sendCoordinator.js:80` drop `kind = 'weekly'` from the
  destructure; `:87` drop it from the `console.log`; `:104` →
  `D.siteReportData(site, { year, month }, D.buildSiteReportDeps())`.
  **Also update the contract comment at `sendCoordinator.js:9-15`** — it documents
  `kind` in the signature and this repo treats those comments as load-bearing.
  `send-reports.js:100` drop `kind: cadence`. `server.js` remove the `kind` query var
  read in `POST /api/reports/send` and stop forwarding it.
- [ ] **Step 3 — ⚠ Do NOT touch these two unrelated `kind`s.**
  - `server.js:4848` — `const kind = req.query.kind === 'monthly' ? …` inside
    `/api/reports/site-data`. **Different feature. Leave it.**
  - `tests/send-reports-cli.test.js:125` — *"kind is honoured — fm resolves the fm_*
    columns"*. That is the **recipient-type** kind (fm vs coordinator), a documented
    regression guard (`:28`). **Do not delete this test.**
  Only the *cadence* `kind` is removed.
- [ ] **Step 4 — Tests.** Run:
  `node --test --test-force-exit tests/send-coordinator-recipients.test.js tests/report-send-route.smoke.test.js tests/send-reports-cli.test.js`
  Expected: **all pass**, including the fm-kind test at `:125`.
- [ ] **Step 5 — Commit:**
  `fix(reports): remove the dead cadence kind — a weekly schedule mailed the monthly report`

## Task 1 — Extract email primitives (monthly output byte-identical)

**Files:** Create `services/reportTemplates/_primitives.js`,
`tests/fixtures/monthly-email-golden.js`, `tests/report-template-primitives.test.js`;
Modify `services/reportTemplates/coordinator.js`.

> `tests/report-template-coordinator.test.js` **cannot** catch a regression here — its
> strongest assertion strips all markup (`:305-314`,
> `html.replace(/<[^>]+>/g,'')`). The goldens below are the only protection.

- [ ] **Step 1 — Build the fixtures.** Create `tests/fixtures/monthly-email-golden.js`
  exporting **two** data objects:
  - `full` — **copy the `data` literal verbatim from
    `tests/report-template-coordinator.test.js:12-42`** (it is complete; do not invent
    a shape).
  - `nonApplicable` — the same object with `score: { applicable:false, rag:null,
    score:null, points:null, dims:[], moves:[] }`.
  **Why two:** `scoreRagColor` (`coordinator.js:30`) forward-references `MUTED` (`:44`)
  only on the `rag:null` fallback. With `rag:'AMBER'` the `||` short-circuits and
  `MUTED` is never evaluated — so a one-golden suite passes even if the extraction
  leaves `MUTED` unresolved, which is the exact hazard this task names.
- [ ] **Step 2 — Write the golden test:**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { composeCoordinator } = require('../services/reportTemplates/coordinator');
const FIX = require('./fixtures/monthly-email-golden');

for (const name of ['full', 'nonApplicable']) {
  test(`monthly email HTML is byte-identical to the golden — ${name}`, () => {
    const file = path.join(__dirname, '__golden__', `monthly-email-${name}.html`);
    const { fullHtml } = composeCoordinator(FIX[name]);
    // Repo precedent (tests/pptx-monthly-golden.test.js:161): also write when the
    // golden is missing, so a first run gives a readable result, not ENOENT.
    if (process.env.GOLDEN_UPDATE === '1' || !fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, fullHtml, 'utf8');
    }
    assert.strictEqual(fullHtml, fs.readFileSync(file, 'utf8'),
      'the monthly email changed — the extraction was NOT behaviour-preserving');
  });
}
```

- [ ] **Step 3 — Generate from UNMODIFIED code, then re-run clean.** PowerShell:
  `$env:GOLDEN_UPDATE='1'; node --test --test-force-exit tests/report-template-primitives.test.js; $env:GOLDEN_UPDATE=''`
  then `node --test --test-force-exit tests/report-template-primitives.test.js`
  Expected: PASS.
- [ ] **Step 4 — Commit the baseline BEFORE refactoring:**
  `test(reports): pin the monthly email HTML byte-for-byte (2 goldens)`
- [ ] **Step 5 — Extract into `_primitives.js`:** `obj`/`arr`/`num` (`:60-62`),
  `card` (`:65`), `kpiGrid` (`:75`), `bulletList` (`:94`), `emptyNote` (`:105`),
  `chip` (`:109`), `escapeHtml`, `scoreRagColor` (`:30`), and the palette —
  **`RAG_COLORS` (`:22`) and `SCORE_RAG` (`:29`) stay SEPARATE exports** (different
  reds, `#DC2626` vs `#c2280f`; merging breaks
  `tests/report-template-coordinator.test.js:108`) plus the scalars `NAVY`, `TEAL`,
  `INK`, `MUTED`, `BORDER`, `WASH`, `FONT` (`:41-47`). Define `MUTED` **above**
  `scoreRagColor`.
  **`coordinator.js` must then re-import at least:** `obj, arr, num, card, kpiGrid,
  bulletList, emptyNote, chip, escapeHtml, scoreRagColor, RAG_COLORS, SCORE_RAG,
  NAVY, TEAL, INK, MUTED, BORDER, WASH, FONT`. `ptsColor` (`:40`) and
  `scoreRagLabel` (`:35`) **stay in `coordinator.js`** — they are monthly-specific and
  `scoreRagLabel` needs `SCORE_RAG` imported.
  **DO NOT touch `ragLegend`'s LOCAL `chip` (`:431`)** — a *different* function,
  different geometry, **no escaping**. Leave it inline.
- [ ] **Step 6 — Verify.** Run:
  `node --test --test-force-exit tests/report-template-primitives.test.js tests/report-template-coordinator.test.js`
  Expected: **both PASS**. If a golden fails, fix the extraction — **never regenerate
  the golden**.
- [ ] **Step 7 — Commit:** `refactor(reports): extract shared email primitives (monthly byte-identical)`

## Task 2 — `weeklyReportData.js` — resolution chain, status gate, assets fold

**Files:** Create `services/weeklyReportData.js`; Test `tests/weekly-report-data.test.js`.

```js
// loadWeeklyReportData({ siteCode, year, week, deps }) →
//   { ok:true, report, week:{year,week,label,start,end}, assets }
//   | { ok:false, reason:'<english, operator-facing>' }
```

**The active gate (spec D2) uses `listSites()`** — it already defaults to
**active-only** and returns `{id, active}` (`reports-db.js:1591`). Resolve with
`(await listSites()).find(s => s.id === site_id)`; not found → inactive. **Do not
widen `getSiteIdByModuleCode`** — it is shared with `sendCoordinator.js:96`.

- [ ] **Step 1 — failing tests.** Inject `deps` (`reportsDb`, `assetsDb`, `aliases`).
  Assert:
  1. Unresolvable code → `{ok:false, reason:/meetings module code/i}` **and
     `deps.reportsDb.listReports` call count is 0**.
  2. **The severe trap:** resolver returns a *truthy row with no `site_id`*
     (`{name:'X', zoho_group:'y'}`) → **`listReports` call count is 0**. (This is the
     `{site_id}`-vs-`{id}` mis-destructure; tests 1 and 3 do NOT cover it.)
  3. Resolver returns `{site_id: 7}` → `listReports` called with **`7`**.
  4. No row for the week → `{ok:false, reason:/no report/i}`. (A W53 with no `weeks`
     row lands here — spec amendment; there is no separate "unknown week" reason.)
  5. `status:'ready'` → `{ok:false}` and the reason **must NOT match
     `/not submitted/i`** — it says complete-but-not-submitted.
  6. `status:'in_progress'` and `'draft'` → `{ok:false, reason:/not finished/i}`.
  7. `status:'submitted'` → `{ok:true}`, `report` is the `getReport` result.
  8. Site absent from `listSites()` → `{ok:false, reason:/inactive/i}`.
  9. **Fold SGO:** `getHygieneSummary` returns `{by_kind:{no_owner:3, ghost:1}}` for
     `Sabodala` and `{by_kind:{no_owner:4, ghost:0}}` for `MASSAWA` → SGO reports
     `no_owner: 7`. Assert `getHygieneSummary` called **exactly twice**.
     (7 discriminates a **sum** from a mean (3.5) and from a single call (3 or 4).)
  10. **Fold OUA:** same for `ouagadougou` + `ouaga`. A SGO-only test passes while OUA
      stays broken.
  11. Zero-count kinds are **absent** from the worklist, not present as `0`.
  12. No AP label maps to the code → `assets` is `null`, **not** zeros.
  13. Effort: assert `assets.effort_score` and `assets.rank` **equal expected values**
      *and* `'delta' in assets === false`. (Absence-only would pass for a no-op.)
  Run → FAIL.
- [ ] **Step 2** Confirm FAIL. **Step 3 — implement.**
  - Chain: `getSiteIdByModuleCode('meetings', siteCode)` → **guard `!row || !row.site_id`**
    → `listSites()` active check → `listReports(row.site_id, year, week)` →
    `rows[0].id` → `getReport(id)`. Every call awaited.
  - **Hygiene fold:** invert `aliases.ALIAS` to code→labels; call
    `getHygieneSummary({site: label})` **per label**; **SUM `by_kind`** across labels;
    drop zero counts.
  - **Effort fold:** `getEffortLeaderboard({asOf})` returns
    **`{rows, most_improved, needs_attention}`** — take `.rows`, which are keyed per
    **AP label**. Fold the score with `aliases.foldEffortByCode`
    (`scoreboardAliases.js:32` — an **unweighted mean**, which is correct for a score).
    **`rank` must be RECOMPUTED after folding** — a mean of two ranks is meaningless.
    Rank = position of this code's folded score among all folded codes, descending.
    Carry `{effort_score, rank}` only; **drop `delta`** (spec D4).
- [ ] **Step 4** Run:
  `node --test --test-force-exit tests/weekly-report-data.test.js tests/await-precedence.test.js`
  Expected: all PASS, await-precedence **5/5**.
- [ ] **Step 5 — Commit:** `feat(reports): weekly report data loader — chain, status gate, assets fold`

## Task 3 — `weekly.js` composer

**Files:** Create `services/reportTemplates/weekly.js`; Test `tests/report-template-weekly.test.js`.

### What a weekly report actually contains (from `reports-db.js:83-140`)

| Child | Columns to render |
|---|---|
| `infra_kpis[]` | `service`, `kpi`, `target`, `status_value`, **`status_color`**, `trend` (`up`\|`down`\|`stable`\|`no_change`) |
| `helpdesk{}` | Render **`comments_metrics`** and **`comments_sla`** (the human-authored text) + `techs_on_duty`, `tech_on_break`. **Ignore** `time_to_assign`/`first_reply`/`resolution_time`/`closing_time` and their `_prev` twins — they are **dormant, NULL on every row** (superseded by `chart_data`). Do not render `chart_data`/`group_metrics`/`all_groups` (chart payloads, not email content). |
| `lights[]` | `content`, grouped by **`type`**: `low_light`, `high_light`, `change_in_progress`, `change_pending` (four groups, labelled) |
| `action_items[]` | `task`, `priority`, `due_date`, `owner`, `status` |

> **🔴 `status_color` is `green | orange | red | none` — NOT `amber`.**
> `reports-db.js:90` stores `orange`; `reports.html:2358` *labels* it
> `🟡 Amber` while storing `orange`; `RAG_COLORS` (`_primitives.js`) is keyed
> `green/amber/red`. **A naive `RAG_COLORS[status_color]` returns `undefined` for
> every warning KPI** — the most common non-green state. Map explicitly:
> `{green:'green', orange:'amber', red:'red', none:null}` → then index `RAG_COLORS`.
> `none` renders unstyled, never as a colour.

`fullHtml` exists for the **admin preview pane** (the send route returns it); the
email itself sends `htmlBody`. There is no weekly PDF.

- [ ] **Step 1 — failing tests.** Assert:
  1. `subject` contains the site code, `W30 2026`, **and the date range**.
  2. Authored content renders: an `infra_kpis` `service`+`kpi`, a `lights` `content`,
     an `action_items` `task`.
  3. **`status_color:'orange'` renders the AMBER colour `#D97706`** — assert the hex
     appears and that the string `undefined` does **not** appear in `htmlBody`.
     `status_color:'none'` renders without a RAG colour and without `undefined`.
  4. All four `lights.type` groups render under distinct labels.
  5. `helpdesk:{comments_metrics:'X', comments_sla:'Y'}` → both strings appear.
     `helpdesk:{}` → a stated "no helpdesk data" note, not blank and not `undefined`.
  6. **Authored report appears BEFORE the assets block** (`indexOf` comparison).
  7. `assets:null` → no assets section (assert a hygiene marker string is absent).
  8. `pptxFailed:true` → footer note present; `false` → absent.
  9. `fetched_at` renders in the footer.
  10. **Outlook guard — assert over `htmlBody`** (what Outlook renders; the existing
      coordinator test targets `htmlBody` at `:114-117`), and match
      `/display:\s*(inline-)?(flex|grid)/i` — **plain `/(flex|grid)/` misses
      `inline-flex`, which is equally broken in Outlook**. Also assert `!/var\(--/`.
  11. A `lights.content` containing `<script>` is escaped.
  Run → FAIL.
- [ ] **Step 2** FAIL. **Step 3 — implement** using `_primitives.js`. Table-based only.
  French user-facing copy.
- [ ] **Step 4** Run:
  `node --test --test-force-exit tests/report-template-weekly.test.js tests/report-template-primitives.test.js`
  Expected: PASS, monthly goldens **still** green.
- [ ] **Step 5 — Commit:** `feat(reports): weekly email composer`

## Task 4 — `sendWeeklyReport.js` sender

**Files:** Create `services/sendWeeklyReport.js`; Test `tests/send-weekly-report.test.js`.

Mirror `sendCoordinator.js`'s DI shape. **Do not modify `sendCoordinator.js`.**

**Injected `deps` (all of them):** `weeklyReportData`, `composeWeekly`,
`reportDirectory`, `reportSentLog`, `reportConfig`, `buildMailer`, `generatePptx`.
`composeWeekly` **must** be injectable (test 7 observes what reached it);
`reportConfig` supplies `never_send_unconfirmed` + the mailer config
(`sendCoordinator.js:112-116`).

### Order (resolves the spec's ambiguity — this is authoritative)

```
data → preview short-circuit → recipients → dedup short-circuit
     → PPTX (60 s timeout) → composeWeekly({...data, pptxFailed}) → mail → log
```

**PPTX comes AFTER dedup, not before.** `sendCoordinator.js:140-148` deliberately
puts its expensive PDF after the dedup check so an already-sent run costs nothing; a
~13-site fleet loop at 60 s each would otherwise burn ~13 minutes building decks for a
run that mails nothing. **Preview builds no PPTX** (`pptxFailed:false` on that path).

- [ ] **Step 1 — failing tests.** Assert:
  1. Happy path → mails the **confirmed** coordinator; `record` called with
     `report_type:'weekly_report'`, `period:'2026-W30'`, `result:'ok'`.
  2. `force:true` → `result:'resent'`.
  3. Unconfirmed address → skipped, **mailer never called**.
  4. `alreadySentToday` true → `{skipped:true, reason:/already sent/i}`, **no mail,
     and `generatePptx` call count is 0** (proves PPTX is after dedup).
  5. `weeklyReportData` → `{ok:false, reason}` → reason propagated verbatim; nothing
     mailed or logged.
  6. `preview:true` → `{preview:true, subject, html}`; **no mail, no log, and
     `generatePptx` call count is 0**.
  7. **PPTX throws → the email STILL sends.** Assert **all three**: the mailer was
     called, `composeWeekly` received `pptxFailed:true`, and the mail's `attachments`
     is empty. (Mailer-called alone is vacuous — a no-op that never calls
     `generatePptx` would pass.)
  8. PPTX succeeds → assert the attachment's **filename** and that its content **is
     the stub's buffer** (identity, not merely non-empty).
  9. Week 3 → `'2026-W03'`, never `'2026-W3'`.
  Run → FAIL.
- [ ] **Step 2** FAIL. **Step 3 — implement** in the order above.
  PPTX args (from `server.js:6046-6063`): `report`,
  `{infra_kpis: await getPreviousWeekInfraKpis(site_id, report_id)}`,
  `getOpenChangesForSite(groups)`, `getActiveMajorIncidentsForSite(groups)`, and the
  meetings summary (inline `_meetingsSummaryForSite`'s 8 lines, `server.js:6033-6040`
  — not exported). **`groups` comes from `report.zoho_group`** (already on the
  `getReport` result — no `listSites()` round-trip needed).
  `generateWeeklyPptx` is **async → `Promise<Buffer>`**.
- [ ] **Step 4** Run: `node --test --test-force-exit tests/send-weekly-report.test.js tests/send-*.test.js`
  Expected: all PASS.
- [ ] **Step 5 — Commit:** `feat(reports): weekly report sender`

## Task 5 — CLI + config key + schedule type

**Files:** Create `tools/reports/send-weekly.js`; Modify `services/reportConfig.js`,
`services/reportSchedule.js`; Test `tests/send-weekly-cli.test.js`,
`tests/report-config-weekly.test.js`.

- [ ] **Step 1 — failing tests.**
  - `report-config-weekly`: `weekly_report_send_enabled` defaults `'0'`; `setConfig`
    **persists** it (proving it reached `DEFAULTS` — otherwise silently dropped, `:66`).
  - `send-weekly-cli`: `require`-ing the module has **no side effect** (the
    `require.main` guard — this repo has the documented "test file reports fewer tests
    than it declares" failure); `decideWeeklySend({weekly_report_send_enabled:'0'})`
    → false, `'1'` → true; `main({cfg: disabled})` → `{sent:0, reason:'disabled'}`
    **without** touching the directory or mailer stubs (gate-FIRST); bare `--preview`
    (parses to `{preview: undefined}`) detected by **presence**, not truthiness.
  Run → FAIL.
- [ ] **Step 2** FAIL. **Step 3 — implement.** Copy the scaffolding from
  `tools/reports/send-scoreboard.js:28-60` verbatim (arg parse, presence-not-truthiness
  flags, `initPgReports()` under `REPORTS_BACKEND=postgres`, gate-before-gather,
  `require.main` guard, `module.exports = { decideWeeklySend, main }`).
  **Period: `getPreviousWeek()`** (`reports-db.js:948`, exported, returns
  `{year, week}`) → `` `${year}-W${String(week).padStart(2,'0')}` ``.
  **Do NOT `require` `getISOWeek` — it is module-private** and would be `undefined`
  at run time. Explicit `--year=`/`--week=` args override.
  Loop directory sites; per-site `alreadySentToday(db,'weekly_report',site,period)`.
  Add `'weekly_report'` to `reportSchedule.TYPES` (`:14`) + a `cliFor` mapping (`:19`).
- [ ] **Step 4** Run:
  `node --test --test-force-exit tests/send-weekly-cli.test.js tests/report-config-weekly.test.js tests/report-schedule*.test.js`
- [ ] **Step 5 — Commit:** `feat(reports): send-weekly CLI + weekly_report schedule type`

## Task 6 — Route + admin UI + browser verification

**Files:** Modify `server.js`, `public/reports.html`; Test
`tests/weekly-send-route.smoke.test.js`.

> **Do NOT add `'weekly_report'` to `SEND_TYPES`** (`server.js:4911`).
> `POST /api/reports/send` hardcodes `sendCoordinatorReport` at **`:4942`**, so it
> would mail a **monthly** report and log it as `weekly_report` — a wrong-content
> success poisoning the dedup lane.

- [ ] **Step 1 — failing smoke.** `POST /api/reports/weekly/send?preview=1` (admin) →
  200; no session → 401/403; non-admin → 403; disarmed → `{sent:0, reason:'disabled'}`
  (never 500). Run → FAIL.
- [ ] **Step 2** FAIL. **Step 3 — implement the route**, copying `server.js:2400-2411`
  (the scoreboard route) and swapping in `require('./tools/reports/send-weekly')`.
- [ ] **Step 4 — Admin UI surfaces.** Wire the type through **all** of: `_AR_TYPES`
  (`reports.html:5620`), `_ADMIN_PANEL_IDS` (`:4773`), the hash allowlist (`:4843`),
  the rail role gates (**`:4819-4824`**), and the `saveScheduleRow` branch
  (declared **`:5911`**). Missing one leaves the panel half-working.
  **Surface the skip reasons** in the card's result area — spec Risks requires the
  reason in the CLI log **and** the admin UI; render `{skipped, reason}` verbatim per
  site, not a generic "nothing sent".
- [ ] **Step 5 — Coordinator monthly-only (D8).** The Coordinator schedule row must
  offer **no Weekly checkbox**. Preferred: a per-type capability flag in `_AR_TYPES`
  (e.g. `{weekly:false}`) honoured by the generic table. Any change holding the
  invariant durably is acceptable; a bare special-case comment is not.
- [ ] **Step 6 — VERIFY IN BROWSER (mandatory).** `preview_start`, admin PG session,
  **restart (stop+start — `reports.html` is `_htmlCache`'d)**, `/reports.html#admin`:
  - Coordinator row shows **no** Weekly option; the weekly-report row does.
  - Preview a site with a **submitted** report → HTML renders, authored content first,
    assets after, **nothing mailed** (assert no new `report_sent_log` row).
  - Preview a site whose report is **`ready`** → the reason says complete-but-not-
    submitted, NOT "not submitted".
  - Zero console errors. Screenshot.
- [ ] **Step 7 — Commit:** `feat(reports): weekly send route + admin card; coordinator is monthly-only`

## Task 7 — Regression, docs, finish

- [ ] **Step 1 — Full suite.**
  `node --test --test-force-exit tests/weekly-*.test.js tests/send-*.test.js tests/report-*.test.js tests/site-report*.test.js tests/await-precedence.test.js`
  Expected: green, await-precedence **5/5**, **both monthly goldens still pass**.
- [ ] **Step 2 — Prove no regression.** Any failure: `git stash` → check out `main` →
  re-run → confirm it fails there too before calling it pre-existing. Report honestly
  which are pre-existing (the known `pgDb not initialised` route smokes) and which are new.
- [ ] **Step 3 — CLAUDE.md.** Current-State entry + pitfall rows:
  (a) the weekly email delivers the **authored** report — `helpdesk_data` is a frozen
  snapshot with `fetched_at`, never re-queried, so email and deck cannot disagree;
  (b) `getSiteIdByModuleCode` returns `{site_id}` and `listReports` drops its filter on
  a falsy id in **both** backends (`:2072`, `:2556`) → cross-site leak;
  (c) weekly status is **four** values, the client auto-sets `ready`, and the schema
  comment at `reports-db.js:73` is stale;
  (d) **`infra_kpis.status_color` is `orange`, not `amber`** — the UI labels it "Amber"
  while storing `orange`, so an unmapped `RAG_COLORS[status_color]` is `undefined` for
  every warning KPI;
  (e) `POST /api/reports/send` hardcodes the coordinator composer → a new type needs
  its own route;
  (f) `by_site` is 4 **present**-counts — fold `by_kind` per label instead;
  (g) `getISOWeek` is module-private; `getPreviousWeek()` is the exported entry point;
  (h) the monthly email HTML is pinned byte-for-byte because the existing template
  test strips markup.
- [ ] **Step 4** Commit, merge to `main`, rebuild the deploy ZIP.

## Done criteria

- [ ] A **submitted** weekly report mails to that site's **confirmed** recipients, PPTX attached.
- [ ] Each of the **five** non-send conditions is distinguishable; `ready` is never reported merely as "not submitted"; reasons surface in the CLI log **and** the admin card.
- [ ] Assets: score + rank (rank **recomputed** after the fold) + non-zero worklists; **both** folds (SGO, OUA) **summed**.
- [ ] `status_color:'orange'` renders amber — no `undefined` anywhere in the email.
- [ ] Dedup per (type, site, week); re-send is `force`, logged `'resent'`.
- [ ] **Both monthly goldens byte-identical.**
- [ ] Dead cadence `kind` gone; Coordinator/Weekly cannot mail a monthly.
- [ ] Armed off by default; schedulable; sendable via its own route. Browser-verified.
