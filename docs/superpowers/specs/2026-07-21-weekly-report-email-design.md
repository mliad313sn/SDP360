# Email the authored weekly report + assets worklist — design

**Date:** 2026-07-21 · **rev 2** (after adversarial review)
**Status:** spec, reviewed — ready to plan
**Branch (planned):** `feat/weekly-report-email`
**Supersedes:** `2026-07-21-coordinator-weekly-report-design.SUPERSEDED.md` (designed a
*computed* digest; the user chose to deliver the *authored* report instead)

## Problem

Site coordinators already author a **weekly report** — **153 rows across 18 weeks**
in `weekly_reports` today. Nobody emails them; the only output is a manual PPTX
download (`server.js:6043`).

**Mail that authored report to the site's confirmed recipients each week, with an
assets worklist appended so coordinators are reminded to act on CMDB hygiene.**

## Verified substrate — corrected against the code

| Thing | Where | Exact fact |
|---|---|---|
| Hydrated reader | `getReport(id)` `reports-db.js:2034` | Returns `wr.*` + `year, week_number, start_date, end_date, week_label, site_name, zoho_group`, plus children **`infra_kpis[]` · `helpdesk{}` · `lights[]` · `action_items[]`** |
| Index reader | `listReports(site_id, year, week)` `:2064` | Header fields only — **no children**, and **no `site_id`** in the projection |
| Code→id | `getSiteIdByModuleCode(module, code)` `:1608` | Returns **`{site_id, name, zoho_group}`** or `null` |
| Week | `getWeekRange(year, week)` `:924` · `getISOWeek(date)` `:912` · `getPreviousWeek()` `:947` | W01 = **first Sunday** (`_zFirstSun:905`). `getISOWeek` is misnamed — it computes the **Zoho** week and rolls the year back for early-January dates |
| Assets worklists | `HYGIENE_KINDS` `assets-db.js:233` | **8** kinds, each `{label, where}` — a **predicate string**; the `COUNT(*)` is applied at the call site (`:305`) |
| Per-kind counts | `getHygieneSummary(filters)` `:296` | **`by_kind`** = all 8 kinds, honouring the filters (`:302-306`) → call it **per label**. **`by_site`** (`:281-294`) is NOT a shortcut: only 4 columns, and they are **present-counts (inverted gaps)** — see D4 |
| Effort | `getEffortLeaderboard({asOf})` `:1144` | Returns **`{rows, most_improved, needs_attention}`**; each row `{effort_score, baseline_score, delta, rank}` |
| Label→code | `scoreboardAliases.ALIAS` `:6` | **Many-to-one, and there are TWO folds**: `massawa`+`sabodala`→`SGO`, `ouagadougou`+`ouaga`→`OUA` |

**No HTML rendering of a weekly report exists anywhere** — only the 82 KB pptxgenjs
builder. This spec writes the composer.

### ⚠ Three corrections that would each have shipped a bug

1. **The child key is `helpdesk`, not `helpdesk_data`** (`:2048`) — the latter is the
   *table* name. And it **defaults to `{}`, not null**, so destructuring the wrong
   name renders an empty helpdesk section **with no error**.
2. **`getReport` returns no site code.** The projection (`:2037`) flattens only
   `site_name` and `zoho_group`. The assets fold needs a *code* — it must be carried
   in from the directory row, never read off the report.
3. **Only four fields are JSON-parsed**, all on `helpdesk`: `sla_violations`,
   `group_metrics`, `all_groups`, `chart_data` (`:2049-2060`). The other children are
   raw rows.

## Decisions

### D1 — Replay the authored snapshot; never re-query live

`helpdesk_data` is **computed once and frozen** at save time with a `fetched_at`
stamp (`:116`); `infra_kpis` / `lights` / `action_items` are typed by a human. The
email renders exactly what the coordinator authored and already saw in their PPTX.

Re-querying live would make **the email and the deck disagree about the same week**,
silently. `fetched_at` is shown in the footer so staleness is visible, not hidden.

### D2 — Status is a FOUR-value model, and `ready` is the case that matters

`server.js:5969` whitelists **`draft | in_progress | ready | submitted`**, and the
client **auto-advances** it (`reports.html:3742`): ≥1 section saved → `in_progress`,
all 4 done → **`ready`**. (The schema comment at `reports-db.js:73` still says
"draft | submitted" — it is stale; do not trust it.)

So the most common real-world skip is a coordinator who **filled in everything and
never clicked Submit**. Telling them "not submitted" is technically true and
actively unhelpful.

**Five non-send outcomes, each distinguishable.** The reason *strings* are the
implementer's to write — what is pinned is that these five are told apart, and that
`ready` is never reported merely as "not submitted". Skip reasons are
**operator-facing** (CLI log + admin card, read by the SDM — the coordinator gets no
email at all), so they follow `sendCoordinator.js:98`'s existing **English**
vocabulary. The *email* is French; the log is not.

