'use strict';
// 2027 Goal 02 — canonical commitments API (feature flag `commitments_enabled`, default '0').
// Flag off → every /api/commitments route answers 404 and nothing else in the app changes.
//
//   GET  /api/commitments?status=&kind=&site=        scoped list (own sites + where named reviewer/owner)
//   GET  /api/commitments/metrics?site=              draft metrics (services/commitmentMetrics)
//   GET  /api/commitments/escalations                open A01 / A02 escalations (?all=1 includes cleared)
//   GET  /api/commitments/:id                        detail + links + evidence + verifications + events + allowed transitions
//   POST /api/commitments                            create (idempotent on body.source {system,id})      editor of the site | admin tier
//   PUT  /api/commitments/:id                        edit fields (body.version required; due-date change needs body.reason)
//   POST /api/commitments/:id/transition             { to, version, reason }  — rules in services/commitmentLifecycle
//   POST /api/commitments/:id/exception              { version, reason } approve a due-date exception        admin tier
//   POST /api/commitments/:id/links · DELETE /:id/links   { source_system, source_id, relation }
//   POST /api/commitments/:id/evidence               raw file body (Content-Type = mime, X-Filename) or JSON { url }
//   GET  /api/commitments/:id/evidence/:eid          download
//   GET  /commitments.html                           owner / reviewer page
// Out-of-scope id → 404 (no enumeration across sites). Errors go through services/httpError.fail.

const { fail: httpFail, typed } = require('../services/httpError');

function createStore(rdbMod) {
  const pg = rdbMod.REPORTS_BACKEND === 'postgres';
  const st = require('../services/commitmentStore').makeCommitmentStore(({ prepare: (sql) => rdbMod.pgHandle().prepare(sql), runTransaction: (fn) => rdbMod.pgHandle().runTransaction(fn) }), { isPg: pg });
  
  return st;
}

