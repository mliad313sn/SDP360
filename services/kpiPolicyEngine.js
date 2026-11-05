'use strict';
// C-31 — KPI Policy Builder: the PURE engine (no database, no clock, no I/O).
//
// A KPI policy is a STRUCTURED definition assembled from SAFE building blocks — never free code, never SQL text:
//   dataset      one of DATASETS (helpdesk tickets, changes, inspections, meeting issues, assets)
//   aggregation  count | ratio | mean | median | percentile
//   denominator  filter blocks (the population of a ratio — required for a ratio)
//   numerator    filter blocks applied INSIDE the denominator (ratio only — required for a ratio)
//   filters      filter blocks (the population of count / mean / median / percentile)
//   value_field  numeric field of the dataset (mean / median / percentile)
//   window       { kind: week|month|quarter|rolling, n (days, rolling only) }
//   unit · direction (higher_is_better|lower_is_better) · rounding (0..3 decimals) · min_sample (below → NOT_COMPARABLE)
//   rag          { green, amber, by_site_class: { mine|office: { green, amber } } } | null (no RAG)
//   target       { link: 'none' | 'kpi_targets' }   (the committee target of the policy's metric key, services/kpiTargets)
//   null_handling 'unknown' — the only value: a figure with nothing to judge is UNKNOWN (null), never 0 / green
//
// validate(def) rejects unknown blocks/keys, inconsistent thresholds and a ratio without a denominator.
// evaluate(def, rows, ctx) computes the figure on in-memory rows; diff(a, b) lists the changed paths.
// The helpdesk resolution-SLA rules in force today (C-30 resolutionSla, services/slaDefinition) are expressible:
// IMPORTED_DEFINITIONS reproduces them and tests/kpi-policy-engine.test.js proves identical results on a fixture.
const SlaDef = require('./slaDefinition');

const SCHEMA = 1;
const AGGREGATIONS = ['count', 'ratio', 'mean', 'median', 'percentile'];
const WINDOW_KINDS = ['week', 'month', 'quarter', 'rolling'];
const UNITS = ['%', 'count', 'hours', 'days', 'points'];
const DIRECTIONS = ['higher_is_better', 'lower_is_better'];
const SITE_CLASSES = ['mine', 'office'];
const TOP_KEYS = ['schema', 'dataset', 'aggregation', 'percentile', 'value_field', 'denominator', 'numerator', 'filters', 'window', 'unit',
  'direction', 'rounding', 'min_sample', 'rag', 'target', 'null_handling', 'scope'];

const _s = (v) => (v == null ? '' : String(v)).trim();
const _low = (v) => _s(v).toLowerCase();
const _nz = (v) => (v == null || _s(v) === '' ? null : String(v));
const _flag = (v) => { const s = _low(v); return s === '1' || s === 'yes' || s === 'true'; };
const HD_CLOSED = new Set(['closed', 'resolved', 'confirmed resolution', 'confirm resolution', 'cancelled']);
const CANCELLED = new Set(['cancelled', 'canceled']);
const _hours = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return Number.isFinite(x) && Number.isFinite(y) ? (y - x) / 3600000 : null; };

// ── Datasets: the fields a block may name, the numeric value fields, the date the window filters on ──────────
// `fields` = canonical (server, snake_case) column names. A block never names anything outside this list.
const DATASETS = Object.freeze({
  helpdesk_tickets: Object.freeze({
    en: 'Helpdesk tickets (ServiceDesk Plus requests)', fr: 'Tickets du helpdesk (demandes ServiceDesk Plus)',
    date_field: 'created_time',
    fields: ['request_status', 'request_type', 'template', 'mode', 'site', 'tech_group', 'impact', 'category', 'sub_category', 'overdue_status', 'due_by_time', 'resolved_time'],
    value_fields: { resolution_hours: (r) => _hours(r.created_time, _nz(r.resolved_time) || _nz(r.completed_time)),
      first_response_hours: (r) => _hours(r.created_time, r.responded_time) },
    special: ['is_closed', 'sla_met', 'sla_missed'],
  }),
  changes: Object.freeze({
    en: 'Changes (ServiceDesk Plus change records)', fr: 'Changements (ServiceDesk Plus)',
    date_field: 'created_time',
    fields: ['status', 'change_type', 'risk', 'category', 'group_name', 'closure_code', 'emergency'],
    value_fields: { lead_time_hours: (r) => _hours(r.created_time, r.completed_time) },
    special: [],
  }),
  inspections: Object.freeze({
    en: 'Site inspections', fr: 'Inspections de site', date_field: 'inspection_date',
    fields: ['status', 'site_code', 'overall_risk', 'inspection_type'], value_fields: {}, special: [],
  }),
  meeting_issues: Object.freeze({
    en: 'Department meeting issues', fr: 'Problèmes des réunions départementales', date_field: 'created_at',
    fields: ['status', 'severity', 'category', 'site_code', 'escalate'], value_fields: {}, special: [],
  }),
  assets: Object.freeze({
    en: 'IT assets (register)', fr: 'Actifs IT (registre)', date_field: null,
    fields: ['state', 'site', 'product_type', 'manufacturer'], value_fields: {}, special: [],
  }),
});

