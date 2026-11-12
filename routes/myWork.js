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

  // F-PRODUCT-07 — readers of the "Awaiting me" block. A module that is switched off has no reader (→ "not measured").
  function awaitingReaders({ R, cfg, user, sites, asOf, meetingsDb }) {
    const isAdmin = R.userHasRole(user, 'admin'); const isCommittee = isAdmin || R.userHasRole(user, 'committee-member');
    const siteIds = userSites.siteIds(user).map(Number);
    const out = {};
    if (String(cfg.commitments_enabled) === '1') out.commitments = async () => {
      const store = require('./commitments').createStore(R);
      // same scope as GET /api/commitments: own sites + where named (username / e-mail, never the full name)
      const rows = await store.list({ siteIds: isAdmin ? null : siteIds, named: isAdmin ? [] : [user.username, user.email].filter(Boolean), status: 'awaiting_verification' });
      let snap = null, people = null; const GR = require('../services/governanceRoles');
      try { snap = await require('./governanceRoles').createStore(R).snapshot(); } catch (_) { snap = null; }   // no roles table = named reviewers only
      const res = [];
      for (const c of rows) {
        let principals = [], roleReviewer = false;
        if (snap) {
          const ids = GR.principalsOf(snap.deputies, user.id, asOf, { siteId: c.site_id, register: 'commitments' });
          if (ids.length) { people = people || ((await R.listUsers()) || []); principals = people.filter((x) => ids.includes(Number(x.id))).map((x) => ({ id: x.id, username: x.username, email: x.email, full_name: x.full_name })); }
          roleReviewer = GR.holders(snap.assignments, 'commitments.reviewer', c.site_id, asOf).includes(Number(user.id));
        }
        res.push({ commitment: c, actor: { id: user.id, username: user.username, full_name: user.full_name, email: user.email, isAdmin, principals, roleReviewer } });
      }
      return res;
    };
    if (String(cfg.handoffs_enabled) === '1') out.handoffs = async () => require('./handoffs').createStore(R).list({ siteIds: [], userId: user.id, status: 'requested' });
    // benefits: verifying is a committee act today (the plan-write rule); anyone else has nothing to verify
    out.benefits = async () => {
      if (!isCommittee) return [];
      return (await R.pgHandle().prepare(`SELECT b.id, b.project_id, b.measure, b.owner, b.owner_user_id, b.realised_by, b.verified_at, b.review_date, b.evidence_link, p.key AS project_key
        FROM portfolio_benefits b JOIN portfolio_projects p ON p.id = b.project_id JOIN portfolio_objectives o ON o.id = p.objective_id JOIN portfolio_programmes g ON g.id = o.programme_id
        WHERE p.deleted_at IS NULL AND o.deleted_at IS NULL AND g.deleted_at IS NULL AND b.realised_by IS NOT NULL AND b.verified_at IS NULL ORDER BY b.review_date NULLS LAST, b.id LIMIT 500`).all())
        .map((b) => ({ ...b, id: Number(b.id), project_id: Number(b.project_id), realised_by: Number(b.realised_by), owner_user_id: b.owner_user_id == null ? null : Number(b.owner_user_id) }));
    };
    out.decisions = async () => {
      const store = require('../services/governanceStore').makeGovernanceStore(R.pgHandle());
      let rows = await store.listDecisions({ status: require('../services/decisionLifecycle').OPEN_STATUSES, siteIds: isAdmin ? null : siteIds });
      // group decisions follow the session's visibility when meetings.group_decisions_public = false: not listed here for non-committee
      if (!isCommittee && (await require('../services/governancePolicy').forContext({}))['meetings.group_decisions_public'] === false) rows = rows.filter((d) => d.site_id != null);
      return rows;
    };
    out.pvs = async () => {
      if (isAdmin) return meetingsDb.listMeetings({ unsigned: 1, limit: 200 });
      const res = [];
      for (const s of sites) if (s.code) res.push(...((await meetingsDb.listMeetings({ unsigned: 1, site: s.code, limit: 100 })) || []));
      return res;
    };
    return out;
  }

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
      // E-P05 — "My work" lists the benefits this user owns (linked owner) only while benefit_owner_link_enabled = '1'
      if (String((await require('../services/reportConfig').getConfig(R.db)).benefit_owner_link_enabled) === '1') {
        readers.ownedBenefits = async (u) => require('../services/governanceStore').makeGovernanceStore(R.pgHandle()).ownedBenefitReviews({ userId: u && u.id, asOf });
      }
      // F-PRODUCT-07 — "Awaiting me" (validator inbox), only while mywork_awaiting_me_enabled = '1'. Each reader applies
      // the scope of its own module (what the user can already open); services/myWork applies the eligibility rules.
      const cfgA = await require('../services/reportConfig').getConfig(R.db);
      if (String(cfgA.mywork_awaiting_me_enabled) === '1') readers.awaiting = awaitingReaders({ R, cfg: cfgA, user, sites, asOf, meetingsDb });
      const work = await buildMyWork({ user, sites, asOf, readers });
      // E-B07 — the requester's own named feedback with its answer, only while ui_feedback_enabled = '1'
      try {
        const cfg = await require('../services/reportConfig').getConfig(R.db);
        if (String(cfg.ui_feedback_enabled) === '1') {
          work.feedback = await R.pgHandle().prepare(`SELECT id, created_at, kind, page, body, status, response FROM product_feedback
            WHERE user_id = ? AND anonymous = 0 AND (status <> 'new' OR response IS NOT NULL) ORDER BY id DESC LIMIT 10`).all(Number(user.id));
        }
      } catch (_) { /* feedback is optional on this page */ }
      res.json({ ok: true, ...work });
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });
  return router;
};
