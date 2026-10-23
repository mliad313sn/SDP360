'use strict';
// ---------------------------------------------------------------------------
// Step 10 (SDP-DASH-2.0) — the field app's server side (the app itself: public/field.html, works offline).
//
//   GET  /api/field/bootstrap                      what the phone keeps for offline work: sites, checklist, trackers
//   POST /api/field/uploads                        begin a resumable photo upload {id, mime, size, chunks}
//   PUT  /api/field/uploads/:id/chunks/:n          one chunk (base64) — idempotent
//   GET  /api/field/uploads/:id                    which chunks arrived (to resume after a cut)
//   POST /api/field/uploads/:id/complete           assemble and check
//   PUT  /api/field/inspections/:id                save an inspection captured offline — idempotent, 409 on conflict
//   POST /api/field/quick-actions                  open / close / transfer an SDP ticket (queued while SDP write is off)
//   GET  /api/field/quick-actions?status=          the queue (coordinators)
//   POST /api/field/quick-actions/:id/done         a coordinator did it by hand in SDP
//   POST /api/field/sync-report                    the phone's sync statistics (pilot measures)
//
// Who: `field-tech` (new role) or `editor` and above, on their own sites — the same scoping as the Inspections module
// (admin tier: every site). Tracker entries go through the regular /api/trackers/:id/entries (same rights).
// ---------------------------------------------------------------------------
const uploads = require('../services/field/uploads');
const fieldInspections = require('../services/field/inspections');
const quick = require('../services/field/quickActions');
const { makeSdpWriter } = require('../services/field/sdpWriter');
const tstore = require('../services/trackers/store');
const rights = require('../services/trackers/rights');
const { audienceAllows } = require('../services/dashboards/definition');
const { canReadGroup } = require('./metrics');
const userSites = require('../services/userSites');

