'use strict';
// B8 (goal programme 2026-11-12) — Pronto actuals bridge by FILE (CSV / Excel). PURE apart from parsing the uploaded
// bytes: no DB, no network, no clock. A live connector to Pronto is FORBIDDEN (.claude/rules/SDP360_BOUNDARIES.md).
//   parseFile → validateMapping → dryRun (row errors + one aggregate per project × period × currency, GL lines netted)
//   → reconcile (vs the stored budget periods) → the route commits the aggregates as kind 'actual' budget periods.
// Never written back anywhere; never converted (each actual keeps its native currency); never summed across
// currencies. An ambiguous slash date (both numbers ≤ 12) is refused unless the mapping declares DMY or MDY.
const crypto = require('crypto');
const FIELDS = Object.freeze(['project_key', 'period', 'currency', 'amount']);
const CURRENCIES = Object.freeze(['USD', 'XOF', 'EUR']);
const DATE_FORMATS = Object.freeze(['ISO', 'DMY', 'MDY']);
const MAX_ROWS = 20000;

function parseFile(buf, filename) {
  const XLSX = require('xlsx');
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || '');
  const sha256 = crypto.createHash('sha256').update(b).digest('hex');
  const isCsv = /\.csv$/i.test(String(filename || ''));
  const wb = isCsv ? XLSX.read(b.toString('utf8').replace(/^﻿/, ''), { type: 'string', raw: true }) : XLSX.read(b, { type: 'buffer', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) : [];
  const headers = (aoa[0] || []).map((h) => String(h == null ? '' : h).trim());
  const rows = aoa.slice(1, MAX_ROWS + 1).filter((r) => r.some((c) => String(c).trim() !== ''))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] == null ? '' : String(r[i]).trim()])));
  return { headers, rows, sha256, truncated: aoa.length - 1 > MAX_ROWS };
}

/** null, or a sentence naming every mapped column the file does not have. */
function validateMapping(headers, mapping) {
  const cols = (mapping && mapping.columns) || {};
  const miss = FIELDS.filter((f) => !cols[f]);
  if (miss.length) return 'mapping needs a column for: ' + miss.join(', ');
  const absent = FIELDS.map((f) => cols[f]).filter((c) => !(headers || []).includes(c));
  if (absent.length) return 'the file has no column named: ' + absent.join(', ');
  if (mapping.date_format && !DATE_FORMATS.includes(mapping.date_format)) return 'date_format must be ' + DATE_FORMATS.join(' | ');
  return null;
}

function parseAmount(raw) {
  let s = String(raw == null ? '' : raw).replace(/[\s  ]/g, '');
  if (!s) return null;
  let neg = false;
  if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  const hasC = s.includes(','), hasD = s.includes('.');
  if (hasC && hasD) {                                   // the LAST separator is the decimal one
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(',', '.');
  } else if (hasC || hasD) {
    const sep = hasC ? ',' : '.', parts = s.split(sep);
    const thousands = parts.length > 2 || (sep === ',' && parts[1].length === 3);
    s = thousands ? parts.join('') : parts.join('.');
  }
  if (!/^[0-9.]+$/.test(s) || s.split('.').length > 2 || s.startsWith('.') || s.endsWith('.')) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}
const mm = (m) => String(m).padStart(2, '0');
function parsePeriod(raw, fmt) {
  const s = String(raw == null ? '' : raw).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})$/) || s.match(/^(\d{4})-(\d{2})-\d{2}$/))) return +m[2] >= 1 && +m[2] <= 12 ? { value: `${m[1]}-${m[2]}` } : { error: 'BAD_DATE' };
  if ((m = s.match(/^(\d{1,2})[/.-](\d{4})$/))) return +m[1] >= 1 && +m[1] <= 12 ? { value: `${m[2]}-${mm(m[1])}` } : { error: 'BAD_DATE' };
  if ((m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/))) {
    const a = +m[1], b = +m[2];
    let month;
    if (fmt === 'DMY') month = b; else if (fmt === 'MDY') month = a;
    else if (a > 12 && b <= 12) month = b; else if (b > 12 && a <= 12) month = a;
    else return { error: 'AMBIGUOUS_DATE' };
    return month >= 1 && month <= 12 ? { value: `${m[3]}-${mm(month)}` } : { error: 'BAD_DATE' };
  }
  return { error: 'BAD_DATE' };
}

