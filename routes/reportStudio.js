'use strict';
const { fail: httpFail } = require('../services/httpError');
// Step 9 — report studio: templates per audience composed of a dashboard definition, generated
// packs (draft → reviewed → published), outputs HTML / PDF / CSV / PPTX / XLSX, AI commentary
// review. Figures always come from services/dashboardData (the dashboard viewer's resolver).
//
//   GET  /api/report-studio/templates                 templates + pickers (dashboards, audiences, AI provider)
//   PUT  /api/report-studio/templates · DELETE /templates/:key                         author
//   POST /api/report-studio/templates/:key/generate   { site_id?, window? } → draft run    author (site editor for a site template)
//   GET  /api/report-studio/runs?template=&status=    · GET /runs/:id (full) · GET /runs/:id.(html|pdf|csv|pptx|xlsx)
//   POST /api/report-studio/runs/:id/review           { status: reviewed|rejected, note, rating 1..5 }   author
//   POST /api/report-studio/runs/:id/publish          reviewed → published                                author
//   PUT  /api/report-studio/runs/:id/commentary       { text } human edit (re-renders)                    author
//   POST /api/report-studio/runs/:id/commentary/regenerate   AI again                                     author
//   GET  /api/report-studio/stats                     rating stats (useful ≥ 4/5), provider
// Author = admin tier OR feature role `report-author`. Readers see published runs of their sites only.

const { generateRun, rerender, SEED_TEMPLATES } = require('../services/reportGenerator');
const { renderCsv, renderPptx } = require('../services/reportPack');
const { generateCommentary } = require('../services/aiCommentary');
const { runLang } = require('../services/reportGenerator');

function createStore(rdbMod) {
  const pg = rdbMod.REPORTS_BACKEND === 'postgres';
  const st = require('../services/reportStore').makeReportStore(({ prepare: (sql) => rdbMod.pgHandle().prepare(sql) }), { isPg: pg });
  
  st.seedAtBoot = async () => {
                                await st.init(); return st.seed(SEED_TEMPLATES);
                              };
  return st;
}

