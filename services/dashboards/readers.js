'use strict';
// The existing readers behind the dashboard widgets that are not dictionary keys (major incidents, pending decisions,
// late actions, IT strategy). Shared by the dashboards (step 6) and the meeting agendas (step 8).
function readers(rdb) {
  return {
    listSites: () => rdb.listSites(),
    getActiveMajorIncidentsForSite: rdb.getActiveMajorIncidentsForSite,
    getPendingCabDecisions: rdb.getPendingCabDecisions,
    meetingsDb: require('../../meetings-db'), inspectionDb: require('../../inspection-db'),
    trackerDb: require('../../tracker-db'), trackerScore: require('../../tracker-pptx'),
  };
}
module.exports = { readers };