/** rows (objects keyed by header) + mapping + Map(lower(project key) → {id,key}) → errors + aggregates. */
function dryRun(rows, mapping, projectsByKey) {
  const c = (mapping && mapping.columns) || {};
  const errors = [], agg = new Map();
  (rows || []).forEach((r, i) => {
    const row = i + 1, err = (field, error) => errors.push({ row, field, error });
    const key = String(r[c.project_key] || '').trim();
    const p = projectsByKey.get(key.toLowerCase());
    if (!p) return err('project_key', key ? `no portfolio project with the key "${key}"` : 'project key is empty');
    const per = parsePeriod(r[c.period], mapping.date_format);
    if (per.error) return err('period', per.error === 'AMBIGUOUS_DATE' ? `"${r[c.period]}" is ambiguous (day and month ≤ 12) — declare the date format DMY or MDY` : `"${r[c.period]}" is not a period (YYYY-MM, MM/YYYY or a date)`);
    const cur = String(r[c.currency] || '').trim().toUpperCase();
    if (!CURRENCIES.includes(cur)) return err('currency', `currency "${r[c.currency]}" is not USD, XOF or EUR`);
    const amt = parseAmount(r[c.amount]);
    if (amt == null) return err('amount', `"${r[c.amount]}" is not an amount`);
    const k = `${p.id}|${per.value}|${cur}`;
    if (!agg.has(k)) agg.set(k, { project_id: Number(p.id), project_key: p.key, period: per.value, currency: cur, amount: 0, lines: 0, rows: [] });
    const a = agg.get(k); a.amount += amt; a.lines++; a.rows.push(row);
  });
  const aggregates = [];
  for (const a of agg.values()) {
    a.amount = Math.round(a.amount * 100) / 100;
    if (a.amount < 0) { errors.push({ row: a.rows[0], field: 'amount', error: `${a.project_key} ${a.period} ${a.currency}: the lines net to ${a.amount} — an actual cannot be negative` }); continue; }
    aggregates.push(a);
  }
  aggregates.sort((x, y) => x.project_key.localeCompare(y.project_key) || x.period.localeCompare(y.period) || x.currency.localeCompare(y.currency));
  errors.sort((x, y) => x.row - y.row);
  const badRows = new Set(errors.map((e) => e.row));
  return { rows_total: (rows || []).length, rows_ok: (rows || []).length - badRows.size, errors, aggregates };
}

/** aggregates vs stored budget periods → per-key lines (new / changed / unchanged), stored actuals absent from the file, totals per currency. */
function reconcile(aggregates, existing) {
  const ex = new Map();
  for (const r of existing || []) ex.set(`${Number(r.project_id)}|${r.period}|${r.currency}|${r.kind}`, Number(r.amount));
  const lines = (aggregates || []).map((a) => {
    const prior = ex.has(`${a.project_id}|${a.period}|${a.currency}|actual`) ? ex.get(`${a.project_id}|${a.period}|${a.currency}|actual`) : null;
    const baseline = ex.has(`${a.project_id}|${a.period}|${a.currency}|baseline`) ? ex.get(`${a.project_id}|${a.period}|${a.currency}|baseline`) : null;
    const status = prior == null ? 'new' : prior === a.amount ? 'unchanged' : 'changed';
    return { project_id: a.project_id, project_key: a.project_key, period: a.period, currency: a.currency, lines: a.lines,
      baseline, existing_actual: prior, imported: a.amount, delta: prior == null ? null : Math.round((a.amount - prior) * 100) / 100,
      variance_vs_baseline: baseline == null ? null : Math.round((a.amount - baseline) * 100) / 100, status };
  });
  const inFile = new Set(lines.map((l) => `${l.project_id}|${l.period}|${l.currency}`));
  const projCur = new Set(lines.map((l) => `${l.project_id}|${l.currency}`));
  const not_in_file = (existing || []).filter((r) => r.kind === 'actual' && projCur.has(`${Number(r.project_id)}|${r.currency}`) && !inFile.has(`${Number(r.project_id)}|${r.period}|${r.currency}`))
    .map((r) => ({ project_id: Number(r.project_id), period: r.period, currency: r.currency, existing_actual: Number(r.amount) }))
    .sort((a, b) => a.project_id - b.project_id || a.period.localeCompare(b.period));
  const tot = new Map();
  for (const l of lines) {
    if (!tot.has(l.currency)) tot.set(l.currency, { currency: l.currency, imported: 0, existing_actual: 0, keys: 0 });
    const t = tot.get(l.currency); t.imported += l.imported; t.existing_actual += l.existing_actual || 0; t.keys++;
  }
  const totals = [...tot.values()].map((t) => ({ ...t, imported: Math.round(t.imported * 100) / 100, existing_actual: Math.round(t.existing_actual * 100) / 100 })).sort((a, b) => a.currency.localeCompare(b.currency));
  const n = (s) => lines.filter((l) => l.status === s).length;
  return { lines, not_in_file, totals, summary: { new: n('new'), changed: n('changed'), unchanged: n('unchanged'), to_write: n('new') + n('changed') }, never_summed_across_currencies: true };
}

module.exports = { FIELDS, CURRENCIES, DATE_FORMATS, MAX_ROWS, parseFile, validateMapping, parseAmount, parsePeriod, dryRun, reconcile };
