'use strict';
// Binds siteReport's injected deps to the live readers, translating the real
// reader shapes into the §4 contract via siteReportAdapters. `mods` is
// injectable so this is unit-testable without DBs.
const A = require('./siteReportAdapters');
const { computeSiteScore } = require('./siteScore');
const { deriveSiteStatus } = require('./execSummary');

const MODULE_NS = 'meetings';   // the report's site codes come from the meetings/inspection namespace

function buildSiteReportDeps(mods) {
  const m = mods || {
    meetingsDb: require('../meetings-db'),
    inspectionDb: require('../inspection-db'),
    reportsDb: require('../reports-db'),
  };
  const { meetingsDb, inspectionDb, reportsDb } = m;

  // code (HGO) → { site_id, name, zoho_group } | null
  const resolve = async (code) => (await reportsDb.getSiteIdByModuleCode(MODULE_NS, code)) || null;

  const meetingsSummary = async (code, p) =>
    A.adaptMeetingsSummary(await meetingsDb.getSiteMonthlyMeetingSummary(code, p.year, p.month));

  // PERIOD-SCOPED. inspection-db.aggregate({site,from,to}) filters on
  // inspection_date — verified. All-time would pin 30% of the composite to a
  // constant (inspections dim → always 100 once ever inspected; findings dim →
  // 0 once lifetime critical+major >= 5), which is exactly the bug this
  // sub-project exists to kill.
  const inspectionAggregate = async (code, p) =>
    A.adaptInspectionAggregate(await inspectionDb.aggregate({ site: code, ..._monthBounds(p) }));

  return {
    meetingsSummary,
    meetingsActions: async (code) => A.adaptMeetingsActions(await meetingsDb.listActions({ site: code, overdue: 1 })),
    inspectionAggregate,
    inspectionActions: async (code) => A.adaptInspectionActions(await inspectionDb.listActions({ site: code, overdue: 1 })),

    helpdesk: async (code, p) => {
      const s = await resolve(code);
      if (!s) return null;                       // siteReport._safe → zeroed block
      return reportsDb.getSiteHelpdeskMonthly(s.site_id, p.year, p.month);
    },

    technicians: async (code, p) => {
      const s = await resolve(code);
      if (!s) return [];
      return reportsDb.getSiteTechnicianStats(s.site_id, p.year, p.month);
    },

    // Incident-derived (documented in the spec — NOT live uptime).
    // deriveSiteStatus omits healthy sites → absent means 'operational'.
    siteStatus: async (code) => {
      const s = await resolve(code);
      if (!s || !s.zoho_group) return 'operational';
      const groups = String(s.zoho_group).split(',').map(g => g.trim()).filter(Boolean);
      if (!groups.length) return 'operational';
      const mis = (await reportsDb.getActiveMajorIncidentsForSite(groups)) || [];
      const row = { code, name: s.name, has_active_mi: mis.length > 0, open_incidents: mis.length, overdue_open: 0 };
      const out = deriveSiteStatus([row]);
      return out.length ? out[0].status : 'operational';
    },

    // No composite is persisted — recompute the previous month from the same
    // readers, scoped to the PREVIOUS month on both sides.
    // Returns null when the previous month has no meeting data (spec §4.1:
    // trend_pts must be null on a site's first period — otherwise the zeroed
    // kpis still score ~35-65 via the "no issues → resolution_pct 100" rule and
    // the report shows a confident trend against a month that never existed).
    prevComposite: async (code, p) => {
      const prev = _prevMonth(p.year, p.month);
      const raw = await meetingsDb.getSiteMonthlyMeetingSummary(code, prev.year, prev.month);
      // `available` is NOT a usable discriminator here: the reader only sets it
      // false when siteCode is falsy (meetings-db.js:2545/:2654). A real site
      // with zero PVs still returns available:true with zeroed kpis — and those
      // zeros score ~50 (resolution_pct → 100 via the empty-denominator rule +
      // overdue → 100 + findings → 100), i.e. a confident trend against a month
      // that never happened. Gate on ACTUAL ACTIVITY instead. (Distinguishing
      // "first month ever" from "a real but dead month" would need a
      // MIN(meeting_date) lookup — deliberately not bought here: both cases
      // should read "no trend".)
      if (!raw || raw.available === false) return null;
      const rk = raw.kpis || {};
      const noActivity = !rk.pvs_held && !rk.open_issues && !rk.resolved_month && !rk.new_month && !rk.escalations_open;
      if (noActivity) return null;
      const ms = A.adaptMeetingsSummary(raw);
      const insp = await inspectionAggregate(code, prev);
      const k = ms.kpis;
      return computeSiteScore(
        { pvs_held: k.pvs_held, pvs_target: k.pvs_target, resolved: k.resolved, open_issues: k.open_issues,
          overdue_actions_count: k.overdue_actions_count, signoff_pct: k.signoff_pct },
        { inspections_done: insp.inspections_done, findings_critical_major: insp.findings_critical_major },
      ).composite;
    },
  };
}

function _prevMonth(y, mo) { return mo <= 1 ? { year: y - 1, month: 12 } : { year: y, month: mo - 1 }; }

// {from,to} ISO bounds for a calendar month — inspection-db.aggregate filters
// inspection_date >= from AND <= to.
function _monthBounds(p) {
  const mm = String(p.month).padStart(2, '0');
  const last = new Date(p.year, p.month, 0).getDate();   // day 0 of next month = last day of this one
  return { from: `${p.year}-${mm}-01`, to: `${p.year}-${mm}-${String(last).padStart(2, '0')}` };
}

module.exports = { buildSiteReportDeps, _prevMonth, _monthBounds };
