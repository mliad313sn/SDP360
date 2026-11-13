'use strict';
const xpGate = require('../services/exportPolicy').gate;   // P9 / B7 — one export policy (allow / mask / deny + export log + watermark)
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
const { AUDIENCES, FILTER_TYPES, fieldReadiness, creatableTypes, widgetTypesFor } = require('../services/dashboardWidgets');
const { resolveWidgets } = require('../services/dashboardData');

/** Build the store against the reports DB (sqlite: DDL + seed now; pg: migration 016, seed at boot). */
function createStore(rdbMod, { log = console.log } = {}) {
  const pg = rdbMod.REPORTS_BACKEND === 'postgres';
  const st = require('../services/dashboardStore').makeDashboardStore(({ prepare: (sql) => rdbMod.pgHandle().prepare(sql) }), { isPg: pg });
  
  st.seedAtBoot = async () => {
    await st.init(); const S = require('../services/dashboardSeeds'); const a = await st.seed(S.SEED_DASHBOARDS); if (a.length) log(`[dashboards] seeded ${a.join(', ')}`);
    // F-DATA-11 — dashboard_decision_kpis_seed ('0' default = nothing): '1' saves the candidate dashboard as a DRAFT, never published
    try {
      const c = await require('../services/reportConfig').getConfig(rdbMod.db);
      if (String(c && c.dashboard_decision_kpis_seed) === '1' && !(await st.get(S.DECISION_KPIS.key))) { await st.saveDraft(S.DECISION_KPIS, { user: null }); a.push(S.DECISION_KPIS.key + ' (draft)'); log('[dashboards] decision-kpis saved as a draft (not published)'); }
    } catch (e) { log(`[dashboards] decision-kpis draft not created: ${e.message}`); }
    return a;
  };
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
  requirePublisher.legacyRoles = ['admin', 'dashboard-publisher'];   // C-17 capability catalogue tag
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

  // E-V09 — report_config ui_small_multiples ('0' default): the `multiples` type is offered / accepted only when '1'
  async function smallMultiplesOn() {
    try { const c = await require('../services/reportConfig').getConfig(rdb().db); return String(c && c.ui_small_multiples) === '1'; } catch (_) { return false; }
  }
  router.get('/api/dashboards/catalogue', requireReportSession, requirePublisher, async (req, res) => {
    const reg = registry(); const sm = await smallMultiplesOn();
    res.json({ ok: true, widgetTypes: widgetTypesFor({ smallMultiples: sm }), creatableTypes: creatableTypes({ smallMultiples: sm }), audiences: AUDIENCES, filterTypes: FILTER_TYPES, metrics: reg.list({ status: 'published' }), policies: reg.policies() });
  });

  // ---- E-V08 — human-entered chart annotations (report_config chart_annotations_enabled; '0' = 404) ----------
  //   GET    /api/dashboards/annotations?site=&metric=&from=&to=   read scope = the viewer's sites (+ group-wide notes)
  //   POST   /api/dashboards/annotations                          editor on one of their sites; admin tier anywhere
  //   DELETE /api/dashboards/annotations/:id                       same rule on the note's site (soft delete)
  // Registered BEFORE /api/dashboards/:key so "annotations" is never read as a dashboard key.
  const CA = require('../services/chartAnnotations');
  const annStore = () => deps.annotationStore || CA.makeStore(rdb().pgHandle ? rdb().pgHandle() : rdb().db);
  async function annotationsOn() {
    try { const c = await require('../services/reportConfig').getConfig(rdb().db); return String(c && c.chart_annotations_enabled) === '1'; } catch (_) { return false; }
  }
  const annOff = (res) => fail(res, new Error('chart annotations are not enabled (report_config chart_annotations_enabled=0)'), 404, { ok: false });
  const isEditor = (u) => rdb().userHasRole(u, 'editor');
  router.get('/api/dashboards/annotations', requireReportSession, async (req, res) => {
    try {
      if (!(await annotationsOn())) return annOff(res);
      const u = req.reportUser;
      const scope = isAdmin(u) ? null : userSites.siteIds(u).map(Number);
      let siteIds = scope;
      if (req.query.site != null && req.query.site !== '') {
        const s = Number(req.query.site);
        if (!Number.isInteger(s) || (scope && !scope.includes(s))) return fail(res, new Error('site not in your scope'), 403, { ok: false });
        siteIds = [s];
      }
      const metric = typeof req.query.metric === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(req.query.metric) ? req.query.metric : null;
      const rows = await annStore().list({ siteIds, metric, from: String(req.query.from || '') || null, to: String(req.query.to || '') || null });
      res.json({ ok: true, can_write: isEditor(u), annotations: rows });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });
  router.post('/api/dashboards/annotations', requireReportSession, express.json({ limit: '16kb' }), async (req, res) => {
    try {
      if (!(await annotationsOn())) return annOff(res);
      const u = req.reportUser;
      if (!isEditor(u)) return fail(res, new Error('editor role required'), 403, { ok: false });
      const v = CA.validate(req.body);
      if (!v.ok) return fail(res, new Error(v.errors.join('; ')), 400, { ok: false });
      if (!CA.canWrite(u, v.value.site_id, { isAdmin: isAdmin(u), siteIds: userSites.siteIds(u) })) return fail(res, new Error(v.value.site_id == null ? 'a group-wide note needs the admin tier — pick one of your sites' : 'site not in your scope'), 403, { ok: false });
      const row = await annStore().create(v.value, u.id);
      rdb().logEvent({ category: 'dashboards', action: 'chart_annotation_created', target: String(row.id), ...rdb()._logCtx(req) });
      res.status(201).json({ ok: true, annotation: row });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });
  router.delete('/api/dashboards/annotations/:id', requireReportSession, async (req, res) => {
    try {
      if (!(await annotationsOn())) return annOff(res);
      const u = req.reportUser;
      if (!isEditor(u)) return fail(res, new Error('editor role required'), 403, { ok: false });
      const row = await annStore().get(Number(req.params.id));
      if (!row) return fail(res, new Error('annotation not found'), 404, { ok: false });
      if (!CA.canWrite(u, row.site_id, { isAdmin: isAdmin(u), siteIds: userSites.siteIds(u) })) return fail(res, new Error('site not in your scope'), 403, { ok: false });
      await annStore().remove(row.id, u.id);
      rdb().logEvent({ category: 'dashboards', action: 'chart_annotation_deleted', target: String(row.id), ...rdb()._logCtx(req) });
      res.json({ ok: true });
    } catch (e) { fail(res, e, 500, { ok: false }); }
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
  // shared by the JSON view and the CSV export (G15): same scope checks, same figures, same freshness rule
  async function dashboardData(req, res) {
      const u = req.reportUser;
      const d = await loadVisible(req, res); if (!d) return null;
      const def = (req.query.draft === '1' && isPublisher(u)) ? d.definition : ((await store.published(d.key)) || d).definition;
      const sites = await scopeSites(u);
      if (!sites.length) { res.json({ ok: true, key: d.key, site: null, sites: [], widgets: {}, note: 'no site in your scope' }); return null; }
      let site = req.query.site == null || req.query.site === '' ? null : Number(req.query.site);
      if (site != null && !sites.some(s => Number(s.id) === site)) { res.status(403).json({ ok: false, error: 'site not in your scope' }); return null; }
      if (site == null) site = Number(sites[0].id);
      const window = req.query.window ? String(req.query.window).slice(0, 24) : null;
      const now = new Date();
      const out = await resolveWidgets({ def, sites, site, window, reg: registry(), dd: readerDeps(), rdb: rdb(), now });
      // G-14 — say which source behind these widgets is stale or has never synced (the viewer shows a banner).
      const gate = require('../services/publishGate'); const reg = registry();
      const mods = [...new Set(((def && def.widgets) || []).flatMap(w => (w ? [w.metric].concat(Array.isArray(w.series) ? w.series : []) : [])).map(k => k && reg.get(k)).filter(Boolean).map(m => m.module))];
      const jobs = gate.jobsFor(mods);
      const lastOk = deps.lastSyncOk ? await deps.lastSyncOk(jobs) : await gate.lastOkFromSyncStore(jobs);
      const fr = gate.freshness(mods, lastOk, now.getTime(), await require('../services/governancePolicy').forContext({}));
      const stale = fr.sources.filter(x => x.state !== 'FRESH');
      gate.degradeStale(out, def, reg, stale);   // G05: stale source → value kept, colour withdrawn
      // F21 — `as_of`/`computed_at` is when THIS response was computed; `sources` says how recent the data
      // behind it is (last successful sync per source job, null = never synced) — the screen shows both.
      const sources = fr.sources.map(x => ({ module: x.module, job: x.job, last_success: x.last_ok, state: x.state }));
      return { ok: true, key: d.key, version: d.version, site, sites: sites.map(s => ({ id: Number(s.id), name: s.name })), window, as_of: now.toISOString(), computed_at: now.toISOString(), sources, widgets: out, stale_sources: stale };
  }
  router.get('/api/dashboards/:key/data', requireReportSession, async (req, res) => {
    try { const v = await dashboardData(req, res); if (v) res.json(v); } catch (e) { fail(res, e, 500, { ok: false }); }
  });
  // G15 — the figures behind a dashboard as CSV (one row per value, with unit, window, as-of, freshness, partial, n, target, low sample, error)
  router.get('/api/dashboards/:key/data.csv', requireReportSession, xpGate('dashboards.csv'), async (req, res) => {
    try {
      const v = await dashboardData(req, res); if (!v) return;
      // F-DATA-05 — rows built by services/dashboardCsv (freshness read from the sources, never a literal default)
      const CSV = require('../services/dashboardCsv'); const text = CSV.toCsv(CSV.dashboardCsvRows(v, registry()));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="dashboard-${String(v.key).replace(/[^a-z0-9_-]/gi, '')}.csv"`);
      res.send(text);
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
      const pubMetrics = reg.list({ status: 'published' });
      const saved = await store.saveDraft(doc, { user: u, siteId, metrics: pubMetrics.map(m => m.key), metricUnits: Object.fromEntries(pubMetrics.map(m => [m.key, m.unit || ''])), metricKinds: Object.fromEntries(pubMetrics.map(m => [m.key, m.window_kind || ''])), metricInfo: Object.fromEntries(pubMetrics.map(m => [m.key, { name: m.name, unit: m.unit || '', window_kind: m.window_kind || '', rag_policy: m.rag_policy || null }])), smallMultiples: await smallMultiplesOn() });
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
      const out = await store.publish(d.key, { user: req.reportUser, note: req.body && req.body.note ? String(req.body.note).slice(0, 500) : null, override: dec.override, expect: { updated_at: d.updated_at, submitted_at: d.submitted_at } });
      rdb().logEvent({ category: 'dashboards', action: 'dashboard_published', target: d.key, details: { version: out.version, submitted_by: d.submitted_by, override: !!dec.override }, ...rdb()._logCtx(req) });
      res.json({ ok: true, dashboard: out });
    } catch (e) {
      if (e.code === 'INVALID') return fail(res, e, 400, { ok: false });
      if (e.code === 'STALE') return fail(res, e, 409, { ok: false, code: 'STALE' });
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
      rdb().logEvent({ category: 'dashboards', action: 'dashboard_deleted', target: d.key, ...rdb()._logCtx(req) });
      res.json({ ok: true });
    } catch (e) { if (e.code === 'CONFLICT') return fail(res, e, 409, { ok: false }); fail(res, e, 500, { ok: false }); }
  });

  return router;
};
module.exports.createStore = createStore;
