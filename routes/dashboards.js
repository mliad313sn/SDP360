'use strict';
// ---------------------------------------------------------------------------
// Step 6 (SDP-DASH-2.0, lots 6.3-6.5) — composed dashboards and the direction space.
//
//   GET    /api/dashboards                       dashboards this person may open (+ drafts for authors)
//   GET    /api/dashboards/catalog               widget catalog + served dictionary keys (authors)
//   GET    /api/dashboards/:id                   published definition (+ draft and versions for authors)
//   GET    /api/dashboards/:id/data?site=&month= every widget's data, in the viewer's scope
//   POST   /api/dashboards                       create a draft                        (dashboard-author)
//   PUT    /api/dashboards/:id/draft             save the draft                        (dashboard-author)
//   POST   /api/dashboards/preview               data of an unsaved definition         (dashboard-author)
//   POST   /api/dashboards/:id/publish           publish the draft as the next version (dashboard-publisher)
//   POST   /api/dashboards/:id/rollback          republish an older version            (dashboard-publisher)
//   POST   /api/dashboards/:id/retire            take it off the air                   (dashboard-publisher)
//   DELETE /api/dashboards/:id                   delete a never-published custom draft (dashboard-author)
//
// The viewer's SCOPE is decided here from the viewer's rights, never from the definition: the whole group
// for the admin tier / scorecard-viewer / group-business when the audience is "all sites", otherwise one of
// the viewer's own sites. System dashboards (the direction space) are edited and published by super_admin only.
// ---------------------------------------------------------------------------
const def = require('../services/dashboards/definition');
const store = require('../services/dashboards/store');
const { resolveAll } = require('../services/dashboards/data');
const { SYSTEM } = require('../services/dashboards/seed');
const live = require('../services/metrics/liveDeps');
const { freshness } = require('../services/metrics/freshness');
const { canReadGroup } = require('./metrics');
const registry = require('../services/metrics/registry');
const userSites = require('../services/userSites');

