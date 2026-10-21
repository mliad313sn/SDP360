'use strict';
const { fail } = require('../services/httpError');
// Step 5 — meetings routes extracted from server.js (modularisation, inspection.js pattern).
// Handlers are byte-identical to the former inline ones; `app.` became `router.` and the
// relative requires gained one `../`. server.js mounts it with its own middleware + readers.
const path = require('path');
const userSites = require('../services/userSites');

module.exports = function meetingsRoutes(deps) {
  const { express, rdb, inspectionDb, requireReportSession, requireRole } = deps;
  const router = express.Router();

// ══════════════════════════════════════════════════════════════════
// MEETINGS — Department Meetings & Council Escalations (v2 schema)
// Mirrors the canonical Endeavour Mining operating system 1:1:
//   - one MEETING per Site × Department × Month (signed PV)
//   - each meeting carries nested projects, issues, actions
//   - issues marked escalate=Y feed the Mine IT Council view
//   - 5 Engagements compliance monitor surfaces SLA breaches
// ══════════════════════════════════════════════════════════════════
let meetingsDb;
try {
  meetingsDb = require('../meetings-db.js');
  console.log('[Meetings] ✅ meetings-db loaded');
} catch(e) {
  console.error('[Meetings] ❌ meetings-db failed to load:', e.message);
}

// Bulk-import module: Excel parse / dry-run / commit + template builder.
// Optional — if the xlsx dep is missing on prod, the routes will 503
// but the rest of the meetings module keeps working.
let meetingsImport;
try {
  meetingsImport = require('../meetings-import.js');
  console.log('[Meetings] ✅ meetings-import loaded');
} catch(e) {
  console.error('[Meetings] ⚠️  meetings-import not loaded (run npm install xlsx):', e.message);
}

// Business Incubation import (a sibling of meetings-import; same xlsx dep).
let meetingsImportIncubation;
try {
  meetingsImportIncubation = require('../meetings-import-incubation.js');
  console.log('[Meetings] ✅ meetings-import-incubation loaded');
} catch(e) {
  console.error('[Meetings] ⚠️  meetings-import-incubation not loaded:', e.message);
}

// PPTX generator — server-side PV + progress deck builder. Uses pptxgenjs
// (already a project dep). Loads even if the meetings DB is offline so the
// route handler can return a 503 with a useful message rather than crashing.
let meetingsPptx;
try {
  meetingsPptx = require('../meetings-pptx.js');
  console.log('[Meetings] ✅ meetings-pptx loaded');
} catch(e) {
  console.error('[Meetings] ⚠️  meetings-pptx failed to load:', e.message);
}

// 10 MB body limit on meeting saves — header + nested children stay
// modest; attachments use a separate route so this cap stays low.
const meetingsJsonBody   = express.json({ limit: '10mb' });
const meetingsAttachBody = express.json({ limit: '30mb' });
// Raw body parser for the Excel upload. 30 MB ceiling matches the
// existing attachment + inspection-save parsers.
const meetingsImportBody = express.raw({ type: '*/*', limit: '30mb' });

// RBAC audit 2026-10-02 (A8) — for a WRITE, a null scope only means "unrestricted" for
// admin+. A non-admin whose site is missing or has no code in this module (no site_id,
// Exploration/ASSAFO without a meetings code…) used to get null too and was treated as
// GLOBAL. Same rule as the report writes (F5): a site-less profile is not global.
function _sitelessWriteDenied(user, userSite) {
  return !userSite && !rdb.userHasRole(user, 'admin');
}

// RBAC lot 4c — scope of a meetings IMPORT: { site: null } for the admin tier, { site: CODE }
// for an editor (every row must be that site), or sends 403 and returns null.
async function _meetingsImportScope(req, res) {
  if (!rdb.userHasRole(req.reportUser, 'editor')) { res.status(403).json({ error: 'editor role or higher required' }); return null; }
  const site = await _userMeetingsSite(req.reportUser);
  if (_sitelessWriteDenied(req.reportUser, site)) { res.status(403).json({ error: 'Your account has no site assigned for this module. Contact your administrator.' }); return null; }
  // multi-site editors: every row must be one of their sites (saveMeeting takes a list)
  return { site: await _userMeetingsSites(req.reportUser) };
}

// Resolve the user's meetings site code (form code, e.g. 'MGO').
// Returns null for unrestricted users (admin+).
// Multi-site editors (2026-10-05): `wanted` = the object's site code — returned when the
// user holds it, else their primary code, so `code !== userSite` checks stay correct.
async function _userMeetingsSite(user, wanted) {
  const codes = await _userMeetingsSites(user);
  return codes === null ? null : userSites.pickCode(codes, wanted);
}
// Every meetings code of the user, primary first; null for the admin tier.
async function _userMeetingsSites(user) {
  if (!user) return null;
  if (rdb.userHasRole(user, 'admin')) return null;
  if (!inspectionDb) return [];
  const sites = (await rdb.listSites()) || [];   // sweep adds await (listSites is forked)
  return userSites.codesFor(user, sites, (s) => inspectionDb.siteNameToCode(s ? s.name : null));
}

// GET /api/meetings/lookups — all bilingual lookups + canonical site list
router.get('/api/meetings/lookups', requireReportSession, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    res.json(await meetingsDb.loadLookups());
  } catch(e) {
    console.error('[Meetings] lookups error:', e.message);
    fail(res, e);
  }
});