| Condition | Outcome |
|---|---|
| `submitted` | **send** |
| `ready` | skip — complete but not submitted ← **the nudge that matters** |
| `in_progress` / `draft` | skip — not finished |
| no row for the week | skip — no report for that week |
| site code unresolvable in the `meetings` namespace | skip — no meetings module code |
| site inactive (`sites.active=0`) | skip — site inactive |

> **Do not report "N of 4 sections".** That count comes from **DOM classes in the
> browser** (`reports.html:3745`, `querySelectorAll('.stab.done').length`) and is
> **never persisted** — no `sections_done` column, and `getReport` cannot recover it.
> Any server-side re-derivation would drift from what the coordinator saw.
>
> Corollary that **strengthens** this decision: because `.done` is session-local, a
> coordinator who fills the report across several sittings may never reach `ready` at
> all and sits at `in_progress` while materially complete. So `in_progress` is **also**
> a false-negative state — both deserve the nudge, not just `ready`.

`getWeekSummaryData` gates on **both** `status='submitted'` **and `s.active=1`**
(`:4688`) — this spec copies both, explicitly, rather than half the precedent.

### D3 — Resolution chain: site_code → report (the gap rev 1 omitted)

There is **no existing bridge** — `sendCoordinator` never touches these tables. The
chain must be built, and every hop awaited (all are async under postgres):

```
directory row .site_code ('MGO')            reportDirectory.js:21 (free text, unvalidated)
  → getSiteIdByModuleCode('meetings', code) reports-db.js:1608 → {site_id,…} | null
  → listReports(site_id, year, week)        reports-db.js:2064
  → rows[0].id
  → getReport(id)                           reports-db.js:2034
```

The `meetings` namespace is the one the reporting suite uses throughout
(`siteReportDeps.js:10`, `sendCoordinator.js:96`).

> **🔴 The severe trap.** `getSiteIdByModuleCode` returns **`{site_id}`**, NOT `{id}`.
> `listReports` filters with `if (site_id)` (`:2072`) — **a falsy site_id drops the
> filter entirely and returns EVERY site's report for that week.** A mis-destructure
> therefore mails one site's data to another site's coordinator, with no error.
> **Mandatory test:** `listReports(undefined, y, w)` must never be reachable from the
> sender; assert the resolver throws/skips on an unresolved code rather than passing
> `undefined` through.

**Exploration and Tanda have no `meetings` code at all** (`:555-567`) — they can
author weekly reports and can never be resolved. That is a real, permanent skip
reason, not an error.

### D4 — Assets block: after the authored report, score + rank, no delta

**Placement.** The email is *"Rapport hebdomadaire"* and its subject is the
coordinator's own week. Leading with a CMDB nag puts a chore above their work. The
authored report comes **first**; the assets worklist sits immediately after it.
(The ask was a *reminder* "as well", not a headline.)

**No delta.** `getEffortLeaderboard`'s `delta` is a **~30-day lookback**. Sampled
weekly it moves ~a quarter of its range per send, so three emails in four show a
figure that barely budges — the same "permanent dashes" failure this codebase already
documented for the 90-day changes window. **Show `effort_score` + `rank`** — rank
*does* move weekly and rank is the peer-pressure signal.

**Only non-zero worklists are listed.** A column of zeros trains people to skip the
block. All-zero (or no matching label) → the block is **omitted entirely**.

> **The fold — one `getHygieneSummary({site: label})` call PER LABEL, summing
> `by_kind`.** The tempting shortcut is one unfiltered call folded over `by_site`.
> **It does not work:** `by_site` carries only four columns
> (`cost/age/owner/scan_present`, `assets-db.js:263-267`) and they are **PRESENT-counts,
> i.e. inverted gaps**. It has no `discovered`, no `ghost`, no `no_asset_tag`, no
> `lifecycle_exception` — so a `by_site` fold silently ships a worklist **missing half
> its kinds**. `by_kind` (`:302-306`) is per-kind and honours the filters, so
> `getHygieneSummary({site: label}).by_kind` **is** that label's per-kind counts.
> Two calls for SGO; ~13 per fleet-wide run, each 8 `COUNT(*)`. Fine for a weekly job.
>
> `ALIAS` has **no reverse index**; invert it. Note `foldEffortByCode` (`:32`)
> **silently drops** unaliased labels and returns an **unweighted mean** (`:43`) —
> correct for scores, **wrong if copied for counts**. Counts must be **summed**.
> Test **both** folds: `massawa`+`sabodala`→SGO **and** `ouagadougou`+`ouaga`→OUA.

