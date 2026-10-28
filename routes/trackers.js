'use strict';
const { fail: httpFail } = require('../services/httpError');
// Step 7 — generic trackers: builder (definitions), entry runtime, source bindings, exports,
// legacy IT Activity Tracker migration. Every score comes from services/trackerDefinitions.score.
//
//   GET  /api/trackers                          list (published for everyone; drafts for builders)
//   GET  /api/trackers/catalogue                KPI types, RAG policies, period kinds, bindable metrics
//   GET  /api/trackers/templates                shipped templates (seeded as drafts)
//   GET  /api/trackers/legacy/compare?year=     parallel run engine vs tracker-pptx (json | ?format=csv)   [builder]
//   POST /api/trackers/legacy/import?year=      import the live IT Activity Tracker as a definition + entries [builder]
//   GET/PUT /api/trackers/legacy/cutover        cut-over switch (report_config tracker_engine_cutover)        [super_admin]
//   GET  /api/trackers/:key                     definition (+ published snapshot)
//   PUT  /api/trackers/:key                     save a draft (validated 400)                                 [builder]
//   POST /api/trackers/:key/dry-run             validate + score a candidate definition against stored entries [builder]
//   POST /api/trackers/:key/submit              [builder]   then /publish by ANOTHER builder (G-23 four-eyes)
//   POST /api/trackers/:key/publish | /retire   [builder]      GET /versions · POST /rollback/:n              [builder]
//   DELETE /api/trackers/:key                   draft/retired only                                            [builder]
//   GET  /api/trackers/:key/entries?unit=       cells (+ closed slots + the caller's writable units)
//   PUT  /api/trackers/:key/entries             { cells:[{unit,item,slot,value,note}] } — month lock, unit scope [editor]
//   GET/PUT /api/trackers/:key/targets          per-unit targets/active                                      [editor]
//   GET  /api/trackers/:key/score?period=       engine result
//   POST /api/trackers/:key/sync                fill source-bound items from the KPI dictionary              [builder]
//   POST /api/trackers/:key/import              xlsx (Entries sheet) → cells, same lock/scope as PUT         [editor]
//   GET  /api/trackers/:key/export.xlsx | .pptx
//
// Builder = admin tier OR tracker-admin. Editor = builder OR tracker-editor on their own unit(s)
// (unit code ↔ the site's tracker code, services/userSites — never user.site_id === x).

const Defs = require('../services/trackerDefinitions');
const Sources = require('../services/trackerSources');
const Legacy = require('../services/trackerLegacy');
const Exp = require('../services/trackerExport');
const Lock = require('../public/lib/trackerMonthLock');

/** Store against tracker.db (sqlite: DDL + template seed now) or the shared PG (migration tracker/002, seed at boot). */
function createStore(trackerDb, { log = console.log } = {}) {
  const pg = trackerDb.TRACKER_BACKEND === 'postgres';
  const st = require('../services/trackerStore').makeTrackerStore(({ prepare: (sql) => trackerDb.pgHandle().prepare(sql) }), { isPg: pg });
  const seedTemplates = async () => { const { TEMPLATES } = require('../services/trackerTemplates'); const added = []; for (const t of TEMPLATES) { if (await st.get(t.key)) continue; await st.saveDraft(t, { user: null }); added.push(t.key); } if (added.length) log(`[trackers] seeded templates ${added.join(', ')}`); return added; };
  
  st.seedAtBoot = async () => {  await st.init(); return seedTemplates(); };
  return st;
}

