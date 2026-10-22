# SOP — PPTX decks (canvas, helpdesk slide layout, palette, forked slideMonthly*)

Moved verbatim from `CLAUDE.md` on 2026-10-22 (SDP-DASH-2.0 step 5, lot 5.5). `CLAUDE.md` is now an index; edit THIS file.

---

### `slideMonthly*` duplication — actual state (2026-06-21 audit)

A function-by-function diff of the two files found that **only the small pure
RAG/trend helpers were ever truly identical**; everything else has legitimately
diverged. Result of the 2026-06-21 dedup pass:

**Deduplicated → `reports-pptx-shared.js`** (single source of truth, imported by
both files): `statusColor`, `trendArrow`, `trendColor`, `computeTrends`,
`autoStatusColor`. Unit-tested in `tests/pptx-shared-helpers.test.js`.

**Left forked on purpose** — these differ between the two files and unifying any
of them is a *visual/design decision*, not a mechanical dedup:

| Symbol | How they differ | Why forked |
|---|---|---|
| `addTitle` | weekly fontSize 28 / y 0.15 · monthly 24 / 0.12 | different title sizing per deck |
| `addSectionBadge` | monthly added an `h` param + font 10 (weekly 11) | monthly needs variable-height banners |
| `const C` palette | values differ | each deck tuned independently |
| every `slideMonthly*` renderer | different signatures (`prevReport`, `reportMonth`, `openChanges`) + bodies | feed different generators (see usage table) |

**Which deck each file actually powers** (server.js call sites):

| Generator (exported) | File | Server route |
|---|---|---|
| `generateWeeklyPptx` | weekly | weekly download |
| `generateMonthlyPptx` | weekly | per-site monthly download |
| `generateWeeklySummaryPptx` | weekly | all-sites weekly summary |
| `generateMonthlyPptxV2` | monthly | per-site monthly **v2** |
| `generateAllSitesMonthlyPptx` | monthly | all-sites monthly |

> `generateMonthlyPptxV2` / `generateAllSitesMonthlyPptx` are *also* exported by
> the weekly file but those copies are **dead** — the server always calls the
> `reports-monthly-pptx.js` versions (`rpptxMonthly.*`).

**Safety net — golden fingerprint test.** `tests/pptx-monthly-golden.test.js`
seeds a throwaway DB (`SDP_DATA_DIR`), renders **all 5 live decks**, and compares
a per-slide structural fingerprint (text runs + shape/pic/chart counts) to
`tests/__golden__/pptx-fingerprint.json`. Run it before/after any PPTX edit:
```
node --test --test-force-exit tests/pptx-monthly-golden.test.js
```
After an INTENTIONAL visual change, regenerate the golden:
```
GOLDEN_UPDATE=1 node --test --test-force-exit tests/pptx-monthly-golden.test.js
```

> _2026-06-02 update_: `reports-pptx.js` was a third copy referenced here
> historically; deleted in commit `94c549e`. Duplication is across TWO files only.

The other shared helpers (`kpiTile`, `metricCard`) are defined *inline inside*
their slide functions (closures), so they aren't trivially extractable and stay
per-file. Grep both files before assuming a helper is shared.


## PPTX Canvas — Canonical Dimensions

| Property | Value |
|----------|-------|
| Slide width | 13.33" |
| Slide height | 7.50" |
| Left margin x | 0.30" |
| **Content width** | **12.73"** (= 13.03 − 0.30) |
| Safe bottom y | 7.38" |

**Every table, chart, badge, and panel must use `x=0.3, w=12.73`.**
No slide should use 9.4", 9.0", or any narrower content width.

---

## Helpdesk Slides — Shared KPI Strip Design

Both `slideHelpdeskMetrics1` (weekly) and `slideMonthlyHelpdesk` (monthly) use
the **exact same layout**. Do not change one without changing the other.

### Tile geometry

```js
const tileW = 3.15;   // tile width (4 tiles fit in 12.73" with 0.04" gaps)
const tileG = 0.04;   // gap between tiles
const tileH = 0.40;   // tile height
const tX    = i => 0.3 + i * (tileW + tileG);
// Row y positions:
//   row 0: y = 0.62
//   row 1: y = 1.12   (0.10" gap between rows)
```

