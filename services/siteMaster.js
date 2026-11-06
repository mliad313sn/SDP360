'use strict';
// E-D02 (audit D-02) — the "site master": one row per site with its codes per module, country, business
// unit, time zone, asset currency, Zoho group and status. PURE (no I/O). A field with no source is null
// (UNKNOWN), never guessed: no default time zone, no default currency.
const { neutralize } = require('../public/lib/csvSafe');

// sites: [{id,name,zoho_group,active,sort_order,country,business_unit,time_zone}], codes: [{site_id,module,code}],
// currencyFor(site) → code | null.
function buildSiteMaster({ sites = [], codes = [], currencyFor = () => null } = {}) {
  const bySite = new Map();
  for (const c of codes) {
    const k = Number(c.site_id);
    if (!bySite.has(k)) bySite.set(k, {});
    bySite.get(k)[String(c.module)] = String(c.code);
  }
  return sites.map((s) => ({
    id: Number(s.id), name: s.name, active: s.active ? 1 : 0, sort_order: s.sort_order,
    country: s.country || null, business_unit: s.business_unit || null, time_zone: s.time_zone || null,
    currency: currencyFor(s) || null, zoho_group: s.zoho_group || null,
    codes: bySite.get(Number(s.id)) || {},
  }));
}

const CSV_COLS = ['id', 'name', 'active', 'country', 'business_unit', 'time_zone', 'currency', 'zoho_group', 'codes'];
function _cell(v) {
  const t = neutralize(v == null ? '' : String(v));
  return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
function toCsv(rows) {
  const lines = [CSV_COLS.join(',')];
  for (const r of rows) {
    const codes = Object.entries(r.codes || {}).map(([m, c]) => m + ':' + c).join(' ');
    lines.push(CSV_COLS.map((k) => _cell(k === 'codes' ? codes : r[k])).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { buildSiteMaster, toCsv, CSV_COLS };
