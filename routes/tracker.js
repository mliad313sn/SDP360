'use strict';
// ---------------------------------------------------------------------------
// Activity Tracker + Deck Builder routes - extracted from server.js (SDP-DASH-2.0 step 5, lot 5.4,
// 2026-10-22). /api/tracker/* (load, save, dept-meetings import, export, reset, delete-year), the
// Group-preset routes /api/dashboard/* and POST /api/reports/exec-pptx (python render).
// Handlers unchanged (`app.` became `router.`; render.py is resolved from the repository root).
// ---------------------------------------------------------------------------
const fs   = require('fs');
const path = require('path');
const userSites = require('../services/userSites');
const ROOT = path.join(__dirname, '..');

module.exports = function trackerRoutes(deps) {
  const {
    express, rdb, requireReportSession, requireAdmin, requireRole, jsonBody,
  } = deps;
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

  // GET /api/tracker/load — return full D object from SQLite
  // RBAC audit 2026-10-02 (A1/B1): the load was admin-only while the save accepts
  // tracker-editor, and the client could not lock the site picker (the session user has
  // no site name). Readers = admin tier OR a tracker feature role; the response carries
  // the caller's save scope — null = every site, else the one tracker code it may edit.
  async function _trackerScopeFor(user) {
    const codes = await _trackerScopesFor(user);
    return codes === null ? null : (codes[0] || '');
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
      res.status(500).json({ error: e.message });
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
        if (!userSite) {
          return res.status(403).json({ error: 'Your account has no site assigned. Contact your administrator.' });
        }
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // POST /api/reports/exec-pptx — Group IT Executive Report PPTX builder
  // ──────────────────────────────────────────────────────────────────────
  // Replaces the old client-side rasterise pipeline (canvas screenshot →
  // PNG → pptxgenjs build) which produced fuzzy charts at the wrong
  // aspect ratio. The new pipeline is:
  //
  //   1. Browser collects current filter state + extracted data from
  //      _data.* globals on executive-report.html and POSTs it here as
  //      JSON (single round trip — no per-chart calls).
  //   2. We append the optional tracker 2-slide PPTX as base64 (Phase 2 —
  //      generated via the existing tracker-pptx.js code path) so the
  //      Python merger has everything it needs in one payload.
  //   3. Spawn `python tools/exec-pptx/render.py`, pipe JSON to stdin.
  //   4. Python opens public/brand/group-it-template.pptx, edits the text
  //      runs via python-pptx, swaps each chart image with a freshly-
  //      rendered matplotlib PNG at the template's native dimensions,
  //      then merges the tracker slides if present.
  //   5. Stream the resulting bytes back to the browser as a download.
  //
  // Requires: Python 3 + matplotlib + python-pptx + pillow (see
  // tools/exec-pptx/requirements.txt). On the production host run
  // `pip install -r tools/exec-pptx/requirements.txt` once after deploy.
  const { spawn } = require('child_process');

  // Phase 3 — server-side payload builder. Enriches the browser-sent KPI
  // snapshot with full kpis-may.json-shape data drawn from reports-db
  // (helpdesk KPIs, categories, channel, ageing, MIs, changes) +
  // tracker-db (activity tracker for slides 10/11). Browser fields take
  // precedence so the operator can override via the dashboard UI.
  const reportPayloadBuilder = require('../services/reportPayload');
  const groupPresets         = require('../services/groupPresets');

  // ─── /api/dashboard/presets/* — DB-backed group preset config ─────────
  // Replaces the localStorage-only `_DEFAULT_GROUP_PRESETS` block formerly
  // living in executive-report.html. Two scopes: 'tickets' (request_records
  // tech_group) and 'changes' (change_records group_name) — kept separate
  // per user direction so each can hold a different list under the same
  // canonical preset name. See services/groupPresets.js for schema + seeds.

  // Read — open to any authenticated user (drives dropdown population).
  router.get('/api/dashboard/presets', requireReportSession, async (req, res) => {
    const scope = String(req.query.scope || 'tickets').toLowerCase();
    if (scope !== 'tickets' && scope !== 'changes') {
      return res.status(400).json({ error: "scope must be 'tickets' or 'changes'" });
    }
    try {
      const db = rdb.db;
      const includeDiscovered = req.query.include_discovered === '1';
      const presets = includeDiscovered
        ? await groupPresets.getPresetsWithDiscovered(db, scope)
        : await groupPresets.getPresets(db, scope);
      return res.json({ scope, presets, canonical_names: groupPresets.CANONICAL_PRESETS });
    } catch (e) {
      console.error('[group-presets] GET failed:', e);
      return res.status(500).json({ error: e.message });
    }
  });

  // Write — admin + super_admin (per RBAC decision 2026-06-04). The body
  // MUST be the full presets map for the scope; the implementation does
  // an atomic DELETE + reinsert inside a transaction so partial updates
  // can't leave a half-state.
  router.put('/api/dashboard/presets', requireReportSession, requireAdmin, async (req, res) => {
    const scope = String(req.query.scope || 'tickets').toLowerCase();
    if (scope !== 'tickets' && scope !== 'changes') {
      return res.status(400).json({ error: "scope must be 'tickets' or 'changes'" });
    }
    const body = req.body || {};
    const presets = body.presets || body;   // accept {presets: {...}} OR raw {...}
    if (!presets || typeof presets !== 'object' || Array.isArray(presets)) {
      return res.status(400).json({ error: 'body.presets must be an object {presetName: [group,...]}' });
    }
    try {
      const user = (req.reportUser && (req.reportUser.username || req.reportUser.full_name)) || 'unknown';
      const out = await groupPresets.setPresets(rdb.db, scope, presets, user);
      return res.json(out);
    } catch (e) {
      console.error('[group-presets] PUT failed:', e);
      return res.status(500).json({ error: e.message });
    }
  });

  // Discovered — groups present in the actual data but NOT yet classified
  // in any preset for this scope. Drives the "Pending" badge in the
  // modal. Admin+ only.
  router.get('/api/dashboard/groups/discovered', requireReportSession, requireAdmin, async (req, res) => {
    const scope = String(req.query.scope || 'tickets').toLowerCase();
    if (scope !== 'tickets' && scope !== 'changes') {
      return res.status(400).json({ error: "scope must be 'tickets' or 'changes'" });
    }
    try {
      const discovered = await groupPresets.getDiscovered(rdb.db, scope);
      return res.json({ scope, discovered, count: discovered.length });
    } catch (e) {
      console.error('[group-presets] discovered failed:', e);
      return res.status(500).json({ error: e.message });
    }
  });

  router.post('/api/reports/exec-pptx', requireReportSession, requireAdmin, async (req, res) => {
    const browserPayload = req.body || {};
    if (!browserPayload.filters || !browserPayload.filters.period_label) {
      return res.status(400).json({ error: 'Missing filters.period_label' });
    }

    // ── Build the kpis-may.json-shaped payload ───────────────────────────
    // The renderer expects month/year/total/closed/.../channel/categories/
    // ageing/mi_records/tracker/... at the top level (see
    // tools/exec-pptx/fixtures/kpis-may.json). reportPayload.build()
    // reads from reports-db + tracker-db and merges over whatever the
    // browser sent. If a DB query fails it logs a warn and defaults
    // to 0 — render.py has its own _DEFAULTS layer so partial data
    // still produces a clean deck.
    let payload;
    try {
      payload = await reportPayloadBuilder.build(browserPayload);
      payload.filters = browserPayload.filters;   // preserve route-level shape
      payload.output_filename = browserPayload.output_filename;
    } catch (e) {
      console.error('[exec-pptx] payload builder failed — falling back to browser payload:', e.message);
      console.error('[exec-pptx] stack:', e.stack);
      payload = browserPayload;
    }
    // Guarantee `month` and `year` at the top level even if the build path
    // above threw or returned partial data — render.py exits 2 without them.
    if (!payload.month) {
      payload.month = (browserPayload.filters && browserPayload.filters.month_name)
                   || (browserPayload.filters && browserPayload.filters.period_short
                       ? String(browserPayload.filters.period_short).split(/\s+/)[0]
                       : 'May');
    }
    if (!payload.year) {
      payload.year = String(
        (browserPayload.filters && browserPayload.filters.year)
        || new Date().getFullYear()
      );
    }

    // Phase 2 vestige — the tracker_pptx merge step is no longer needed
    // because slides 10/11 are now built inside render.py from the
    // tracker block of the enriched payload (see services/reportPayload.js
    // → _tracker()). The old code path stayed harmless but spent ~2s on
    // every run building slides the renderer overwrites. Kept the variable
    // name for log-message compatibility.
    const trackerB64 = null;
    const fullPayload = payload;

    // Resolve the renderer path relative to server.js so deploy via xcopy
    // (which copies /tools/ into Z:\) keeps everything in one place.
    const scriptPath = path.join(ROOT, 'tools', 'exec-pptx', 'render.py');
    if (!fs.existsSync(scriptPath)) {
      console.error('[exec-pptx] renderer missing at', scriptPath);
      return res.status(500).json({ error: 'PPTX renderer not deployed. Run pip install -r tools/exec-pptx/requirements.txt on the server.' });
    }

    // ── Spawn Python ─────────────────────────────────────────────────
    // We use `python` on Windows (PATH already set), `python3` on Linux.
    // PYTHONIOENCODING=utf-8 ensures the renderer's diagnostic prints
    // (which include unicode arrows, em-dashes, etc.) don't crash on
    // Windows cp1252 default.
    const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
    const child = spawn(pyCmd, [scriptPath], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const chunks = [];
    let stderr = '';
    let responded = false;
    const t0 = Date.now();
    console.log(`[exec-pptx] render START · period="${payload.filters.period_label}" · tracker_slides=${trackerB64 ? 'yes' : 'no'}`);

    // Node-side guard timeout — kill Python if it takes longer than
    // EXEC_PPTX_TIMEOUT_MS (default 4 min). Without this, a hung Python
    // would orphan the process and the IIS request would 502 anyway,
    // but Node would keep the spawn alive forever. The IIS ARR proxy
    // timeout in front of us is set to 5 min via appcmd (see CLAUDE.md
    // "Fix PPTX export 502" section), so the 4-min Node cap fires
    // first and produces a proper 504 with a clear error message rather
    // than an opaque 502 from IIS.
    const TIMEOUT_MS = parseInt(process.env.EXEC_PPTX_TIMEOUT_MS || '240000', 10);
    const timer = setTimeout(() => {
      if (responded) return;
      responded = true;
      const dur = Math.round((Date.now() - t0) / 1000);
      console.error(`[exec-pptx] TIMEOUT after ${dur}s — killing renderer. stderr tail:\n${stderr.slice(-500)}`);
      try { child.kill('SIGKILL'); } catch(_) {}
      res.status(504).json({
        error: `PPTX renderer exceeded ${TIMEOUT_MS / 1000}s budget. Charts may be slow to render — raise EXEC_PPTX_TIMEOUT_MS in .env if the deck is genuinely large.`,
        stderr_tail: stderr.slice(-500),
      });
    }, TIMEOUT_MS);

    child.stdout.on('data', d => chunks.push(d));
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => {
      if (responded) return;
      responded = true;
      clearTimeout(timer);
      console.error('[exec-pptx] spawn error:', err.message);
      res.status(500).json({ error: 'Failed to start renderer: ' + err.message });
    });
    child.on('close', code => {
      if (responded) return;
      responded = true;
      clearTimeout(timer);
      const dur = Math.round((Date.now() - t0) / 1000);
      // Surface renderer warnings in the server log so we can see "placeholder
      // not found" hints without needing client-side debugging.
      if (stderr.trim()) console.log('[exec-pptx] renderer stderr:\n' + stderr.trim());
      if (code !== 0) {
        console.error(`[exec-pptx] FAIL exit=${code} duration=${dur}s`);
        return res.status(500).json({ error: `Renderer exited ${code}`, stderr: stderr.slice(-500) });
      }
      const buf = Buffer.concat(chunks);
      if (buf.length < 1024) {
        console.error(`[exec-pptx] FAIL empty-output duration=${dur}s`);
        return res.status(500).json({ error: 'Renderer produced empty output', stderr: stderr.slice(-500) });
      }
      console.log(`[exec-pptx] render OK · ${(buf.length / 1024).toFixed(0)} KB · ${dur}s`);

      // ── Filename: Group_IT_Operations_Report_<Month>_<Year>.pptx ────
      // Falls back to the period label if month_name/year aren't set
      // (e.g. quarterly / YTD reports that span multiple months).
      const fname = (payload.output_filename
        || `Group_IT_Operations_Report_${(payload.filters.month_name || 'Period').replace(/\s+/g,'_')}_${payload.filters.year || ''}.pptx`);

      res.setHeader('Content-Type',        'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
      res.setHeader('Content-Length',      buf.length);
      res.send(buf);
    });

    // Pipe the JSON to Python's stdin and close it so the renderer can
    // start processing immediately instead of buffering forever.
    child.stdin.end(JSON.stringify(fullPayload), 'utf8');
  });

  // POST /api/tracker/reset — restore DB to INIT defaults
  // Strict: super_admin or tracker-admin only. Executives without the
  // tracker-admin feature role cannot reset the tracker.
  router.post('/api/tracker/reset', requireReportSession, requireRole(['super_admin', 'tracker-admin']), async (req, res) => {
    try {
      if (!trackerDb) return res.status(503).json({ error: 'Tracker module not available' });
      if (trackerDb.TRACKER_BACKEND === 'postgres') {
        return res.status(501).json({ error: 'Reset is not supported on the PostgreSQL backend (Chunk 1 scope).' });
      }
      await trackerDb.resetTracker();
      const D = await trackerDb.loadTracker();
      res.json({ ok: true, D });
    } catch(e) {
      console.error('[Tracker] reset error:', e.message);
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
      const D = await trackerDb.loadTracker();
      res.json({ ok: true, D, summary: result });
    } catch(e) {
      console.error('[Tracker] delete-year error:', e.message);
      res.status(400).json({ error: e.message });
    }
  });

  return router;
};
