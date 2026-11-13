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
  const { buildMyWork, buildQueueExtra, trackerEmptyCells } = require('../services/myWork');
  const json = express.json({ limit: '8kb' });

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

  // P5 (A3) — readers of the extra queue sources (ui_home_queue = '1'). Each one reads only what the user may already
  // open in its own module; a module switched off has no reader (→ "not measured"). Never a money column.
  function queueExtraReaders({ R, cfg, user, asOf }) {
    const isAdmin = R.userHasRole(user, 'admin'); const isCommittee = isAdmin || R.userHasRole(user, 'committee-member');
    const H = () => R.pgHandle();
    const out = {};
    // access requests the person may decide now — the same rule as GET /api/access/approvals
    out.access = async () => (isAdmin ? require('../services/accessStore').forRdb(R).approvalsFor(user) : []);
    // change requests: assessing and deciding are committee acts (services/ppmWorkbench CR_ACTIONS)
    if (String(cfg.ppm_change_requests_enabled) === '1') out.change_requests = async () => {
      if (!isCommittee) return [];
      return (await H().prepare(`SELECT c.id, c.project_id, c.title, c.status, c.author_id, p.key AS project_key FROM ppm_change_requests c
        JOIN portfolio_projects p ON p.id = c.project_id WHERE p.deleted_at IS NULL AND c.status IN ('proposed','assessed') ORDER BY c.id LIMIT 500`).all())
        .map((c) => ({ ...c, id: Number(c.id), project_id: Number(c.project_id), author_id: c.author_id == null ? null : Number(c.author_id) }));
    };
    // stage gates: moving a project through a gate is a committee act (POST …/project/:id/stage, requireCommittee)
    out.gates = async () => {
      if (!isCommittee) return [];
      return (await H().prepare(`SELECT id, key, name, stage, owner, start_date, end_date FROM portfolio_projects
        WHERE deleted_at IS NULL AND stage IN ('approval','closure') ORDER BY id LIMIT 500`).all()).map((p) => ({ ...p, id: Number(p.id) }));
    };
    // RFIs: always MY scope (mine + my sites), even for the committee — the queue is personal, not the register
    out.rfis = async () => require('../services/governanceStore').makeGovernanceStore(H())
      .listRfi({ status: ['submitted', 'triaged', 'accepted', 'scheduled', 'delivered'], scope: { userId: user.id, siteIds: userSites.siteIds(user) }, limit: 200 });
    // my overdue tasks and milestones (owner = me; the owner reads their own line whatever the project scope)
    out.tasks = async () => {
      const t = await H().prepare(`SELECT 'task' AS kind, t.id, t.project_id, p.key AS project_key, t.name, t.owner, t.end_date AS due, t.status, t.actual_end AS done_at
        FROM portfolio_tasks t JOIN portfolio_projects p ON p.id = t.project_id
        WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL AND COALESCE(p.stage,'') <> 'closed' AND t.owner IS NOT NULL AND t.end_date IS NOT NULL AND t.end_date < ? LIMIT 2000`).all(asOf);
      const m = await H().prepare(`SELECT 'milestone' AS kind, m.id, m.project_id, p.key AS project_key, m.name, m.owner, m.due_date AS due, m.status, m.done_at
        FROM portfolio_milestones m JOIN portfolio_projects p ON p.id = m.project_id
        WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL AND COALESCE(p.stage,'') <> 'closed' AND m.owner IS NOT NULL AND m.due_date IS NOT NULL AND m.due_date < ? LIMIT 2000`).all(asOf);
      return [...t, ...m].map((x) => ({ ...x, id: Number(x.id), project_id: Number(x.project_id) }));
    };
    return out;
  }
  const queueOn = async (R) => { try { return String((await require('../services/reportConfig').getConfig(R.db)).ui_home_queue) === '1'; } catch (_) { return false; } };

  // P5 (A3) — snooze one line of MY queue until a day (≤ 30 days) or clear it. Presentation only: the item, its owner and
  // its status are untouched; the key is free text from the page and only ever hides a line of this user's own Home.
  router.put('/api/me/work/snooze', requireReportSession, json, async (req, res) => {
    try {
      const R = rdb();
      if (!(await queueOn(R))) return fail(res, new Error('Not found'), 404);
      const wp = require('../services/workspaceProfiles');
      const today = new Date().toISOString().slice(0, 10);
      const v = wp.validateSnooze(req.body, today);
      if (v.error) return fail(res, new Error(v.error), 400);
      const snoozed = await wp.setSnooze(req.reportUser.id, v, deps.rdb, today);
      res.json({ ok: true, snoozed });
    } catch (e) { fail(res, e, e.status === 400 ? 400 : undefined); }
  });

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
      // P5 (A3) — the extra queue sources + my snoozed lines, only while ui_home_queue = '1' (absent = today's answer)
      if (String(cfgA.ui_home_queue) === '1') {
        work.queue_extra = await buildQueueExtra({ user, asOf, readers: queueExtraReaders({ R, cfg: cfgA, user, asOf }) });
        try { work.queue_snoozed = await require('../services/workspaceProfiles').getSnoozes(user.id, deps.rdb, asOf); } catch (_) { work.queue_snoozed = {}; }
      }
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