module.exports = function trackersRoutes(deps) {
  const { express, requireReportSession, store } = deps;
  const router = express.Router();
  const rdb = () => deps.rdb || require('../reports-db');
  const tdb = () => deps.trackerDb || require('../tracker-db');
  const legacyScore = () => deps.trackerScore || require('../tracker-pptx');
  const registry = () => deps.registry || require('../services/metricRegistry').current();
  const reportConfig = deps.reportConfig || require('../services/reportConfig');
  const userSites = require('../services/userSites');
  const readerDeps = () => deps.readerDeps || { rdb: rdb(), mdb: require('../meetings-db'), idb: require('../inspection-db'), adb: require('../assets-db'), tracker: tdb(), trackerScore: legacyScore() };

  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  const isBuilder = (u) => isAdmin(u) || rdb().userHasRole(u, 'tracker-admin');
  const isSuper = (u) => rdb().userHasRole(u, 'super_admin');
  function requireBuilder(req, res, next) { if (!isBuilder(req.reportUser)) return res.status(403).json({ ok: false, error: 'tracker-admin or admin role required' }); next(); }
  function requireSuper(req, res, next) { if (!isSuper(req.reportUser)) return res.status(403).json({ ok: false, error: 'super_admin required' }); next(); }
  const key = (req) => String(req.params.key || '').slice(0, 32);
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false });

  /** Unit codes the caller may WRITE: null = all (builder), [] = none. Unit code matches the site's tracker code. */
  async function writableUnits(user, def) {
    if (isBuilder(user)) return null;
    if (!rdb().userHasRole(user, 'tracker-editor')) return [];
    const sites = (await rdb().listSites()) || [];
    const codes = new Set((userSites.codesFor(user, sites, (s) => tdb().siteToCode(s)) || []).map(String));
    return def.units.map(u => u.code).filter(c => codes.has(c));
  }
  /** Unit code → canonical site id (tracker / meetings / inspection code, then site name). */
  async function unitSiteResolver() {
    const sites = (await rdb().listSites({ includeInactive: true })) || [];
    const codes = {}; for (const m of ['tracker', 'meetings', 'inspection']) codes[m] = (await rdb().listSiteModuleCodes(m)) || [];
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return async (unit) => {
      for (const m of ['tracker', 'meetings', 'inspection']) { const hit = codes[m].find(c => String(c.code).toUpperCase() === String(unit).toUpperCase()); if (hit) return Number(hit.site_id); }
      const byTrk = sites.find(s => tdb().siteToCode(s) === unit); if (byTrk) return Number(byTrk.id);
      const byName = sites.find(s => norm(s.name) === norm(unit)); return byName ? Number(byName.id) : null;
    };
  }
  async function loadDef(req, res, { draft = false } = {}) {
    const d = await store.get(key(req));
    if (!d) { res.status(404).json({ ok: false, error: 'tracker not found' }); return null; }
    if (!isBuilder(req.reportUser) && d.status !== 'published') { res.status(404).json({ ok: false, error: 'tracker not found' }); return null; }
    const pub = !draft && d.status === 'published' ? await store.published(d.key) : null;
    return { row: d, def: (pub || d).definition };
  }
  const closedSlots = (def) => Array.from({ length: def.period.count }, (_, i) => i + 1).filter(s => store.slotClosed(def, s));

  router.get('/api/trackers', requireReportSession, async (req, res) => {
    try {
      const u = req.reportUser;
      const rows = await store.list({ status: isBuilder(u) ? ['draft', 'review', 'published', 'retired'] : ['published'] });
      res.json({ ok: true, builder: isBuilder(u), editor: isBuilder(u) || rdb().userHasRole(u, 'tracker-editor'),
        trackers: rows.map(d => ({ key: d.key, name: d.name, status: d.status, version: d.version, period: d.definition && d.definition.period, units: (d.definition && d.definition.units || []).length, items: (d.definition && d.definition.groups || []).reduce((n, g) => n + g.items.length, 0), template: /^tpl-/.test(d.key), updated_at: d.updated_at, published_at: d.published_at })) });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/trackers/catalogue', requireReportSession, (req, res) => {
    const KpiRag = require('../public/lib/kpiRag');
    res.json({ ok: true, kpiTypes: KpiRag.KPI_TYPES, policies: KpiRag.POLICIES, periodKinds: Defs.PERIOD_KINDS, metrics: registry().list({ status: 'published' }).map(m => ({ key: m.key, name: m.name, module: m.module, unit: m.unit, window_kind: m.window_kind })), lock: { grace_day: Lock.GRACE_DAY, cutoff: Lock.label() } });
  });
  router.get('/api/trackers/templates', requireReportSession, (req, res) => res.json({ ok: true, templates: require('../services/trackerTemplates').TEMPLATES }));

  // ---- legacy migration ------------------------------------------------------------------
  const legacyYear = (req) => { const y = Number(req.query.year); return Number.isInteger(y) && y > 2000 ? y : new Date().getUTCFullYear(); };
  router.get('/api/trackers/legacy/compare', requireReportSession, requireBuilder, async (req, res) => {
    try {
      const D = await tdb().loadTracker(); const year = legacyYear(req);
      const r = Legacy.compare(D, year, legacyScore(), { upToMonth: Math.min(12, Math.max(1, Number(req.query.months) || 12)) });
      if (req.query.format === 'csv') { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="tracker-parallel-run-${year}.csv"`); return res.send(r.csv); }
      res.json({ ok: true, year, tolerance: r.tolerance, maxDelta: r.maxDelta, pass: r.ok, rows: r.rows, key: r.definition.key });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/trackers/legacy/import', requireReportSession, requireBuilder, async (req, res) => {
    try {
      const D = await tdb().loadTracker(); const year = legacyYear(req);
      const imp = Legacy.importLegacy(D, year);
      const d = await store.saveDraft(imp.definition, { user: req.reportUser });
      await store.saveTargets(d.key, imp.targets);
      const e = await store.saveEntries(d.key, imp.entries, { user: req.reportUser, def: imp.definition, lockClosed: false, source: 'import:legacy' });
      rdb().logEvent({ category: 'trackers', action: 'tracker_legacy_imported', target: d.key, details: { year, entries: e.saved, targets: imp.targets.length }, ...rdb()._logCtx(req) });
      res.json({ ok: true, key: d.key, entries: e, targets: imp.targets.length, status: d.status });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/trackers/legacy/cutover', requireReportSession, requireBuilder, async (req, res) => {
    try { const c = await reportConfig.getConfig(rdb().db); res.json({ ok: true, cutover: String(c.tracker_engine_cutover) === '1' }); } catch (e) { fail(res, e); }
  });
  router.put('/api/trackers/legacy/cutover', requireReportSession, requireSuper, async (req, res) => {
    try {
      const on = !!(req.body && req.body.cutover);
      await reportConfig.setConfig(rdb().db, { tracker_engine_cutover: on ? '1' : '0' }, req.reportUser && req.reportUser.username);
      rdb().logEvent({ category: 'trackers', action: 'tracker_cutover', target: on ? 'engine' : 'legacy', ...rdb()._logCtx(req) });
      res.json({ ok: true, cutover: on });
    } catch (e) { fail(res, e); }
  });

  // ---- definitions -----------------------------------------------------------------------
  router.get('/api/trackers/:key', requireReportSession, async (req, res) => {
    try { const x = await loadDef(req, res); if (!x) return; res.json({ ok: true, tracker: x.row, published: x.row.status === 'published' ? x.def : null, builder: isBuilder(req.reportUser), writable: await writableUnits(req.reportUser, x.def), closed: closedSlots(x.def) }); } catch (e) { fail(res, e); }
  });
  router.put('/api/trackers/:key', requireReportSession, requireBuilder, async (req, res) => {
    try {
      const doc = req.body && req.body.definition ? req.body.definition : req.body;
      if (!doc || doc.key !== key(req)) return res.status(400).json({ ok: false, error: 'definition.key must match the URL' });
      const d = await store.saveDraft(doc, { user: req.reportUser, rfiRef: req.body.rfi_ref || null });
      rdb().logEvent({ category: 'trackers', action: 'tracker_draft_saved', target: d.key, ...rdb()._logCtx(req) });
      res.json({ ok: true, tracker: d });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/trackers/:key/dry-run', requireReportSession, requireBuilder, async (req, res) => {
    try {
      const doc = req.body && req.body.definition; const v = Defs.validate(doc);
      if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });
      const r = await store.scoreTracker(key(req), { definition: doc, currentPeriod: Number(req.query.period) || null });
      res.json({ ok: true, result: r || { units: {}, fleet: {} } });
    } catch (e) { fail(res, e); }
  });
  // G-23 — four-eyes: one builder submits the draft, ANOTHER publishes it (the last editor cannot
  // either). An admin may publish without review with override_reason (10+ chars), logged as a risk.
  router.post('/api/trackers/:key/submit', requireReportSession, requireBuilder, async (req, res) => {
    try { const d = await store.submit(key(req), { user: req.reportUser }); if (!d) return res.status(404).json({ ok: false, error: 'tracker not found' }); rdb().logEvent({ category: 'trackers', action: 'tracker_submitted', target: d.key, ...rdb()._logCtx(req) }); res.json({ ok: true, tracker: d }); } catch (e) { fail(res, e); }
  });
  router.post('/api/trackers/:key/publish', requireReportSession, requireBuilder, async (req, res) => {
    try {
      const cur = await store.get(key(req)); if (!cur) return res.status(404).json({ ok: false, error: 'tracker not found' });
      const dec = require('../services/publishGate').publishDecision(cur, req.reportUser, { isAdmin: isAdmin(req.reportUser), overrideReason: req.body && req.body.override_reason, policy: await require('../services/governancePolicy').forContext({}) });
      if (!dec.allow) return res.status(dec.status).json({ ok: false, error: dec.error, code: dec.code, message: dec.message });
      if (dec.override) rdb().logEvent({ category: 'trackers', action: 'tracker_publish_override', target: cur.key, details: dec.override, risk: 1, ...rdb()._logCtx(req) });
      const d = await store.publish(cur.key, { user: req.reportUser, note: req.body && req.body.note, override: dec.override, expect: { updated_at: cur.updated_at, submitted_at: cur.submitted_at } });
      rdb().logEvent({ category: 'trackers', action: 'tracker_published', target: d.key, details: { version: d.version, submitted_by: cur.submitted_by, override: !!dec.override }, ...rdb()._logCtx(req) });
      res.json({ ok: true, tracker: d });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/trackers/:key/retire', requireReportSession, requireBuilder, async (req, res) => { try { const t = await store.setStatus(key(req), 'retired'); rdb().logEvent({ category: 'trackers', action: 'tracker_retired', target: key(req), ...rdb()._logCtx(req) }); res.json({ ok: true, tracker: t }); } catch (e) { fail(res, e); } });
  router.get('/api/trackers/:key/versions', requireReportSession, requireBuilder, async (req, res) => { try { res.json({ ok: true, versions: await store.versions(key(req)) }); } catch (e) { fail(res, e); } });
  router.post('/api/trackers/:key/rollback/:n', requireReportSession, requireBuilder, async (req, res) => {
    try { const d = await store.rollback(key(req), Number(req.params.n), { user: req.reportUser }); if (!d) return res.status(404).json({ ok: false, error: 'version not found' }); rdb().logEvent({ category: 'trackers', action: 'tracker_rolled_back', target: d.key, details: { to: Number(req.params.n) }, ...rdb()._logCtx(req) }); res.json({ ok: true, tracker: d }); } catch (e) { fail(res, e); }
  });
  router.delete('/api/trackers/:key', requireReportSession, requireBuilder, async (req, res) => { try { await store.remove(key(req)); rdb().logEvent({ category: 'trackers', action: 'tracker_deleted', target: key(req), ...rdb()._logCtx(req) }); res.json({ ok: true }); } catch (e) { fail(res, e); } });

  // ---- entries / targets / score ---------------------------------------------------------
  router.get('/api/trackers/:key/entries', requireReportSession, async (req, res) => {
    try { const x = await loadDef(req, res); if (!x) return; const unit = req.query.unit ? String(req.query.unit).slice(0, 32) : null; const e = await store.entries(x.row.key, { unit }); res.json({ ok: true, inputs: e.inputs, rows: e.rows, closed: closedSlots(x.def), writable: await writableUnits(req.reportUser, x.def), targets: await store.targets(x.row.key) }); } catch (e) { fail(res, e); }
  });
  async function writeCells(req, res, cells, source) {
    const x = await loadDef(req, res); if (!x) return null;
    const w = await writableUnits(req.reportUser, x.def);
    if (Array.isArray(w) && !w.length) { res.status(403).json({ ok: false, error: 'no unit in your scope' }); return null; }
    const r = await store.saveEntries(x.row.key, cells, { user: req.reportUser, def: x.def, lockClosed: !isSuper(req.reportUser), allowedUnits: w, source });
    rdb().logEvent({ category: 'trackers', action: 'tracker_entries_saved', target: x.row.key, details: { ...r, source }, ...rdb()._logCtx(req) });
    return r;
  }
  router.put('/api/trackers/:key/entries', requireReportSession, async (req, res) => {
    try { const cells = req.body && req.body.cells; if (!Array.isArray(cells)) return res.status(400).json({ ok: false, error: 'cells[] required' }); const r = await writeCells(req, res, cells, 'manual'); if (r) res.json({ ok: true, ...r, closed_blocked: r.blocked }); } catch (e) { fail(res, e); }
  });
  router.get('/api/trackers/:key/targets', requireReportSession, async (req, res) => { try { const x = await loadDef(req, res); if (!x) return; res.json({ ok: true, targets: store.mergeTargets(x.def, await store.targets(x.row.key)), overrides: await store.targets(x.row.key) }); } catch (e) { fail(res, e); } });
  router.put('/api/trackers/:key/targets', requireReportSession, async (req, res) => {
    try {
      const x = await loadDef(req, res); if (!x) return; const w = await writableUnits(req.reportUser, x.def);
      if (Array.isArray(w) && !w.length) return res.status(403).json({ ok: false, error: 'no unit in your scope' });
      const list = req.body && req.body.targets; if (!Array.isArray(list)) return res.status(400).json({ ok: false, error: 'targets[] required' });
      res.json({ ok: true, ...(await store.saveTargets(x.row.key, list, { allowedUnits: w })) });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/trackers/:key/score', requireReportSession, async (req, res) => {
    try { const x = await loadDef(req, res); if (!x) return; res.json({ ok: true, result: await store.scoreTracker(x.row.key, { currentPeriod: Number(req.query.period) || null }) }); } catch (e) { fail(res, e); }
  });
  router.post('/api/trackers/:key/sync', requireReportSession, requireBuilder, async (req, res) => {
    try {
      const x = await loadDef(req, res); if (!x) return;
      const r = await Sources.resolveBindings({ def: x.def, registry: registry(), deps: readerDeps(), unitSite: await unitSiteResolver(), slots: req.body && Array.isArray(req.body.slots) ? req.body.slots.map(Number) : null });
      const saved = await store.saveEntries(x.row.key, r.cells, { user: req.reportUser, def: x.def, lockClosed: false, source: 'sync:registry' });
      rdb().logEvent({ category: 'trackers', action: 'tracker_synced', target: x.row.key, details: { saved: saved.saved, skipped: r.skipped, errors: r.errors.length }, ...rdb()._logCtx(req) });
      res.json({ ok: true, ...saved, skipped: r.skipped, errors: r.errors.slice(0, 50) });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/trackers/:key/import', requireReportSession, async (req, res) => {
    try {
      const x = await loadDef(req, res); if (!x) return;
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ ok: false, error: 'xlsx body required' });
      const p = Exp.parseEntriesWorkbook(req.body, x.def);
      const r = await writeCells(req, res, p.cells, 'import'); if (r) res.json({ ok: true, ...r, parse_errors: p.errors.slice(0, 50) });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/trackers/:key/export.xlsx', requireReportSession, async (req, res) => {
    try { const x = await loadDef(req, res); if (!x) return; const r = await store.scoreTracker(x.row.key, { currentPeriod: Number(req.query.period) || null }); const e = await store.entries(x.row.key); const buf = Exp.buildWorkbook(x.def, r, e.inputs); rdb().logEvent({ category: 'trackers', action: 'tracker_export', target: x.row.key, details: { fmt: 'xlsx' }, ...rdb()._logCtx(req) }); res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${x.row.key}.xlsx"`); res.send(buf); } catch (e) { fail(res, e); }
  });
  router.get('/api/trackers/:key/export.pptx', requireReportSession, async (req, res) => {
    try { const x = await loadDef(req, res); if (!x) return; const r = await store.scoreTracker(x.row.key, { currentPeriod: Number(req.query.period) || null }); const buf = await Exp.buildPptx(x.def, r); rdb().logEvent({ category: 'trackers', action: 'tracker_export', target: x.row.key, details: { fmt: 'pptx' }, ...rdb()._logCtx(req) }); res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'); res.setHeader('Content-Disposition', `attachment; filename="${x.row.key}.pptx"`); res.send(buf); } catch (e) { fail(res, e); }
  });
  return router;
};
module.exports.createStore = createStore;
