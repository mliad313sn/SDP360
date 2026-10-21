'use strict';
const { fail } = require('../services/httpError');
// Step 3 — the KPI dictionary as an API. Every figure the platform shows has a key here.
//   GET /api/metrics/registry[?module=]      the dictionary (+ RAG policies) — any session
//   GET /api/metrics/:key?site=<id>&window=  one value through the registered reader
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
      res.json({ ok: true, ...out });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });
  return router;
};
