# ADR W2-UI — interactive, virtualised Gantt v2 (vanilla, pure core + thin DOM layer)

- **Status:** accepted for the sandbox (engineering choice, reversible); the switch `ppm_gantt_v2_enabled` stays `0`.
  Turning it on is a PMO decision (PROPOSED in `docs/ops/pilot/PILOT-PROFILE.md`).
- **Context:** W0 UX matrix rows C1, C4, C7c, C7e and I1: the project page draws one string-built SVG re-rendered with
  `innerHTML`, no windowing, no drag, no undo, editing through a separate form. W2 asks for an interactive canvas/SVG
  Gantt (zoom, drag, resize, link, undo, grid editing), companion views and 1,000 / 5,000-task performance, without a new
  framework or CDN and without a new right.

## Decision
1. **Two files.** `public/lib/ganttCore.js` (UMD, pure, unit-tested in Node) holds every rule: working-day calendar
   (default Mon–Fri, holidays honoured — same default as `services/ppm/scheduleEngine.makeCalendar`), zoom scales,
   layout (O(n)), virtual window, link paths, drag → dates, link-creation rules, inline-edit validation, undo/redo stack,
   companion-view aggregations. `public/lib/ganttV2.js` only draws and listens.
2. **SVG with a row window**, not canvas: one SVG sized to the full plan but holding only the visible rows (+ overscan);
   the grid mirrors the same window; one scroll position drives both. SVG keeps native focus, `role=img` labels and
   `<title>` tooltips (canvas would need a parallel accessibility tree). Measured: layout pipeline ≈ 8 ms for 1,000 tasks,
   ≈ 28 ms for 5,000; the mounted module draws ~40 bars for a 5,000-task plan.
3. **Writes reuse the existing route and guard only**: `PUT /api/governance/portfolio/task` (partial body + the row
   `version` → I-CONC-1 409 `STALE_VERSION`), same `refusePlanWrite`. The client re-checks link rules with the server's own
   refusal codes so a refused gesture sends nothing; the server stays the authority. A replay (undo/redo) that fails is
   dropped and the page reloads the truth.
4. **Consume only fields at base 222ab4b** (`es_date/ef_date`, `critical`, `computed`, `summary`, `milestone`,
   `depends_on`, `dependency_links`, `baseline_start/end`, `version`). Typed links (SS/FF/SF + lag) are drawn when
   present; drawing one is offered only while `ppm_schedule_engine_v2_ui` is on (otherwise FS only). New engine fields
   (calendars, resources, levelling, MSPDI — lot w2-engine) are ignored until wired; `ctx.calendar` is the hook.
5. **null = unknown**: task usage with no effort shows "?" and is counted, never summed; resource graph without a known
   allocation shows "?" not 0 %.

## Consequences
- Off by default: `project.html` keeps today's SVG Gantt; the module is loaded but inert.
- Undo history is per project and per browser tab (in memory), not persisted.
- Network diagram is capped at 400 nodes (list/Gantt for the rest); it is read-only.
- Not done here (left to later waves): multi-baseline overlay (C7b), progress drag, multi-select/copy-paste, print.