// GET /api/meetings/people — owner / Champion autocomplete
// Reuses the inspection people roster so the same names appear here.
router.get('/api/meetings/people', requireReportSession, async (req, res) => {
  try {
    if (!inspectionDb) return res.status(503).json({ error: 'Inspection module not available' });
    res.json({ people: await inspectionDb.listPeople({ site_code: req.query.site || null }) });
  } catch(e) {
    console.error('[Meetings] people error:', e.message);
    fail(res, e);
  }
});

// GET /api/meetings/list — paginated MEETINGS list with nested counts.
// Response shape: { rows: [...], total: N }
//   • rows  — page slice already sorted DESC by meeting_date
//   • total — filter-respecting count (NOT the same as aggregate.total_meetings
//             which ignores status/intake/q). Drives the pagination math
//             on meetings.html so "Next" greys out correctly on the last
//             page and the badge "Page 3 / 7" is accurate.
router.get('/api/meetings/list', requireReportSession, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    const opts = {
      site:       req.query.site       || undefined,
      department: req.query.department || undefined,
      status:     req.query.status     || undefined,
      intake:     req.query.intake     || undefined,
      from:       req.query.from       || undefined,
      to:         req.query.to         || undefined,
      q:          req.query.q          || undefined,
    };
    const rows = await meetingsDb.listMeetings(Object.assign({}, opts, {
      limit:  parseInt(req.query.limit  || '200', 10),
      offset: parseInt(req.query.offset || '0',   10),
    }));
    const total = await meetingsDb.countMeetings(opts);
    res.json({ rows, total });
  } catch(e) {
    console.error('[Meetings] list error:', e.message);
    fail(res, e);
  }
});

// GET /api/meetings/aggregate — KPI roll-up for the Meetings dashboard
router.get('/api/meetings/aggregate', requireReportSession, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    res.json(await meetingsDb.aggregate({
      site:       req.query.site       || undefined,
      department: req.query.department || undefined,
      from:       req.query.from       || undefined,
      to:         req.query.to         || undefined,
    }));
  } catch(e) {
    console.error('[Meetings] aggregate error:', e.message);
    fail(res, e);
  }
});

// GET /api/meetings/insights — chart-shaped analytical roll-up
//   Powers meetings-insights.html (6-tile KPI strip + 6 charts +
//   site leaderboard). One round-trip per page load.
//   Filters: site, department, from, to (defaults to last 6 months
//   per the ITSM standard visibility doctrine in CLAUDE.md).
router.get('/api/meetings/insights', requireReportSession, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    res.json(await meetingsDb.insights({
      site:       req.query.site       || undefined,
      department: req.query.department || undefined,
      from:       req.query.from       || undefined,
      to:         req.query.to         || undefined,
    }));
  } catch(e) {
    console.error('[Meetings] insights error:', e.message);
    fail(res, e);
  }
});

// GET /api/meetings/compliance — the 5 Engagements monitor
//   ?month=YYYY-MM (defaults to current month)
router.get('/api/meetings/compliance', requireReportSession, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    res.json(await meetingsDb.compliance({ month: req.query.month || undefined }));
  } catch(e) {
    console.error('[Meetings] compliance error:', e.message);
    fail(res, e);
  }
});

// GET /api/meetings/issues — flat Issues Log across all meetings
router.get('/api/meetings/issues', requireReportSession, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    const escalate = req.query.escalate;
    const opts = {
      site:          req.query.site          || undefined,
      department:    req.query.department    || undefined,
      category:      req.query.category      || undefined,
      severity:      req.query.severity      || undefined,
      status:        req.query.status        || undefined,
      council_theme: req.query.council_theme || undefined,
      from:          req.query.from          || undefined,
      to:            req.query.to            || undefined,
      q:             req.query.q             || undefined,
      limit:         parseInt(req.query.limit  || '500', 10),
      offset:        parseInt(req.query.offset || '0',   10),
    };
    if (escalate === '1' || escalate === 'true')  opts.escalate = true;
    else if (escalate === '0' || escalate === 'false') opts.escalate = false;
    res.json({ rows: await meetingsDb.listIssues(opts) });
  } catch(e) {
    console.error('[Meetings] issues error:', e.message);
    fail(res, e);
  }
});

// GET /api/meetings/escalations — alias for /issues?escalate=1, the
// Mine IT Council view — auto-grouped by council theme on the client.
router.get('/api/meetings/escalations', requireReportSession, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    res.json({ rows: await meetingsDb.listEscalations({
      site:          req.query.site          || undefined,
      department:    req.query.department    || undefined,
      category:      req.query.category      || undefined,
      severity:      req.query.severity      || undefined,
      status:        req.query.status        || undefined,
      council_theme: req.query.council_theme || undefined,
      from:          req.query.from          || undefined,
      to:            req.query.to            || undefined,
    }) });
  } catch(e) {
    console.error('[Meetings] escalations error:', e.message);
    fail(res, e);
  }
});

