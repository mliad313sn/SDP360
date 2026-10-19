'use strict';
// Step 9 — EXTERNAL publishing API for machine consumers (Power BI, SharePoint, scripts), outside
// the session gate: every call carries an API key (`X-Api-Key` header or `?api_key=` for clients
// that cannot set headers), checked against the hashed consumer register, with a daily quota and a
// call log (services/engagementStore). Read-only. Figures through the metric registry — the same
// readers as the dashboards. Site names are the only "names" that leave the platform (no PII).
//
//   GET /ext/v1/metrics                      the KPI dictionary (published)                     scope metrics:read
//   GET /ext/v1/sites                        active sites                                        scope sites:read
//   GET /ext/v1/metrics/:key/values?site=&window=   one metric, all sites or one                 scope values:read
//   GET /ext/v1/values?metrics=a,b&site=&window=    several metrics (max 20)                     scope values:read
//   GET /ext/odata/                          OData v4 service document (Power BI "OData feed")
//   GET /ext/odata/$metadata                 CSDL
//   GET /ext/odata/Metrics | Sites | Values  entity sets ($filter, $top, $skip, $orderby, $select, $count)
// Values without a `Metric eq` filter resolve the keys listed in config `publish_metric_keys` (bounded).

const OData = require('../services/odata');

