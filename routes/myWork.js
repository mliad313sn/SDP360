'use strict';
// A-10 — "My work" (the per-person inbox): GET /api/me/work + GET /home.html.
// The user's sites = services/userSites.siteIds(user) (primary + extra sites), the same rule as every
// site check; the admin tier gets ITS OWN sites too (never a fleet-wide dump — a site-less admin gets
// a message pointing to the Site Actions hub). Composition is services/myWork.js (pure); the readers
// below are the same calls as the Site Actions hub / Site obligations / unsigned-PV worklist.
const { fail } = require('../services/httpError');

module.exports = function myWorkRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  const rdb = () => deps.rdb || require('../reports-db');
  const userSites = require('../services/userSites');
  const { buildMyWork, trackerEmptyCells } = require('../services/myWork');

  router.get('/home.html', (req, res) => deps.sendHtmlPage(res, 'home.html', false, 'Home unavailable'));

  router.get('/api/me/work', requireReportSession, async (req, res) => {
    try {
      const R = rdb();
      const meetingsDb = require('../meetings-db');
      const inspectionDb = require('../inspection-db');
      const trackerDb = require('../tracker-db');
      const user = req.reportUser;
      const asOf = new Date().toISOString().slice(0, 10);
      const ids = userSites.siteIds(user);
      const allSites = ids.length ? ((await R.listSites()) || []) : [];
      const codes = ids.length ? ((await R.listSiteModuleCodes('meetings')) || []) : [];
      const sites = [];
      for (const id of ids) {
        const row = allSites.find((s) => Number(s.id) === id);
        if (!row) continue;
        const mc = codes.find((c) => Number(c.site_id) === id);
        sites.push({ site_id: id, code: mc ? mc.code : null, name: row.name, _row: row });
      }

      let trackerD;   // loaded once per request, only if a card asks for it
      const loadTracker = async () => { if (trackerD === undefined) trackerD = await trackerDb.loadTracker(); return trackerD; };
      const pw = R.getPreviousWeek();   // the report period is the PREVIOUS week
      const readers = {
        actions: async (s) => {
          if (!s.code) return null;   // no meetings/inspection code for this site → not measured
          const meetings = await meetingsDb.listActions({ site: s.code });
          const inspection = await inspectionDb.listActions({ site: s.code });
          const report = { actions: (await R.getSiteOpenReportActions(s.site_id)).actions };
          return { meetings, inspection, report };
        },
        weeklyReport: async (s) => {
          if (!s.site_id) return null;   // listReports with a falsy site_id returns EVERY site
          const rows = (await R.listReports(s.site_id, pw.year, pw.week)) || [];
          return { year: pw.year, week: pw.week, week_label: R.getWeekRange(pw.year, pw.week).label, report: rows[0] || null };
        },
        unsignedPvs: async (s) => {
          if (!s.code) return null;
          const items = await meetingsDb.listMeetings({ unsigned: 1, site: s.code, limit: 10 });
          const count = await meetingsDb.countMeetings({ unsigned: 1, site: s.code });
          return { count, items };
        },
        lastInspection: async (s) => {
          if (!s.code) throw new Error('no inspection code');   // → null block (not measured); [] → "never inspected"
          const rows = (await inspectionDb.listInspections({ site: s.code, limit: 50 })) || [];
          return rows.find((x) => x.inspection_date) || null;   // newest dated inspection (a blank date sorts first on PG)
        },
        trackerEmpty: async (s) => {
          const code = trackerDb.siteToCode(s._row);
          if (!code) return null;
          const D = await loadTracker();
          if (Array.isArray(D.activeSites) && D.activeSites.length && !D.activeSites.includes(code)) return null;
          return trackerEmptyCells(D, code, Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)));
        },
        benefitReviews: async (s) => require('../services/governanceStore').makeGovernanceStore(R.pgHandle()).dueBenefitReviews({ siteId: s.site_id, asOf }),
      };
      const work = await buildMyWork({ user, sites, asOf, readers });
      res.json({ ok: true, ...work });
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });
  return router;
};
