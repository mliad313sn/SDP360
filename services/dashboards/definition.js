'use strict';
// Step 6 (lot 6.4) — the dashboard DEFINITION: what a composed dashboard is allowed to contain.
//
// A definition is data, never code: KPI dictionary keys, a layout (12-column spans, in order), an
// audience and a little Markdown text. No formula, no SQL, no HTML — the server computes every figure
// from the dictionary (services/metrics) and applies the viewer's site scope itself, so a definition
// cannot widen anyone's access. validate() is the single gate used by every write route.
const registry = require('../metrics/registry');

const WIDGETS = {
  kpi:       { label: { fr: 'KPI', en: 'KPI' },                         metrics: [1, 8], span: 12, grains: false },
  trend:     { label: { fr: 'Tendance', en: 'Trend' },                  metrics: [1, 3], span: 6,  grains: true },
  bars:      { label: { fr: 'Barres par site', en: 'Bars by site' },    metrics: [1, 1], span: 6,  grains: false },
  table:     { label: { fr: 'Table par site', en: 'Table by site' },    metrics: [1, 6], span: 12, grains: false },
  heatmap:   { label: { fr: 'Heatmap site × mois', en: 'Site × month heatmap' }, metrics: [1, 1], span: 12, grains: false },
  'rag-grid':{ label: { fr: 'Grille RAG', en: 'RAG grid' },             metrics: [1, 8], span: 12, grains: false },
  tracker:   { label: { fr: 'Tracker (piliers)', en: 'Tracker (pillars)' }, metrics: [0, 0], span: 6, grains: false },
  text:      { label: { fr: 'Texte', en: 'Text' },                      metrics: [0, 0], span: 12, grains: false },
  actions:   { label: { fr: 'Actions en retard', en: 'Overdue actions' }, metrics: [0, 0], span: 6, grains: false },
  events:    { label: { fr: 'Incidents / décisions', en: 'Incidents / decisions' }, metrics: [0, 0], span: 6, grains: false },
};
const EVENT_SOURCES = ['incidents', 'decisions'];
// Roles a definition may target ('any' = every signed-in person). Feature roles included.
const AUDIENCE_ROLES = ['any', 'viewer', 'editor', 'admin', 'executive', 'super_admin', 'scorecard-viewer',
  'group-business', 'site-business', 'tracker-editor', 'tracker-admin', 'report-author'];
const ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
const MAX_WIDGETS = 40, MAX_MARKDOWN = 2000, MAX_TITLE = 120;

const str = (v) => (typeof v === 'string' ? v.trim() : '');
function servedKeys() { return new Set(registry.list().filter(m => m.serve).map(m => m.key)); }

/** Normalises and validates. Returns { ok, errors[], definition } — definition only when ok. */
function validate(input) {
  const errors = [];
  const d = input && typeof input === 'object' ? input : {};
  const out = {};
  out.id = str(d.id).toLowerCase();
  if (!ID_RE.test(out.id)) errors.push('id: 2-48 lowercase letters, digits or dashes');
  const t = d.title && typeof d.title === 'object' ? d.title : { fr: d.title, en: d.title };
  out.title = { fr: str(t.fr).slice(0, MAX_TITLE), en: str(t.en || t.fr).slice(0, MAX_TITLE) };
  if (!out.title.fr) errors.push('title: a French title is required');
  out.description = str(d.description).slice(0, 400);

  const a = d.audience && typeof d.audience === 'object' ? d.audience : {};
  out.audience = {
    roles: [...new Set((Array.isArray(a.roles) ? a.roles : []).map(str))],
    site_scope: a.site_scope === 'own' ? 'own' : 'all',
  };
  if (!out.audience.roles.length) errors.push('audience.roles: at least one role');
  for (const r of out.audience.roles) if (!AUDIENCE_ROLES.includes(r)) errors.push(`audience.roles: unknown role "${r}"`);

  out.density = d.density === 'compact' ? 'compact' : 'comfort';
  out.filters = { site: d.filters ? d.filters.site !== false : true, month: d.filters ? d.filters.month !== false : true };

  const served = servedKeys();
  const ws = Array.isArray(d.widgets) ? d.widgets : [];
  if (!ws.length) errors.push('widgets: at least one widget');
  if (ws.length > MAX_WIDGETS) errors.push(`widgets: at most ${MAX_WIDGETS}`);
  const ids = new Set();
  out.widgets = ws.slice(0, MAX_WIDGETS).map((w, i) => {
    const where = `widgets[${i}]`;
    const spec = WIDGETS[w && w.type];
    if (!spec) { errors.push(`${where}.type: unknown widget "${w && w.type}"`); return null; }
    const o = { id: str(w.id) || `w${i + 1}`, type: w.type };
    if (ids.has(o.id)) errors.push(`${where}.id: duplicate "${o.id}"`); ids.add(o.id);
    const span = Number(w.span == null ? spec.span : w.span);
    o.span = Number.isInteger(span) && span >= 1 && span <= 12 ? span : spec.span;
    const tt = w.title && typeof w.title === 'object' ? w.title : { fr: w.title, en: w.title };
    o.title = { fr: str(tt.fr).slice(0, MAX_TITLE), en: str(tt.en || tt.fr).slice(0, MAX_TITLE) };
    const [lo, hi] = spec.metrics;
    if (hi > 0) {
      const ms = [...new Set((Array.isArray(w.metrics) ? w.metrics : (w.metric ? [w.metric] : [])).map(str))];
      if (ms.length < lo || ms.length > hi) errors.push(`${where}.metrics: ${lo} to ${hi} dictionary keys`);
      for (const k of ms) if (!served.has(k)) errors.push(`${where}.metrics: "${k}" is not a served dictionary key`);
      o.metrics = ms;
    }
    if (spec.grains) {
      o.grain = w.grain === 'month' ? 'month' : 'week';
      const p = Number(w.points == null ? 13 : w.points);
      o.points = Number.isInteger(p) && p >= 2 && p <= 26 ? p : 13;
    }
    if (w.type === 'heatmap') { const p = Number(w.points == null ? 6 : w.points); o.points = Number.isInteger(p) && p >= 2 && p <= 12 ? p : 6; }
    if (w.type === 'text') {
      o.markdown = typeof w.markdown === 'string' ? w.markdown : '';
      if (o.markdown.length > MAX_MARKDOWN) errors.push(`${where}.markdown: at most ${MAX_MARKDOWN} characters`);
      if (/<[a-z!/]/i.test(o.markdown)) errors.push(`${where}.markdown: HTML is not allowed (Markdown only)`);
      o.markdown = o.markdown.slice(0, MAX_MARKDOWN);
    }
    if (w.type === 'events') {
      o.source = EVENT_SOURCES.includes(w.source) ? w.source : null;
      if (!o.source) errors.push(`${where}.source: incidents or decisions`);
    }
    if (w.type === 'kpi') o.compare = w.compare === false ? false : 'previous';
    return o;
  }).filter(Boolean);

  return errors.length ? { ok: false, errors } : { ok: true, errors: [], definition: out };
}

/** May this person see a definition published for this audience? */
function audienceAllows(def, user, hasRole) {
  if (!user) return false;
  if (hasRole(user, 'super_admin')) return true;
  return def.audience.roles.some(r => r === 'any' || hasRole(user, r));
}

module.exports = { WIDGETS, EVENT_SOURCES, AUDIENCE_ROLES, validate, audienceAllows, ID_RE };
