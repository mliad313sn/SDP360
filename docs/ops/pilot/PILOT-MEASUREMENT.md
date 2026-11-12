# Pilot measurement — who records what, when (B-02)

Status: **kit only. No pilot session has been run and no measure has been taken.** Nothing in this
repository records a pilot result. A measure that was not taken stays **not measured** — never 0, never
"passed". Results are written to `docs/agent-execution/G24.md` only as measured.

Source: external audit §11 "Mesurer la valeur métier sans inventer de résultats", P0-05, P2-21, P2-22; G24 §5.

## 1. Two kinds of evidence

| Kind | Produced by | Files |
|---|---|---|
| **Derived from data already in SDP360** (read-only) | `node tools/pilot/pilot-metrics.js` | Markdown / CSV report |
| **Observed by a person** | facilitator / adoption lead | `T1-T8-SHEET.csv`, `SUS-FORM.md`, `WEEKLY-REPORT-STOPWATCH.csv` |

## 2. The derived report

```
node tools/pilot/pilot-metrics.js --from=YYYY-MM-DD --to=YYYY-MM-DD [--site=<site name or module code>] [--format=md|csv|both] [--out=DIR]
```

- Reads `PG_URL` from `.env`. The database session is switched to **READ ONLY** before the first query:
  PostgreSQL itself refuses any write. Nothing is changed.
- Per **site × persona (the account's role) × ISO week**: active users on business events; weekly report
  created → submitted median (**proxy, not effort**); PV submitted → action created median; action created →
  closed median (meetings, inspections, report follow-ups); field entries applied / refused / failed /
  pending; field task time (form open → queued, median / p75 per site × kind × week — only recorded while
  `field_task_timing` = 1, E-F03; no target until a baseline exists); share of metric-registry entries whose
  source is UNKNOWN or stale.
- Every measure prints its definition and its source tables above its table. A measure without data prints
  **"no data"**.
- **No user name, full name or e-mail** is selected or printed. Per-user activity lines appear only when
  `PILOT_PSEUDONYM_KEY` (16+ characters) is set in `.env`; they carry an HMAC pseudonym (`u_…`). Keep the key
  out of the report and out of git: whoever holds it can re-link a pseudonym to an account. Rotating it
  breaks week-to-week comparison of the per-user lines — choose it once for the whole pilot.

Known limits (written in the definitions too):
- "Conflicted" field entries are **not recorded** by the server (a same-uuid, different-payload send is
  answered 409 and never stored) → the column says "not recorded".
- Report follow-ups have no creation time: creation = the first report holding the action's lineage.
- The UNKNOWN/stale share uses source freshness (sync runs). A metric whose reader returns null for a given
  site needs the application runtime and is not counted.
- Site labels follow each source: weekly reports and users carry the site **name**, meetings and
  inspections the module **code**. `--site` accepts either and matches both.

## 3. Who records what, when

| When | Who | What | Where |
|---|---|---|---|
| Before the pilot (baseline week) | adoption lead | 2–3 weekly reports written the old way, stopwatch running | `WEEKLY-REPORT-STOPWATCH.csv`, phase `baseline` |
| Before the pilot | IT ops | run the derived report on the 4 weeks before go-live | `--out=docs/ops/pilot/runs/` (not committed if it holds site data) |
| Each pilot week, Monday | adoption lead | derived report for the previous week, per pilot site | same |
| Each pilot week | site IT coordinator + observer | weekly report written in SDP360 with the stopwatch | `WEEKLY-REPORT-STOPWATCH.csv`, phase `pilot` |
| Once per participant (week 2–3) | facilitator not involved in building the screens | T1–T8 session, then SUS | `T1-T8-SHEET.csv`, `SUS-FORM.md` |
| Phone tasks (T3) | facilitator | network type and signal bars on every line | `T1-T8-SHEET.csv` |
| End of pilot | PO + sponsor | read the measures; set targets only now, against the baseline | decision record, not this kit |

## 4. Rules

- Participants are coded `P01…`. No name on any sheet. Role + site only.
- A cell not measured stays empty. Never write 0 for "not measured".
- No target number is set before a baseline exists and a sponsor decides it.
- Do not claim a result, an approval or a field acceptance that a person has not recorded.
- Run reports containing real site data are operational records: keep them on the server or the team share,
  not in git.

## 5. Filling the sheets

- `T1-T8-SHEET.csv` — one line per participant × task. `completion` = `yes` | `with_help` | `no` | `not_run`.
  `time_seconds`, `errors`, `clicks_or_keystrokes` stay empty when not measured.
- `SUS-SHEET.csv` — one line per SUS questionnaire (`SUS-FORM.md`): the participant code and the ten answers `q1`…`q10`
  (1–5) as ticked. Leave a cell empty when the participant did not answer: the questionnaire is then incomplete and
  gets no score.
- `WEEKLY-REPORT-STOPWATCH.csv` — one line per weekly report written under observation. `phase` = `baseline`
  (the old way) | `pilot`. `active_minutes` = stopwatch time actually spent writing (pause it during
  interruptions). **This is the effort measure**; the tool's created → submitted median is only a proxy.
  `data_re_entered_count` = how many values the writer typed that SDP360 already held (audit §11 duplicate entry).

## 6. Summarising the observed sheets

```
node tools/pilot/pilot-observed.js --sheets=DIR [--format=md|csv|both] [--out=DIR]
```

`DIR` holds the filled copies of `T1-T8-SHEET.csv`, `WEEKLY-REPORT-STOPWATCH.csv` and `SUS-SHEET.csv` (any of them may
be absent: it is then reported "not measured"). Offline: no database, no network. The output gives, per task and per
task × role / site, the number of runs, the completion counts (yes / with help / no / not run / not recorded), the
median and 75th-percentile time and the median errors; the stopwatch comparison for the participants observed in
**both** phases (the others are excluded and counted); and the SUS score per participant with its median (standard
0–100 formula, incomplete questionnaires not scored).

- An empty cell is "not measured": it is never read as 0 and never enters a median.
- A group with fewer than 3 measured lines shows "insufficient sample" instead of a number.
- Anything in `participant_code` that is not a code (`P01`…) is hidden, never printed.
- The tool writes no target, no threshold and no verdict. Whether the pilot scales, adjusts or stops is decided by
  the product owner and the sponsor.
