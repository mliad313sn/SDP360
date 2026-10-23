'use strict';
// ---------------------------------------------------------------------------
// Step 9 (SDP-DASH-2.0) — external publication.
//
// Management (session, super_admin):  GET/POST /api/publication/clients · POST /api/publication/clients/:id/revoke
//                                     GET /api/publication/clients/:id/usage
//                                     GET/POST /api/publication/jobs · PUT/DELETE /api/publication/jobs/:id · POST …/:id/run
//                                     POST /api/publication/snapshot (run the nightly snapshot now)
// Embeds (session, report-reviewer):  POST /api/publication/embed {template_id, days} → signed embed link
// External API (API key, scope):      GET /api/v1/metrics · /api/v1/metrics/:key?scope=&month= · /api/v1/metrics/:key/series
//                                     GET /api/v1/reports · /api/v1/reports/:id                         (scope reports)
// OData (API key, scope metrics):     GET /odata · /odata/$metadata · /odata/Metrics · /odata/MetricValues
// Public, signed and expiring:        GET /share/:token (an approved report) · GET /embed/:token (the latest approved
//                                     report of a template, framable by EMBED_FRAME_ANCESTORS — SharePoint by default)
//
// Keys travel in a header or HTTP Basic, never in a URL. Shared and embedded views carry no script and no session.
// ---------------------------------------------------------------------------
const clients = require('../services/publication/clients');
const snapshot = require('../services/publication/snapshot');
const odata = require('../services/publication/odata');
const runner = require('../services/publication/runner');
const signedLink = require('../services/signedLink');
const registry = require('../services/metrics/registry');
const D = require('../services/metrics/dispatch');
const live = require('../services/metrics/liveDeps');
const rstore = require('../services/reportgen/store');
const estore = require('../services/engagement/store');

const DOC_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

