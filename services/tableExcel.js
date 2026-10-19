'use strict';

// Shared multi-sheet .xlsx builder for "full table" data dumps (meetings +
// inspection modules). Uses SheetJS CE (already a prod dependency for the
// meetings import + risk-register export). One sheet per table; columns come
// straight from the row objects (query column order preserved). CE drops cell
// styling on write — fine for a raw data export; column widths ARE preserved.
//
//   buildWorkbook([{ name: 'Inspections', rows: [...] }, ...]) -> Buffer
//
// A sheet with no rows renders a single "(no rows)" cell rather than a blank
// tab, so the reader can tell "empty" from "broken".

const XLSX = require('xlsx');

function _sheet(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return XLSX.utils.aoa_to_sheet([['(no rows)']]);
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  // Reasonable column widths by header name — wide for free text, narrow for dates.
  const headers = Object.keys(rows[0]);
  ws['!cols'] = headers.map(h => {
    const k = String(h).toLowerCase();
    if (/(desc|note|observ|title|subject|attend|distribution|positive|scope|item_text|text_en|affects)/.test(k)) return { wch: 48 };
    if (/(date|time)$|_date|_time/.test(k)) return { wch: 13 };
    if (/email|reference|label|owner|champion|inspector|lead/.test(k)) return { wch: 24 };
    return { wch: 16 };
  });
  return ws;
}

// SheetJS truncates sheet names to 31 chars and forbids []:*?/\ — sanitize.
function _safeName(name, ix) {
  const clean = String(name || ('Sheet' + (ix + 1))).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31);
  return clean || ('Sheet' + (ix + 1));
}

function buildWorkbook(sheets) {
  const wb = XLSX.utils.book_new();
  (sheets || []).forEach((s, ix) => {
    XLSX.utils.book_append_sheet(wb, _sheet(s.rows), _safeName(s.name, ix));
  });
  if (!wb.SheetNames.length) XLSX.utils.book_append_sheet(wb, _sheet([]), 'Empty');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildWorkbook };
