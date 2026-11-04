'use strict';
const { fail } = require('../services/httpError');
// A-24 — GET /api/reports/:id/integrity: SHA-256 of the figures recorded at the last submission vs
// the figures as they stand now ({submitted_hash, current_hash, drift, submitted_by, submitted_at},
// plus the PROPOSED D-3 switches the editor page needs). Read access = the central report read
// guard in server.js (registered before this router), so a site editor only reads their own site.
// Integrity evidence only — never an approval or a signature.
module.exports = function reportIntegrityRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  router.get('/api/reports/:id/integrity', requireReportSession, async (req, res) => {
    try {
      const rdb = require('../reports-db');
      const id = parseInt(req.params.id, 10);
      const report = Number.isInteger(id) ? await rdb.getReport(id) : null;
      if (!report) return res.status(404).json({ error: 'Report not found' });
      res.json(await require('../services/reportSubmissionPolicy').integrity(rdb, report));
    } catch (e) { fail(res, e); }
  });
  return router;
};
