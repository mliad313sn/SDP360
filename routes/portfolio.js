'use strict';
// ---------------------------------------------------------------------------
// Step 8 (SDP-DASH-2.0) — portfolio (programmes → objectives → projects → milestones → deliverables) and the
// committee's governance indicators.
//
//   GET    /api/portfolio?month=              the tree + effective status, drift, progress, alerts, evidence
//   POST   /api/portfolio/nodes               add a node                              (portfolio-manager)
//   PUT    /api/portfolio/nodes/:id           change a node                           (portfolio-manager)
//   DELETE /api/portfolio/nodes/:id           delete a node without children          (portfolio-manager)
//   GET    /api/portfolio/report?month=       monthly "state of the portfolio" (HTML)
//   GET    /api/portfolio/governance?from=&to=  % milestones on time, drift, request → decision delay, adoption
//   POST   /api/portfolio/import-roadmap      copy the ITSM Roadmap of a person          (super_admin)
//
// Everyone signed in reads the portfolio (the direction space and the meetings quote it); writing is the
// portfolio managers'. Evidence is read from the KPI dictionary, cached 10 minutes.
// ---------------------------------------------------------------------------
const pstore = require('../services/portfolio/store');
const A = require('../services/portfolio/analysis');
const report = require('../services/portfolio/report');
const registry = require('../services/metrics/registry');
const live = require('../services/metrics/liveDeps');
const cstore = require('../services/cockpit/store');

module.exports = function portfolioRoutes(d) {
  const { express, rdb, requireReportSession, requireRole } = d;
  const router = express.Router();
  const MANAGER = requireRole(['portfolio-manager', 'super_admin']);
  const SUPER = requireRole(['super_admin']);
  const has = (u, r) => rdb.userHasRole(u, r);
  const who = (req) => (req.reportUser && (req.reportUser.username || req.reportUser.full_name)) || 'unknown';
  const served = () => new Set(registry.list().filter(m => m.serve).map(m => m.key));
  const today = () => new Date().toISOString().slice(0, 10);
  const monthOf = (q) => (/^\d{4}-\d{2}$/.test(String(q || '')) ? String(q) : today().slice(0, 7));
  const log = (req, action, target, details) => { try { rdb.logEvent({ category: 'portfolio', action, target, details, ...rdb._logCtx(req) }); } catch (_) {} };

  const evCache = new Map();
  async function evidenceFor(nodes, month) {
    const key = month + '|' + nodes.filter(n => n.evidence_metric).map(n => `${n.id}:${n.evidence_metric}:${n.evidence_target}:${n.evidence_scope}`).join(',');
    const hit = evCache.get(key);
    if (hit && Date.now() - hit.at < 600000) return hit.value;
    const value = d.portfolioEvidence ? await d.portfolioEvidence(nodes, month)
      : await A.evidence(nodes, { metrics: live.liveDeps(rdb), sites: await live.groupSites(rdb), targets: await live.targets(rdb), month });
    evCache.set(key, { at: Date.now(), value });
    if (evCache.size > 50) evCache.delete(evCache.keys().next().value);
    return value;
  }

  router.get('/api/portfolio', requireReportSession, async (req, res) => {
    try {
      const nodes = await pstore.list(), t = today(), month = monthOf(req.query.month);
      const idx = A.index(nodes);
      const evidence = await evidenceFor(nodes, month);
      res.json({
        today: t, month, can_edit: has(req.reportUser, 'portfolio-manager') || has(req.reportUser, 'super_admin'),
        nodes: nodes.map(n => ({ ...n, effective_status: A.effectiveStatus(n, t), drift_days: A.drift(n), progress: n.kind === 'milestone' || n.kind === 'deliverable' ? null : A.progressOf(n, idx), evidence: evidence[n.id] || null })),
        alerts: A.alerts(nodes, t),
        metrics: registry.list().filter(m => m.serve).map(m => ({ key: m.key, fr: m.fr, unit: m.unit })),
        sites: (await live.groupSites(rdb)).filter(s => s.code).map(s => ({ code: s.code, name: s.name })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/portfolio/nodes', requireReportSession, MANAGER, async (req, res) => {
    try {
      const v = await pstore.validate(req.body || {}, { servedMetrics: served() });
      if (v.errors.length) return res.status(400).json({ error: 'Invalid node', details: v.errors });
      const n = await pstore.save(null, v.node, who(req));
      log(req, 'portfolio_node_created', n.id, { kind: n.kind });
      res.status(201).json({ node: n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/api/portfolio/nodes/:id', requireReportSession, MANAGER, async (req, res) => {
    try {
      const cur = await pstore.get(String(req.params.id));
      if (!cur) return res.status(404).json({ error: 'Node not found' });
      const v = await pstore.validate(req.body || {}, { existing: cur, servedMetrics: served() });
      if (v.errors.length) return res.status(400).json({ error: 'Invalid node', details: v.errors });
      const n = await pstore.save(cur.id, v.node, who(req));
      log(req, 'portfolio_node_updated', n.id, { status: n.status, due_date: n.due_date });
      res.json({ node: n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/api/portfolio/nodes/:id', requireReportSession, MANAGER, async (req, res) => {
    try {
      const r = await pstore.remove(String(req.params.id));
      if (!r.ok) return res.status(409).json({ error: r.error });
      log(req, 'portfolio_node_deleted', String(req.params.id));
      res.json({ deleted: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/portfolio/report', requireReportSession, async (req, res) => {
    try {
      const nodes = await pstore.list(), month = monthOf(req.query.month);
      const html = report.render({ nodes, evidence: await evidenceFor(nodes, month), month, today: today() });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
      res.send(html);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/portfolio/governance', requireReportSession, async (req, res) => {
    try {
      const t = today();
      const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : t;
      const logRows = [];
      for (const category of ['cockpit', 'portfolio', 'tracker', 'dashboard']) {
        for (let offset = 0; offset < 20000; offset += 500) {
          const page = await rdb.listSystemLog({ category, from, to }, { limit: 500, offset });
          logRows.push(...page.rows);
          if (page.rows.length < 500) break;
        }
      }
      const g = A.governance({ nodes: await pstore.list(), rfis: await cstore.listRfis(), logRows, users: await rdb.listUsers(), from, to, today: t });
      const sessions = (await cstore.listSessions({ status: 'closed', limit: 500 })).filter(s => s.held_on >= from && s.held_on <= to);
      g.meetings = { held: sessions.length, with_minutes_sent: sessions.filter(s => s.minutes_sent_at).length, cadences: new Set(sessions.map(s => s.cadence_id)).size };
      res.json(g);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/portfolio/import-roadmap', requireReportSession, SUPER, async (req, res) => {
    try {
      const userId = Number((req.body || {}).user_id) || req.reportUser.id;
      const r = await require('../services/portfolio/roadmapImport').importRoadmap(rdb, userId, who(req));
      log(req, 'portfolio_roadmap_imported', r.programme, r);
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
