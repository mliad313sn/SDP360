'use strict';
// ---------------------------------------------------------------------------
// Step 9 (SDP-DASH-2.0) — report generator.
//
//   GET  /api/reportgen/templates                     templates this person may read (+ drafts for authors)
//   GET  /api/reportgen/templates/:id
//   POST /api/reportgen/templates                     create a template draft                     (report-author)
//   PUT  /api/reportgen/templates/:id/draft            save the draft                              (report-author)
//   POST /api/reportgen/templates/:id/publish          publish the draft                           (report-author)
//   POST /api/reportgen/runs                           generate a DRAFT report {template_id, month, site} (report-author)
//   GET  /api/reportgen/runs?template=                 runs (drafts: authors and reviewers only)
//   GET  /api/reportgen/runs/:id                       figures, analysis, AI draft, commentary, journal
//   PUT  /api/reportgen/runs/:id/commentary            edit the commentary of a draft              (report-author)
//   POST /api/reportgen/runs/:id/approve               release the report                          (report-reviewer)
//   POST /api/reportgen/runs/:id/share                 signed link, expiring {days}                (report-reviewer)
//   GET  /api/reportgen/runs/:id/output.html|pdf|pptx|csv
//
// System templates (monthly executive pack, monthly site review) are seeded once and edited by a super_admin. A
// report is never released without a person's approval; the AI draft is used only if its numbers all exist in the
// figures, otherwise the deterministic commentary stays.
// ---------------------------------------------------------------------------
const tdef = require('../services/reportgen/definition');
const store = require('../services/reportgen/store');
const service = require('../services/reportgen/service');
const render = require('../services/reportgen/render');
const { SYSTEM } = require('../services/reportgen/seed');
const { audienceAllows } = require('../services/dashboards/definition');
const { canReadGroup } = require('./metrics');
const live = require('../services/metrics/liveDeps');
const userSites = require('../services/userSites');
const signedLink = require('../services/signedLink');

