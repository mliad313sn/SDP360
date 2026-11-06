'use strict';
// ─────────────────────────────────────────────────────────────────────────
// Activity Tracker routes — extracted from server.js (E-A01b, expert audit 2026-11-05).
// /api/tracker/{load,save,import-dept-meetings,export,reset,delete-year}: same paths, same
// middleware chains, same answers (`app.` → `router.`). One change, a defect fix (X-Q-01):
// POST /delete-year is snapshotted by tracker-db (blob, backup_path) and journalled in system_log.
// The 5 MB /api/tracker/save body parser stays in server.js (registered before the global parser).
// ─────────────────────────────────────────────────────────────────────────
module.exports = function trackerRoutes(deps) {
  const { express, requireReportSession, requireRole, jsonBody, fail, userSites } = deps;
  const rdb = new Proxy({}, { get: (_t, k) => deps.getRdb()[k] });
  const router = express.Router();

  // ══════════════════════════════════════════════════════════════════
  // IT ACTIVITY TRACKER — SQLite persistence API
  // ══════════════════════════════════════════════════════════════════
  let trackerDb;
  try {
    trackerDb = require('../tracker-db.js');
    console.log('[Tracker] ✅ tracker-db loaded');
  } catch(e) {
    console.error('[Tracker] ❌ tracker-db failed to load:', e.message);
  }

  let trackerPptx;
  try {
    trackerPptx = require('../tracker-pptx.js');
    console.log('[Tracker] ✅ tracker-pptx loaded');
  } catch(e) {
    console.error('[Tracker] ❌ tracker-pptx failed to load:', e.message);
  }

  // Multi-site editors: every tracker code the user may edit, primary first (null = all sites).
  async function _trackerScopesFor(user) {
    if (rdb.userHasRole(user, 'super_admin') || rdb.userHasRole(user, 'tracker-admin')) return null;
    if (!rdb.userHasRole(user, 'tracker-editor')) return null;
    return userSites.codesFor(user, (await rdb.listSites()) || [], (s) => trackerDb.siteToCode(s));
  }
  router.get('/api/tracker/load', requireReportSession, requireRole(['admin', 'tracker-admin', 'tracker-editor']), async (req, res) => {
    try {
      if (!trackerDb) return res.status(503).json({ error: 'Tracker module not available' });
      const D = await trackerDb.loadTracker();
      // '' = a tracker-editor whose site resolves to nothing: read-only (the save refuses it).
      const scopes = await _trackerScopesFor(req.reportUser);
      res.json({ D, scope: scopes === null ? null : (scopes[0] || ''), scopes });
    } catch(e) {
      console.error('[Tracker] load error:', e.message);
      fail(res, e);
    }
  });

  // POST /api/tracker/save — persist D from frontend to SQLite
  // Strict orthogonal role model (no legacy hierarchy grant):
  //   super_admin / tracker-admin → can save full D (config + all sites)
  //   tracker-editor              → can save inputs scoped to OWN site only
  //   admin / executive (without an explicit tracker-* feature role) → REJECTED
  router.post('/api/tracker/save', requireReportSession, requireRole(['super_admin', 'tracker-admin', 'tracker-editor']), async (req, res) => {
    try {
      if (!trackerDb) return res.status(503).json({ error: 'Tracker module not available' });
      const { D } = req.body || {};
      if (!D) return res.status(400).json({ error: 'Missing D in request body' });

      // super_admin / tracker-admin → unrestricted save (all sites + config)
      const isUnrestricted = rdb.userHasRole(req.reportUser, 'super_admin') || rdb.userHasRole(req.reportUser, 'tracker-admin');

      let userSite = null;
      if (!isUnrestricted) {
        // tracker-editor → inputs of their site(s) only (multi-site editors: a list of codes)
        const codes = (await _trackerScopesFor(req.reportUser)) || [];
        userSite = codes.length ? codes : null;
        if (!userSite) return res.status(403).json({ error: 'Your account has no site assigned. Contact your administrator.' });
        if (await require('../services/siteCodeShared').refuseIfShared(rdb, res, 'tracker', userSite, (s) => trackerDb.siteToCode(s))) return;   // D-01 (switch, off)
      }

      // Closed months (2026-10-16): below super_admin a past month keeps its stored value.
      const lockClosed = !rdb.userHasRole(req.reportUser, 'super_admin');
      const saved = (await trackerDb.saveTracker(D, userSite, { lockClosed })) || {};
      const blocked = saved.blocked || 0;

      // Audit log — grep-friendly. Same shape as [Inspection] save ok lines.
      // Lets ops trace every persistence event (`pm2 logs … | findstr Tracker`)
      // and spot saves with surprising shapes (huge D, zero years, etc.).
      const user   = req.reportUser || {};
      const yrs    = Array.isArray(D.years) ? D.years.length : 0;
      const sites  = Array.isArray(D.activeSites) ? D.activeSites.length
                    : Array.isArray(D.sites) ? D.sites.length : 0;
      const acts   = Array.isArray(D.activities) ? D.activities.length : 0;
      const bytes  = Buffer.byteLength(JSON.stringify(D || {}), 'utf8');
      const sizeKB = (bytes / 1024).toFixed(1);
      console.log(
        `[Tracker] save ok user=${user.username || '?'} role=${user.role || '?'} ` +
        `scope=${userSite ? userSites.scopeLabel(userSite) : 'all'} years=${yrs} sites=${sites} activities=${acts} size=${sizeKB}KB`
      );

      if (blocked) console.log(`[Tracker] closed-month edits ignored user=${user.username || '?'} cells=${blocked}`);
      res.json({ ok: true, scope: userSite ? userSites.scopeLabel(userSite) : 'all', closed_blocked: blocked });
    } catch(e) {
      console.error('[Tracker] save error:', e.message);
      fail(res, e);
    }
  });

  // POST /api/tracker/import-dept-meetings — Piste 1 (2026-08-05): pull the REAL
  // per-month departmental-meeting (PV) counts from the Meetings module into the
  // tracker's "Monthly Department Meeting" activity for {year, site}. Reversible:
  // writes ONLY that one activity's 12-month input (value stays editable after).
  // Same RBAC as save — a tracker-editor may only import for its OWN site.
  router.post('/api/tracker/import-dept-meetings', requireReportSession, requireRole(['super_admin', 'tracker-admin', 'tracker-editor']), async (req, res) => {
    try {
      if (!trackerDb) return res.status(503).json({ error: 'Tracker module not available' });
      const meetingsDb = require('../meetings-db');
      const { trackerToMeetingsCode, deptMeetingCounts } = require('../services/deptMeetingsTracker');

      const year = parseInt(req.body?.year, 10);
      const site = String(req.body?.site || '').trim().toUpperCase();
      if (!Number.isFinite(year) || !site) return res.status(400).json({ error: 'year and site are required' });

      // tracker-editor is scoped to its own site (mirrors /api/tracker/save).
      const isUnrestricted = rdb.userHasRole(req.reportUser, 'super_admin') || rdb.userHasRole(req.reportUser, 'tracker-admin');
      if (!isUnrestricted) {
        const own = (await _trackerScopesFor(req.reportUser)) || [];
        if (!own.length) return res.status(403).json({ error: 'Your account has no site assigned.' });
        if (!own.includes(site)) return res.status(403).json({ error: `You may only import for your own site (${own.join(', ')}).` });
      }

      const meetingsCode = trackerToMeetingsCode(site);
      if (!meetingsCode) return res.status(400).json({ error: `No Meetings module for site "${site}" — nothing to import.` });

      let { months } = await deptMeetingCounts({ trackerCode: site, year, countFn: (o) => meetingsDb.countMeetings(o) });
      const r = await trackerDb.setActivityMonthsByName(year, site, 'Monthly Department Meeting', months,
        { lockClosed: !rdb.userHasRole(req.reportUser, 'super_admin') });   // closed months keep their stored value
      if (!r || !r.ok) return res.status(404).json({ error: 'Tracker has no "Monthly Department Meeting" activity for this year.' });
      months = r.months;

      console.log(`[Tracker] import-dept-meetings user=${req.reportUser?.username || '?'} site=${site} year=${year} months=${JSON.stringify(months)}`);
      res.json({ ok: true, site, year, meetingsCode, months, total: months.reduce((a, b) => a + (Number(b) || 0), 0), closed_blocked: r.blocked || 0 });
    } catch (e) {
      console.error('[Tracker] import-dept-meetings error:', e.message);
      fail(res, e);
    }
  });

  // POST /api/tracker/export — generate PPTX server-side and return as download
  // Requires executive or super_admin role (same as exec report export)
  // RBAC audit 2026-10-02 (A2): the button shows for tracker-admin; the route now agrees.
  router.post('/api/tracker/export', requireReportSession, requireRole(['admin', 'tracker-admin']), async (req, res) => {
    try {
      if (!trackerDb)   return res.status(503).json({ error: 'Tracker module not available' });
      if (!trackerPptx) return res.status(503).json({ error: 'PPTX module not available' });

      const { sites, yr, mo } = req.body || {};
      if (!sites || !yr || !mo) return res.status(400).json({ error: 'Missing sites, yr or mo' });

      const D   = await trackerDb.loadTracker();
      const buf = await trackerPptx.generateTrackerPptx(D, sites, parseInt(yr), parseInt(mo));

      const MO  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const fn  = 'IT_Ops_Strategy_' + (MO[parseInt(mo) - 1] || 'M' + mo) + yr + '.pptx';

      res.setHeader('Content-Type',        'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', 'attachment; filename="' + fn + '"');
      res.send(buf);
    } catch(e) {
      console.error('[Tracker] export error:', e.message);
      fail(res, e);
    }
  });

  // POST /api/tracker/reset — restore DB to INIT defaults
  // Strict: super_admin or tracker-admin only. Executives without the
  // tracker-admin feature role cannot reset the tracker.
  router.post('/api/tracker/reset', requireReportSession, requireRole(['super_admin', 'tracker-admin']), async (req, res) => {
    try {
      if (!trackerDb) return res.status(503).json({ error: 'Tracker module not available' });
      return res.status(501).json({ error: 'Reset is not supported on the PostgreSQL backend (Chunk 1 scope).' });
    } catch(e) {
      console.error('[Tracker] reset error:', e.message);
      fail(res, e);
    }
  });

  // POST /api/tracker/delete-year — drop a single year + its inputs.
  //
  // Body: { year: 2027 }
  //
  // Targets, pillar weights, activities, and active sites are NOT
  // affected — they're shared across all reporting years by schema
  // design. Other years' inputs are NOT affected — tracker_inputs
  // is keyed by (year, site, activity_ix), so deleting year N has
  // zero impact on year M.
  //
  // RBAC: super_admin or tracker-admin only. Same gate as reset.
  //
  // Pre-check: GET the same route to see what WOULD be deleted (count
  // of tracker_inputs rows for the year) WITHOUT actually deleting.
  // Drives the confirmation modal's "X rows will be deleted" preview.
  // GET preview: returns what WOULD be deleted, without actually
  // touching anything. Drives the confirmation modal's "X rows will be
  // deleted" warning so the operator can see the cascade impact before
  // committing. Delegates to trackerDb.previewDeleteTrackerYear so the
  // same DB connection is used — avoids the "unable to open database
  // file" path-mismatch bug (fixed 2026-05-31 — earlier version of
  // this route opened data/tracker.db directly which doesn't exist;
  // tracker.db lives at the worktree root, not under data/).
  router.get('/api/tracker/delete-year', requireReportSession, requireRole(['super_admin', 'tracker-admin']), async (req, res) => {
    try {
      if (!trackerDb) return res.status(503).json({ error: 'Tracker module not available' });
      const year = parseInt(req.query.year, 10);
      if (!Number.isFinite(year) || year < 2000 || year > 2100) {
        return res.status(400).json({ error: 'Missing or invalid ?year= parameter' });
      }
      res.json(await trackerDb.previewDeleteTrackerYear(year));
    } catch(e) {
      console.error('[Tracker] delete-year preview error:', e.message);
      fail(res, e);
    }
  });

  // POST commit: actually delete the year + its tracker_inputs rows.
  // jsonBody (defined earlier in server.js) is a 2 MB JSON parser —
  // plenty for a `{year:2027}` body.
  router.post('/api/tracker/delete-year', requireReportSession, requireRole(['super_admin', 'tracker-admin']), jsonBody, async (req, res) => {
    try {
      if (!trackerDb) return res.status(503).json({ error: 'Tracker module not available' });
      const year = parseInt((req.body && req.body.year), 10);
      if (!Number.isFinite(year) || year < 2000 || year > 2100) {
        return res.status(400).json({ error: 'Missing or invalid year in body' });
      }
      // deleteTrackerYear calls backupDatabase() FIRST inside the
      // function (sqlite backend only) — if that throws (disk full,
      // perms), no destructive write happens and the error bubbles up
      // here as a 400. The postgres backend skips the file snapshot.
      const result = await trackerDb.deleteTrackerYear(year);
      const who = req.reportUser?.username || req.reportUser?.full_name || 'unknown';
      console.log(`[Tracker] year delete year=${result.year} user=${who} inputs_removed=${result.inputs_deleted} years_after=[${result.years_after.join(', ')}] backup=${result.backup_path}`);
      // E-A01b / X-Q-01: a year delete is a risk event — journal it with the counts and the snapshot ref.
      rdb.logEvent({ category: 'tracker', action: 'tracker_year_deleted', actor: who, actor_id: req.reportUser?.id ?? null, target: String(result.year),
        risk: 1, details: { counts: result.counts || {}, years_after: result.years_after, backup_path: result.backup_path } });
      const D = await trackerDb.loadTracker();
      res.json({ ok: true, D, summary: result });
    } catch(e) {
      console.error('[Tracker] delete-year error:', e.message);
      fail(res, e, 400);
    }
  });

  return router;
};
