# Reference sources — DO NOT EDIT, DO NOT WIRE INTO THE APP

These are extracted, read-only copies of the **authoritative** IT Review Dashboard
that the reporting suite's scoring model is ported FROM. They exist so the port can
be diffed against its source instead of trusted from memory.

| File | What |
|---|---|
| `it-review-dashboard.source.js` | The app logic, unescaped from the artifact's `<script type="text/x-dc">` block. `class Component extends DCLogic`, 24 methods, 499 lines. **This is the source of truth for the scoring.** |
| `it-review-dashboard.template.html` | The `{{ }}` template (dc-runtime binding syntax), 219 unique bindings. Reference for what each panel renders. |

Original artifact: `IT Review Dashboard.html` (a Claude Artifact export). Its dataset
(`window.EM_DATA`) is committed separately as `tests/fixtures/em-data.json` and pins
`tests/score-fidelity.test.js`.

## Rules

- **Never require() or bundle these.** They depend on `dc-runtime` (an internal,
  generated runtime) and load React/ReactDOM/Babel from unpkg.com at runtime. The
  port re-implements the logic in plain Node/JS; the template is re-written as plain
  HTML/JS. Nothing here ships.
- **Never "fix" them.** If our port disagrees with this source, OUR code is wrong —
  the team reads the numbers this file produces. `tests/score-fidelity.test.js` pins
  our port to it against the real dataset.
- The two scoring models here are BOTH authoritative and BOTH genuinely disagree
  (3 of 5 sites land on a different RAG; the rankings are nearly inverted):
  - `composite()` → Site Health Leaderboard + Weekly Brief. RAG 75/55.
  - `sbDims()` → League table / Effort matrix / Gap to green / Two moves. RAG 70/45.
  That is the source's design, not a defect to reconcile here.
- Known deviation in our port, deliberate + user-directed: `W0`/`ANCHOR` are
  hardcoded here (`2026-04-01` / `2026-07-14`); we use a **3-month rolling window**
  ending at the report's as-of date, so the score stays meaningful as time passes.
  The source's own move text ("the quarterly green of 3") shows the thresholds were
  calibrated for a ~3-month window.
