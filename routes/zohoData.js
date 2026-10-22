'use strict';
// ---------------------------------------------------------------------------
// Zoho / DB data routes - extracted from server.js (SDP-DASH-2.0 step 5, lot 5.4, 2026-10-22).
// /api/change, /api/cab, /api/metrics/*, /api/requests, debug + cache routes, the MI UDF refresh,
// the Risk Register export + config, the Analytics passthrough views and the DB-first /api/data/*.
// Handlers unchanged (`app.` became `router.`). The raw request cache stays in server.js; its
// "refreshing" flag is a reassigned `let`, so it is read through getRawCacheRefreshing().
// ---------------------------------------------------------------------------
// reports-db is required here: server.js declares its `let rdb` further down than this mount.
const rdb = require('../reports-db');

module.exports = function zohoDataRoutes(deps) {
  const {
    express, axios, CONFIG, VIEWS, tokenState, getValidToken, apiHeaders, fetchView, getCached, setCache,
    rowCache: _rowCache, rawCache: _rawCache, getRawCacheRefreshing, getRawRequestRows,
    requireReportSession, requireAdmin,
  } = deps;
  const router = express.Router();

  // ── CHANGE / CAB DATA ENDPOINTS ──────────────────────────────────

  const { buildDataFreshness } = require('../services/dataFreshness');   // shared by routes/survey.js + routes/zohoData.js

  /**
   * GET /api/change
   * Query params: status, site_id, since (ISO date), limit (default 200), offset
   * Response includes source transparency: source, as_of, data_freshness, stale_warning
   */
  router.get('/api/change', requireReportSession, async (req, res) => {
    try {
      const { getChangeRecords, getSyncStatus } = require('../reports-db');
      const { status, site_id, since, limit = 200, offset = 0 } = req.query;
      const records  = await getChangeRecords({ status, site_id, since, limit: +limit, offset: +offset });
      const syncMeta = (await getSyncStatus()).find(j => j.job_name === 'change_cab') || {};
      res.json({
        ok: true,
        count: records.length,
        ...buildDataFreshness(syncMeta),
        data: records,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/cab
   * Query params: change_id, status, limit (default 500)
   * Response includes source transparency: source, as_of, data_freshness, stale_warning
   */
  router.get('/api/cab', requireReportSession, async (req, res) => {
    try {
      const { getCABApprovals, getSyncStatus } = require('../reports-db');
      const { change_id, status, limit = 500 } = req.query;
      const records  = await getCABApprovals({ change_id, status, limit: +limit });
      const syncMeta = (await getSyncStatus()).find(j => j.job_name === 'change_cab') || {};
      res.json({
        ok: true,
        count: records.length,
        ...buildDataFreshness(syncMeta),
        data: records,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // COMPUTED METRICS — local SQLite, replicate Zoho Analytics aggregates
  // ═══════════════════════════════════════════════════════════════════

  /**
   * GET /api/metrics/change
   * Change KPIs computed from change_records (no Zoho API call).
   * Replicates: Completed_Change_Count, All_Introduced_Change_Finalized_Count,
   *             Change Success Rate %, In Progress count, Emergency count,
   *             Avg completion days, breakdowns by status/risk/type/site.
   *
   * Query params:
   *   site_id  — filter to a single site (optional)
   *   since    — ISO date string — only changes created on/after this date (optional)
   */
  router.get('/api/metrics/change', requireReportSession, async (req, res) => {
    try {
      const { getChangeMetrics, getSyncStatus } = require('../reports-db');
      const { site_id, since } = req.query;
      const metrics  = await getChangeMetrics({ site_id, since });
      const syncMeta = (await getSyncStatus()).find(j => j.job_name === 'change_cab') || {};
      res.json({ ok: true, ...buildDataFreshness(syncMeta), data: metrics });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/metrics/cab
   * CAB Compliance KPIs computed from cab_approvals (no Zoho API call).
   * Replicates: CAB Compliance (Major) % = distinct approved change_ids / total distinct change_ids * 100
   *             Avg turnaround minutes, breakdowns by status/rule_type/stage.
   *
   * Query params:
   *   since    — ISO date string — only approvals requested on/after this date (optional)
   */
  router.get('/api/metrics/cab', requireReportSession, async (req, res) => {
    try {
      const { getCABMetrics, getSyncStatus } = require('../reports-db');
      const { since } = req.query;
      const metrics  = await getCABMetrics({ since });
      const syncMeta = (await getSyncStatus()).find(j => j.job_name === 'change_cab') || {};
      res.json({ ok: true, ...buildDataFreshness(syncMeta), data: metrics });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/metrics/survey
   * Survey / CSAT KPIs computed from survey_results (no Zoho API call).
   * Includes: avg score, response rate %, CSAT buckets (<60/60-80/≥80),
   *           monthly trend (last 12 months) — all from local SQLite.
   *
   * Query params:
   *   since    — ISO date string — only surveys sent on/after this date (optional)
   */
  router.get('/api/metrics/survey', requireReportSession, async (req, res) => {
    try {
      const { getSurveyMetrics, getSyncStatus } = require('../reports-db');
      const { since } = req.query;
      const metrics   = await getSurveyMetrics({ since });
      const syncMeta  = (await getSyncStatus()).find(j => j.job_name === 'survey') || {};
      const freshness = buildDataFreshness(syncMeta);
      if (freshness.stale_warning) {
        freshness.stale_warning = freshness.stale_warning.replace('change_cab', 'survey');
      }
      res.json({ ok: true, ...freshness, data: metrics });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/metrics/requests
   * Request/Helpdesk KPIs computed from request_records (no Zoho API call).
   * Replicates all Zoho Analytics aggregate formulas for the Request table:
   * Open/Closed/Backlog counts, SLA ok/violated %, reopen %, resolved same week,
   * service request vs incident split, escalations, first response SLA %, avg resolution hrs.
   *
   * Query params:
   *   site   — filter by site name (optional)
   *   since  — ISO date string — only requests created on/after this date (optional)
   */
  router.get('/api/metrics/requests', requireReportSession, async (req, res) => {
    try {
      const { getRequestMetrics, getSyncStatus } = require('../reports-db');
      const { site, since, status, rtype, impact, mode } = req.query;
      // Multi-value filters arrive as comma-separated lists (2026-06-11,
      // analytics.html Status/Type/Impact/Mode widgets). Absent = no filter.
      const csv = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : undefined);
      const metrics  = await getRequestMetrics({
        site, since,
        statuses: csv(status),
        rtypes:   csv(rtype),
        impacts:  csv(impact),
        modes:    csv(mode),
      });
      const syncMeta = (await getSyncStatus()).find(j => j.job_name === 'requests') || {};
      const freshness = buildDataFreshness(syncMeta);
      res.json({ ok: true, ...freshness, data: metrics });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  /**
   * GET /api/metrics/request-filter-options
   * Distinct values for the analytics multi-select filters
   * (Request Status / Request Type / Impact / Mode). 2026-06-11.
   */
  router.get('/api/metrics/request-filter-options', requireReportSession, async (req, res) => {
    try {
      const { getRequestFilterOptions } = require('../reports-db');
      res.json({ ok: true, data: await getRequestFilterOptions() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  /**
   * GET /api/requests
   * Returns paginated raw request records from local SQLite.
   *
   * Query params:
   *   limit         — max rows (default 200)
   *   offset        — pagination offset (default 0)
   *   status        — filter by request_status text (optional)
   *   site          — filter by site name (optional)
   *   since         — ISO date — only requests created on/after (optional)
   *   pending_only  — '1' to return only open requests
   *   overdue_only  — '1' to return only SLA-violated requests
   */
  router.get('/api/requests', requireReportSession, async (req, res) => {
    try {
      const { getRequestRecords, getSyncStatus } = require('../reports-db');
      const { limit = '200', offset = '0', status, site, since, pending_only, overdue_only } = req.query;
      const rows     = await getRequestRecords({
        limit:        Math.min(parseInt(limit, 10) || 200, 1000),
        offset:       parseInt(offset, 10) || 0,
        status, site, since,
        pending_only: pending_only === '1',
        overdue_only: overdue_only === '1',
      });
      const syncMeta = (await getSyncStatus()).find(j => j.job_name === 'requests') || {};
      res.json({
        ok: true,
        count: rows.length,
        ...buildDataFreshness(syncMeta),
        data: rows,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/api/orgs', async (req, res) => {
    try {
      const token = await getValidToken();
      const r = await axios.get(`${CONFIG.analyticsApi}/orgs`, { headers: { 'Authorization': `Zoho-oauthtoken ${token}` }, timeout: 10000 });
      res.json({ success: true, data: r.data });
    } catch(err) { res.status(500).json({ error: err.message, details: err.response?.data }); }
  });

  // Raw diagnostic: shows full response headers + body for any scope error
  router.get('/api/debug/raw-test', requireReportSession, async (req, res) => {
    try {
      const token = await getValidToken();
      let result;
      try {
        const r = await axios.get(`${CONFIG.analyticsApi}/orgs`, {
          headers: { 'Authorization': `Zoho-oauthtoken ${token}` },
          timeout: 15000,
          validateStatus: () => true  // don't throw on 4xx/5xx — capture full response
        });
        result = { status: r.status, headers: r.headers, body: r.data };
      } catch(e) {
        result = { networkError: e.message };
      }
      res.json({
        grantedScope: tokenState.grantedScope,
        orgId: CONFIG.orgId,
        workspaceId: CONFIG.workspaceId,
        apiBase: CONFIG.analyticsApi,
        apiResponse: result,
      });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/workspaces', async (req, res) => {
    try {
      const token = await getValidToken();
      const r = await axios.get(`${CONFIG.analyticsApi}/workspaces`, { headers: apiHeaders(token), timeout: 10000 });
      res.json({ success: true, data: r.data });
    } catch(err) { res.status(500).json({ error: err.message, details: err.response?.data }); }
  });

  router.get('/api/views', requireReportSession, async (req, res) => {
    try {
      const token = await getValidToken();
      const r = await axios.get(`${CONFIG.analyticsApi}/workspaces/${CONFIG.workspaceId}/views`, { headers: apiHeaders(token), timeout: 10000 });
      res.json({ success: true, data: r.data });
    } catch(err) { res.status(500).json({ error: err.message, details: err.response?.data }); }
  });

  router.post('/api/cache/clear', requireReportSession, requireAdmin, (req, res) => {
    _rowCache.clear();
    _rawCache.data = null; _rawCache.ts = 0;   // also flush raw-requests cache
    res.json({ ok: true });
  });

  /**
   * POST /api/admin/refresh-major-incident-udfs
   *
   * Standalone, on-demand version of the MAJOR_INCIDENTS UDF backfill that
   * runs as the last step of syncRequestData. Use this when you want to
   * populate Root Cause / Corrective Action / Lessons Learned / PIR Required
   * for major incidents WITHOUT waiting for the next 4-hour request sync, or
   * when you want a detailed diagnostic of why UDFs aren't appearing on the
   * Incident Register.
   *
   * Returns:
   *   {
   *     ok: true,
   *     rowsFetched:       <int>   // how many rows the MAJOR_INCIDENTS view returned
   *     columnsReturned:   <array> // first row's column names (so we can see if UDF: cols are present)
   *     udfsExtracted:     <int>   // rows with at least one non-null UDF field
   *     dbUpdated:         <int>   // rows where the UPDATE matched a request_records row
   *     dbUnmatched:       <int>   // request_ids from view that don't exist in request_records
   *     sampleUdf:         <obj>   // first non-empty UDF blob (parsed)
   *     sampleUnmatchedIds: <array> // first 5 unmatched request_ids (for debugging)
   *   }
   */
  router.post('/api/admin/refresh-major-incident-udfs', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const result = await fetchView(VIEWS.MAJOR_INCIDENTS, 2000);
      const rows = (result && Array.isArray(result.rows)) ? result.rows : [];

      if (rows.length === 0) {
        return res.json({ ok: true, rowsFetched: 0, columnsReturned: [], udfsExtracted: 0, dbUpdated: 0, dbUnmatched: 0,
                          message: 'MAJOR_INCIDENTS view returned 0 rows — nothing to backfill.' });
      }

      const columnsReturned = Object.keys(rows[0]);
      // Re-implement the same extraction logic the sync uses, so this endpoint
      // and the auto-run path stay consistent. We can't `require('../zoho-sync')`
      // for extractUdf because it's not exported — the logic is small enough
      // to repeat here.
      const UDF_PREFIXES_LOCAL = [
        'Communication', 'Date of Lab Test', 'Division', 'Estimated Cost',
        'If Unsuccessful Why', 'Lab Test Owner', 'Lab Test Successful',
        'LAB TESTING', 'Sub Division', 'Why End to End Function',
        'Change Implementation', 'Review decision',
      ];
      const extract = (row) => {
        const u = {};
        for (const k of Object.keys(row)) {
          if (k.startsWith('UDF:') || UDF_PREFIXES_LOCAL.some(p => k.startsWith(p))) {
            u[k] = row[k] || null;
          }
        }
        return Object.keys(u).length > 0 ? u : null;
      };

      let udfsExtracted = 0;
      let sampleUdf = null;
      const udfRows = [];
      for (const r of rows) {
        const rid = String(r['Request ID'] || r['RequestID'] || '').trim();
        if (!rid) continue;
        const u = extract(r);
        if (!u) continue;
        udfsExtracted++;
        if (!sampleUdf) sampleUdf = u;
        udfRows.push({ request_id: rid, udf_json: JSON.stringify(u) });
      }

      // Apply via the exported batch helper (same UPDATE statement the sync uses)
      const dbUpdated = (rdb && typeof rdb.upsertRequestUdfBatch === 'function')
                         ? await rdb.upsertRequestUdfBatch(udfRows)
                         : 0;
      const dbUnmatched = udfRows.length - dbUpdated;

      // Show first 5 unmatched IDs so we can spot a request_id format mismatch
      const sampleUnmatchedIds = [];
      if (dbUnmatched > 0 && rdb && typeof rdb.getRequestRecords === 'function') {
        // Cheap way: query each id individually until we have 5 unmatched samples
        for (const r of udfRows) {
          if (sampleUnmatchedIds.length >= 5) break;
          if (!await rdb.requestRecordExists(r.request_id)) sampleUnmatchedIds.push(r.request_id);  // sweep adds await
        }
      }

      res.json({
        ok: true,
        rowsFetched:       rows.length,
        columnsReturned,
        udfsExtracted,
        dbUpdated,
        dbUnmatched,
        sampleUdf,
        sampleUnmatchedIds,
        hint: dbUpdated > 0
                ? 'OK — Incident Register should now show 🟡/🟢 for tickets with non-empty UDFs. Reload the page.'
                : udfsExtracted === 0
                  ? 'No UDF columns found in MAJOR_INCIDENTS view rows. Check columnsReturned — UDFs need either "UDF:" prefix or a prefix from the change-table list.'
                  : 'UDFs found but no DB rows matched — likely a request_id format mismatch. See sampleUnmatchedIds.',
      });
    } catch (err) {
      // Surface the Zoho response body in the JSON response so the diagnostic
      // modal can show the root cause without forcing the user to dig through
      // pm2 logs. The same body is logged by fetchView under [fetchView] —
      // we just re-echo it here for self-service diagnostics.
      let zohoBody = '';
      let zohoStatus = '';
      if (err.response) {
        zohoStatus = err.response.status;
        try {
          zohoBody = typeof err.response.data === 'string'
            ? err.response.data.slice(0, 1000)
            : JSON.stringify(err.response.data).slice(0, 1000);
        } catch (_) { zohoBody = '(unparseable body)'; }
      }
      console.error('[admin/refresh-major-incident-udfs] failed:', err.message, zohoStatus ? `(HTTP ${zohoStatus})` : '');
      if (zohoBody) console.error('[admin/refresh-major-incident-udfs] Zoho body:', zohoBody);
      res.status(500).json({
        ok: false,
        error: err.message,
        zohoStatus: zohoStatus || null,
        zohoBody:   zohoBody   || null,
        hint: zohoStatus === 400
          ? 'Zoho returned 400 — see zohoBody for errorCode/errorMessage. Common causes: 7103 (view deleted/moved), 8504 (rate limit), 7301 (OAuth scope revoked).'
          : zohoStatus === 401
            ? 'Zoho returned 401 — access token rejected. Refresh-token may be expired; check .env ZOHO_REFRESH_TOKEN.'
            : null,
      });
    }
  });

  // GET /api/cache/status — returns raw cache freshness for the "Data as of" indicator
  router.get('/api/cache/status', requireReportSession, (req, res) => {
    let changeCount = 0;
    try { changeCount = db.prepare('SELECT COUNT(*) as n FROM change_records').get().n; } catch(e) {}
    res.json({
      ts:        _rawCache.ts || 0,                           // epoch ms of last successful raw sync
      rows:      _rawCache.data ? _rawCache.data.rows.length : 0,
      changes:   changeCount,                                 // SQLite change_records count
      refreshing: getRawCacheRefreshing() || false,
      ageMs:     _rawCache.ts ? Date.now() - _rawCache.ts : null,
    });
  });

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
  router.get('/api/risk-register-export', async (req, res) => {
    const month = (req.query.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM (e.g. 2026-05).' });
    }
    try {
      const { buildRiskRegisterExport } = require('../risk-register-export');
      const { buffer, diagnostics } = await buildRiskRegisterExport(rdb.db, month);

      res.setHeader('Content-Type',        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="RiskRegister_Occurrence_${month}.xlsx"`);
      // Surface the row/skip counts in a debug header so the operator can
      // verify the export reflects what they expect without opening the file.
      res.setHeader('X-Risk-Register-Diag', JSON.stringify(diagnostics));
      res.send(Buffer.from(buffer));
    } catch (err) {
      console.error('[risk-register-export] error:', err.message);
      res.status(500).json({ error: err.message });
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
      res.json({ aliases: await rr.listAliases(rdb.db) });
    } catch (err) {
      console.error('[rr-config] list error:', err.message);
      res.status(500).json({ error: err.message });
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
      if (!rdb.userHasRole(req.reportUser, 'super_admin')) {
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
        const saved = await rr.upsertAlias(rdb.db, sdp_label, code, updatedBy);
        console.log(`[rr-config] upsert ${saved.sdp_label} → ${saved.code} by ${updatedBy}`);
        res.json({ saved });
      } catch (err) {
        console.error('[rr-config] upsert error:', err.message);
        res.status(400).json({ error: err.message });
      }
    });

  router.delete('/api/risk-register-config/aliases/:sdp_label',
    requireReportSession,
    (req, res, next) => {
      if (!rdb.userHasRole(req.reportUser, 'super_admin')) {
        return res.status(403).json({ error: 'super_admin only' });
      }
      next();
    },
    async (req, res) => {
      try {
        const rr = require('../risk-register-export');
        const label = decodeURIComponent(req.params.sdp_label || '');
        const r = await rr.deleteAlias(rdb.db, label);
        const who = req.reportUser?.username || req.reportUser?.full_name || 'unknown';
        console.log(`[rr-config] delete "${label}" by ${who} — rows=${r.deleted}`);
        res.json(r);
      } catch (err) {
        console.error('[rr-config] delete error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });

  router.get('/api/risk-register-config/unmapped', requireReportSession, async (req, res) => {
    try {
      const rr = require('../risk-register-export');
      const month = (req.query.month || '').trim();
      res.json({ month, unmapped: await rr.listUnmappedSites(rdb.db, month) });
    } catch (err) {
      console.error('[rr-config] unmapped error:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  // Passthrough endpoints (all existing)
  const simpleViews = [
    ['/api/data/sla-trend',          'SLA_COMPLIANCE_TREND',  500],
    ['/api/data/ticket-volume',      'MONTHLY_TICKET_TREND',  500],
    ['/api/data/ageing',             'AGEING_SUMMARY',        500],
    ['/api/data/emergency-changes',  'EMERGENCY_CHANGES',     200],
    // /api/data/major-incidents — handler defined below (DB-sourced, falls back to Zoho)
    // /api/data/change-table    — handler defined below (DB-sourced, falls back to Zoho)
    // ageing-by-site has its own dedicated endpoint below (needs preprocessing)
    ['/api/data/changes',            'CHANGES_BY_STAGE',      300],
    ['/api/data/changes-it',         'CHANGES_BY_STAGE_IT',   300],
    ['/api/data/first-response',     'FIRST_RESPONSE_TREND',  300],
    ['/api/data/resolution-by-site', 'RESOLUTION_BY_SITE',    200],
    ['/api/data/backlog-trend',      'BACKLOG_TREND',         200],
    ['/api/data/incidents-volume',   'INCIDENTS_VOLUME',      300],
    ['/api/data/sla-by-category',    'SLA_BY_CATEGORY',       200],
    ['/api/data/sla-by-category-week','SLA_BY_CATEGORY_WEEK', 200],
    ['/api/data/sla-violated-by-cat','SLA_VIOLATED_BY_CAT',   300],
    ['/api/data/group-count',        'GROUP_REQUEST_COUNT',   200],
    ['/api/data/group-requests',     'GROUP_REQUEST_COUNT',   200], // alias used by frontend
    // /api/data/change-table — handler defined below (DB-sourced, falls back to Zoho view 002044)
    ['/api/data/request-volume',     'REQUEST_VOLUME_TREND',  200],
    ['/api/data/sla-by-group',       'SLA_BY_GROUP',          200],
    ['/api/data/cab-compliance',     'CAB_COMPLIANCE',        200],
    ['/api/data/cab-approvals',      'CAB_APPROVAL_DETAILS',  500],
    ['/api/data/cab-recommendations','CAB_RECOMMENDATIONS',   500],
    ['/api/data/major-inc-by-month', 'MAJOR_INC_BY_MONTH',   200],
    ['/api/data/major-inc-by-cat',   'MAJOR_INC_BY_CAT',     200],
    ['/api/data/major-inc-by-site',  'MAJOR_INC_BY_SITE',    200],
    ['/api/data/incident-vs-sr',     'INCIDENT_VS_SR',        60],
  ];

  // ── DB-first endpoints for major-incidents + change-table ──────────────────
  // Replaces the old simpleViews entries that fetched live Zoho views 790842 +
  // 002044 on every request. Same drift / latency concerns as monthly-summary
  // (which we already moved to DB earlier this branch).
  //
  // KNOWN LIMITATION on /api/data/major-incidents: request_records doesn't yet
  // store UDF fields (Root Cause Analysis, Corrective Action, Lessons Learned,
  // etc.) because the underlying REQUEST_TABLE view doesn't return them. The
  // Lessons Learned tab + RCA/CA completeness stats on the executive page show
  // empty values for those fields. Adding a dedicated UDF sync is a follow-up.
  router.get('/api/data/major-incidents', requireReportSession, async (req, res) => {
    try {
      let dbRows = [];
      try {
        const rdbLocal = require('../reports-db');
        if (typeof rdbLocal.getMajorIncidentsHistory === 'function') {
          dbRows = await rdbLocal.getMajorIncidentsHistory(12) || [];
        }
      } catch(e) { console.warn('[major-incidents] DB lookup failed:', e.message); }

      if (dbRows.length > 0) {
        console.log(`[major-incidents] ✅ DB-sourced — ${dbRows.length} rows (last 12 months, all sites/groups)`);
        return res.json({ success: true, data: { rows: dbRows, columns: Object.keys(dbRows[0]) }, _source: 'db' });
      }
      // Fallback: live Zoho view 790842 (only fires if DB has zero major incidents in window)
      console.warn('[major-incidents] DB returned 0 rows — falling back to Zoho view 790842');
      const cached = getCached('MAJOR_INCIDENTS');
      if (cached) return res.json({ success: true, data: cached, _cached: true, _source: 'zoho-fallback' });
      const raw = await fetchView(VIEWS.MAJOR_INCIDENTS, 500);
      setCache('MAJOR_INCIDENTS', raw);
      res.json({ success: true, data: raw, _source: 'zoho-fallback' });
    } catch(err) {
      console.error('[major-incidents] ❌ both DB and Zoho path failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/data/change-table', requireReportSession, async (req, res) => {
    try {
      let dbRows = [];
      try {
        const rdbLocal = require('../reports-db');
        if (typeof rdbLocal.getChangeRecordsHistory === 'function') {
          dbRows = await rdbLocal.getChangeRecordsHistory(12) || [];
        }
      } catch(e) { console.warn('[change-table] DB lookup failed:', e.message); }

      if (dbRows.length > 0) {
        console.log(`[change-table] ✅ DB-sourced — ${dbRows.length} rows (last 12 months, all change types)`);
        return res.json({ success: true, data: { rows: dbRows, columns: Object.keys(dbRows[0]) }, _source: 'db' });
      }
      // Fallback: live Zoho view 002044
      console.warn('[change-table] DB returned 0 rows — falling back to Zoho view 002044');
      const cached = getCached('CHANGE_TABLE');
      if (cached) return res.json({ success: true, data: cached, _cached: true, _source: 'zoho-fallback' });
      const raw = await fetchView(VIEWS.CHANGE_TABLE, 500);
      setCache('CHANGE_TABLE', raw);
      res.json({ success: true, data: raw, _source: 'zoho-fallback' });
    } catch(err) {
      console.error('[change-table] ❌ both DB and Zoho path failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // First Response Trend — DB-direct override (Phase 2 of executive.html rewrite,
  // 2026-05-26). Must be registered BEFORE the simpleViews.forEach loop below,
  // because the loop also tries to register /api/data/first-response as a Zoho
  // passthrough, and Express dispatches the first matching route registered.
  // Returns the legacy shape { rows: [{ month, avgFRT, avgRT, n }, …] } so the
  // executive.html chart code reads it unchanged.
  router.get('/api/data/first-response', requireReportSession, async (req, res) => {
    try {
      let dbRows = [];
      try {
        const rdb2 = require('../reports-db');
        if (typeof rdb2.getFirstResponseTrendDB === 'function') {
          dbRows = await rdb2.getFirstResponseTrendDB(12) || [];
        }
      } catch(e) { console.warn('[first-response] DB lookup failed:', e.message); }

      if (dbRows.length > 0) {
        // Map our helper output to the column names the chart code reads
        // (frPrebuilt loop at public/executive.html:8677). The Zoho view's
        // typo "Avgerage" is preserved deliberately — the page tries that
        // key first, falling back to "Average" and "Avg First Reply (hrs)".
        // Matching the typo means zero frontend changes.
        const mapped = dbRows.map(r => ({
          'Created Date':                    r.month,
          'Avgerage Time to Respond in Hrs': r.avgFRT,
          'n':                               r.n,
        }));
        console.log(`[first-response] ✅ DB: ${dbRows.length} months`);
        return res.json({ success: true, data: { rows: mapped, columns: ['Created Date','Avgerage Time to Respond in Hrs','n'] }, _source: 'db' });
      }

      // Fallback to live Zoho — only fires when DB has no data yet.
      console.log('[first-response] ⚠ DB empty — falling back to live Zoho view');
      const cached = getCached('FIRST_RESPONSE_TREND');
      if (cached) return res.json({ success: true, data: cached, _cached: true, _source: 'zoho-cache' });
      const raw = await fetchView(VIEWS.FIRST_RESPONSE_TREND, 300);
      setCache('FIRST_RESPONSE_TREND', raw);
      res.json({ success: true, data: raw, _source: 'zoho-live' });
    } catch(err) {
      res.status(err.response?.status||500).json({ error: err.message, details: err.response?.data });
    }
  });

  // SLA trend (Phase 3 of executive.html rewrite, 2026-05-26).
  // Powers the red/green compliance line on the Monthly Volume chart.
  // DB-direct via getSlaTrendDB; Zoho fallback only when DB is empty.
  router.get('/api/data/sla-trend', requireReportSession, async (req, res) => {
    try {
      let dbRows = [];
      try {
        const rdb2 = require('../reports-db');
        if (typeof rdb2.getSlaTrendDB === 'function') {
          dbRows = await rdb2.getSlaTrendDB(12) || [];
        }
      } catch(e) { console.warn('[sla-trend] DB lookup failed:', e.message); }

      if (dbRows.length > 0) {
        console.log(`[sla-trend] ✅ DB: ${dbRows.length} months`);
        return res.json({ success: true, data: { rows: dbRows, columns: ['Created Date','% of SLA Violated','% of First Responses SLA Violated','n'] }, _source: 'db' });
      }

      // Fallback: legacy Zoho passthrough.
      console.log('[sla-trend] ⚠ DB empty — falling back to live Zoho view');
      const cached = getCached('SLA_COMPLIANCE_TREND');
      if (cached) return res.json({ success: true, data: cached, _cached: true, _source: 'zoho-cache' });
      const raw = await fetchView(VIEWS.SLA_COMPLIANCE_TREND, 500);
      setCache('SLA_COMPLIANCE_TREND', raw);
      res.json({ success: true, data: raw, _source: 'zoho-live' });
    } catch(err) {
      res.status(err.response?.status||500).json({ error: err.message, details: err.response?.data });
    }
  });

  // SLA by category (Phase 3 of executive.html rewrite, 2026-05-26).
  // Powers the SLA Violations by Category chart on the KPI Snapshot tab.
  // DB-direct via getSlaByCategoryDB; Zoho fallback only when DB is empty.
  router.get('/api/data/sla-by-category', requireReportSession, async (req, res) => {
    try {
      let dbRows = [];
      try {
        const rdb2 = require('../reports-db');
        if (typeof rdb2.getSlaByCategoryDB === 'function') {
          dbRows = await rdb2.getSlaByCategoryDB() || [];
        }
      } catch(e) { console.warn('[sla-by-category] DB lookup failed:', e.message); }

      if (dbRows.length > 0) {
        console.log(`[sla-by-category] ✅ DB: ${dbRows.length} categories`);
        return res.json({ success: true, data: { rows: dbRows, columns: ['Category','% of SLA Violated','n'] }, _source: 'db' });
      }

      // Fallback: legacy Zoho passthrough.
      console.log('[sla-by-category] ⚠ DB empty — falling back to live Zoho view');
      const cached = getCached('SLA_BY_CATEGORY');
      if (cached) return res.json({ success: true, data: cached, _cached: true, _source: 'zoho-cache' });
      const raw = await fetchView(VIEWS.SLA_BY_CATEGORY, 200);
      setCache('SLA_BY_CATEGORY', raw);
      res.json({ success: true, data: raw, _source: 'zoho-live' });
    } catch(err) {
      res.status(err.response?.status||500).json({ error: err.message, details: err.response?.data });
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Phase 3 final batch — last 6 /api/data/* endpoints DB-direct.
  // All match the established pattern:
  //   1) Try DB-direct via reports-db helper
  //   2) Fall back to live Zoho when DB returns 0 rows (brand-new install
  //      with no sync yet)
  //   3) Log [route] ✅ DB / ⚠ Zoho-fallback so the migration's
  //      effectiveness is visible in pm2 logs
  //
  // Trigger: 2026-05-26 — the original page was hitting Zoho rate limits
  // ("You have made too many requests continuously. Please try again after
  // some time"). Each retained live-Zoho call on every page load piled
  // onto the cron's quota burn until Zoho refused 400. Migrating these
  // six eliminates the page's direct Zoho dependency.
  // ────────────────────────────────────────────────────────────────────

  router.get('/api/data/group-requests', requireReportSession, async (req, res) => {
    try {
      let dbRows = [];
      try {
        const rdb2 = require('../reports-db');
        if (typeof rdb2.getGroupRequestsDB === 'function') dbRows = await rdb2.getGroupRequestsDB(12) || [];
      } catch(e) { console.warn('[group-requests] DB lookup failed:', e.message); }
      if (dbRows.length > 0) {
        console.log(`[group-requests] ✅ DB: ${dbRows.length} groups`);
        return res.json({ success: true, data: { rows: dbRows, columns: ['Group','Request Count'] }, _source: 'db' });
      }
      console.log('[group-requests] ⚠ DB empty — falling back to live Zoho view');
      const cached = getCached('GROUP_REQUEST_COUNT');
      if (cached) return res.json({ success: true, data: cached, _cached: true, _source: 'zoho-cache' });
      const raw = await fetchView(VIEWS.GROUP_REQUEST_COUNT, 200);
      setCache('GROUP_REQUEST_COUNT', raw);
      res.json({ success: true, data: raw, _source: 'zoho-live' });
    } catch(err) {
      res.status(err.response?.status||500).json({ error: err.message, details: err.response?.data });
    }
  });

  router.get('/api/data/emergency-changes', requireReportSession, async (req, res) => {
    try {
      let dbRows = [];
      try {
        const rdb2 = require('../reports-db');
        if (typeof rdb2.getEmergencyChangesDB === 'function') dbRows = await rdb2.getEmergencyChangesDB(12) || [];
      } catch(e) { console.warn('[emergency-changes] DB lookup failed:', e.message); }
      if (dbRows.length > 0) {
        console.log(`[emergency-changes] ✅ DB: ${dbRows.length} emergency RFCs`);
        return res.json({ success: true, data: { rows: dbRows, columns: ['Change ID','Subject','Change Type','Status'] }, _source: 'db' });
      }
      console.log('[emergency-changes] ⚠ DB empty — falling back to live Zoho view');
      const cached = getCached('EMERGENCY_CHANGES');
      if (cached) return res.json({ success: true, data: cached, _cached: true, _source: 'zoho-cache' });
      const raw = await fetchView(VIEWS.EMERGENCY_CHANGES, 200);
      setCache('EMERGENCY_CHANGES', raw);
      res.json({ success: true, data: raw, _source: 'zoho-live' });
    } catch(err) {
      res.status(err.response?.status||500).json({ error: err.message, details: err.response?.data });
    }
  });

  router.get('/api/data/ageing', requireReportSession, async (req, res) => {
    try {
      let dbRows = [];
      try {
        const rdb2 = require('../reports-db');
        if (typeof rdb2.getAgeingSummaryDB === 'function') dbRows = await rdb2.getAgeingSummaryDB() || [];
      } catch(e) { console.warn('[ageing] DB lookup failed:', e.message); }
      if (dbRows.length > 0) {
        console.log(`[ageing] ✅ DB: ${dbRows.length} group×tier rows`);
        return res.json({ success: true, data: { rows: dbRows, columns: ['Group','Request Age Tier','Total Requests'] }, _source: 'db' });
      }
      console.log('[ageing] ⚠ DB empty — falling back to live Zoho view');
      const cached = getCached('AGEING_SUMMARY');
      if (cached) return res.json({ success: true, data: cached, _cached: true, _source: 'zoho-cache' });
      const raw = await fetchView(VIEWS.AGEING_SUMMARY, 500);
      setCache('AGEING_SUMMARY', raw);
      res.json({ success: true, data: raw, _source: 'zoho-live' });
    } catch(err) {
      res.status(err.response?.status||500).json({ error: err.message, details: err.response?.data });
    }
  });

  router.get('/api/data/incident-vs-sr', requireReportSession, async (req, res) => {
    try {
      let dbRows = [];
      try {
        const rdb2 = require('../reports-db');
        if (typeof rdb2.getIncidentVsSrDB === 'function') dbRows = await rdb2.getIncidentVsSrDB(12) || [];
      } catch(e) { console.warn('[incident-vs-sr] DB lookup failed:', e.message); }
      if (dbRows.length > 0) {
        console.log(`[incident-vs-sr] ✅ DB: ${dbRows.length} months`);
        return res.json({ success: true, data: { rows: dbRows, columns: ['Created Time','Incidents','Service Requests'] }, _source: 'db' });
      }
      console.log('[incident-vs-sr] ⚠ DB empty — falling back to live Zoho view');
      const cached = getCached('INCIDENT_VS_SR');
      if (cached) return res.json({ success: true, data: cached, _cached: true, _source: 'zoho-cache' });
      const raw = await fetchView(VIEWS.INCIDENT_VS_SR, 60);
      setCache('INCIDENT_VS_SR', raw);
      res.json({ success: true, data: raw, _source: 'zoho-live' });
    } catch(err) {
      res.status(err.response?.status||500).json({ error: err.message, details: err.response?.data });
    }
  });

  router.get('/api/data/cab-approvals', requireReportSession, async (req, res) => {
    try {
      let dbRows = [];
      try {
        const rdb2 = require('../reports-db');
        if (typeof rdb2.getCabApprovalsDB === 'function') dbRows = await rdb2.getCabApprovalsDB(12) || [];
      } catch(e) { console.warn('[cab-approvals] DB lookup failed:', e.message); }
      if (dbRows.length > 0) {
        console.log(`[cab-approvals] ✅ DB: ${dbRows.length} approval rows`);
        return res.json({ success: true, data: { rows: dbRows, columns: ['Change Approver','Approval Status','Stage and Status'] }, _source: 'db' });
      }
      console.log('[cab-approvals] ⚠ DB empty — falling back to live Zoho view');
      const cached = getCached('CAB_APPROVAL_DETAILS');
      if (cached) return res.json({ success: true, data: cached, _cached: true, _source: 'zoho-cache' });
      const raw = await fetchView(VIEWS.CAB_APPROVAL_DETAILS, 500);
      setCache('CAB_APPROVAL_DETAILS', raw);
      res.json({ success: true, data: raw, _source: 'zoho-live' });
    } catch(err) {
      res.status(err.response?.status||500).json({ error: err.message, details: err.response?.data });
    }
  });

  router.get('/api/data/cab-recommendations', requireReportSession, async (req, res) => {
    try {
      let dbRows = [];
      try {
        const rdb2 = require('../reports-db');
        if (typeof rdb2.getCabRecommendationsDB === 'function') dbRows = await rdb2.getCabRecommendationsDB(12) || [];
      } catch(e) { console.warn('[cab-recommendations] DB lookup failed:', e.message); }
      if (dbRows.length > 0) {
        console.log(`[cab-recommendations] ✅ DB: ${dbRows.length} recommendation rows`);
        return res.json({ success: true, data: { rows: dbRows, columns: ['Change Approver','Approval Stage','Recommendation Turnaround Time (Minutes)'] }, _source: 'db' });
      }
      console.log('[cab-recommendations] ⚠ DB empty — falling back to live Zoho view');
      const cached = getCached('CAB_RECOMMENDATIONS');
      if (cached) return res.json({ success: true, data: cached, _cached: true, _source: 'zoho-cache' });
      const raw = await fetchView(VIEWS.CAB_RECOMMENDATIONS, 500);
      setCache('CAB_RECOMMENDATIONS', raw);
      res.json({ success: true, data: raw, _source: 'zoho-live' });
    } catch(err) {
      res.status(err.response?.status||500).json({ error: err.message, details: err.response?.data });
    }
  });

  // Filter the simpleViews list to drop the routes that now have DB-direct
  // overrides above — keeps the passthrough loop below from double-registering
  // these paths and shadowing our handlers.
  const _DB_OVERRIDDEN = new Set([
    '/api/data/first-response',
    '/api/data/sla-trend',
    '/api/data/sla-by-category',
    // Final batch — 2026-05-26
    '/api/data/group-requests',
    '/api/data/emergency-changes',
    '/api/data/ageing',
    '/api/data/incident-vs-sr',
    '/api/data/cab-approvals',
    '/api/data/cab-recommendations',
  ]);
  const _simpleViewsActive = simpleViews.filter(([route]) => !_DB_OVERRIDDEN.has(route));

  _simpleViewsActive.forEach(([route, viewKey, maxR]) => {
    router.get(route, async (req, res) => {
      const cached = getCached(viewKey);
      if (cached) return res.json({ success: true, data: cached, _cached: true });
      try {
        const raw = await fetchView(VIEWS[viewKey], maxR);
        setCache(viewKey, raw);
        res.json({ success: true, data: raw });
      } catch(err) { res.status(err.response?.status||500).json({ error: err.message, details: err.response?.data }); }
    });
  });

  // GET /api/data/submission-channels — counts tickets by Mode (submission channel) from SQLite.
  // Uses request_records.mode column (populated during every sync run) instead of the raw Zoho
  // view cache, where the Mode field is sparsely present.
  // Query params: yr (YYYY), mo (1-12), site (optional), groups (comma-separated, optional)
  router.get('/api/data/submission-channels', requireReportSession, async (req, res) => {
    try {
      const { yr, mo, site, groups } = req.query;
      const groupList = groups ? groups.split(',').map(g => g.trim()).filter(Boolean) : [];
      // Forked reader (sqlite/pg dispatch) — to_char period filter + GROUP BY channel collapse.
      const rows = await require('../reports-db').getSubmissionChannelsDB({ yr, mo, site, groups: groupList });

      const total       = rows.reduce((s, r) => s + r.cnt, 0);
      const knownRows   = rows.filter(r => r.channel !== null);
      const unknownRows = rows.filter(r => r.channel === null);
      const unknownCnt  = unknownRows.length ? unknownRows[0].cnt : 0;
      const knownTotal  = knownRows.reduce((s, r) => s + r.cnt, 0);

      res.json({
        channels:     knownRows.map(r => ({ mode: r.channel, count: r.cnt })),
        knownTotal,
        unknownCount: unknownCnt,
        total,
        coverage:     total > 0 ? Math.round(knownTotal / total * 100) : 0,
        source:       'request_records_db',
      });
    } catch(err) {
      console.error('[submission-channels]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/data/requests-raw — serves the 25k-row ticket payload to
  // executive-report.html, index.html, and reports.html.
  //
  // Browser caching strategy: the server-side _rawCache is refreshed by the
  // 2-hour Zoho cron + a 4-hour TTL. The payload doesn't change between
  // refreshes. We expose `_rawCache.ts` as a strong ETag, and tell the
  // browser to revalidate on every request:
  //
  //   Cache-Control: private, max-age=0, must-revalidate
  //   ETag:          "<_rawCache.ts>"
  //
  // Repeat visits within the cache window send `If-None-Match`, the server
  // matches and returns 304 Not Modified — no body transferred. That turns
  // a 5-10 MB / 1-2 MB-gzipped payload into a few hundred bytes, which is
  // the user-felt "stop loading 25k rows on every page" win.
  router.get('/api/data/requests-raw', requireReportSession, async (req, res) => {
    try {
      await getRawRequestRows(); // populates _rawCache if not warmed yet
      const ts      = _rawCache.ts || 0;
      const etag    = `"raw-${ts}"`;
      const isStale = ts && (Date.now() - ts >= _rawCache.TTL);

      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
      res.setHeader('ETag', etag);

      // Revalidation hit — payload unchanged since last visit.
      if (req.headers['if-none-match'] === etag) {
        console.log(`[requests-raw] 304 Not Modified (cache age ${Math.round((Date.now()-ts)/60000)}min)`);
        return res.status(304).end();
      }

      res.json({ success: true, data: _rawCache.data, _cached: !isStale, _stale: isStale });
    } catch(err) {
      console.error('[requests-raw]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/data/monthly-summary', requireReportSession, async (req, res) => {
    // Sourced from local request_records (synced from Zoho).
    // Replaces the prior live call to Zoho prebuilt view 644288 — that view's
    // 'Created Time' label format drifted, breaking the prev-month label match
    // in executive.html. Now we control the shape end-to-end.
    // - 12 calendar months, ALL groups, ALL sites (per user spec)
    // - No in-memory cache (DB query is cheap and the page doesn't load often)
    // - Falls back to the live Zoho view ONLY if the DB returns 0 months
    //   (i.e. brand-new install with no sync yet)
    try {
      let dbRows = [];
      try {
        const rdb2 = require('../reports-db');
        if (typeof rdb2.getMonthlyHelpdeskHistory === 'function') {
          dbRows = await rdb2.getMonthlyHelpdeskHistory(12) || [];
        }
      } catch(e) { console.warn('[monthly-summary] DB lookup failed:', e.message); }

      if (dbRows.length > 0) {
        const total = dbRows.reduce((s, r) => s + (parseInt(r['Requests']) || 0), 0);
        console.log(`[monthly-summary] ✅ DB-sourced — ${dbRows.length} months, ${total} total tickets`);
        return res.json({ success: true, data: { rows: dbRows, columns: Object.keys(dbRows[0]) }, _source: 'db' });
      }

      // ── DB-only (2026-05-28) ─────────────────────────────────────────────
      // Previously this fell back to live Zoho (view 644288 — MONTHLY_SUMMARY_PREBUILT)
      // when the DB returned 0 months. Per the same audit that fixed
      // getRawRequestRows, page loads must NEVER trigger Zoho. The cron job
      // populates monthly history; if DB is empty, return an empty result
      // and let the page render its empty-state UI.
      console.warn('[monthly-summary] DB returned 0 months — returning empty (waiting for next cron sync)');
      res.json({ success: true, data: { rows: [], columns: [] }, _source: 'db-empty', _meta: { note: 'No cached monthly history. Wait for next requests cron tick.' } });
    } catch(err) {
      console.error('[monthly-summary] ❌ DB lookup failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // /api/data/perf-summary removed 2026-06-19 — dead route (no caller), audit 3.3 YAGNI.
  // Ageing by Site — DB-direct (Phase 2 of executive.html rewrite, 2026-05-26).
  // Previously this fetched live Zoho view 141197 + parsed its pivoted shape;
  // that path now returns empty too often (timeout / 0 rows / Zoho-side schema
  // drift). Helper reads request_records and computes the same shape end-to-end.
  // Live Zoho is retained as a fallback ONLY if the DB returns 0 sites (brand-
  // new install with no sync yet).
  router.get('/api/data/ageing-by-site', requireReportSession, async (req, res) => {
    try {
      let result = [];
      try {
        const rdb2 = require('../reports-db');
        if (typeof rdb2.getAgeingBySiteDB === 'function') {
          result = await rdb2.getAgeingBySiteDB() || [];
        }
      } catch(e) { console.warn('[ageing-by-site] DB lookup failed:', e.message); }

      if (result.length > 0) {
        console.log(`[ageing-by-site] ✅ DB: ${result.length} sites`);
        return res.json({ success: true, data: { rows: result, columns: ['site','d0','d31','d46','d60','total'] }, _source: 'db' });
      }

      // Fallback: legacy Zoho pivot — only fires if DB is empty.
      console.log('[ageing-by-site] ⚠ DB empty — falling back to live Zoho view');
      const raw = await fetchView(VIEWS.AGEING_BY_SITE, 1000);
      const rows = raw.rows || [];
      const TIERS = ['0 - 30 Days','31 - 45 Days','46 - 60 Days','Over 60 Days'];
      const TIER_KEYS = { '0 - 30 Days':'d0','31 - 45 Days':'d31','46 - 60 Days':'d46','Over 60 Days':'d60' };
      const SKIP = new Set(['-no value-','-no value','no value','','(blank)']);
      let curTier = '', curSite = '', curGroup = '';
      const filled = rows.map(r => {
        if (r['Request Age Tier'] && r['Request Age Tier'].trim()) curTier  = r['Request Age Tier'].trim();
        if (r['Site']             && r['Site'].trim())             curSite  = r['Site'].trim();
        if (r['Group']            && r['Group'].trim())            curGroup = r['Group'].trim();
        return { tier: curTier, site: curSite, count: parseInt(r['Total Requests'])||0 };
      });
      const siteMap = {};
      filled.forEach(r => {
        const s = r.site;
        if (!s || SKIP.has(s.toLowerCase())) return;
        if (!TIERS.includes(r.tier)) return;
        if (!siteMap[s]) siteMap[s] = { site:s, d0:0, d31:0, d46:0, d60:0, total:0 };
        siteMap[s][TIER_KEYS[r.tier]] += r.count;
        siteMap[s].total += r.count;
      });
      result = Object.values(siteMap).filter(s=>s.total>0).sort((a,b)=>b.total-a.total);
      res.json({ success: true, data: { rows: result, columns: ['site','d0','d31','d46','d60','total'] }, _source: 'zoho' });
    } catch(err) { res.status(err.response?.status||500).json({ error: err.message, details: err.response?.data }); }
  });

  // Ageing by IT Group — DB-direct (same pattern as ageing-by-site above).
  // Returns the legacy shape: group, t0_30, t31_45, t46_60, tOver60, total,
  // slaCompliance. slaCompliance is computed from first_response_overdue
  // (the legacy Zoho view used a per-row SLA Compliance % field; the
  // DB-direct equivalent is the % of open tickets where FRT wasn't overdue,
  // which is the closest semantic match to what the legacy column meant
  // in the executive.html chart).
  router.get('/api/data/ageing-by-group', requireReportSession, async (req, res) => {
    try {
      let result = [];
      try {
        const rdb2 = require('../reports-db');
        if (typeof rdb2.getAgeingByGroupDB === 'function') {
          // Map DB shape → legacy chart shape: rename slaPct → slaCompliance.
          result = (await rdb2.getAgeingByGroupDB() || []).map(g => ({
            group:         g.group,
            site:          '',       // legacy column — present but blank for DB-direct
            t0_30:         g.t0_30,
            t31_45:        g.t31_45,
            t46_60:        g.t46_60,
            tOver60:       g.tOver60,
            total:         g.total,
            slaCompliance: g.slaPct,
          }));
        }
      } catch(e) { console.warn('[ageing-by-group] DB lookup failed:', e.message); }

      if (result.length > 0) {
        console.log(`[ageing-by-group] ✅ DB: ${result.length} groups`);
        return res.json({ success: true, data: { rows: result, columns: ['group','t0_30','t31_45','t46_60','tOver60','total','slaCompliance'] }, _source: 'db' });
      }

      // Fallback: legacy Zoho pivot — only fires if DB is empty.
      console.log('[ageing-by-group] ⚠ DB empty — falling back to live Zoho view');
      const raw = await fetchView(VIEWS.AGEING_BY_GROUP, 1000);
      const rows = raw.rows || [];
      const TIERS = ['0 - 30 Days','31 - 45 Days','46 - 60 Days','Over 60 Days'];
      const TIER_KEYS = { '0 - 30 Days':'t0_30','31 - 45 Days':'t31_45','46 - 60 Days':'t46_60','Over 60 Days':'tOver60' };
      let curTier = '', curSite = '', curGroup = '';
      const filled = rows.map(r => {
        if (r['Request Age Tier'] && r['Request Age Tier'].trim()) curTier  = r['Request Age Tier'].trim().replace(/^\s+/,'');
        if (r['Site']             && r['Site'].trim())             curSite  = r['Site'].trim();
        if (r['Group']            && r['Group'].trim())            curGroup = r['Group'].trim();
        return { tier: curTier, site: curSite, group: curGroup, count: parseInt(r['Total Requests'])||0, slaComp: parseFloat(r['SLA Compliance %'])||null };
      });
      const groupMap = {};
      filled.forEach(r => {
        const g = r.group;
        if (!g || g==='-No Value-'||g===''||g==='No Value') return;
        if (!TIERS.includes(r.tier)) return;
        if (!groupMap[g]) groupMap[g] = { group:g, site:r.site||'', t0_30:0, t31_45:0, t46_60:0, tOver60:0, total:0, slaSum:0, slaN:0 };
        groupMap[g][TIER_KEYS[r.tier]] += r.count; groupMap[g].total += r.count;
        if (r.slaComp!==null) { groupMap[g].slaSum += r.slaComp * r.count; groupMap[g].slaN += r.count; }
      });
      result = Object.values(groupMap).filter(g=>g.total>0).sort((a,b)=>b.total-a.total)
        .map(g => ({ group:g.group, site:g.site, t0_30:g.t0_30, t31_45:g.t31_45, t46_60:g.t46_60, tOver60:g.tOver60, total:g.total, slaCompliance:g.slaN>0?Math.round(g.slaSum/g.slaN*10)/10:null }));
      res.json({ success: true, data: { rows: result, columns: ['group','t0_30','t31_45','t46_60','tOver60','total','slaCompliance'] }, _source: 'zoho' });
    } catch(err) { res.status(err.response?.status||500).json({ error: err.message, details: err.response?.data }); }
  });

  return router;
};