### D5 — Extract email primitives; the monthly HTML must be byte-identical

`coordinator.js` exports only `{composeCoordinator, escapeHtml}` (`:514`); the
helpers the weekly needs are module-private. Extract to
`services/reportTemplates/_primitives.js`.

> **`tests/report-template-coordinator.test.js` CANNOT catch a regression here.**
> Every assertion is substring/length, and the strongest strips all markup first
> (`:305-314`, `html.replace(/<[^>]+>/g,'')`). Changed whitespace, attribute order,
> a dropped inline style or `font-family` — none are catchable. **The byte-equality
> assertion added by this work is the ONLY protection.** Capture the monthly HTML for
> a fixture *before* the extraction and assert equality after.

Three extraction hazards:
- **`chip` is shadowed** — a *second, different* `chip` lives inside `ragLegend`
  (`:431`) with different geometry and **no escaping** (`${l}` raw vs
  `escapeHtml(text)` at `:110`). Deleting the local one silently changes the legend
  and every test still passes. **Leave `ragLegend`'s local `chip` in place.**
- **`obj` / `arr` / `num` (`:60-62`) must move too** — `kpiGrid`/`bulletList` need
  `arr`, `header` needs `obj`.
- **"the palette" is not one thing** — `RAG_COLORS` (`:22`) and `SCORE_RAG` (`:29`)
  use *deliberately different reds* (`#DC2626` vs `#c2280f`); merging them breaks the
  test at `:108`. `scoreRagColor` (`:30`) forward-references `MUTED` (`:44`) —
  extraction order matters.

> **Load-bearing** (`coordinator.js:8-11`): the layout is **table-based on purpose** —
> Outlook's Word renderer drops flexbox, grid, and CSS custom properties. The weekly
> composer follows the same discipline. Modernising it renders broken for exactly the
> coordinators being mailed.

### D6 — New type: `weekly_report`, week-shaped period, its OWN route

`report_type = 'weekly_report'`, `period = '<year>-W<ww>'` zero-padded (`2026-W30`),
so dedup is per week per site and cannot collide with the monthly's `'YYYY-MM'`.

Year+week come from **`getISOWeek(date)`** (Zoho week + year-rollback). Default
period = the **previous** week (`getPreviousWeek()`, `:947`), the week being reported
on.

> `getWeekRange` has **no bound check** — `getWeekRange(2026,53)` silently returns
> January-2027 dates still labelled `"W53 2026"`. And `getPreviousWeek()` **can
> legitimately return week 53** via the rollback branch (`:917`). Behaviour: take the pair from the
> **exported** `getPreviousWeek()` (`:948`, returns `{year, week}`) — `getISOWeek`
> itself is **module-private and NOT exported**. A W53 with no `weeks` row simply
> yields no report and resolves into the ordinary "no report for that week" skip.
>
> **Amendment (plan review):** an earlier draft gave "unknown week" its own reason.
> Distinguishing it from "no report" requires a NEW dual-backend `weeks` reader —
> there is none exported — and **both conditions produce the identical operator
> action: nothing to send.** A reader built to serve a distinction nobody acts on is
> cost without benefit. Collapsed into "no report for that week".

> `alreadySentToday` filters `result IN ('ok','resent')`. Write that exact
> vocabulary — `'ok'` normal, `'resent'` under `force`, `'fail'` excluded so it stays
> retryable. A new string silently disables dedup.

**🔴 `POST /api/reports/send` hardcodes `sendCoordinatorReport` at `server.js:4944`
regardless of `type`.** Merely adding `'weekly_report'` to `SEND_TYPES` (`:4911`)
would compose a **monthly** report, mail it, and log it under
`report_type='weekly_report'` — poisoning the dedup lane with a wrong-content
success. **The weekly gets its own route**, mirroring `POST /api/reports/scoreboard/send`
(`server.js:2400`).

**Adding a report type touches TEN surfaces** (four independent lists that already
drift because none imports from another):

| # | Surface | file:line | If missed |
|---|---|---|---|
| 1 | `TYPES` | `reportSchedule.js:14` | `setSchedule` throws |
| 2 | `cliFor` + CLI const | `reportSchedule.js:10,19` | schedule runs wrong script |
| 3 | own send route | `server.js` (new) | — (deliberately **not** `SEND_TYPES`) |
| 4 | `SUPPORTED_TYPES` | `send-reports.js:14` | CLI exits silently |
| 5 | `_AR_TYPES` | `reports.html:5620` | schedule row never renders |
| 6 | `_ADMIN_PANEL_IDS` | `reports.html:4773` | panel falls back to Users |
| 7 | hash allowlist | `reports.html:4843` | deep link breaks on reload |
| 8 | rail role gate | `reports.html:4776,4826` | wrong role sees it |
| 9 | `saveScheduleRow` branch | `reports.html:5925` | wrong card refreshes |
| 10 | `reportConfig.DEFAULTS` | `reportConfig.js:5` | **admin's save silently dropped** (`:66`) |