### Tile internal layout — absolute y offsets (never use valign top/bottom)

```
y+0.03  h=0.10  LABEL  fontSize 6.5, bold true, color '111111', valign 'middle'
y+0.13  h=0.16  VALUE  fontSize 14,  bold true, color C.blue,   valign 'middle'
y+0.29  h=0.08  DELTA  fontSize 6.5, color varies,              valign 'middle'
```
Left accent bar: `w=0.06, h=tileH` in the tile's accent color.

### `kpiTile` helper (canonical — copy verbatim)

```js
const kpiTile = (col, row, label, value, deltaStr, deltaColor, accent) => {
  const x = tX(col);
  const y = row === 0 ? 0.62 : 1.12;
  slide.addShape('rect', { x, y, w: tileW, h: tileH, fill: { color: 'FFFFFF' }, line: { color: 'DDDDDD', pt: 0.5 } });
  slide.addShape('rect', { x, y, w: 0.06,  h: tileH, fill: { color: accent  }, line: { color: accent,   pt: 0 } });
  slide.addText(label, {
    x: x+0.1, y: y+0.03, w: tileW-0.15, h: 0.10,
    fontSize: 6.5, bold: true, color: '111111', fontFace: 'Calibri', valign: 'middle'
  });
  slide.addText(String(value ?? '—'), {
    x: x+0.1, y: y+0.13, w: tileW-0.15, h: 0.16,
    fontSize: 14, bold: true, color: C.blue, fontFace: 'Calibri', valign: 'middle'
  });
  if (deltaStr) {
    slide.addText(deltaStr, {
      x: x+0.1, y: y+0.29, w: tileW-0.15, h: 0.08,
      fontSize: 6.5, color: deltaColor || C.midGrey, fontFace: 'Calibri', valign: 'middle'
    });
  }
};
```

### Tile assignments

| Col | Row 0 (volume/SLA) | Accent | Row 1 (timing/status) | Accent |
|-----|--------------------|--------|-----------------------|--------|
| 0 | INBOUND TICKETS | `C.blue` '2A5490' | TIME TO ASSIGN (AVG) | `C.blue` |
| 1 | CLOSED TICKETS | `'27AE60'` | AVG FIRST REPLY | `'27AE60'` |
| 2 | RES. SLA OK % | `'E87722'` | AVG RESOLUTION TIME | `'E87722'` |
| 3 | 1ST REPLY SLA % | `'E74C3C'` | ON-HOLD / OPEN TICKETS | `'7C3AED'` |

### Delta string format

```js
// Always show signed change AND previous value with its label:
// "+7  ·  prev: 64 (W12 2026)"   (weekly)
// "+42  ·  prev: 198 (Mar 2026)" (monthly)
const prevRef = v => pLbl ? `prev: ${v} (${pLbl})` : `prev: ${v}`;
// deltaStr = `${inbDelta}  ·  ${prevRef(fmtNum(prevValue))}`
```

Delta color rules:
- Inbound: `C.midGrey` (volume — neutral direction)
- Closed, SLA%: green ≥ 0, red < 0
- Timing (TTA, FR, RT): **green ≤ 0** (lower = faster), red > 0

---

## Full Helpdesk Slide Layout (weekly & monthly)

```
y=0.42   addTitle(slide, 'N. Title', null)    ← NEVER pass a subtitle
y=0.62   KPI Row 0  h=0.40  [Inbound | Closed | Res.SLA% | 1stReply%]
y=1.12   KPI Row 1  h=0.40  [TTA | AvgFR | AvgRT | On-Hold/Open]
y=1.58   Combo chart  x=0.3, w=12.73, h=3.04
           bars: Inbound (2A5490), Closed (27AE60)
           lines (secondary axis): Res.SLA% (E87722), 1stReply% (E74C3C)
           val2AxisMaxVal=100, legendPos='b'
─── y=4.72  bottom section ───────────────────────────────────────────
LEFT   x=0.3, w=7.8,  y=4.72, h=2.66   Ageing bar chart (fills to 7.38)
RIGHT  x=8.3, w=4.73, y=4.72           Stack (dynamic):
         SLA Violations panel  (height = 0.27 + slaRowH + rows*slaRowH)
         +0.07 gap
         Team panel  h=0.73 (fixed)
         +0.07 gap
         Comments panel  h = 7.38 - cmtY  (fills rest of slide)
```

