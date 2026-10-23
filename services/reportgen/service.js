'use strict';
// Step 9 — generation of a report RUN from a template: figures (the dashboard resolver, one viewer context), the
// deterministic analysis, the AI draft per commentary section when the template asks for it and the server allows it
// (rejected on any unknown number), then the HTML. The run is a DRAFT until a reviewer approves it.

const tdef = require('./definition');
const { resolveAll } = require('../dashboards/data');
const { analyse } = require('./analysis');
const ai = require('./ai');
const render = require('./render');
const store = require('./store');
const live = require('../metrics/liveDeps');

/** Context of a run: the whole group, or one site (by its code). */
async function contextFor(rdb, month, siteCode) {
  const sites = await live.groupSites(rdb);
  const site = siteCode ? sites.find(s => s.code === siteCode) || null : null;
  if (siteCode && !site) throw Object.assign(new Error('unknown site code'), { status: 404 });
  const today = new Date().toISOString().slice(0, 10);
  const last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
  return { scope: site ? 'site' : 'group', site, sites, month, asOf: last < today ? last : today, targets: await live.targets(rdb) };
}

/** Commentary texts (one string per commentary section) from the analysis and the accepted AI drafts. */
function commentaryText(analysis, drafts) {
  const out = {};
  for (const [id, lines] of Object.entries(analysis.commentary || {})) {
    const d = drafts && drafts[id];
    out[id] = d && d.accepted && d.text ? d.text : lines.join('\n');
  }
  return out;
}

/**
 * @param x { template (validated definition), version, month, site_code, by, deps: { metrics, readers }, ai: { disabled, call, provider } }
 */
async function generate(rdb, x) {
  const t = x.template;
  const ctx = await contextFor(rdb, x.month, t.audience.site_scope === 'own' ? x.site_code : (x.site_code || null));
  const data = await resolveAll(tdef.asDashboard(t), ctx, x.deps);
  const analysis = analyse(t, data, { lang: t.language, tone: t.tone });
  let drafts = null;
  if (t.ai) {
    drafts = {};
    for (const [id, facts] of Object.entries(analysis.sectionFacts)) {
      if (!facts.length) continue;
      drafts[id] = await ai.draft(facts, { lang: t.language, tone: t.tone, month: x.month, scope: ctx.site ? ctx.site.name : 'group' }, x.ai);
    }
  }
  const commentary = commentaryText(analysis, drafts);
  const runMeta = { month: x.month, status: 'draft', created_at: new Date().toISOString(), scope_label: ctx.site ? ctx.site.name : (t.language === 'en' ? 'Whole group' : 'Ensemble du groupe') };
  const html = render.html(t, runMeta, data, commentary);
  const aiSummary = drafts ? { sections: drafts, accepted: Object.values(drafts).some(d => d.accepted), skipped: Object.values(drafts).find(d => d.skipped) ? Object.values(drafts).find(d => d.skipped).skipped : undefined,
    unknown: [].concat(...Object.values(drafts).map(d => d.unknown || [])) } : null;
  return store.createRun({ template_id: t.id, template_version: x.version, month: x.month, site_code: ctx.site ? ctx.site.code : null, data, analysis: { facts: analysis.facts, commentary: analysis.commentary }, ai: aiSummary, commentary, html }, x.by);
}

/** Re-render a run's HTML after an edit or an approval (figures never change). */
async function rerender(run, template, status, approval) {
  const meta = { month: run.month, status, created_at: run.created_at, scope_label: run.site_code ? run.site_code : (template.language === 'en' ? 'Whole group' : 'Ensemble du groupe'), ...approval };
  return render.html(template, meta, run.data, run.commentary);
}

module.exports = { generate, rerender, contextFor, commentaryText };
