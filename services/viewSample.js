'use strict';
// F-ARCH-02 — shape of the answer of GET /api/sample/:viewId (a super_admin diagnostic).
// The Analytics /data export ignores maxRows: one call downloads the whole view. So the answer is
// capped here (rows, cell length), the personal-data filter is applied again on whatever the reader
// returned, and a short cool-down keeps the route from being used to hammer the upstream.
const MAX_ROWS = 5;
const MAX_CELL = 200;
const COOLDOWN_MS = 30000;

function _cut(v) {
  if (v == null) return v;
  const s = typeof v === 'string' ? v : (typeof v === 'object' ? JSON.stringify(v) : v);
  return typeof s === 'string' && s.length > MAX_CELL ? s.slice(0, MAX_CELL) + '…' : s;
}

/** result = what fetchView returned; strip = the server's stripPiiColumns. */
function buildSample(result, strip) {
  let rows = result && (Array.isArray(result) ? result : (result.rows || (result.data && (result.data.rows || result.data.data)) || result.data));
  if (!Array.isArray(rows)) rows = [];
  rows = rows.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  if (typeof strip === 'function') rows = strip(rows) || [];
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const sample = rows.slice(0, MAX_ROWS).map((r) => { const o = {}; for (const k of columns) o[k] = _cut(r[k]); return o; });
  return { totalRows: rows.length, columns, sample };
}

/** One call per window for the whole process. Returns the seconds left to wait, or 0 when the call may go. */
let _last = 0;
function cooldown(now = Date.now()) {
  const left = _last + COOLDOWN_MS - now;
  if (left > 0) return Math.ceil(left / 1000);
  _last = now;
  return 0;
}
function _reset() { _last = 0; }

module.exports = { buildSample, cooldown, _reset, MAX_ROWS, MAX_CELL, COOLDOWN_MS };
