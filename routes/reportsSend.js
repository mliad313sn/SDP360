'use strict';
// ---------------------------------------------------------------------------
// Report send routes - extracted from server.js (SDP-DASH-2.0 step 5, lot 5.3b, 2026-10-22).
// /api/reports/{scoreboard,weekly,asset-group,asset-reminders}/send, /api/reports/send
// (coordinator) and /api/reports/test-smtp. Handlers unchanged (`app.` became `router.`).
// The four digest routes used to sit higher in server.js, among the assets routes; only POST
// routes, none shadowed by anything registered in between, so the move is order-neutral.
// ---------------------------------------------------------------------------
module.exports = function reportsSendRoutes(deps) {
  const { express, rdb, requireReportSession, requireSuperAdmin, reportConfig } = deps;
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
        type, site, preview, force, args: {}, reportsDb: rdb, db: rdb.db, assetsDb,
      }));
    } catch (e) {
      console.error('[api/reports/asset-reminders/send]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/reports/send?type=coordinator&site=<CODE>[&preview=1][&force=1]
  // A THIN wrapper over services/sendCoordinator — the pipeline (safety gate,
  // dedup, best-effort PDF, outcome logging) lives there and is shared with the
  // scheduled CLI. Everything that identifies the send is a query param; the only
  // body is the OPTIONAL recipient selection {recipients:{to,cc}}, which the
  // global express.json() already parses — no route-specific parser is needed.
  // The selection is passed straight through and re-validated inside the pipeline
  // against that site's directory row: this route does NOT vet it, and must not
  // be mistaken for the enforcement point.
  const { sendCoordinatorReport } = require('../services/sendCoordinator');
  const SEND_TYPES = ['coordinator'];   // 'finance' lands in sub-project 4
  router.post('/api/reports/send', requireReportSession, requireSuperAdmin, async (req, res) => {
    const type = String(req.query.type || '');
    const site = String(req.query.site || '').trim();
    if (!SEND_TYPES.includes(type)) return res.status(400).json({ error: `invalid type "${type}" — expected one of: ${SEND_TYPES.join(', ')}` });
    if (!site) return res.status(400).json({ error: 'site is required' });

    const now = new Date();
    const year  = +(req.query.year || now.getFullYear());
    const month = +(req.query.month || (now.getMonth() + 1));
    const period = `${year}-${String(month).padStart(2, '0')}`;
    // Optional — omit it and the send behaves exactly as the scheduled CLI's.
    const recipients = (req.body && req.body.recipients) || undefined;

    // Single latch guarding EVERY exit path — the timer and the pipeline race,
    // and a double res.* would throw ERR_HTTP_HEADERS_SENT.
    let responded = false;
    const t0 = Date.now();
    // The IIS ARR proxy in front of us is set to 5 min (see CLAUDE.md), so the
    // Node cap must fire FIRST — otherwise the client gets an opaque 502 from
    // IIS instead of a diagnosable 504 from us. Same rationale as exec-pptx.
    const TIMEOUT_MS = parseInt(process.env.REPORT_SEND_TIMEOUT_MS || '120000', 10);
    const timer = setTimeout(() => {
      if (responded) return;
      responded = true;
      console.error(`[report-send] FAIL site=${site} period=${period} reason=timeout after ${Math.round((Date.now() - t0) / 1000)}s`);
      res.status(504).json({ error: `report send exceeded ${TIMEOUT_MS / 1000}s budget — raise REPORT_SEND_TIMEOUT_MS in .env if the PDF render is genuinely slow.` });
    }, TIMEOUT_MS);

    try {
      const out = await sendCoordinatorReport({
        db: rdb.db, site, period, recipients,
        preview: req.query.preview === '1',
        force: req.query.force === '1',
      });
      if (responded) return;                 // the timeout already answered
      responded = true; clearTimeout(timer);
      res.json(out);                         // {preview}|{skipped}|{ok} all → 200
    } catch (e) {
      if (responded) return;
      responded = true; clearTimeout(timer);
      console.error(`[report-send] FAIL site=${site} period=${period} reason=${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // Tests the settings the admin is LOOKING AT, not only the last-saved ones:
  // the form's values (if posted) are overlaid on the stored config. Previously
  // this read only the saved config, so testing before Save silently probed an
  // empty host — which nodemailer turns into `ECONNREFUSED 127.0.0.1:587`.
  // The password field is deliberately never echoed back to the browser
  // (reports.html), so a blank one means "keep the stored secret" — the exact
  // rule the Save path already uses.
  router.post('/api/reports/test-smtp', requireReportSession, requireSuperAdmin, async (req, res) => {
    try {
      const { buildMailer } = require('../services/mailer');
      const cfg = Object.assign({}, await reportConfig.getConfig(rdb.db));
      const body = req.body || {};
      for (const k of ['transport', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'from', 'reply_to']) {
        if (body[k] !== undefined && body[k] !== null) cfg[k] = String(body[k]);
      }
      if (body.smtp_pass) cfg.smtp_pass = String(body.smtp_pass);
      res.json(await buildMailer(cfg).verify());
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
