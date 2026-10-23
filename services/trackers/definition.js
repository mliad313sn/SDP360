'use strict';
// Step 7 — the DEFINITION of a business tracker and its validator (dossier docs/design/ETAPE-07-trackers.md §3).
// A definition holds structure only — period, units, groups, items, KPI types, weights, targets, audience — never a
// formula (the formulas live in public/lib/trackerEngine.js) and never markup. validate() returns blocking ERRORS
// (publish refused) and WARNINGS (the builder shows them inline; publish allowed).

const KpiRag = require('../../public/lib/kpiRag');
const { KPI_TYPES } = require('../../public/lib/trackerEngine');
const { AUDIENCE_ROLES } = require('../dashboards/definition');

const ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9 _&.()/-]{0,47}$/;
const MAX = { units: 60, groups: 12, items: 200, title: 120, name: 120, target: 30 };
const SCOPES = ['all', 'own'];

const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const HTML_RE = /[<>]/;

function text(v, n, path, errors) {
  if (v && typeof v === 'object') {
    const out = {};
    for (const l of ['fr', 'en']) if (v[l] != null) out[l] = str(v[l], n);
    if (!out.fr && !out.en) errors.push(`${path}: empty`);
    if (Object.values(out).some(x => HTML_RE.test(x))) errors.push(`${path}: HTML is not allowed`);
    return out;
  }
  const s = str(v, n);
  if (!s) errors.push(`${path}: empty`);
  if (HTML_RE.test(s)) errors.push(`${path}: HTML is not allowed`);
  return s;
}