// ── Filter blocks ──────────────────────────────────────────────────────────────────────────────────────────
// Each block = { block, ...params }. values are compared case-insensitively on trimmed strings.
const SLA_RULES = SlaDef.MODES;   // 'flag' | 'due_vs_resolved' — the helpdesk_sla_definition vocabulary
const BLOCKS = Object.freeze({
  field_in: { en: 'Field is one of', fr: 'Le champ est parmi', params: ['field', 'values'] },
  field_not_in: { en: 'Field is not one of', fr: 'Le champ n’est pas parmi', params: ['field', 'values'] },
  field_present: { en: 'Field is filled', fr: 'Le champ est renseigné', params: ['field'] },
  is_closed: { en: 'Ticket is closed (pending status, else closed status set — cancelled included)', fr: 'Ticket clôturé (statut en attente, sinon statut de clôture — annulé inclus)', params: [] },
  sla_met: { en: 'Resolution SLA met', fr: 'SLA de résolution respecté', params: ['rule', 'cancelled_never_missed'] },
  sla_missed: { en: 'Resolution SLA missed', fr: 'SLA de résolution manqué', params: ['rule', 'cancelled_never_missed'] },
});

function _closed(r) {
  if (r.pending_status != null && _s(r.pending_status) !== '') return Number(r.pending_status) === 0;
  return HD_CLOSED.has(_low(r.request_status));
}
/** Missed under a rule. 'due_vs_resolved' = services/slaDefinition (cancelled never missed, built in).
 *  'flag' = the stored Overdue Status; cancelled_never_missed (default true) = the Helpdesk page's flag rule (C-30). */
function _missed(r, rule, cnm) {
  if (rule === 'due_vs_resolved') return SlaDef.resOverdueRow(r, 'due_vs_resolved');
  if (cnm !== false && CANCELLED.has(_low(r.request_status))) return false;
  return _flag(r.overdue_status);
}
function _match(b, r) {
  switch (b.block) {
    case 'field_in': return (b.values || []).map(_low).includes(_low(r[b.field]));
    case 'field_not_in': return !(b.values || []).map(_low).includes(_low(r[b.field]));
    case 'field_present': return _nz(r[b.field]) != null;
    case 'is_closed': return _closed(r);
    case 'sla_met': return !_missed(r, b.rule, b.cancelled_never_missed);
    case 'sla_missed': return _missed(r, b.rule, b.cancelled_never_missed);
    default: throw new Error('unknown block ' + b.block);
  }
}
const _all = (filters, r) => (filters || []).every((b) => _match(b, r));

