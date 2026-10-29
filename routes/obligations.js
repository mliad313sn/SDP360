'use strict';
// Committee #39 — GET /api/obligations?site=<site id>  one read-only view of what a site owes:
// commitments (ledger of record) + handoffs + meeting / incubation / inspection actions + report
// follow-ups. Composition in services/obligations.js. Site scope: the admin tier any site; others
// one of their sites (services/userSites). A register switched off is reported as not read (null).
//   GET /obligations.html
const { fail } = require('../services/httpError');

module.exports = function obligationRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  const rdb = () => deps.rdb || require('../reports-db');
  const reportConfig = deps.reportConfig || require('../services/reportConfig');
  const userSites = require('../services/userSites');

  router.get('/obligations.html', (req, res) => deps.sendHtmlPage(res, 'obligations.html', false, 'Obligations page unavailable'));

  router.get('/api/obligations', requireReportSession, async (req, res) => {
    try {
      const u = req.reportUser; const site = Number(req.query.site);
      if (!Number.isInteger(site) || site <= 0) return res.status(400).json({ ok: false, error: 'site must be a site id' });
      if (!rdb().userHasRole(u, 'admin') && !userSites.hasSite(u, site)) return res.status(403).json({ ok: false, error: 'site not in your scope' });
      const cfg = await reportConfig.getConfig(rdb().db);
      const asOf = new Date().toISOString().slice(0, 10);
      const cmt = String(cfg.commitments_enabled) === '1' && deps.getCommitmentStore ? deps.getCommitmentStore() : null;
      const ho = String(cfg.handoffs_enabled) === '1' && deps.getHandoffStore ? deps.getHandoffStore() : null;
      const commitments = cmt ? await cmt.list({ siteIds: [site], limit: 2000 }) : null;
      let handoffs = null;
      if (ho) {
        const names = new Map(((await rdb().listUsers()) || []).map((x) => [Number(x.id), x.full_name || x.username]));
        handoffs = (await ho.list({ siteIds: [site], limit: 2000 })).filter((h) => Number(h.site_id) === site).map((h) => ({ ...h, receiver_name: h.receiver_contact || names.get(Number(h.receiver_id)) || null }));
      }
      // the site's meetings-namespace code drives the three action sources (as the Site Actions hub)
      let siteActions = null;
      const code = ((await rdb().listSiteModuleCodes('meetings')) || []).find((r) => Number(r.site_id) === site);
      try {
        const { buildSiteActions } = require('../services/siteActionsRegister');
        const meetings = code ? await require('../meetings-db').listActions({ site: code.code }) : [];
        const inspection = code ? await require('../inspection-db').listActions({ site: code.code }) : [];
        const report = { actions: (await rdb().getSiteOpenReportActions(site)).actions };
        siteActions = buildSiteActions({ meetings, inspection, report, asOf });
        if (cmt) { const B = require('../services/commitmentBackfill'); B.attachCommitments(siteActions, await cmt.linksFor(B.hubPairs(siteActions))); }
      } catch (_) { siteActions = null; }   // not read — said so, never "nothing owed"
      let sessionActions = null;
      try { sessionActions = await require('../services/governanceStore').makeGovernanceStore(rdb().pgHandle()).openSessionActions({ siteId: site }); } catch (_) { sessionActions = null; }
      res.json({ ok: true, site_id: site, ...require('../services/obligations').compose({ commitments, handoffs, siteActions, sessionActions, asOf }) });
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });
  return router;
};
