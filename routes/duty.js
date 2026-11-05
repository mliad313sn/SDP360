'use strict';
const { fail, typed } = require('../services/httpError');
const userSites = require('../services/userSites');
const C = require('../services/dutyCoverage');
// C-20 (G44 G48 · A06 · R9) — duty rosters (manual + CSV, no HR connector) and the read-only coverage view.
//   GET    /api/duty/coverage?site=&from=YYYY-MM-DD&days=1..31   per site × family × slot: covered|gap|unknown|not_required   session, own sites (admin tier: all)
//   GET    /api/duty/shifts?site=&from=&to=                       live roster shifts                                         session, own sites (admin tier: all)
//   POST   /api/duty/shifts         { site_id, family, user_id, starts_at, ends_at }                                          admin tier holding the site
//   DELETE /api/duty/shifts/:id     soft removal (removed_at)                                                                 admin tier holding the site
//   PUT    /api/duty/policy         { site_id, family, mode, min_people, shift_start, shift_hours, business_* }               admin tier holding the site
//   POST   /api/duty/import[?apply=1] { csv }  dry run by default (rows + per-row errors); apply = idempotent commit,
//                                    refused while any row has an error                                                       admin tier holding every site of the file
// "Holding the site": a super_admin, a central (site-less) admin-tier account, or an admin-tier account that has the
// site among its sites (services/userSites). Every error goes through httpError.fail.
module.exports = function dutyRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  const json = express.json({ limit: '1mb' });
  const rdb = () => deps.rdb || require('../reports-db');
  const store = () => deps.store || (deps._store = deps._store || require('../services/dutyStore').forRdb(rdb()));
  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  const isSuper = (u) => rdb().userHasRole(u, 'super_admin');
  const canEditSite = (u, siteId) => isAdmin(u) && (isSuper(u) || userSites.siteIds(u).length === 0 || userSites.hasSite(u, siteId));
  const log = (req, action, target, details) => { try { Promise.resolve(rdb().logEvent({ category: 'governance', action, target: String(target), details, ...rdb()._logCtx(req) })).catch(() => {}); } catch (_) {} };
  const today = () => new Date().toISOString().slice(0, 10);

  /** Sites the caller may read, narrowed by ?site= (403 when asked for a site outside the scope). */
  async function scopeSites(req) {
    const all = (await rdb().listSites()) || [];
    const mine = isAdmin(req.reportUser) ? all : all.filter((s) => userSites.hasSite(req.reportUser, s.id));
    if (req.query.site == null || req.query.site === '') return mine;
    const want = mine.filter((s) => Number(s.id) === Number(req.query.site));
    if (!want.length) throw typed('FORBIDDEN', 'this site is not one of yours');
    return want;
  }
  const dayParam = (v, dflt) => { const s = String(v || dflt); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s))) throw typed('VALIDATION', 'dates: YYYY-MM-DD'); return s; };

  router.get('/api/duty/coverage', requireReportSession, async (req, res) => {
    try {
      const sites = await scopeSites(req);
      const from = dayParam(req.query.from, today());
      const days = Math.max(1, Math.min(C.MAX_DAYS, parseInt(req.query.days, 10) || 7));
      const to = new Date(Date.parse(from) + (days + 1) * 864e5).toISOString();
      const s = store(); const ids = sites.map((x) => Number(x.id));
      const [families, policies, shifts, extents, account, calendar] = await Promise.all([s.families(), s.policies(), s.shifts(ids, from, to), s.extents(ids), s.accountState(), s.calendar()]);
      const out = C.coverage({ sites: sites.map((x) => ({ id: Number(x.id), name: x.name })), families: families.map((f) => f.key), policies, shifts, extents, account, from, days, calendar });
      res.json({ ok: true, ...out, families, can_edit_sites: ids.filter((id) => canEditSite(req.reportUser, id)) });
    } catch (e) { fail(res, e); }
  });

  router.get('/api/duty/shifts', requireReportSession, async (req, res) => {
    try {
      const sites = await scopeSites(req);
      const from = dayParam(req.query.from, today());
      const to = dayParam(req.query.to, new Date(Date.parse(from) + 7 * 864e5).toISOString().slice(0, 10));
      res.json({ ok: true, shifts: await store().shifts(sites.map((x) => Number(x.id)), from + 'T00:00:00.000Z', to + 'T23:59:59.999Z') });
    } catch (e) { fail(res, e); }
  });

  async function lookups() {
    const s = store();
    const [sites, users, families] = await Promise.all([rdb().listSites(), s.users(), s.families()]);
    return { sites: (sites || []).map((x) => ({ id: Number(x.id), name: x.name })), users: users.map((u) => ({ ...u, id: Number(u.id) })), families: families.map((f) => f.key) };
  }

  router.post('/api/duty/shifts', requireReportSession, json, async (req, res) => {
    try {
      const b = req.body || {};
      if (!canEditSite(req.reportUser, b.site_id)) return fail(res, typed('FORBIDDEN', 'only the admin tier of this site edits its roster'));
      const L = await lookups();
      const v = C.validateShift(b, { siteIds: new Set(L.sites.map((x) => x.id)), families: L.families, userIds: new Set(L.users.map((u) => u.id)) });
      if (v.error) return fail(res, typed('VALIDATION', v.error));
      const id = await store().addShift(v.value, req.reportUser.id);
      if (id == null) return fail(res, typed('CONFLICT', 'this shift is already on the roster'));
      log(req, 'duty_shift_added', id, { site_id: v.value.site_id, family: v.value.family });
      res.status(201).json({ ok: true, id });
    } catch (e) { fail(res, e); }
  });

  router.delete('/api/duty/shifts/:id', requireReportSession, async (req, res) => {
    try {
      const sh = await store().getShift(req.params.id);
      if (!sh || sh.removed_at) return fail(res, typed('NOT_FOUND', 'shift not found'));
      if (!canEditSite(req.reportUser, sh.site_id)) return fail(res, typed('FORBIDDEN', 'only the admin tier of this site edits its roster'));
      await store().removeShift(sh.id, req.reportUser.id);
      log(req, 'duty_shift_removed', sh.id, { site_id: sh.site_id });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  router.put('/api/duty/policy', requireReportSession, json, async (req, res) => {
    try {
      const b = req.body || {};
      if (!canEditSite(req.reportUser, b.site_id)) return fail(res, typed('FORBIDDEN', 'only the admin tier of this site edits its coverage policy'));
      if (!(await rdb().listSites() || []).some((x) => Number(x.id) === Number(b.site_id))) return fail(res, typed('VALIDATION', 'unknown site'));
      const p = await store().setPolicy(b.site_id, String(b.family || ''), b, req.reportUser.id);
      log(req, 'duty_policy_set', `${b.site_id}:${b.family}`, p);
      res.json({ ok: true, policy: p });
    } catch (e) { fail(res, e); }
  });

  router.post('/api/duty/import', requireReportSession, json, async (req, res) => {
    try {
      if (!isAdmin(req.reportUser)) return fail(res, typed('FORBIDDEN', 'only the admin tier imports rosters'));
      const csv = String((req.body || {}).csv || '');
      if (!csv.trim()) return fail(res, typed('VALIDATION', 'csv is required'));
      const parsed = C.parseRosterCsv(csv, await lookups());
      for (const r of parsed.rows) if (!canEditSite(req.reportUser, r.site_id)) parsed.errors.push({ line: r.line, error: 'this site is not one of yours' });
      parsed.errors.sort((a, b) => a.line - b.line);
      const ok = parsed.rows.filter((r) => !parsed.errors.some((e) => e.line === r.line));
      if (String(req.query.apply) !== '1') return res.json({ ok: true, applied: false, rows: ok, errors: parsed.errors });
      if (parsed.errors.length) return fail(res, typed('VALIDATION', `fix the ${parsed.errors.length} row error(s) first (dry run lists them)`));
      const r = await store().importRows(ok, req.reportUser.id);
      log(req, 'duty_roster_imported', 'csv', { rows: ok.length, ...r });
      res.json({ ok: true, applied: true, ...r });
    } catch (e) { fail(res, e); }
  });

  return router;
};