// GET /api/meetings/export.xlsx — full-table Excel dump (Meetings / Issues /
// Actions / Projects sheets). admin+ (bulk data export). The /api/meetings/:id
// route's non-numeric guard (parseInt("export.xlsx")=NaN → next()) lets this
// specific path resolve here regardless of registration order.
// RBAC lot 4c: open to an editor, limited to their site (admin tier: every site).
router.get('/api/meetings/export.xlsx', requireReportSession, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    const scope = await _meetingsImportScope(req, res); if (!scope) return;
    const tableExcel = require('../services/tableExcel');
    const data = await meetingsDb.exportRows({ site: scope.site });
    const buf = tableExcel.buildWorkbook([
      { name: 'Meetings', rows: data.meetings },
      { name: 'Issues',   rows: data.issues },
      { name: 'Actions',  rows: data.actions },
      { name: 'Projects', rows: data.projects },
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Meetings_${Array.isArray(scope.site) ? scope.site.join('-') : (scope.site || 'full')}_${stamp}.xlsx"`);
    res.send(buf);
  } catch(e) {
    console.error('[Meetings] excel export error:', e.message);
    fail(res, e);
  }
});

// GET /api/meetings/actions — flat Actions Register across all PVs.
// viewer+. Filters: site, department, status, owner, overdue, from, to, q.
// Registered BEFORE /:id; the numeric guard on /:id also lets "actions" fall
// through, but keeping it here groups it with the other list routes.
router.get('/api/meetings/actions', requireReportSession, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    res.json({ rows: await meetingsDb.listActions({
      site:       req.query.site       || undefined,
      department: req.query.department || undefined,
      status:     req.query.status     || undefined,
      owner:      req.query.owner      || undefined,
      overdue:    req.query.overdue === '1' || req.query.overdue === 'true' || undefined,
      from:       req.query.from       || undefined,
      to:         req.query.to         || undefined,
      q:          req.query.q          || undefined,
    }) });
  } catch(e) {
    console.error('[Meetings] actions list error:', e.message);
    fail(res, e);
  }
});

// POST /api/meetings/actions/:id/update — change one action's status + log an
// audit comment. editor+ ; editors are scoped to their own site. Crucially,
// this is allowed EVEN WHEN the parent PV is closed — actions outlive the
// signed/closed meeting, and closing a stale action must not require an admin
// to re-open the whole PV.
router.post('/api/meetings/actions/:id/update', requireReportSession, meetingsJsonBody, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    if (!rdb.userHasRole(req.reportUser, 'editor')) {
      return res.status(403).json({ error: 'editor role or higher required' });
    }
    const actionId = parseInt(req.params.id, 10);
    if (!Number.isFinite(actionId)) return res.status(400).json({ error: 'Invalid action id' });
    // Site scoping for editors — look up the parent meeting's site via the
    // module's own (already-open) connection. No raw re-open / stray file.
    const parent = await meetingsDb.getActionParent(actionId);
    if (!parent) return res.status(404).json({ error: 'Action not found' });
    const userSite = await _userMeetingsSite(req.reportUser, parent.site_code);
    if (_sitelessWriteDenied(req.reportUser, userSite)) return res.status(403).json({ error: 'Your account has no site assigned for this module. Contact your administrator.' });
    if (userSite && parent.site_code !== userSite) {
      return res.status(403).json({ error: `Action belongs to ${parent.site_code}; you are scoped to ${userSite}` });
    }
    const body = req.body || {};
    const tErr = statusTransfer.validate(body.status_change, body.body, body.helpdesk_ticket);
    if (tErr) return res.status(400).json({ error: tErr });
    await meetingsDb.addActionUpdate(actionId, {
      author_id:     req.reportUser.id || null,
      author_name:   req.reportUser.full_name || req.reportUser.username,
      body:          body.body || '',
      status_change: body.status_change || null,
      helpdesk_ticket: body.helpdesk_ticket || null,
    });
    res.json({ ok: true });
  } catch(e) {
    console.error('[Meetings] action update error:', e.message);
    fail(res, e);
  }
});

// GET /api/meetings/unsigned — flat worklist of PVs missing at least one
// signature, so a coordinator can stamp them without opening each one.
// viewer+. Editors are scoped to their own site (site forced server-side);
// admin+ see all, with an optional ?site= narrow. Registered BEFORE /:id (and
// /:id carries a numeric guard) so "unsigned" is never parsed as a meeting id.
router.get('/api/meetings/unsigned', requireReportSession, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    const userSite = await _userMeetingsSite(req.reportUser, req.query.site);
    // Scoped editor → forced to one of their sites (?site= picks among them). admin+ → optional ?site=.
    const site = userSite || (req.query.site || undefined);
    const rows = await meetingsDb.listMeetings({ unsigned: 1, site, limit: 500 });
    res.json({ scope: userSite || 'all', rows: rows.map(m => ({
      id: m.id, reference: m.reference, site_code: m.site_code, department: m.department,
      meeting_date: m.meeting_date, status: m.status,
      dept_head_signed_at: m.dept_head_signed_at, site_it_signed_at: m.site_it_signed_at,
    })) });
  } catch (e) {
    console.error('[Meetings] unsigned list error:', e.message);
    fail(res, e);
  }
});

