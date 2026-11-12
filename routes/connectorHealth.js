'use strict';
// P4 / A2 — Connector Health (read-only page + fix tasks). DI factory like routes/dataQuality.js.
//
//   GET  /connector-health.html                        the page (sendHtmlPage — nonce + ?v=), auth.js gate admin
//   GET  /api/connector-health                         one card per connector (services/connectorHealth)  admin tier
//   GET  /api/connector-health/fix-tasks?status=       admin tier: all · editor: tasks of their own sites only
//   POST /api/connector-health/fix-tasks               {connector, site_id, scope, cause, report_id} — idempotent per
//                                                      connector × site × scope; editor: one of their sites only
//   POST /api/connector-health/fix-tasks/:id/close     {status: done|dismissed, note} — admin tier or the assigned owner
//   POST /api/connector-health/fix-tasks/:id/assign    {user_id} — admin tier
//   GET  /api/value-metrics/connectors                 % connectors ok, coverage per connector, open fix tasks — admin tier
// No route here calls a source system: everything is read from this server (unknown ≠ 0).
const { fail } = require('../services/httpError');
const userSites = require('../services/userSites');

module.exports = function connectorHealthRoutes(deps) {
  const { express, requireReportSession, sendHtmlPage } = deps;
  const router = express.Router();
  const rdb = () => deps.rdb || require('../reports-db');
  const isAdmin = (u) => { try { return !!rdb().userHasRole(u, 'admin'); } catch (_) { return false; } };
  const isEditor = (u) => { try { return !!rdb().userHasRole(u, 'editor'); } catch (_) { return false; } };
  const T = () => require('../services/connectorFixTasks');
  const log = (action, target, details, user) => { try { rdb().logEvent({ category: 'ops', action, target, actor: user && user.username, actor_id: user && user.id, details }); } catch (_) { /* never blocks */ } };
  const compose = async () => {
    const R = require('../services/connectorReadings');
    return require('../services/connectorHealth').compose(await R.gather(rdb(), { getTokenState: deps.getTokenState, sync: deps.sync }));
  };

  router.get('/connector-health.html', (req, res) => sendHtmlPage(res, 'connector-health.html', false, 'Connector health unavailable'));

  router.get('/api/connector-health', requireReportSession, async (req, res) => {
    if (!isAdmin(req.reportUser)) return fail(res, new Error('Admin role required'), 403);
    try { res.json({ ok: true, ...(await compose()) }); } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  router.get('/api/connector-health/fix-tasks', requireReportSession, async (req, res) => {
    try {
      const status = ['open', 'done', 'dismissed', 'all'].includes(String(req.query.status)) ? String(req.query.status) : 'open';
      const siteIds = isAdmin(req.reportUser) ? null : userSites.siteIds(req.reportUser);
      res.json({ ok: true, tasks: await T().list(rdb().pgHandle(), { status, siteIds }) });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  router.post('/api/connector-health/fix-tasks', requireReportSession, async (req, res) => {
    try {
      const u = req.reportUser; const b = req.body || {};
      if (!isAdmin(u)) {
        if (!isEditor(u)) return fail(res, new Error('Editor role required'), 403);
        if (b.site_id == null || !userSites.hasSite(u, b.site_id)) return fail(res, new Error('You can only open a fix task for one of your sites'), 403);
      }
      const owners = require('../services/connectorReadings').readOwners();
      const r = await T().open(rdb().pgHandle(), b, u, owners);
      if (r.created) log('connector_fix_task_opened', r.task.connector, { id: r.task.id, site_id: r.task.site_id, scope: r.task.scope }, u);
      res.status(r.created ? 201 : 200).json({ ok: true, created: r.created, task: r.task });
    } catch (e) { fail(res, e, e.status || 500, { ok: false }); }
  });

  router.post('/api/connector-health/fix-tasks/:id/close', requireReportSession, async (req, res) => {
    try {
      const H = rdb().pgHandle(); const cur = await T().get(H, req.params.id);
      if (!cur) return fail(res, new Error('Task not found'), 404);
      const u = req.reportUser;
      if (!isAdmin(u) && !(cur.owner_user_id != null && Number(cur.owner_user_id) === Number(u.id))) return fail(res, new Error('Only the admin tier or the assigned owner can close this task'), 403);
      const t = await T().close(H, cur.id, req.body || {}, u);
      if (!t) return fail(res, new Error('Task is not open'), 409);
      log('connector_fix_task_closed', t.connector, { id: t.id, status: t.status }, u);
      res.json({ ok: true, task: t });
    } catch (e) { fail(res, e, e.status || 500, { ok: false }); }
  });

  router.post('/api/connector-health/fix-tasks/:id/assign', requireReportSession, async (req, res) => {
    try {
      if (!isAdmin(req.reportUser)) return fail(res, new Error('Admin role required'), 403);
      const uid = req.body && req.body.user_id != null && req.body.user_id !== '' ? Number(req.body.user_id) : null;
      if (uid != null && !Number.isInteger(uid)) return fail(res, new Error('user_id must be an integer'), 400);
      const t = await T().assign(rdb().pgHandle(), req.params.id, uid);
      if (!t) return fail(res, new Error('Task not found'), 404);
      log('connector_fix_task_assigned', t.connector, { id: t.id, owner_user_id: uid }, req.reportUser);
      res.json({ ok: true, task: t });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  router.get('/api/value-metrics/connectors', requireReportSession, async (req, res) => {
    if (!isAdmin(req.reportUser)) return fail(res, new Error('Admin role required'), 403);
    try {
      const h = await compose();
      const measured = h.connectors.filter((c) => c.state !== 'disarmed');
      res.json({ ok: true, checked_at: h.checked_at,
        connectors_ok_pct: measured.length ? Math.round((100 * measured.filter((c) => c.state === 'ok').length) / measured.length) : null,
        connectors: h.connectors.map((c) => ({ id: c.id, state: c.state, coverage_pct: c.coverage.pct, last_success: c.last_success, open_tasks: c.open_tasks })) });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  return router;
};
