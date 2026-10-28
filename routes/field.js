'use strict';
const { fail: httpFail, logError } = require('../services/httpError');
// Step 10 — the field (mobile / offline) API behind public/field/ (PWA).
//
//   GET  /api/field/bootstrap              everything the phone caches: scope sites, inspection lookups,
//                                          published trackers + writable units, open actions, limits, data as-of
//   GET  /api/field/outbox                 the caller's ledger (what the server applied / refused)
//   PUT  /api/field/outbox/:uuid           apply ONE queued envelope exactly once (idempotent on uuid)
//   POST /api/field/uploads                open a chunked photo upload (≤ 300 KB, chunks of 64 KB)
//   PUT  /api/field/uploads/:id/chunks/:idx  one chunk (base64) — re-sending the same idx is a no-op
//   POST /api/field/uploads/:id/complete   assemble → blob store → {ref} the inspection payload references
//   GET  /api/field/uploads/:id            status + missing chunks (resume after a drop)
//
// Field role gate: `editor` tier OR the feature role `field-tech`. Site scope ALWAYS through
// services/userSites (never user.site_id ===). Each kind reuses the module's own writer, so the
// RBAC, the closed-month lock and the status-transfer rules are the SAME as on the desktop pages.
// A disabled SDP write (sdp_api_write_enabled='0') answers `rejected` with a reason — a terminal
// answer the phone deletes, never a retry loop.

const F = require('../services/fieldOutbox');

function createStore(rdbMod, { log = console.log } = {}) {
  const pg = rdbMod.REPORTS_BACKEND === 'postgres';
  const st = require('../services/fieldStore').makeFieldStore(({ prepare: (sql) => rdbMod.pgHandle().prepare(sql) }), { isPg: pg });
  
  st.initAtBoot = async () => { await st.init(); log('[field] store ready (pg, migration 020)'); };
  return st;
}