// POST /api/meetings/:id/sign — stamp ONE signature (dept_head | site_it) on a
// PV. editor+ ; editors scoped to their own site. The timestamp is
// server-authoritative and immutable (first stamp wins — COALESCE in the DB
// layer). Distinct method+path from GET /:id, so no shadowing; the id is guarded
// numeric here too.
router.post('/api/meetings/:id/sign', requireReportSession, meetingsJsonBody, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    if (!rdb.userHasRole(req.reportUser, 'editor')) {
      return res.status(403).json({ error: 'editor role or higher required' });
    }
    const meetingId = parseInt(req.params.id, 10);
    if (!Number.isFinite(meetingId)) return res.status(400).json({ error: 'Invalid meeting id' });
    const which = (req.body && req.body.which) || '';
    if (which !== 'dept_head' && which !== 'site_it') {
      return res.status(400).json({ error: 'Invalid which — expected dept_head|site_it' });
    }
    const status = await meetingsDb.getMeetingStatus(meetingId);
    if (!status) return res.status(404).json({ error: 'Meeting not found' });
    const userSite = await _userMeetingsSite(req.reportUser, status.site_code);
    if (_sitelessWriteDenied(req.reportUser, userSite)) return res.status(403).json({ error: 'Your account has no site assigned for this module. Contact your administrator.' });
    if (userSite && status.site_code !== userSite) {
      return res.status(403).json({ error: `Meeting belongs to ${status.site_code}; you are scoped to ${userSite}` });
    }
    const out = await meetingsDb.signMeeting(meetingId, which, { user: req.reportUser });
    res.json({ ok: true, ...out });
  } catch (e) {
    console.error('[Meetings] sign error:', e.message);
    const isNF = /not found/i.test(e.message);
    fail(res, e, isNF ? 404 : undefined);
  }
});

// GET /api/meetings/:id — full meeting (header + projects + issues + actions + audit + attachments)
router.get('/api/meetings/:id', requireReportSession, async (req, res, next) => {
  // Guard: this parametric route is registered BEFORE the specific
  // /api/meetings/progress route, so a non-numeric :id (e.g. "progress")
  // must fall through to the later matching route instead of being parsed
  // as a meeting id (parseInt("progress")=NaN → bogus 404 "Not found").
  if (!Number.isFinite(parseInt(req.params.id, 10))) return next();
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    const rec = await meetingsDb.getMeeting(parseInt(req.params.id, 10));
    if (!rec) return res.status(404).json({ error: 'Not found' });
    res.json(rec);
  } catch(e) {
    console.error('[Meetings] get error:', e.message);
    fail(res, e);
  }
});

// POST /api/meetings/save — upsert a meeting + its nested children.
// Editor users are scoped to their own site (DB layer enforces);
// admin+ can write any site. Body shape:
//   { state: { id?, header: {...}, projects: [...], issues: [...], actions: [...] } }
// Children arrays are OPTIONAL — omitting them preserves existing rows.
router.post('/api/meetings/save', requireReportSession, meetingsJsonBody, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    if (!rdb.userHasRole(req.reportUser, 'editor')) {
      return res.status(403).json({ error: 'editor role or higher required' });
    }
    const state = req.body && req.body.state;
    if (!state || !state.header || !state.header.title && !state.header.department) {
      return res.status(400).json({ error: 'Missing state.header.department' });
    }
    state.author_name = state.author_name || req.reportUser.full_name || req.reportUser.username;
    const userSite = await _userMeetingsSite(req.reportUser, state.header && state.header.site_code);
    if (_sitelessWriteDenied(req.reportUser, userSite)) return res.status(403).json({ error: 'Your account has no site assigned for this module. Contact your administrator.' });
    // Transfer statuses (2026-10-16): an issue / action ENTERING demand, helpdesk_ticket or
    // cancelled needs its justification (+ the SDP ticket number). Rows already in that status
    // are left alone (history predates the rule); the bulk import does not pass through here.
    const transferErr = await _meetingTransferError(state);
    if (transferErr) return res.status(400).json({ error: transferErr });
    // multi-site editors: the DB guard takes the full list of their codes
    const out      = await meetingsDb.saveMeeting(state, await _userMeetingsSites(req.reportUser), req.reportUser.id || null);
    // Business Incubation entered by hand (2026-10-03): state.incubation carries §1-§4 of
    // the follow-up report. Stored (normalised) only for an incubation session, cleared
    // otherwise; an OMITTED key (header-only saves) leaves the stored blob untouched.
    if (state.incubation !== undefined && out && out.id) {
      const isInc = String(state.header.intake_source || '') === 'business_incubation';
      await meetingsDb.setMeetingIncubation(out.id,
        isInc && state.incubation ? require('../services/incubationForm').normalizeIncubation(state.incubation) : null);
    }
    res.json({ ok: true, ...out, scope: userSite || 'all' });
  } catch(e) {
    console.error('[Meetings] save error:', e.message);
    const isScope = /Cross-site|closed/i.test(e.message);
    fail(res, e, isScope ? 403 : undefined);
  }
});

// Transfer statuses (2026-10-16) — public/lib/statusTransfer.js is the rule, shared with the pages.
const statusTransfer = require('../public/lib/statusTransfer');
async function _meetingTransferError(state) {
  const id = state && state.id ? parseInt(state.id, 10) : null;
  let old = null;
  try { old = id ? await meetingsDb.getMeeting(id) : null; } catch (_) { old = null; }   // sync on sqlite, a Promise on pg
  const before = (rows) => new Map(((rows) || []).map(r => [Number(r.id), r.status]));
  const oi = before(old && old.issues), oa = before(old && old.actions);
  const check = (rows, prev, what) => {
    for (const r of (rows || [])) {
      if (!statusTransfer.isTransfer(r.status)) continue;
      if (r.id != null && prev.get(Number(r.id)) === r.status) continue;   // not a transition
      const err = statusTransfer.validate(r.status, r.status_note, r.helpdesk_ticket);
      if (err) return `${what} "${String(r.title || r.description || '').slice(0, 60)}": ${err}`;
    }
    return null;
  };
  return (state.issues !== undefined && check(state.issues, oi, 'Issue'))
      || (state.actions !== undefined && check(state.actions, oa, 'Action')) || null;
}

