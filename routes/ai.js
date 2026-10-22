'use strict';
// ---------------------------------------------------------------------------
// AI analysis routes - extracted from server.js (SDP-DASH-2.0 step 5, lot 5.4, 2026-10-22).
// POST /api/ai/analyze (provider switch in services/aiProxy.js) and GET /api/sample/:viewId.
// Handlers unchanged (`app.` became `router.`).
// ---------------------------------------------------------------------------

module.exports = function aiRoutes(deps) {
  const {
    express, axios, IS_DEV, safeError, CONFIG, VIEWS, getValidToken, apiHeaders, csvToRows, aiLimiter,
    requireReportSession, requireRole, AI_PROVIDER, AI_DISABLED, _aiCallLocal, _aiCallAnthropic,
  } = deps;
  const router = express.Router();


  router.post('/api/ai/analyze', requireReportSession, requireRole('report-author'), aiLimiter, express.json({ limit: '64kb' }), async (req, res) => {
    const body = req.body || {};

    // Cloud/LLM analysis switched off (AI_PROVIDER=off, the default). Return a
    // clean 503 so the client falls back to the deterministic "Analyze (Quick)"
    // engine instead of surfacing a scary error.
    if (AI_DISABLED) {
      return res.status(503).json({ error: 'AI analysis is disabled on this server. Use "Analyze (Quick)" for the on-device deterministic engine.' });
    }

    // Validate messages array (provider-agnostic)
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required and must not be empty.' });
    }

    try {
      const data = AI_PROVIDER === 'local'
        ? await _aiCallLocal(body)
        : await _aiCallAnthropic(body);
      res.json(data);
    } catch(err) {
      const status = err.status || err.response?.status || 500;
      const tag    = AI_PROVIDER === 'local' ? 'Local LLM' : 'Anthropic API';
      console.error(`[AI] ${tag} error ${status}:`, err.message);
      res.status(status).json({ error: IS_DEV || err.status ? err.message : 'AI analysis failed. Please try again.' });
    }
  });

  router.get('/api/sample/:viewId', requireReportSession, async (req, res) => {
    // SECURITY: Whitelist viewId against the registered VIEWS map only.
    // Prevents enumeration of any view in the Zoho workspace by guessing numeric IDs.
    const viewId = req.params.viewId;
    const allowedViewIds = new Set(Object.values(VIEWS));
    if (!allowedViewIds.has(viewId)) {
      return res.status(403).json({ error: 'View not permitted.' });
    }
    try {
      const token = await getValidToken();
      const r = await axios.get(`${CONFIG.analyticsApi}/workspaces/${CONFIG.workspaceId}/views/${viewId}/data`,
        { headers: apiHeaders(token), params: { responseFormat: 'json', maxRows: 3 }, timeout: 30000 });
      const raw  = r.data;
      const rows = typeof raw === 'string' ? csvToRows(raw) : (raw?.data?.rows||raw?.data?.data||raw?.data||[]);
      const cols = Array.isArray(rows) && rows.length > 0 ? Object.keys(rows[0]) : [];
      res.json({ totalRows: Array.isArray(rows)?rows.length:0, columns:cols, sample:Array.isArray(rows)?rows.slice(0,5):rows, rawPreview:typeof raw==='string'?raw.substring(0,500):JSON.stringify(raw).substring(0,500) });
    } catch(err) { safeError(err, res); }
  });

  return router;
};
