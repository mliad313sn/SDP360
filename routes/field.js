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
//   GET  /api/field/admin/outbox           E-F01 admin tier: unresolved entries + counts (no payloads)
//   POST /api/field/admin/outbox/:uuid/resolve  E-F01 admin tier, switch field_outbox_resolve_enabled (404 off)
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
  function requireField(req, res, next) { if (!isField(req.reportUser)) return res.status(403).json({ ok: false, reason: 'field_role', error: 'editor or field-tech role required' }); next(); }
  requireField.legacyRoles = ['admin', 'editor', 'field-tech'];   // C-17 capability catalogue tag
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false, missing: e && e.missing || undefined });
  // C-19 (G41): qualification evidence for field capture — a no-op unless qualification_check_enabled='1' AND
  // a requirement is declared for field.capture (catalogue prereq or report_config qualification_requirements).
  let _qg = null;
  function qualificationGate(req, res, next) { _qg = _qg || (deps.qualStore || require('../services/qualificationStore').forRdb(rdb())).gate('field.capture'); return _qg(req, res, next); }

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
      res.json({ ok: true, user: { id: u.id, username: u.username, name: u.full_name || u.username, roles: u.roles || [u.role] },
        sites: sites.map(s => ({ id: Number(s.id), name: s.name, inspection_code: idb().siteNameToCode(s.name), tracker_code: tdb().siteToCode(s) })),
        scope_codes: codes, lookups, trackers, actions: actions.slice(0, 500), dashboard,
        limits: { photo_max_bytes: Math.min(F.MAX_PHOTO_BYTES, (Number(c.field_photo_max_kb) || 300) * 1024), chunk_bytes: F.CHUNK_BYTES, max_chunks: F.MAX_CHUNKS, conflict_policy: F.CONFLICT_POLICY },
        features: Object.assign({ ticket: String(c.sdp_api_write_enabled) === '1' && !!(c.sdp_api_base_url && c.sdp_api_client_id) },
          // E-F03 — shadow switches, sent only when ON so the bootstrap is unchanged while they are off
          String(c.field_review_step) === '1' ? { review_step: true } : {}, String(c.field_task_timing) === '1' ? { task_timing: true } : {}),
        server_time: new Date().toISOString() });
    } catch (e) { fail(res, e); }
  });

  router.get('/api/field/outbox', requireReportSession, requireField, async (req, res) => {
    try { res.json({ ok: true, items: await store.listOutbox(req.reportUser.id, { limit: req.query.limit, since: req.query.since || null }) }); } catch (e) { fail(res, e); }
  });

  // ── E-F01 admin: unresolved entries (read, ON) + authorised resolution (switch, default OFF) ───────
  // The list NEVER carries a payload (the ledger holds only its hash). Resolution never applies anything
  // server-side: mark_rejected ends an entry; release lets the phone's next send apply it exactly once.
  function requireFieldAdmin(req, res, next) { if (!isAdmin(req.reportUser)) return httpFail(res, new Error('admin tier required'), 403, { ok: false }); next(); }
  requireFieldAdmin.legacyRoles = ['admin'];   // C-17 capability catalogue tag (field.outbox.administer)
  router.get('/api/field/admin/outbox', requireReportSession, requireFieldAdmin, async (req, res) => {
    try {
      const q = req.query || {};
      const since = q.since && /^\d{4}-\d{2}-\d{2}/.test(String(q.since)) ? String(q.since) : null;
      const items = await store.listUnresolved({ status: q.status || null, kind: q.kind ? String(q.kind) : null, since, olderThanMin: q.older_than_min, limit: q.limit });
      const c = await cfg();
      res.json({ ok: true, stats: await store.outboxStats({ since }), items, resolve_enabled: String(c.field_outbox_resolve_enabled) === '1' });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/field/admin/outbox/:uuid/resolve', requireReportSession, requireFieldAdmin, json, async (req, res) => {
    try {
      if (String((await cfg()).field_outbox_resolve_enabled) !== '1') return httpFail(res, new Error('not found'), 404, { ok: false });
      const b = req.body || {}; const u = req.reportUser;
      const out = await store.resolve(req.params.uuid, { action: b.action, reason: b.reason, confirmCheckedSdp: b.confirm_checked_sdp === true, actor: u.username });
      try { await rdb().logEvent({ category: 'field', action: 'field_outbox_resolved', target: out.uuid, risk: 1, details: { resolution: b.action, reason: String(b.reason).trim().slice(0, 500), kind: out.kind, entry_user_id: out.user_id, from: out.from, to: out.to, confirm_checked_sdp: b.confirm_checked_sdp === true }, ...rdb()._logCtx(req) }); } catch (_) { /* best effort */ }
      res.json({ ok: true, ...out });
    } catch (e) { fail(res, e); }
  });

  // ── applying one envelope, exactly once ───────────────────────────────────────────
  const APPLY = {
    async inspection(u, p) {
      if (!p.meta || !p.meta.f_site) throw Object.assign(new Error('inspection payload needs meta.f_site'), { code: 'INVALID', reason: 'inspection_invalid' });
      const codes = await moduleCodes(u);
      if (Array.isArray(codes) && !codes.length) throw Object.assign(new Error('your account has no inspection site'), { code: 'FORBIDDEN', reason: 'no_inspection_site' });
      const siteCode = idb().parseSiteCode(p.meta.f_site);
      if (codes !== null && !userSites.inScope(siteCode, codes)) throw Object.assign(new Error(`inspection is for ${siteCode || 'no site'}, your scope is ${codes.join(', ')}`), { code: 'FORBIDDEN', reason: 'inspection_out_of_scope' });
      // Photos must reference COMPLETED uploads of this user ({upload_id} → {__blob}); inline data: URLs are refused on the field path.
      const allowRefs = new Set();
      for (const it of Object.values(p.items || {})) {
        if (!it || !Array.isArray(it.photos)) continue;
        const out = [];
        for (const ph of it.photos) {
          // a phone never names a stored file itself: a client-supplied {__blob} could point at another site's evidence
          if (ph && ph.__blob) throw Object.assign(new Error('field photos are referenced by upload id only'), { code: 'INVALID', reason: 'photo_not_uploaded' });
          if (ph && ph.upload_id != null) { const up = await store.getUpload(ph.upload_id); if (!up || up.user_id !== Number(u.id) || up.status !== 'done') throw Object.assign(new Error(`upload ${ph.upload_id} not completed`), { code: 'INVALID', reason: 'photo_not_uploaded' }); allowRefs.add(up.ref); out.push({ __blob: up.ref, mime: up.mime, sizeBytes: up.size, caption: ph.caption || '' }); continue; }
          throw Object.assign(new Error('field photos must be uploaded in chunks first (no inline data URLs)'), { code: 'INVALID', reason: 'photo_not_uploaded' });
        }
        it.photos = out;
      }
      // P11 F-1 — the field path CREATES inspections; it never rewrites one it did not create. An id that already
      // exists (a submitted / closed record, another person's draft, or an accidental id collision) is a 409 kept on
      // the phone as a conflict. The only existing row accepted is this user's own capture replayed unchanged
      // (a send whose answer was lost): same author, identical meta.
      // P11 r2 F-6 — "unchanged" means the WHOLE stored record equals this payload (meta, items, actions, status…),
      // not only its meta: a different payload would un-submit or rewrite findings, and a record edited since (a
      // coordinator's review) is no longer the field's capture. Both are 409, the row untouched.
      const existing = idb().getInspectionForFieldReplay ? await idb().getInspectionForFieldReplay(p.meta.f_id) : null;
      if (existing) {
        const sameCapture = existing.created_by === Number(u.id) && existing.state
          && F.stableJson(existing.state) === F.stableJson(p) && String(existing.status || 'draft') === String(p.status || 'draft');
        // P11 r3 R2-N3 — an id of ANOTHER site's inspection gets the same refusal without its status (no oracle on
        // a record the caller may not read); within the caller's scope the status helps them understand the 409
        const ownScope = codes === null || userSites.inScope(existing.site_code, codes);
        if (!sameCapture && !ownScope) throw Object.assign(new Error('this inspection id is already used on the server — it is not changed from the field app; capture a new inspection'), { code: 'CONFLICT', reason: 'inspection_exists' });
        if (!sameCapture) throw Object.assign(new Error(`inspection ${String(p.meta.f_id).slice(0, 60)} already exists on the server (${existing.status}) — it is not changed from the field app; capture a new inspection`), { code: 'CONFLICT', reason: 'inspection_exists', detail: { status: String(existing.status || '').slice(0, 40) } });
      }
      const r = await idb().saveInspection(p, codes, u.id, { allowRefs });
      return { inspection_id: (r && r.id) || p.meta.f_id || null };
    },
    async tracker(u, p) {
      const err = F.validateTrackerPayload(p); if (err) throw Object.assign(new Error(err), { code: 'INVALID', reason: 'tracker_invalid' });
      if (!trackerStore) throw new Error('tracker store unavailable');
      const pub = await trackerStore.published(p.key); if (!pub) throw Object.assign(new Error('tracker not published'), { code: 'INVALID', reason: 'tracker_not_published' });
      const allowed = await trackerUnits(u, pub.definition);
      if (Array.isArray(allowed) && !allowed.length) throw Object.assign(new Error('no writable unit for your account'), { code: 'FORBIDDEN', reason: 'tracker_no_unit' });
      return trackerStore.saveEntries(p.key, p.cells, { user: u, def: pub.definition, lockClosed: true, allowedUnits: allowed, source: 'field' });
    },
    async action(u, p, env) {
      const err = F.validateActionPayload(p); if (err) throw Object.assign(new Error(err), { code: 'INVALID', reason: 'action_invalid' });
      // A-05: old phones / queued envelopes send 'closed' (not a md_statuses code) → 'resolved'
      if (p.source === 'meetings' && p.status_change) {
        p = { ...p, status_change: statusTransfer.normalizeMeetingStatus(p.status_change) };
        // P11 r4 F-10 — the same rule as r3 F-9 for inspection actions: from the field app a meetings action is only
        // resolved, cancelled or transferred (demand / helpdesk_ticket) — what the app offers. A reopen or a move
        // (open, in_progress, blocked, on_hold) needs the web register, where `editor` of the site is required
        // (POST /api/meetings/actions/:id/update). The terminal set is the shared statusTransfer.DONE list.
        if (!statusTransfer.isDone(p.status_change)) throw Object.assign(new Error(`a meetings action can only be resolved, cancelled or transferred from the field app (not "${String(p.status_change).slice(0, 40)}")`), { code: 'INVALID', reason: 'meetings_action_status' });
      }
      // P11 r2 F-5 — an inspection action takes Open / In Progress / Closed / Cancelled only (the transfer statuses
      // demand / helpdesk_ticket are meetings-only); a case variant is stored in its canonical form
      if (p.source === 'inspection' && p.status_change) {
        const canon = idb().normalizeActionStatus(p.status_change);
        if (!canon) throw Object.assign(new Error(`"${String(p.status_change).slice(0, 40)}" is not an inspection action status (Open, In Progress, Closed, Cancelled)`), { code: 'INVALID', reason: 'inspection_action_status' });
        // P11 r3 F-9 — from the field app an inspection action is only CLOSED or CANCELLED (what the app offers); a
        // reopen or a move to In Progress is the web register's job (editor of the site)
        if (!['Closed', 'Cancelled'].includes(canon)) throw Object.assign(new Error(`an inspection action can only be closed or cancelled from the field app (not "${canon}")`), { code: 'INVALID', reason: 'inspection_action_status' });
        p = { ...p, status_change: canon };
      }
      const mod = p.source === 'meetings' ? mdb() : idb();
      // P11 r4 F-11 — a missing id and an id outside the caller's scope get ONE refusal (same code, same text, no site
      // code): the field route is not an oracle on which actions exist or which site owns them (cf. r3 R2-N3)
      const unavailable = () => Object.assign(new Error('this action does not exist or is not in your scope'), { code: 'FORBIDDEN', reason: 'action_unavailable' });
      const parent = await mod.getActionParent(Number(p.id)); if (!parent) throw unavailable();
      const codes = await moduleCodes(u);
      if (codes !== null && !userSites.inScope(parent.site_code, codes)) throw unavailable();
      const tErr = statusTransfer.validate(p.status_change, p.body, p.helpdesk_ticket); if (tErr) throw Object.assign(new Error(tErr), { code: 'INVALID', reason: 'status_justification' });
      // P11 F-2 — a status change made on the server after the phone saw the action is never overwritten (409):
      // the phone sends the status it saw (base_status); an envelope queued before that field existed is compared
      // on its queue time with the last server status change. A comment only changes nothing and never conflicts.
      if (p.status_change) {
        const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
        const now = parent.action_status;
        let changed = false;
        if (p.base_status != null && String(p.base_status) !== '') changed = norm(now) !== norm(p.base_status);
        else {
          // P11 r2 F-2 residual — without base_status the queue time decides; a missing or future client_ts (beyond a
          // 5-minute clock skew) cannot prove the phone saw the server's last status change, so that change wins
          const ts = env && env.client_ts ? Date.parse(env.client_ts) : NaN;
          if (parent.last_status_change_at) {
            const last = Date.parse(parent.last_status_change_at);
            changed = !Number.isFinite(ts) || ts > Date.now() + 5 * 60e3 || last > ts;
          }
          // P11 r4 F-2 residual — an action re-created or edited through the inspection editor writes no audit row;
          // a row changed after the queue time is treated as a server-side change too (optimistic concurrency)
          if (!changed && parent.row_changed_at && Number.isFinite(ts)) changed = Date.parse(parent.row_changed_at) > ts;
        }
        if (changed && norm(now) !== norm(p.status_change)) throw Object.assign(new Error(`this action was changed on the server since it was queued (now ${String(now || '—').slice(0, 40)}) — check it before sending again`), { code: 'CONFLICT', reason: 'action_changed', detail: { now: String(now || '—').slice(0, 40) } });
      }
      await mod.addActionUpdate(Number(p.id), { author_id: u.id, author_name: u.full_name || u.username, body: p.body || '', status_change: p.status_change || null, helpdesk_ticket: p.helpdesk_ticket || null });
      return { action_id: Number(p.id), status: p.status_change || null };
    },
    async ticket(u, p) {
      const err = F.validateTicketPayload(p); if (err) throw Object.assign(new Error(err), { code: 'INVALID', reason: 'ticket_invalid' });
      const c = await cfg();
      if (String(c.sdp_api_write_enabled) !== '1') throw Object.assign(new Error('SDP ticket creation is disabled by the administrator (sdp_api_write_enabled)'), { code: 'REJECTED', reason: 'ticket_disabled' });
      // SEC-01 — a site-scoped user opens a request for one of THEIR sites only (canonical name sent); admin tier unscoped
      let siteName = p.site || null;
      if (!isAdmin(u)) {
        const k = (v) => String(v == null ? '' : v).trim().toLowerCase();
        const mine = (await scopeSites(u)).find((s) => k(s.name) === k(p.site));
        if (!p.site || !mine) throw Object.assign(new Error(p.site ? `ticket names ${String(p.site).slice(0, 60)}, which is not one of your sites` : 'a ticket must name one of your sites'), { code: 'FORBIDDEN', reason: 'ticket_out_of_scope' });
        siteName = mine.name;
      }
      const client = deps.sdpClient || require('../services/sdpApiClient').makeSdpClient({ baseUrl: c.sdp_api_base_url, accountsUrl: c.sdp_api_accounts_url, allowHosts: require('../services/safeUrl').allowHostsFromConfig(c), clientId: c.sdp_api_client_id, clientSecret: c.sdp_api_client_secret, refreshToken: c.sdp_api_refresh_token, writeEnabled: true });
      const r = await client.createRequest({ subject: String(p.subject).slice(0, 250), description: String(p.description || '').slice(0, 4000), siteName, priority: p.priority || null, requesterEmail: u.email || null });
      return { request_id: r && r.id ? String(r.id) : null, display_id: r && r.display_id ? String(r.display_id) : null };
    },
  };

  // the site an entry is about, for the timing report only (a code or a site name; null when unknown)
  function siteOfEntry(kind, p) {
    try {
      if (kind === 'inspection') return idb().parseSiteCode(p.meta && p.meta.f_site) || null;
      if (kind === 'tracker') return (p.cells && p.cells[0] && p.cells[0].unit) || null;
      if (kind === 'ticket') return p.site || null;
    } catch (_) { /* unknown */ }
    return null;
  }
  router.put('/api/field/outbox/:uuid', requireReportSession, requireField, qualificationGate, json, async (req, res) => {
    try {
      const env = { ...(req.body || {}), uuid: req.params.uuid };
      const v = F.validateEnvelope(env); if (!v.ok) return res.status(400).json({ ok: false, reason: 'envelope_invalid', error: v.errors.join('; '), errors: v.errors });
      const hash = F.payloadHash(env.payload);
      const u = req.reportUser;
      // the phone names the author of the entry; an entry queued by someone else is never applied under this session
      if (env.author != null && String(env.author) !== String(u.username)) return res.status(403).json({ ok: false, wrong_author: true, reason: 'wrong_author', error: `this entry was recorded by ${String(env.author).slice(0, 60)} — sign in as that person to send it` });
      const row = await store.receive({ uuid: env.uuid, userId: u.id, kind: env.kind, payloadHash: hash, clientTs: env.client_ts || null, device: env.device || null });
      if (row.user_id !== Number(u.id)) return res.status(403).json({ ok: false, reason: 'uuid_other_user', error: 'uuid belongs to another user' });
      if (row.payload_hash !== hash) return res.status(409).json({ ok: false, reason: 'uuid_payload_mismatch', error: 'same uuid, different payload — generate a new uuid', status: row.status });
      if (row.status === 'applied' || row.status === 'rejected') return res.json({ ok: row.status === 'applied', duplicate: true, status: row.status, result: row.result });
      // G19 — exactly once even with two sends of the same envelope at the same time (two tabs, a retry while the
      // first send is still running); a transient failure stays retryable instead of becoming a dead duplicate
      const claimId = await store.claim(env.uuid, { kind: env.kind });
      if (!claimId) return res.status(409).json({ ok: false, in_progress: true, reason: 'in_progress', status: 'applying', error: 'this entry is being applied — try again in a moment' });
      let status = 'applied', result = null, code = 200;
      try { result = await APPLY[env.kind](u, env.payload, env); }
      catch (e) {
        // P11 F-1/F-2 — a conflict (the record changed elsewhere, or the id already exists) is terminal and a 409:
        // the phone keeps the entry as 'conflict' with the reason; nothing is written
        // P11 r2 F-4 — `reason` (+ `detail`) lets the phone show the refusal in the user's language
        if (e.code === 'CONFLICT') { status = 'rejected'; result = { error: e.message, conflict: true, reason: e.reason || 'conflict', detail: e.detail || undefined }; code = 409; }
        // P11 r3 F-8 — a typed VALIDATION error (e.g. an out-of-vocabulary action status inside an inspection) is a
        // client error like INVALID: terminal 400, never 'failed' (which the phone would retry forever)
        else if (e.code === 'INVALID' || e.code === 'VALIDATION' || e.code === 'FORBIDDEN' || e.code === 'REJECTED' || e.code === 'WRITE_DISABLED') { status = 'rejected'; result = { error: e.message, errors: e.errors || undefined, reason: e.reason || F.fallbackReason(e.code) }; code = e.code === 'FORBIDDEN' ? 403 : (e.code === 'INVALID' || e.code === 'VALIDATION') ? 400 : 200; }
        // a ticket whose outcome is unknown (SDP may have created it before the error) is NOT retried: a retry would
        // create a second request. It is refused with a reason to check SDP; other kinds stay retryable.
        else if (env.kind === 'ticket') { status = 'rejected'; result = { error: 'outcome unknown — check ServiceDesk Plus before sending again', outcome_unknown: true, reason: 'outcome_unknown', correlation_id: logError(e, req, 500) }; code = 200; }
        else { status = 'failed'; result = { error: 'internal_error', correlation_id: logError(e, req, 500) }; code = 500; }
      }
      let fin;
      try { fin = await store.finish(env.uuid, status, result, claimId); }
      catch (e) {
        // another request took the claim over and recorded the outcome: report THAT outcome (never a conflict the
        // phone would "send again" under a new id)
        if (e.code !== 'CONFLICT') throw e;
        const now = await store.getOutbox(env.uuid);
        return res.json({ ok: now && now.status === 'applied', duplicate: true, status: now ? now.status : 'applying', result: now ? now.result : null, in_progress: !now || now.status === 'applying' });
      }
      // E-F03 — task time (form open → queued, ms) recorded only while field_task_timing = 1, only on an applied entry,
      // with the user id and role tier — never a name (the row's actor becomes u<id>, like page_viewed)
      let timing = null;
      if (status === 'applied' && env.meta && env.meta.task_ms != null) {
        const ms = Math.round(Number(env.meta.task_ms));
        if (Number.isFinite(ms) && ms >= 0 && ms <= 24 * 3600e3 && String((await cfg()).field_task_timing) === '1') timing = { task_ms: ms, site: siteOfEntry(env.kind, env.payload), tier: require('../services/pageUsage').roleTier(u) };
      }
      try {
        const ctx = rdb()._logCtx(req);
        if (timing) rdb().logEvent({ category: 'field', action: `field_${env.kind}_${status}`, target: env.uuid, details: { device: env.device || null, ...timing }, ...ctx, actor: 'u' + u.id, actor_id: u.id, ip: null });
        else rdb().logEvent({ category: 'field', action: `field_${env.kind}_${status}`, target: env.uuid, details: { device: env.device || null }, ...ctx });
      } catch (_) { /* best effort */ }
      res.status(code).json({ ok: status === 'applied', duplicate: false, status, result: fin.result, outcome_unknown: !!(result && result.outcome_unknown) });
    } catch (e) { fail(res, e); }
  });

  // ── chunked uploads ───────────────────────────────────────────────────────────────
  router.post('/api/field/uploads', requireReportSession, requireField, qualificationGate, json, async (req, res) => {
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
      // the file lands in a namespace only the server names (never the client's owner_id / name: those used to let a
      // user of site A overwrite site B's photo files); the inspection save then attaches it after its site check
      const saved = blobStore.putB64('field', `u${Number(up.user_id)}`, `${up.id}-${require('crypto').randomUUID()}`, up.mime, buf.toString('base64'));
      const out = await store.completeUpload(up.id, saved.ref);
      res.json({ ok: true, duplicate: false, upload: out });
    } catch (e) { fail(res, e); }
  });

  return router;
};
module.exports.createStore = createStore;
