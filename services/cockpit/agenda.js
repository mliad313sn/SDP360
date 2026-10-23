'use strict';
// Step 8 — the AGENDA of a meeting, generated from its cadence: the figure sections (indicators, major incidents,
// pending decisions, late actions) are dashboard widgets computed by services/dashboards/data.js — the same
// numbers as every screen —, the cockpit sections come from the cockpit and portfolio stores. The result is frozen
// in the session when the meeting starts, so the minutes quote what the room saw.

const dashDef = require('../dashboards/definition');
const { resolveAll } = require('../dashboards/data');
const store = require('./store');
const pstore = require('../portfolio/store');
const analysis = require('../portfolio/analysis');
const { SECTIONS } = require('./definition');

const WIDGET = {
  kpi: (s) => ({ id: s.id, type: 'kpi', title: s.title, metrics: s.metrics, compare: true, span: 12 }),
  incidents: (s) => ({ id: s.id, type: 'events', source: 'incidents', title: s.title, span: 12 }),
  decisions: (s) => ({ id: s.id, type: 'events', source: 'decisions', title: s.title, span: 12 }),
  actions: (s) => ({ id: s.id, type: 'actions', title: s.title, span: 12 }),
};

/** ctx for the cadence: its site (scope 'site') or the whole group. */
function contextFor(cadence, heldOn, live) {
  const site = cadence.site_id ? (live.sites || []).find(s => s.site_id === cadence.site_id) || null : null;
  const month = heldOn.slice(0, 7);
  const last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
  return { scope: site ? 'site' : 'group', site, sites: live.sites, month, asOf: heldOn < last ? heldOn : last, targets: live.targets };
}

/**
 * @param cadence  validated cadence definition
 * @param heldOn   'YYYY-MM-DD'
 * @param deps     { sites, targets, metrics, readers }
 */
async function build(cadence, heldOn, deps) {
  const ctx = contextFor(cadence, heldOn, deps);
  const widgets = cadence.agenda.filter(s => WIDGET[s.kind]).map(s => WIDGET[s.kind](s));
  let data = { widgets: {} };
  if (widgets.length) {
    const v = dashDef.validate({ id: 'agenda-' + cadence.id, title: cadence.title, audience: { roles: ['any'], site_scope: ctx.site ? 'own' : 'all' }, widgets });
    data = v.ok ? await resolveAll(v.definition, ctx, { metrics: deps.metrics, readers: deps.readers })
      : { widgets: Object.fromEntries(widgets.map(w => [w.id, { error: v.errors.join(' ; ') }])) };
  }
  const sections = [];
  for (const s of cadence.agenda) {
    const base = { id: s.id, kind: s.kind, title: s.title || SECTIONS[s.kind].label, minutes: s.minutes || 0 };
    try {
      if (WIDGET[s.kind]) sections.push({ ...base, widget: WIDGET[s.kind](s), data: data.widgets[s.id] || null });
      else if (s.kind === 'followup') {
        const open = await store.listActions({ cadence_id: cadence.id, status: 'open' });
        sections.push({ ...base, actions: open.map(a => ({ id: a.id, title: a.title, owner: a.owner, due_date: a.due_date, source_kind: a.source_kind, source_ref: a.source_ref, late: !!(a.due_date && a.due_date < heldOn) })) });
      } else if (s.kind === 'rfis') {
        const pending = (await store.listRfis()).filter(r => ['new', 'triage', 'scored'].includes(r.status));
        sections.push({ ...base, rfis: pending.map(r => ({ id: r.id, title: r.title, category: r.category, status: r.status, score: r.score == null ? null : Number(r.score), submitted_at: r.submitted_at })) });
      } else if (s.kind === 'portfolio') {
        const nodes = await pstore.list();
        const watch = nodes.filter(n => ['project', 'milestone', 'deliverable'].includes(n.kind))
          .map(n => ({ n, st: analysis.effectiveStatus(n, heldOn) })).filter(x => x.st === 'late' || x.st === 'at_risk')
          .slice(0, 25).map(x => ({ id: x.n.id, kind: x.n.kind, title: x.n.title, owner: x.n.owner, due_date: x.n.due_date, status: x.st, drift_days: analysis.drift(x.n) }));
        sections.push({ ...base, nodes: watch });
      } else sections.push({ ...base, text: s.text || '' });
    } catch (e) { sections.push({ ...base, error: 'Cette section n’a pas pu être préparée : ' + String(e.message || e).slice(0, 160) }); }
  }
  return { generated_at: new Date().toISOString(), held_on: heldOn, month: ctx.month, scope: ctx.scope, site: ctx.site ? { code: ctx.site.code, name: ctx.site.name } : null, sections };
}

module.exports = { build, contextFor };