module.exports = function extApiRoutes(deps) {
  const { express, store } = deps;
  const router = express.Router();
  const rdb = () => deps.rdb || require('../reports-db');
  const registry = () => deps.registry || require('../services/metricRegistry').current();
  const reportConfig = deps.reportConfig || require('../services/reportConfig');
  const readerDeps = () => deps.readerDeps || { rdb: rdb(), mdb: require('../meetings-db'), idb: require('../inspection-db'), adb: require('../assets-db'), tracker: require('../tracker-db'), trackerScore: require('../tracker-pptx') };
  const MAX_METRICS = 20;

  async function auth(req, res, next) {
    const key = req.get('x-api-key') || (req.query && req.query.api_key) || '';
    const started = Date.now();
    const a = await store.authenticate(String(key).slice(0, 200));
    if (a.error) { if (a.consumer) store.logCall(a.consumer.id, { path: req.path, status: a.error === 'quota' ? 429 : 401, ms: 0 }).catch(() => {}); return res.status(a.error === 'quota' ? 429 : 401).json({ error: a.error === 'quota' ? 'daily quota exceeded' : 'invalid or revoked API key' }); }
    req.consumer = a.consumer; res.setHeader('X-Quota-Remaining', String(a.quota_left));
    res.on('finish', () => { store.logCall(a.consumer.id, { path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Date.now() - started }).catch(() => {}); });
    next();
  }
  const needScope = (s) => (req, res, next) => (req.consumer.scopes || []).includes(s) ? next() : res.status(403).json({ error: `scope ${s} required` });
  async function sites() { return ((await rdb().listSites({ includeInactive: false })) || []).map(s => ({ id: Number(s.id), name: s.name, country: s.country || null, active: s.active !== 0 })); }
  async function values(keys, { site = null, window = null } = {}) {
    const reg = registry(); const dd = readerDeps(); const now = new Date(); const all = await sites(); const out = [];
    for (const k of keys.slice(0, MAX_METRICS)) { const m = reg.get(k); if (!m) continue; const fleet = /\.fleet$/.test(m.reader || ''); const targets = fleet ? [null] : (site != null ? all.filter(s => s.id === Number(site)) : all);
      for (const s of targets) { try { const r = await reg.resolve(k, { site: s ? s.id : null, window, deps: dd, now }); out.push({ metric: k, name: m.name, module: m.module, site_id: s ? s.id : null, site: s ? s.name : 'fleet', window: r && r.window && r.window.label || null, value: r ? r.value : null, unit: m.unit, rag: r ? r.rag : 'NA', as_of: r && r.as_of || null }); } catch (e) { out.push({ metric: k, site_id: s ? s.id : null, site: s ? s.name : 'fleet', value: null, unit: m.unit, rag: 'NA', error: String(e.message || e).slice(0, 120) }); } } }
    return out;
  }
  const dict = () => registry().list({ status: 'published' }).map(m => ({ key: m.key, name: m.name, name_fr: m.name_fr, module: m.module, unit: m.unit, window_kind: m.window_kind, higher_is_better: m.higher_is_better !== false, formula: m.formula, rag_policy: m.rag_policy }));
  async function publishKeys() { try { const c = await reportConfig.getConfig(rdb().db); const ks = String(c.publish_metric_keys || '').split(/[,\s]+/).filter(Boolean); return ks.length ? ks : ['helpdesk.resolution_sla_pct', 'helpdesk.first_reply_sla_pct', 'inspection.conformity_pct', 'meetings.engagement_score', 'assets.completeness_pct', 'tracker.site_score_pct']; } catch (_) { return ['helpdesk.resolution_sla_pct']; } }

  router.use(['/ext/v1', '/ext/odata'], auth);
  router.get('/ext/v1/metrics', needScope('metrics:read'), (req, res) => res.json({ metrics: dict(), as_of: new Date().toISOString() }));
  router.get('/ext/v1/sites', needScope('sites:read'), async (req, res) => { try { res.json({ sites: await sites() }); } catch (e) { res.status(500).json({ error: e.message }); } });
  router.get('/ext/v1/metrics/:key/values', needScope('values:read'), async (req, res) => { try { if (!registry().has(req.params.key)) return res.status(404).json({ error: 'unknown metric' }); res.json({ metric: req.params.key, values: await values([req.params.key], { site: req.query.site, window: req.query.window ? String(req.query.window).slice(0, 24) : null }) }); } catch (e) { res.status(500).json({ error: e.message }); } });
  router.get('/ext/v1/values', needScope('values:read'), async (req, res) => { try { const keys = String(req.query.metrics || '').split(',').map(k => k.trim()).filter(Boolean); if (!keys.length) return res.status(400).json({ error: 'metrics=a,b required' }); if (keys.length > MAX_METRICS) return res.status(400).json({ error: `at most ${MAX_METRICS} metrics per call` }); res.json({ values: await values(keys, { site: req.query.site, window: req.query.window ? String(req.query.window).slice(0, 24) : null }) }); } catch (e) { res.status(500).json({ error: e.message }); } });

  const base = (req) => `${req.protocol}://${req.get('host')}/ext/odata`;
  const odataErr = (res, e) => res.status(e.code === 'INVALID' ? 400 : e.code === 'NOT_FOUND' ? 404 : 500).json({ error: { code: e.code || 'ERR', message: e.message } });
  router.get('/ext/odata/', (req, res) => res.json(OData.serviceDocument(base(req))));
  // `$` is a regex anchor in a path string — a RegExp route is the only form that matches $metadata.
  router.get(/^\/ext\/odata\/\$metadata$/, (req, res) => res.type('application/xml').send(OData.metadataXml()));
  router.get('/ext/odata/Metrics', needScope('metrics:read'), (req, res) => { try { res.json(OData.collection(base(req), 'Metrics', dict().map(m => ({ Key: m.key, Name: m.name, Module: m.module, Unit: m.unit, WindowKind: m.window_kind, HigherIsBetter: m.higher_is_better, Formula: m.formula })), req.query)); } catch (e) { odataErr(res, e); } });
  router.get('/ext/odata/Sites', needScope('sites:read'), async (req, res) => { try { res.json(OData.collection(base(req), 'Sites', (await sites()).map(s => ({ Id: s.id, Name: s.name, Country: s.country, Active: s.active })), req.query)); } catch (e) { odataErr(res, e); } });
  router.get('/ext/odata/Values', needScope('values:read'), async (req, res) => {
    try { const f = String(req.query.$filter || ''); const mk = [...f.matchAll(/Metric\s+eq\s+'([^']+)'/gi)].map(m => m[1]); const sm = f.match(/SiteId\s+eq\s+(\d+)/i); const wm = f.match(/Window\s+eq\s+'([^']+)'/i);
      const rows = (await values(mk.length ? mk : await publishKeys(), { site: sm ? Number(sm[1]) : null, window: wm ? wm[1] : null })).map(v => ({ Id: `${v.metric}|${v.site_id == null ? 'fleet' : v.site_id}|${v.window || ''}`, Metric: v.metric, SiteId: v.site_id, Site: v.site, Window: v.window, Value: v.value, Unit: v.unit, Rag: v.rag, AsOf: v.as_of }));
      res.json(OData.collection(base(req), 'Values', rows, req.query)); } catch (e) { odataErr(res, e); }
  });
  return router;
};