---

## SLA Violations Panel

```js
const slaRowH    = 0.20;
const maxViolRows = 4;
const showViol   = top10.slice(0, maxViolRows);
const slaH       = 0.27 + slaRowH + showViol.length * slaRowH;

// Header bar
slide.addShape('rect', { x: rightX, y: slaY, w: rightW, h: 0.27, fill: { color: 'E74C3C' }, ... });
slide.addText('⚠  Top SLA Violations — Current Week', { fontSize: 7.5, bold: true, color: 'FFFFFF' });

// No violations state: green box, '✓  No SLA violations this week', color '27AE60'
// Data rows: alternate 'FFF5F5' / 'FFFFFF', violation count in 'E74C3C'
```

Weekly header: `'⚠  Top SLA Violations — Current Week'`
Monthly header: `'⚠  Top SLA Violations — Last Week of Month'`

---

## Monthly Helpdesk Data Sources

`slideMonthlyHelpdesk` differs from weekly in data source only — layout is identical.

### Row 0 (monthly totals)
- Primary: `monthlyData.calendar_hd` → `{ inbound, closed, close_pct, sla_res_pct, sla_reply_pct, source:'calendar' }`
- Fallback: last entry of `monthlyData.history6m`
- `calSyncNeeded` → show `'—sync'` in all tiles, hide deltas

### Row 0 deltas (month vs previous month)
```js
const prevH6   = h6[h6.length - 2];   // second-to-last entry in history6m
const pMLabel  = prevH6?.label || '';  // "Mar 2026"
const prevMRef = v => pMLabel ? `prev: ${v} (${pMLabel})` : `prev: ${v}`;
```

### Row 1 (timing — from last week of month)
`calendar_hd` has NO timing fields. Use last report's `cd.weeks` array:
```js
for (const r of reports) {
  const wks = cd.weeks || r.helpdesk?.group_metrics || [];
  if (wks.length) { lastCurWk = wks[wks.length-1]; lastPrevWk = wks[wks.length-2]; }
}
// Row 1 deltas use lastPrevWk?.label (week label, not month label)
```

### SLA violations (monthly)
```js
if (Array.isArray(cd.top10)) lastTop10 = cd.top10;
// from the last report's chart_data.top10
```

### Combo chart (always 6-month)
Uses `monthlyData.history6m` — same chart spec as weekly, same dimensions.

---

## Dynamic Service Column Pattern (Infrastructure Tables)

```js
const fixedSum = kpiW + tgtW + (nMonths * monthW) + ytdW;  // sum all fixed cols
const svcW     = 12.73 - fixedSum;   // service col absorbs remaining space
// colW = [svcW, ...fixedCols]
```

This prevents "WAN1 Fetekro Explo" and similar long names from wrapping.

---


## Color Constants (C object in PPTX files)

```js
const C = {
  blue:      '2A5490',
  green:     '27AE60',
  red:       'E74C3C',
  orange:    'E87722',
  darkGrey:  '333333',
  midGrey:   '666666',
  lightGrey: 'F5F5F5',
  white:     'FFFFFF',
  tableHead: '2A5490',   // same as blue — used for table header rows
};
```

---


## Checklist Before Submitting PPTX Changes

- [ ] Content width = 12.73" on all slides (x=0.3)?
- [ ] `addTitle(slide, '...', null)` — no subtitle?
- [ ] KPI tiles: label y+0.03, value y+0.13, delta y+0.29?
- [ ] Row 0 at y=0.62, Row 1 at y=1.12?
- [ ] Combo chart at y=1.58, h=3.04?
- [ ] Ageing at y=4.72, h=2.66 (fills to 7.38)?
- [ ] SLA violations panel dynamic height (`0.27 + slaRowH + rows*slaRowH`)?
- [ ] Comments panel fills to y=7.38?
- [ ] Monthly slide updated in BOTH `reports-weekly-pptx.js` AND `reports-monthly-pptx.js`?
- [ ] No emoji in PPTX code (BMP symbols only)?
- [ ] Delta strings show full context `"±N  ·  prev: VALUE (LABEL)"`?
- [ ] `node -e "new Function(src)"` syntax check passes on changed files?

---
