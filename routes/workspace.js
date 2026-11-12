'use strict';
// R1-PROFILES (REBUILD-SPEC R1 + R2) — workspace profiles and personal preferences.
// Every route answers 404 while report_config workspace_profiles_enabled = '0' (default = today).
//   GET    /workspace-settings.html   the settings page (sendHtmlPage — nonce + ?v=)            session (auth.js gate)
//   GET    /api/workspace/me          resolved profile + destinations + my prefs + my sites    session
//   PUT    /api/workspace/prefs       save my prefs { profile, card_order, cards_hidden, density, default_site_id }
//   DELETE /api/workspace/prefs       back to the role defaults
// PRESENTATION ONLY: the user id is the SESSION's (never the body's); a profile the roles do not allow is
// refused (400) on save and ignored on read; destinations are filtered through the real roles; no route
// here changes a role, a site assignment or any other route's gate.
const { fail } = require('../services/httpError');

module.exports = function workspaceRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  const rdb = () => deps.rdb || require('../reports-db');
  const wp = () => require('../services/workspaceProfiles');

  async function enabled() {
    try { return String((await require('../services/reportConfig').getConfig(rdb().db)).workspace_profiles_enabled) === '1'; }
    catch (_) { return false; }
  }
  const gate = async (req, res, next) => ((await enabled()) ? next() : fail(res, new Error('Not found'), 404));

  const ctxOf = (user) => ({ roles: Array.isArray(user && user.roles) ? user.roles : [], has: (r) => { try { return rdb().userHasRole(user, r); } catch (_) { return false; } } });

  // Sites this person may pick as their default: their own sites; the admin tier may pick any active site.
  async function sitesFor(user) {
    let all = [];
    try { all = ((await rdb().listSites({ includeInactive: false })) || []).map((s) => ({ id: Number(s.id), name: s.name })); } catch (_) { all = []; }
    if (rdb().userHasRole(user, 'admin')) return all;
    const mine = require('../services/userSites').siteIds(user);
    return all.filter((s) => mine.includes(s.id));
  }

  router.get('/workspace-settings.html', gate, (req, res) => deps.sendHtmlPage(res, 'workspace-settings.html', false, 'Workspace settings unavailable'));

  router.get('/api/workspace/me', requireReportSession, gate, async (req, res) => {
    try {
      const user = req.reportUser;
      const prefs = await wp().getPrefs(user.id, deps.rdb);
      const sites = await sitesFor(user);
      const out = wp().resolve(ctxOf(user), prefs, req.query.lang === 'fr' ? 'fr' : 'en');
      // a stored default site the person no longer holds is not shown (and never widens anything)
      if (out.default_site_id != null && !sites.some((s) => s.id === out.default_site_id)) out.default_site_id = null;
      const labels = {};
      for (const p of wp().PROFILES) labels[p.id] = req.query.lang === 'fr' ? p.fr : p.en;
      res.json(Object.assign(out, { prefs, sites, profile_labels: labels, densities: wp().DENSITIES }));
    } catch (e) { fail(res, e); }
  });

  router.put('/api/workspace/prefs', requireReportSession, gate, async (req, res) => {
    try {
      const user = req.reportUser;
      const v = wp().validatePrefs(req.body, ctxOf(user));
      if (v.error) return fail(res, new Error(v.error), 400);
      if (v.prefs.default_site_id != null) {
        const sites = await sitesFor(user);
        if (!sites.some((s) => s.id === v.prefs.default_site_id)) return fail(res, new Error('default_site_id is not one of your sites'), 400);
      }
      const at = await wp().savePrefs(user.id, v.prefs, deps.rdb);
      try { rdb().logEvent({ category: 'workspace', action: 'workspace_prefs_saved', target: String(user.id), details: { profile: v.prefs.profile, density: v.prefs.density }, ...rdb()._logCtx(req) }); } catch (_) { /* best-effort */ }
      res.json({ ok: true, updated_at: at });
    } catch (e) { fail(res, e); }
  });

  router.delete('/api/workspace/prefs', requireReportSession, gate, async (req, res) => {
    try {
      await wp().deletePrefs(req.reportUser.id, deps.rdb);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  return router;
};