// ── Validation ─────────────────────────────────────────────────────────────────────────────────────────────
const _num = (v) => v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v));
function _validateFilters(list, ds, path, errs) {
  if (!Array.isArray(list)) { errs.push({ path, code: 'not_list', en: 'must be a list of blocks', fr: 'doit être une liste de blocs' }); return; }
  list.forEach((b, i) => {
    const p = `${path}[${i}]`;
    if (!b || typeof b !== 'object' || !BLOCKS[b.block]) { errs.push({ path: p, code: 'unknown_block', en: 'unknown building block', fr: 'bloc inconnu' }); return; }
    const spec = BLOCKS[b.block];
    for (const k of Object.keys(b)) if (k !== 'block' && !spec.params.includes(k)) errs.push({ path: `${p}.${k}`, code: 'unknown_param', en: 'unknown parameter', fr: 'paramètre inconnu' });
    if (['is_closed', 'sla_met', 'sla_missed'].includes(b.block) && !DATASETS[ds].special.includes(b.block)) errs.push({ path: p, code: 'block_not_in_dataset', en: 'this block does not apply to the dataset', fr: 'ce bloc ne s’applique pas à ce jeu de données' });
    if (spec.params.includes('field') && !DATASETS[ds].fields.includes(b.field)) errs.push({ path: `${p}.field`, code: 'unknown_field', en: 'unknown field for the dataset', fr: 'champ inconnu pour ce jeu de données' });
    if (spec.params.includes('values')) {
      if (!Array.isArray(b.values) || !b.values.length || b.values.some((v) => typeof v !== 'string' && typeof v !== 'number') || b.values.length > 50) errs.push({ path: `${p}.values`, code: 'bad_values', en: 'a non-empty list (≤ 50) of texts', fr: 'une liste non vide (≤ 50) de textes' });
    }
    if (spec.params.includes('rule') && !SLA_RULES.includes(b.rule)) errs.push({ path: `${p}.rule`, code: 'bad_rule', en: 'rule must be flag or due_vs_resolved', fr: 'la règle doit être flag ou due_vs_resolved' });
    if (b.cancelled_never_missed != null && typeof b.cancelled_never_missed !== 'boolean') errs.push({ path: `${p}.cancelled_never_missed`, code: 'bad_bool', en: 'true or false', fr: 'vrai ou faux' });
  });
}
function _validateRag(rag, dir, path, errs) {
  const pair = (o, p) => {
    if (!o || typeof o !== 'object' || !_num(o.green) || !_num(o.amber)) { errs.push({ path: p, code: 'bad_thresholds', en: 'green and amber must be numbers', fr: 'vert et orange doivent être des nombres' }); return; }
    for (const k of Object.keys(o)) if (!['green', 'amber'].includes(k)) errs.push({ path: `${p}.${k}`, code: 'unknown_param', en: 'unknown parameter', fr: 'paramètre inconnu' });
    const g = Number(o.green), a = Number(o.amber);
    if (dir === 'higher_is_better' ? g < a : g > a) errs.push({ path: p, code: 'inconsistent_thresholds',
      en: dir === 'higher_is_better' ? 'green must be ≥ amber when higher is better' : 'green must be ≤ amber when lower is better',
      fr: dir === 'higher_is_better' ? 'le vert doit être ≥ l’orange quand plus haut est mieux' : 'le vert doit être ≤ l’orange quand plus bas est mieux' });
  };
  if (rag == null) return;
  if (typeof rag !== 'object') { errs.push({ path, code: 'bad_rag', en: 'RAG must be an object or empty', fr: 'le RAG doit être un objet ou vide' }); return; }
  for (const k of Object.keys(rag)) if (!['green', 'amber', 'by_site_class'].includes(k)) errs.push({ path: `${path}.${k}`, code: 'unknown_param', en: 'unknown parameter', fr: 'paramètre inconnu' });
  pair({ green: rag.green, amber: rag.amber }, path);
  if (rag.by_site_class != null) {
    if (typeof rag.by_site_class !== 'object') errs.push({ path: `${path}.by_site_class`, code: 'bad_rag', en: 'an object keyed mine / office', fr: 'un objet par classe mine / bureau' });
    else for (const [c, o] of Object.entries(rag.by_site_class)) {
      if (!SITE_CLASSES.includes(c)) errs.push({ path: `${path}.by_site_class.${c}`, code: 'unknown_site_class', en: 'site class must be mine or office', fr: 'la classe doit être mine ou bureau' });
      else pair(o, `${path}.by_site_class.${c}`);
    }
  }
}

