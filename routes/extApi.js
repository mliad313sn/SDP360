'use strict';
// Step 9 — EXTERNAL publishing API for machine consumers (Power BI, SharePoint, scripts), outside
// the session gate: every call carries an API key in a HEADER — `X-Api-Key: <key>` or
// `Authorization: Bearer <key>` — checked against the hashed consumer register, with a per-key
// rate limit (fiche M7, default 60 req/min, memory window keyed by the key's sha256), a daily quota
// and a call log (services/engagementStore). `?api_key=` is REFUSED (400 + migration message):
// keys in a URL end up in proxy logs and browser histories. Read-only. Figures through the metric registry — the same
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

const crypto = require('crypto');
const OData = require('../services/odata');
const { memoryStore, decide } = require('../services/rateLimit');

const QUERY_KEY_MESSAGE = 'api_key in the query string is no longer accepted: send the key in the X-Api-Key header (or Authorization: Bearer <key>)';

module.exports = function extApiRoutes(deps) {
  const { express, store } = deps;
  const router = express.Router();
  const rdb = () => deps.rdb || require('../reports-db');
  const registry = () => deps.registry || require('../services/metricRegistry').current();
  const reportConfig = deps.reportConfig || require('../services/reportConfig');
  const readerDeps = () => deps.readerDeps || { rdb: rdb(), mdb: require('../meetings-db'), idb: require('../inspection-db'), adb: require('../assets-db'), tracker: require('../tracker-db'), trackerScore: require('../tracker-pptx') };
  const MAX_METRICS = 20;
  // Per-key limiter: `deps.ratePerMinute` (tests) → EXT_API_RATE_PER_MIN → 60. Keyed by the sha256
  // of the presented key, never by IP (several Power BI refreshes share one egress address).
  const RATE_MAX = Math.max(1, Number(deps.ratePerMinute || process.env.EXT_API_RATE_PER_MIN) || 60);
  const RATE_WINDOW_MS = 60 * 1000;
  const rateStore = deps.rateStore || memoryStore();
  const keyHash = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');

  function presentedKey(req) {
    const h = req.get('x-api-key'); if (h) return String(h).trim();
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.get('authorization') || '').trim()); return m ? m[1] : '';
  }

  async function auth(req, res, next) {
    if (req.query && Object.prototype.hasOwnProperty.call(req.query, 'api_key')) return res.status(400).json({ error: QUERY_KEY_MESSAGE });
    const key = presentedKey(req).slice(0, 200);
    const started = Date.now();
    const a = await store.authenticate(key);
    if (a.error) { if (a.consumer) store.logCall(a.consumer.id, { path: req.path, status: a.error === 'quota' ? 429 : 401, ms: 0 }).catch(() => {}); return res.status(a.error === 'quota' ? 429 : 401).json({ error: a.error === 'quota' ? 'daily quota exceeded' : 'invalid or revoked API key' }); }
    const now = Date.now(); const rl = decide(await rateStore.bump('ext-api', keyHash(key), now, RATE_WINDOW_MS), { max: RATE_MAX, windowMs: RATE_WINDOW_MS, now });
    if (!rl.allowed) { res.setHeader('Retry-After', String(rl.retryAfterSec)); store.logCall(a.consumer.id, { path: req.path, status: 429, ms: 0 }).catch(() => {}); return res.status(429).json({ error: 'rate limit exceeded', retry_after_sec: rl.retryAfterSec }); }
    req.consumer = a.consumer; res.setHeader('X-Quota-Remaining', String(a.quota_left)); res.setHeader('X-RateLimit-Limit', String(RATE_MAX));
    res.on('finish', () => { store.logCall(a.consumer.id, { path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Date.now() - started }).catch(() => {}); });
    next();
  }
  const needScope = (s) => (req, res, next) => (req.consumer.scopes || []).includes(s) ? next() : res.status(403).json({ error: `scope ${s} required` });
  async function sites() { return ((await rdb().listSites({ includeInactive: false })) || []).map(s => ({ id: Number(s.id), name: s.name, country: s.country || null, active: s.active !== 0 })); }
  // G-14 extended to /ext (committee review 2026-10-28): every value says whether its source synced recently.
  // A value whose source is STALE or has never synced (UNKNOWN) is still served — a consumer may chart it —
  // but carries authoritative:false, and the response header X-SDP-Freshness says "stale".
  const gate = require('../services/publishGate');
  async function freshnessByModule(mods) {
    const jobs = gate.jobsFor(mods);
    const lastOk = deps.lastSyncOk ? await deps.lastSyncOk(jobs) : await gate.lastOkFromSyncStore(jobs);
    const nowMs = Date.now(); const out = {}; const pol = await require('../services/governancePolicy').forContext({});
    for (const m of mods) out[m] = gate.moduleFreshness(m, lastOk, nowMs, pol).state;
    return out;
  }
  async function values(keys, { site = null, window = null } = {}) {
    const reg = registry(); const dd = readerDeps(); const now = new Date(); const all = await sites(); const out = [];
    const fr = await freshnessByModule([...new Set(keys.slice(0, MAX_METRICS).map((k) => reg.get(k)).filter(Boolean).map((m) => m.module))]);
    const tag = (row) => { const st = fr[row.module] || 'FRESH'; row.freshness = st; row.authoritative = st === 'FRESH'; return row; };
    for (const k of keys.slice(0, MAX_METRICS)) { const m = reg.get(k); if (!m) continue; const fleet = /\.fleet$/.test(m.reader || ''); const targets = fleet ? [null] : (site != null ? all.filter(s => s.id === Number(site)) : all);
      for (const s of targets) { try { const r = await reg.resolve(k, { site: s ? s.id : null, window, deps: dd, now }); out.push(tag({ metric: k, name: m.name, module: m.module, site_id: s ? s.id : null, site: s ? s.name : 'fleet', window: r && r.window && r.window.label || null, value: r ? r.value : null, unit: m.unit, rag: r ? r.rag : 'NA', as_of: r && r.as_of || null })); } catch (e) { out.push(tag({ metric: k, module: m.module, site_id: s ? s.id : null, site: s ? s.name : 'fleet', value: null, unit: m.unit, rag: 'NA', error: 'reader_error' })); } } }
    return out;
  }
  const dict = () => registry().list({ status: 'published' }).map(m => ({ key: m.key, name: m.name, name_fr: m.name_fr, module: m.module, unit: m.unit, window_kind: m.window_kind, higher_is_better: m.higher_is_better !== false, formula: m.formula, rag_policy: m.rag_policy }));
  async function publishKeys() { try { const c = await reportConfig.getConfig(rdb().db); const ks = String(c.publish_metric_keys || '').split(/[,\s]+/).filter(Boolean); return ks.length ? ks : ['helpdesk.resolution_sla_pct', 'helpdesk.first_reply_sla_pct', 'inspection.conformity_pct', 'meetings.engagement_score', 'assets.completeness_pct', 'tracker.site_score_pct']; } catch (_) { return ['helpdesk.resolution_sla_pct']; } }

  const freshHeader = (res, vs) => res.setHeader('X-SDP-Freshness', vs.every((v) => v.authoritative) ? 'fresh' : 'stale');
  router.use(['/ext/v1', '/ext/odata'], auth);
  router.get('/ext/v1/metrics', needScope('metrics:read'), (req, res) => res.json({ metrics: dict(), as_of: new Date().toISOString() }));
  router.get('/ext/v1/sites', needScope('sites:read'), async (req, res) => { try { res.json({ sites: await sites() }); } catch (e) { res.status(500).json({ error: 'internal_error' }); } });
  router.get('/ext/v1/metrics/:key/values', needScope('values:read'), async (req, res) => { try { if (!registry().has(req.params.key)) return res.status(404).json({ error: 'unknown metric' }); const vs = await values([req.params.key], { site: req.query.site, window: req.query.window ? String(req.query.window).slice(0, 24) : null }); freshHeader(res, vs); res.json({ metric: req.params.key, values: vs }); } catch (e) { res.status(500).json({ error: 'internal_error' }); } });
  router.get('/ext/v1/values', needScope('values:read'), async (req, res) => { try { const keys = String(req.query.metrics || '').split(',').map(k => k.trim()).filter(Boolean); if (!keys.length) return res.status(400).json({ error: 'metrics=a,b required' }); if (keys.length > MAX_METRICS) return res.status(400).json({ error: `at most ${MAX_METRICS} metrics per call` }); const vs = await values(keys, { site: req.query.site, window: req.query.window ? String(req.query.window).slice(0, 24) : null }); freshHeader(res, vs); res.json({ values: vs }); } catch (e) { res.status(500).json({ error: 'internal_error' }); } });

  // Fiche M7 — the OData base is the configured `public_base_url` (the address Power BI really
  // reaches), never the Host header a client controls; unset → a relative base, which OData
  // clients resolve against the request URL.
  async function base() {
    try { const c = await reportConfig.getConfig(rdb().db); const u = String(c.public_base_url || '').trim().replace(/\/+$/, ''); if (/^https?:\/\//i.test(u)) return `${u}/ext/odata`; } catch (_) { /* relative fallback */ }
    return '/ext/odata';
  }
  // Generic texts only: an internal message (SQL, path, host) never reaches an external consumer.
  const ODATA_TEXT = { INVALID: 'invalid query option', NOT_FOUND: 'not found' };
  const odataErr = (res, e) => { const code = e && (e.code === 'INVALID' || e.code === 'NOT_FOUND') ? e.code : 'ERR'; res.status(code === 'INVALID' ? 400 : code === 'NOT_FOUND' ? 404 : 500).json({ error: { code, message: ODATA_TEXT[code] || 'internal error' } }); };
  router.get('/ext/odata/', async (req, res) => res.json(OData.serviceDocument(await base())));
  // `$` is a regex anchor in a path string — a RegExp route is the only form that matches $metadata.
  router.get(/^\/ext\/odata\/\$metadata$/, (req, res) => res.type('application/xml').send(OData.metadataXml()));
  router.get('/ext/odata/Metrics', needScope('metrics:read'), async (req, res) => { try { res.json(OData.collection(await base(), 'Metrics', dict().map(m => ({ Key: m.key, Name: m.name, Module: m.module, Unit: m.unit, WindowKind: m.window_kind, HigherIsBetter: m.higher_is_better, Formula: m.formula })), req.query)); } catch (e) { odataErr(res, e); } });
  router.get('/ext/odata/Sites', needScope('sites:read'), async (req, res) => { try { res.json(OData.collection(await base(), 'Sites', (await sites()).map(s => ({ Id: s.id, Name: s.name, Country: s.country, Active: s.active })), req.query)); } catch (e) { odataErr(res, e); } });
  router.get('/ext/odata/Values', needScope('values:read'), async (req, res) => {
    try { const b = await base(); OData.collection(b, 'Values', [], req.query); // validate every query option BEFORE resolving any metric
      const f = String(req.query.$filter || ''); const mk = [...f.matchAll(/Metric\s+eq\s+'([^']+)'/gi)].map(m => m[1]); const sm = f.match(/SiteId\s+eq\s+(\d+)/i); const wm = f.match(/Window\s+eq\s+'([^']+)'/i);
      const rows = (await values(mk.length ? mk : await publishKeys(), { site: sm ? Number(sm[1]) : null, window: wm ? wm[1] : null })).map(v => ({ Id: `${v.metric}|${v.site_id == null ? 'fleet' : v.site_id}|${v.window || ''}`, Metric: v.metric, SiteId: v.site_id, Site: v.site, Window: v.window, Value: v.value, Unit: v.unit, Rag: v.rag, AsOf: v.as_of, Freshness: v.freshness, Authoritative: v.authoritative }));
      res.json(OData.collection(b, 'Values', rows, req.query)); } catch (e) { odataErr(res, e); }
  });
  return router;
};
module.exports.QUERY_KEY_MESSAGE = QUERY_KEY_MESSAGE;
