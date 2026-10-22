'use strict';
// Step 6 (lot 6.2/6.4) — the LIVE readers behind the metrics dispatch, in one place: used by
// /api/metrics/* (routes/metrics.js) and by the dashboard data resolver (services/dashboards/data.js).
// One `liveDeps()` = one request: the site list and each month's scoreboard are fetched once and reused.

function liveDeps(rdbIn) {
  const r = rdbIn || require('../../reports-db');
  let sitesP = null;
  const boards = new Map();
  const siteRows = () => (sitesP = sitesP || Promise.resolve(r.listSites()));
  return {
    getCalendarMonthlyHelpdesk: r.getCalendarMonthlyHelpdesk,
    getSiteHelpdeskWindow: r.getSiteHelpdeskWindow,
    getSiteChangesWindow: r.getSiteChangesWindow,
    getSurveyKpisDB: r.getSurveyKpisDB,
    getWanSnapshots: r.getWanSnapshots,
    getSiteGroups: async (siteId) => {
      const s = ((await siteRows()) || []).find(x => x.id === siteId);
      return String((s && s.zoho_group) || '').split(',').map(g => g.trim()).filter(Boolean);
    },
    getSiteMonthlyMeetingSummary: require('../../meetings-db').getSiteMonthlyMeetingSummary,
    meetingsInsights: require('../../meetings-db').insights,
    getInspectionAggregate: require('../../inspection-db').aggregate,
    getEffortLeaderboard: require('../../assets-db').getEffortLeaderboard,
    effortForSite: require('../assetEffortForSite').effortForSite,
    // The operational scoreboard of a month ({year, m}), built once per request.
    getScoreboard: (month) => {
      const k = `${month.year}-${month.m}`;
      if (!boards.has(k)) boards.set(k, (async () => {
        const last = new Date(Date.UTC(month.year, month.m, 0)).toISOString().slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);
        const sd = await require('../scoreboardData').loadScoreboardData({ month, asOf: last < today ? last : today, deps: {
          listSiteModuleCodes: r.listSiteModuleCodes,
          getCalendarMonthlyHelpdesk: r.getCalendarMonthlyHelpdesk,
          getMeetingsInsights: (a) => require('../../meetings-db').insights(a),
          getInspectionAggregate: (a) => require('../../inspection-db').aggregate(a),
          getEffortLeaderboard: require('../../assets-db').getEffortLeaderboard,
        } });
        return require('../siteScoreboard').buildSiteScoreboard(sd.perSite, { prev: sd.prev });
      })());
      return boards.get(k);
    },
  };
}

/** Every ACTIVE site with its meetings code when it has one (helpdesk / changes / WAN count every site). */
async function groupSites(rdbIn) {
  const r = rdbIn || require('../../reports-db');
  const sites = await r.listSites(), codes = await r.listSiteModuleCodes('meetings');
  const code = new Map((codes || []).map(c => [c.site_id, c.code]));
  return (sites || []).filter(s => s.active !== 0 && s.active !== false)
    .map(s => ({ site_id: s.id, code: code.get(s.id) || null, name: s.name }));
}

/** Targets of the target-based RAG policies (WAN availability), from the admin config. */
async function targets(rdbIn) {
  try {
    const r = rdbIn || require('../../reports-db');
    const cfg = await require('../reportConfig').getConfig(r.db);
    const t = JSON.parse(cfg.opm_targets || '{}');
    return { wan: Number.isFinite(Number(t.wan)) ? Number(t.wan) : 98 };
  } catch (_) { return { wan: 98 }; }
}

module.exports = { liveDeps, groupSites, targets };
