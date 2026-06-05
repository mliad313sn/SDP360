# Group IT Operations Report — Integration Roadmap

> **Status — 2026-06-03**: Phase 1 (assets drop) committed in `7d8844d`.
> Phases 2–5 are pending — each gets its own focused session per the
> handoff guide at `tools/exec-pptx/refs/INTEGRATION_GUIDE.md`.

## Honest scope assessment

The handoff `ITOPS_REPORT_INTEGRATION_GUIDE.md` describes a 3–5 day
integration across Node, Python, dashboard frontend, and LLM plumbing.
It says explicitly: *"the bundled `build_group_it_report.py` is NOT
production-ready"* (48 hardcoded "April 2026" references, monolithic
script, no payload validation). Doing the whole spec in one session
ships a broken renderer; doing it in phases ships a working button
end-of-phase.

This file is the phased execution plan. Each phase is a self-contained
session with concrete deliverables + acceptance criteria + smoke test.

## Phase ledger

| # | Phase | Hours | Status | Commit |
|---|---|---|---|---|
| 1 | Drop template + brand assets + fixtures + references | 0.5h | ✅ Done | `7d8844d` |
| 2 | Replace render.py with the data-driven 11-slide module structure (§11.1) | 5h | ⏳ Pending | — |
| 3 | Wire the dashboard's Node payload to kpis-may.json shape (§3) | 3–4h | ⏳ Pending | — |
| 4 | Slide-2 carry-forward + slide-2 narrative admin UI (§3.9 + §11.5) | 3h | ⏳ Pending | — |
| 5 | LLM commentary via Anthropic SDK (§9) + theme clustering (§3.5) | 2–3h | ⏳ Pending | — |

Total realistic effort: ~14–16 hours of focused work.

---

## Phase 2 — Replace render.py with the slide-module structure

### Goal

Replace the current `tools/exec-pptx/{render.py,text_edits.py,charts.py,tracker_merge.py}`
with a clean python-pptx pipeline that:

1. Reads `kpis-may.json`-shaped payload from stdin (Node spawn contract).
2. Builds 11 slides from scratch with brand colors per §6 of the guide.
3. Writes PPTX bytes to stdout (Windows binary mode — keep the
   existing `msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)`).

### Concrete tasks

1. Create `tools/exec-pptx/brand.py` — brand tokens, helpers
   (`add_rect`, `add_text`, `add_multi_text`, `header_band`,
   `footer_bar`, `kpi_tile`, `delta_pill`, `find_pic_by_pos`,
   `set_cell_text`). Lift from `refs/build_group_it_report.original.py`
   lines 14-170.
2. Create `tools/exec-pptx/slides/__init__.py` + 11 modules:
   - `slide1.py` — Cover. Title + month label only.
   - `slide2.py` — Carry-forward from prev deck via `slide_2_patcher.original.py`
     pattern. Defer the operator UI part to Phase 4.
   - `slide3.py` — Executive Overview KPI tiles per §8 spec.
   - `slide4.py` — 12-month trend (volume bars + SLA line + 2 tiles).
   - `slide5.py` — Distribution + channel.
   - `slide6.py` — SLA + ageing.
   - `slide7.py` — CSAT + Voice (donut + pain/praise columns).
   - `slide8.py` — Change Management.
   - `slide9.py` — Major Incidents.
   - `slide10.py` — IT Ops Strategy Roadmap.
   - `slide11.py` — Executive Commentary + Site Summaries.
3. Create `tools/exec-pptx/charts/__init__.py` + 9 chart modules:
   - `s4_volume.py`, `s4_sla.py`
   - `s5_category.py`, `s5_channel.py`
   - `s6_ageing.py`
   - `s7_donut.py`
   - `s8_changes.py`
   - `s10_siteperf.py`, `s10_ragpillar.py`

   Each chart module exposes `render(data, out_path)` returning a PNG.
   Match figsize × dpi spec exactly to picture-frame aspect (§10.2).
4. Create `tools/exec-pptx/render.py` — orchestrator:
   ```python
   import json, sys, os
   if sys.platform == 'win32':
       import msvcrt
       msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
   payload = json.loads(sys.stdin.read())
   from slides import s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11
   from pptx import Presentation
   prs = Presentation()
   prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)
   s1.build(prs, payload); s2.build(prs, payload, prev_deck_path);
   for slide_mod in [s3, s4, s5, s6, s7, s8, s9, s10, s11]:
       slide_mod.build(prs, payload)
   prs.save(sys.stdout.buffer)
   ```
5. Delete `text_edits.py` + `charts.py` (old monolithic) + `tracker_merge.py`.
6. Add unit tests in `tools/exec-pptx/test/` — one per slide module.
   Use `fixtures/kpis-may.json` as the canonical payload.

### Smoke-test acceptance

```cmd
py -3 tools/exec-pptx/render.py < tools/exec-pptx/fixtures/kpis-may.json > /tmp/may.pptx
```

