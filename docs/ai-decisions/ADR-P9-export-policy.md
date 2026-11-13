# ADR-P9 — One export policy (goal B7)

Status: accepted (engineering) · the sensitivity matrix itself is PROPOSED, not adopted · 2026-11-13

## Context
Export rules were scattered over ~50 routes (guards, inline money tests, nothing logged except
`asset_export`). GAP-MATRIX §3 B7 asks for one matrix module × format × role → allow / mask / deny,
amounts masked everywhere, every export logged, a watermark, and matrix-driven tests.

## Decision
- `services/exportPolicy.js` holds the CATALOGUE (one row per export: module, formats, amounts
  `none|gated|masked`, today's guard, optional PROPOSED `strict` row) and `gate(id)`, an Express
  middleware mounted as the LAST middleware before the handler of every export route. Placing it last
  keeps every existing 401/403/404 exactly where it was.
- Two matrices behind `export_policy_strict` (default `'0'`): DEFAULT never denies anyone the route's
  own guard admitted and keeps today's amount rule (incl. the portfolio committee-member exception);
  STRICT applies the PROPOSED rows and the amount rule without exception.
- Handlers that carry amounts read `req.exportPolicy.money` (portfolio deck / workbook / report.html,
  annual pack, WAN claim evidence) — one source for invariant 2 in exports. Routes already gated by
  `requireMoneyRead` / finance admin stay as they are (`amounts: 'gated'`).
- Logging hooks `res.on('finish')`: 2xx only, JSON answers of dual JSON/CSV routes skipped,
  `system_log` category `export` (module, format, site scope, rows — `null` when unknown, never 0).
  `services/tableExcel.buildWorkbook` tags its buffer with a non-enumerable `exportRows`.
- Watermark (`export_watermark_enabled`, default `'0'`) wraps `res.end`: CSV last line, HTML footer,
  XLSX first sheet `Export` (SheetJS re-write; CE already drops styling), PPTX footer text box per slide
  (JSZip, already used by `pptx-fix-axes.js`); PDF/JSON: response header only. Any failure → original body.
- No migration (system_log already exists; migration 103 unused).

## Consequences
- A new export route must add `gate('<id>')` and a catalogue row, or
  `tests/export-policy-routes.smoke.test.js` fails.
- Limits: PDF content is not stamped; the JSON dump (system-log) carries the stamp in a header only.
