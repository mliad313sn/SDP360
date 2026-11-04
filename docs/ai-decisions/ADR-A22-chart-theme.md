# ADR-A22 — one chart theme from the tokens, accessible colour tokens, no dual-axis trend

Status: accepted (technical, reversible) · 2026-11-04 · goal A-22 merged with A-12b (PO-REVIEW rows A-12, A-22)

## Context
Chart colours were hex literals repeated per page (`#DC2626`, `#16A34A`, `#D97706`…), only executive.html set
`Chart.defaults`, chart text went down to 9 px, and the helpdesk trend on index.html and reports.html drew counts and
"SLA missed %" on one plot with two y-scales. Separately (A-12b), white text sat on brand orange (3.25:1), status
words used `--color-warning` (3.19:1 on white), `--color-text-muted` was 3.88:1 on the page background, `--rag-na`
2.52:1, and 55 `outline:none` declarations hid the keyboard focus on 19 files.

## Decision
- Tokens (`public/_tokens.css`), all computed by `tests/token-contrast.test.js`:
  `--color-primary-fill #C2410C` (white 5.18:1), `--color-primary-fill-hover #9A3412` (7.31:1),
  `--color-warning-text #92400E` (≥ 4.5 on white and on `--color-warning-bg`), `--color-success-text #166534`,
  `--focus-ring #145FAE`; values changed: `--color-text-muted #7B7B7B → #6B6B6B` (4.89:1 on `--color-bg`),
  `--rag-na #9AA4B2 → #7C8796` (3.64:1). `--color-warning #D97706` and `--edv-orange #EF631A` are **unchanged**
  (`brand-tokens.js` mirrors `--color-warning` for the PPTX generators; orange stays for accents, borders, brand mark).
- Chart series, categorical, fixed order — validated with the dataviz palette checker
  (`validate_palette.js --mode light`: lightness band, chroma floor, CVD adjacent ΔE ≥ 8 (worst 8.7 deutan),
  normal-vision ΔE ≥ 15 (worst 18.1), all ≥ 3:1 on white):

  | token | hex | on white |
  |---|---|---|
  | `--chart-series-1` | #145FAE (EDV blue) | 6.41 |
  | `--chart-series-2` | #C2410C (burnt orange) | 5.18 |
  | `--chart-series-3` | #0891B2 (cyan) | 3.68 |
  | `--chart-series-4` | #7C3AED (violet) | 5.70 |
  | `--chart-series-5` | #A16207 (ochre) | 4.92 |
  | `--chart-series-6` | #BE185D (magenta) | 6.04 |

  RAG colours are not series colours; charts read them from `--rag-*` via `ChartTheme.colors.rag`.
  Thresholds stay in `public/lib/kpiRag.js`.
- `public/lib/chartTheme.js` (UMD `ChartTheme`) reads the tokens with hard fallbacks equal to them, and applies itself
  to `Chart.defaults` (font family, ≥ 12 px, token ink and grid, legend at the bottom, page locale) on the 17 pages that
  load Chart.js — loaded right after Chart.js with the same `defer`/`nonce`.
- `public/lib/charts.js` (UMD `TrendPanel`): counts (bars) stacked over rates (lines), one y-axis per panel, same x
  positions, `spanGaps:false` (null = gap, never 0), optional dashed target line only when a target is supplied.
  Used by the helpdesk trends of index.html and reports.html; the data arrays are passed untouched.
- `public/lib/kpiCard.js` (UMD `KpiCard`): KPI card and bullet bar built on `DashboardRender` and `KpiRag`; offered for
  adoption, not forced onto existing tiles.
- Global `:focus-visible` ring in `_tokens.css` as well as `_shell.css` (pages without the shell get it); the 55
  `outline:none` declarations are removed and `tests/brand-buttons.test.js` keeps them out.

## Alternatives
- Change `--color-warning` / `--color-primary` values: would recolour PPTX decks (golden-pinned) and every accent. Rejected.
- Keep the dual axis with clearer titles: two scales on one plot still invite false comparisons of crossing lines. Rejected.
- Target lines on the helpdesk trend: the pages carry SLA targets only in tooltip prose, not as data; no line drawn
  rather than invent a target.

## Rollback
Revert the commit. Additive except the two token values and the 55 removed `outline:none` (all revert with it).