- Exit code 0
- Output ≥ 200 KB
- PowerPoint opens cleanly
- 11 slides
- Each slide passes the §15 visual checks (cover label = "May 2026",
  slide 3 tile values match payload, slide 9 has 3-5 incident boxes,
  etc.)

### Risks

- **Aspect-ratio bug.** Chart picture frames must match matplotlib
  `figsize` exactly. Mismatched aspects cause pixel-stretch in
  LibreOffice PDF exports. See guide §10.2.
- **Multi-paragraph text frames.** Use python-pptx native
  `tf.add_paragraph()` not raw lxml SubElement; LibreOffice fails to
  render the latter. See §10.3.
- **Variable-count incident layout** (§10.6) — box height changes
  based on N. Test with 3, 4, 5 incidents.

---

## Phase 3 — Map server payload to kpis-may.json shape

### Goal

The dashboard's existing `executive-report.html` button assembles a
SMALLER payload than `kpis-may.json` requires. Phase 3 expands the
Node-side payload builder so the renderer gets everything it needs.

### kpis-may.json fields we currently DON'T send

Compare `tools/exec-pptx/fixtures/kpis-may.json` against the body
posted to `/api/reports/exec-pptx` by `exportExecPptxV2()` in
`public/executive-report.html`. Currently missing:

- `category_apr` / `category_may` (prev + current month side-by-side)
- `channel_trend_pct_email[]` / `channel_trend_pct_web_form[]` (13 months)
- `ageing.by_group{}` shape (per-group nested 0-30/31-60/>60d counts)
- `ageing.top_pain_reasons[]` (operator-edited)
- `csat.voice_themes.pain[]` + `voice_themes.praise[]` (per-month clusters)
- `major_incidents.records[]` with rich detail/action/lessons
- `activity_tracker` block per §3.8 — needs `apr_site_scores` for the slide-10 Apr-vs-May comparison
- `commentary` — per-slide LLM strings (or operator overrides)

### Concrete tasks

1. Create `server/services/reportPayload.js` — orchestrator. Body:
   ```js
   exports.build = async function({ month, group }) {
     const [hd, trend, dist, age, mi, ch, voc, trk] = await Promise.all([
       helpdesk.kpis({ month, group }),
       helpdesk.trend({ endMonth: month, months: 12, group }),
       helpdesk.distribution({ month, group }),
       helpdesk.ageing({ asOf: 'now', group }),
       majorIncidents.list({ month, scope: group }),
       changes.list({ month }),
       survey.csat({ month, surveyId: '1140928000001649017' }),
       activityTracker.snapshot({ month }),
     ]);
     return { month, monthName, year, kpis: hd, trend, distribution: dist,
              ageing: age, major_incidents: mi, changes: ch, csat: voc,
              activity_tracker: trk };
   };
   ```
2. Add the missing internal helpers (most already exist in
   `reports-db.js` / `tracker-db.js` — just need to expose them
   through a thin service layer):
   - `helpdesk.distribution()` — wraps `reports-db.getMonthlyData()`
   - `helpdesk.ageing()` — exists as `getRequestsByAgeing()` or similar
   - `survey.csat()` — wraps `/api/survey/voice` which is already DB-backed
   - `activityTracker.snapshot()` — wraps `tracker-db.loadTracker()`
3. Plug into `server.js:/api/reports/exec-pptx` route — replace the
   client-built payload with a server-built one.
4. Add `tools/exec-pptx/test/payload-shape.test.js` — validates the
   built payload matches the `kpis-may.json` JSON Schema.

### Smoke-test acceptance

- POSTing to `/api/reports/exec-pptx?month=2026-05` returns a PPTX
  whose tile values match the dashboard's own May 2026 KPI tiles
  (cross-verify against `executive.html` for the same month).

---

## Phase 4 — Slide 2 carry-forward + admin UI

### Goal