/** validate(def) → { ok, errors: [{path, code, en, fr}] }. Never throws. */
function validate(def) {
  const errs = [];
  const E = (path, code, en, fr) => errs.push({ path, code, en, fr });
  if (!def || typeof def !== 'object' || Array.isArray(def)) return { ok: false, errors: [{ path: '', code: 'not_object', en: 'definition must be an object', fr: 'la définition doit être un objet' }] };
  for (const k of Object.keys(def)) if (!TOP_KEYS.includes(k)) E(k, 'unknown_key', 'unknown setting', 'réglage inconnu');
  if (def.schema != null && def.schema !== SCHEMA) E('schema', 'bad_schema', 'unsupported schema version', 'version de schéma non prise en charge');
  if (!DATASETS[def.dataset]) { E('dataset', 'unknown_dataset', 'unknown dataset', 'jeu de données inconnu'); return { ok: false, errors: errs }; }
  const ds = DATASETS[def.dataset];
  if (!AGGREGATIONS.includes(def.aggregation)) E('aggregation', 'unknown_aggregation', 'unknown aggregation', 'agrégation inconnue');
  if (def.aggregation === 'ratio') {
    if (!Array.isArray(def.denominator) || !def.denominator.length) E('denominator', 'ratio_without_denominator', 'a ratio needs a denominator (at least one block)', 'un ratio a besoin d’un dénominateur (au moins un bloc)');
    else _validateFilters(def.denominator, def.dataset, 'denominator', errs);
    if (!Array.isArray(def.numerator) || !def.numerator.length) E('numerator', 'ratio_without_numerator', 'a ratio needs a numerator (at least one block)', 'un ratio a besoin d’un numérateur (au moins un bloc)');
    else _validateFilters(def.numerator, def.dataset, 'numerator', errs);
    if (def.filters != null) E('filters', 'not_for_ratio', 'a ratio uses denominator / numerator, not filters', 'un ratio utilise dénominateur / numérateur, pas filtres');
    if (def.unit != null && def.unit !== '%') E('unit', 'ratio_unit', 'a ratio is expressed in %', 'un ratio s’exprime en %');
  } else if (AGGREGATIONS.includes(def.aggregation)) {
    if (def.denominator != null || def.numerator != null) E('numerator', 'ratio_only', 'numerator / denominator are for a ratio', 'numérateur / dénominateur sont réservés au ratio');
    if (def.filters != null) _validateFilters(def.filters, def.dataset, 'filters', errs);
  }
  if (['mean', 'median', 'percentile'].includes(def.aggregation)) {
    if (!ds.value_fields[def.value_field]) E('value_field', 'unknown_value_field', 'pick a numeric field of the dataset', 'choisissez un champ numérique du jeu de données');
  } else if (def.value_field != null) E('value_field', 'not_used', 'a value field is only for mean / median / percentile', 'un champ de valeur est réservé à moyenne / médiane / percentile');
  if (def.aggregation === 'percentile') { if (!(Number.isInteger(def.percentile) && def.percentile >= 1 && def.percentile <= 99)) E('percentile', 'bad_percentile', 'percentile is a whole number 1–99', 'le percentile est un entier de 1 à 99'); }
  else if (def.percentile != null) E('percentile', 'not_used', 'only for a percentile', 'réservé au percentile');
  const w = def.window;
  if (!w || typeof w !== 'object' || !WINDOW_KINDS.includes(w.kind)) E('window', 'bad_window', 'window kind: week, month, quarter or rolling', 'fenêtre : semaine, mois, trimestre ou glissante');
  else {
    for (const k of Object.keys(w)) if (!['kind', 'n'].includes(k)) E(`window.${k}`, 'unknown_param', 'unknown parameter', 'paramètre inconnu');
    if (w.kind === 'rolling' ? !(Number.isInteger(w.n) && w.n >= 1 && w.n <= 730) : w.n != null) E('window.n', 'bad_window_n', 'rolling N = 1–730 days (rolling only)', 'N glissant = 1–730 jours (glissante seulement)');
    if (!ds.date_field) E('window', 'no_date_field', 'this dataset has no date: it is read as of today', 'ce jeu de données n’a pas de date : lu à aujourd’hui');
  }
  if (!UNITS.includes(def.unit)) E('unit', 'bad_unit', 'unknown unit', 'unité inconnue');
  if (!DIRECTIONS.includes(def.direction)) E('direction', 'bad_direction', 'higher_is_better or lower_is_better', 'plus haut ou plus bas est mieux');
  if (!(Number.isInteger(def.rounding) && def.rounding >= 0 && def.rounding <= 3)) E('rounding', 'bad_rounding', 'rounding = 0 to 3 decimals', 'arrondi = 0 à 3 décimales');
  if (!(Number.isInteger(def.min_sample) && def.min_sample >= 0 && def.min_sample <= 100000)) E('min_sample', 'bad_min_sample', 'minimum sample = whole number ≥ 0', 'échantillon minimum = entier ≥ 0');
  _validateRag(def.rag, def.direction, 'rag', errs);
  if (def.target != null && (typeof def.target !== 'object' || !['none', 'kpi_targets'].includes(def.target.link) || Object.keys(def.target).some((k) => k !== 'link'))) E('target', 'bad_target', 'target link: none or kpi_targets', 'lien de cible : aucun ou kpi_targets');
  if (def.null_handling !== 'unknown') E('null_handling', 'null_must_be_unknown', 'a figure with nothing to judge is UNKNOWN — never 0', 'un chiffre sans rien à juger est INCONNU — jamais 0');
  if (def.scope != null) {
    const sc = def.scope;
    if (typeof sc !== 'object' || Object.keys(sc).some((k) => !['group_preset'].includes(k)) || (sc.group_preset != null && typeof sc.group_preset !== 'string')) E('scope', 'bad_scope', 'scope: { group_preset } only (the site is chosen when the figure is read)', 'portée : { group_preset } seulement (le site est choisi à la lecture)');
  }
  return { ok: errs.length === 0, errors: errs };
}