module.exports = function fieldRoutes(d) {
  const { express, rdb, requireReportSession, requireRole } = d;
  const router = express.Router();
  const FIELD = requireRole(['field-tech', 'editor']);
  const has = (u, r) => rdb.userHasRole(u, r);
  const me = (req) => String(req.reportUser.username);
  const inspectionDb = () => d.inspectionDb || require('../inspection-db');
  const fail = (res, e) => res.status(e.status || (/Cross-site/.test(e.message) ? 403 : 500)).json({ error: e.message });
  const log = (req, action, target, details) => { try { rdb.logEvent({ category: 'field', action, target, details, ...rdb._logCtx(req) }); } catch (_) {} };

  /** Inspection site codes this person may write (null = every site), as the Inspections module computes them. */
  async function inspectionCodes(user) {
    if (has(user, 'admin')) return null;
    const sites = (await rdb.listSites()) || [];
    return userSites.codesFor(user, sites, (s) => inspectionDb().siteNameToCode(s ? s.name : null));
  }

  router.get('/api/field/bootstrap', requireReportSession, FIELD, async (req, res) => {
    try {
      const u = req.reportUser, codes = await inspectionCodes(u);
      if (codes && !codes.length) return res.status(403).json({ error: 'No site is attached to your account: ask your administrator.' });
      const lookups = await inspectionDb().loadLookups();
      const year = new Date().getUTCFullYear(), trackers = [];
      for (const row of await tstore.defs.list()) {
        const def = row.published;
        if (!def || row.retired || def.year !== year || !audienceAllows(def, u, has)) continue;
        const units = rights.writableUnits(u, def, { has }).map(x => x.code);
        if (!units.length) continue;
        const values = await tstore.getValues(row.id, year), mine = {};
        for (const c of units) if (values[c]) mine[c] = values[c];
        trackers.push({ id: row.id, version: row.published_version, definition: { ...def, units: def.units.filter(x => units.includes(x.code)) }, values: mine, locks: (await tstore.locks(row.id, year)).map(l => l.month) });
      }
      res.json({
        generated_at: new Date().toISOString(),
        user: { username: u.username, name: u.full_name || u.username, sites: codes, all_sites: codes === null, coordinator: has(u, 'editor') },
        inspection: { sites: lookups.sites, areas: lookups.areas, types: lookups.types, statuses: lookups.statuses, categories: lookups.categories },
        trackers, limits: { photo_kb: Math.round(uploads.LIMITS.maxBytes / 1024), low_bandwidth_photo_kb: 150, chunk_kb: 32 },
        sdp_write: await sdpArmed(),
      });
    } catch (e) { fail(res, e); }
  });

  // ── Resumable uploads ──────────────────────────────────────────────────
  router.post('/api/field/uploads', requireReportSession, FIELD, async (req, res) => {
    try { const u = await uploads.begin(req.body || {}, me(req)); res.status(201).json({ id: u.id, status: u.status, chunks: Number(u.chunks) }); } catch (e) { fail(res, e); }
  });
  router.put('/api/field/uploads/:id/chunks/:n', requireReportSession, FIELD, async (req, res) => {
    try { res.json(await uploads.putChunk(String(req.params.id), req.params.n, (req.body || {}).data, me(req))); } catch (e) { fail(res, e); }
  });
  router.get('/api/field/uploads/:id', requireReportSession, FIELD, async (req, res) => {
    try { const s = await uploads.status(String(req.params.id), me(req)); if (!s) return res.status(404).json({ error: 'unknown upload' }); res.json(s); } catch (e) { fail(res, e); }
  });
  router.post('/api/field/uploads/:id/complete', requireReportSession, FIELD, async (req, res) => {
    try { const r = await uploads.complete(String(req.params.id), me(req)); res.status(r.ok ? 200 : 409).json(r); } catch (e) { fail(res, e); }
  });

  // ── Inspections captured offline ───────────────────────────────────────
  router.put('/api/field/inspections/:id', requireReportSession, FIELD, async (req, res) => {
    try {
      const b = req.body || {}, state = b.state;
      if (!state || !state.meta || String(state.meta.f_id) !== String(req.params.id)) return res.status(400).json({ error: 'state.meta.f_id must be the id of the address' });
      const codes = await inspectionCodes(req.reportUser);
      if (codes && !codes.length) return res.status(403).json({ error: 'No site is attached to your account.' });
      const r = await fieldInspections.save(state, { username: me(req), userId: req.reportUser.id, userCodes: codes, base_updated_at: b.base_updated_at, force: !!b.force, inspectionDb: inspectionDb() });
      if (r.status === 200) log(req, 'field_inspection_saved', r.body.id, { status: r.body.status, photos: r.body.photos, created: r.body.created });
      res.status(r.status).json(r.body);
    } catch (e) { fail(res, e); }
  });

  // ── Quick actions ──────────────────────────────────────────────────────
  async function sdpArmed() {
    const cfg = await require('../services/reportConfig').getConfig(rdb.db);
    return String(cfg.field_sdp_write_enabled || '0') === '1' && !!cfg.sdp_write_refresh_token;
  }
  async function writer() {
    if (d.sdpWriter) return d.sdpWriter;
    const c = await require('../services/reportConfig').getConfig(rdb.db);
    return makeSdpWriter({ enabled: String(c.field_sdp_write_enabled || '0') === '1', baseUrl: c.sdp_api_base_url, accountsUrl: c.sdp_api_accounts_url,
      clientId: c.sdp_api_client_id, clientSecret: c.sdp_api_client_secret, refreshToken: c.sdp_write_refresh_token });
  }
  router.post('/api/field/quick-actions', requireReportSession, FIELD, async (req, res) => {
    try {
      const v = quick.validate(req.body || {});
      if (!v.ok) return res.status(400).json({ error: 'Invalid action', details: v.errors });
      const codes = await inspectionCodes(req.reportUser);
      if (codes && v.action.payload.site && !codes.includes(v.action.payload.site)) return res.status(403).json({ error: 'Not your site.' });
      const r = await quick.submit(v.action, me(req), await writer());
      if (!r.duplicate) log(req, 'field_quick_action', r.action.id, { kind: r.action.kind, status: r.action.status });
      res.status(r.duplicate ? 200 : 201).json(r);
    } catch (e) { fail(res, e); }
  });
  router.get('/api/field/quick-actions', requireReportSession, FIELD, async (req, res) => {
    try {
      const codes = await inspectionCodes(req.reportUser);
      const all = await quick.list({ status: req.query.status ? String(req.query.status) : undefined });
      const mineOnly = !has(req.reportUser, 'editor');   // a field technician sees their own actions
      res.json({ actions: all.filter(a => (mineOnly ? a.username === me(req) : true) && (codes === null || !a.payload.site || codes.includes(a.payload.site))),
        sdp_write: await sdpArmed() });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/field/quick-actions/:id/done', requireReportSession, requireRole(['editor']), async (req, res) => {
    try {
      const a = await quick.get(String(req.params.id));
      if (!a) return res.status(404).json({ error: 'Action not found' });
      const codes = await inspectionCodes(req.reportUser);
      if (codes && a.payload.site && !codes.includes(a.payload.site)) return res.status(403).json({ error: 'Not your site.' });
      const out = await quick.markDone(a.id, me(req), (req.body || {}).note);
      log(req, 'field_quick_action_done', a.id, { kind: a.kind });
      res.json({ action: out });
    } catch (e) { fail(res, e); }
  });

  // ── Pilot measures ─────────────────────────────────────────────────────
  router.post('/api/field/sync-report', requireReportSession, FIELD, async (req, res) => {
    try {
      const b = req.body || {}, ops = Array.isArray(b.ops) ? b.ops.slice(0, 200) : [];
      const clean = ops.map(o => ({ kind: String(o.kind || '').slice(0, 20), ok: !!o.ok, duration_ms: Math.max(0, Math.round(Number(o.duration_ms) || 0)), bytes: Math.max(0, Math.round(Number(o.bytes) || 0)),
        photos: Math.max(0, Math.round(Number(o.photos) || 0)), queued_ms: Math.max(0, Math.round(Number(o.queued_ms) || 0)) }));
      log(req, 'field_sync', 'field', { ops: clean, low_bandwidth: !!b.low_bandwidth, online_type: String(b.online_type || '').slice(0, 20) });
      res.json({ recorded: clean.length });
    } catch (e) { fail(res, e); }
  });

  return router;
};
