'use strict';
// C-21 (G47) — shift handover with explicit acceptance (migration 062), behind report_config shift_handover_enabled.
//   GET  /api/shift-handovers?site=              handovers of the caller's sites + those they give / receive (stale flag)   session (own sites; admin tier: all)
//   POST /api/shift-handovers                    { site_id, family, to_user, shift_label?, notes?, items? }  the outgoing person, holding the site
//   POST /api/shift-handovers/:id/accept         the incoming person, or their deputy in scope (site × family) — never the admin tier on their behalf
//   POST /api/shift-handovers/:id/refuse         { reason }  same people; a reason is required
// Every error goes through httpError.fail. Nothing is accepted automatically.
const { fail, typed } = require('../services/httpError');
const userSites = require('../services/userSites');
const S = require('../services/shiftHandover');

module.exports = function shiftHandoverRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  const json = express.json({ limit: '128kb' });
  const rdb = () => deps.rdb || require('../reports-db');
  const reportConfig = deps.reportConfig || require('../services/reportConfig');
  const store = () => deps.store || (deps._store = deps._store || require('../services/shiftHandoverStore').forRdb(rdb()));
  const families = async () => { try { return (await require('../services/dutyStore').forRdb(rdb()).families()).map((f) => f.key); } catch (_) { return ['site-it-support', 'network-oncall']; } };
  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  const cfg = async () => { try { return await reportConfig.getConfig(rdb().db); } catch (_) { return {}; } };
  const log = (req, action, target, details) => { try { Promise.resolve(rdb().logEvent({ category: 'governance', action, target: String(target), details, ...rdb()._logCtx(req) })).catch(() => {}); } catch (_) {} };
  const principals = async (u, ctx) => { try { return deps.rolesStore ? await deps.rolesStore.principalsOf(u.id, undefined, ctx) : []; } catch (_) { return []; } };

  async function enabled(req, res, next) {
    try { if (String((await cfg()).shift_handover_enabled) !== '1') return fail(res, typed('NOT_FOUND', 'shift handover is not enabled')); next(); } catch (e) { fail(res, e); }
  }
  async function actorFor(u, h) {
    return { id: u.id, active: u.active !== 0 && u.active !== false, isAdmin: isAdmin(u), hasSite: userSites.hasSite(u, h.site_id),
      deputyFor: await principals(u, { siteId: h.site_id, family: h.family, register: 'shift_handovers' }), sodDeputyFor: await principals(u, { any: true }) };
  }

  router.get('/api/shift-handovers', requireReportSession, enabled, async (req, res) => {
    try {
      const u = req.reportUser; const c = await cfg();
      let siteIds = isAdmin(u) ? null : userSites.siteIds(u).map(Number);
      if (req.query.site != null && req.query.site !== '') {
        const want = Number(req.query.site);
        if (siteIds && !siteIds.includes(want)) return fail(res, typed('FORBIDDEN', 'this site is not one of yours'));
        siteIds = [want];
      }
      const rows = await store().list({ siteIds, userIds: siteIds == null ? [] : [u.id, ...(await principals(u, { any: true }))] });
      const hours = Number(c.shift_handover_flag_hours) || 8;
      res.json({ ok: true, flag_hours: hours, handovers: S.flag(rows, new Date().toISOString(), hours).map(({ idem_key: _i, ...r }) => r) });
    } catch (e) { fail(res, e); }
  });

  router.post('/api/shift-handovers', requireReportSession, enabled, json, async (req, res) => {
    try {
      const u = req.reportUser; const b = req.body || {};
      const v = S.validateCreate(b, { families: await families(), actorId: u.id }); if (v) return fail(res, typed(v.code === 'VALIDATION' ? 'VALIDATION' : 'FORBIDDEN', v.error));
      if (!isAdmin(u) && !userSites.hasSite(u, b.site_id)) return fail(res, typed('FORBIDDEN', 'you hand over a shift only on one of your sites'));
      const to = ((await rdb().listUsers()) || []).find((x) => Number(x.id) === Number(b.to_user));
      const toSites = to ? [to.site_id, ...(to.extra_site_ids || [])].filter((x) => x != null).map(Number) : [];
      if (!to || to.active === 0 || to.active === false || (!rdb().userHasRole(to, 'admin') && !toSites.includes(Number(b.site_id)))) return fail(res, typed('VALIDATION', 'the incoming person must be an active account working on this site'));
      const h = await store().create(b, { actorId: u.id, idemKey: req.get('Idempotency-Key') || null });
      if (!h.replayed) log(req, 'shift_handover_created', h.id, { site_id: h.site_id, family: h.family, to_user: h.to_user, items: h.items.length });
      res.status(h.replayed ? 200 : 201).json({ ok: true, handover: h });
    } catch (e) { fail(res, e); }
  });

  for (const [verb, status] of [['accept', 'accepted'], ['refuse', 'refused']]) {
    router.post(`/api/shift-handovers/:id/${verb}`, requireReportSession, enabled, json, async (req, res) => {
      try {
        const u = req.reportUser; const h = await store().get(req.params.id);
        if (!h) return fail(res, typed('NOT_FOUND', 'handover not found'));
        const a = await actorFor(u, h); const reason = (req.body || {}).reason;
        // an outsider learns nothing about a handover of another site
        if (!a.isAdmin && !a.hasSite && Number(u.id) !== h.to_user && !a.deputyFor.includes(h.to_user)) return fail(res, typed('NOT_FOUND', 'handover not found'));
        const c = S.checkDecision(h, a, status, { reason });
        if (c) return fail(res, c.status === 409 ? typed('CONFLICT', c.error) : c.status === 400 ? typed('VALIDATION', c.error) : typed('FORBIDDEN', c.error));
        const out = await store().decide(h.id, { status, actorId: u.id, actingFor: S.actingFor(h, a), reason });
        log(req, `shift_handover_${status}`, h.id, { site_id: h.site_id, acting_for: out.acting_for });
        res.json({ ok: true, handover: out });
      } catch (e) { fail(res, e); }
    });
  }
  return router;
};