module.exports = function commitmentsRoutes(deps) {
  const { express, requireReportSession, store } = deps;
  const router = express.Router();
  const rdb = () => deps.rdb || require('../reports-db');
  const reportConfig = deps.reportConfig || require('../services/reportConfig');
  const userSites = require('../services/userSites');
  const L = require('../services/commitmentLifecycle');
  const raw = express.raw({ type: () => true, limit: '11mb' });
  const RedId = require('../public/lib/dashboardRender');   // E-K03 — one source-id format, page + server
  async function redLinksOn() { try { return String((await reportConfig.getConfig(rdb().db)).dashboard_red_action_links) === '1'; } catch (_) { return false; } }
  const fail = (res, e) => httpFail(res, e);

  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  const identities = (u) => [u && u.username, u && u.email].filter(Boolean);   // never the full name (namesakes) — security P1-3
  const actorOf = (u, c, ex = {}) => ({ id: u.id, username: u.username, full_name: u.full_name, email: u.email, isAdmin: isAdmin(u),
    canEdit: rdb().userHasRole(u, 'editor') && c && c.site_id != null && userSites.hasSite(u, c.site_id), principals: ex.principals || [], roleReviewer: !!ex.roleReviewer });
  // ADR-006 — who this user stands in for today, and whether they hold commitments.reviewer for the site.
  // No rolesStore / empty tables = no extras = the behaviour until now.
  async function extrasFor(u, c) {
    const rs = deps.getRolesStore && deps.getRolesStore(); if (!rs || !c) return {};
    try {
      const snap = await rs.snapshot(); const R = require('../services/governanceRoles'); const day = new Date().toISOString().slice(0, 10);
      const ids = R.principalsOf(snap.deputies, u.id, day, { siteId: c.site_id, register: 'commitments' });   // C-21 — scoped deputies
      const users = ids.length ? ((await rdb().listUsers()) || []).filter((x) => ids.includes(Number(x.id))).map((x) => ({ id: x.id, username: x.username, email: x.email, full_name: x.full_name })) : [];
      return { principals: users, roleReviewer: R.holders(snap.assignments, 'commitments.reviewer', c.site_id, day).includes(Number(u.id)) };
    } catch (_) { return {}; }
  }
  const log = (req, action, target, details) => { try { rdb().logEvent({ category: 'commitments', action, target: String(target), details, ...rdb()._logCtx(req) }); } catch (_) {} };

  // E-R02 — A03 / A04 in-app notices (services/commitmentNotices). Inside commitments_enabled (the route is gated),
  // nothing at all while notifications_stop = '1', in-app only, best effort: a notice failure never fails the transition.
  let _eng = null;
  const engStore = () => deps.engStore || (_eng = _eng || require('../services/engagementStore').makeEngagementStore({ prepare: (sql) => rdb().pgHandle().prepare(sql) }, { isPg: true }));
  async function noticeTransition(before, after, { reason, actorId }) {
    try {
      if (!after || !['awaiting_verification', 'rejected_for_rework'].includes(after.status)) return;
      const cfg = await reportConfig.getConfig(rdb().db);
      if (String(cfg.notifications_stop || '0') === '1') return;
      const users = (await rdb().listUsers()) || [];
      let roleReviewerIds = [];
      const rs = deps.getRolesStore && deps.getRolesStore();
      if (rs && !String(after.reviewer || '').trim() && after.site_id != null) {
        try { const snap = await rs.snapshot(); roleReviewerIds = require('../services/governanceRoles').holders(snap.assignments, 'commitments.reviewer', after.site_id, new Date().toISOString().slice(0, 10)); } catch (_) { roleReviewerIds = []; }
      }
      const N = require('../services/commitmentNotices').noticesFor(before, after, { reason, actorId, users, roleReviewerIds });
      const eng = engStore();
      for (const n of N.notices) { const { rule, ...row } = n; void rule; await eng.notify(row); }
    } catch (e) { console.warn('[commitments] A03/A04 notice skipped:', e.message); }
  }

  async function enabled(req, res, next) {
    try {
      const cfg = await reportConfig.getConfig(rdb().db);
      if (String(cfg.commitments_enabled) !== '1') return res.status(404).json({ error: 'commitments are not enabled' });
      next();
    } catch (e) { fail(res, e); }
  }
  /** Load a commitment the user may see, else 404. */
  async function load(req, res) {
    const c = await store.get(req.params.id);
    const u = req.reportUser;
    if (!visibleTo(u, c)) { res.status(404).json({ error: 'commitment not found' }); return null; }
    return c;
  }
  const canEdit = (u, c) => isAdmin(u) || (rdb().userHasRole(u, 'editor') && c.site_id != null && userSites.hasSite(u, c.site_id));
  const visibleTo = (u, c) => !!c && (isAdmin(u) || (c.site_id != null && userSites.hasSite(u, c.site_id)) || L.isReviewer(c, u) || L.isSelf(c, u));

  // G-18 — the site a source record belongs to. { checked:false } for systems we cannot resolve here
  // (SDP tickets, changes, governance, portfolio); { checked:true, site_id:null } when the record is missing.
  const mdb = () => deps.mdb || require('../meetings-db');
  const idb = () => deps.idb || require('../inspection-db');
  async function codeToSite(module, code) {
    if (!code) return null;
    const r = await rdb().getSiteIdByModuleCode(module, code);
    return r && r.site_id != null ? Number(r.site_id) : null;
  }
  async function sourceSite(system, id) {
    const sid = String(id == null ? '' : id);
    if (system === 'meetings') {
      const m = /^issue:(\d+)$/.exec(sid);
      const p = m ? await mdb().getIssueParent(Number(m[1])) : (/^\d+$/.test(sid) ? await mdb().getActionParent(Number(sid)) : null);
      return { checked: true, site_id: p ? await codeToSite('meetings', p.site_code) : null };
    }
    if (system === 'inspection') {
      const p = /^\d+$/.test(sid) ? await idb().getActionParent(Number(sid)) : null;
      return { checked: true, site_id: p ? await codeToSite('inspection', p.site_code) : null };
    }
    if (system === 'handoff') {   // committee #39 — a handoff recorded in the commitments ledger
      const h = /^\d+$/.test(sid) && deps.getHandoffStore ? await deps.getHandoffStore().getRaw(Number(sid)) : null;
      return { checked: true, site_id: h ? Number(h.site_id) : null };
    }
    if (system === 'problem_candidate') {   // E-I02 — the key carries its site: <site_id>|<category>|<sub-category>
      const k = require('../services/problemCandidates').parseSourceKey(sid);
      return { checked: true, site_id: k ? k.site_id : null };
    }
    if (system === 'metric') {   // E-K03 — '<metric>|<site_id>|<window>': the site is part of the id
      const ps = RedId.parseRedActionSource(sid);
      return { checked: true, site_id: ps ? ps.site_id : null };
    }
    if (system === 'report') {
      const o = await rdb().getActionItemOwner(sid);
      return { checked: true, site_id: o && o.site_id != null ? Number(o.site_id) : null };
    }
    return { checked: false };
  }
  /** A non-admin may only attach a source record of one of their own sites. Returns an error message or null. */
  async function sourceDenied(u, system, id) {
    if (isAdmin(u)) return null;
    const s = await sourceSite(system, id);
    if (!s.checked) return null;
    if (s.site_id == null) return { status: 400, error: `source ${system}:${id} not found` };
    if (!userSites.hasSite(u, s.site_id)) return { status: 403, error: 'Access denied: the source belongs to another site' };
    return null;
  }
  const view = async (c, u) => ({ ...c, allowed: L.allowedTransitions(c, actorOf(u, c, await extrasFor(u, c))), can_edit: canEdit(u, c) });

  router.get('/commitments.html', (req, res) => deps.sendHtmlPage(res, 'commitments.html', false, 'Commitments page unavailable'));

  const base = '/api/commitments';
  router.get(base, requireReportSession, enabled, async (req, res) => {
    try {
      const u = req.reportUser;
      const rows = await store.list({ siteIds: isAdmin(u) ? null : userSites.siteIds(u), named: isAdmin(u) ? [] : identities(u),
        status: req.query.status || null, kind: req.query.kind || null, site: req.query.site || null, exceptions: req.query.exceptions === '1' });
      if (req.query.metric && await redLinksOn()) {   // E-K03 — "Open actions (k)" of one red figure
        const open = (await store.openLinksFor('metric', [String(req.query.metric)])).get(String(req.query.metric)) || [];
        const keep = new Set(open.map((x) => x.id)); for (let i = rows.length - 1; i >= 0; i--) if (!keep.has(Number(rows[i].id))) rows.splice(i, 1);
      }
      if (req.query.exceptions === '1') { const today = new Date().toISOString(); for (const r of rows) r.exception_state = r.exception_expires_at && String(r.exception_expires_at) < today ? 'lapsed' : 'active'; }
      res.json({ commitments: rows, kinds: L.KINDS, statuses: L.STATUSES, severities: L.SEVERITIES, sites: isAdmin(u) ? null : userSites.siteIds(u) });
    } catch (e) { fail(res, e); }
  });
  router.get(base + '/metrics', requireReportSession, enabled, async (req, res) => {
    try {
      const u = req.reportUser;
      let scope = isAdmin(u) ? null : userSites.siteIds(u);
      if (req.query.site) { const s = Number(req.query.site); if (scope && !scope.includes(s)) return res.status(403).json({ error: 'Access denied: another site' }); scope = [s]; }
      const out = require('../services/commitmentMetrics').summary(await store.metricRows({ siteIds: scope }));
      res.json({ status: 'draft — pending committee', ...out });
    } catch (e) { fail(res, e); }
  });
  // G-18 — open A01 / A02 escalations (deduplicated ledger), scoped like the list.
  router.get(base + '/escalations', requireReportSession, enabled, async (req, res) => {
    try {
      const u = req.reportUser;
      res.json({ status: 'draft — pending committee', escalations: await store.listEscalations({ siteIds: isAdmin(u) ? null : userSites.siteIds(u), openOnly: req.query.all !== '1' }) });
    } catch (e) { fail(res, e); }
  });
  // E-I02 (audit I-02) — recurring-incident CANDIDATES (causality not validated). Switch problem_candidates_enabled
  // (default '0' → 404); threshold problem_candidate_min (empty = no candidate, no threshold invented). Site-scoped.
  async function problemsEnabled(req, res, next) {
    try {
      const cfg = await reportConfig.getConfig(rdb().db);
      if (String(cfg.problem_candidates_enabled) !== '1') return httpFail(res, new Error('problem candidates are not enabled'), 404, { ok: false });
      req._pcCfg = cfg; next();
    } catch (e) { fail(res, e); }
  }
  router.get(base + '/problem-candidates', requireReportSession, enabled, problemsEnabled, async (req, res) => {
    try {
      const u = req.reportUser; const PC = require('../services/problemCandidates');
      const own = userSites.siteIds(u);
      const siteId = req.query.site != null && req.query.site !== '' ? Number(req.query.site) : (own[0] != null ? Number(own[0]) : null);
      if (!Number.isInteger(siteId)) return httpFail(res, new Error('site is required'), 400, { ok: false });
      if (!isAdmin(u) && !userSites.hasSite(u, siteId)) return httpFail(res, new Error('Access denied: another site'), 403, { ok: false });
      const days = PC.parseDays(req.query.days);
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
      const min = PC.parseMin(req._pcCfg.problem_candidate_min);
      const read = min == null ? { scoped: true, rows: [] } : await PC.loadSiteIncidents(rdb().pgHandle(), siteId, from, to);
      const out = PC.computeCandidates(read.rows, { min, siteId, scoped: read.scoped });
      for (const c of out.candidates || []) {
        const cid = await store.findBySource('problem_candidate', c.source_key);
        c.commitment_id = cid == null ? null : Number(cid);
      }
      res.json({ status: PC.WORDING, site_id: siteId, window: { from, to, days }, ...out });
    } catch (e) { fail(res, e); }
  });
  // E-I03 (audit I-03, catalogue R15) — post-incident (PIR) review record per major incident. Switch pir_reviews_enabled
  // (default '0' → 404). Sign-off = a recorded human act by someone who is NOT the author; nothing is sent anywhere.
  const PIR = require('../services/pirReview');
  const pirStore = () => deps.pirStore || (deps._pir = deps._pir || PIR.makePirStore({ prepare: (sql) => rdb().pgHandle().prepare(sql) }));
  async function pirEnabled(req, res, next) {
    try {
      const cfg = await reportConfig.getConfig(rdb().db);
      if (String(cfg.pir_reviews_enabled) !== '1') return httpFail(res, new Error('post-incident reviews are not enabled'), 404, { ok: false });
      next();
    } catch (e) { fail(res, e); }
  }
  const mayReadSite = (u, siteId) => isAdmin(u) || (siteId != null && userSites.hasSite(u, siteId));
  const mayWriteSite = (u, siteId) => isAdmin(u) || (rdb().userHasRole(u, 'editor') && siteId != null && userSites.hasSite(u, siteId));
  function udfText(udfJson) {
    let u = {}; try { u = JSON.parse(udfJson || '{}') || {}; } catch (_) { u = {}; }
    const { INCIDENT_UDF_VARIANTS: V } = require('../services/roadmapEvidence');
    const pick = (keys) => { for (const k of keys) if (u[k] != null && String(u[k]).trim()) return String(u[k]).slice(0, 4000); return null; };
    return { rca: pick(V.rca), ca: pick(V.ca), pir: pick(V.pir), ll: pick(V.ll) };
  }
  async function pirLoad(req, res) {
    const ctx = await PIR.incidentContext(rdb().pgHandle(), req.params.rid);
    if (!ctx || !ctx.is_major || !mayReadSite(req.reportUser, ctx.site_id)) { httpFail(res, new Error('major incident not found'), 404, { ok: false }); return null; }
    return ctx;
  }
  async function pirCounts(ctx, w) {
    const today = new Date().toISOString().slice(0, 10);
    const win = ctx.occurred_on ? PIR.windows(ctx.occurred_on, w, today) : null;
    if (!win || ctx.site_id == null) return { before: null, after: null, windows: win };
    const rows = await PIR.sameKindIncidents(rdb().pgHandle(), ctx.site_id, ctx.category, ctx.sub_category, win.before.from, win.after.to);
    if (rows == null) return { before: null, after: null, windows: win };
    return PIR.countWindows(rows, { occurredDay: ctx.occurred_on, windowDays: w, today, requestId: ctx.request_id });
  }
  async function pirView(ctx, u) {
    const review = await pirStore().getByRequest(ctx.request_id);
    const w = review ? review.window_days : 90;
    const live = review && review.signed ? { before: review.before_count, after: review.after_count, windows: null, frozen: true } : await pirCounts(ctx, w);
    const { udf_json, ...inc } = ctx;
    return { incident: inc, udf: udfText(udf_json), review, counts: live, window_days: w,
      can_edit: mayWriteSite(u, ctx.site_id) && !(review && review.signed),
      can_sign: !!review && !review.signed && mayWriteSite(u, ctx.site_id) && Number(review.author_id) !== Number(u.id) };
  }
  router.get(base + '/pir', requireReportSession, enabled, pirEnabled, async (req, res) => {
    try {
      const u = req.reportUser;
      const sites = await rdb().listSites({ includeInactive: true });
      const byGroup = new Map();
      for (const s of sites || []) String(s.zoho_group || '').split(',').map((g) => g.trim()).filter(Boolean).forEach((g) => byGroup.set(g, Number(s.id)));
      const reviews = new Map((await pirStore().list({ siteIds: isAdmin(u) ? null : userSites.siteIds(u).map(Number) })).map((r) => [r.request_id, r]));
      const out = [];
      for (const mi of (await rdb().getMajorIncidentsHistory(12)) || []) {
        const siteId = byGroup.has(String(mi.Group || '').trim()) ? byGroup.get(String(mi.Group || '').trim()) : null;
        if (!mayReadSite(u, siteId)) continue;
        const r = reviews.get(String(mi['Request ID']));
        out.push({ request_id: String(mi['Request ID']), display_id: mi['Request Display ID'], subject: mi.Subject, created: mi['Created Time'], site_id: siteId,
          category: mi.Category, sub_category: mi['Sub Category'], review: r ? { id: r.id, signed: r.signed, author: r.author, signed_off_name: r.signed_off_name } : null });
      }
      res.json({ status: 'record — sign-off by a person other than the author', incidents: out });
    } catch (e) { fail(res, e); }
  });
  router.get(base + '/pir/:rid', requireReportSession, enabled, pirEnabled, async (req, res) => {
    try { const ctx = await pirLoad(req, res); if (!ctx) return; res.json(await pirView(ctx, req.reportUser)); } catch (e) { fail(res, e); }
  });
  router.post(base + '/pir/:rid', requireReportSession, enabled, pirEnabled, async (req, res) => {
    try {
      const ctx = await pirLoad(req, res); if (!ctx) return;
      const u = req.reportUser, b = req.body || {};
      if (!mayWriteSite(u, ctx.site_id)) return httpFail(res, new Error('editor of this site required'), 403, { ok: false });
      const ex = await pirStore().getByRequest(ctx.request_id);
      if (ex) await pirStore().update(ex.id, b, { expectedVersion: b.version });
      else { const r = await pirStore().create(ctx, b, u); if (r.created) log(req, 'pir_review_created', ctx.request_id, { site_id: ctx.site_id }); }
      res.status(ex ? 200 : 201).json(await pirView(ctx, u));
    } catch (e) { fail(res, e); }
  });
  router.post(base + '/pir/:rid/sign-off', requireReportSession, enabled, pirEnabled, async (req, res) => {
    try {
      const ctx = await pirLoad(req, res); if (!ctx) return;
      const u = req.reportUser, b = req.body || {};
      if (!mayWriteSite(u, ctx.site_id)) return httpFail(res, new Error('editor of this site required'), 403, { ok: false });
      const r = await pirStore().getByRequest(ctx.request_id);
      if (!r) return httpFail(res, new Error('no review recorded yet'), 404, { ok: false });
      const counts = await pirCounts(ctx, r.window_days);
      await pirStore().signOff(r.id, u, { note: b.note, counts, expectedVersion: b.version });
      log(req, 'pir_review_signed_off', ctx.request_id, { site_id: ctx.site_id, author: r.author });
      res.json(await pirView(ctx, u));
    } catch (e) { fail(res, e); }
  });
  // E-K03 — open commitments linked to red dashboard figures. Switch dashboard_red_action_links='0' → 404.
  // ids = comma list of '<metric>|<site_id>|<window>'; an id of a site the caller may not see is left out (no
  // enumeration); can_create = the caller may create a commitment on that site (editor of it, or admin tier).
  router.get(base + '/metric-links', requireReportSession, enabled, async (req, res) => {
    try {
      if (!(await redLinksOn())) return httpFail(res, new Error('red-figure action links are not enabled'), 404, { ok: false });
      const u = req.reportUser;
      const ids = String(req.query.ids || '').split(',').map((x) => x.trim()).filter((x) => RedId.parseRedActionSource(x)).slice(0, 200);
      const visible = ids.filter((x) => isAdmin(u) || userSites.hasSite(u, RedId.parseRedActionSource(x).site_id));
      const open = await store.openLinksFor('metric', visible);
      const links = {};
      for (const x of visible) {
        const site = RedId.parseRedActionSource(x).site_id;
        const list = (open.get(x) || []).filter((c) => visibleTo(u, c));
        links[x] = { count: list.length, open: list.map((c) => ({ id: c.id, title: c.title, status: c.status })),
          can_create: isAdmin(u) || (rdb().userHasRole(u, 'editor') && userSites.hasSite(u, site)) };
      }
      res.json({ links });
    } catch (e) { fail(res, e); }
  });
  router.get(base + '/:id', requireReportSession, enabled, async (req, res) => {
    try {
      const c = await load(req, res); if (!c) return;
      // C-21 (R11) — optional link of the free-text owner to an account (username / e-mail match only)
      let owner = null; try { owner = require('../services/commitmentOwner').ownerAccount(c.accountable_owner, (await rdb().listUsers()) || []); } catch (_) { owner = null; }
      res.json({ commitment: { ...(await view(c, req.reportUser)), accountable_owner_account: owner } });
    } catch (e) { fail(res, e); }
  });
  router.post(base, requireReportSession, enabled, async (req, res) => {
    try {
      const u = req.reportUser, b = req.body || {};
      if (!isAdmin(u)) {
        if (!rdb().userHasRole(u, 'editor')) return res.status(403).json({ error: 'editor role required' });
        if (b.site_id == null || !userSites.hasSite(u, b.site_id)) return res.status(403).json({ error: 'Access denied: another site' });
      }
      if (b.source && String(b.source.system) === 'problem_candidate') {   // E-I02 — promotion only while the switch is on
        const cfg = await reportConfig.getConfig(rdb().db);
        if (String(cfg.problem_candidates_enabled) !== '1') return httpFail(res, new Error('problem candidates are not enabled'), 404, { ok: false });
        const k = require('../services/problemCandidates').parseSourceKey(b.source.id);
        if (!k || Number(b.site_id) !== k.site_id) return httpFail(res, new Error('problem candidate key does not match site_id'), 400, { ok: false });
      }
      if (b.metric_link != null) {   // E-K03 — "Create action" from a red figure
        if (!(await redLinksOn())) return httpFail(res, new Error('red-figure action links are not enabled'), 400, { ok: false });
        const ps = RedId.parseRedActionSource(b.metric_link);
        if (!ps) return httpFail(res, new Error('metric_link must be "<metric>|<site_id>|<window>"'), 400, { ok: false });
        if (Number(b.site_id) !== ps.site_id) return httpFail(res, new Error('the action must be created on the site of the red figure'), 400, { ok: false });
        if (b.source) return httpFail(res, new Error('send either source or metric_link, not both'), 400, { ok: false });
        const r = await store.createWithLink(b, { source_system: 'metric', source_id: String(b.metric_link), relation: 'red_kpi' }, { user: u });
        log(req, 'commitment_created', r.commitment.id, { kind: r.commitment.kind, site_id: r.commitment.site_id, metric_link: String(b.metric_link) });
        return res.status(201).json({ created: true, commitment: await view(r.commitment, u) });
      }
      if (b.source && b.source.system) {
        const d = await sourceDenied(u, String(b.source.system), b.source.id);
        if (d) return res.status(d.status).json({ error: d.error });
        // a source whose site cannot be verified (SDP ticket / change, governance, portfolio) is unique across
        // the platform: a replay would reveal that another site already holds it (committee security). The
        // admin tier creates from it; a site editor creates from a site record and LINKS the ticket.
        if (!isAdmin(u) && !(await sourceSite(String(b.source.system), b.source.id)).checked) return res.status(403).json({ error: `only the admin tier creates a commitment from a ${String(b.source.system).slice(0, 40)} record — create it from a site record and link the ticket` });
      }
      const r = await store.create(b, { user: u });
      // idempotent replay: never hand back a commitment the caller cannot see
      if (!r.created && !visibleTo(u, r.commitment)) return res.status(409).json({ error: 'this source is already linked to another commitment' });
      if (r.created) log(req, 'commitment_created', r.commitment.id, { kind: r.commitment.kind, site_id: r.commitment.site_id });
      res.status(r.created ? 201 : 200).json({ created: r.created, commitment: await view(r.commitment, u) });
    } catch (e) { fail(res, e); }
  });
  router.put(base + '/:id', requireReportSession, enabled, async (req, res) => {
    try {
      const c = await load(req, res); if (!c) return;
      if (!canEdit(req.reportUser, c)) return res.status(403).json({ error: 'editor of this site required' });
      const b = req.body || {};
      res.json({ commitment: await view(await store.update(c.id, b, { user: req.reportUser, expectedVersion: b.version, reason: b.reason, isAdmin: isAdmin(req.reportUser), policy: await require('../services/governancePolicy').forContext({ siteId: c.site_id }) }), req.reportUser) });
    } catch (e) { fail(res, e); }
  });
  router.post(base + '/:id/transition', requireReportSession, enabled, async (req, res) => {
    try {
      const c = await load(req, res); if (!c) return;
      const b = req.body || {};
      const out = await store.transition(c.id, String(b.to || ''), { actor: actorOf(req.reportUser, c, await extrasFor(req.reportUser, c)), expectedVersion: b.version, reason: b.reason });
      log(req, 'commitment_transition', c.id, { from: c.status, to: out.status });
      await noticeTransition(c, out, { reason: b.reason, actorId: req.reportUser.id });
      res.json({ commitment: await view(out, req.reportUser) });
    } catch (e) { fail(res, e); }
  });
  router.post(base + '/:id/exception', requireReportSession, enabled, async (req, res) => {
    try {
      const c = await load(req, res); if (!c) return;
      if (!isAdmin(req.reportUser)) return res.status(403).json({ error: 'only the admin tier may approve an exception' });
      if (L.isSelf(c, req.reportUser)) return res.status(403).json({ error: 'the owner or creator cannot approve their own exception' });
      const b = req.body || {};
      res.json({ commitment: await view(await store.approveException(c.id, { user: req.reportUser, expectedVersion: b.version, reason: b.reason, policy: await require('../services/governancePolicy').forContext({ siteId: c.site_id }) }), req.reportUser) });
    } catch (e) { fail(res, e); }
  });
  router.post(base + '/:id/links', requireReportSession, enabled, async (req, res) => {
    try {
      const c = await load(req, res); if (!c) return;
      if (!canEdit(req.reportUser, c)) return res.status(403).json({ error: 'editor of this site required' });
      const lb = req.body || {};
      if (String(lb.source_system || '') === 'metric' && !(await redLinksOn())) return httpFail(res, new Error('red-figure action links are not enabled'), 400, { ok: false });
      const d = await sourceDenied(req.reportUser, String(lb.source_system || ''), lb.source_id);
      if (d) return res.status(d.status).json({ error: d.error });
      res.json({ commitment: await view(await store.link(c.id, req.body || {}, { user: req.reportUser }), req.reportUser) });
    } catch (e) { fail(res, e); }
  });
  router.delete(base + '/:id/links', requireReportSession, enabled, async (req, res) => {
    try {
      const c = await load(req, res); if (!c) return;
      if (!canEdit(req.reportUser, c)) return res.status(403).json({ error: 'editor of this site required' });
      res.json({ commitment: await view(await store.unlink(c.id, req.body || {}, { user: req.reportUser }), req.reportUser) });
    } catch (e) { fail(res, e); }
  });
  router.post(base + '/:id/evidence', requireReportSession, enabled, raw, async (req, res) => {
    try {
      const c = await load(req, res); if (!c) return;
      const u = req.reportUser;
      // evidence may come from whoever does or checks the work: site editor, executor, owner, reviewer.
      if (!(canEdit(u, c) || L.isSelf(c, u) || L.isReviewer(c, u))) return res.status(403).json({ error: 'not allowed to add evidence here' });
      const q = req.query || {};
      const opts = { type: q.type || 'document', retention_class: q.retention || 'standard', supersedes: q.supersedes || null };
      let r;
      if (Buffer.isBuffer(req.body)) r = await store.addEvidence(c.id, { ...opts, buffer: req.body, mime: req.get('content-type'), filename: req.get('x-filename') }, { user: u });
      else if (req.body && req.body.url) r = await store.addEvidence(c.id, { ...opts, type: req.body.type || 'link', url: req.body.url }, { user: u });
      else throw typed('VALIDATION', 'send the file as the request body, or JSON { url }', 400);
      log(req, 'commitment_evidence', c.id, { evidence_id: r.id, sha256: r.sha256 });
      res.status(201).json({ evidence_id: r.id, sha256: r.sha256, commitment: await view(r.commitment, u) });
    } catch (e) { fail(res, e); }
  });
  router.get(base + '/:id/evidence/:eid', requireReportSession, enabled, async (req, res) => {
    try {
      const c = await load(req, res); if (!c) return;
      const f = await store.getEvidenceFile(c.id, req.params.eid);
      if (!f) return res.status(404).json({ error: 'evidence not found' });
      res.set('Content-Type', f.mime || 'application/octet-stream');
      res.set('Content-Disposition', `attachment; filename="${String(f.filename || 'evidence').replace(/[^\w.\- ]/g, '_')}"`);
      res.set('X-Content-SHA256', f.sha256 || '');
      res.set('X-Content-Type-Options', 'nosniff');
      res.send(f.buffer);
    } catch (e) { fail(res, e); }
  });
  return router;
};
module.exports.createStore = createStore;