// POST /api/meetings/issues/:id/update — append an audit-trail comment
// or status / escalate change to a single issue.
// Editor users can only update issues whose meeting belongs to their site.
router.post('/api/meetings/issues/:id/update', requireReportSession, meetingsJsonBody, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    if (!rdb.userHasRole(req.reportUser, 'editor')) {
      return res.status(403).json({ error: 'editor role or higher required' });
    }
    const issueId = parseInt(req.params.id, 10);
    // Look up the parent meeting to enforce site scoping. Uses the module's
    // already-open connection (was previously re-opening __dirname/meetings.db
    // at the ROOT — the wrong path since the DB moved to data/ on 2026-06-05,
    // which created a stray empty file and made every lookup 404).
    const parent = await meetingsDb.getIssueParent(issueId);
    if (!parent) return res.status(404).json({ error: 'Issue not found' });

    const userSite = await _userMeetingsSite(req.reportUser, parent.site_code);
    if (_sitelessWriteDenied(req.reportUser, userSite)) return res.status(403).json({ error: 'Your account has no site assigned for this module. Contact your administrator.' });
    if (userSite && parent.site_code !== userSite) {
      return res.status(403).json({ error: `Issue belongs to ${parent.site_code}; you are scoped to ${userSite}` });
    }
    // RBAC lot 4c: an issue under a CLOSED PV is editable by an editor of that site.

    const body = req.body || {};
    const tErr = statusTransfer.validate(body.status_change, body.body, body.helpdesk_ticket);
    if (tErr) return res.status(400).json({ error: tErr });
    await meetingsDb.addIssueUpdate(issueId, {
      author_id:       req.reportUser.id || null,
      author_name:     req.reportUser.full_name || req.reportUser.username,
      body:            body.body || '',
      status_change:   body.status_change || null,
      helpdesk_ticket: body.helpdesk_ticket || null,
      escalate_change: typeof body.escalate_change === 'boolean' ? body.escalate_change
                       : (body.escalate_change === 1 ? true : body.escalate_change === 0 ? false : null),
    });
    res.json({ ok: true });
  } catch(e) {
    console.error('[Meetings] issue update error:', e.message);
    fail(res, e);
  }
});

// POST /api/meetings/issues/:id/actions — add an IT action linked to this issue
// (Site Actions hub « + Action »). Same RBAC as the issue update: editor, own site.
router.post('/api/meetings/issues/:id/actions', requireReportSession, meetingsJsonBody, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    if (!rdb.userHasRole(req.reportUser, 'editor')) {
      return res.status(403).json({ error: 'editor role or higher required' });
    }
    const issueId = parseInt(req.params.id, 10);
    const parent = await meetingsDb.getIssueParent(issueId);
    if (!parent) return res.status(404).json({ error: 'Issue not found' });
    const userSite = await _userMeetingsSite(req.reportUser, parent.site_code);
    if (_sitelessWriteDenied(req.reportUser, userSite)) return res.status(403).json({ error: 'Your account has no site assigned for this module. Contact your administrator.' });
    if (userSite && parent.site_code !== userSite) {
      return res.status(403).json({ error: `Issue belongs to ${parent.site_code}; you are scoped to ${userSite}` });
    }
    const b = req.body || {};
    let out;
    try {
      out = await meetingsDb.addActionForIssue(issueId,
        { description: b.description, owner_it: b.owner_it, owner_email: b.owner_email, target_date: b.target_date },
        { author_id: req.reportUser.id || null, author_name: req.reportUser.full_name || req.reportUser.username });
    } catch (e) {
      if (/required/i.test(e.message)) return fail(res, e, 400);
      if (/not found/i.test(e.message)) return fail(res, e, 404);
      throw e;
    }
    res.json({ ok: true, ...out });
  } catch(e) {
    console.error('[Meetings] add action for issue error:', e.message);
    fail(res, e);
  }
});

// DELETE /api/meetings/:id — executive+ only (cascading)
// RBAC lot 4c: an editor deletes a PV of their own site (was executive-only).
router.delete('/api/meetings/:id', requireReportSession, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    if (!rdb.userHasRole(req.reportUser, 'editor')) return res.status(403).json({ error: 'editor role or higher required' });
    const head = await meetingsDb.getMeetingStatus(parseInt(req.params.id, 10));
    if (!head) return res.status(404).json({ error: 'Not found' });
    const userSite = await _userMeetingsSite(req.reportUser, head.site_code);
    if (_sitelessWriteDenied(req.reportUser, userSite)) return res.status(403).json({ error: 'Your account has no site assigned for this module. Contact your administrator.' });
    if (userSite && head.site_code !== userSite) return res.status(403).json({ error: `Meeting belongs to ${head.site_code}; you are scoped to ${userSite}` });
    const ok = await meetingsDb.deleteMeeting(parseInt(req.params.id, 10));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch(e) {
    console.error('[Meetings] delete error:', e.message);
    fail(res, e);
  }
});

