'use strict';
const { fail } = require('../services/httpError');
// Step 6 — dashboard definitions (composer output) + the one-call data resolver the viewer uses.
//
//   GET  /api/dashboards                      published dashboards visible to the session (+ own drafts)
//   GET  /api/dashboards/catalogue            widget types, audiences, registered metrics, RAG policies
//   GET  /api/dashboards/:key                 definition (published snapshot for viewers; draft for publishers)
//   GET  /api/dashboards/:key/data?site=&window=   every widget resolved through the metric registry
//   POST /api/dashboards/:key/view            view log (one event per actor per day — "is it used?")
//   PUT  /api/dashboards/:key                 save a draft (publisher)      — validated, never SQL
//   POST /api/dashboards/:key/submit          submit the draft for review (publisher, owner)
//   POST /api/dashboards/:key/publish         version++ and publish — by ANOTHER publisher than the submitter / last
//                                             editor (G-24 four-eyes); admin override_reason (10+ chars) logged as risk
//   POST /api/dashboards/:key/rollback/:n     restore version n as the draft (publisher)
//   POST /api/dashboards/:key/retire          (publisher)
//   GET  /api/dashboards/:key/versions        (publisher)
//   DELETE /api/dashboards/:key               a draft/retired definition (publisher)
//
// Publisher = admin tier OR the feature role `dashboard-publisher` (committee members).
// Site scope: an editor/viewer resolves data for one of THEIR sites only (services/userSites);
// a dashboard pinned to a site (site_id) is listed only for that site's people. Fleet-wide
// "per-site" widgets enumerate the sites in the caller's scope — never the whole fleet for a
// site-scoped account.

const R = require('../public/lib/dashboardRender');
const { WIDGET_TYPES, AUDIENCES, FILTER_TYPES, fieldReadiness } = require('../services/dashboardWidgets');
const { resolveWidgets } = require('../services/dashboardData');

/** Build the store against the reports DB (sqlite: DDL + seed now; pg: migration 016, seed at boot). */
function createStore(rdbMod, { log = console.log } = {}) {
  const pg = rdbMod.REPORTS_BACKEND === 'postgres';
  const st = require('../services/dashboardStore').makeDashboardStore(({ prepare: (sql) => rdbMod.pgHandle().prepare(sql) }), { isPg: pg });
  
  st.seedAtBoot = async () => {  await st.init(); const a = await st.seed(require('../services/dashboardSeeds').SEED_DASHBOARDS); if (a.length) log(`[dashboards] seeded ${a.join(', ')}`); return a; };
  return st;
}

