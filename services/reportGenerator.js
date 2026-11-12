'use strict';
// Step 9 — orchestration of one report generation: dashboard definition → the SAME widget
// resolver as the viewer (services/dashboardData) → deterministic analysis → optional AI commentary
// → HTML pack → a draft run (version log). Zero manual entry; zero figure deviation by construction
// (the figures are the dashboard's). Cadence runs go through the shared job runner.

const { resolveWidgets } = require('./dashboardData');
const { analyse } = require('./reportAnalysis');
const { generateCommentary } = require('./aiCommentary');
const { renderHtml } = require('./reportPack');
const gate = require('./publishGate');

/** Source states behind a definition's metrics (module, job, last_success, state). Never throws: unreadable → UNKNOWN. */
async function sourceStates(o, now) {
  const reg = o.registry; const def = o.dashboardDef;
  const mods = [...new Set(((def && def.widgets) || []).flatMap((w) => (w ? [w.metric].concat(Array.isArray(w.series) ? w.series : [], Array.isArray(w.metrics) ? w.metrics : []) : [])).map((k) => k && reg && reg.get && reg.get(k)).filter(Boolean).map((m) => m.module))].sort();
  const jobs = gate.jobsFor(mods);
  if (!jobs.length) return [];
  let lastOk = {};
  try { lastOk = await (o.lastSyncOk || gate.lastOkFromSyncStore)(jobs); } catch (_) { lastOk = {}; }
  let pol = null;
  try { pol = o.policy !== undefined ? o.policy : await require('./governancePolicy').forContext({}); } catch (_) { pol = null; }
  return gate.freshness(mods, lastOk, now.getTime(), pol).sources.map((x) => ({ module: x.module, job: x.job, last_success: x.last_ok, state: x.state }));
}
/** ui_kpi_sample_size (E-K02) — "n = …" in the pack follows the same switch as the screen. */
async function sampleSizeOn(o) {
  if (o.sampleSize != null) return !!o.sampleSize;
  try { const c = await require('./reportConfig').getConfig(o.rdb && o.rdb.db); return String(c.ui_kpi_sample_size) === '1'; } catch (_) { return false; }
}

/**
 * @param {object} o { template, site:{id,name}|null, sites:[{id,name}] (scope for fleet widgets), window, dashboardDef, registry, deps, rdb, aiProvider, aiCall, baseUrl, user, store, now }
 * @returns {Promise<run>} the stored draft run (full)
 */
async function generateRun(o) {
  const now = o.now || new Date();
  const siteId = o.site ? Number(o.site.id) : (o.sites && o.sites[0] ? Number(o.sites[0].id) : null);
  const widgets = await resolveWidgets({ def: o.dashboardDef, sites: o.sites || (o.site ? [o.site] : []), site: siteId, window: o.window || null, reg: o.registry, dd: o.deps, rdb: o.rdb, now });
  // F-DATA-04 — same freshness rule as the dashboard route (G05): a stale or never-synced source keeps its
  // number and loses its colour BEFORE the analysis reads it, and the run records the source states.
  const sources = await sourceStates(o, now);
  gate.degradeStale(widgets, o.dashboardDef, o.registry, sources.filter((x) => x.state !== 'FRESH'));
  const lang = o.lang === 'fr' || o.lang === 'en' ? o.lang : o.template.lang; // chosen at generation, template default otherwise
  const tpl = { ...o.template, lang };
  const analysis = analyse({ widgets, def: o.dashboardDef, audience: o.template.audience, lang, siteName: o.site ? o.site.name : null, window: o.window || null, registry: o.registry });
  const prov = o.template.ai_enabled === false ? 'off' : (o.aiProvider || 'off');
  // E-B08 — only consulted when a model would be called (provider on); null = switch off = today
  const staleSources = (o.aiCall && prov !== 'off') ? await (o.staleSources || ((figs) => require('./aiStaleGate').staleSourcesFor({ figures: figs, registry: o.registry, siteId, runRef: o.template.key })))(analysis.figures, siteId) : null;
  const commentary = await generateCommentary({ analysis, audience: o.template.audience, lang, provider: prov, aiCall: o.aiCall, now, staleSources });
  const pending = { template_key: o.template.key, site_id: siteId, window_label: o.window || null, status: 'draft', figures: analysis.figures, analysis: { ...analysis, figures: undefined, sources, show_n: await sampleSizeOn(o) }, commentary, created_at: now.toISOString() };
  const html = renderHtml({ template: tpl, run: pending, siteName: o.site ? o.site.name : null, baseUrl: o.baseUrl || '' });
  return o.store.createRun({ templateKey: o.template.key, siteId, windowLabel: o.window || null, figures: analysis.figures, analysis: pending.analysis, commentary, html, provider: commentary.source === 'ai' ? commentary.provider : 'deterministic', deviation: 0, user: o.user });
}

/** Re-render the HTML of an existing run (after a commentary edit or a status change). */
function runLang(template, run) { const l = run && run.analysis && run.analysis.lang; return l === 'fr' || l === 'en' ? l : (template.lang === 'fr' ? 'fr' : 'en'); }
function rerender({ template, run, siteName, baseUrl }) { return renderHtml({ template: { ...template, lang: runLang(template, run) }, run, siteName, baseUrl }); }

/** Shipped templates (arbitration 2: site weekly, executive monthly, council). */
const SEED_TEMPLATES = [
  { key: 'site-weekly-pack', name: 'Site weekly pack', audience: 'site', dashboard_key: 'site-weekly', lang: 'en', cadence: 'weekly', sections: ['headline', 'figures', 'analysis', 'commentary', 'actions'] },
  { key: 'exec-monthly-pack', name: 'Executive monthly pack', audience: 'executive', dashboard_key: 'exec-home', lang: 'en', cadence: 'monthly', sections: ['headline', 'figures', 'analysis', 'commentary'] },
  { key: 'council-pack', name: 'Mine IT Council pack', audience: 'council', dashboard_key: 'governance', lang: 'fr', cadence: 'monthly', sections: ['headline', 'figures', 'analysis', 'commentary', 'actions'] },
];

module.exports = { sourceStates, runLang, generateRun, rerender, SEED_TEMPLATES };
