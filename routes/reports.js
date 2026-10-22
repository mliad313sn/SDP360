'use strict';
// ---------------------------------------------------------------------------
// Weekly site report routes - extracted from server.js (SDP-DASH-2.0 step 5, lot 5.3c,
// 2026-10-22). Report list/ensure/read/delete, section writes (infra, helpdesk, lights,
// actions, status, reassign-week), action carry-over and imports, the "Parc informatique"
// tab, light/infra carry-over, audit trail, helpdesk-live/charts, technicians, System Logs
// and the per-report open changes / active incidents / infra-auto fills.
// Handlers unchanged (`app.` became `router.`); mounted where the block used to sit, so the
// static paths (system-log, helpdesk-live...) still register ABOVE /api/reports/:id.
// Two helpers are also used by routes/reportsDecks.js: they are exposed on router.helpers.
// ---------------------------------------------------------------------------
const userSites = require('../services/userSites');

module.exports = function reportsRoutes(deps) {
  const {
    express, rdb, requireReportSession, requireRole, jsonBody, IS_DEV, reportConfig,
    authorizeReportWrite: _authorizeReportWrite, userSiteGroups: _userSiteGroups,
    getRawRequestRows, parseZohoStr,
  } = deps;
  const router = express.Router();

  // ── Report CRUD ───────────────────────────────────────────────────
  // GET /api/reports?site_id=&year=&week=  — list reports
  router.get('/api/reports', requireReportSession, async (req, res) => {
    try {
      const { site_id, year, week } = req.query;
      // Non-admins see their own site only (RBAC audit 2026-10-02 — hierarchy, not the
      // exact role string). A site-less non-admin sees nothing: listReports DROPS the
      // filter on a falsy id and would return every site.
      const isAdminTier = rdb.userHasRole(req.reportUser, 'admin');
      const y = year ? parseInt(year) : undefined, w = week ? parseInt(week) : undefined;
      if (isAdminTier) return res.json(await rdb.listReports(site_id ? parseInt(site_id) : undefined, y, w));
      // Non-admin: their sites only (multi-site editors 2026-10-05). ?site_id narrows to one of them.
      let ids = userSites.siteIds(req.reportUser);
      if (site_id && ids.includes(parseInt(site_id))) ids = [parseInt(site_id)];
      if (!ids.length) return res.json([]);
      const rows = [];
      for (const id of ids) rows.push(...((await rdb.listReports(id, y, w)) || []));
      rows.sort((a, b) => (b.year - a.year) || (b.week_number - a.week_number));
      res.json(rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/reports/ensure  — get or create a report for site+week
  router.post('/api/reports/ensure', requireReportSession, jsonBody, async (req, res) => {
    try {
      const { site_id, year, week } = req.body || {};
      if (!site_id || !year || !week) return res.status(400).json({ error: 'site_id, year, week required' });
      // Non-admin editors can only create for their own site
      if (!rdb.userHasRole(req.reportUser, 'admin') && !userSites.hasSite(req.reportUser, parseInt(site_id)))
        return res.status(403).json({ error: 'You can only manage reports for your own site' });
      // (await f()).method() — NOT `await f().method()`: the latter chains onto the
      // Promise (listReports is async on both backends). See the await-precedence pitfall.
      const isNew = !(await rdb.listReports(parseInt(site_id))).find(r => r.year === parseInt(year) && r.week_number === parseInt(week));
      const report = await rdb.ensureReport(parseInt(site_id), parseInt(year), parseInt(week));
      if (isNew) {
        await rdb.logAudit({ report_id: report.id, site_id: parseInt(site_id), user_id: req.reportUser.id, username: req.reportUser.username, action: 'created', details: { year, week } });
      }
      res.json(report);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/:id/carry-over-actions  — non-closed actions from previous week (legacy)
  router.get('/api/reports/:id/carry-over-actions', requireReportSession, async (req, res) => {
    try {
      const report = await rdb.getReport(parseInt(req.params.id));
      if (!report) return res.status(404).json({ error: 'Report not found' });
      const result = await rdb.getPreviousWeekOpenActions(report.site_id, report.id);
      res.json(result);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/:id/action-weeks  — list all past weeks with non-closed action counts
  router.get('/api/reports/:id/action-weeks', requireReportSession, async (req, res) => {
    try {
      const report = await rdb.getReport(parseInt(req.params.id));
      if (!report) return res.status(404).json({ error: 'Report not found' });
      const weeks = await rdb.listAllWeeksWithActions(report.site_id, report.id);
      // 2026-10-15: a week counts only the actions still worth importing into THIS report
      // (not closed/cancelled, not closed in a later week, not already carried here) — the raw
      // per-week count re-counted every carried copy and every action closed since.
      const { weekCounts } = require('../services/reportActionGroups');
      const counts = weekCounts(await rdb.getSiteActionRows(report.site_id), report.id);
      res.json({ weeks: weeks.map(w => ({ ...w, action_count: counts.get(w.report_id) || 0 })) });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/:id/actions-from/:source_report_id  — non-closed actions from a specific week
  router.get('/api/reports/:id/actions-from/:source_report_id', requireReportSession, async (req, res) => {
    try {
      const report = await rdb.getReport(parseInt(req.params.id));
      if (!report) return res.status(404).json({ error: 'Report not found' });
      const sourceReport = await rdb.getReport(parseInt(req.params.source_report_id));
      if (!sourceReport) return res.status(404).json({ error: 'Source report not found' });
      // Security: source report must belong to the same site
      if (sourceReport.site_id !== report.site_id)
        return res.status(403).json({ error: 'Source report is from a different site' });
      const result = await rdb.getActionsForReport(parseInt(req.params.source_report_id));
      // 2026-10-15: each action says whether it can be imported, why not, and which group it
      // belongs to (code, first week, weeks) — the window previews before importing.
      const { classifySourceRows } = require('../services/reportActionGroups');
      const siteRows = await rdb.getSiteActionRows(report.site_id);
      const actions = classifySourceRows({ sourceRows: (result.actions || []).filter(a => !a.source),
        siteRows, currentReportId: report.id });
      res.json({ ...result, actions });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── Asset engagement — weekly "Parc informatique" tab (2026-09-18) ───────────
  // report → meetings code (site_module_codes) → the REAL asset labels folded
  // FORWARD (never invert ALIAS — see assetHygieneForSite.labelsForCode).
  // No code or no label → not applicable (Exploration, Tanda).
  async function _assetLabelsForReport(report) {
    const codes = await rdb.listSiteModuleCodes('meetings');
    const hit = (codes || []).find(c => c.site_id === report.site_id);
    if (!hit) return { code: null, labels: [] };
    const lookups = (await require('../assets-db').getAssetLookups()) || {};
    const { labelsForCode } = require('../services/assetHygieneForSite');
    const { assetLabelToCode } = require('../services/scoreboardAliases');
    return { code: hit.code, labels: labelsForCode(lookups.sites, hit.code, assetLabelToCode) };
  }
  // Window = the report's Zoho week (start_date..end_date). Throws when the assets
  // layer throws — callers decide (GET → 503, PUT notes → counts kept, submission → counts null).
  async function _computeAssetReview(report) {
    const { code, labels } = await _assetLabelsForReport(report);
    if (!labels.length) return { applicable: false, code, labels, counts: null, followups: null };
    const followups = await require('../assets-db').getSiteAssetFollowups(labels, { newFrom: report.start_date, newTo: report.end_date });
    return { applicable: true, code, labels, counts: followups.counts, followups };
  }
  // Parc informatique data for the weekly PPTX decks: the stored review (frozen or
  // last saved) + the previous report's frozen counts for the change line. A report
  // whose tab was never saved gets live counts; a site with no asset label -> null
  // (no slide). Best-effort: any failure -> null, the deck still renders.
  async function _assetReviewForPptx(report) {
    try {
      let rv = report.asset_review ? { ...report.asset_review } : null;
      if (rv && (rv.applicable === false || rv.applicable === 0)) return null;
      if (!rv || !rv.counts) {
        const a = await _computeAssetReview(report);
        if (!a.applicable) return null;
        rv = { handled_note: '', plan_note: '', ...(rv || {}), applicable: true, counts: a.counts };
      }
      rv.status = report.status;
      // The site's parc-keeping score + rank + ~30-day change (same source as the
      // weekly e-mail's effort tiles). Best-effort: no score -> no strip.
      rv.effort = null;
      try {
        const { code } = await _assetLabelsForReport(report);
        if (code) {
          const board = await require('../assets-db').getEffortLeaderboard({});
          rv.effort = require('../services/assetEffortForSite').effortForSite(code, { leaderboard: board });
        }
      } catch (e) { console.warn('[asset-review] pptx effort failed:', e.message); }
      rv.previous_counts = null;
      if (report.site_id) {   // a falsy site_id would make listReports return EVERY site's reports
        const prev = ((await rdb.listReports(report.site_id)) || []).find(r => r.start_date < report.start_date);
        rv.previous_counts = prev ? ((await rdb.getReportAssetReview(prev.id)) || {}).counts || null : null;
      }
      return rv;
    } catch (e) { console.warn('[asset-review] pptx data failed:', e.message); return null; }
  }
  // Read rule: admin+ unscoped; everyone else must be on the report's site (a
  // site-less profile is NOT global).
  function _assetReviewReadDenial(user, report) {
    if (!report) return { status: 404, error: 'Report not found' };
    if (rdb.userHasRole(user, 'admin')) return null;
    if (!userSites.hasSite(user, report.site_id)) return { status: 403, error: 'Access denied: this report belongs to another site' };
    return null;
  }
  const _NOTE_MAX = 4000;
  // A note is a string or null (null = clear). Anything else → undefined (caller → 400).
  const _cleanNote = v => (v === null ? '' : typeof v === 'string' ? v.trim().slice(0, _NOTE_MAX) : undefined);

  // GET /api/reports/:id/asset-followups — the four counts for the report week +
  // the previous report's frozen counts. Counts only (rev 5, 2026-09-18): the editor
  // shows no asset lists, so no row data is shipped; the lists live in the
  // asset-manager reminder e-mails only.
  router.get('/api/reports/:id/asset-followups', requireReportSession, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const report = Number.isInteger(id) ? await rdb.getReport(id) : null;
      const denial = _assetReviewReadDenial(req.reportUser, report);
      if (denial) return res.status(denial.status).json({ error: denial.error });
      let a;
      try { a = await _computeAssetReview(report); }
      catch (e) {
        console.error('[api/reports/asset-followups] assets layer:', e.message);
        return res.status(503).json({ error: 'Données Assets indisponibles' });
      }
      if (!a.applicable) return res.json({ applicable: false, site_code: a.code, labels: [], counts: null, previous_counts: null });
      let previous_counts = null;
      if (report.site_id) {   // a falsy site_id would make listReports return EVERY site's reports
        const prev = ((await rdb.listReports(report.site_id)) || []).find(r => r.start_date < report.start_date);
        previous_counts = prev ? ((await rdb.getReportAssetReview(prev.id)) || {}).counts || null : null;
      }
      const f = a.followups;
      res.json({
        applicable: true, site_code: a.code, labels: a.labels, counts: a.counts,
        window: { from: report.start_date, to: report.end_date }, previous_counts, generated_at: f.generated_at,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/reports/:id/asset-review — notes from the client; applicable + counts
  // are recomputed and frozen here (client values ignored). Write auth = F5 rule
  // (a submitted report is writable by super_admin only). After submission the
  // frozen counts are NEVER recomputed — only the notes change. An assets failure
  // never loses the notes: they are saved and applicable/counts are left as they were.
  router.put('/api/reports/:id/asset-review', requireReportSession, jsonBody, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const report = await _authorizeReportWrite(req, res, id);
      if (!report) return;
      // Only the notes PRESENT in the body are written — an absent key keeps the stored note.
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const patch = {};
      for (const k of ['handled_note', 'plan_note']) {
        if (!Object.prototype.hasOwnProperty.call(body, k)) continue;
        const v = _cleanNote(body[k]);
        if (v === undefined) return res.status(400).json({ error: 'note must be text' });
        patch[k] = v;
      }
      if (report.status !== 'submitted') {
        try {
          const a = await _computeAssetReview(report);
          patch.applicable = a.applicable;
          patch.counts = a.counts;
        } catch (e) {
          console.error('[api/reports/asset-review] assets layer (notes saved, counts kept):', e.message);
        }
      }
      const saved = await rdb.saveReportAssetReview(id, patch, req.reportUser.username);
      // The save succeeded — bookkeeping failures must never turn it into a 500.
      try {
        await rdb.touchReport(id);
        await rdb.logAudit({ report_id: id, site_id: report.site_id, user_id: req.reportUser.id, username: req.reportUser.username, action: 'edited_asset_review', details: { week_label: report.week_label } });
      } catch (e) { console.error('[api/reports/asset-review] touch/audit (save kept):', e.message); }
      res.json(saved);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/:id/site-open-actions  — the report site's currently-open report
  // follow-ups (lineage-deduped), for the client-side near-duplicate guard on entry.
  router.get('/api/reports/:id/site-open-actions', requireReportSession, async (req, res) => {
    try {
      const report = await rdb.getReport(parseInt(req.params.id));
      if (!report) return res.status(404).json({ error: 'Report not found' });
      const result = await rdb.getSiteOpenReportActions(report.site_id);
      // 2026-10-15: the group identity (code, first week, number of weeks) so the merge window
      // can tell two identical titles apart.
      const { summarizeGroups, groupKey } = require('../services/reportActionGroups');
      const groups = summarizeGroups(await rdb.getSiteActionRows(report.site_id));
      const actions = (result.actions || []).map(a => {
        const g = groups.get(groupKey(a));
        return { ...a, group: g ? { key: g.key, code: g.code, hue: g.hue, weeks: g.weeks, first_week: g.first_week } : null };
      });
      res.json({ ...result, actions });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/:id/light-weeks  — list all past weeks with lights counts
  router.get('/api/reports/:id/light-weeks', requireReportSession, async (req, res) => {
    try {
      const report = await rdb.getReport(parseInt(req.params.id));
      if (!report) return res.status(404).json({ error: 'Report not found' });
      const weeks = await rdb.listAllWeeksWithLights(report.site_id, report.id);
      res.json({ weeks });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/:id/lights-from/:source_report_id  — lights from a specific week
  router.get('/api/reports/:id/lights-from/:source_report_id', requireReportSession, async (req, res) => {
    try {
      const report = await rdb.getReport(parseInt(req.params.id));
      if (!report) return res.status(404).json({ error: 'Report not found' });
      const sourceReport = await rdb.getReport(parseInt(req.params.source_report_id));
      if (!sourceReport) return res.status(404).json({ error: 'Source report not found' });
      // Security: source report must belong to the same site
      if (sourceReport.site_id !== report.site_id)
        return res.status(403).json({ error: 'Source report is from a different site' });
      const result = await rdb.getLightsForReport(parseInt(req.params.source_report_id));
      res.json(result);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/:id/carry-over-infra  — infra KPIs from previous week (for copy feature)
  router.get('/api/reports/:id/carry-over-infra', requireReportSession, async (req, res) => {
    try {
      const report = await rdb.getReport(parseInt(req.params.id));
      if (!report) return res.status(404).json({ error: 'Report not found' });
      const result = await rdb.getPreviousWeekInfraKpis(report.site_id, report.id);
      res.json(result);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/:id/audit  — audit trail for a specific report
  // Requires audit-viewer role (or admin chain via hierarchy implication).
  // Lot 4a: open to an editor on their own site (site checked by the central guard);
  // audit-viewer stays global.
  router.get('/api/reports/:id/audit', requireReportSession, requireRole(['audit-viewer', 'editor']), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const entries = await rdb.getReportAuditLog(id);
      res.json(entries);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/helpdesk-live?start=YYYY-MM-DD&end=YYYY-MM-DD
  // Returns per-group metrics for the week — reads from local SQLite DB (no live Zoho call).
  // Mirrors public/lib/dashboard-shared.js OPS_GROUPS_DEFAULT — the
  // browser file is the canonical source of truth, but server.js can't
  // import from it. When updating either, mirror the change here.
  // v1.10.9: added 'Tanda IT Agents' (new mining site).
  const OPS_GROUPS_DEFAULT = [
    'Abidjan IT Agents','Exploration BF Support',
    'Exploration CI Support','Exploration IT Support','Hounde IT Agents','ITY IT Agents',
    'Kalana IT Agents','Lafigue IT Agents','Mana IT Agent','Ouaga IT Agents','Sabodala IT Agents',
    'Tanda IT Agents'
  ];
  router.get('/api/reports/helpdesk-live', requireReportSession, async (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end date required (YYYY-MM-DD)' });
    try {
      // Use shared Zoho rows — live data, same field names as Zoho Analytics
      const allRows   = await getRawRequestRows();
      const startDate = new Date(start + 'T00:00:00.000Z');
      const endDate   = new Date(end   + 'T23:59:59.999Z');
      const CLOSED_STATUS = new Set(['closed','resolved','confirmed resolution','confirm resolution']);
      const groupMap = {};
      allRows.forEach(r => {
        const group = (r['Group'] || '').trim();
        if (!group || group === '-No Value-' || group === 'No Value') return;
        const created = parseZohoStr(r['Created Time']);
        if (!created || created < startDate || created > endDate) return;
        if (!groupMap[group]) groupMap[group] = { group, inbound:0, closed:0, ttaSum:0, ttaN:0, frSum:0, frN:0, rtSum:0, rtN:0 };
        const g = groupMap[group];
        g.inbound++;
        if (CLOSED_STATUS.has((r['Request Status']||'').toLowerCase().trim())) g.closed++;
        // Time to Assign: Assigned Time − Created Time — NO upper cutoff (AP-aligned)
        const assigned = parseZohoStr(r['Assigned Time']);
        if (assigned && created) {
          const tta = (assigned - created) / 3_600_000;
          if (tta >= 0) { g.ttaSum += tta; g.ttaN++; }
        }
        // Time to First Response: Responded Time − Created Time — NO upper cutoff (AP-aligned)
        const responded = parseZohoStr(r['Responded Time']);
        if (responded && created) {
          const fr = (responded - created) / 3_600_000;
          if (fr > 0) { g.frSum += fr; g.frN++; }
        }
        // Resolution time: Time Elapsed field (milliseconds string) → days
        const te = parseInt(r['Time Elapsed'] || '0', 10);
        if (te > 0) {
          const rt = te / 86_400_000;
          if (rt < 365) { g.rtSum += rt; g.rtN++; }
        }
      });
      const result = Object.values(groupMap)
        .map(g => ({
          group:       g.group,
          is_ops:      OPS_GROUPS_DEFAULT.includes(g.group),
          inbound:     g.inbound,
          closed:      g.closed,
          avg_tta_hrs: g.ttaN > 0 ? Math.round(g.ttaSum / g.ttaN * 10) / 10 : null,
          avg_fr_hrs:  g.frN  > 0 ? Math.round(g.frSum  / g.frN  * 10) / 10 : null,
          avg_rt_days: g.rtN  > 0 ? Math.round(g.rtSum  / g.rtN  * 10) / 10 : null,
        }))
        .sort((a, b) => (a.is_ops !== b.is_ops) ? (a.is_ops ? -1 : 1) : b.inbound - a.inbound);
      // Lot 4a: a coordinator only gets their own site's groups.
      const own = await _userSiteGroups(req.reportUser);
      const visible = own ? result.filter(g => own.includes(String(g.group || '').trim().toLowerCase())) : result;
      res.json({ ops_groups: OPS_GROUPS_DEFAULT, groups: visible, fetched_at: new Date().toISOString() });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/helpdesk-charts?group=NAME[,NAME2,...]&end_date=YYYY-MM-DD
  // Returns 5 weeks of chart data — group can be a comma-separated list (e.g. Exploration).
  // Week boundaries are always Zoho Sun 00:00:00 → Sat 23:59:59 (mirrors AP Analytics Plus).
  router.get('/api/reports/helpdesk-charts', requireReportSession, async (req, res) => {
    const { group, end_date } = req.query;
    if (!group || !end_date) return res.status(400).json({ error: 'group and end_date required' });
    try {
      // Support multi-group: comma-separated list → array of group names
      const groupList = group.split(',').map(g => g.trim()).filter(Boolean);
      // Lot 4a: a coordinator may only chart their own site's groups.
      const own = await _userSiteGroups(req.reportUser);
      if (own && !groupList.every(g => own.includes(g.toLowerCase())))
        return res.status(403).json({ error: 'Access denied: these helpdesk groups belong to another site' });

      // Use shared Zoho rows — live, correct field names, no remapping needed
      const allRows = await getRawRequestRows();

      // Zoho week helpers (Sun-start, W01 = first Sunday of year — mirrors AP Analytics Plus)
      const zFirstSun = yr => {
        const d = new Date(yr, 0, 1);
        d.setDate(1 + (d.getDay() === 0 ? 0 : 7 - d.getDay()));
        return d;
      };
      const zohoWeek = d => {
        const t = new Date(d); t.setHours(0,0,0,0);
        let yr = t.getFullYear();
        let fs = zFirstSun(yr);
        if (t < fs) { yr--; fs = zFirstSun(yr); }
        return { yr, wk: Math.floor((t - fs) / (7 * 86400000)) + 1 };
      };
      // Get the Sunday (Zoho week start) for the week containing a given date
      const zohoWeekSunday = d => {
        const t = new Date(d); t.setHours(0,0,0,0);
        t.setDate(t.getDate() - t.getDay()); // back to Sunday (getDay()==0 stays, others retreat)
        return t;
      };
      // ── AP-aligned helpers (mirrors index.html exactly) ──────────────────────
      const _HCM = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
      // Full timestamp parser — handles "DD Mon YYYY, H:MM:SS AM/PM" AND ISO strings
      const parseZohoDT = str => {
        if (!str || !str.trim()) return null;
        const s = String(str).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const d = new Date(s); return isNaN(d) ? null : d; }
        const p = s.split(/[\s,]+/);
        if (p.length < 3) return null;
        const day = parseInt(p[0]), m = _HCM[p[1]], y = parseInt(p[2]);
        if (isNaN(day) || m === undefined || isNaN(y)) return null;
        const tp = (p[3]||'').split(':').map(Number);
        let h = tp[0]||0; const mi = tp[1]||0, sc = tp[2]||0;
        const suf = (p[4]||'').toUpperCase();
        if (suf === 'PM' && h < 12) h += 12; else if (suf === 'AM' && h === 12) h = 0;
        return new Date(y, m, day, h, mi, sc);
      };
      // isClosed: AP-aligned — uses Request Pending Status (matches AP countif formula)
      const isClosed = r => { const ps=(r['Request Pending Status']||'yes').toLowerCase().trim(); return ps==='no'||ps==='0'||ps==='false'; };
      // isResOverdue: SLA violation check aligned with Zoho AP formula.
      // Primary: Due By Time vs Resolved Time timestamps (closed tickets, when both fields present).
      // Fallback/open tickets: Overdue Status field — Zoho AP stores "1"=violated, "0"=within SLA.
      const isResOverdue = r => {
        const s = (r['Request Status']||'').toLowerCase().trim();
        if (s === 'cancelled') return false;
        const due = parseZohoDT(r['Due By Time']);
        const res = parseZohoDT(r['Resolved Time']||r['Completed Time']);
        const isRes = s==='closed'||s==='resolved'||s==='confirmed resolution'||s==='confirm resolution';
        if (due && res && isRes) return res > due;
        const ov = (r['Overdue Status']||'').toString().trim();
        return ov==='1'||ov.toLowerCase()==='yes'||ov.toLowerCase()==='true';
      };

      // Filter to the requested group(s) — supports multi-group (e.g. Exploration)
      const grpSet = new Set(groupList);
      const grpRows = allRows.filter(r => grpSet.has((r['Group']||'').trim()));

      // Build 5 Zoho weeks (Sun 00:00:00 → Sat 23:59:59) ending at the week containing end_date
      const baseSun = zohoWeekSunday(new Date(end_date)); // Sunday of the report Zoho week
      const weeks = [];
      for (let i = 4; i >= 0; i--) {
        const wSun = new Date(baseSun); wSun.setDate(baseSun.getDate() - i * 7); wSun.setHours(0,0,0,0);
        const wSat = new Date(wSun);  wSat.setDate(wSun.getDate() + 6);         wSat.setHours(23,59,59,999);
        const { yr, wk } = zohoWeek(wSun);
        weeks.push({ label: `W${String(wk).padStart(2,'0')} ${yr}`, start: wSun, end: wSat });
      }

      const weekData = weeks.map(wk => {
        const wr = grpRows.filter(r => { const d=parseZohoDT(r['Created Time']); return d && d>=wk.start && d<=wk.end; });
        const inbound = wr.length;
        // isClosed: AP-aligned — Request Pending Status = No (same as index.html)
        const closed  = wr.filter(r => isClosed(r)).length;
        // 2026-06-02 ITSM-alignment (FORMULA_RECONCILIATION.md §6 D2/D3):
        // Track closed-with-verdict + responded subsets so the SLA / FRT
        // percentages below use verdict-only denominators instead of `inbound`.
        // The legacy `slaV` and `frV` raw counts are kept (counts, not %).
        const slaV         = wr.filter(r => isResOverdue(r)).length;
        const slaVClosed   = wr.filter(r => isResOverdue(r) && isClosed(r)).length;
        const frV          = wr.filter(r => { const f=(r['First Response Overdue Status']||'').toLowerCase(); return f==='true'||f==='1'||f==='yes'; }).length;
        const respondedRows= wr.filter(r => { const rt = r['Responded Time']; return rt != null && String(rt).trim() !== ''; });
        const respondedN   = respondedRows.length;
        const frVResponded = respondedRows.filter(r => { const f=(r['First Response Overdue Status']||'').toLowerCase(); return f==='true'||f==='1'||f==='yes'; }).length;
        // Per-tech counts + timing averages — all AP-aligned (mirrors pStats in index.html)
        const techCounts = {};
        let frSum=0, frN=0, ttaSum=0, ttaN=0, rtSum=0, rtN=0, cdSum=0, cdN=0, onHoldCnt=0;
        wr.forEach(r => {
          const t = (r['Technician']||r['Assigned To']||'').trim();
          if (t && t !== '-No Value-' && t !== 'Unassigned') techCounts[t] = (techCounts[t]||0) + 1;
          // FR: Zoho pre-computed field, >0, no upper cutoff, Math.floor avg (AP-aligned)
          const fr = parseFloat(r['Time to Respond in Hrs']);
          if (!isNaN(fr) && fr > 0) { frSum += fr; frN++; }
          // On-hold count
          if ((r['Request Status']||'').toLowerCase().trim() === 'on hold') onHoldCnt++;
          // All timestamp-based metrics — same as pStats in index.html
          const ct = parseZohoDT(r['Created Time']);
          if (ct) {
            // TTA: floor per ticket, include >=0, Math.round avg
            const at = parseZohoDT(r['Assigned Time']);
            if (at) { const hf=(at-ct)/3600000; if(hf>=0){ttaSum+=Math.floor(hf);ttaN++;} }
            // Resolution: Resolved Time − Created Time, floor per ticket, Math.round avg
            const res = parseZohoDT(r['Resolved Time']);
            if (res) { const df=(res-ct)/86400000; if(df>=0&&df<365){rtSum+=Math.floor(df);rtN++;} }
            // Closing: Completed Time − Created Time, floor per ticket, Math.round avg
            const comp = parseZohoDT(r['Completed Time']);
            if (comp) { const df=(comp-ct)/86400000; if(df>=0&&df<365){cdSum+=Math.floor(df);cdN++;} }
          }
        });
        const techs = Object.keys(techCounts).sort();
        return {
          label: wk.label,
          start: wk.start.toISOString().slice(0,10),
          end:   wk.end.toISOString().slice(0,10),
          inbound, closed,
          // 2026-06-02 ITSM-aligned (FORMULA_RECONCILIATION.md §6):
          //   res_*_pct uses closed-only denominator (D2) — open-not-yet-due
          //     no longer counted as compliant
          //   fr_*_pct uses responded-only denominator (D3) — unresponded
          //     fresh tickets no longer dilute the ratio
          // res_missed_pct and fr_missed_pct are kept as VIOLATION % matching
          // the slideHelpdeskMetrics1 / public/reports.html consumer expectation.
          res_missed_pct: closed     > 0 ? Math.round(slaVClosed   / closed     * 1000) / 10 : 0,
          fr_missed_pct:  respondedN > 0 ? Math.round(frVResponded / respondedN * 1000) / 10 : 0,
          res_ok_pct:     closed     > 0 ? Math.round((1 - slaVClosed   / closed)     * 1000) / 10 : null,
          fr_ok_pct:      respondedN > 0 ? Math.round((1 - frVResponded / respondedN) * 1000) / 10 : null,
          avg_tta_hrs:  ttaN > 0 ? Math.round(ttaSum/ttaN) : null,   // Math.round, integer hrs
          avg_fr_hrs:   frN  > 0 ? Math.floor(frSum/frN)  : null,   // Math.floor, integer hrs (AP-aligned)
          avg_rt_days:  rtN  > 0 ? Math.round(rtSum/rtN)  : null,   // timestamp-based, Math.round, integer days
          avg_cd_days:  cdN  > 0 ? Math.round(cdSum/cdN)  : null,   // timestamp-based, Math.round, integer days
          on_hold:      onHoldCnt,
          techs,
          tech_counts: techCounts
        };
      });

      // Ageing: open tickets only, bucketed by days since Created Time.
      // Dual-check mirrors index.html renderAgeing(): old tickets may have Request Pending Status
      // empty (defaults to open) but Request Status = 'Closed'/'Resolved' — must exclude those too.
      const _CLOSED_STS = new Set(['closed','resolved','confirmed resolution','confirm resolution','cancelled']);
      const today = new Date(); today.setHours(23,59,59,999);
      const openRows = grpRows.filter(r => {
        if (isClosed(r)) return false;
        const rs = (r['Request Status']||'').toLowerCase().trim();
        if (_CLOSED_STS.has(rs)) return false;
        return true;
      });
      const ageing = [0,0,0,0,0];
      openRows.forEach(r => {
        const d = parseZohoDT(r['Created Time']); if (!d) return;
        const days = Math.floor((today - d) / 86400000);
        if (days<=7) ageing[0]++; else if (days<=14) ageing[1]++; else if (days<=30) ageing[2]++; else if (days<=60) ageing[3]++; else ageing[4]++;
      });

      // Top 10 SLA violations by category — report week only (last of the 5 weeks)
      const reportWk     = weeks[weeks.length - 1];
      const reportWkRows = grpRows.filter(r => {
        const d = parseZohoDT(r['Created Time']);
        return d && d >= reportWk.start && d <= reportWk.end;
      });
      const catMap = {};
      reportWkRows.forEach(r => {
        const cat = (r['Category']||r['Sub Category']||'Unknown').trim();
        if (!cat || cat==='-No Value-') return;
        if (!catMap[cat]) catMap[cat] = { total:0, violated:0 };
        catMap[cat].total++;
        if (isResOverdue(r)) catMap[cat].violated++;  // AP-aligned timestamp-based check
      });
      const top10 = Object.entries(catMap)
        .filter(([,v]) => v.violated > 0)
        .sort((a,b) => b[1].violated - a[1].violated)
        .slice(0,10)
        .map(([cat,v]) => ({ category: cat, violations: v.violated, total: v.total, pct: Math.round(v.violated/v.total*100) }));

      // group = display label (first group or all joined); groups = full list for multi-group sites
      const groupLabel = groupList.length === 1 ? groupList[0] : groupList.join(', ');
      res.json({ group: groupLabel, groups: groupList, weeks: weekData, ageing, ageing_total: openRows.length, top10, fetched_at: new Date().toISOString() });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/technicians — unique technician names from live Zoho data
  router.get('/api/reports/technicians', requireReportSession, async (req, res) => {
    try {
      const allRows = await getRawRequestRows();
      const techs = [...new Set(
        allRows
          .map(r => (r['Technician'] || '').trim())
          .filter(t => t && t !== '-No Value-' && t !== 'No Value')
      )].sort();
      res.json({ technicians: techs });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── System Logs (v1) — super_admin only. Registered ABOVE /api/reports/:id so
  //    'system-log' is not swallowed by the :id param route. Gate = the verbatim
  //    check from DELETE /api/reports/sessions/:token.
  function _syslogGate(req, res, next) {
    if (!rdb.userHasRole(req.reportUser, 'super_admin')) return res.status(403).json({ error: 'super_admin only' });
    next();
  }
  function _syslogFilters(req) {
    return { actor:req.query.actor, category:req.query.category, action:req.query.action,
             risk: req.query.risk === '1' ? 1 : undefined, from:req.query.from, to:req.query.to, q:req.query.q };
  }
  router.get('/api/reports/system-log', requireReportSession, _syslogGate, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 500), offset = parseInt(req.query.offset) || 0;
      res.json(await rdb.listSystemLog(_syslogFilters(req), { limit, offset }));
    } catch (e) { res.status(500).json({ error: IS_DEV ? e.message : 'system-log error' }); }
  });
  router.get('/api/reports/system-log/analytics', requireReportSession, _syslogGate, async (req, res) => {
    try { res.json(await rdb.getSystemLogAnalytics({ window: req.query.window || '30d' })); }
    catch (e) { res.status(500).json({ error: IS_DEV ? e.message : 'system-log analytics error' }); }
  });
  router.get('/api/reports/system-log/export.json', requireReportSession, _syslogGate, async (req, res) => {
    try {
      const { rows } = await rdb.listSystemLog(_syslogFilters(req), { limit: 100000, offset: 0 });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="system-log.json"');
      res.send(JSON.stringify(rows));
    } catch (e) { res.status(500).json({ error: 'export error' }); }
  });
  router.get('/api/reports/system-log/export.csv', requireReportSession, _syslogGate, async (req, res) => {
    try {
      const { rows } = await rdb.listSystemLog(_syslogFilters(req), { limit: 100000, offset: 0 });
      const COLS = ['ts','category','action','actor','actor_id','target','ip','risk','details'];
      const esc = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const csv = '﻿' + [COLS.join(','), ...rows.map(r => COLS.map(c => esc(r[c])).join(','))].join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="system-log.csv"');
      res.send(csv);
    } catch (e) { res.status(500).json({ error: 'export error' }); }
  });

  // GET /api/reports/:id  — full report with all sections
  router.get('/api/reports/:id', requireReportSession, async (req, res) => {
    try {
      const report = await rdb.getReport(parseInt(req.params.id));
      if (!report) return res.status(404).json({ error: 'Report not found' });
      // Site scope: enforced by the central report-read guard (lot 4a).
      res.json(report);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/:id/open-changes  — live open changes for the report's site
  router.get('/api/reports/:id/open-changes', requireReportSession, async (req, res) => {
    try {
      const report = await rdb.getReport(parseInt(req.params.id));
      if (!report) return res.status(404).json({ error: 'Report not found' });
      const site = (await rdb.listSites()).find(s => s.id === report.site_id);
      const groups = site ? (site.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean) : [];
      res.json(await rdb.getOpenChangesForSite(groups));
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/sites/:siteId/open-changes  — live open changes by site ID (used by monthly editor)
  router.get('/api/sites/:siteId/open-changes', requireReportSession, async (req, res) => {
    try {
      const site = (await rdb.listSites()).find(s => s.id === parseInt(req.params.siteId));
      if (!site) return res.status(404).json({ error: 'Site not found' });
      const groups = (site.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
      res.json(await rdb.getOpenChangesForSite(groups));
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/:id/active-incidents — Major Incidents still OPEN for
  // the report's site, with UDF completeness flags (RCA/CA/LL/PIR) so the
  // weekly report editor can show a "what's still on fire here" panel
  // next to the Active Changes one. Mirrors /open-changes auth + scope.
  router.get('/api/reports/:id/active-incidents', requireReportSession, async (req, res) => {
    try {
      const report = await rdb.getReport(parseInt(req.params.id));
      if (!report) return res.status(404).json({ error: 'Report not found' });
      const site = (await rdb.listSites()).find(s => s.id === report.site_id);
      const groups = site ? (site.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean) : [];
      res.json(await rdb.getActiveMajorIncidentsForSite(groups));
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/:id/infra-auto — V1b-C. Pre-fill values for the Infrastructure KPIs
  // Current Value cells, from the OPManager/Meraki snapshots for THIS report's site + Zoho
  // week. Best-effort: unconfigured / no snapshot → { fills: [] }, never 500. The client fills
  // only EMPTY cells (editor override) — nothing is persisted here; no infra_kpis change.
  router.get('/api/reports/:id/infra-auto', requireReportSession, async (req, res) => {
    try {
      const report = await rdb.getReport(parseInt(req.params.id));
      if (!report) return res.status(404).json({ error: 'Report not found', fills: [] });
      const { buildFills } = require('../services/opmReportFill');
      const cfg = await reportConfig.getConfig(rdb.db);
      const staleDays = parseInt(cfg.opm_stale_days, 10) || 9;
      const start = report.start_date;                       // Zoho Sunday = weeks.start_date
      const wan = await rdb.getWanSnapshots({ site_id: report.site_id, period_type: 'week', period_start: start });
      const infra = await rdb.getInfraSnapshots({ site_id: report.site_id, period_type: 'week', period_start: start });

      // The report cell covers the report's OWN week (fixed & reproducible — an archived weekly
      // report must NOT drift with a rolling "as of today" window). Expose it so the editor can
      // cross-check Meraki WITHOUT Custom: Meraki "Past Week" opened the day AFTER this week ends
      // is the same period (Zoho weeks are Sun→Sat; Meraki's presets end yesterday).
      let winFrom = null, winTo = null;
      for (const u of wan) {
        const ps = u.period_start || null, pe = u.period_end || u.period_start || null;
        if (ps && (!winFrom || ps < winFrom)) winFrom = ps;
        if (pe && (!winTo || pe > winTo)) winTo = pe;
      }
      const window = (winFrom && winTo)
        ? { from: winFrom, to: winTo, days: Math.round((Date.parse(winTo) - Date.parse(winFrom)) / 86400000) + 1 }
        : null;

      // WAN availability in the report cell = the snapshot's CALIBRATED "% Time Up" (loss >= 5 % per
      // sample = down, calibrated against Meraki on 2026-09-04) — the SAME primary figure the WAN
      // Health dashboard shows, so the cell and the dashboard never disagree (audit 2026-09-05 F9,
      // decision 2026-09-06). The poller's EVENT-based figure (total-outage minutes, the SLA
      // instrument) rides along as the secondary `event_pct` when the poller has run — never as
      // the cell value. An earlier version overwrote the cell with the event figure (or left it
      // blank before the poller's first run); that made the report disagree with the dashboard.
      for (const u of wan) { u.avail_event_pct = null; if (u.availability_pct != null) u.basis = 'timeup'; }
      if (wan.length && cfg.wan_poll_last_run) {
        let wanTarget = 98; try { const t = JSON.parse(cfg.opm_targets || '{}'); if (t && t.wan != null) wanTarget = Number(t.wan); } catch (_) {}
        let minFrom = null, maxTo = null;
        for (const u of wan) {
          const f = (u.period_start || '') + 'T00:00:00Z'; if (u.period_start && (!minFrom || f < minFrom)) minFrom = f;
          const end = u.period_end || u.period_start; const tt = (end || '') + 'T23:59:59Z'; if (end && (!maxTo || tt > maxTo)) maxTo = tt;
        }
        let outages = [];
        if (minFrom && maxTo) { try { outages = (await rdb.getWanOutagesOverlapping(minFrom, maxTo)) || []; } catch (_) { outages = []; } }
        const wanFirstRunMs = cfg.wan_poll_first_run ? Date.parse(cfg.wan_poll_first_run) : null;
        // Compute the event figure on CLONES so the snapshot's primary %/colour/trend stay untouched.
        const clones = wan.map(u => ({ ...u }));
        require('../services/wanEventAvailability').applyEventAvailability(clones, outages, {
          target: wanTarget, minFromMs: (wanFirstRunMs && Number.isFinite(wanFirstRunMs)) ? wanFirstRunMs : undefined });
        clones.forEach((c, i) => { wan[i].avail_event_pct = (c.availability_pct == null) ? null : c.availability_pct; });
      }

      const fills = buildFills({ wan, infra, staleDays, nowMs: Date.now() });
      // Per-site sub-site tokens (Exploration) — for the client to token-gate its line
      // matching. Row-driven; NOT passed into buildFills (buildFills is snapshot-driven).
      const tokens = ((await rdb.listWanSubsiteNetworks()) || [])
        .filter(r => r.site_id === report.site_id).map(r => r.sub_site);
      res.json({ week_label: report.week_label, period_start: start, window, fills, tokens });
    } catch (e) { res.json({ fills: [], reason: e.message }); }
  });

  // GET /api/sites/:siteId/active-incidents — same payload, looked up by
  // site id. Used by the monthly editor (which doesn't have a report id
  // at hand) and by any future "site dashboard" that wants the panel.
  router.get('/api/sites/:siteId/active-incidents', requireReportSession, async (req, res) => {
    try {
      const site = (await rdb.listSites()).find(s => s.id === parseInt(req.params.siteId));
      if (!site) return res.status(404).json({ error: 'Site not found' });
      const groups = (site.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
      res.json(await rdb.getActiveMajorIncidentsForSite(groups));
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/reports/:id  — delete a draft (or any report for admin)
  router.delete('/api/reports/:id', requireReportSession, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const report = await rdb.getReport(id);
      if (!report) return res.status(404).json({ error: 'Report not found' });
      const isPrivileged = rdb.userHasRole(req.reportUser, 'admin');
      if (!isPrivileged) {
        // F5: a site-less profile is NOT global — deny unless the site matches.
        if (!rdb.userHasRole(req.reportUser, 'editor') || !userSites.hasSite(req.reportUser, report.site_id))
          return res.status(403).json({ error: 'Access denied' });
        if (report.status === 'submitted')
          return res.status(403).json({ error: 'Cannot delete a submitted report — ask a super_admin to revert first' });
      }
      await rdb.logAudit({ report_id: id, site_id: report.site_id, user_id: req.reportUser.id, username: req.reportUser.username, action: 'deleted', details: { week_label: report.week_label } });
      await rdb.deleteReport(id);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/reports/:id/infra  — save infrastructure KPIs
  router.put('/api/reports/:id/infra', requireReportSession, jsonBody, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!(await _authorizeReportWrite(req, res, id))) return;   // F5: role + site + submitted-state
      const kpis = Array.isArray(req.body) ? req.body : [];
      await rdb.saveInfraKpis(id, kpis);
      await rdb.touchReport(id);
      const r = await rdb.getReport(id);
      await rdb.logAudit({ report_id: id, site_id: r?.site_id, user_id: req.reportUser.id, username: req.reportUser.username, action: 'edited_infra', details: { week_label: r?.week_label, kpi_count: kpis.length } });
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/reports/:id/helpdesk  — save helpdesk metrics
  router.put('/api/reports/:id/helpdesk', requireReportSession, jsonBody, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!(await _authorizeReportWrite(req, res, id))) return;   // F5
      await rdb.saveHelpdeskData(id, req.body || {});
      await rdb.touchReport(id);
      const r = await rdb.getReport(id);
      await rdb.logAudit({ report_id: id, site_id: r?.site_id, user_id: req.reportUser.id, username: req.reportUser.username, action: 'edited_helpdesk', details: { week_label: r?.week_label } });
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/reports/:id/lights  — save low/high lights
  router.put('/api/reports/:id/lights', requireReportSession, jsonBody, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!(await _authorizeReportWrite(req, res, id))) return;   // F5
      const lights = Array.isArray(req.body) ? req.body : [];
      await rdb.saveLights(id, lights);
      await rdb.touchReport(id);
      const r = await rdb.getReport(id);
      await rdb.logAudit({ report_id: id, site_id: r?.site_id, user_id: req.reportUser.id, username: req.reportUser.username, action: 'edited_lights', details: { week_label: r?.week_label, count: lights.length } });
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Shared validator used by both PUT /actions (weekly) and POST /monthly/.../edits.
  // Returns { errors: [{row, reason}], cleaned: [...] }.
  // Validates: required non-empty task, required active department, optional but valid
  // priority/status enums, ISO date format, and truncates oversized comments.
  // Spec §9.1-9.2 — defense-in-depth: client also blocks malformed data, but every
  // write path goes through this guard.
  const ACTION_VALID_PRIORITY = new Set(['High', 'Medium', 'Low']);
  const ACTION_VALID_STATUS   = new Set(['open', 'in_progress', 'on_hold', 'closed', 'cancelled']);

  async function validateActionItems(items) {
    const activeDepts = new Set((await rdb.listDepartments({ includeInactive: false })).map(d => d.name));  // sweep adds await
    const errors = [];
    const cleaned = items.map((a, i) => {
      const out = { ...a };
      if (!out.task || !String(out.task).trim()) {
        errors.push({ row: i, reason: 'empty task' });
      }
      if (!out.department || !activeDepts.has(out.department)) {
        errors.push({ row: i, reason: `unknown or missing department: '${out.department || ''}'` });
      }
      if (out.priority && !ACTION_VALID_PRIORITY.has(out.priority)) {
        errors.push({ row: i, reason: `invalid priority '${out.priority}'` });
      }
      if (out.status && !ACTION_VALID_STATUS.has(out.status)) {
        errors.push({ row: i, reason: `invalid status '${out.status}'` });
      }
      if (out.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(out.due_date)) {
        errors.push({ row: i, reason: `due_date must be YYYY-MM-DD, got '${out.due_date}'` });
      }
      if (out.comment && String(out.comment).length > 2000) {
        out.comment = String(out.comment).slice(0, 2000);
      }
      return out;
    });
    return { errors, cleaned };
  }

  // PUT /api/reports/:id/actions  — save weekly action items
  router.put('/api/reports/:id/actions', requireReportSession, jsonBody, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!(await _authorizeReportWrite(req, res, id))) return;   // F5
      const items = Array.isArray(req.body) ? req.body : [];

      const { errors, cleaned } = await validateActionItems(items);
      if (errors.length) {
        return res.status(400).json({ error: 'validation', details: errors });
      }
      // 2026-10-16: an action ENTERING "cancelled" needs a justification in its comment (the page
      // asks for it and writes it there); rows already cancelled re-save untouched.
      {
        const prevRep = await rdb.getReport(id);
        const before = new Map(((prevRep && prevRep.action_items) || []).map(a => [a.uid, a.status]));
        const bad = cleaned.find(a => a.status === 'cancelled' && before.get(a.uid) !== 'cancelled' && !String(a.comment || '').trim());
        if (bad) return res.status(400).json({ error: `Action "${String(bad.task || '').slice(0, 60)}": a justification comment is required to cancel it.` });
      }

      await rdb.saveActionItems(id, cleaned);
      await rdb.touchReport(id);
      const r = await rdb.getReport(id);
      await rdb.logAudit({ report_id: id, site_id: r?.site_id, user_id: req.reportUser.id, username: req.reportUser.username, action: 'edited_actions', details: { week_label: r?.week_label, count: items.length } });
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/reports/:id/status  — submit / revert to draft
  router.put('/api/reports/:id/status', requireReportSession, jsonBody, async (req, res) => {
    try {
      const id     = parseInt(req.params.id);
      const status = req.body?.status;
      if (!['draft','in_progress','ready','submitted'].includes(status))
        return res.status(400).json({ error: 'status must be draft, in_progress, ready, or submitted' });

      // F5: editor role + site scope (a site-less profile is not global); the submitted
      // gate: submit and revert are both allowed to whoever passes it (decision 2026-10-02).
      const report = await _authorizeReportWrite(req, res, id, { allowSubmitted: true });
      if (!report) return;
      // Reverting a submitted report to draft (user decisions 2026-10-02): was super_admin-
      // only; now any editor of the REPORT'S site, the admin tier anywhere. That is exactly
      // what _authorizeReportWrite above already enforces (editor role + the report's site,
      // a site-less profile is not global), so no extra role check here.

      // Asset engagement: freeze the Parc informatique counts at the FIRST submission
      // (a re-submit never re-freezes). Never blocks: empty notes are allowed and an
      // assets failure stores counts=null. The notes are never touched here.
      if (status === 'submitted' && report.status !== 'submitted') {
        try {
          const a = await _computeAssetReview(report);
          await rdb.saveReportAssetReview(id, { applicable: a.applicable, counts: a.counts }, req.reportUser.username);
        } catch (e) {
          console.error('[api/reports/status] asset review freeze failed:', e.message);
          try { await rdb.saveReportAssetReview(id, { counts: null }, req.reportUser.username); } catch (_) { /* never block the submission */ }
        }
      }

      await rdb.updateReportStatus(id, status, req.reportUser.id);
      // Audit
      const action = status === 'submitted' ? 'submitted' : (report.status === 'submitted' ? 'reverted' : 'status_changed');
      await rdb.logAudit({ report_id: id, site_id: report.site_id, user_id: req.reportUser.id, username: req.reportUser.username, action, details: { from: report.status, to: status } });
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/reports/:id/reassign-week  — move report to a different week (any status)
  // Body: { year: <number>, week: <number> }
  // Blocks if another report already exists for the same (site, new week).
  router.put('/api/reports/:id/reassign-week', requireReportSession, jsonBody, async (req, res) => {
    try {
      const id   = parseInt(req.params.id);
      const year = parseInt(req.body?.year);
      const week = parseInt(req.body?.week);
      if (!year || !week || isNaN(year) || isNaN(week))
        return res.status(400).json({ error: 'year and week are required' });
      if (week < 1 || week > 53)
        return res.status(400).json({ error: 'week must be between 1 and 53' });

      // F5: editor role + site scope (site-less ≠ global); any status by design (allowSubmitted).
      const existing = await _authorizeReportWrite(req, res, id, { allowSubmitted: true });
      if (!existing) return;

      // Ensure the target week row exists in the weeks table (creates it if new)
      const newWeekId = await rdb.ensureWeek(year, week);

      // Conflict-check + reassign via the forked helper (no await here — the Task 2 sweep adds it).
      const { duplicateReportId } = await rdb.reassignReportWeek({ reportId: id, siteId: existing.site_id, newWeekId });
      if (duplicateReportId) {
        const dup = await rdb.getReport(duplicateReportId);
        return res.status(409).json({
          error: `A ${dup.week_label} report already exists for ${existing.site_name}. Delete it first, then try again.`
        });
      }
      const reassigned = await rdb.getReport(id);
      await rdb.logAudit({ report_id: id, site_id: existing.site_id, user_id: req.reportUser.id, username: req.reportUser.username, action: 'reassigned_week', details: { from_week: existing.week_label, to_week: reassigned?.week_label } });
      res.json(reassigned);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  router.helpers = { assetReviewForPptx: _assetReviewForPptx, validateActionItems };
  return router;
};
