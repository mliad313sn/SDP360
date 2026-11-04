'use strict';
const { fail, typed } = require('../services/httpError');
// C-09 (F16 / F29 / G14 prep) — page usage facts, so the exec-surfaces keep/merge decision and the menu cut
// are made on numbers, not opinions.
//
//   POST /api/ux/page-view   {page}   any session — one `page_viewed` system_log row per user × page × day
//   GET  /api/ux/page-usage?days=30   super_admin  — distinct users per page per role tier (read-only)
//
// Always-on internal telemetry (no switch): it changes nothing a user sees. Privacy: actor = 'u<id>', actor_id,
// details {tier}; no name, no e-mail, no IP. The write is fire-and-forget (logEvent never throws).

const fs = require('fs');
const path = require('path');
const PU = require('../services/pageUsage');

function knownPages(publicDir) {
  const set = new Set();
  const walk = (dir, prefix) => {
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const d of names) {
      if (d.isFile() && /\.html$/i.test(d.name)) set.add((prefix + d.name.replace(/\.html$/i, '')).toLowerCase());
    }
  };
  walk(publicDir, '');
  return set;
}

module.exports = function pageUsageRoutes(deps) {
  const { express, requireReportSession, requireSuperAdmin } = deps;
  const router = express.Router();
  const rdb = () => deps.rdb || require('../reports-db');
  const gate = deps.viewGate || require('../services/viewLog').makeOncePerDay();
  const known = deps.knownPages || knownPages(path.join(__dirname, '..', 'public'));
  const today = deps.today || (() => new Date().toISOString().slice(0, 10));

  router.post('/api/ux/page-view', requireReportSession, (req, res) => {
    const page = PU.normalizePage(req.body && req.body.page, known);
    if (!page) return fail(res, typed('VALIDATION', 'unknown page'), 400, { ok: false });
    const u = req.reportUser || {};
    if (u.id == null) return res.json({ ok: true, logged: false });
    if (gate(`${u.id}|${page}`, today())) {
      rdb().logEvent({ category: 'ux', action: 'page_viewed', actor: 'u' + u.id, actor_id: u.id, target: page,
        details: { tier: PU.roleTier(u) }, ip: null });
      return res.json({ ok: true, logged: true });
    }
    res.json({ ok: true, logged: false });
  });

  router.get('/api/ux/page-usage', requireReportSession, requireSuperAdmin, async (req, res) => {
    try {
      const days = PU.clampDays(req.query.days);
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const rows = await rdb().pgHandle().prepare(
        `SELECT target, actor_id, details, ts FROM system_log WHERE category = 'ux' AND action = 'page_viewed' AND ts >= ?`
      ).all(since);
      res.json({ ok: true, days, since: since.slice(0, 10), ...PU.aggregate(rows) });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  return router;
};
module.exports.knownPages = knownPages;