module.exports = function fieldRoutes(deps) {
  const { express, requireReportSession, store, dashStore, trackerStore } = deps;
  const router = express.Router();
  const rdb = () => deps.rdb || require('../reports-db');
  const idb = () => deps.inspectionDb || require('../inspection-db');
  const mdb = () => deps.meetingsDb || require('../meetings-db');
  const tdb = () => deps.trackerDb || require('../tracker-db');
  const blobStore = deps.blobStore || require('../services/blobStore');
  const reportConfig = deps.reportConfig || require('../services/reportConfig');
  const statusTransfer = require('../public/lib/statusTransfer');
  const userSites = require('../services/userSites');
  const json = express.json({ limit: '2mb' });

  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  const isField = (u) => isAdmin(u) || rdb().userHasRole(u, 'editor') || rdb().userHasRole(u, 'field-tech');
  function requireField(req, res, next) { if (!isField(req.reportUser)) return res.status(403).json({ ok: false, error: 'editor or field-tech role required' }); next(); }
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false, missing: e && e.missing || undefined });

  async function scopeSites(user) {
    const all = (await rdb().listSites({ includeInactive: false })) || [];
    if (isAdmin(user)) return all;
    const ids = new Set(userSites.siteIds(user));
    return all.filter(s => ids.has(Number(s.id)));
  }
  // Inspection / meetings codes of the caller (null = admin tier, unrestricted).
  async function moduleCodes(user) {
    if (isAdmin(user)) return null;
    const sites = (await rdb().listSites()) || [];
    return userSites.codesFor(user, sites, (s) => idb().siteNameToCode(s ? s.name : null));
  }
  async function trackerUnits(user, def) {
    if (isAdmin(user) || rdb().userHasRole(user, 'tracker-admin')) return null;
    if (!rdb().userHasRole(user, 'tracker-editor') && !rdb().userHasRole(user, 'field-tech')) return [];
    const sites = (await rdb().listSites()) || [];
    const codes = new Set((userSites.codesFor(user, sites, (s) => tdb().siteToCode(s)) || []).map(String));
    return def.units.map(u => u.code).filter(c => codes.has(c));
  }
  const cfg = async () => { try { return await reportConfig.getConfig(rdb().db); } catch (_) { return {}; } };

  // ── bootstrap ─────────────────────────────────────────────────────────────────────
  router.get('/api/field/bootstrap', requireReportSession, requireField, async (req, res) => {
    try {
      const u = req.reportUser;
      const sites = await scopeSites(u);
      const codes = await moduleCodes(u);
      let lookups = null; try { lookups = await idb().loadLookups(); } catch (_) { lookups = null; }
      const trackers = [];
      if (trackerStore) {
        for (const t of (await trackerStore.list({ status: 'published' })) || []) {
          const pub = await trackerStore.published(t.key); if (!pub) continue;
          const writable = await trackerUnits(u, pub.definition);
          if (Array.isArray(writable) && !writable.length) continue;
          trackers.push({ key: t.key, title: t.title, definition: pub.definition, writable, closed: Array.from({ length: (pub.definition.period && pub.definition.period.count) || 0 }, (_, i) => i + 1).filter(s => trackerStore.slotClosed(pub.definition, s)) });
        }
      }
      const actions = [];
      const siteCodes = codes === null ? (lookups && lookups.sites ? lookups.sites.map(s => s.code) : []) : codes;
      for (const sc of siteCodes.slice(0, 12)) {
        try { for (const a of (await idb().listActions({ site: sc })) || []) if (!/^(closed|cancelled)$/i.test(a.status || '')) actions.push({ source: 'inspection', id: a.id, site: sc, description: a.description, priority: a.priority, owner: a.owner, due_date: a.due_date, status: a.status }); } catch (_) { /* module may be absent */ }
        try { for (const a of (await mdb().listActions({ site: sc })) || []) if (!statusTransfer.isDone(a.status)) actions.push({ source: 'meetings', id: a.id, site: sc, description: a.description, owner: a.owner_it, due_date: a.target_date, status: a.status }); } catch (_) { /* module may be absent */ }
      }
      const c = await cfg();
      let dashboard = null; try { const d = dashStore ? await dashStore.published('field-site') : null; dashboard = d ? d.definition : null; } catch (_) { dashboard = null; }
      res.json({ ok: true, user: { id: u.id, name: u.full_name || u.username, roles: u.roles || [u.role] },
        sites: sites.map(s => ({ id: Number(s.id), name: s.name, inspection_code: idb().siteNameToCode(s.name), tracker_code: tdb().siteToCode(s) })),
        scope_codes: codes, lookups, trackers, actions: actions.slice(0, 500), dashboard,
        limits: { photo_max_bytes: Math.min(F.MAX_PHOTO_BYTES, (Number(c.field_photo_max_kb) || 300) * 1024), chunk_bytes: F.CHUNK_BYTES, max_chunks: F.MAX_CHUNKS, conflict_policy: F.CONFLICT_POLICY },
        features: { ticket: String(c.sdp_api_write_enabled) === '1' && !!(c.sdp_api_base_url && c.sdp_api_client_id) },
        server_time: new Date().toISOString() });
    } catch (e) { fail(res, e); }
  });

  router.get('/api/field/outbox', requireReportSession, requireField, async (req, res) => {
    try { res.json({ ok: true, items: await store.listOutbox(req.reportUser.id, { limit: req.query.limit, since: req.query.since || null }) }); } catch (e) { fail(res, e); }
  });

  // ── applying one envelope, exactly once ───────────────────────────────────────────
  const APPLY = {
    async inspection(u, p) {
      if (!p.meta || !p.meta.f_site) throw Object.assign(new Error('inspection payload needs meta.f_site'), { code: 'INVALID' });
      const codes = await moduleCodes(u);
      if (Array.isArray(codes) && !codes.length) throw Object.assign(new Error('your account has no inspection site'), { code: 'FORBIDDEN' });
      const siteCode = idb().parseSiteCode(p.meta.f_site);
      if (codes !== null && !userSites.inScope(siteCode, codes)) throw Object.assign(new Error(`inspection is for ${siteCode || 'no site'}, your scope is ${codes.join(', ')}`), { code: 'FORBIDDEN' });
      // Photos must reference COMPLETED uploads of this user ({upload_id} → {__blob}); inline data: URLs are refused on the field path.
      for (const it of Object.values(p.items || {})) {
        if (!it || !Array.isArray(it.photos)) continue;
        const out = [];
        for (const ph of it.photos) {
          if (ph && ph.__blob) { out.push(ph); continue; }
          if (ph && ph.upload_id != null) { const up = await store.getUpload(ph.upload_id); if (!up || up.user_id !== Number(u.id) || up.status !== 'done') throw Object.assign(new Error(`upload ${ph.upload_id} not completed`), { code: 'INVALID' }); out.push({ __blob: up.ref, mime: up.mime, sizeBytes: up.size, caption: ph.caption || '' }); continue; }
          throw Object.assign(new Error('field photos must be uploaded in chunks first (no inline data URLs)'), { code: 'INVALID' });
        }
        it.photos = out;
      }
      const r = await idb().saveInspection(p, codes, u.id);
      return { inspection_id: (r && r.id) || p.meta.f_id || null };
    },
    async tracker(u, p) {
      const err = F.validateTrackerPayload(p); if (err) throw Object.assign(new Error(err), { code: 'INVALID' });
      if (!trackerStore) throw new Error('tracker store unavailable');
      const pub = await trackerStore.published(p.key); if (!pub) throw Object.assign(new Error('tracker not published'), { code: 'INVALID' });
      const allowed = await trackerUnits(u, pub.definition);
      if (Array.isArray(allowed) && !allowed.length) throw Object.assign(new Error('no writable unit for your account'), { code: 'FORBIDDEN' });
      return trackerStore.saveEntries(p.key, p.cells, { user: u, def: pub.definition, lockClosed: true, allowedUnits: allowed, source: 'field' });
    },
    async action(u, p) {
      const err = F.validateActionPayload(p); if (err) throw Object.assign(new Error(err), { code: 'INVALID' });
      const mod = p.source === 'meetings' ? mdb() : idb();
      const parent = await mod.getActionParent(Number(p.id)); if (!parent) throw Object.assign(new Error('action not found'), { code: 'INVALID' });
      const codes = await moduleCodes(u);
      if (codes !== null && !userSites.inScope(parent.site_code, codes)) throw Object.assign(new Error(`action belongs to ${parent.site_code}`), { code: 'FORBIDDEN' });
      const tErr = statusTransfer.validate(p.status_change, p.body, p.helpdesk_ticket); if (tErr) throw Object.assign(new Error(tErr), { code: 'INVALID' });
      await mod.addActionUpdate(Number(p.id), { author_id: u.id, author_name: u.full_name || u.username, body: p.body || '', status_change: p.status_change || null, helpdesk_ticket: p.helpdesk_ticket || null });
      return { action_id: Number(p.id), status: p.status_change || null };
    },
    async ticket(u, p) {
      const err = F.validateTicketPayload(p); if (err) throw Object.assign(new Error(err), { code: 'INVALID' });
      const c = await cfg();
      if (String(c.sdp_api_write_enabled) !== '1') throw Object.assign(new Error('SDP ticket creation is disabled by the administrator (sdp_api_write_enabled)'), { code: 'REJECTED' });
      const client = deps.sdpClient || require('../services/sdpApiClient').makeSdpClient({ baseUrl: c.sdp_api_base_url, accountsUrl: c.sdp_api_accounts_url, allowHosts: require('../services/safeUrl').allowHostsFromConfig(c), clientId: c.sdp_api_client_id, clientSecret: c.sdp_api_client_secret, refreshToken: c.sdp_api_refresh_token, writeEnabled: true });
      const r = await client.createRequest({ subject: String(p.subject).slice(0, 250), description: String(p.description || '').slice(0, 4000), siteName: p.site || null, priority: p.priority || null, requesterEmail: u.email || null });
      return { request_id: r && r.id ? String(r.id) : null, display_id: r && r.display_id ? String(r.display_id) : null };
    },
  };

  router.put('/api/field/outbox/:uuid', requireReportSession, requireField, json, async (req, res) => {
    try {
      const env = { ...(req.body || {}), uuid: req.params.uuid };
      const v = F.validateEnvelope(env); if (!v.ok) return res.status(400).json({ ok: false, error: v.errors.join('; '), errors: v.errors });
      const hash = F.payloadHash(env.payload);
      const u = req.reportUser;
      const row = await store.receive({ uuid: env.uuid, userId: u.id, kind: env.kind, payloadHash: hash, clientTs: env.client_ts || null, device: env.device || null });
      if (row.user_id !== Number(u.id)) return res.status(403).json({ ok: false, error: 'uuid belongs to another user' });
      if (row.payload_hash !== hash) return res.status(409).json({ ok: false, error: 'same uuid, different payload — generate a new uuid', status: row.status });
      if (row.status !== 'received') return res.json({ ok: row.status === 'applied', duplicate: true, status: row.status, result: row.result });
      let status = 'applied', result = null, code = 200;
      try { result = await APPLY[env.kind](u, env.payload); }
      catch (e) {
        if (e.code === 'INVALID' || e.code === 'FORBIDDEN' || e.code === 'REJECTED' || e.code === 'WRITE_DISABLED') { status = 'rejected'; result = { error: e.message, errors: e.errors || undefined }; code = e.code === 'FORBIDDEN' ? 403 : e.code === 'INVALID' ? 400 : 200; }
        else { status = 'failed'; result = { error: 'internal_error', correlation_id: logError(e, req, 500) }; code = 500; }
      }
      const fin = await store.finish(env.uuid, status, result);
      try { rdb().logEvent({ category: 'field', action: `field_${env.kind}_${status}`, target: env.uuid, details: { device: env.device || null }, ...rdb()._logCtx(req) }); } catch (_) { /* best effort */ }
      res.status(code).json({ ok: status === 'applied', duplicate: false, status, result: fin.result });
    } catch (e) { fail(res, e); }
  });

  // ── chunked uploads ───────────────────────────────────────────────────────────────
  router.post('/api/field/uploads', requireReportSession, requireField, json, async (req, res) => {
    try {
      const b = req.body || {};
      const c = await cfg();
      const cap = Math.min(F.MAX_PHOTO_BYTES, (Number(c.field_photo_max_kb) || 300) * 1024);
      if (Number(b.size) > cap) return res.status(400).json({ ok: false, error: `photo is ${b.size} bytes — the field cap is ${cap}` });
      const plan = F.chunkPlan(b.size, b.chunk_bytes);
      if (!b.owner_id) return res.status(400).json({ ok: false, error: 'owner_id (inspection id) required' });
      if (!/^image\/(jpeg|png|webp)$/.test(String(b.mime || ''))) return res.status(400).json({ ok: false, error: 'mime must be image/jpeg, image/png or image/webp' });
      const up = await store.createUpload({ userId: req.reportUser.id, ownerKind: b.owner_kind || 'inspection', ownerId: b.owner_id, name: b.name || 'photo', mime: b.mime, size: plan.size, chunkBytes: plan.chunk_bytes, chunksTotal: plan.chunks_total });
      res.status(201).json({ ok: true, upload: { ...up, missing: F.missingChunks(up.received, up.chunks_total) } });
    } catch (e) { fail(res, e); }
  });
  async function ownUpload(req, res) {
    const up = await store.getUpload(req.params.id);
    if (!up || up.user_id !== Number(req.reportUser.id)) { res.status(404).json({ ok: false, error: 'upload not found' }); return null; }
    return up;
  }
  router.get('/api/field/uploads/:id', requireReportSession, requireField, async (req, res) => {
    try { const up = await ownUpload(req, res); if (!up) return; res.json({ ok: true, upload: { ...up, missing: F.missingChunks(up.received, up.chunks_total) } }); } catch (e) { fail(res, e); }
  });
  router.put('/api/field/uploads/:id/chunks/:idx', requireReportSession, requireField, express.json({ limit: '200kb' }), async (req, res) => {
    try {
      const up = await ownUpload(req, res); if (!up) return;
      const data = req.body && req.body.data;
      if (typeof data !== 'string' || Buffer.from(data, 'base64').length > up.chunk_bytes) return res.status(400).json({ ok: false, error: `chunk must be base64 of at most ${up.chunk_bytes} bytes` });
      const out = await store.putChunk(up.id, req.params.idx, data);
      res.json({ ok: true, upload: { ...out, missing: F.missingChunks(out.received, out.chunks_total) } });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/field/uploads/:id/complete', requireReportSession, requireField, async (req, res) => {
    try {
      const up = await ownUpload(req, res); if (!up) return;
      if (up.status === 'done') return res.json({ ok: true, duplicate: true, upload: up });
      const buf = F.assembleChunks(await store.chunksOf(up.id), { total: up.chunks_total, size: up.size });
      const saved = blobStore.putB64('inspection', up.owner_id, up.name, up.mime, buf.toString('base64'));
      const out = await store.completeUpload(up.id, saved.ref);
      res.json({ ok: true, duplicate: false, upload: out });
    } catch (e) { fail(res, e); }
  });

  return router;
};
module.exports.createStore = createStore;