// POST /api/meetings/lookups/:table — append a row to any parametrable
// lookup table (super_admin). Body: the row object {code, name_en, ...}.
// :table must be one of the allowed lookups (validated in DB layer).
// Refuses if the code already exists — use PUT to update an existing row.
router.post('/api/meetings/lookups/:table', requireReportSession, requireRole('super_admin'), meetingsJsonBody, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    await meetingsDb.addLookupRow(req.params.table, req.body || {});
    console.log(`[meetings-lookups] ADD ${req.params.table}/${(req.body || {}).code} by ${req.reportUser && req.reportUser.username}`);
    res.json({ ok: true, lookups: await meetingsDb.loadLookups() });
  } catch(e) {
    console.error('[Meetings] addLookupRow error:', e.message);
    fail(res, e, 400);
  }
});

// GET /api/meetings/lookups/:table — list ALL rows (including inactive) for
// the admin UI. Differs from /api/meetings/lookups (the form-facing one,
// which silently filters active=1 via loadLookups). super_admin only — the
// admin card on reports.html#admin needs to manage soft-deleted rows too.
router.get('/api/meetings/lookups/:table', requireReportSession, requireRole('super_admin'), async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    const rows = await meetingsDb.listLookupTable(req.params.table, { includeInactive: true });
    res.json({ table: req.params.table, rows });
  } catch(e) {
    console.error('[Meetings] listLookupTable error:', e.message);
    fail(res, e, 400);
  }
});

// PUT /api/meetings/lookups/:table/:code — patch an EXISTING lookup row
// (super_admin). Body: any subset of {name_en, name_fr, color, icon,
// description_en, description_fr, display_order, active}. The `code` is
// the PK and is NOT editable through this route — to rename a code,
// POST a new one and PATCH the old one inactive.
router.put('/api/meetings/lookups/:table/:code', requireReportSession, requireRole('super_admin'), meetingsJsonBody, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    const result = await meetingsDb.updateLookupRow(req.params.table, req.params.code, req.body || {});
    console.log(`[meetings-lookups] PUT ${req.params.table}/${req.params.code} by ${req.reportUser && req.reportUser.username}`);
    res.json({ ok: true, changes: result.changes, lookups: await meetingsDb.loadLookups() });
  } catch(e) {
    console.error('[Meetings] updateLookupRow error:', e.message);
    fail(res, e, 400);
  }
});

// PATCH /api/meetings/lookups/:table/:code/active — convenience toggle
// (super_admin). Body: {active: 0|1|true|false}. Soft-delete equivalent —
// the row stays in DB (so old PVs continue to render their original code
// labels), but it disappears from form dropdowns and import allowlists.
router.patch('/api/meetings/lookups/:table/:code/active', requireReportSession, requireRole('super_admin'), meetingsJsonBody, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    const active = (req.body && (req.body.active === 1 || req.body.active === true || req.body.active === '1')) ? 1 : 0;
    const result = await meetingsDb.updateLookupRow(req.params.table, req.params.code, { active });
    console.log(`[meetings-lookups] TOGGLE ${req.params.table}/${req.params.code} active=${active} by ${req.reportUser && req.reportUser.username}`);
    res.json({ ok: true, active, changes: result.changes });
  } catch(e) {
    console.error('[Meetings] toggleActive error:', e.message);
    fail(res, e, 400);
  }
});

// POST /api/meetings/reset — wipe + re-seed all lookups (super_admin)
router.post('/api/meetings/reset', requireReportSession, requireRole('super_admin'), async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    await meetingsDb.resetLookups();
    res.json({ ok: true, lookups: await meetingsDb.loadLookups() });
  } catch(e) {
    console.error('[Meetings] reset error:', e.message);
    fail(res, e);
  }
});

// ── Bulk import routes ──────────────────────────────────────────────
// GET /api/meetings/import/template — admin+ — download blank xlsx
router.get('/api/meetings/import/template', requireReportSession, async (req, res) => {
  try {
    if (!meetingsDb)     return res.status(503).json({ error: 'Meetings module not available' });
    if (!meetingsImport) return res.status(503).json({ error: 'Import module not available (xlsx not installed)' });
    // RBAC lot 4c (2026-10-02): open to an editor; rows are locked to their site below.
    const _imp = await _meetingsImportScope(req, res); if (!_imp) return;
    const buf = meetingsImport.buildTemplate(await meetingsDb.loadLookups());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="meetings_import_template.xlsx"');
    res.send(buf);
  } catch(e) {
    console.error('[Meetings] template error:', e.message);
    fail(res, e);
  }
});