// ── Windows ────────────────────────────────────────────────────────────────────────────────────────────────
const _iso = (d) => d.toISOString().slice(0, 10);
/** windowRange(window, asOf 'YYYY-MM-DD') → { from, to } (inclusive ISO dates, UTC). */
function windowRange(w, asOf) {
  const a = new Date(String(asOf).slice(0, 10) + 'T00:00:00Z');
  const y = a.getUTCFullYear(), m = a.getUTCMonth();
  if (w.kind === 'month') return { from: _iso(new Date(Date.UTC(y, m, 1))), to: _iso(new Date(Date.UTC(y, m + 1, 0))) };
  if (w.kind === 'quarter') { const q = Math.floor(m / 3) * 3; return { from: _iso(new Date(Date.UTC(y, q, 1))), to: _iso(new Date(Date.UTC(y, q + 3, 0))) }; }
  if (w.kind === 'week') { const dow = (a.getUTCDay() + 6) % 7; const mon = new Date(a.getTime() - dow * 86400000); return { from: _iso(mon), to: _iso(new Date(mon.getTime() + 6 * 86400000)) }; }
  return { from: _iso(new Date(a.getTime() - (Number(w.n) - 1) * 86400000)), to: _iso(a) };
}

// ── Evaluation ─────────────────────────────────────────────────────────────────────────────────────────────
const _round = (v, d) => { const k = Math.pow(10, d); return Math.round(v * k) / k; };
function _ragFor(def, value, siteClass) {
  if (!def.rag) return null;
  const t = (def.rag.by_site_class && siteClass && def.rag.by_site_class[siteClass]) || def.rag;
  const g = Number(t.green), a = Number(t.amber);
  if (def.direction === 'lower_is_better') return value <= g ? 'GREEN' : value <= a ? 'AMBER' : 'RED';
  return value >= g ? 'GREEN' : value >= a ? 'AMBER' : 'RED';
}

/**
 * evaluate(def, rows, ctx) — ctx: { from, to (ISO dates; omitted = no window filter), siteClass, target }.
 * → { value, n, numerator_n, comparable, rag, unit, vs_target }. value null = UNKNOWN (nothing to judge).
 * rag: GREEN|AMBER|RED, UNKNOWN (no value), NOT_COMPARABLE (n < min_sample), null (the policy has no RAG).
 * Throws on an invalid definition (call validate first).
 */