Slide 2 (Mohamed's Operations Summary) carries hand-edited narrative.
The renderer must:
- Read the previous month's deck as input.
- Copy slide 2 XML verbatim into the new deck.
- Flip ONLY the "Reporting Month" cell.

Then add an admin UI in the dashboard where Mohamed pre-populates
the narrative + RAG dots before generation.

### Concrete tasks

1. Implement `slides/slide2.py:carry_forward(prs, prev_deck_path, current_month_name)`
   from `refs/slide_2_patcher.original.py` (the patcher is already
   production-ready — wholesale lift with minor adapter changes).
2. Add `tools/exec-pptx/find_previous_deck.py` — looks under
   `/var/itops-reports/` for the most recent `*_<PrevMonth>_<Year>.pptx`.
   Fall back to `tools/exec-pptx/refs/golden_apr.pptx` if no prior
   month exists yet.
3. Operator UI — defer to Phase 4b:
   - New tab on `executive-report.html` → "Slide 2 narrative".
   - 3 text areas (Progress / Issues+Risks / Activities-for-next-period).
   - 1 KPI table editor (4 rows × Deliverable / RAG dot / Comments).
   - 1 Project Health pill editor.
   - POST `/api/reports/slide2-narrative?month=2026-05` persists.
   - GET returns the latest saved narrative.
4. Smoke-test: regenerate the deck after editing the narrative → the
   generated PPTX reflects the operator's edits on slide 2 verbatim.

### Risks

- **Lock contention.** When Mohamed has the deck open in PowerPoint,
  writes to the destination path fail silently. Use the
  `*_v<N+1>.pptx` rename pattern from §10.8.

---

## Phase 5 — LLM commentary + Voice theme clustering

### Goal

Per §9 of the integration guide. Each slide's commentary footer is
LLM-generated from the payload with the C-suite voice rules. Theme
clustering on the CSAT verbatim feeds slide 7's Pain/Praise columns.

### Concrete tasks

1. Create `server/services/commentaryService.js` — wraps Anthropic SDK.
   Body taken directly from the integration guide §9.
2. Cache LLM output by `(month, slide, payload_hash)` in a tiny
   SQLite table so re-runs don't re-spend tokens. Surface a
   "Regenerate" button in the operator UI.
3. Theme clustering — same SDK, `claude-haiku-4-5-20251001` model,
   strict JSON output. Cache by `(month, class:'pain'|'praise')`.
4. Add an admin override: operator can hand-edit each per-slide
   commentary before generation. Persist via
   `POST /api/reports/commentary?month=2026-05`.

### Smoke-test acceptance

- Generated deck has LLM-written footers on slides 3, 4, 5, 6, 7, 8,
  9 + the 4-bullet General Review on slide 11.
- Re-generating the deck for the same month with no operator changes
  hits the cache (zero token spend).
- Editing a footer in the operator UI then re-generating shows the
  edited text in the deck.

---

## File-by-file plan

When you reach a given phase, these are the files to touch (≈line
budgets are rough):

| Path | Phase | Action | ~LOC |
|---|---|---|---|
| `tools/exec-pptx/brand.py` | 2 | Create | 200 |
| `tools/exec-pptx/slides/__init__.py` | 2 | Create | 20 |
| `tools/exec-pptx/slides/s{1..11}.py` | 2 | Create × 11 | 60–100 each |
| `tools/exec-pptx/charts/__init__.py` | 2 | Create | 10 |
| `tools/exec-pptx/charts/s{4,5,6,7,8,10}_*.py` | 2 | Create × 9 | 40–80 each |
| `tools/exec-pptx/render.py` | 2 | Rewrite | 60 |
| `tools/exec-pptx/text_edits.py` | 2 | DELETE | — |
| `tools/exec-pptx/charts.py` | 2 | DELETE | — |
| `tools/exec-pptx/tracker_merge.py` | 2 | DELETE | — |
| `server/services/reportPayload.js` | 3 | Create | 120 |
| `server/services/helpdeskService.js` | 3 | Create thin wrapper | 80 |
| `server/services/surveyService.js` | 3 | Create thin wrapper | 60 |
| `server/services/activityTrackerService.js` | 3 | Create thin wrapper | 50 |
| `server.js` | 3 | Update `/api/reports/exec-pptx` route | -50 / +60 |
| `tools/exec-pptx/slides/s2.py` | 4 | Add carry-forward | 90 |
| `public/exec-report-slide2-admin.html` | 4b | Create operator UI | 200 |
| `server.js` | 4b | Add 2 routes | 80 |
| `server/services/commentaryService.js` | 5 | Create LLM wrapper | 100 |

Total: ~30 new files, ~3500 LOC. Plus tests.

---

## Acceptance criteria (overall)

The integration is "done" when:

1. `POST /api/reports/exec-pptx?month=2026-05` returns a PPTX that
   passes all 12 test cases in §15 of the integration guide.
2. The deck is byte-identical between two runs for the same month
   (modulo embedded timestamp metadata).
3. Generation finishes < 30s on a single core; < 10s with chart
   cache.
4. Slide 2 always carries forward from the most recent prior month +
   honors the operator's edits.
5. LLM token spend < $0.50/month/deck after the first generation
   (cache hits dominate).
6. The dashboard's existing `📊 Executive New Report` button is
   unchanged (the existing Node + pptxgenjs path stays in place as
   a fast alternative).

---

## How to resume in a future session

For a Claude session picking up Phase 2:

> *"Continue the Group IT Operations Report integration. The handoff
> from the spec session is in `tools/exec-pptx/refs/INTEGRATION_GUIDE.md`.
> Phase 1 (asset drop) was committed in 7d8844d. Phase 2 is to
> replace the existing `tools/exec-pptx/render.py` + sidecars with
> the slide-module structure per §11.1 of the guide. Start with
> `brand.py` then `slides/s1.py` and `slides/s3.py`. Smoke test
> against `tools/exec-pptx/fixtures/kpis-may.json`. See
> `tools/exec-pptx/INTEGRATION_ROADMAP.md` for the file-by-file
> plan and acceptance criteria."*

Paste that paragraph + the roadmap file into a fresh session and the
next Claude picks up exactly where this one left off.

---

*End of roadmap.*