// POST /api/meetings/import/preview — admin+ — dry-run xlsx parse
// Body: raw .xlsx bytes (Content-Type: application/octet-stream OR multipart/form-data
//       with the file field — we accept either since express.raw is content-type
//       agnostic when set to type:'*/*').
router.post('/api/meetings/import/preview', requireReportSession, meetingsImportBody, async (req, res) => {
  try {
    if (!meetingsDb)     return res.status(503).json({ error: 'Meetings module not available' });
    if (!meetingsImport) return res.status(503).json({ error: 'Import module not available (xlsx not installed)' });
    // RBAC lot 4c (2026-10-02): open to an editor; rows are locked to their site below.
    const _imp = await _meetingsImportScope(req, res); if (!_imp) return;
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Empty body (expected raw xlsx bytes)' });
    const parsed = meetingsImport.parseBuffer(req.body, await meetingsDb.loadLookups());
    // Decorate each meeting with `will_update` so the preview UI can warn
    // the user before a re-upload silently overwrites children of meetings
    // that already exist in DB (issues + actions are wipe-and-replaced
    // during the commit's saveMeeting call — manual edits made via the
    // editor since the original import would be lost).
    let willUpdateCount = 0;
    for (const m of parsed.meetings) {
      const existingId = await meetingsDb.getMeetingIdByReference(m.header.reference);
      m.header._willUpdate = !!existingId;
      m.header._existingId = existingId || null;
      if (existingId) willUpdateCount++;
    }
    // Strip __row metadata from preview response to keep payload small;
    // commit endpoint will re-parse anyway.
    res.json({
      ok: true,
      summary:  Object.assign({}, parsed.summary, {
        will_update: willUpdateCount,
        will_create: parsed.meetings.length - willUpdateCount,
      }),
      errors:   parsed.errors,
      warnings: parsed.warnings,
      meetings: parsed.meetings.map(m => ({
        reference: m.header.reference,
        site_code: m.header.site_code,
        department: m.header.department,
        meeting_date: m.header.meeting_date,
        status: m.header.status,
        issue_count: m.issues.length,
        action_count: m.actions.length,
        will_update: !!m.header._willUpdate,     // true = ref exists in DB → UPDATE
        existing_id: m.header._existingId,       // numeric id when updating, null otherwise
      })),
    });
  } catch(e) {
    console.error('[Meetings] import preview error:', e.message);
    fail(res, e);
  }
});

// POST /api/meetings/import/commit — admin+ — parse + persist
// Same body shape as /preview. Query string `?force=1` skips bad rows
// instead of refusing the whole upload.
router.post('/api/meetings/import/commit', requireReportSession, meetingsImportBody, async (req, res) => {
  try {
    if (!meetingsDb)     return res.status(503).json({ error: 'Meetings module not available' });
    if (!meetingsImport) return res.status(503).json({ error: 'Import module not available (xlsx not installed)' });
    // RBAC lot 4c (2026-10-02): open to an editor; rows are locked to their site below.
    const _imp = await _meetingsImportScope(req, res); if (!_imp) return;
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Empty body (expected raw xlsx bytes)' });
    const parsed = meetingsImport.parseBuffer(req.body, await meetingsDb.loadLookups());
    const force  = req.query.force === '1' || req.query.force === 'true';
    const result = await meetingsImport.commit(parsed, meetingsDb, {
      userSite:    _imp.site,
      force,
      userId:      req.reportUser.id || null,
      author_name: req.reportUser.full_name || req.reportUser.username || 'import',
    });
    res.json({ ok: true, parse: parsed.summary, ...result, validation_errors: parsed.errors, warnings: parsed.warnings });
  } catch(e) {
    console.error('[Meetings] import commit error:', e.message);
    fail(res, e);
  }
});

// ── Business Incubation import (admin+) — separate 4-sheet xlsx, same pipeline
//    shape as the PV import above (template / preview / commit). ──────────────
router.get('/api/meetings/import/incubation-template', requireReportSession, async (req, res) => {
  try {
    if (!meetingsDb)               return res.status(503).json({ error: 'Meetings module not available' });
    if (!meetingsImportIncubation) return res.status(503).json({ error: 'Incubation import module not available (xlsx not installed)' });
    // RBAC lot 4c (2026-10-02): open to an editor; rows are locked to their site below.
    const _imp = await _meetingsImportScope(req, res); if (!_imp) return;
    const buf = meetingsImportIncubation.buildTemplate(await meetingsDb.loadLookups());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="incubation_import_template.xlsx"');
    res.send(buf);
  } catch(e) { console.error('[Meetings] incubation template error:', e.message); fail(res, e); }
});

router.post('/api/meetings/import/incubation/preview', requireReportSession, meetingsImportBody, async (req, res) => {
  try {
    if (!meetingsDb)               return res.status(503).json({ error: 'Meetings module not available' });
    if (!meetingsImportIncubation) return res.status(503).json({ error: 'Incubation import module not available (xlsx not installed)' });
    // RBAC lot 4c (2026-10-02): open to an editor; rows are locked to their site below.
    const _imp = await _meetingsImportScope(req, res); if (!_imp) return;
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Empty body (expected raw xlsx bytes)' });
    const parsed = meetingsImportIncubation.parseBuffer(req.body, await meetingsDb.loadLookups());
    let willUpdate = 0;
    for (const s of parsed.sessions) {
      const existingId = meetingsDb.getMeetingIdByReference ? await meetingsDb.getMeetingIdByReference(s.header.reference) : null;
      s.header._willUpdate = !!existingId; if (existingId) willUpdate++;
    }
    res.json({
      ok: true,
      summary: Object.assign({}, parsed.summary, { will_update: willUpdate, will_create: parsed.sessions.length - willUpdate }),
      errors: parsed.errors, warnings: parsed.warnings,
      sessions: parsed.sessions.map(s => ({
        reference: s.header.reference, site_code: s.header.site_code, department: s.header.department,
        session_start: s.incubation.session_start, session_end: s.incubation.session_end,
        challenge_count: s.issues.length, service_count: s.incubation.services.length, flow_count: s.incubation.flow.length,
        will_update: !!s.header._willUpdate,
      })),
    });
  } catch(e) { console.error('[Meetings] incubation preview error:', e.message); fail(res, e); }
});

