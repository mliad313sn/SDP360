'use strict';
// E-D07 (audit D-09) — data-quality board, read-only, hidden behind report_config ui_data_quality_page ('0' = today:
// the page and the API answer 404 and the nav entry is absent).
//   GET /data-quality.html     the board (sendHtmlPage — nonce + ?v=)                          session (auth.js gate)
//   GET /api/data-quality      composed signals per source × site (services/dataQuality.js)    admin tier
// Every reader is optional: one that throws makes its cells UNKNOWN, never ok. Nothing is written.
const { fail } = require('../services/httpError');

module.exports = function dataQualityRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  const rdb = () => deps.rdb || require('../reports-db');
  async function enabled() {
    try { return String((await require('../services/reportConfig').getConfig(rdb().db)).ui_data_quality_page) === '1'; } catch (_) { return false; }
  }
  const gate = async (req, res, next) => ((await enabled()) ? next() : fail(res, new Error('Not found'), 404));

  router.get('/data-quality.html', gate, (req, res) => deps.sendHtmlPage(res, 'data-quality.html', false, 'Data quality unavailable'));

  router.get('/api/data-quality', requireReportSession, gate, async (req, res) => {
    try {
      const R = rdb();
      if (!R.userHasRole(req.reportUser, 'admin')) return fail(res, new Error('Admin role required'), 403);
      const { FRESHNESS_HOURS } = require('../services/sync/jobs');
      const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : new Date().toISOString().slice(0, 7);
      const r = { freshness: FRESHNESS_HOURS, month, syncRows: null, drift: null, sites: [], hygieneBySite: null, siteCodeDiff: null, unmappedRiskLabels: null };
      let cfg = {};
      try { cfg = await require('../services/reportConfig').getConfig(R.db); } catch (_) { cfg = {}; }
      try {
        const sync = require('../services/sync'); await sync.ensureReady(); const store = sync.getStore();
        r.syncRows = await store.health();
        if (typeof store.recentOkRuns === 'function') r.drift = await require('../services/sync/drift').driftForJobs(store, Object.keys(FRESHNESS_HOURS), cfg);
      } catch (_) { /* UNKNOWN */ }
      try { r.sites = ((await R.listSites({ includeInactive: false })) || []).map((s) => ({ id: Number(s.id), name: s.name })); } catch (_) { r.sites = []; }
      try { r.hygieneBySite = ((await require('../assets-db').getHygieneSummary({})) || {}).by_site || null; } catch (_) { /* UNKNOWN */ }
      try {
        const hard = { tracker: (n) => require('../tracker-db').hardSiteNameToCode(n), inspection: (n) => require('../inspection-db').hardSiteNameToCode(n), meetings: (n) => require('../inspection-db').hardSiteNameToCode(n) };
        r.siteCodeDiff = await require('../services/siteCodeRegistry').diff(R, hard);
      } catch (_) { /* UNKNOWN */ }
      try { r.unmappedRiskLabels = await require('../risk-register-export').listUnmappedSites(R.db, month); } catch (_) { /* UNKNOWN */ }
      res.json({ ok: true, ...require('../services/dataQuality').compose(r) });
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });
  return router;
};