### D7 — Attach the PPTX; send anyway if it fails

`generateWeeklyPptx(report, prevReport, openChanges, activeIncidents, meetingsSummary)`
is **`async` → `Promise<Buffer>`** (`reports-weekly-pptx.js:732`). Args are fully
reusable outside a route — no `req`, no `getRawCache()`. `prevReport` is **not** a
real report: it is `{infra_kpis: getPreviousWeekInfraKpis(site_id, report_id)}`
(`server.js:6049`). `_meetingsSummaryForSite` (`:6033`) is unexported but is six
inlinable lines over public `meetings-db` APIs.

**Ordering:** the PPTX is built **before** `composeWeekly(data)`, and the outcome is
passed in as `data.pptxFailed` so the footer can say so. A deck failure must never
suppress the report. A **per-site timeout** guards the build — **60 s**, well inside the 120 s cap the
existing send route already uses (`server.js:4848`).

### D8 — Kill the dead `kind` path

Ticking **Coordinator / Weekly** today creates `SDP-Report-coordinator-weekly`, which
runs `send-reports.js` with `cadence='weekly'` → passed as `kind` (`:100`) →
**ignored** by `siteReport.js:33`. It mails the **monthly** report every week, with
`period='YYYY-MM'` so no per-week dedup lane exists.

Fix: drop `kind` from `sendCoordinatorReport` and `send-reports.js`, and make the
**Coordinator** row monthly-only in the schedule UI. `weekly_report` carries the
Weekly row instead.

**Invariant:** Coordinator/Weekly must be unreachable, and must stay unreachable.
`_AR_TYPES` drives a *generic* schedule table, so a per-type capability flag
(`{weekly:false}`) is the preferred shape — it stops the next person re-adding the
checkbox. Not mandated: any change that holds the invariant durably is acceptable.

## Shape

```
services/reportTemplates/_primitives.js   extracted helpers (monthly + weekly)
services/reportTemplates/weekly.js        composeWeekly(data) → {subject, htmlBody, fullHtml}
services/weeklyReportData.js              resolution chain + assets fold   [SUGGESTED]
services/sendWeeklyReport.js              sender (sendCoordinator's DI shape) [SUGGESTED]
tools/reports/send-weekly.js              CLI (gate-first, require.main guard, --preview)
```

`sendCoordinator.js` changes only to delete `kind`. The senders share
`reportDirectory` / `reportSentLog` / `mailer` but not each other.

Only two files are **required** to be discrete: `_primitives.js` (D5's byte-equality
contract depends on the extraction being its own step) and `send-weekly.js` (its CLI
shape is constrained by `reportSchedule.js:72`'s `--type=`/`--cadence=` args). The
middle two are a suggested split; the resolution chain may live inside the sender.

**Subject — the window MUST appear in it**, because "weekly" without dates is the
exact ambiguity that produced the inert toggle. Illustrative only (exact glyphs and
date formatting are the implementer's; no French date formatter exists yet):
`[MGO] Rapport hebdomadaire - W30 2026 (19-25 juil.)`

## Non-goals

No change to the monthly report's content (and its HTML must be **byte-identical**).
No weekly PDF. No live re-query (D1). No change to how weekly reports are authored.

## Risks

| Risk | Mitigation |
|---|---|
| **Cross-site data leak** via falsy `site_id` | Resolver never passes `undefined`; explicit test |
| Primitive extraction changes monthly output | Byte-equality fixture (the existing test cannot catch it) |
| Outlook renders composer broken | Table-based layout only |
| Assets fold missed → half a fleet reported | Sum (not mean) across labels; test **both** folds |
| `ready` reports silently never mailed | Distinct reason surfaced in CLI log + admin UI |
| Armed-on by default | **Armed OFF** (`weekly_report_send_enabled='0'`), **must** be in `reportConfig.DEFAULTS` |
| Unconfirmed address mailed | Shared `resolveFromRows` + `neverSendUnconfirmed`; asserted |

## Done criteria

- A **submitted** weekly report composes to HTML and mails to that site's
  **confirmed** recipients, PPTX attached.
- Each of the **five** non-send conditions is distinguishable and produces its own
  stated reason (`ready` never reported merely as "not submitted").
- Assets block: score + rank + non-zero worklists, both alias folds correct, summed.
- Dedup per (type, site, week); re-send is `force`, logged `'resent'`.
- Monthly email HTML **byte-identical**.
- Dead `kind` gone; Coordinator/Weekly can no longer mail a monthly.
- Armed off; schedulable; manually sendable via its **own** route.