module.exports = function dashboardsRoutes(d) {
  const { express, rdb, requireReportSession, requireRole } = d;
  const router = express.Router();
  const AUTHOR = requireRole(['dashboard-author', 'dashboard-publisher', 'super_admin']);
  const PUBLISHER = requireRole(['dashboard-publisher', 'super_admin']);
  const has = (u, r) => rdb.userHasRole(u, r);
  const who = (req) => (req.reportUser && (req.reportUser.username || req.reportUser.full_name)) || 'unknown';
  const viewGate = require('../services/viewLog').makeOncePerDay();

  // System dashboards exist from the first read: inserted + published once, never overwritten afterwards.
  let seeded = null;
  function ensureSeeded() {
    if (!seeded) seeded = (async () => {
      for (const s of SYSTEM) {
        if (await store.get(s.id)) continue;
        const v = def.validate(s);
        if (!v.ok) { console.error('[dashboards] seed invalid', s.id, v.errors); continue; }
        await store.saveDraft(s.id, v.definition, 'system', 'system');
        await store.publishDefinition(s.id, v.definition, 'system', 'initial version');
      }
    })().catch(e => { seeded = null; throw e; });
    return seeded;
  }

  const canEdit = (user, row) => row.kind === 'system' ? has(user, 'super_admin') : (has(user, 'dashboard-author') || has(user, 'dashboard-publisher') || has(user, 'super_admin'));
  const canPublish = (user, row) => row.kind === 'system' ? has(user, 'super_admin') : (has(user, 'dashboard-publisher') || has(user, 'super_admin'));
  const isAuthor = (user) => ['dashboard-author', 'dashboard-publisher', 'super_admin'].some(r => has(user, r));

  /** Viewer context for a definition. Returns { ctx } or { status, error }. */
  async function contextFor(user, definition, q) {
    const sites = await live.groupSites(rdb);
    const month = /^\d{4}-\d{2}$/.test(String(q.month || '')) ? String(q.month) : new Date().toISOString().slice(0, 7);
    const today = new Date().toISOString().slice(0, 10);
    const last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
    const asOf = last < today ? last : today;
    const targets = await live.targets(rdb);
    const group = definition.audience.site_scope === 'all' && canReadGroup(rdb, user);
    const wanted = String(q.site || '').trim().toUpperCase();
    const own = sites.filter(s => userSites.hasSite(user, s.site_id));
    let site = null;
    if (wanted) {
      site = sites.find(s => s.code === wanted) || null;
      if (!site) return { status: 404, error: 'unknown site code' };
      if (!canReadGroup(rdb, user) && !userSites.hasSite(user, site.site_id)) return { status: 403, error: 'Access denied: another site' };
    } else if (!group) {
      site = own.find(s => s.code) || own[0] || null;
      // A group reader (admin tier, leadership, an author previewing) without a site of their own opens a
      // one-site dashboard on the first site and switches from the scope selector.
      if (!site && canReadGroup(rdb, user)) site = sites.find(s => s.code) || null;
      if (!site) return { status: 403, error: 'This dashboard shows one site, and no site is attached to your account.' };
    }
    const scope = site ? 'site' : 'group';
    return { ctx: { scope, site, sites, month, asOf, targets },
      choices: canReadGroup(rdb, user) ? sites.filter(s => s.code) : own.filter(s => s.code) };
  }

  const readers = () => require('../services/dashboards/readers').readers(rdb);
  const deps = () => d.dashboardDeps || { metrics: live.liveDeps(rdb), readers: readers() };

  // Five-minute cache of a published dashboard's data, per version, scope, site and month (a preview is never
  // cached). The figures underneath only change with the hourly / nightly syncs.
  const TTL = Number(process.env.DASHBOARD_CACHE_TTL_MS == null ? 300000 : process.env.DASHBOARD_CACHE_TTL_MS);
  const dataCache = new Map();
  async function resolveCached(definition, ctx, key) {
    if (!key || !TTL || d.dashboardDeps) return resolveAll(definition, ctx, deps());
    const k = [key, ctx.scope, ctx.site ? ctx.site.site_id : '', ctx.month].join('|');
    const hit = dataCache.get(k);
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    const value = await resolveAll(definition, ctx, deps());
    dataCache.set(k, { at: Date.now(), value });
    if (dataCache.size > 300) dataCache.delete(dataCache.keys().next().value);
    return value;
  }

  async function respondData(req, res, definition, extra) {
    const c = await contextFor(req.reportUser, definition, req.query.site || req.query.month ? req.query : (req.body && req.body.as) || {});
    if (c.error) return res.status(c.status).json({ error: c.error });
    const data = await resolveCached(definition, c.ctx, extra && !extra.preview && extra.id ? `${extra.id}@${extra.version}` : null);
    let fresh = {};
    try { fresh = freshness(d.syncStates ? await d.syncStates() : await require('../services/sync/store').listStates()); } catch (_) {}
    res.json({ ...extra, context: { scope: c.ctx.scope, site: c.ctx.site, month: c.ctx.month, as_of: c.ctx.asOf, site_choices: c.choices,
      group_allowed: definition.audience.site_scope === 'all' && canReadGroup(rdb, req.reportUser) },
      freshness: fresh, generated_at: new Date().toISOString(), ...data });
  }

  router.get('/api/dashboards', requireReportSession, async (req, res) => {
    try {
      await ensureSeeded();
      const u = req.reportUser, author = isAuthor(u);
      const out = [];
      for (const row of await store.list()) {
        const visible = row.published && !row.retired && def.audienceAllows(row.published, u, has);
        const editable = author && canEdit(u, row);
        if (!visible && !editable) continue;
        out.push({ id: row.id, kind: row.kind, title: (row.published || row.draft || {}).title || { fr: row.id, en: row.id },
          description: (row.published || row.draft || {}).description || '', published_version: row.published_version,
          published_at: row.published_at, retired: row.retired, has_draft: !!row.draft, visible, editable,
          audience: (row.published || row.draft || {}).audience || null });
      }
      res.json({ dashboards: out, author, can_publish: has(u, 'dashboard-publisher') || has(u, 'super_admin') });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/dashboards/catalog', requireReportSession, AUTHOR, async (req, res) => {
    const sites = await live.groupSites(rdb), u = req.reportUser;
    res.json({
      preview_sites: (canReadGroup(rdb, u) ? sites : sites.filter(x => userSites.hasSite(u, x.site_id))).filter(x => x.code).map(x => ({ code: x.code, name: x.name })),
      group_allowed: canReadGroup(rdb, u),
      widgets: Object.entries(def.WIDGETS).map(([type, w]) => ({ type, label: w.label, metrics: w.metrics, span: w.span, grains: w.grains })),
      event_sources: def.EVENT_SOURCES, audience_roles: def.AUDIENCE_ROLES,
      metrics: registry.list().filter(m => m.serve).map(m => ({ key: m.key, fr: m.fr, en: m.en, unit: m.unit, domain: m.domain,
        weekly: !['helpdesk.sla_reply_pct', 'helpdesk.csat_pct', 'helpdesk.nps'].includes(m.key) && !['meetings_month', 'survey_month', 'assets_effort', 'scoreboard_month'].includes(m.serve) })),
    });
  });

  router.post('/api/dashboards/preview', requireReportSession, AUTHOR, async (req, res) => {
    try {
      const v = def.validate((req.body || {}).definition);
      if (!v.ok) return res.status(400).json({ error: 'Invalid definition', details: v.errors });
      await respondData(req, res, v.definition, { preview: true, definition: v.definition });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/dashboards/:id', requireReportSession, async (req, res) => {
    try {
      await ensureSeeded();
      const row = await store.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Dashboard not found' });
      const pub = await store.getPublished(row.id);
      const u = req.reportUser, editable = isAuthor(u) && canEdit(u, row);
      const visible = pub && def.audienceAllows(pub.definition, u, has);
      if (!visible && !editable) return res.status(pub ? 403 : 404).json({ error: pub ? 'This dashboard is not published for your role.' : 'Dashboard not found' });
      res.json({ id: row.id, kind: row.kind, published: pub, retired: row.retired, editable, can_publish: canPublish(u, row),
        draft: editable ? row.draft : undefined, draft_at: editable ? row.draft_at : undefined, draft_by: editable ? row.draft_by : undefined,
        versions: editable ? await store.versions(row.id) : undefined });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/dashboards/:id/data', requireReportSession, async (req, res) => {
    try {
      await ensureSeeded();
      const id = String(req.params.id);
      const pub = await store.getPublished(id);
      if (!pub) return res.status(404).json({ error: 'Dashboard not found' });
      if (!def.audienceAllows(pub.definition, req.reportUser, has)) return res.status(403).json({ error: 'This dashboard is not published for your role.' });
      if (viewGate(`${who(req)}|${id}`, new Date().toISOString().slice(0, 10))) {
        rdb.logEvent({ category: 'dashboard', action: id === 'direction' ? 'direction_viewed' : 'dashboard_viewed', target: id, ...rdb._logCtx(req) });
      }
      await respondData(req, res, pub.definition, { id, version: pub.version, published_at: pub.published_at, definition: pub.definition });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/dashboards', requireReportSession, AUTHOR, async (req, res) => {
    try {
      await ensureSeeded();
      const v = def.validate((req.body || {}).definition);
      if (!v.ok) return res.status(400).json({ error: 'Invalid definition', details: v.errors });
      if (await store.get(v.definition.id)) return res.status(409).json({ error: 'A dashboard with this id already exists' });
      const row = await store.saveDraft(v.definition.id, v.definition, who(req), 'custom');
      rdb.logEvent({ category: 'dashboard', action: 'dashboard_created', target: row.id, ...rdb._logCtx(req) });
      res.status(201).json({ id: row.id, draft: row.draft });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/api/dashboards/:id/draft', requireReportSession, AUTHOR, async (req, res) => {
    try {
      const row = await store.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Dashboard not found' });
      if (!canEdit(req.reportUser, row)) return res.status(403).json({ error: 'System dashboards are edited by a super_admin.' });
      const v = def.validate({ ...((req.body || {}).definition || {}), id: row.id });
      if (!v.ok) return res.status(400).json({ error: 'Invalid definition', details: v.errors });
      const saved = await store.saveDraft(row.id, v.definition, who(req), row.kind);
      res.json({ id: saved.id, draft: saved.draft, draft_at: saved.draft_at });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/dashboards/:id/publish', requireReportSession, PUBLISHER, async (req, res) => {
    try {
      const row = await store.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Dashboard not found' });
      if (!canPublish(req.reportUser, row)) return res.status(403).json({ error: 'System dashboards are published by a super_admin.' });
      const v = def.validate(row.draft);
      if (!v.ok) return res.status(400).json({ error: 'The draft is not valid', details: v.errors });
      const version = await store.publishDefinition(row.id, v.definition, who(req), (req.body || {}).note);
      rdb.logEvent({ category: 'dashboard', action: 'dashboard_published', target: row.id, details: { version, author: row.draft_by }, ...rdb._logCtx(req) });
      res.json({ id: row.id, version });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/dashboards/:id/rollback', requireReportSession, PUBLISHER, async (req, res) => {
    try {
      const row = await store.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Dashboard not found' });
      if (!canPublish(req.reportUser, row)) return res.status(403).json({ error: 'System dashboards are published by a super_admin.' });
      const target = await store.getVersion(row.id, Number((req.body || {}).version));
      if (!target) return res.status(404).json({ error: 'Version not found' });
      const version = await store.publishDefinition(row.id, target.definition, who(req), `rollback to v${target.version}`);
      rdb.logEvent({ category: 'dashboard', action: 'dashboard_published', target: row.id, details: { version, rollback_to: target.version }, ...rdb._logCtx(req) });
      res.json({ id: row.id, version, rollback_to: target.version });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/dashboards/:id/retire', requireReportSession, PUBLISHER, async (req, res) => {
    try {
      const row = await store.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Dashboard not found' });
      if (!canPublish(req.reportUser, row)) return res.status(403).json({ error: 'System dashboards are published by a super_admin.' });
      await store.retire(row.id);
      rdb.logEvent({ category: 'dashboard', action: 'dashboard_retired', target: row.id, ...rdb._logCtx(req) });
      res.json({ id: row.id, retired: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/api/dashboards/:id', requireReportSession, AUTHOR, async (req, res) => {
    try {
      const row = await store.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Dashboard not found' });
      if (row.kind === 'system' || row.published_version != null) return res.status(409).json({ error: 'A published dashboard is retired, not deleted (its history stays).' });
      await store.removeDraftOnly(row.id);
      res.json({ id: row.id, deleted: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
