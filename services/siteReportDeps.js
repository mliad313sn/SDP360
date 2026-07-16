'use strict';
// Binds siteReport's injected deps to the live readers, translating the real
// reader shapes into the §4 contract via siteReportAdapters. `mods` is
// injectable so this is unit-testable without DBs.
const A = require('./siteReportAdapters');
const { computeSiteScore } = require('./siteScore');
const { rollingWindow, prevDay } = require('./scoreWindow');
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

    // The score's as-of date + its 3-MONTH ROLLING window. The score is measured
    // by its own readers, NOT derived from the monthly meetings/inspection
    // blocks above: the user's thresholds (reviews >= 8, inspections >= 3
    // "quarterly") are calibrated for ~3 months, so scoring them on one month
    // would read RED forever.
    scoreInputs: async (code, p) => {
      const asOf = p.as_of || _asOfFor(p);                    // 'YYYY-MM-DD'
      const w = rollingWindow(asOf, 3);
      const m = await meetingsDb.getSiteScoreInputs(code, w.from, w.to);
      const i = await inspectionDb.getSiteScoreInputs(code, w.from, w.to);
      return { window: w, inputs: { reviews: m.reviews, resolution: m.resolution, overdue: m.overdue, inspections: i.inspections, findings: i.findings, signoff: m.signoff } };
    },

    // The same score recomputed as-of the PREVIOUS window's end, so trend_pts is
    // like-for-like: asOf 2026-07-14 → this window {2026-04-14 … 2026-07-14} →
    // prevAsOf 2026-04-13 → prev window {2026-01-13 … 2026-04-13}. Non-overlapping
    // trailing 3 months. Returns null when the previous window has nothing to score
    // against, so a site's first quarter shows "no trend" rather than a fabricated
    // one (zeroed inputs still score 33 — overdue 0 and findings 0 each earn 2 pts
    // by inversion — which would read as a confident trend against a window that
    // never happened).
    prevScore: async (code, p) => {
      const asOf = p.as_of || _asOfFor(p);
      const prevAsOf = prevDay(rollingWindow(asOf, 3).from);   // NEVER `new Date(from) - 86400e3`
      const w = rollingWindow(prevAsOf, 3);
      const m = await meetingsDb.getSiteScoreInputs(code, w.from, w.to);
      const i = await inspectionDb.getSiteScoreInputs(code, w.from, w.to);
      if (!m.reviews && !m.raised && !i.inspections) return null;   // nothing happened → no trend
      return computeSiteScore(
        { reviews: m.reviews, resolution: m.resolution, overdue: m.overdue, inspections: i.inspections, findings: i.findings, signoff: m.signoff },
        w,
      ).score;
    },
  };
}

// The report's as-of date: the last day of the period's month, or TODAY if that
// month is still running — an MTD send must not score against a future date.
// `now` is injected: an internal new Date() makes the MTD branch untestable.
function _asOfFor(period, now = new Date()) {
  const mm = String(period.month).padStart(2, '0');
  const last = new Date(period.year, period.month, 0).getDate();   // day 0 of next month
  const monthEnd = `${period.year}-${mm}-${String(last).padStart(2, '0')}`;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return today < monthEnd ? today : monthEnd;
}

// {from,to} ISO bounds for a calendar month — inspection-db.aggregate filters
// inspection_date >= from AND <= to.
function _monthBounds(p) {
  const mm = String(p.month).padStart(2, '0');
  const last = new Date(p.year, p.month, 0).getDate();   // day 0 of next month = last day of this one
  return { from: `${p.year}-${mm}-01`, to: `${p.year}-${mm}-${String(last).padStart(2, '0')}` };
}

module.exports = { buildSiteReportDeps, _monthBounds, _asOfFor };