/** Dependencies of the publication runner (routes and the scheduled job). */
async function publicationDeps(rdb, d = {}) {
  const cfg = await require('../services/reportConfig').getConfig(rdb.db);
  const mailer = d.publicationMailer || (cfg.smtp_host ? require('../services/mailer').buildMailer(cfg) : null);
  return {
    snapshotRead: (q) => snapshot.read(q), metricsLabel: (k) => ((registry.get(k) || {}).fr || k), mailer,
    post: (id, payload) => require('../services/engagement/engine').post(id, payload, d.publicationHttp ? { http: d.publicationHttp } : {}),
    latestApprovedHtml: async (tid) => { const r = await rstore.latestApproved(tid); return r ? rstore.getRunHtml(r.id) : null; },
    baseUrl: String(cfg.public_base_url || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  };
}

module.exports = function publicationRoutes(d) {
  const { express, rdb, requireReportSession, requireRole } = d;
  const router = express.Router();
  const SUPER = requireRole(['super_admin']);
  const REVIEWER = requireRole(['report-reviewer', 'super_admin']);
  const who = (req) => (req.reportUser && (req.reportUser.username || req.reportUser.full_name)) || 'unknown';
  const log = (req, action, target, details) => { try { rdb.logEvent({ category: 'publication', action, target, details, ...rdb._logCtx(req) }); } catch (_) {} };
  const served = () => registry.list().filter(m => m.serve);
  const metricsDeps = async () => ({ metrics: live.liveDeps(rdb), sites: await live.groupSites(rdb), targets: await live.targets(rdb) });

  // ── Management ─────────────────────────────────────────────────────────
  router.get('/api/publication/clients', requireReportSession, SUPER, async (req, res) => {
    try { res.json({ clients: await clients.list(), scopes: clients.SCOPES }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/publication/clients', requireReportSession, SUPER, async (req, res) => {
    try {
      const b = req.body || {};
      if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Name the consumer (e.g. "Power BI — direction").' });
      const r = await clients.create({ name: String(b.name).trim(), scopes: b.scopes, quota_per_day: b.quota_per_day }, who(req));
      log(req, 'api_client_created', r.client.id, { scopes: r.client.scopes });   // never the key
      res.status(201).json({ client: r.client, key: r.key, notice: 'Copy this key now: it will not be shown again.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/publication/clients/:id/revoke', requireReportSession, SUPER, async (req, res) => {
    try { await clients.revoke(String(req.params.id)); log(req, 'api_client_revoked', String(req.params.id)); res.json({ clients: await clients.list() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/api/publication/clients/:id/usage', requireReportSession, SUPER, async (req, res) => {
    try { res.json({ usage: await clients.usage(String(req.params.id)) }); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  const runnerDeps = () => publicationDeps(rdb, d);
  async function validPublication(b) {
    return runner.validate(b, { channelIds: new Set((await estore.listChannels()).map(c => c.id)), servedMetrics: new Set(served().map(m => m.key)),
      templateIds: new Set((await rstore.templates.list()).map(t => t.id)) });
  }
  router.get('/api/publication/jobs', requireReportSession, SUPER, async (req, res) => {
    try { res.json({ publications: await runner.list(), kinds: runner.KINDS, channels: await estore.listChannels(), templates: (await rstore.templates.list()).map(t => ({ id: t.id, title: (t.published || t.draft || {}).title })),
      metrics: served().map(m => ({ key: m.key, fr: m.fr })) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/publication/jobs', requireReportSession, SUPER, async (req, res) => {
    try {
      const v = await validPublication(req.body || {});
      if (!v.ok) return res.status(400).json({ error: 'Invalid publication', details: v.errors });
      const p = await runner.save(null, v.publication, who(req));
      log(req, 'publication_created', p.id, { kind: p.kind, enabled: p.enabled });
      res.status(201).json({ publication: p });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/api/publication/jobs/:id', requireReportSession, SUPER, async (req, res) => {
    try {
      if (!(await runner.get(String(req.params.id)))) return res.status(404).json({ error: 'Publication not found' });
      const v = await validPublication(req.body || {});
      if (!v.ok) return res.status(400).json({ error: 'Invalid publication', details: v.errors });
      const p = await runner.save(String(req.params.id), v.publication, who(req));
      log(req, 'publication_updated', p.id, { enabled: p.enabled });
      res.json({ publication: p });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/api/publication/jobs/:id', requireReportSession, SUPER, async (req, res) => {
    try { await runner.remove(String(req.params.id)); log(req, 'publication_deleted', String(req.params.id)); res.json({ deleted: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/publication/jobs/:id/run', requireReportSession, SUPER, async (req, res) => {
    try {
      const p = await runner.get(String(req.params.id));
      if (!p) return res.status(404).json({ error: 'Publication not found' });
      const r = await runner.execute(p, await runnerDeps());
      await runner.mark(p.id, r.ok ? 'ok (manual run)' : 'failed: ' + r.error);
      log(req, 'publication_run', p.id, r);
      res.status(r.ok ? 200 : 502).json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/publication/snapshot', requireReportSession, SUPER, async (req, res) => {
    try {
      const cfg = await require('../services/reportConfig').getConfig(rdb.db);
      res.json(await snapshot.run(snapshot.publishedKeys(cfg), d.snapshotDeps || await metricsDeps(), { months: Math.max(1, Math.min(13, Number((req.body || {}).months) || 13)) }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/publication/embed', requireReportSession, REVIEWER, async (req, res) => {
    try {
      const b = req.body || {};
      if (!(await rstore.templates.getPublished(String(b.template_id || '')))) return res.status(404).json({ error: 'Template not found' });
      const link = signedLink.sign({ kind: 'embed', id: String(b.template_id), days: b.days || 180 });
      log(req, 'embed_link_created', String(b.template_id), { days: link.days });
      res.json({ path: '/embed/' + link.token, expires_at: link.expires_at, days: link.days, frame_ancestors: frameAncestors() });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── External API (API key) ─────────────────────────────────────────────
  const METRICS = clients.middleware('metrics'), REPORTS = clients.middleware('reports');
  router.get('/api/v1/metrics', METRICS, (req, res) => {
    res.json({ metrics: served().map(m => ({ key: m.key, label: { fr: m.fr, en: m.en }, unit: m.unit, domain: m.domain, direction: m.direction || 'higher', policy: m.policy || null })) });
  });
  router.get('/api/v1/metrics/:key', METRICS, async (req, res) => {
    try {
      const deps = d.snapshotDeps || await metricsDeps();
      const scope = String(req.query.scope || 'GROUP').toUpperCase();
      const window = D.resolveWindow({ month: /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : undefined });
      const site = scope === 'GROUP' ? null : deps.sites.find(s => s.code === scope);
      if (scope !== 'GROUP' && !site) return res.status(404).json({ error: 'unknown scope (GROUP or a site code)' });
      const r = site ? await D.computeMetric(req.params.key, { site, window, targets: deps.targets }, deps.metrics)
        : await D.computeGroupMetric(req.params.key, { sites: deps.sites, window, targets: deps.targets }, deps.metrics);
      res.status(r.status || 200).json(r.status && r.status !== 200 ? { error: r.error || 'not served' } : r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/api/v1/metrics/:key/series', METRICS, async (req, res) => {
    try {
      const deps = d.snapshotDeps || await metricsDeps();
      const scope = String(req.query.scope || 'GROUP').toUpperCase();
      const site = scope === 'GROUP' ? null : deps.sites.find(s => s.code === scope);
      if (scope !== 'GROUP' && !site) return res.status(404).json({ error: 'unknown scope (GROUP or a site code)' });
      const r = await D.computeSeries(req.params.key, { scope: site ? 'site' : 'group', site, sites: deps.sites, grain: req.query.grain === 'week' ? 'week' : 'month', points: Math.max(1, Math.min(24, Number(req.query.points) || 12)),
        asOf: /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.asOf || '')) ? String(req.query.asOf) : new Date().toISOString().slice(0, 10), targets: deps.targets }, deps.metrics);
      res.status(r.status || 200).json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/api/v1/reports', REPORTS, async (req, res) => {
    try { res.json({ reports: (await rstore.listRuns({ status: 'approved' })).map(r => ({ id: r.id, template_id: r.template_id, month: r.month, site: r.site_code, approved_at: r.approved_at })) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/api/v1/reports/:id', REPORTS, async (req, res) => {
    try {
      const r = await rstore.getRun(String(req.params.id), false);
      if (!r || r.status !== 'approved') return res.status(404).json({ error: 'Report not found' });
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Content-Security-Policy', DOC_CSP);
      res.send(await rstore.getRunHtml(r.id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── OData feed (Power BI) ──────────────────────────────────────────────
  const base = (req) => `${req.protocol}://${req.get('host')}/odata`;
  const odataErr = (res, code, msg) => res.status(code).json({ error: { code: String(code), message: msg } });
  router.get('/odata', METRICS, (req, res) => {
    res.setHeader('OData-Version', '4.0');
    res.json({ '@odata.context': base(req) + '/$metadata', value: [{ name: 'Metrics', kind: 'EntitySet', url: 'Metrics' }, { name: 'MetricValues', kind: 'EntitySet', url: 'MetricValues' }] });
  });
  router.get('/odata/\\$metadata', METRICS, (req, res) => {
    res.setHeader('OData-Version', '4.0'); res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.send(odata.metadata());
  });
  router.get('/odata/Metrics', METRICS, (req, res) => {
    res.setHeader('OData-Version', '4.0');
    res.json({ '@odata.context': base(req) + '/$metadata#Metrics', value: served().map(m => ({ Key: m.key, Label: m.fr, Unit: m.unit || null, Domain: m.domain || null, Direction: m.direction || 'higher' })) });
  });
  router.get('/odata/MetricValues', METRICS, async (req, res) => {
    try {
      let f;
      try { f = odata.parseFilter(req.query.$filter); } catch (e) { return odataErr(res, 400, e.message); }
      const top = req.query.$top != null ? Math.max(0, Math.min(odata.PAGE, Number(req.query.$top) || 0)) : odata.PAGE;
      const skip = Math.max(0, Number(req.query.$skip || req.query.$skiptoken) || 0);
      const rows = await snapshot.read({ ...f, limit: top + 1, offset: skip });
      const page = rows.slice(0, top);
      const body = { '@odata.context': base(req) + '/$metadata#MetricValues', value: page.map(odata.valueRow) };
      if (rows.length > top && req.query.$top == null) {
        const q = new URLSearchParams(); if (req.query.$filter) q.set('$filter', req.query.$filter); q.set('$skiptoken', String(skip + top));
        body['@odata.nextLink'] = base(req) + '/MetricValues?' + q.toString();
      }
      res.setHeader('OData-Version', '4.0');
      res.json(body);
    } catch (e) { odataErr(res, 500, e.message); }
  });

  // ── Public signed views ────────────────────────────────────────────────
  function frameAncestors() { return String(process.env.EMBED_FRAME_ANCESTORS || 'https://*.sharepoint.com').split(/[\s,]+/).filter(x => /^https:\/\/[\w*.-]+$/.test(x)).join(' ') || "'none'"; }
  const expired = (res) => res.status(410).type('text/plain; charset=utf-8').send('Ce lien a expiré ou n’est pas valide. Demandez un nouveau lien à la personne qui vous l’a envoyé.');
  router.get('/share/:token', async (req, res) => {
    try {
      const v = signedLink.verify(req.params.token, 'share');
      if (!v) return expired(res);
      const r = await rstore.getRun(v.id, false);
      if (!r || r.status !== 'approved') return expired(res);
      try { rdb.logEvent({ category: 'publication', action: 'report_share_viewed', target: r.id, actor: 'anonymous', ip: req.ip }); } catch (_) {}
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Content-Security-Policy', DOC_CSP); res.setHeader('Cache-Control', 'no-store');
      res.send(await rstore.getRunHtml(r.id));
    } catch (e) { res.status(500).type('text/plain').send('Erreur'); }
  });
  router.get('/embed/:token', async (req, res) => {
    try {
      const v = signedLink.verify(req.params.token, 'embed');
      if (!v) return expired(res);
      const r = await rstore.latestApproved(v.id);
      if (!r) return res.status(404).type('text/plain; charset=utf-8').send('Aucun rapport validé pour ce modèle.');
      res.removeHeader('X-Frame-Options');
      res.setHeader('Content-Security-Policy', DOC_CSP + '; frame-ancestors ' + frameAncestors());
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
      res.send(await rstore.getRunHtml(r.id));
    } catch (e) { res.status(500).type('text/plain').send('Erreur'); }
  });

  return router;
};
module.exports.publicationDeps = publicationDeps;
