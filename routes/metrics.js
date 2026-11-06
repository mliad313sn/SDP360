'use strict';
const { fail } = require('../services/httpError');
// Step 3 — the KPI dictionary as an API. Every figure the platform shows has a key here.
//   GET /api/metrics/registry[?module=]      the dictionary (+ RAG policies) — any session
//   GET /api/metrics/:key?site=<id>&window=  one value through the registered reader (+ target / vs_target, committee #40)
//   GET|POST /api/metrics/targets[/:id/end]  per-site KPI targets (writes super_admin)
// Site scope: the admin tier reads any site; an editor/viewer only one of their sites
// (services/userSites — never user.site_id === x). Fleet metrics (no site) are open to all.
module.exports = function metricsRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  const registry = () => deps.registry || require('../services/metricRegistry').current();
  const rdb = () => deps.rdb || require('../reports-db');
  const readerDeps = () => deps.readerDeps || {
    rdb: rdb(), mdb: require('../meetings-db'), idb: require('../inspection-db'), adb: require('../assets-db'),
    tracker: require('../tracker-db'), trackerScore: require('../tracker-pptx'),
  };

  router.get('/api/metrics/registry', requireReportSession, (req, res) => {
    const reg = registry();
    const metrics = reg.list({ module: req.query.module ? String(req.query.module) : null, status: req.query.status === 'all' ? null : 'published' });
    res.json({ ok: true, count: metrics.length, metrics, policies: reg.policies() });
  });

  const KT = require('../services/kpiTargets');
  const targetStore = () => deps.targetStore || KT.makeKpiTargetStore(rdb().pgHandle());
  const isSuper = (u) => rdb().userHasRole(u, 'super_admin');
  const requireSuper = (req, res, next) => (isSuper(req.reportUser) ? next() : res.status(403).json({ ok: false, error: 'super_admin role required' }));
  requireSuper.legacyRoles = ['super_admin'];   // C-17 capability catalogue tag
  const json = express.json({ limit: '8kb' });
  // GET  /api/metrics/targets                        live targets (any session — targets are not secret)
  // POST /api/metrics/targets   { metric_key, site_id|null, target, effective_from?, reason }   super_admin (committee decision)
  // POST /api/metrics/targets/:id/end   { reason }   super_admin
  router.get('/api/metrics/targets', requireReportSession, async (req, res) => {
    try { res.json({ ok: true, targets: await targetStore().list() }); } catch (e) { fail(res, e, undefined, { ok: false }); }
  });
  router.post('/api/metrics/targets', requireReportSession, requireSuper, json, async (req, res) => {
    try {
      const reg = registry(); const id = await targetStore().set(req.body || {}, { actorId: req.reportUser.id, knownKey: (k) => !!reg.get(String(k || '')) });
      try { await rdb().logEvent({ category: 'governance', action: 'kpi_target_set', target: String((req.body || {}).metric_key), details: { id, site_id: (req.body || {}).site_id ?? null, target: (req.body || {}).target }, ...rdb()._logCtx(req) }); } catch (_) {}
      res.status(201).json({ ok: true, id });
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });
  router.post('/api/metrics/targets/:id/end', requireReportSession, requireSuper, json, async (req, res) => {
    try { await targetStore().end(req.params.id, { actorId: req.reportUser.id, reason: (req.body || {}).reason }); res.json({ ok: true }); } catch (e) { fail(res, e, undefined, { ok: false }); }
  });

  // E-K04 — GET /api/metrics/:key/explain?site=&a=&b=  deterministic description of the change from window a to b.
  // Switch metric_explain_enabled='0' → 404. Same site scope as /api/metrics/:key; without ?site the parts are the
  // caller's sites (admin tier: every active site). Counts: per-site contributions; ratios: numerator / denominator
  // changes only. The note is data-generated (kind 'data_note'), never written into an editorial field.
  const VX = require('../services/variationExplain');
  const RATIO_FIELDS = { 'helpdesk.closure_pct': ['closed', 'inbound'] };   // the only ratio whose reader returns both terms
  router.get('/api/metrics/:key/explain', requireReportSession, async (req, res) => {
    try {
      const cfg = await (deps.reportConfig || require('../services/reportConfig')).getConfig(rdb().db);
      if (String(cfg.metric_explain_enabled) !== '1') return fail(res, new Error('variation explanation is not enabled'), 404, { ok: false });
      const reg = registry();
      const key = String(req.params.key || '').slice(0, 80);
      const m = reg.get(key);
      if (!m) return fail(res, new Error(`unknown metric ${key}`), 404, { ok: false });
      const a = req.query.a ? String(req.query.a).slice(0, 24) : null, b = req.query.b ? String(req.query.b).slice(0, 24) : null;
      if (!a || !b) return fail(res, new Error('both windows are required: ?a=<window>&b=<window>'), 400, { ok: false });
      const siteRaw = req.query.site;
      const site = siteRaw == null || siteRaw === '' ? null : Number(siteRaw);
      if (siteRaw != null && siteRaw !== '' && !(Number.isInteger(site) && site > 0)) return fail(res, new Error('site must be a positive integer id'), 400, { ok: false });
      const user = req.reportUser;
      const admin = rdb().userHasRole(user, 'admin');
      const US = require('../services/userSites');
      if (site != null && !admin && !US.hasSite(user, site)) return fail(res, new Error('site not in your scope'), 403, { ok: false });
      if (m.reader === 'tracker.fleet') return fail(res, new Error(`metric ${key} is a fleet figure — no per-site decomposition`), 400, { ok: false });
      const all = ((await rdb().listSites()) || []).filter((s) => s.active !== 0 && s.active !== false);
      const sites = site != null ? all.filter((s) => Number(s.id) === site) : all.filter((s) => admin || US.hasSite(user, Number(s.id)));
      if (!sites.length) return fail(res, new Error('no site in your scope'), 403, { ok: false });
      const d = readerDeps();
      const at = async (s, w) => { try { return await reg.resolve(key, { site: Number(s.id), window: w, deps: d }); } catch (_) { return null; } };
      const pairs = await Promise.all(sites.map(async (s) => ({ s, ra: await at(s, a), rb: await at(s, b) })));
      const win = (r) => (r && r.window ? r.window.label : null);
      const wa = win(pairs[0].ra) || a, wb = win(pairs[0].rb) || b;
      let out;
      if (String(m.unit) === 'count') {
        out = VX.explainCount({ metric: key, a: wa, b: wb, parts: pairs.map((p) => ({ key: Number(p.s.id), label: p.s.name, a: p.ra && p.ra.value, b: p.rb && p.rb.value })) });
      } else if (String(m.unit) === '%' && sites.length === 1) {
        const side = (r) => { const f = RATIO_FIELDS[key], rec = r && r.record; return { value: r && r.value, num: f && rec ? rec[f[0]] : null, den: f && rec ? rec[f[1]] : (r && r.base ? r.base.n : null) }; };
        out = VX.explainRatio({ metric: key, a: wa, b: wb, sideA: side(pairs[0].ra), sideB: side(pairs[0].rb) });
      } else if (String(m.unit) === '%') {
        return fail(res, new Error('a ratio is decomposed for ONE site (?site=<id>) — a fleet ratio is not a sum of site ratios'), 400, { ok: false });
      } else {
        return res.json({ ok: true, metric: key, kind: 'not_decomposable', unit: m.unit, note: `a ${m.unit} figure is neither an additive count nor a ratio — no decomposition` });
      }
      res.json({ ok: true, ...out, unit: m.unit, data_note: VX.dataNote(out, m.name) });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  router.get('/api/metrics/:key', requireReportSession, async (req, res) => {
    const reg = registry();
    const key = String(req.params.key || '').slice(0, 80);
    const m = reg.get(key);
    if (!m) return res.status(404).json({ ok: false, error: `unknown metric ${key}` });
    const siteRaw = req.query.site;
    const site = siteRaw == null || siteRaw === '' ? null : Number(siteRaw);
    if (siteRaw != null && siteRaw !== '' && !(Number.isInteger(site) && site > 0)) return res.status(400).json({ ok: false, error: 'site must be a positive integer id' });
    const user = req.reportUser;
    const admin = rdb().userHasRole(user, 'admin');
    if (site != null && !admin && !require('../services/userSites').hasSite(user, site)) return res.status(403).json({ ok: false, error: 'site not in your scope' });
    if (site == null && m.reader !== 'tracker.fleet') return res.status(400).json({ ok: false, error: `metric ${key} needs ?site=<id>` });
    const window = req.query.window ? String(req.query.window).slice(0, 24) : null;
    try {
      const out = await reg.resolve(key, { site, window, deps: readerDeps() });
      // committee #40 — the committee's target for this site (or the platform), and the value against it
      let target = { target: null, source: null };
      try { target = KT.targetFor(await targetStore().list(), key, site, new Date().toISOString()); } catch (_) { /* table absent: no target, as before */ }
      const vs = KT.vsTarget(out && out.value, target.target, m.higher_is_better !== false);
      res.json({ ok: true, ...out, target: target.target, target_source: target.source, vs_target: vs });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });
  return router;
};