module.exports = function reportStudioRoutes(deps) {
  const { express, requireReportSession, store, dashStore } = deps;
  const router = express.Router(); const json = express.json({ limit: '1mb' });
  const rdb = () => deps.rdb || require('../reports-db');
  const registry = () => deps.registry || require('../services/metricRegistry').current();
  const reportConfig = deps.reportConfig || require('../services/reportConfig');
  const userSites = require('../services/userSites');
  const readerDeps = () => deps.readerDeps || { rdb: rdb(), mdb: require('../meetings-db'), idb: require('../inspection-db'), adb: require('../assets-db'), tracker: require('../tracker-db'), trackerScore: require('../tracker-pptx') };
  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  const isAuthor = (u) => isAdmin(u) || rdb().userHasRole(u, 'report-author');
  const requireAuthor = (req, res, next) => isAuthor(req.reportUser) ? next() : res.status(403).json({ ok: false, error: 'report-author or admin role required' });
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false });
  const log = (req, action, target, details) => { try { rdb().logEvent({ category: 'reports', action, target: String(target), details, ...rdb()._logCtx(req) }); } catch (_) {} };
  const provider = () => deps.aiProvider || 'off';
  async function scope(u) { const all = ((await rdb().listSites({ includeInactive: false })) || []).map(s => ({ id: Number(s.id), name: s.name })); if (isAdmin(u)) return all; const ids = new Set(userSites.siteIds(u).map(Number)); return all.filter(s => ids.has(s.id)); }
  async function baseUrl() { try { return String((await reportConfig.getConfig(rdb().db)).public_base_url || ''); } catch (_) { return ''; } }
  const gate = require('../services/publishGate');
  // G-14 — last successful sync per job (sync_runs); injectable for tests.
  async function lastOkFor(jobs) {
    if (deps.lastSyncOk) return deps.lastSyncOk(jobs);
    return gate.lastOkFromSyncStore(jobs);
  }
  const policyFor = (r) => require('../services/governancePolicy').forContext({ siteId: r && r.site_id != null ? r.site_id : null });
  const sod = (res, action, r, u, pol) => { const c = gate.dutyConflict(action, r, u, pol); if (c) { res.status(403).json({ ok: false, error: c.error, code: c.code }); return true; } return false; };
  async function visibleRun(req, res, { write = false } = {}) {
    const r = await store.getRun(req.params.id); if (!r) { res.status(404).json({ ok: false, error: 'run not found' }); return null; }
    const u = req.reportUser;
    if (write && !isAuthor(u)) { res.status(403).json({ ok: false, error: 'report-author or admin role required' }); return null; }
    if (!isAuthor(u)) { if (r.status !== 'published') { res.status(403).json({ ok: false, error: 'draft runs are visible to authors only' }); return null; } if (r.site_id != null && !userSites.hasSite(u, r.site_id)) { res.status(403).json({ ok: false, error: 'run belongs to another site' }); return null; } }
    return r;
  }

  router.get('/api/report-studio/templates', requireReportSession, async (req, res) => {
    try { const author = isAuthor(req.reportUser); const dashboards = dashStore ? (await dashStore.list({ status: 'published' })).map(d => ({ key: d.key, title: d.title || (d.definition && d.definition.title) || d.key, audience: d.definition && d.definition.audience })) : [];
      res.json({ ok: true, author, provider: provider(), templates: await store.listTemplates({ includeDisabled: author }), dashboards, audiences: store.AUDIENCES, cadences: store.CADENCES, sections: ['headline', 'figures', 'analysis', 'commentary', 'actions'] }); } catch (e) { fail(res, e); }
  });
  router.put('/api/report-studio/templates', requireReportSession, requireAuthor, json, async (req, res) => { try { if (req.body && req.body.dashboard_key && dashStore && !(await dashStore.get(req.body.dashboard_key))) return res.status(400).json({ ok: false, error: 'unknown dashboard_key' }); const t = await store.saveTemplate(req.body, { user: req.reportUser }); log(req, 'report_template_saved', t.key); res.json({ ok: true, template: t }); } catch (e) { fail(res, e); } });
  router.delete('/api/report-studio/templates/:key', requireReportSession, requireAuthor, async (req, res) => { try { await store.removeTemplate(req.params.key); log(req, 'report_template_removed', req.params.key); res.json({ ok: true }); } catch (e) { fail(res, e); } });

  router.post('/api/report-studio/templates/:key/generate', requireReportSession, json, async (req, res) => {
    try {
      const t = await store.getTemplate(req.params.key); if (!t) return res.status(404).json({ ok: false, error: 'template not found' });
      const u = req.reportUser; const sites = await scope(u);
      let site = null; if (req.body && req.body.site_id != null && req.body.site_id !== '') { site = sites.find(s => s.id === Number(req.body.site_id)); if (!site) return res.status(403).json({ ok: false, error: 'site not in your scope' }); }
      if (!isAuthor(u) && !(t.audience === 'site' && site && rdb().userHasRole(u, 'editor'))) return res.status(403).json({ ok: false, error: 'report-author or admin role required (a site editor may generate a site pack for their site)' });
      if (t.audience === 'site' && !site) { site = sites[0] || null; if (!site) return res.status(400).json({ ok: false, error: 'a site template needs a site' }); }
      const d = dashStore ? await dashStore.published(t.dashboard_key) : null; if (!d) return res.status(409).json({ ok: false, error: `dashboard ${t.dashboard_key} has no published version` });
      const lang = req.body && (req.body.lang === 'fr' || req.body.lang === 'en') ? req.body.lang : undefined;
      const sup = req.body && req.body.supersedes_id != null ? Number(req.body.supersedes_id) : null;
      if (sup != null) {
        const old = await store.getRun(sup);
        if (!old || old.status !== 'withdrawn' || old.template_key !== t.key || (old.site_id || null) !== (site ? Number(site.id) : null)) return res.status(409).json({ ok: false, error: 'supersedes_id must name a withdrawn run of the same template and site' });
        const already = (await store.listRuns({ templateKey: t.key, limit: 500 })).some((x) => Number(x.supersedes_id) === sup);
        if (already) return res.status(409).json({ ok: false, error: 'this withdrawn run already has a correction' });
      }
      const run = await generateRun({ template: t, lang, site, sites, window: req.body && req.body.window ? String(req.body.window).slice(0, 24) : null, dashboardDef: d.definition, registry: registry(), deps: readerDeps(), rdb: rdb(), aiProvider: provider(), aiCall: deps.aiCall || null, baseUrl: await baseUrl(), user: u, store });
      if (sup != null) Object.assign(run, await store.setSupersedes(run.id, sup));
      log(req, 'report_generated', run.id, { template: t.key, site: site && site.id, lang: run.analysis && run.analysis.lang, provider: run.provider, verified: run.commentary && run.commentary.verified, supersedes_id: sup });
      res.json({ ok: true, run: { ...run, html: undefined } });
    } catch (e) { fail(res, e); }
  });

  router.get('/api/report-studio/runs', requireReportSession, async (req, res) => {
    try { const u = req.reportUser; const author = isAuthor(u); const ids = author ? null : userSites.siteIds(u).map(Number);
      let rows = await store.listRuns({ templateKey: req.query.template || null, siteIds: ids, status: req.query.status ? String(req.query.status).split(',') : (author ? null : 'published'), limit: req.query.limit });
      res.json({ ok: true, author, runs: rows.map(r => ({ ...r, html: undefined })) }); } catch (e) { fail(res, e); }
  });
  router.get('/api/report-studio/runs/:id.:fmt(html|pdf|csv|pptx|xlsx)', requireReportSession, async (req, res) => {
    try { const r = await visibleRun(req, res); if (!r) return; const t = await store.getTemplate(r.template_key); const name = `${r.template_key}-${r.id}`;
      // G07 — a published run is served from its frozen publication, never from a later re-render
      const pub = r.status === 'published' && store.publication ? await store.publication(r.id) : null;
      if (pub) { r.html = pub.html; if (pub.figures) r.figures = pub.figures; if (pub.analysis) r.analysis = pub.analysis; res.setHeader('X-SDP-Publication-SHA256', pub.html_sha256); }   // every format, not only HTML
      if (req.params.fmt === 'html') return res.type('html').send(r.html || '');
      if (req.params.fmt === 'csv') { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`); return res.send(renderCsv(r)); }
      if (req.params.fmt === 'xlsx') { const { buildWorkbook } = require('../services/tableExcel'); const rows = []; for (const f of r.figures || []) { if (f.series) for (const p of f.series) rows.push({ kind: 'series', metric: f.metric, title: f.title, label: p.label, value: p.value, unit: f.unit }); else if (f.rows) for (const x of f.rows) rows.push({ kind: 'per-site', metric: f.metric, title: f.title, label: x.site, value: x.value, unit: f.unit, rag: x.rag }); else rows.push({ kind: f.open !== undefined ? 'actions' : 'single', metric: f.metric || '', title: f.title, label: f.window || '', value: f.value !== undefined ? f.value : f.open, unit: f.unit || 'count', rag: f.rag || '' }); }
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`); return res.send(buildWorkbook([{ name: 'Figures', rows }, { name: 'Analysis', rows: ((r.analysis && r.analysis.bullets) || []).map((b, i) => ({ n: i + 1, text: b })) }])); }
      if (req.params.fmt === 'pptx') { const sites = await rdb().listSites({ includeInactive: true }); const s = r.site_id != null ? (sites || []).find(x => Number(x.id) === r.site_id) : null; const buf = await renderPptx({ template: { ...t, lang: runLang(t, r) }, run: r, siteName: s ? s.name : null }); res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'); res.setHeader('Content-Disposition', `attachment; filename="${name}.pptx"`); log(req, 'report_export', r.id, { fmt: 'pptx' }); return res.send(buf); }
      const p = await (deps.renderPdf || require('../services/reportRender').renderPdf)(r.html || '', { stamp: name }); if (!p.ok) return res.status(503).json({ ok: false, error: 'PDF unavailable: ' + p.reason, html_available: true }); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`); res.send(p.pdf); } catch (e) { fail(res, e); }
  });
  // (the `.fmt` route is registered BEFORE `/runs/:id` — otherwise `:id` swallows `5.html`)
  router.get('/api/report-studio/runs/:id', requireReportSession, async (req, res) => { try { const r = await visibleRun(req, res); if (!r) return; res.json({ ok: true, run: { ...r, html: undefined }, template: await store.getTemplate(r.template_key) }); } catch (e) { fail(res, e); } });
  async function rerenderRun(r) { const t = await store.getTemplate(r.template_key); const sites = await rdb().listSites({ includeInactive: true }); const s = r.site_id != null ? (sites || []).find(x => Number(x.id) === r.site_id) : null; await store.updateHtml(r.id, rerender({ template: t, run: r, siteName: s ? s.name : null, baseUrl: await baseUrl() })); }
  router.post('/api/report-studio/runs/:id/review', requireReportSession, json, async (req, res) => {
    try { const r = await visibleRun(req, res, { write: true }); if (!r) return; const st = req.body && req.body.status; if (st !== 'reviewed' && st !== 'rejected') return res.status(400).json({ ok: false, error: 'status must be reviewed | rejected' });
      if (r.status !== 'draft' && r.status !== 'rejected') return res.status(409).json({ ok: false, error: `a ${r.status} run cannot be reviewed` });
      if (sod(res, 'review', r, req.reportUser, await policyFor(r))) return;
      const out = await store.setStatus(r.id, st, { user: req.reportUser, note: req.body.note, rating: req.body.rating }); await rerenderRun(out); log(req, 'report_reviewed', r.id, { status: st, rating: out.rating }); res.json({ ok: true, run: { ...out, html: undefined } }); } catch (e) { fail(res, e); }
  });
  router.post('/api/report-studio/runs/:id/publish', requireReportSession, json, async (req, res) => {
    try { const r = await visibleRun(req, res, { write: true }); if (!r) return; if (r.status !== 'reviewed') return res.status(409).json({ ok: false, error: 'a run must be reviewed by a human before publication' });
      const pol = await policyFor(r);
      if (sod(res, 'publish', r, req.reportUser, pol)) return;
      // G-14 — a stale or never-synced source blocks publication; an admin may override with a written reason.
      // Switch, limits, override and reason length are governance policies (services/governancePolicy).
      const mods = gate.modulesOf(r, registry()); const fr = gate.freshness(mods, await lastOkFor(gate.jobsFor(mods)), Date.now(), pol);
      let override = null;
      const fd = gate.reportFreshnessDecision(fr, { isAdmin: isAdmin(req.reportUser), reason: req.body && req.body.override_reason, policy: pol });
      if (!fd.allow) return res.status(fd.status).json({ ok: false, error: fd.error, message: fd.message, sources: fr.sources.filter(x => x.state !== 'FRESH') });
      if (fd.override) {
        override = { by: req.reportUser.id, at: new Date().toISOString(), reason: fd.override.reason, sources: fr.sources.filter(x => x.state !== 'FRESH') };
        try { rdb().logEvent({ category: 'reports', action: 'report_publish_override', target: String(r.id), details: override, risk: 1, ...rdb()._logCtx(req) }); } catch (_) {}
      }
      const out = await store.setStatus(r.id, 'published', { user: req.reportUser, override }); await rerenderRun(out);
      // G07 — freeze what was released (exact HTML + figures, SHA-256) in the append-only publications table
      let sha = null;
      try { sha = store.recordPublication ? await store.recordPublication(await store.getRun(r.id), { override }) : null; }
      catch (e) { await store.setStatus(r.id, 'reviewed', { user: { id: r.reviewed_by }, note: r.review_note }); throw e; }   // never a published run without its frozen record
      log(req, 'report_published', r.id, { override: !!override, html_sha256: sha });
      if (deps.engStore) { for (const s of await deps.engStore.subscribersOf('report_template', r.template_key)) await deps.engStore.notify({ userId: s.user_id, kind: 'report', title: `Report published: ${r.template_key}`, body: out.analysis && out.analysis.headline, link: `${await baseUrl()}/report-studio.html?run=${r.id}`, sourceKind: 'report_run', sourceRef: r.id }); }
      res.json({ ok: true, run: { ...out, html: undefined } }); } catch (e) { fail(res, e); }
  });
  router.put('/api/report-studio/runs/:id/commentary', requireReportSession, json, async (req, res) => {
    try { const r = await visibleRun(req, res, { write: true }); if (!r) return; if (r.status === 'published' || r.status === 'withdrawn') return res.status(409).json({ ok: false, error: `${r.status} run is frozen` }); const text = String(req.body && req.body.text || '').slice(0, 8000);
      let out = await store.updateCommentary(r.id, { ...(r.commentary || {}), text, source: 'human', edited_by: req.reportUser.id, edited_at: new Date().toISOString(), verified: true, offending: [] });
      if (r.status === 'reviewed') out = await store.setStatus(r.id, 'draft', { user: req.reportUser });   // G-13 — an edit after review voids the review
      await rerenderRun(out); log(req, 'report_commentary_edited', r.id); res.json({ ok: true, run: { ...out, html: undefined } }); } catch (e) { fail(res, e); }
  });
  router.post('/api/report-studio/runs/:id/commentary/regenerate', requireReportSession, async (req, res) => {
    try { const r = await visibleRun(req, res, { write: true }); if (!r) return; if (r.status === 'published' || r.status === 'withdrawn') return res.status(409).json({ ok: false, error: `${r.status} run is frozen` }); const t = await store.getTemplate(r.template_key);
      const c = await generateCommentary({ analysis: { ...(r.analysis || {}), figures: r.figures || [] }, audience: t.audience, lang: runLang(t, r), provider: provider(), aiCall: deps.aiCall || null }); let out = await store.updateCommentary(r.id, c); if (r.status === 'reviewed') out = await store.setStatus(r.id, 'draft', { user: req.reportUser }); await rerenderRun(out); log(req, 'report_commentary_regenerated', r.id, { source: c.source, verified: c.verified }); res.json({ ok: true, commentary: c }); } catch (e) { fail(res, e); }
  });
  // G-13 — take a published run back (admin, reason required). Readers and share links stop seeing it; a corrected
  // version is a new run (generate → review → publish), so the withdrawn one stays as the audit record.
  router.post('/api/report-studio/runs/:id/withdraw', requireReportSession, json, async (req, res) => {
    try { if (!isAdmin(req.reportUser)) return res.status(403).json({ ok: false, error: 'admin role required' });
      const r = await visibleRun(req, res, { write: true }); if (!r) return; if (r.status !== 'published') return res.status(409).json({ ok: false, error: 'only a published run can be withdrawn' });
      const reason = String((req.body && req.body.reason) || '').trim(); const wErr = gate.withdrawReasonError(reason, await policyFor(r)); if (wErr) return res.status(400).json({ ok: false, error: wErr });
      const out = await store.setStatus(r.id, 'withdrawn', { user: req.reportUser, note: reason }); await rerenderRun(out); log(req, 'report_withdrawn', r.id, { reason });
      res.json({ ok: true, run: { ...out, html: undefined } }); } catch (e) { fail(res, e); }
  });
  router.get('/api/report-studio/stats', requireReportSession, requireAuthor, async (req, res) => { try { res.json({ ok: true, provider: provider(), ...(await store.ratingStats()) }); } catch (e) { fail(res, e); } });
  return router;
};
module.exports.createStore = createStore;