function evaluate(def, rows, ctx = {}) {
  const v = validate(def);
  if (!v.ok) { const e = new Error('invalid KPI policy: ' + v.errors.map((x) => x.path + ' ' + x.code).join(', ')); e.code = 'VALIDATION'; e.errors = v.errors; throw e; }
  const ds = DATASETS[def.dataset];
  let list = Array.isArray(rows) ? rows : [];
  if (ds.date_field && (ctx.from || ctx.to)) list = list.filter((r) => { const d = _s(r[ds.date_field]).slice(0, 10); return d && (!ctx.from || d >= ctx.from) && (!ctx.to || d <= ctx.to); });
  let value = null, n = 0, numN = null;
  if (def.aggregation === 'ratio') {
    const den = list.filter((r) => _all(def.denominator, r));
    n = den.length; numN = den.filter((r) => _all(def.numerator, r)).length;
    // same arithmetic as the Helpdesk page (dashboard-shared resolutionSla): round(share × 10^(2+d)) / 10^d
    value = n > 0 ? Math.round((numN / n) * Math.pow(10, 2 + def.rounding)) / Math.pow(10, def.rounding) : null;
  } else {
    const pop = list.filter((r) => _all(def.filters, r));
    if (def.aggregation === 'count') { n = pop.length; value = n; }
    else {
      const f = ds.value_fields[def.value_field];
      const xs = pop.map(f).filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
      n = xs.length;
      if (n) {
        if (def.aggregation === 'mean') value = xs.reduce((s, x) => s + x, 0) / n;
        else { const p = def.aggregation === 'median' ? 50 : def.percentile; const i = (p / 100) * (n - 1), lo = Math.floor(i), hi = Math.ceil(i); value = xs[lo] + (xs[hi] - xs[lo]) * (i - lo); }
        value = _round(value, def.rounding);
      }
    }
  }
  const comparable = value != null && n >= def.min_sample;
  const rag = value == null ? (def.rag ? 'UNKNOWN' : null) : !comparable ? 'NOT_COMPARABLE' : _ragFor(def, value, ctx.siteClass);
  let vs_target = null;
  if (def.target && def.target.link === 'kpi_targets') vs_target = require('./kpiTargets').vsTarget(comparable ? value : null, ctx.target == null ? null : ctx.target, def.direction !== 'lower_is_better');
  return { value, n, numerator_n: numN, comparable, rag, unit: def.unit, vs_target };
}

