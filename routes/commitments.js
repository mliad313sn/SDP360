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
  const st = require('../services/commitmentStore').makeCommitmentStore(({ prepare: (sql) => rdbMod.pgHandle().prepare(sql) }), { isPg: pg });
  
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
  const fail = (res, e) => httpFail(res, e);

  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  const identities = (u) => [u && u.username, u && u.email, u && u.full_name].filter(Boolean);
  const actorOf = (u, c) => ({ id: u.id, username: u.username, full_name: u.full_name, email: u.email, isAdmin: isAdmin(u),
    canEdit: rdb().userHasRole(u, 'editor') && c && c.site_id != null && userSites.hasSite(u, c.site_id) });
  const log = (req, action, target, details) => { try { rdb().logEvent({ category: 'commitments', action, target: String(target), details, ...rdb()._logCtx(req) }); } catch (_) {} };

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
  const view = (c, u) => ({ ...c, allowed: L.allowedTransitions(c, actorOf(u, c)), can_edit: canEdit(u, c) });

  router.get('/commitments.html', (req, res) => deps.sendHtmlPage(res, 'commitments.html', false, 'Commitments page unavailable'));

  const base = '/api/commitments';
  router.get(base, requireReportSession, enabled, async (req, res) => {
    try {
      const u = req.reportUser;
      const rows = await store.list({ siteIds: isAdmin(u) ? null : userSites.siteIds(u), named: isAdmin(u) ? [] : identities(u),
        status: req.query.status || null, kind: req.query.kind || null, site: req.query.site || null });
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
  router.get(base + '/:id', requireReportSession, enabled, async (req, res) => {
    try { const c = await load(req, res); if (c) res.json({ commitment: view(c, req.reportUser) }); } catch (e) { fail(res, e); }
  });
  router.post(base, requireReportSession, enabled, async (req, res) => {
    try {
      const u = req.reportUser, b = req.body || {};
      if (!isAdmin(u)) {
        if (!rdb().userHasRole(u, 'editor')) return res.status(403).json({ error: 'editor role required' });
        if (b.site_id == null || !userSites.hasSite(u, b.site_id)) return res.status(403).json({ error: 'Access denied: another site' });
      }
      if (b.source && b.source.system) {
        const d = await sourceDenied(u, String(b.source.system), b.source.id);
        if (d) return res.status(d.status).json({ error: d.error });
      }
      const r = await store.create(b, { user: u });
      // idempotent replay: never hand back a commitment the caller cannot see
      if (!r.created && !visibleTo(u, r.commitment)) return res.status(409).json({ error: 'this source is already linked to another commitment' });
      if (r.created) log(req, 'commitment_created', r.commitment.id, { kind: r.commitment.kind, site_id: r.commitment.site_id });
      res.status(r.created ? 201 : 200).json({ created: r.created, commitment: view(r.commitment, u) });
    } catch (e) { fail(res, e); }
  });
  router.put(base + '/:id', requireReportSession, enabled, async (req, res) => {
    try {
      const c = await load(req, res); if (!c) return;
      if (!canEdit(req.reportUser, c)) return res.status(403).json({ error: 'editor of this site required' });
      const b = req.body || {};
      res.json({ commitment: view(await store.update(c.id, b, { user: req.reportUser, expectedVersion: b.version, reason: b.reason }), req.reportUser) });
    } catch (e) { fail(res, e); }
  });
  router.post(base + '/:id/transition', requireReportSession, enabled, async (req, res) => {
    try {
      const c = await load(req, res); if (!c) return;
      const b = req.body || {};
      const out = await store.transition(c.id, String(b.to || ''), { actor: actorOf(req.reportUser, c), expectedVersion: b.version, reason: b.reason });
      log(req, 'commitment_transition', c.id, { from: c.status, to: out.status });
      res.json({ commitment: view(out, req.reportUser) });
    } catch (e) { fail(res, e); }
  });
  router.post(base + '/:id/exception', requireReportSession, enabled, async (req, res) => {
    try {
      const c = await load(req, res); if (!c) return;
      if (!isAdmin(req.reportUser)) return res.status(403).json({ error: 'only the admin tier may approve an exception' });
      if (L.isSelf(c, req.reportUser)) return res.status(403).json({ error: 'the owner or creator cannot approve their own exception' });
      const b = req.body || {};
      res.json({ commitment: view(await store.approveException(c.id, { user: req.reportUser, expectedVersion: b.version, reason: b.reason }), req.reportUser) });
    } catch (e) { fail(res, e); }
  });
  router.post(base + '/:id/links', requireReportSession, enabled, async (req, res) => {
    try {
      const c = await load(req, res); if (!c) return;
      if (!canEdit(req.reportUser, c)) return res.status(403).json({ error: 'editor of this site required' });
      const lb = req.body || {};
      const d = await sourceDenied(req.reportUser, String(lb.source_system || ''), lb.source_id);
      if (d) return res.status(d.status).json({ error: d.error });
      res.json({ commitment: view(await store.link(c.id, req.body || {}, { user: req.reportUser }), req.reportUser) });
    } catch (e) { fail(res, e); }
  });
  router.delete(base + '/:id/links', requireReportSession, enabled, async (req, res) => {
    try {
      const c = await load(req, res); if (!c) return;
      if (!canEdit(req.reportUser, c)) return res.status(403).json({ error: 'editor of this site required' });
      res.json({ commitment: view(await store.unlink(c.id, req.body || {}, { user: req.reportUser }), req.reportUser) });
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
      res.status(201).json({ evidence_id: r.id, sha256: r.sha256, commitment: view(r.commitment, u) });
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