router.post('/api/meetings/import/incubation/commit', requireReportSession, meetingsImportBody, async (req, res) => {
  try {
    if (!meetingsDb)               return res.status(503).json({ error: 'Meetings module not available' });
    if (!meetingsImportIncubation) return res.status(503).json({ error: 'Incubation import module not available (xlsx not installed)' });
    // RBAC lot 4c (2026-10-02): open to an editor; rows are locked to their site below.
    const _imp = await _meetingsImportScope(req, res); if (!_imp) return;
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Empty body (expected raw xlsx bytes)' });
    const parsed = meetingsImportIncubation.parseBuffer(req.body, await meetingsDb.loadLookups());
    const force  = req.query.force === '1' || req.query.force === 'true';
    const result = await meetingsImportIncubation.commit(parsed, meetingsDb, {
      userSite:    _imp.site,
      force, userId: req.reportUser.id || null,
      author_name: req.reportUser.full_name || req.reportUser.username || 'incubation-import',
    });
    res.json({ ok: true, parse: parsed.summary, ...result, validation_errors: parsed.errors, warnings: parsed.warnings });
  } catch(e) { console.error('[Meetings] incubation commit error:', e.message); fail(res, e); }
});

// GET /api/meetings/progress — viewer+ — per-site×dept pre-brief diff
// Required: ?site=<code>&department=<code>
// Optional: &current_id=<id>     (the next meeting being prepared)
//           &asOf=YYYY-MM-DD      (pre-brief without a current draft)
router.get('/api/meetings/progress', requireReportSession, async (req, res) => {
  try {
    if (!meetingsDb) return res.status(503).json({ error: 'Meetings module not available' });
    if (!req.query.site || !req.query.department) {
      return res.status(400).json({ error: 'site and department query params required' });
    }
    const out = await meetingsDb.compareDepartment({
      site:       req.query.site,
      department: req.query.department,
      current_id: req.query.current_id || undefined,
      asOf:       req.query.asOf || undefined,
    });
    res.json(out);
  } catch(e) {
    console.error('[Meetings] progress error:', e.message);
    fail(res, e);
  }
});

// GET /api/meetings/:id/export-pptx — single-PV deck (4 slides)
// Cover + KPI strip + 3 priorities + attendees · Issues · Actions ·
// Projects + Sign-off + Next meeting.
// Returns a Buffer with mime `application/vnd.openxmlformats-officedocument.presentationml.presentation`.
// Filename derived from the meeting reference for readability in the
// browser's download bar (so coordinators don't email "download.pptx").
router.get('/api/meetings/:id/export-pptx', requireReportSession, async (req, res, next) => {
  // Same guard as GET /api/meetings/:id — let /progress/export-pptx fall
  // through to its specific route instead of matching :id="progress".
  if (!Number.isFinite(parseInt(req.params.id, 10))) return next();
  try {
    if (!meetingsDb)   return res.status(503).json({ error: 'Meetings module not available' });
    if (!meetingsPptx) return res.status(503).json({ error: 'PPTX generator not available' });
    const meeting = await meetingsDb.getMeeting(parseInt(req.params.id, 10));
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const lookups = await meetingsDb.loadLookups();
    const buf     = await meetingsPptx.generatePvPptx(meeting, lookups);
    // Sanitise the reference for the filename (no path separators or quote
    // characters; the rest is already snake-case / ASCII).
    const safe = String(meeting.reference || ('PV_' + meeting.id))
                  .replace(/[^\w.\-]+/g, '_').slice(0, 80);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.pptx"`);
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  } catch(e) {
    console.error('[Meetings] export-pptx error:', e.message);
    fail(res, e);
  }
});

// GET /api/meetings/progress/export-pptx — pre-brief deck (4 slides)
// Cover + KPI strip + history table · Standing issues · Resolved since ·
// New since + audit trail. Same query params as /progress.
router.get('/api/meetings/progress/export-pptx', requireReportSession, async (req, res) => {
  try {
    if (!meetingsDb)   return res.status(503).json({ error: 'Meetings module not available' });
    if (!meetingsPptx) return res.status(503).json({ error: 'PPTX generator not available' });
    if (!req.query.site || !req.query.department) {
      return res.status(400).json({ error: 'site and department query params required' });
    }
    const data = await meetingsDb.compareDepartment({
      site:       req.query.site,
      department: req.query.department,
      current_id: req.query.current_id || undefined,
      asOf:       req.query.asOf || undefined,
    });
    const lookups = await meetingsDb.loadLookups();
    const buf     = await meetingsPptx.generateProgressPptx(data, lookups);
    const safe = `Progress_${String(req.query.site).replace(/[^\w]/g, '_')}_${String(req.query.department).replace(/[^\w]/g, '_')}`
                  .slice(0, 80);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.pptx"`);
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  } catch(e) {
    console.error('[Meetings] progress export-pptx error:', e.message);
    fail(res, e);
  }
});


  return router;
};
