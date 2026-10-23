'use strict';
// ---------------------------------------------------------------------------
// Step 7 (SDP-DASH-2.0) — business trackers: builder, entry, scores, exchange.
//
//   GET    /api/trackers                          trackers this person may open (+ drafts for authors)
//   GET    /api/trackers/templates                starting templates + served dictionary keys     (tracker-author)
//   GET    /api/trackers/:id?year=                published definition, entries, locks, rights
//   POST   /api/trackers/:id/entries              write cells {year, cells:[{unit,item,month,value}]}
//   POST   /api/trackers/:id/import               xlsx (base64) → cells; ?dry=1 checks without writing
//   GET    /api/trackers/:id/export.xlsx?year=&month=   workbook (entries + engine scores)
//   GET    /api/trackers/:id/export.pptx?year=&month=   two slides (engine scores)
//   POST   /api/trackers/:id/locks                lock / unlock a month {year, month, locked}  (tracker-publisher)
//   POST   /api/trackers/:id/refresh-sources      recompute the items linked to the dictionary  (tracker-publisher)
//   POST   /api/trackers                          create a draft (blank, from a template)        (tracker-author)
//   PUT    /api/trackers/:id/draft                save the draft                                 (tracker-author)
//   POST   /api/trackers/preview                  validate + dry-run score of a draft            (tracker-author)
//   POST   /api/trackers/:id/publish              publish the draft as the next version          (tracker-publisher)
//   POST   /api/trackers/:id/rollback             republish an older version                     (tracker-publisher)
//   POST   /api/trackers/:id/retire               take it off the air                            (tracker-publisher)
//   DELETE /api/trackers/:id                      delete a never-published draft                 (tracker-author)
//   POST   /api/trackers/legacy/import            migrate the IT Activity Tracker of a year      (super_admin)
//   GET    /api/trackers/legacy/compare?year=     legacy engine vs tracker engine                (super_admin)
//
// Reading: the definition's audience; a tracker "for one site" shows a person only the units of their own sites
// (the admin tier and group readers see every unit). Typing: one of the definition's entry roles, on one's own
// unit unless the definition opens every unit; never on a locked month, never on an item linked to the
// dictionary, never during a parallel run. Every score comes from public/lib/trackerEngine.js.
// ---------------------------------------------------------------------------
const tdef = require('../services/trackers/definition');
const store = require('../services/trackers/store');
const service = require('../services/trackers/service');
const exchange = require('../services/trackers/exchange');
const { TEMPLATES, instantiate } = require('../services/trackers/templates');
const Engine = require('../public/lib/trackerEngine');
const { audienceAllows } = require('../services/dashboards/definition');
const { canReadGroup } = require('./metrics');
const registry = require('../services/metrics/registry');
const live = require('../services/metrics/liveDeps');
const userSites = require('../services/userSites');

