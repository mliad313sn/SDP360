'use strict';
// G-22 — interdepartmental business handoffs (committee review 2026-10-28). Feature flag handoffs_enabled
// (default '0'): off → every /api/handoffs route answers 404.
//
//   GET  /api/handoffs?status=                 scoped list: admin all; others their sites + where they are requester / receiver
//   GET  /api/handoffs/:id                     detail + events + allowed transitions
//   POST /api/handoffs                         { title, description, site_id, from_department, to_department, receiver, due_date,
//                                                source_kind, source_ref, commitment_id, idem_key }     editor of the site | admin
//   POST /api/handoffs/:id/transition          { to, version, reason }   rules: services/handoffLifecycle
//   POST /api/handoffs/:id/reassign            { receiver, version, reason }   requester | admin  → back to `requested`
//   GET  /handoffs.html
// The receiver is a named, ACTIVE user who has the handoff's site; departments are checked against the
// department list. Notifications (in-app only) are sent only when handoff_notify_enabled = '1'.

const { fail: httpFail, typed } = require('../services/httpError');

function createStore(rdbMod) {
  return require('../services/handoffStore').makeHandoffStore({ prepare: (sql) => rdbMod.pgHandle().prepare(sql) });
}

module.exports = function handoffRoutes(deps) {
  const { express, requireReportSession, store } = deps;
  const router = express.Router();
  const json = express.json({ limit: '64kb' });
  const rdb = () => deps.rdb || require('../reports-db');
  const reportConfig = deps.reportConfig || require('../services/reportConfig');
  const userSites = require('../services/userSites');
  const L = require('../services/handoffLifecycle');
  const fail = (res, e) => httpFail(res, e);
  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  const actorOf = (u, h) => ({ id: u.id, isAdmin: isAdmin(u), active: u.active !== 0 && u.active !== false, hasSite: h ? userSites.hasSite(u, h.site_id) : false });
  const log = (req, action, target, details) => { try { rdb().logEvent({ category: 'handoffs', action, target: String(target), details, ...rdb()._logCtx(req) }); } catch (_) {} };
  const cfg = async () => { try { return await reportConfig.getConfig(rdb().db); } catch (_) { return {}; } };

  async function enabled(req, res, next) {
    try { if (String((await cfg()).handoffs_enabled) !== '1') return res.status(404).json({ error: 'handoffs are not enabled' }); next(); } catch (e) { fail(res, e); }
  }
  const visible = (u, h) => !!h && (isAdmin(u) || userSites.hasSite(u, h.site_id) || Number(h.requested_by) === Number(u.id) || Number(h.receiver_id) === Number(u.id));
  async function load(req, res) {
    const h = await store.get(req.params.id);
    if (!visible(req.reportUser, h)) { res.status(404).json({ error: 'handoff not found' }); return null; }
    return h;
  }
  const view = (h, u) => ({ ...h, allowed: L.allowed(h, actorOf(u, h)), can_reassign: !L.checkReassign(h, actorOf(u, h), -1, { reason: 'xxxxx' }) });

  /** The receiver must be a real, active user who has the handoff's site (no hand-off into the void). */
  async function resolveReceiver(ref, siteId) {
    if (ref == null || ref === '') throw typed('VALIDATION', 'receiver is required', 400);
    const users = (await rdb().listUsers()) || [];
    const key = String(ref).trim().toLowerCase();
    const u = users.find((x) => String(x.id) === key || String(x.username || '').toLowerCase() === key || String(x.email || '').toLowerCase() === key);
    if (!u || u.active === 0 || u.active === false) throw typed('VALIDATION', 'the receiver is not an active user', 400);
    const ids = [u.site_id, ...((u.extra_site_ids) || [])].filter((x) => x != null).map(Number);
    if (!rdb().userHasRole(u, 'admin') && !ids.includes(Number(siteId))) throw typed('VALIDATION', 'the receiver does not work on this site', 400);
    return Number(u.id);
  }
  async function checkDepartments(from, to) {
    const names = new Set(((await rdb().listDepartments()) || []).map((d) => String(d.name).trim().toLowerCase()));
    for (const d of [from, to]) if (!names.has(String(d || '').trim().toLowerCase())) throw typed('VALIDATION', `unknown department "${String(d || '').slice(0, 60)}"`, 400);
  }
  async function notify(userId, h, title) {
    if (String((await cfg()).handoff_notify_enabled) !== '1' || !deps.notify) return false;
    try { await deps.notify({ userId, kind: 'handoff', title: `${h.ref} — ${title}`, body: h.title, link: `handoffs.html?id=${h.id}`, sourceKind: 'handoff', sourceRef: String(h.id) }); return true; } catch (_) { return false; }
  }

  router.get('/handoffs.html', (req, res) => deps.sendHtmlPage(res, 'handoffs.html', false, 'Handoffs page unavailable'));

  router.get('/api/handoffs', requireReportSession, enabled, async (req, res) => {
    try {
      const u = req.reportUser;
      const rows = await store.list({ siteIds: isAdmin(u) ? null : userSites.siteIds(u), userId: u.id, status: req.query.status || null });
      res.json({ handoffs: rows, statuses: L.STATUSES, departments: ((await rdb().listDepartments()) || []).map((d) => d.name) });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/handoffs/:id', requireReportSession, enabled, async (req, res) => {
    try { const h = await load(req, res); if (h) res.json({ handoff: view(h, req.reportUser) }); } catch (e) { fail(res, e); }
  });
  router.post('/api/handoffs', requireReportSession, enabled, json, async (req, res) => {
    try {
      const u = req.reportUser, b = req.body || {};
      if (!isAdmin(u)) {
        if (!rdb().userHasRole(u, 'editor')) return res.status(403).json({ error: 'editor role required' });
        if (b.site_id == null || !userSites.hasSite(u, b.site_id)) return res.status(403).json({ error: 'Access denied: another site' });
      }
      await checkDepartments(b.from_department, b.to_department);
      const receiverId = await resolveReceiver(b.receiver, b.site_id);
      if (b.commitment_id != null && b.commitment_id !== '' && deps.commitmentStore) {
        const c = await deps.commitmentStore.getRaw(b.commitment_id);
        if (!c || Number(c.site_id) !== Number(b.site_id)) return res.status(400).json({ error: 'the linked commitment is not on this site' });
      }
      const r = await store.create({ ...b, receiver_id: receiverId }, { user: u });
      if (r.created) { log(req, 'handoff_created', r.handoff.ref, { to_department: r.handoff.to_department }); await notify(receiverId, r.handoff, 'handed to you'); }
      res.status(r.created ? 201 : 200).json({ created: r.created, handoff: view(r.handoff, u) });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/handoffs/:id/transition', requireReportSession, enabled, json, async (req, res) => {
    try {
      const h = await load(req, res); if (!h) return;
      const b = req.body || {};
      const out = await store.transition(h.id, String(b.to || ''), { actor: actorOf(req.reportUser, h), expectedVersion: b.version, reason: b.reason });
      log(req, 'handoff_transition', h.ref, { from: h.status, to: out.status });
      await notify(Number(req.reportUser.id) === out.requested_by ? out.receiver_id : out.requested_by, out, out.status);
      res.json({ handoff: view(out, req.reportUser) });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/handoffs/:id/reassign', requireReportSession, enabled, json, async (req, res) => {
    try {
      const h = await load(req, res); if (!h) return;
      const b = req.body || {};
      const to = await resolveReceiver(b.receiver, h.site_id);
      const out = await store.reassign(h.id, to, { actor: actorOf(req.reportUser, h), expectedVersion: b.version, reason: b.reason });
      log(req, 'handoff_reassigned', h.ref, { from: h.receiver_id, to });
      await notify(to, out, 'handed to you');
      res.json({ handoff: view(out, req.reportUser) });
    } catch (e) { fail(res, e); }
  });
  return router;
};
module.exports.createStore = createStore;
