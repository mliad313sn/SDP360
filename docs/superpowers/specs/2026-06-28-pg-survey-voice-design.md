# Chunk survey/voice — `/api/survey/voice` → PostgreSQL (design + plan, combined)

**Date:** 2026-06-28
**Status:** approved (pending review + user review)
**Branch:** `feat/pg-survey-voice` (off `main`)
**Depends on:** reports.db migration code-complete (4A–4D-2d + 4D-wiring-1/2 + 4B-RR merged). This is
the last reports.db code path still reading the raw sqlite handle — the deferred
`/api/survey/voice` follow-up. Small + isolated.

---

## Goal

Fork the `/api/survey/voice` route's two raw `rdb.db.prepare(...)` reads (server.js ~1874 / ~1895)
to forked reports.db readers so the Voice-of-Customer card works under `REPORTS_BACKEND=postgres`.
The route is wired + live (consumed by `executive-report.html:3928` + `executive.html`), already
`async`. In pg mode `rdb.db` is the empty sqlite handle → the voice cache builds empty.

## Scope

### 2 new forked readers in `reports-db.js` (standard dispatch; pg → `pgHandle()`)

Both are simple SELECTs — **no dialect rewrites** (`skipped` is `INTEGER` so `skipped = 0` works;
`TRIM`/`LENGTH`/`IS NOT NULL` are pg-compatible; no strftime/julianday/datetime).

- **`getSurveyResultsForVoice()`** — the per-response context scan (full table, voice columns):
  ```sql
  SELECT response_id, request_id, request_display_id, overall_score, survey_responded_on, survey_sent_on
  FROM survey_results
  ```
  (Distinct from the paginated 4D-1 `getSurveyResults({limit,offset,since})` — voice needs ALL rows,
  specific columns.)
- **`getSurveyVoiceAnswers()`** — the candidate-answer filtered scan:
  ```sql
  SELECT response_id, answer_text, answer_option
  FROM survey_answers
  WHERE skipped = 0
    AND ( (answer_text IS NOT NULL AND TRIM(answer_text) != '')
       OR (answer_option IS NOT NULL AND LENGTH(answer_option) > 25) )
  ```

### server.js — route awaits

Replace the two `rdb.db.prepare(...).all()` with `await rdb.getSurveyResultsForVoice()` /
`await rdb.getSurveyVoiceAnswers()`. The handler is already `async`; the cache-build JS (resultMap,
comment extraction, `aggregateVoice`, `_voiceCache`) is unchanged. Remove no other logic.

## Out of scope

The `aggregateVoice` / `classifyVocSentiment` / `classifyVocThemes` JS (pure), the `_voiceCache`
mechanism, `/api/survey/voice-cache/clear` (no DB read).

## Testing (TDD)

Extend `tests/pg-reports-aggregates.test.js` (it has `_sres` + `upsertSurveyResultBatch`; add an
`_sans` answer template + uses `upsertSurveyAnswerBatch`). One test:
- Seed 2 survey_results (one with a request linkage) + survey_answers: a free-text answer (skipped=0,
  non-empty `answer_text`), a long `answer_option` (>25 chars, skipped=0), a skipped row, a
  short/blank row.
- Assert `getSurveyResultsForVoice()` returns the 2 result rows with the voice columns
  (response_id/overall_score/…).
- Assert `getSurveyVoiceAnswers()` returns ONLY the 2 candidate rows (free-text + long-option),
  excluding the skipped + short/blank ones.

Plus a sqlite-path smoke (both readers return rows on the default backend; they're async in both
modes — the route awaits them, no synchronous-return requirement, like the other module readers
consumed only by routes... but these ARE reports-db forked fns, so KEEP them synchronous on sqlite
per the migration invariant: first-line dispatch, sqlite body returns the value synchronously).

> NOTE: these are `reports-db.js` forked fns (not a separate module), so follow the **synchronous-return
> invariant**: `if (REPORTS_BACKEND==='postgres') return _fnPg()` first line; sqlite body returns the
> array synchronously (un-awaited callers keep working). The route awaits them (harmless on sqlite).

## Success criteria

- `getSurveyResultsForVoice` + `getSurveyVoiceAnswers` pg test green; sqlite synchronous-return holds.
- `/api/survey/voice` builds its cache via the forked readers (works in pg mode); route-smoke
  (`tests/server-routes-smoke.test.js`) optionally adds `/api/survey/voice` (requireReportSession-only).
- `node --check` clean; full reports.db pg regression green.
- sqlite default-backend unchanged. **After this + KPI reconciliation + the data copy, the
  `REPORTS_BACKEND=postgres` prod flip is fully unblocked.** Nothing deployed; default `sqlite`.