module.exports = function trackersRoutes(d) {
  const { express, rdb, requireReportSession, requireRole } = d;
  const router = express.Router();
  const AUTHOR = requireRole(['tracker-author', 'tracker-publisher', 'super_admin']);
  const PUBLISHER = requireRole(['tracker-publisher', 'super_admin']);
  const SUPER = requireRole(['super_admin']);
  const has = (u, r) => rdb.userHasRole(u, r);
  const who = (req) => (req.reportUser && (req.reportUser.username || req.reportUser.full_name)) || 'unknown';
  const isAuthor = (u) => ['tracker-author', 'tracker-publisher', 'super_admin'].some(r => has(u, r));
  const isPublisher = (u) => has(u, 'tracker-publisher') || has(u, 'super_admin');
  const canEdit = (u, row) => (row.kind === 'migrated' ? has(u, 'super_admin') || has(u, 'tracker-publisher') : isAuthor(u));
  const served = () => new Set(registry.list().filter(m => m.serve).map(m => m.key));
  const yearOf = (q, definition) => { const y = Number(q && q.year); return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : definition.year; };

  /** Units this person may READ in a definition. */
  function readableUnits(u, definition) {
    if (definition.audience.site_scope !== 'own' || canReadGroup(rdb, u)) return definition.units;
    return definition.units.filter(x => x.site_id && userSites.hasSite(u, x.site_id));
  }
  /** Units this person may TYPE into (empty when typing is closed for them). */
  function writableUnits(u, definition) {
    if (definition.legacy_mirror) return [];
    const anyUnit = has(u, 'super_admin') || has(u, 'tracker-publisher');
    if (!anyUnit && !definition.entry.roles.some(r => has(u, r))) return [];
    if (anyUnit || !definition.entry.own_unit_only) return definition.units;
    return definition.units.filter(x => x.site_id && userSites.hasSite(u, x.site_id));
  }
  function pick(values, units) {
    const out = {};
    for (const x of units) if (values[x.code]) out[x.code] = values[x.code];
    return out;
  }
  async function published(req, res) {
    const pub = await store.defs.getPublished(String(req.params.id));
    if (!pub) { res.status(404).json({ error: 'Tracker not found' }); return null; }
    if (!audienceAllows(pub.definition, req.reportUser, has)) { res.status(403).json({ error: 'This tracker is not published for your role.' }); return null; }
    return pub;
  }

  // ── Migration of the IT Activity Tracker (declared first: "legacy" is not a tracker id) ──
  router.post('/api/trackers/legacy/import', requireReportSession, SUPER, async (req, res) => {
    try {
      const year = Number((req.body || {}).year) || new Date().getUTCFullYear();
      const r = await service.importLegacy(rdb, year, who(req));
      if (!r.ok) return res.status(400).json({ error: 'The imported definition is not valid', details: r.errors });
      rdb.logEvent({ category: 'tracker', action: 'tracker_legacy_imported', target: r.id, details: { year, version: r.version, ...r.comparison }, ...rdb._logCtx(req) });
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/trackers/legacy/compare', requireReportSession, SUPER, async (req, res) => {
    try {
      const tdb = require('../tracker-db');
      const year = Number(req.query.year) || new Date().getUTCFullYear();
      const D = await tdb.loadTracker();
      res.json(require('../services/trackers/legacyCompare').compare(D, year, { month: Number(req.query.month) || 12 }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Reading ────────────────────────────────────────────────────────────
  router.get('/api/trackers', requireReportSession, async (req, res) => {
    try {
      const u = req.reportUser, author = isAuthor(u), out = [];
      for (const row of await store.defs.list()) {
        const visible = row.published && !row.retired && audienceAllows(row.published, u, has);
        const editable = author && canEdit(u, row);
        if (!visible && !editable) continue;
        const dd = row.published || row.draft || {};
        out.push({ id: row.id, kind: row.kind, title: dd.title || row.id, description: dd.description || '', year: dd.year,
          published_version: row.published_version, published_at: row.published_at, retired: row.retired, has_draft: !!row.draft,
          visible, editable, parallel_run: !!dd.legacy_mirror });
      }
      res.json({ trackers: out, author, can_publish: isPublisher(u), super_admin: has(u, 'super_admin') });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/trackers/templates', requireReportSession, AUTHOR, async (req, res) => {
    const sites = await live.groupSites(rdb);
    res.json({
      templates: TEMPLATES.map(t => ({ key: t.key, title: t.title, description: t.description, items: t.items.length })),
      kpi_types: Engine.KPI_TYPES, audience_roles: require('../services/dashboards/definition').AUDIENCE_ROLES,
      sites: sites.map(s => ({ site_id: s.site_id, code: s.code, name: s.name })),
      metrics: registry.list().filter(m => m.serve).map(m => ({ key: m.key, fr: m.fr, en: m.en, unit: m.unit })),
    });
  });

  router.get('/api/trackers/:id', requireReportSession, async (req, res) => {
    try {
      const row = await store.defs.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Tracker not found' });
      const u = req.reportUser, editable = isAuthor(u) && canEdit(u, row);
      const pub = await store.defs.getPublished(row.id);
      const visible = pub && audienceAllows(pub.definition, u, has);
      if (!visible && !editable) return res.status(pub ? 403 : 404).json({ error: pub ? 'This tracker is not published for your role.' : 'Tracker not found' });
      const out = { id: row.id, kind: row.kind, retired: row.retired, editable, can_publish: isPublisher(u) && canEdit(u, row) };
      if (editable) Object.assign(out, { draft: row.draft, draft_at: row.draft_at, draft_by: row.draft_by, versions: await store.defs.versions(row.id) });
      if (pub && visible) {
        const definition = pub.definition, year = yearOf(req.query, definition);
        const units = readableUnits(u, definition);
        Object.assign(out, { published: { version: pub.version, published_at: pub.published_at, definition: Object.assign({}, definition, { units }) },
          year, values: pick(await store.getValues(row.id, year), units), locks: await store.locks(row.id, year),
          writable_units: writableUnits(u, definition).filter(x => units.includes(x)).map(x => x.code) });
      }
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Typing ─────────────────────────────────────────────────────────────
  /** Check cells against rights, locks and linked items. Returns { ok:[...], refused:[...] }. */
  async function checkCells(u, definition, id, year, cells) {
    const writable = new Set(writableUnits(u, definition).map(x => x.code));
    const items = new Map(definition.items.map(it => [it.code, it]));
    const locked = new Set((await store.locks(id, year)).map(l => l.month));
    const ok = [], refused = [];
    for (const c of Array.isArray(cells) ? cells.slice(0, 5000) : []) {
      const unit = String(c && c.unit || ''), item = String(c && c.item || ''), month = Number(c && c.month), value = Number(c && c.value);
      const it = items.get(item);
      if (!definition.units.some(x => x.code === unit) || !it) { refused.push({ unit, item, month, reason: 'unknown unit or item' }); continue; }
      if (!(Number.isInteger(month) && month >= 1 && month <= 12)) { refused.push({ unit, item, month, reason: 'month 1-12' }); continue; }
      if (!Number.isFinite(value)) { refused.push({ unit, item, month, reason: 'not a number' }); continue; }
      if (!writable.has(unit)) { refused.push({ unit, item, month, reason: definition.legacy_mirror ? 'parallel run: type in the IT Activity Tracker' : 'not your unit' }); continue; }
      if (it.source) { refused.push({ unit, item, month, reason: 'computed from the dictionary' }); continue; }
      if (locked.has(month)) { refused.push({ unit, item, month, reason: 'month locked' }); continue; }
      ok.push({ unit, item, month, value });
    }
    return { ok, refused };
  }

  router.post('/api/trackers/:id/entries', requireReportSession, async (req, res) => {
    try {
      const pub = await published(req, res); if (!pub) return;
      const definition = pub.definition, year = yearOf(req.body, definition);
      const { ok, refused } = await checkCells(req.reportUser, definition, pub.definition.id, year, (req.body || {}).cells);
      if (!ok.length) return res.status(refused.length ? 403 : 400).json({ error: refused.length ? 'No cell could be written' : 'No cell', refused });
      await store.setCells(definition.id, year, ok, who(req), 'manual');
      rdb.logEvent({ category: 'tracker', action: 'tracker_entries_saved', target: definition.id, details: { year, cells: ok.length, refused: refused.length }, ...rdb._logCtx(req) });
      res.json({ written: ok.length, refused });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/trackers/:id/import', requireReportSession, async (req, res) => {
    try {
      const pub = await published(req, res); if (!pub) return;
      const definition = pub.definition, year = yearOf(req.body, definition);
      const b64 = String((req.body || {}).file || '');
      if (!b64 || b64.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Send the workbook as base64 in "file" (8 MB at most).' });
      let parsed;
      const buf = Buffer.from(b64, 'base64');
      // An .xlsx is a ZIP archive ("PK"); anything else (CSV, text, old .xls) is refused rather than guessed.
      if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4B) return res.status(400).json({ error: 'This file is not an Excel workbook (.xlsx).' });
      try { parsed = exchange.parseImport(definition, buf); } catch (_) { return res.status(400).json({ error: 'This file is not a readable Excel workbook.' }); }
      const { ok, refused } = await checkCells(req.reportUser, definition, definition.id, year, parsed.cells);
      const dry = String(req.query.dry || (req.body || {}).dry || '') === '1' || (req.body || {}).dry === true;
      if (!dry && ok.length) {
        await store.setCells(definition.id, year, ok, who(req), 'import');
        rdb.logEvent({ category: 'tracker', action: 'tracker_imported', target: definition.id, details: { year, cells: ok.length, refused: refused.length + parsed.rejected.length }, ...rdb._logCtx(req) });
      }
      res.json({ dry, accepted: ok.length, written: dry ? 0 : ok.length, refused, rejected: parsed.rejected });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  async function exportData(req, res) {
    const pub = await published(req, res); if (!pub) return null;
    const definition = Object.assign({}, pub.definition, { units: readableUnits(req.reportUser, pub.definition) });
    const year = yearOf(req.query, definition), now = new Date();
    const mo = Math.max(1, Math.min(12, Number(req.query.month) || (year === now.getUTCFullYear() ? now.getUTCMonth() + 1 : 12)));
    return { definition: Object.assign(definition, { year }), values: await store.getValues(definition.id, year), mo };
  }
  router.get('/api/trackers/:id/export.xlsx', requireReportSession, async (req, res) => {
    try {
      const x = await exportData(req, res); if (!x) return;
      const buf = exchange.workbook(x.definition, x.values, x.mo);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${x.definition.id}-${x.definition.year}.xlsx"`);
      res.send(buf);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/api/trackers/:id/export.pptx', requireReportSession, async (req, res) => {
    try {
      const x = await exportData(req, res); if (!x) return;
      const buf = await exchange.slides(x.definition, x.values, x.mo);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="${x.definition.id}-${x.definition.year}.pptx"`);
      res.send(buf);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/trackers/:id/locks', requireReportSession, PUBLISHER, async (req, res) => {
    try {
      const pub = await published(req, res); if (!pub) return;
      const b = req.body || {}, year = yearOf(b, pub.definition), month = Number(b.month);
      if (!(Number.isInteger(month) && month >= 1 && month <= 12)) return res.status(400).json({ error: 'month 1-12' });
      const locks = await store.setLock(pub.definition.id, year, month, b.locked !== false, who(req));
      rdb.logEvent({ category: 'tracker', action: b.locked !== false ? 'tracker_month_locked' : 'tracker_month_unlocked', target: pub.definition.id, details: { year, month }, ...rdb._logCtx(req) });
      res.json({ locks });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/trackers/:id/refresh-sources', requireReportSession, PUBLISHER, async (req, res) => {
    try {
      const pub = await published(req, res); if (!pub) return;
      const now = new Date(), y = pub.definition.year;
      const upto = y < now.getUTCFullYear() ? 12 : y > now.getUTCFullYear() ? 0 : now.getUTCMonth() + 1;
      res.json(upto ? await service.refreshSources(rdb, pub.definition, upto) : { id: pub.definition.id, cells: 0, skipped: ['the year has not started'] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Builder ────────────────────────────────────────────────────────────
  router.post('/api/trackers/preview', requireReportSession, AUTHOR, async (req, res) => {
    try {
      const b = req.body || {};
      const v = tdef.validate(b.definition, { servedMetrics: served() });
      if (!v.ok) return res.json({ ok: false, errors: v.errors, warnings: v.warnings });
      const definition = v.definition;
      const values = b.values && typeof b.values === 'object' ? b.values : await store.getValues(definition.id, definition.year);
      const mo = Math.max(1, Math.min(12, Number(b.month) || 12));
      const units = Engine.activeUnits(definition).map(code => { const s = Engine.unitSummary(definition, values, code, mo); return { unit: code, avg: s.avg, g: s.g, a: s.a, r: s.r, groups: s.groups }; });
      res.json({ ok: true, errors: [], warnings: v.warnings, month: mo, fleet: Engine.fleet(definition, values, mo), units });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/trackers', requireReportSession, AUTHOR, async (req, res) => {
    try {
      const b = req.body || {};
      let draft = b.definition;
      if (b.template) {
        const sites = await live.groupSites(rdb);
        const units = sites.filter(s => s.code).map(s => ({ code: s.code, name: s.name, site_id: s.site_id, active: true }));
        draft = instantiate(String(b.template), { id: String(b.id || ''), year: Number(b.year) || new Date().getUTCFullYear(), units });
        if (!draft) return res.status(400).json({ error: 'Unknown template' });
      }
      const v = tdef.validate(draft, { servedMetrics: served() });
      if (!v.ok) return res.status(400).json({ error: 'Invalid definition', details: v.errors });
      if (await store.defs.get(v.definition.id)) return res.status(409).json({ error: 'A tracker with this id already exists' });
      const row = await store.defs.saveDraft(v.definition.id, v.definition, who(req), 'custom');
      rdb.logEvent({ category: 'tracker', action: 'tracker_created', target: row.id, details: { template: b.template || null }, ...rdb._logCtx(req) });
      res.status(201).json({ id: row.id, draft: row.draft, warnings: v.warnings });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/api/trackers/:id/draft', requireReportSession, AUTHOR, async (req, res) => {
    try {
      const row = await store.defs.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Tracker not found' });
      if (!canEdit(req.reportUser, row)) return res.status(403).json({ error: 'A migrated tracker is edited by a tracker publisher.' });
      const v = tdef.validate({ ...((req.body || {}).definition || {}), id: row.id }, { servedMetrics: served() });
      if (!v.ok) return res.status(400).json({ error: 'Invalid definition', details: v.errors, warnings: v.warnings });
      const saved = await store.defs.saveDraft(row.id, v.definition, who(req), row.kind);
      res.json({ id: saved.id, draft: saved.draft, draft_at: saved.draft_at, warnings: v.warnings });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/trackers/:id/publish', requireReportSession, PUBLISHER, async (req, res) => {
    try {
      const row = await store.defs.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Tracker not found' });
      if (!canEdit(req.reportUser, row)) return res.status(403).json({ error: 'Not allowed for this tracker' });
      const v = tdef.validate(row.draft, { servedMetrics: served() });
      if (!v.ok) return res.status(400).json({ error: 'The draft is not valid', details: v.errors });
      const version = await store.defs.publishDefinition(row.id, v.definition, who(req), (req.body || {}).note);
      rdb.logEvent({ category: 'tracker', action: 'tracker_published', target: row.id, details: { version, author: row.draft_by, parallel_run: v.definition.legacy_mirror }, ...rdb._logCtx(req) });
      res.json({ id: row.id, version });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/trackers/:id/rollback', requireReportSession, PUBLISHER, async (req, res) => {
    try {
      const row = await store.defs.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Tracker not found' });
      if (!canEdit(req.reportUser, row)) return res.status(403).json({ error: 'Not allowed for this tracker' });
      const target = await store.defs.getVersion(row.id, Number((req.body || {}).version));
      if (!target) return res.status(404).json({ error: 'Version not found' });
      const version = await store.defs.publishDefinition(row.id, target.definition, who(req), `rollback to v${target.version}`);
      rdb.logEvent({ category: 'tracker', action: 'tracker_published', target: row.id, details: { version, rollback_to: target.version }, ...rdb._logCtx(req) });
      res.json({ id: row.id, version, rollback_to: target.version });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/trackers/:id/retire', requireReportSession, PUBLISHER, async (req, res) => {
    try {
      const row = await store.defs.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Tracker not found' });
      if (!canEdit(req.reportUser, row)) return res.status(403).json({ error: 'Not allowed for this tracker' });
      await store.defs.retire(row.id);
      rdb.logEvent({ category: 'tracker', action: 'tracker_retired', target: row.id, ...rdb._logCtx(req) });
      res.json({ id: row.id, retired: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/api/trackers/:id', requireReportSession, AUTHOR, async (req, res) => {
    try {
      const row = await store.defs.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Tracker not found' });
      if (row.kind !== 'custom' || row.published_version != null) return res.status(409).json({ error: 'A published tracker is retired, not deleted (its history and entries stay).' });
      await store.defs.removeDraftOnly(row.id);
      res.json({ id: row.id, deleted: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
