# Weekly coordinator report — design

**Date:** 2026-07-21
**Status:** spec, awaiting review
**Branch (planned):** `feat/coordinator-weekly`

## Problem

Coordinators receive a **monthly** site report. The team also needs a **weekly
progress** email. The Send dialog briefly exposed a `kind = weekly|monthly`
toggle that was **inert** — `siteReportData(site, {year, month, kind})` never
read `kind` (`services/siteReport.js:33`), and `_asOfFor(period)`
(`siteReportDeps.js:142`) derives the as-of date from year+month alone. The
toggle was removed in `d0c2dee` rather than left lying.

So the weekly report does not exist. This spec designs it.

## The constraint that shapes everything

**A weekly report is not the monthly report over a narrower window.** Three of
the monthly blocks are calibrated for a longer horizon and become meaningless —
or actively misleading — over 7 days:

| Block | Horizon it is calibrated for | Over one week |
|---|---|---|
| Meetings **5 Engagements** | "**3 departments per month**" | 0-or-1 of 3 → **permanently red** |
| **Site score** (`sbDims`) | **rolling 3 months** (`reviews>=8`, `inspections>=3` "quarterly") | does not move week to week |
| `technicians` | month-bound reader (`getSiteTechnicianStats(site_id, year, month)`) | needs a window fork |

Shipping the monthly composer with a week window would mail every coordinator a
permanently-red compliance block every Monday. They would learn to ignore the
whole email — the classic failure this codebase already documents for
one-month scoring ("would read RED forever").

This is the same lesson as the inverted-dimension gate in `siteScore.js`: a
metric evaluated against the wrong horizon produces a **confident verdict on
nothing**.

## Decision (user-selected)

**"Weekly ops + score reminder."** A short digest of what moved this week, plus
the rolling-3-month score carried along and **explicitly labelled as a
quarter-scale figure that moves slowly** — so its stability reads as by-design
rather than as a broken number.

The 5-Engagements compliance block is **excluded** from the weekly. It stays
monthly, where its target is defined.

## Substrate — verified, no new SQL required

Every number the weekly needs comes from a reader that **already exists and is
already window-scoped**. This is the main risk reducer: the weekly is a new
*composer + delivery*, not a new data layer.

| Need | Existing reader | Note |
|---|---|---|
| Week bounds | `reports-db.getWeekRange(year, week)` (`:924`) | **Zoho week convention** (`_zFirstSun`, Sunday-start) — the same definition the weekly PPTX decks use. Returns `{start, end, label:'W30 2026'}`. |
| Helpdesk over the week | `reports-db.getSiteHelpdeskWindow(site_id, from, to)` (`:1729`) | Already used by the IT Review's Helpdesk & Changes panel. |
| Changes over the week | `reports-db.getSiteChangesWindow(site_id, from, to)` (`:1849`) | Already window-native in the monthly binder (`siteReportDeps.js:60`). |
| Issues raised / resolved / overdue in the week | `meetings-db.getSiteScoreInputs(code, from, to)` (`:2629`) | Returns `{reviews, raised, resolution, overdue, signoff}` **over an arbitrary window** — call it with the week instead of the quarter. |
| Inspections + findings in the week | `inspection-db.getSiteScoreInputs(code, from, to)` | Same shape. |
| Major incidents open **now** | `reports-db.getActiveMajorIncidentsForSite(groups)` | Window-independent by nature. |
| Score + trend (quarter-scale) | the existing `scoreInputs` / `prevScore` deps, **unchanged** | Rolling 3 months. Reused verbatim — no fork. |

**Deliberately NOT in the weekly:** the 5-Engagements compliance block, and
`technicians` (month-bound reader; a weekly technician table over ~5 working
days is thin and would need a new fork for little value — deferred).

## Delivery — the rails are already type-aware

No new delivery infrastructure. Everything keys on `report_type`:

- `report_sent_log` — `record(db, {report_type, site_code, period, recipients, result})`,
  dedup via `alreadySentToday(db, type, site, period)`. A new type gets its own
  dedup lane automatically.
- `reportSchedule.TYPES = ['coordinator','group','finance','hygiene','scoreboard']`
  → add `'coordinator_weekly'`; `cliFor()` maps it to the new CLI.
- Recipient resolution + the **confirmed-address gate** (`resolveFromRows`,
  `neverSendUnconfirmed`) is shared and unchanged. **The weekly may never mail
  an unconfirmed address either.**

### Period key

`report_type='coordinator_weekly'`, `period='<year>-W<ww>'` (e.g. `2026-W30`).

Deriving the period from the ISO-ish week string keeps dedup **per week** —
sending twice in one week is caught, and a monthly send for the same site does
not collide because the type differs.

> **Trap:** `alreadySentToday` filters `result IN ('ok','resent')`. The weekly
> writes the same vocabulary (`'ok'` normal, `'resent'` under `force`, `'fail'`
> excluded so it stays retryable). Do not invent a new result string.

## Shape

```
services/siteWeeklyReport.js     PURE composer  → {subject, htmlBody, fullHtml}
services/siteWeeklyData.js       glue: week bounds → the 6 readers above
tools/reports/send-weekly.js     CLI (armed by schedule; --preview; require.main guard)
```

`sendCoordinator.js` is **not** modified beyond what already exists — the weekly
gets its own sender that reuses `reportDirectory` / `reportSentLog` / `mailer`
through the same DI shape, so a bug in one cannot destabilise the other.

### Subject

`[Site] Progrès hebdomadaire — W30 2026 (21–27 juil.)` — the window is stated in
the subject, because "weekly" without dates is exactly the ambiguity that
produced the inert toggle.

### Score presentation (load-bearing)

The score is rendered with its window and an explicit caption:

> **Score programme : 58/100 (Ambre)** — fenêtre glissante de 3 mois
> (14 avr. → 14 juil.). *Cet indicateur évolue au trimestre, pas à la semaine.*

Without that caption a coordinator sees an identical number four weeks running
and concludes the report is stale. **The caption is not decoration — it is the
difference between a trusted and an ignored email.**

## Non-goals

- No weekly 5-Engagements compliance (stays monthly, where the target is defined).
- No weekly technician table (deferred; needs a window fork of a month-bound reader).
- No PDF for v1 — the monthly's `renderPdf` is reusable later if asked, but the
  weekly is designed to be read **in the mail client on a phone**.
- No change to the monthly report's content or behaviour. The two are independent.

## Risks

| Risk | Mitigation |
|---|---|
| A second sender drifts from the first on the confirmed-recipient rule | Both call the SAME `reportDirectory.resolveFromRows`; a test asserts the weekly refuses an unconfirmed address. |
| Week convention divergence (ISO vs Zoho) | Reuse `getWeekRange` verbatim — do NOT compute weeks locally. One definition product-wide. |
| Weekly noise → coordinators tune out | Digest is short, no permanently-red block, and the slow-moving score is captioned as such. |
| Armed-on by default mails everyone unexpectedly | **Armed OFF by default** (`weekly_send_enabled='0'`, mirroring `hygiene`/`scoreboard`). Must be in `reportConfig.DEFAULTS` or `setConfig` silently drops it. |

## Done criteria

- A weekly digest composes for a real site over a real week from existing readers.
- It refuses an unconfirmed address, exactly as the monthly does.
- Dedup is per (type, site, week); a re-send is `force` + logged `'resent'`.
- The score carries its window and the quarter-scale caption.
- Armed off by default; schedulable; manually sendable from the admin card.
- The monthly report is byte-unchanged.