/** evaluateBy(def, rows, keyFn, ctx) → { [key]: evaluation } (e.g. per site). ctx.siteClassOf(key) optional. */
function evaluateBy(def, rows, keyFn, ctx = {}) {
  const groups = new Map();
  for (const r of rows || []) { const k = keyFn(r); if (k == null) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const out = {};
  for (const [k, g] of groups) out[k] = evaluate(def, g, { ...ctx, siteClass: ctx.siteClassOf ? ctx.siteClassOf(k) : ctx.siteClass, target: ctx.targetOf ? ctx.targetOf(k) : ctx.target });
  return out;
}

// ── Diff ───────────────────────────────────────────────────────────────────────────────────────────────────
function _flatten(o, p, out) {
  if (o !== null && typeof o === 'object' && !Array.isArray(o)) { for (const k of Object.keys(o).sort()) _flatten(o[k], p ? p + '.' + k : k, out); if (!Object.keys(o).length && p) out[p] = '{}'; }
  else out[p] = JSON.stringify(o === undefined ? null : o);
  return out;
}
/** diff(old, new) → [{ path, from, to }] (JSON-encoded values; arrays compared whole). */
function diff(a, b) {
  const A = _flatten(a || {}, '', {}), B = _flatten(b || {}, '', {});
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();
  return keys.filter((k) => A[k] !== B[k]).map((k) => ({ path: k, from: A[k] === undefined ? null : JSON.parse(A[k] === '{}' ? '{}' : A[k]), to: B[k] === undefined ? null : JSON.parse(B[k] === '{}' ? '{}' : B[k]) }));
}

// ── Browser-shape rows (the Helpdesk page reads Zoho column names) → canonical rows ────────────────────────
const _MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const _pad = (x) => String(x).padStart(2, '0');
/** Same parse as dashboard-shared parseZohoDT, returned as a lexically comparable local-time string. */
function _zohoDT(str) {
  if (!str || !String(str).trim()) return null;
  const p = String(str).trim().split(/[\s,]+/); if (p.length < 3) return null;
  const d = parseInt(p[0], 10), m = _MON[p[1]], y = parseInt(p[2], 10);
  if (isNaN(d) || m === undefined || isNaN(y)) return null;
  const tp = (p[3] || '').split(':').map(Number); let h = tp[0] || 0; const mi = tp[1] || 0, sc = tp[2] || 0;
  const suf = (p[4] || '').toUpperCase(); if (suf === 'PM' && h < 12) h += 12; else if (suf === 'AM' && h === 12) h = 0;
  const dt = new Date(y, m, d, h, mi, sc);
  return `${dt.getFullYear()}-${_pad(dt.getMonth() + 1)}-${_pad(dt.getDate())}T${_pad(dt.getHours())}:${_pad(dt.getMinutes())}:${_pad(dt.getSeconds())}`;
}
function fromZohoTicket(r) {
  const ps = _low(r['Request Pending Status']);
  return {
    request_status: r['Request Status'] || '', pending_status: ps ? (ps === 'no' || ps === '0' || ps === 'false' ? 0 : 1) : null,
    overdue_status: r['Overdue Status'], due_by_time: _zohoDT(r['Due By Time'] || r['DueBy Time']),
    resolved_time: _zohoDT(r['Resolved Time']), completed_time: _zohoDT(r['Completed Time']),
    created_time: _zohoDT(r['Created Time']), request_type: r['Request Type'], mode: r['Mode'], category: r['Category'], site: r['Site'], tech_group: r['Group'],
  };
}

// ── The rules in force TODAY, expressed as policies (imported from code — NOT adopted by the committee) ────
const _sla = (rule, extra = {}) => ({
  schema: SCHEMA, dataset: 'helpdesk_tickets', aggregation: 'ratio',
  denominator: [{ block: 'is_closed' }], numerator: [{ block: 'sla_met', rule, ...extra }],
  window: { kind: 'month' }, unit: '%', direction: 'higher_is_better', rounding: 1,
  min_sample: 10,                                              // PO P6: MIN_SLA_RANK_N = 10 closed tickets
  rag: { green: 90, amber: 70 },                               // kpi_rag_policies 'sla-percent' (the registry's policy today)
  target: { link: 'kpi_targets' }, null_handling: 'unknown',
});
const IMPORTED_DEFINITIONS = Object.freeze({
  'helpdesk.resolution_sla_pct': Object.freeze([
    Object.freeze({ title: 'Resolution SLA — flag rule (helpdesk_sla_definition = flag, server default)',
      rationale: 'Imported from current code, not yet adopted by the committee. Stored Overdue Status flag; cancelled closed tickets stay in the denominator and are never missed (dashboard-shared resolutionSla, C-30).',
      definition: _sla('flag', { cancelled_never_missed: true }) }),
    Object.freeze({ title: 'Resolution SLA — due vs resolved (Helpdesk page tile / ranking / trend today)',
      rationale: 'Imported from current code, not yet adopted by the committee. Resolved/completed time vs Due By (flag fallback), cancelled closed tickets in the denominator and never missed (dashboard-shared resolutionSla, HD_SLA_DEFINITION, C-30).',
      definition: _sla('due_vs_resolved') }),
  ]),
});

/**
 * The Helpdesk page helper (dashboard-shared resolutionSla / slaRanking / periodSlaRates) options that reproduce a
 * policy, or null when the policy uses blocks the page helper cannot express (the page then keeps today's rule).
 */
function toResolutionSlaOpts(def) {
  if (!def || !validate(def).ok || def.dataset !== 'helpdesk_tickets' || def.aggregation !== 'ratio' || def.unit !== '%') return null;
  const den = def.denominator, num = def.numerator;
  if (num.length !== 1 || num[0].block !== 'sla_met') return null;
  let excludeCancelled = false;
  if (!(den[0] && den[0].block === 'is_closed')) return null;
  if (den.length === 2) {
    const b = den[1];
    if (!(b.block === 'field_not_in' && b.field === 'request_status' && b.values.length && b.values.every((x) => CANCELLED.has(_low(x))))) return null;
    excludeCancelled = true;
  } else if (den.length !== 1) return null;
  if (num[0].rule === 'flag' && num[0].cancelled_never_missed === false && !excludeCancelled) return null;   // the page's flag rule never misses a cancelled ticket
  return { definition: num[0].rule, excludeCancelled, minN: def.min_sample, rounding: def.rounding };
}

/** Describe the blocks for the builder UI (no functions). */
function catalogue() {
  return {
    schema: SCHEMA, aggregations: AGGREGATIONS, window_kinds: WINDOW_KINDS, units: UNITS, directions: DIRECTIONS, site_classes: SITE_CLASSES, sla_rules: SLA_RULES,
    datasets: Object.fromEntries(Object.entries(DATASETS).map(([k, d]) => [k, { en: d.en, fr: d.fr, date_field: d.date_field, fields: d.fields, value_fields: Object.keys(d.value_fields), special: d.special }])),
    blocks: Object.fromEntries(Object.entries(BLOCKS).map(([k, b]) => [k, { en: b.en, fr: b.fr, params: b.params }])),
  };
}

module.exports = { SCHEMA, AGGREGATIONS, WINDOW_KINDS, UNITS, DIRECTIONS, SITE_CLASSES, DATASETS, BLOCKS, IMPORTED_DEFINITIONS,
  validate, evaluate, evaluateBy, windowRange, diff, fromZohoTicket, toResolutionSlaOpts, catalogue };
