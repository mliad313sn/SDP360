'use strict';
// ─────────────────────────────────────────────────────────────────────────
// Digest send routes (POST /api/reports/{scoreboard,weekly,asset-group,asset-reminders}/send) — extracted from server.js (P06, monolith reduction). Same paths, same middleware chains, same
// answers (`app.` → `router.`); pinned by tests/p06-extraction-characterization.test.js and an unchanged
// authorisation matrix (docs/ops/authz-matrix.json). Mounted in server.js at the place the block sat.
// ─────────────────────────────────────────────────────────────────────────
const { fail } = require('../services/httpError');

module.exports = function digestSendRoutes(deps) {
  const { express, requireReportSession, requireSuperAdmin, getRdb } = deps;
  const router = express.Router();
  // POST /api/reports/scoreboard/send?preview=1|0 — admin-driven Preview / Send-now
  // for the per-coordinator operational scoreboard email. send-scoreboard.main()
  // resolves db/cfg/board itself and is disarmed-safe: a disabled config returns
  // {sent:0,reason:'disabled'} WITHOUT touching SMTP or the directory.
  router.post('/api/reports/scoreboard/send', requireReportSession, requireSuperAdmin, async (req, res) => {
    const _truthy = v => v === '1' || v === 1 || v === true || v === 'true';
    const preview = _truthy(req.query.preview) || _truthy(req.body?.preview);
    const force = _truthy(req.query.force) || _truthy(req.body?.force);
    try {
      const sendScoreboard = require('../tools/reports/send-scoreboard');
      res.json(await sendScoreboard.main({ preview, force }));
    } catch (e) {
      console.error('[api/reports/scoreboard/send]', e.message);
      fail(res, e);
    }
  });

  // POST /api/reports/weekly/send?preview=1|0 — admin-driven Preview / Send-now
  // for the per-coordinator AUTHORED WEEKLY report email. Same shape as the
  // scoreboard route above: send-weekly.main() resolves db/cfg/period itself and
  // is disarmed-safe — a disabled config returns {sent:0,reason:'disabled'}
  // WITHOUT touching the directory or SMTP.
  //
  // This is DELIBERATELY its own route and NOT a new entry in SEND_TYPES below.
  // POST /api/reports/send hardcodes sendCoordinatorReport regardless of `type`,
  // so whitelisting 'weekly_report' there would compose a MONTHLY report, mail
  // it, and log it under report_type='weekly_report' — a wrong-content success
  // that would poison the dedup lane so the real weekly could never send for
  // that period. Keep the two pipelines apart.
  router.post('/api/reports/weekly/send', requireReportSession, requireSuperAdmin, async (req, res) => {
    const _truthy = v => v === '1' || v === 1 || v === true || v === 'true';
    const preview = _truthy(req.query.preview) || _truthy(req.body?.preview);
    const force = _truthy(req.query.force) || _truthy(req.body?.force);
    try {
      const sendWeekly = require('../tools/reports/send-weekly');
      res.json(await sendWeekly.main({ preview, force }));
    } catch (e) {
      console.error('[api/reports/weekly/send]', e.message);
      fail(res, e);
    }
  });

  // POST /api/reports/asset-group/send?preview=1|0 — admin-driven Preview / Send-now
  // for the GROUP Assets digest (effort leaderboard + investment forecast) email.
  // Same shape as the scoreboard/weekly routes above: send-asset-group.main()
  // resolves db/cfg/period itself and is disarmed-safe — a disabled config returns
  // {sent:0,reason:'disabled'} WITHOUT touching the directory or SMTP. It is its
  // OWN route deliberately: POST /api/reports/send hardcodes sendCoordinatorReport,
  // so whitelisting 'asset_group' there would mail wrong content + poison dedup.
  router.post('/api/reports/asset-group/send', requireReportSession, requireSuperAdmin, async (req, res) => {
    const _truthy = v => v === '1' || v === 1 || v === true || v === 'true';
    const preview = _truthy(req.query.preview) || _truthy(req.body?.preview);
    const force = _truthy(req.query.force) || _truthy(req.body?.force);
    try {
      const sendAssetGroup = require('../tools/reports/send-asset-group');
      res.json(await sendAssetGroup.main({ preview, force }));
    } catch (e) {
      console.error('[api/reports/asset-group/send]', e.message);
      fail(res, e);
    }
  });

  // POST /api/reports/asset-reminders/send?type=asset_reminder|asset_new_alert&site=CODE&preview=1|0&force=1
  // Admin Preview / Send-now for the asset engagement reminders (weekly recap per
  // site · same-day new-hardware alert). Its OWN route (never SEND_TYPES —
  // /api/reports/send hardcodes the coordinator composer, so whitelisting a type
  // there would mail wrong content + poison dedup). Disarm-safe: a disabled config
  // returns {sent:0, reason:'disabled'}; preview ignores the gate and never mails
  // or logs. Injects the already-loaded reportsDb/assetsDb handles so the CLI core
  // never re-runs initPgReports()/initPgAssets() in-process.
  router.post('/api/reports/asset-reminders/send', requireReportSession, requireSuperAdmin, async (req, res) => {
    const _truthy = v => v === '1' || v === 1 || v === true || v === 'true';
    const type = String(req.query.type || req.body?.type || 'asset_reminder');
    if (!['asset_reminder', 'asset_new_alert'].includes(type)) {
      return res.status(400).json({ error: 'type must be asset_reminder or asset_new_alert' });
    }
    const preview = _truthy(req.query.preview) || _truthy(req.body?.preview);
    const force = _truthy(req.query.force) || _truthy(req.body?.force);
    const site = String(req.query.site || req.body?.site || '').trim() || undefined;
    try {
      const assetsDb = require('../assets-db');
      res.json(await require('../tools/reports/send-asset-reminders').main({
        type, site, preview, force, args: {}, reportsDb: getRdb(), db: getRdb().db, assetsDb,
      }));
    } catch (e) {
      console.error('[api/reports/asset-reminders/send]', e.message);
      fail(res, e);
    }
  });

  return router;
};