function validate(input, opts = {}) {
  const errors = [], warnings = [];
  const d = input && typeof input === 'object' ? input : {};
  const out = {};

  out.id = str(d.id, 48);
  if (!ID_RE.test(out.id)) errors.push('id: lower-case letters, digits and dashes, 2-48 characters');
  out.title = text(d.title, MAX.title, 'title', errors);
  out.description = HTML_RE.test(str(d.description, 400)) ? (errors.push('description: HTML is not allowed'), '') : str(d.description, 400);
  out.year = Number(d.year);
  if (!Number.isInteger(out.year) || out.year < 2000 || out.year > 2100) errors.push('year: a year between 2000 and 2100');

  // Units
  const units = Array.isArray(d.units) ? d.units : [];
  if (!units.length) errors.push('units: at least one unit');
  if (units.length > MAX.units) errors.push(`units: at most ${MAX.units}`);
  const unitCodes = new Set();
  out.units = units.slice(0, MAX.units).map((u, i) => {
    const code = str(u && u.code, 20);
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(code)) errors.push(`units[${i}].code: letters, digits, _ or -`);
    if (unitCodes.has(code)) errors.push(`units[${i}].code: duplicate ${code}`);
    unitCodes.add(code);
    const o = { code, name: str(u && u.name, MAX.name) || code, active: !(u && u.active === false) };
    if (u && u.site_id != null && u.site_id !== '') {
      const sid = Number(u.site_id);
      if (Number.isInteger(sid) && sid > 0) o.site_id = sid; else errors.push(`units[${i}].site_id: a site id`);
    }
    return o;
  });
  if (out.units.length && !out.units.some(u => u.active)) errors.push('units: at least one active unit');

  // Groups
  const groups = Array.isArray(d.groups) ? d.groups : [];
  if (!groups.length) errors.push('groups: at least one group');
  if (groups.length > MAX.groups) errors.push(`groups: at most ${MAX.groups}`);
  const groupCodes = new Set();
  out.groups = groups.slice(0, MAX.groups).map((g, i) => {
    const code = str(g && g.code, 48);
    if (!CODE_RE.test(code)) errors.push(`groups[${i}].code: invalid`);
    if (groupCodes.has(code)) errors.push(`groups[${i}].code: duplicate ${code}`);
    groupCodes.add(code);
    const w = Number(g && g.weight);
    if (!(w >= 0 && w <= 1)) errors.push(`groups[${i}].weight: between 0 and 1`);
    return { code, name: str(g && g.name, MAX.name) || code, weight: Number.isFinite(w) ? w : 0 };
  });
  const sumW = out.groups.reduce((s, g) => s + g.weight, 0);
  if (out.groups.length && Math.abs(sumW - 1) > 0.001) warnings.push(`groups: weights add up to ${Math.round(sumW * 1000) / 10} %, not 100 %`);

  // Items
  const items = Array.isArray(d.items) ? d.items : [];
  if (!items.length) errors.push('items: at least one item');
  if (items.length > MAX.items) errors.push(`items: at most ${MAX.items}`);
  const itemCodes = new Set();
  const served = opts.servedMetrics || null;
  out.items = items.slice(0, MAX.items).map((it, i) => {
    const p = `items[${i}]`;
    const code = str(it && it.code, 48);
    if (!CODE_RE.test(code)) errors.push(`${p}.code: invalid`);
    if (itemCodes.has(code)) errors.push(`${p}.code: duplicate ${code}`);
    itemCodes.add(code);
    const group = str(it && it.group, 48);
    if (!groupCodes.has(group)) errors.push(`${p}.group: unknown group ${group}`);
    const kpi = str(it && it.kpi, 12).toUpperCase() || 'COUNT';
    if (!KPI_TYPES.includes(kpi)) errors.push(`${p}.kpi: one of ${KPI_TYPES.join(', ')}`);
    const weight = Number(it && it.weight);
    if (!(weight >= 0)) errors.push(`${p}.weight: a number ≥ 0`);
    const start = Number(it && it.start != null ? it.start : 1), end = Number(it && it.end != null ? it.end : 12);
    if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end <= 12 && start <= end)) errors.push(`${p}: start and end are months 1-12, start ≤ end`);
    const o = { code, name: text(it && it.name, MAX.name, `${p}.name`, errors), group, kpi, weight: Number.isFinite(weight) ? weight : 0, start, end, shared: !!(it && it.shared) };
    if (it && it.source && it.source.metric) {
      const key = str(it.source.metric, 80);
      if (served && !served.has(key)) errors.push(`${p}.source: ${key} is not a served dictionary key`);
      o.source = { metric: key };
    }
    return o;
  });
  for (const g of out.groups) if (!out.items.some(it => it.group === g.code)) warnings.push(`group ${g.code}: no item`);
  if (out.items.some(it => it.source) && !out.units.some(u => u.site_id)) warnings.push('items linked to a metric need units mapped to a site (site_id)');

  // Targets
  out.targets = {};
  const tg = d.targets && typeof d.targets === 'object' ? d.targets : {};
  for (const u of Object.keys(tg)) {
    if (!unitCodes.has(u)) { errors.push(`targets: unknown unit ${u}`); continue; }
    out.targets[u] = {};
    for (const k of Object.keys(tg[u] || {})) {
      if (!itemCodes.has(k)) { errors.push(`targets.${u}: unknown item ${k}`); continue; }
      const t = tg[u][k] || {};
      const target = str(t.target, MAX.target);
      if (HTML_RE.test(target)) errors.push(`targets.${u}.${k}: HTML is not allowed`);
      out.targets[u][k] = { target, active: !!t.active };
    }
  }
  for (const u of out.units) {
    if (u.active && !out.items.some(it => out.targets[u.code] && out.targets[u.code][it.code] && out.targets[u.code][it.code].active)) warnings.push(`unit ${u.code}: no active item`);
  }

  // Colours
  out.rag_policy = str(d.rag_policy, 40) || 'tracker_activity';
  const pol = KpiRag.POLICIES[out.rag_policy];
  if (!pol || pol.kind !== 'fixed' || pol.scale !== 1) errors.push('rag_policy: a fixed 0-1 policy of public/lib/kpiRag.js');

  // Audience (who reads) and entry (who types)
  const aud = d.audience && typeof d.audience === 'object' ? d.audience : {};
  const roles = (Array.isArray(aud.roles) ? aud.roles : ['any']).map(r => str(r, 40));
  for (const r of roles) if (!AUDIENCE_ROLES.includes(r)) errors.push(`audience: unknown role ${r}`);
  out.audience = { roles: roles.length ? roles : ['any'], site_scope: SCOPES.includes(aud.site_scope) ? aud.site_scope : 'all' };
  const en = d.entry && typeof d.entry === 'object' ? d.entry : {};
  const eroles = (Array.isArray(en.roles) ? en.roles : ['editor']).map(r => str(r, 40));
  for (const r of eroles) if (!AUDIENCE_ROLES.includes(r) || r === 'any') errors.push(`entry: unknown role ${r}`);
  out.entry = { roles: eroles.length ? eroles : ['editor'], own_unit_only: en.own_unit_only !== false };

  // Parallel run of a migrated tracker: the entries are MIRRORED nightly from the IT Activity Tracker, which stays
  // the place where people type. Unticking it (and publishing) is the switch-over: entries are then typed here.
  out.legacy_mirror = !!d.legacy_mirror;
  if (out.legacy_mirror) warnings.push('parallel run: entries are copied from the IT Activity Tracker every night; typing here is closed');

  return { ok: errors.length === 0, errors, warnings, definition: out };
}

module.exports = { validate, MAX, ID_RE };
