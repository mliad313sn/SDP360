'use strict';
// Step 9 — a REPORT TEMPLATE: an audience, a scope (the group or one site), a language, a tone, and sections. A section
// is either a dashboard widget (validated by services/dashboards/definition.js — same keys, same figures as every
// screen) or a COMMENTARY: the written analysis of the figures above it, deterministic by default, optionally drafted
// by the AI from the canonical figures only (services/reportgen/ai.js), always reviewed by a person before release.

const dash = require('../dashboards/definition');

const TONES = { direction: 'Direction (synthèse, décisions)', coordinateur: 'Coordinateur de site (actions)', technicien: 'Équipe technique (détail)' };
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

function validate(input) {
  const d = input && typeof input === 'object' ? input : {};
  const errors = [], warnings = [];
  const sections = Array.isArray(d.sections) ? d.sections.slice(0, 30) : [];
  const widgets = sections.filter(s => s && s.type !== 'commentary');
  // Widgets: the dashboard validator, with the report's id / title / audience.
  const v = dash.validate({ id: d.id, title: d.title, description: d.description, audience: d.audience || { roles: ['any'] }, density: 'compact',
    widgets: widgets.length ? widgets : [{ type: 'text', markdown: '—' }] });
  errors.push(...v.errors);
  const out = { id: v.definition.id, title: v.definition.title, description: v.definition.description, audience: v.definition.audience };
  out.language = d.language === 'en' ? 'en' : 'fr';
  out.tone = TONES[d.tone] ? d.tone : 'direction';
  out.ai = !!d.ai;
  let wi = 0;
  out.sections = sections.map((s, i) => {
    if (s && s.type === 'commentary') {
      const title = str(s.title, 120) || (out.language === 'en' ? 'Analysis' : 'Analyse');
      if (/[<>]/.test(title)) errors.push(`sections[${i}].title: HTML is not allowed`);
      return { id: 'c' + (i + 1), type: 'commentary', title };
    }
    return widgets.length ? v.definition.widgets[wi++] : null;
  }).filter(Boolean);
  if (!out.sections.some(s => s.type !== 'commentary')) errors.push('sections: at least one figure section');
  if (!out.sections.some(s => s.type === 'commentary')) warnings.push('no commentary section: the report will carry figures only');
  return { ok: errors.length === 0, errors, warnings, definition: out };
}

/** The dashboard definition of a template (its figure sections), for the data resolver and the renderer. */
function asDashboard(t) {
  return { id: t.id, title: t.title, description: t.description, audience: t.audience, density: 'compact', widgets: t.sections.filter(s => s.type !== 'commentary') };
}

module.exports = { validate, asDashboard, TONES };
