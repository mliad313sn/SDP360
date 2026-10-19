'use strict';
// Step 9 — orchestration of one report generation: dashboard definition → the SAME widget
// resolver as the viewer (services/dashboardData) → deterministic analysis → optional AI commentary
// → HTML pack → a draft run (version log). Zero manual entry; zero figure deviation by construction
// (the figures are the dashboard's). Cadence runs go through the shared job runner.

const { resolveWidgets } = require('./dashboardData');
const { analyse } = require('./reportAnalysis');
const { generateCommentary } = require('./aiCommentary');
const { renderHtml } = require('./reportPack');

/**
 * @param {object} o { template, site:{id,name}|null, sites:[{id,name}] (scope for fleet widgets), window, dashboardDef, registry, deps, rdb, aiProvider, aiCall, baseUrl, user, store, now }
 * @returns {Promise<run>} the stored draft run (full)
 */
async function generateRun(o) {
  const now = o.now || new Date();
  const siteId = o.site ? Number(o.site.id) : (o.sites && o.sites[0] ? Number(o.sites[0].id) : null);
  const widgets = await resolveWidgets({ def: o.dashboardDef, sites: o.sites || (o.site ? [o.site] : []), site: siteId, window: o.window || null, reg: o.registry, dd: o.deps, rdb: o.rdb, now });
  const analysis = analyse({ widgets, def: o.dashboardDef, audience: o.template.audience, lang: o.template.lang, siteName: o.site ? o.site.name : null, window: o.window || null, registry: o.registry });
  const commentary = await generateCommentary({ analysis, audience: o.template.audience, lang: o.template.lang, provider: o.template.ai_enabled === false ? 'off' : (o.aiProvider || 'off'), aiCall: o.aiCall, now });
  const pending = { template_key: o.template.key, site_id: siteId, window_label: o.window || null, status: 'draft', figures: analysis.figures, analysis: { ...analysis, figures: undefined }, commentary, created_at: now.toISOString() };
  const html = renderHtml({ template: o.template, run: pending, siteName: o.site ? o.site.name : null, baseUrl: o.baseUrl || '' });
  return o.store.createRun({ templateKey: o.template.key, siteId, windowLabel: o.window || null, figures: analysis.figures, analysis: pending.analysis, commentary, html, provider: commentary.source === 'ai' ? commentary.provider : 'deterministic', deviation: 0, user: o.user });
}

/** Re-render the HTML of an existing run (after a commentary edit or a status change). */
function rerender({ template, run, siteName, baseUrl }) { return renderHtml({ template, run, siteName, baseUrl }); }

/** Shipped templates (arbitration 2: site weekly, executive monthly, council). */
const SEED_TEMPLATES = [
  { key: 'site-weekly-pack', name: 'Site weekly pack', audience: 'site', dashboard_key: 'site-weekly', lang: 'en', cadence: 'weekly', sections: ['headline', 'figures', 'analysis', 'commentary', 'actions'] },
  { key: 'exec-monthly-pack', name: 'Executive monthly pack', audience: 'executive', dashboard_key: 'exec-home', lang: 'en', cadence: 'monthly', sections: ['headline', 'figures', 'analysis', 'commentary'] },
  { key: 'council-pack', name: 'Mine IT Council pack', audience: 'council', dashboard_key: 'governance', lang: 'fr', cadence: 'monthly', sections: ['headline', 'figures', 'analysis', 'commentary', 'actions'] },
];

module.exports = { generateRun, rerender, SEED_TEMPLATES };
