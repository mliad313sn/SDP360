'use strict';
// F1 — inbound read API: expose SDP's unified open actions to Meridian (contract C2).
// Key-guarded on the report_config `meridian_in_key` (header X-API-Key), so setting the
// key from the admin card makes the endpoint live with no restart, and an unset key
// leaves it inert (401). Re-serves the SAME buildSiteActions composition as the Site
// Actions hub (server.js:5233) — no new action logic. PII-safe (owner name only) via
// flattenOpenActions. DI factory like routes/fourmypeople.js: server.js passes { express }.
module.exports = function meridianRoutes(deps) {
  const { express } = deps;
  const router = express.Router();
  const reportConfig = require('../services/reportConfig');
  const { buildSiteActions } = require('../services/siteActionsRegister');
  const { flattenOpenActions } = require('../services/meridianActions');
  const rdb = require('../reports-db');
  const meetingsDb = require('../meetings-db');
  const inspectionDb = require('../inspection-db');

  router.get('/api/actions/open', async (req, res) => {
    try {
      // MUST await: getConfig returns a Promise on postgres (prod). Reading it sync
      // would compare X-API-Key against undefined → 401 in prod while sqlite passes.
      const cfg = await reportConfig.getConfig(rdb.db);
      const key = cfg.meridian_in_key;
      if (!key || req.get('X-API-Key') !== key) return res.status(401).json({ error: 'unauthorized' });

      const code = String(req.query.site || '').trim();
      const asOf = new Date().toISOString().slice(0, 10);
      if (!code || code === 'all') {
        return res.json(flattenOpenActions(code || null, buildSiteActions({ asOf }), asOf));
      }
      // Unknown site → empty actions (never 500) — .site_id, NOT .id (falsy-id pitfall).
      const resolved = await rdb.getSiteIdByModuleCode('meetings', code);
      if (!resolved || !resolved.site_id) return res.json({ site: code, as_of: asOf, actions: [] });

      const meetings = await meetingsDb.listActions({ site: code });
      const inspection = await inspectionDb.listActions({ site: code });
      const report = { actions: (await rdb.getSiteOpenReportActions(resolved.site_id)).actions };
      const sa = buildSiteActions({ meetings, inspection, report, asOf });
      res.json(flattenOpenActions(code, sa, asOf));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
