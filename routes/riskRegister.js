'use strict';
const { fail } = require('../services/httpError');
// ─────────────────────────────────────────────────────────────────────────
// Risk Register routes (/api/risk-register-export, /api/risk-register-config/*) — extracted from server.js (fiche M12-a, 2026-10-20), same
// dependency-injection pattern as routes/inspection.js. Handlers are byte-for-byte
// the inline ones; only `app.` → `router.` and `require('./x')` → `require('../x')`.
//
// Wiring in server.js:
//   app.use(require('./routes/riskRegister')({ express, requireReportSession, getRdb: () => rdb }));
//   // getRdb: rdb is a `let` assigned later in server.js — the handlers read it per request.
// ─────────────────────────────────────────────────────────────────────────
module.exports = function riskRegisterRoutes(deps) {
  const { express, requireReportSession, getRdb } = deps;
  const router = express.Router();

// ──────────────────────────────────────────────────────────────────────
// GET /api/risk-register-export?month=YYYY-MM
// ──────────────────────────────────────────────────────────────────────
// Exports the Risk Register's monthly Occurrence sheet as an .xlsx file
// (one row per Site × Domain, count of Incident tickets that matched
// each domain's category/sub-category rules).
//
// PURELY ADDITIVE per Risk_Register_Export_Spec.md §"Non-Regression
// Constraint": this route is read-only, queries only the existing
// request_records SQLite table populated by the hourly Zoho sync,
// and is independent of every other endpoint. No state is mutated.
//
// All business logic (classifier rules, site list, Excel styling)
// lives in risk-register-export.js — the only thing this handler
// does is parse the month query, run the export, and stream bytes.
router.get('/api/risk-register-export', requireReportSession, async (req, res) => {
  const month = (req.query.month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM (e.g. 2026-05).' });
  }
  try {
    const { buildRiskRegisterExport } = require('../risk-register-export');
    const { buffer, diagnostics } = await buildRiskRegisterExport(getRdb().db, month);

    res.setHeader('Content-Type',        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="RiskRegister_Occurrence_${month}.xlsx"`);
    // Surface the row/skip counts in a debug header so the operator can
    // verify the export reflects what they expect without opening the file.
    res.setHeader('X-Risk-Register-Diag', JSON.stringify(diagnostics));
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[risk-register-export] error:', err.message);
    fail(res, err);
  }
});

// ──────────────────────────────────────────────────────────────────────
// Risk Register admin config — SDP site → register code mapping
// ──────────────────────────────────────────────────────────────────────
// Editable list of aliases so super_admins can add new mappings (new
// mines, label renames) without a code deploy. GET is open to any
// authenticated user (so the export-author roles can sanity-check the
// list before generating a report). All mutations require super_admin.
//
// Routes:
//   GET    /api/risk-register-config/aliases              list
//   POST   /api/risk-register-config/aliases              upsert one
//   DELETE /api/risk-register-config/aliases/:sdp_label   remove
//   GET    /api/risk-register-config/unmapped?month=...   diagnostics
//   GET    /api/risk-register-config/sites                canonical codes
const rrConfigJsonBody = express.json({ limit: '64kb' });

router.get('/api/risk-register-config/aliases', requireReportSession, async (req, res) => {
  try {
    const rr = require('../risk-register-export');
    res.json({ aliases: await rr.listAliases(getRdb().db) });
  } catch (err) {
    console.error('[rr-config] list error:', err.message);
    fail(res, err);
  }
});

router.get('/api/risk-register-config/sites', requireReportSession, (req, res) => {
  // No DB hit — pure constant from the module.
  const rr = require('../risk-register-export');
  res.json({ sites: rr.SITES });
});

router.post('/api/risk-register-config/aliases',
  requireReportSession,
  (req, res, next) => {
    if (!getRdb().userHasRole(req.reportUser, 'super_admin')) {
      return res.status(403).json({ error: 'super_admin only' });
    }
    next();
  },
  rrConfigJsonBody,
  async (req, res) => {
    try {
      const rr = require('../risk-register-export');
      const { sdp_label, code } = req.body || {};
      const updatedBy = req.reportUser?.username || req.reportUser?.full_name || 'unknown';
      const saved = await rr.upsertAlias(getRdb().db, sdp_label, code, updatedBy);
      console.log(`[rr-config] upsert ${saved.sdp_label} → ${saved.code} by ${updatedBy}`);
      res.json({ saved });
    } catch (err) {
      console.error('[rr-config] upsert error:', err.message);
      fail(res, err, 400);
    }
  });

router.delete('/api/risk-register-config/aliases/:sdp_label',
  requireReportSession,
  (req, res, next) => {
    if (!getRdb().userHasRole(req.reportUser, 'super_admin')) {
      return res.status(403).json({ error: 'super_admin only' });
    }
    next();
  },
  async (req, res) => {
    try {
      const rr = require('../risk-register-export');
      const label = decodeURIComponent(req.params.sdp_label || '');
      const r = await rr.deleteAlias(getRdb().db, label);
      const who = req.reportUser?.username || req.reportUser?.full_name || 'unknown';
      console.log(`[rr-config] delete "${label}" by ${who} — rows=${r.deleted}`);
      res.json(r);
    } catch (err) {
      console.error('[rr-config] delete error:', err.message);
      fail(res, err);
    }
  });

router.get('/api/risk-register-config/unmapped', requireReportSession, async (req, res) => {
  try {
    const rr = require('../risk-register-export');
    const month = (req.query.month || '').trim();
    res.json({ month, unmapped: await rr.listUnmappedSites(getRdb().db, month) });
  } catch (err) {
    console.error('[rr-config] unmapped error:', err.message);
    fail(res, err, 400);
  }
});


  return router;
};