module.exports = function reportgenRoutes(d) {
  const { express, rdb, requireReportSession, requireRole } = d;
  const router = express.Router();
  const AUTHOR = requireRole(['report-author', 'super_admin']);
  const REVIEWER = requireRole(['report-reviewer', 'super_admin']);
  const has = (u, r) => rdb.userHasRole(u, r);
  const who = (req) => (req.reportUser && (req.reportUser.username || req.reportUser.full_name)) || 'unknown';
  const isAuthor = (u) => has(u, 'report-author') || has(u, 'super_admin');
  const isReviewer = (u) => has(u, 'report-reviewer') || has(u, 'super_admin');
  const canEdit = (u, row) => (row.kind === 'system' ? has(u, 'super_admin') : isAuthor(u));
  const log = (req, action, target, details) => { try { rdb.logEvent({ category: 'report', action, target, details, ...rdb._logCtx(req) }); } catch (_) {} };

  let seeded = null;
  function ensureSeeded() {
    if (!seeded) seeded = (async () => {
      for (const s of SYSTEM) {
        if (await store.templates.get(s.id)) continue;
        const v = tdef.validate(s);
        if (!v.ok) { console.error('[reportgen] seed invalid', s.id, v.errors); continue; }
        await store.templates.saveDraft(s.id, v.definition, 'system', 'system');
        await store.templates.publishDefinition(s.id, v.definition, 'system', 'initial version');
      }
    })().catch(e => { seeded = null; throw e; });
    return seeded;
  }

  /** A run this person may read, with its template. */
  async function runAccess(req, res, { needDraftRights } = {}) {
    const run = await store.getRun(String(req.params.id), true);
    if (!run) { res.status(404).json({ error: 'Report not found' }); return null; }
    const ver = (await store.templates.getVersion(run.template_id, run.template_version)) || (await store.templates.getPublished(run.template_id));
    if (!ver) { res.status(404).json({ error: 'Template not found' }); return null; }
    const u = req.reportUser, staff = isAuthor(u) || isReviewer(u);
    if (run.status === 'draft' && !staff) { res.status(403).json({ error: 'This report is still a draft.' }); return null; }
    if (!staff && !audienceAllows(ver.definition, u, has)) { res.status(403).json({ error: 'This report is not published for your role.' }); return null; }
    if (!staff && run.site_code && !canReadGroup(rdb, u)) {
      const site = (await live.groupSites(rdb)).find(s => s.code === run.site_code);
      if (!site || !userSites.hasSite(u, site.site_id)) { res.status(403).json({ error: 'Access denied: another site' }); return null; }
    }
    if (needDraftRights && run.status !== 'draft') { res.status(409).json({ error: 'An approved report is not edited: generate a new one.' }); return null; }
    return { run, template: ver.definition };
  }
  const scopeLabel = async (run, t) => (run.site_code ? (((await live.groupSites(rdb)).find(s => s.code === run.site_code) || {}).name || run.site_code) : (t.language === 'en' ? 'Whole group' : 'Ensemble du groupe'));

  // ── Templates ──────────────────────────────────────────────────────────
  router.get('/api/reportgen/templates', requireReportSession, async (req, res) => {
    try {
      await ensureSeeded();
      const u = req.reportUser, out = [];
      for (const row of await store.templates.list()) {
        // Authors and reviewers see every published template (they generate and approve for its audience).
        const visible = row.published && !row.retired && (audienceAllows(row.published, u, has) || isAuthor(u) || isReviewer(u));
        const editable = isAuthor(u) && canEdit(u, row);
        if (!visible && !editable) continue;
        const dd = row.published || row.draft || {};
        out.push({ id: row.id, kind: row.kind, title: dd.title, description: dd.description, tone: dd.tone, ai: dd.ai, scope: dd.audience && dd.audience.site_scope,
          published_version: row.published_version, has_draft: !!row.draft, visible, editable });
      }
      const sites = isAuthor(u) ? (await live.groupSites(rdb)).filter(x => x.code).map(x => ({ code: x.code, name: x.name })) : [];
      res.json({ templates: out, author: isAuthor(u), reviewer: isReviewer(u), ai_available: !d.AI_DISABLED, sharing: signedLink.available(), sites });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/api/reportgen/templates/:id', requireReportSession, async (req, res) => {
    try {
      await ensureSeeded();
      const row = await store.templates.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Template not found' });
      const pub = await store.templates.getPublished(row.id), editable = isAuthor(req.reportUser) && canEdit(req.reportUser, row);
      if (!editable && !(pub && audienceAllows(pub.definition, req.reportUser, has))) return res.status(403).json({ error: 'Not published for your role.' });
      res.json({ id: row.id, kind: row.kind, published: pub, editable, draft: editable ? row.draft : undefined, versions: editable ? await store.templates.versions(row.id) : undefined });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/reportgen/templates', requireReportSession, AUTHOR, async (req, res) => {
    try {
      await ensureSeeded();
      const v = tdef.validate((req.body || {}).definition);
      if (!v.ok) return res.status(400).json({ error: 'Invalid template', details: v.errors });
      if (await store.templates.get(v.definition.id)) return res.status(409).json({ error: 'A template with this id already exists' });
      await store.templates.saveDraft(v.definition.id, v.definition, who(req), 'custom');
      log(req, 'report_template_created', v.definition.id);
      res.status(201).json({ id: v.definition.id, draft: v.definition, warnings: v.warnings });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/api/reportgen/templates/:id/draft', requireReportSession, AUTHOR, async (req, res) => {
    try {
      const row = await store.templates.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Template not found' });
      if (!canEdit(req.reportUser, row)) return res.status(403).json({ error: 'System templates are edited by a super_admin.' });
      const v = tdef.validate({ ...((req.body || {}).definition || {}), id: row.id });
      if (!v.ok) return res.status(400).json({ error: 'Invalid template', details: v.errors });
      await store.templates.saveDraft(row.id, v.definition, who(req), row.kind);
      res.json({ id: row.id, draft: v.definition, warnings: v.warnings });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/reportgen/templates/:id/publish', requireReportSession, AUTHOR, async (req, res) => {
    try {
      const row = await store.templates.get(String(req.params.id));
      if (!row || !row.draft) return res.status(404).json({ error: 'No draft to publish' });
      if (!canEdit(req.reportUser, row)) return res.status(403).json({ error: 'System templates are published by a super_admin.' });
      const v = tdef.validate(row.draft);
      if (!v.ok) return res.status(400).json({ error: 'The draft is not valid', details: v.errors });
      const version = await store.templates.publishDefinition(row.id, v.definition, who(req), (req.body || {}).note);
      log(req, 'report_template_published', row.id, { version });
      res.json({ id: row.id, version });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Runs ───────────────────────────────────────────────────────────────
  router.post('/api/reportgen/runs', requireReportSession, AUTHOR, async (req, res) => {
    try {
      await ensureSeeded();
      const b = req.body || {};
      const pub = await store.templates.getPublished(String(b.template_id || ''));
      if (!pub) return res.status(404).json({ error: 'Publish the template first.' });
      const month = /^\d{4}-\d{2}$/.test(String(b.month || '')) ? String(b.month) : new Date().toISOString().slice(0, 7);
      const site = String(b.site || '').trim().toUpperCase() || null;
      if (pub.definition.audience.site_scope === 'own' && !site) return res.status(400).json({ error: 'This template is for one site: choose the site.' });
      const run = await service.generate(rdb, {
        template: pub.definition, version: pub.version, month, site_code: site, by: who(req),
        deps: d.reportDeps || { metrics: live.liveDeps(rdb), readers: require('../services/dashboards/readers').readers(rdb) },
        ai: d.reportAi || { disabled: !!d.AI_DISABLED, call: d.aiCall, provider: d.AI_PROVIDER },
      });
      log(req, 'report_generated', run.id, { template: run.template_id, month, site, ai: run.ai ? run.ai.accepted : null });
      res.status(201).json({ run: { ...run, data: undefined } });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  router.get('/api/reportgen/runs', requireReportSession, async (req, res) => {
    try {
      const u = req.reportUser, staff = isAuthor(u) || isReviewer(u);
      const runs = await store.listRuns({ template_id: req.query.template ? String(req.query.template) : undefined });
      const tcache = new Map();
      const out = [];
      for (const r of runs) {
        if (r.status === 'draft' && !staff) continue;
        if (!tcache.has(r.template_id)) tcache.set(r.template_id, await store.templates.getPublished(r.template_id));
        const t = tcache.get(r.template_id);
        if (!staff && !(t && audienceAllows(t.definition, u, has))) continue;
        out.push({ ...r, title: t ? t.definition.title : r.template_id });
      }
      res.json({ runs: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/api/reportgen/runs/:id', requireReportSession, async (req, res) => {
    try {
      const x = await runAccess(req, res); if (!x) return;
      const staff = isAuthor(req.reportUser) || isReviewer(req.reportUser);
      res.json({ run: { ...x.run, data: undefined }, template: x.template, events: staff ? await store.events(x.run.id) : undefined,
        can_edit: isAuthor(req.reportUser) && x.run.status === 'draft', can_approve: isReviewer(req.reportUser) && x.run.status === 'draft',
        can_share: isReviewer(req.reportUser) && x.run.status === 'approved' && signedLink.available() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/api/reportgen/runs/:id/commentary', requireReportSession, AUTHOR, async (req, res) => {
    try {
      const x = await runAccess(req, res, { needDraftRights: true }); if (!x) return;
      const incoming = (req.body || {}).commentary || {};
      const commentary = { ...x.run.commentary };
      for (const s of x.template.sections.filter(s2 => s2.type === 'commentary')) if (typeof incoming[s.id] === 'string') commentary[s.id] = incoming[s.id].slice(0, 6000);
      const html = await service.rerender({ ...x.run, commentary }, x.template, 'draft', { scope_label: await scopeLabel(x.run, x.template) });
      await store.setCommentary(x.run.id, commentary, html, who(req));
      res.json({ commentary });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/reportgen/runs/:id/approve', requireReportSession, REVIEWER, async (req, res) => {
    try {
      const x = await runAccess(req, res, { needDraftRights: true }); if (!x) return;
      const at = new Date().toISOString();
      const html = await service.rerender(x.run, x.template, 'approved', { approved_by: who(req), approved_at: at, scope_label: await scopeLabel(x.run, x.template) });
      await store.approve(x.run.id, html, who(req));
      log(req, 'report_approved', x.run.id, { template: x.run.template_id, month: x.run.month });
      res.json({ id: x.run.id, status: 'approved' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/reportgen/runs/:id/share', requireReportSession, REVIEWER, async (req, res) => {
    try {
      const x = await runAccess(req, res); if (!x) return;
      if (x.run.status !== 'approved') return res.status(409).json({ error: 'Only an approved report is shared.' });
      const link = signedLink.sign({ kind: 'share', id: x.run.id, days: (req.body || {}).days });
      await store.event(x.run.id, who(req), 'shared', `link valid ${link.days} day(s)`);
      log(req, 'report_shared', x.run.id, { days: link.days });
      res.json({ path: '/share/' + link.token, expires_at: link.expires_at, days: link.days });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  router.get('/api/reportgen/runs/:id/output.:fmt', requireReportSession, async (req, res) => {
    try {
      const x = await runAccess(req, res); if (!x) return;
      const fmt = String(req.params.fmt);
      const name = `${x.run.template_id}-${x.run.month}${x.run.site_code ? '-' + x.run.site_code : ''}`;
      if (fmt === 'html') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:");
        return res.send(await store.getRunHtml(x.run.id));
      }
      if (fmt === 'csv') { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`); return res.send(render.csv(x.template, x.run.data)); }
      if (fmt === 'pptx') {
        const buf = await render.pptx(x.template, { ...x.run, scope_label: await scopeLabel(x.run, x.template) }, x.run.data, x.run.commentary);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
        res.setHeader('Content-Disposition', `attachment; filename="${name}.pptx"`);
        return res.send(buf);
      }
      if (fmt === 'pdf') {
        const r = await (d.renderPdf || require('../services/reportRender').renderPdf)(await store.getRunHtml(x.run.id), { stamp: 'rp-' + x.run.id });
        if (!r.ok) return res.status(503).json({ error: 'PDF unavailable on this server (' + r.reason + '). Use the HTML output.' });
        res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
        return res.send(r.pdf);
      }
      res.status(404).json({ error: 'Formats: html, pdf, pptx, csv' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
