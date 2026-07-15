'use strict';
// Binds siteReport's injected deps to the live readers. Kept separate so
// siteReport.js stays pure/testable. Resolves site_code (HGO) ↔ helpdesk
// site name/id via existing alias maps.
function buildSiteReportDeps() {
  const meetingsDb = require('../meetings-db');
  const inspectionDb = require('../inspection-db');
  const reportsDb = require('../reports-db');
  return {
    meetingsSummary: (code, p) => meetingsDb.getSiteMonthlyMeetingSummary(code, p.year, p.month),
    meetingsActions: (code) => meetingsDb.listActions({ site: code, status: 'open' }),
    inspectionAggregate: (code) => inspectionDb.aggregate({ site: code }),
    inspectionActions: (code) => inspectionDb.listActions({ site: code, status: 'open' }),
    helpdesk: (code, p) => reportsDb.getCalendarMonthlyHelpdesk(_siteId(reportsDb, code), p.year, p.month),
    technicians: (code, p) => reportsDb.getSiteTechnicianStats ? reportsDb.getSiteTechnicianStats(code, p.year, p.month) : [],
    siteStatus: (code) => 'operational',   // wired to deriveSiteStatus in sub-project 2
    prevComposite: () => null,             // wired in sub-project 2
  };
}
// site_code → helpdesk site name/id. Foundation: best-effort passthrough; real
// alias resolution + getSiteTechnicianStats land in sub-project 2.
function _siteId(reportsDb, code) { return code; }
module.exports = { buildSiteReportDeps };