module.exports = function dashboardsRoutes(deps) {
  const { express, requireReportSession, store } = deps;
  const router = express.Router();
  const rdb = () => deps.rdb || require('../reports-db');
  const registry = () => deps.registry || require('../services/metricRegistry').current();
  const userSites = require('../services/userSites');
  const viewGate = deps.viewGate || require('../services/viewLog').makeOncePerDay();
  const readerDeps = () => deps.readerDeps || {
    rdb: rdb(), mdb: require('../meetings-db'), idb: require('../inspection-db'), adb: require('../assets-db'),
    tracker: require('../tracker-db'), trackerScore: require('../tracker-pptx'),
  };

  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  const isPublisher = (u) => isAdmin(u) || rdb().userHasRole(u, 'dashboard-publisher');
  function requirePublisher(req, res, next) {
    if (!isPublisher(req.reportUser)) return res.status(403).json({ ok: false, error: 'dashboard-publisher or admin role required' });
    next();
  }
  async function scopeSites(user) {
    const all = await rdb().listSites({ includeInactive: false });
    if (isAdmin(user)) return all;
    const ids = new Set(userSites.siteIds(user));
    return all.filter(s => ids.has(Number(s.id)));
  }
  const key = (req) => String(req.params.key || '').slice(0, 48);

  router.get('/api/dashboards', requireReportSession, async (req, res) => {
    try {
      const u = req.reportUser;
      const sites = await scopeSites(u);
      const rows = await store.list({ status: isPublisher(u) ? ['draft', 'review', 'published'] : ['published'],
        siteIds: isAdmin(u) ? null : sites.map(s => Number(s.id)), ownerId: u.id });
      res.json({ ok: true, publisher: isPublisher(u), dashboards: rows.map(d => ({ key: d.key, title: d.title, audience: d.audience, status: d.status, version: d.version, site_id: d.site_id, updated_at: d.updated_at, published_at: d.published_at, widgets: (d.definition && d.definition.widgets || []).length })) });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  router.get('/api/dashboards/catalogue', requireReportSession, requirePublisher, (req, res) => {
    const reg = registry();
    res.json({ ok: true, widgetTypes: WIDGET_TYPES, audiences: AUDIENCES, filterTypes: FILTER_TYPES, metrics: reg.list({ status: 'published' }), policies: reg.policies() });
  });

  async function loadVisible(req, res) {
    const u = req.reportUser;
    const d = isPublisher(u) ? await store.get(key(req)) : await store.published(key(req));
    if (!d) { res.status(404).json({ ok: false, error: 'dashboard not found' }); return null; }
    if (d.site_id != null && !isAdmin(u) && !userSites.hasSite(u, d.site_id)) { res.status(403).json({ ok: false, error: 'dashboard belongs to another site' }); return null; }
    return d;
  }

  router.get('/api/dashboards/:key', requireReportSession, async (req, res) => {
    try {
      const d = await loadVisible(req, res); if (!d) return;
      const pub = d.status === 'published' ? await store.published(d.key) : null;
      res.json({ ok: true, dashboard: d, published: pub ? pub.definition : null, publisher: isPublisher(req.reportUser) });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  router.get('/api/dashboards/:key/versions', requireReportSession, requirePublisher, async (req, res) => {
    try { res.json({ ok: true, versions: await store.versions(key(req)) }); } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  router.post('/api/dashboards/:key/view', requireReportSession, async (req, res) => {
    try {
      const d = await loadVisible(req, res); if (!d) return;
      const ctx = rdb()._logCtx(req);
      if (viewGate(`${ctx.actor}|${d.key}`, new Date().toISOString().slice(0, 10))) {
        rdb().logEvent({ category: 'dashboards', action: 'dashboard_viewed', target: d.key, details: { audience: d.audience, version: d.version }, ...ctx });
      }
      res.json({ ok: true });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  // ---- data: every widget in one call ------------------------------------------------
  router.get('/api/dashboards/:key/data', requireReportSession, async (req, res) => {
    try {
      const u = req.reportUser;
      const d = await loadVisible(req, res); if (!d) return;
      const def = (req.query.draft === '1' && isPublisher(u)) ? d.definition : ((await store.published(d.key)) || d).definition;
      const sites = await scopeSites(u);
      if (!sites.length) return res.json({ ok: true, key: d.key, site: null, sites: [], widgets: {}, note: 'no site in your scope' });
      let site = req.query.site == null || req.query.site === '' ? null : Number(req.query.site);
      if (site != null && !sites.some(s => Number(s.id) === site)) return res.status(403).json({ ok: false, error: 'site not in your scope' });
      if (site == null) site = Number(sites[0].id);
      const window = req.query.window ? String(req.query.window).slice(0, 24) : null;
      const now = new Date();
      const out = await resolveWidgets({ def, sites, site, window, reg: registry(), dd: readerDeps(), rdb: rdb(), now });
      // G-14 — say which source behind these widgets is stale or has never synced (the viewer shows a banner).
      const gate = require('../services/publishGate'); const reg = registry();
      const mods = [...new Set(((def && def.widgets) || []).map(w => w && w.metric && reg.get(w.metric)).filter(Boolean).map(m => m.module))];
      const jobs = gate.jobsFor(mods);
      const lastOk = deps.lastSyncOk ? await deps.lastSyncOk(jobs) : await gate.lastOkFromSyncStore(jobs);
      const stale = gate.freshness(mods, lastOk, now.getTime(), await require('../services/governancePolicy').forContext({})).sources.filter(x => x.state !== 'FRESH');
      res.json({ ok: true, key: d.key, version: d.version, site, sites: sites.map(s => ({ id: Number(s.id), name: s.name })), window, as_of: now.toISOString(), widgets: out, stale_sources: stale });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  // ---- publisher writes ------------------------------------------------------------
  router.put('/api/dashboards/:key', requireReportSession, requirePublisher, express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const u = req.reportUser;
      const doc = req.body && req.body.definition ? req.body.definition : req.body;
      if (!doc || doc.key !== key(req)) return res.status(400).json({ ok: false, error: 'definition.key must match the URL' });
      const existing = await store.get(doc.key);
      if (existing && !isAdmin(u) && existing.owner_id != null && existing.owner_id !== u.id) return res.status(403).json({ ok: false, error: 'owned by another publisher' });
      let siteId = req.body && req.body.site_id != null ? Number(req.body.site_id) : (existing ? existing.site_id : null);
      if (!isAdmin(u)) { const mine = userSites.siteIds(u); if (siteId == null || !mine.includes(siteId)) siteId = mine[0] || null; if (siteId == null) return res.status(403).json({ ok: false, error: 'no site in your scope' }); }
      const reg = registry();
      const saved = await store.saveDraft(doc, { user: u, siteId, metrics: reg.list({ status: 'published' }).map(m => m.key) });
      const field = doc.audience === 'field' ? fieldReadiness(doc) : { ok: true, issues: [] };
      rdb().logEvent({ category: 'dashboards', action: 'dashboard_saved', target: doc.key, ...rdb()._logCtx(req) });
      res.json({ ok: true, dashboard: saved, field });
    } catch (e) {
      if (e.code === 'INVALID') return fail(res, e, 400, { ok: false });
      fail(res, e, 500, { ok: false });
    }
  });

  router.post('/api/dashboards/:key/publish', requireReportSession, requirePublisher, express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const d = await store.get(key(req)); if (!d) return res.status(404).json({ ok: false, error: 'dashboard not found' });
      if (!isAdmin(req.reportUser) && d.owner_id != null && d.owner_id !== req.reportUser.id) return res.status(403).json({ ok: false, error: 'owned by another publisher' });
      if (d.definition && d.definition.audience === 'field') { const f = fieldReadiness(d.definition); if (!f.ok) return res.status(400).json({ ok: false, error: 'field dashboard not phone-ready', issues: f.issues }); }
      // G-24 — four-eyes: submitted by one publisher, published by another (admin override with a reason, logged as a risk).
      const dec = require('../services/publishGate').publishDecision(d, req.reportUser, { isAdmin: isAdmin(req.reportUser), overrideReason: req.body && req.body.override_reason, policy: await require('../services/governancePolicy').forContext({ siteId: d.site_id }) });
      if (!dec.allow) return res.status(dec.status).json({ ok: false, error: dec.error, code: dec.code, message: dec.message });
      if (dec.override) rdb().logEvent({ category: 'dashboards', action: 'dashboard_publish_override', target: d.key, details: dec.override, risk: 1, ...rdb()._logCtx(req) });
      const out = await store.publish(d.key, { user: req.reportUser, note: req.body && req.body.note ? String(req.body.note).slice(0, 500) : null, override: dec.override });
      rdb().logEvent({ category: 'dashboards', action: 'dashboard_published', target: d.key, details: { version: out.version, submitted_by: d.submitted_by, override: !!dec.override }, ...rdb()._logCtx(req) });
      res.json({ ok: true, dashboard: out });
    } catch (e) {
      if (e.code === 'INVALID') return fail(res, e, 400, { ok: false });
      fail(res, e, 500, { ok: false });
    }
  });

  router.post('/api/dashboards/:key/submit', requireReportSession, requirePublisher, async (req, res) => {
    try {
      const d = await store.get(key(req)); if (!d) return res.status(404).json({ ok: false, error: 'dashboard not found' });
      if (!isAdmin(req.reportUser) && d.owner_id != null && d.owner_id !== req.reportUser.id) return res.status(403).json({ ok: false, error: 'owned by another publisher' });
      const out = await store.submit(d.key, { user: req.reportUser });
      rdb().logEvent({ category: 'dashboards', action: 'dashboard_submitted', target: d.key, ...rdb()._logCtx(req) });
      res.json({ ok: true, dashboard: out });
    } catch (e) {
      if (e.code === 'INVALID') return fail(res, e, 400, { ok: false });
      fail(res, e, 500, { ok: false });
    }
  });
  // Restore version n as the draft; the live snapshot keeps serving until the restored draft is reviewed and published.
  router.post('/api/dashboards/:key/rollback/:n', requireReportSession, requirePublisher, async (req, res) => {
    try {
      const d = await store.get(key(req)); if (!d) return res.status(404).json({ ok: false, error: 'dashboard not found' });
      if (!isAdmin(req.reportUser) && d.owner_id != null && d.owner_id !== req.reportUser.id) return res.status(403).json({ ok: false, error: 'owned by another publisher' });
      const out = await store.rollback(d.key, Number(req.params.n), { user: req.reportUser });
      if (!out) return res.status(404).json({ ok: false, error: 'version not found' });
      rdb().logEvent({ category: 'dashboards', action: 'dashboard_rolled_back', target: d.key, details: { to: Number(req.params.n) }, ...rdb()._logCtx(req) });
      res.json({ ok: true, dashboard: out });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  router.post('/api/dashboards/:key/retire', requireReportSession, requirePublisher, async (req, res) => {
    try {
      const d = await store.get(key(req)); if (!d) return res.status(404).json({ ok: false, error: 'dashboard not found' });
      if (!isAdmin(req.reportUser) && d.owner_id != null && d.owner_id !== req.reportUser.id) return res.status(403).json({ ok: false, error: 'owned by another publisher' });
      const out = await store.setStatus(d.key, 'retired');
      rdb().logEvent({ category: 'dashboards', action: 'dashboard_retired', target: d.key, ...rdb()._logCtx(req) });
      res.json({ ok: true, dashboard: out });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  router.delete('/api/dashboards/:key', requireReportSession, requirePublisher, async (req, res) => {
    try {
      const d = await store.get(key(req)); if (!d) return res.status(404).json({ ok: false, error: 'dashboard not found' });
      if (d.status === 'published') return res.status(409).json({ ok: false, error: 'retire it first' });
      if (!isAdmin(req.reportUser) && d.owner_id != null && d.owner_id !== req.reportUser.id) return res.status(403).json({ ok: false, error: 'owned by another publisher' });
      await store.remove(d.key);
      res.json({ ok: true });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  return router;
};
module.exports.createStore = createStore;
