'use strict';
// ---------------------------------------------------------------------------
// Assets routes (/api/assets/*) - extracted from server.js (SDP-DASH-2.0 step 5,
// server.js split, 2026-10-21). Same dependency-injection pattern as routes/inspection.js:
// handlers unchanged, `app.` became `router.`, and the repository files served by
// /api/assets/reconcile/* are now resolved from the repository root (`..`).
// The four /api/reports/*/send routes that sat in the middle of this block stay in
// server.js, at the same place in the registration order.
// ---------------------------------------------------------------------------
const fs   = require('fs');
const path = require('path');
// reports-db is required here rather than injected: the router is mounted earlier in
// server.js than its `let rdb` declaration (handlers used to read it at request time).
const rdb  = require('../reports-db');

module.exports = function assetsRoutes(deps) {
  const {
    express, requireReportSession, requireAdmin, requireSuperAdmin, requireRole,
  } = deps;
  const router = express.Router();

  // ── ASSETS (Foundation) ──────────────────────────────────────────
  // Read routes require a session; the sync trigger requires admin. Every dual-backend
  // reader is awaited (Promise on ASSETS_BACKEND=postgres) — see tests/await-precedence.test.js.
  // G-11 — the money columns the enriched reader carries. Stripped for any session below
  // admin: the raw XOF strings are as much an amount as the converted ones, so both go.
  const _ASSET_MONEY_KEYS = ['purchase_cost', 'current_book_value', 'total_cost_of_ownership',
    'operational_cost', 'purchase_cost_usd', 'book_value_usd', 'tco_usd'];
  function _stripAssetMoney(row) {
    const out = { ...row };
    for (const k of _ASSET_MONEY_KEYS) delete out[k];
    return out;
  }

  router.get('/api/assets/inventory', requireReportSession, async (req, res) => {
    try {
      const adb = require('../assets-db');
      const money = require('../services/money');
      // Whitelist the filter keys the reader understands; values ride as bound params.
      const q = {};
      for (const k of ['site', 'state', 'product_type', 'manufacturer', 'q']) {
        if (req.query[k] != null && req.query[k] !== '') q[k] = String(req.query[k]);
      }
      // Response stays a BARE ARRAY (the page consumes Array.isArray(rows)); we add
      // USD money fields per row. Reader returns raw XOF strings → convert once via
      // the configured rate (never rate 1). Owner/date fields ride through unchanged.
      const rows = await adb.getEnrichedAssets(q);
      // G-11 (owner decision, 2026-09-24) — the inventory stays open to every session,
      // because the engagement loop depends on a site asset manager reaching it, but the
      // MONEY only travels to admin+. A worklist without amounts is still a worklist;
      // that is already the rule on Hygiene.
      if (!require('../reports-db').userHasRole(req.reportUser, 'admin')) {
        return res.json(rows.map(r => _stripAssetMoney(r)));
      }
      const rate = await _assetUsdRate();
      res.json(rows.map(r => ({
        ...r,
        purchase_cost_usd: money.toUsd(r.purchase_cost, rate),
        book_value_usd:    money.toUsd(r.current_book_value, rate),
        tco_usd:           money.toUsd(r.total_cost_of_ownership, rate),
      })));
    } catch (e) {
      console.error('[api/assets/inventory]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/assets/lookups', requireReportSession, async (req, res) => {
    try {
      res.json(await require('../assets-db').getAssetLookups());
    } catch (e) {
      console.error('[api/assets/lookups]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── ASSETS · USAGE TRACE (G-06, audit 2026-09-24) ────────────────
  // system_log carried auth + report_* only, so "how many asset managers opened the
  // module in the last 30 days" — the engagement KPI the audit engine asks for — had no
  // answer, and nothing could tell whether the September asset work is actually used.
  // The read route is the module's front door, so it carries the trace; the gate keeps a
  // tab switch from writing a row every time (once per actor per day).
  // logEvent is fire-and-forget by contract — wrapped here too, so a broken journal can
  // never take down the request it rides on.
  const _assetsViewGate = require('../services/viewLog').makeOncePerDay();
  function _logAssetEvent(req, action, target, details) {
    try {
      const rdb = require('../reports-db');
      rdb.logEvent({ category: 'assets', action, target: target || null, details: details || null, ...rdb._logCtx(req) });
    } catch (e) { console.warn('[assets-log] swallowed:', e.message); }
  }
  function _logAssetsView(req) {
    try {
      const rdb = require('../reports-db');
      const ctx = rdb._logCtx(req);
      if (!_assetsViewGate(ctx.actor, new Date().toISOString().slice(0, 10))) return;
      _logAssetEvent(req, 'assets_viewed');
    } catch (e) { console.warn('[assets-log] swallowed:', e.message); }
  }

  router.get('/api/assets/summary', requireReportSession, async (req, res) => {
    try {
      const body = await require('../assets-db').getAssetSummary();
      _logAssetsView(req);
      res.json(body);
    } catch (e) {
      console.error('[api/assets/summary]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/assets/export.xlsx — the current inventory (SAME whitelisted filters
  // as /inventory) as a two-sheet workbook (Assets + Installed Software). The
  // software sheet is empty for now — the Foundation has no software table (it
  // moved to sub-project C); the sheet is emitted so the contract is stable.
  router.get('/api/assets/export.xlsx', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const adb = require('../assets-db');
      const money = require('../services/money');
      const { buildAssetWorkbook } = require('../services/assetExcel');
      const q = {};
      for (const k of ['site', 'state', 'product_type', 'manufacturer', 'q']) {
        if (req.query[k] != null && req.query[k] !== '') q[k] = String(req.query[k]);
      }
      // Same USD conversion as /inventory so the workbook carries USD money, not raw XOF.
      const rate = await _assetUsdRate();
      const rows = (await adb.getEnrichedAssets(q)).map(r => ({
        ...r,
        purchase_cost_usd: money.toUsd(r.purchase_cost, rate),
        book_value_usd:    money.toUsd(r.current_book_value, rate),
        tco_usd:           money.toUsd(r.total_cost_of_ownership, rate),
      }));
      const buf = buildAssetWorkbook(rows, []);
      _logAssetEvent(req, 'asset_export', 'inventory', { rows: rows.length, filters: q });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="assets.xlsx"');
      res.send(buf);
    } catch (e) {
      console.error('[api/assets/export.xlsx]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── ASSETS · FRESHNESS (G-03, audit 2026-09-24) ──────────────────
  // The register is full-replace-synced nightly at 04:30 and the effort snapshot is
  // chained after it, so an edit made in AssetExplorer is NOT visible here the same
  // minute. Without this line an asset manager reads a stale score as "my work did
  // nothing". `getLastSyncAt` is a dual-backend dispatcher → awaited. A job that never
  // ran reads null: the page says "jamais synchronisé", it never invents a date.
  router.get('/api/assets/sync-status', requireReportSession, async (req, res) => {
    try {
      const last_sync = await require('../reports-db').getLastSyncAt('assets_assets');
      res.json({ last_sync: last_sync || null, next_cron: '04:30', server_time: new Date().toISOString() });
    } catch (e) {
      console.error('[api/assets/sync-status]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── ASSETS · HYGIENE (sub-project B) ─────────────────────────────
  // Data-quality exception views over the enriched inventory. Same session guard +
  // same whitelisted filters as /inventory; every dual-backend reader is awaited.
  // Exceptions carry identity rows only — NO purchase_cost reaches the wire.
  const _assetHygieneFilters = (req) => {
    const q = {};
    for (const k of ['site', 'state', 'product_type', 'manufacturer', 'q']) {
      if (req.query[k] != null && req.query[k] !== '') q[k] = String(req.query[k]);
    }
    return q;
  };

  router.get('/api/assets/hygiene/summary', requireReportSession, async (req, res) => {
    try {
      res.json(await require('../assets-db').getHygieneSummary(_assetHygieneFilters(req)));
    } catch (e) {
      console.error('[api/assets/hygiene/summary]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/assets/hygiene/exceptions', requireReportSession, async (req, res) => {
    const adb = require('../assets-db');
    // Pre-validate BEFORE the try/catch: an unknown kind must be a 400, not the
    // catch's 500 (getHygieneExceptions throws on an unknown kind).
    const kind = String(req.query.kind || '');
    if (!adb.HYGIENE_KINDS[kind]) return res.status(400).json({ error: 'unknown kind' });
    try {
      res.json(await adb.getHygieneExceptions(kind, _assetHygieneFilters(req)));
    } catch (e) {
      console.error('[api/assets/hygiene/exceptions]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/assets/hygiene/export.xlsx?kind=all|<kind> — one sheet per hygiene kind
  // (kind=all, the default), or a single sheet for a specific valid kind. An unknown
  // specific kind → 400 (pre-validated). No cost column (getHygieneExceptions excludes it).
  router.get('/api/assets/hygiene/export.xlsx', requireReportSession, async (req, res) => {
    const adb = require('../assets-db');
    const kind = String(req.query.kind || 'all');
    if (kind !== 'all' && !adb.HYGIENE_KINDS[kind]) return res.status(400).json({ error: 'unknown kind' });
    try {
      const { buildWorkbook } = require('../services/tableExcel');
      const filters = _assetHygieneFilters(req);
      const keys = kind === 'all' ? Object.keys(adb.HYGIENE_KINDS) : [kind];
      const sheets = [];
      for (const key of keys) {
        sheets.push({ name: adb.HYGIENE_KINDS[key].label || key,
          rows: await adb.getHygieneExceptions(key, filters) });
      }
      const buf = buildWorkbook(sheets);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="assets-hygiene.xlsx"');
      res.send(buf);
    } catch (e) {
      console.error('[api/assets/hygiene/export.xlsx]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/assets/hygiene/send?preview=1|0 — admin-driven Preview / Send-now.
  // send-hygiene.main() resolves db/cfg/summary itself and is disarmed-safe: a
  // disabled config returns {sent:0,reason:'disabled'} WITHOUT touching SMTP.
  router.post('/api/assets/hygiene/send', requireReportSession, requireSuperAdmin, async (req, res) => {
    const _truthy = v => v === '1' || v === 1 || v === true || v === 'true';
    const preview = _truthy(req.query.preview) || _truthy(req.body?.preview);
    const force = _truthy(req.query.force) || _truthy(req.body?.force);
    try {
      const sendHygiene = require('../tools/reports/send-hygiene');
      res.json(await sendHygiene.main({ preview, force }));
    } catch (e) {
      console.error('[api/assets/hygiene/send]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── ASSETS · HARDWARE HEALTH (sub-project D) ─────────────────────────────
  // Fleet fitness views over the enriched inventory: low RAM, full system disk,
  // refresh-due, and workstations with no real monitor. Same session guard + same
  // whitelisted filters as /hygiene; every dual-backend reader is awaited.
  // Exceptions carry identity rows only — NO money reaches the wire.
  const _assetHardwareFilters = (req) => {
    const q = {};
    for (const k of ['site', 'state', 'product_type', 'manufacturer', 'q']) {
      if (req.query[k] != null && req.query[k] !== '') q[k] = String(req.query[k]);
    }
    return q;
  };

  router.get('/api/assets/hardware/summary', requireReportSession, async (req, res) => {
    try {
      res.json(await require('../assets-db').getHardwareHealthSummary(_assetHardwareFilters(req)));
    } catch (e) {
      console.error('[api/assets/hardware/summary]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/assets/hardware/exceptions', requireReportSession, async (req, res) => {
    const adb = require('../assets-db');
    // Pre-validate BEFORE the try/catch: an unknown kind must be a 400, not the
    // catch's 500 (getHardwareHealthExceptions throws on an unknown kind).
    const kind = String(req.query.kind || '');
    if (!adb.HARDWARE_KINDS[kind]) return res.status(400).json({ error: 'unknown kind' });
    try {
      res.json(await adb.getHardwareHealthExceptions(kind, _assetHardwareFilters(req)));
    } catch (e) {
      console.error('[api/assets/hardware/exceptions]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/assets/hardware/export.xlsx?kind=all|<kind> — one sheet per hardware kind
  // (kind=all, the default), or a single sheet for a specific valid kind. An unknown
  // specific kind → 400 (pre-validated). No money column (getHardwareHealthExceptions excludes it).
  router.get('/api/assets/hardware/export.xlsx', requireReportSession, async (req, res) => {
    const adb = require('../assets-db');
    const kind = String(req.query.kind || 'all');
    if (kind !== 'all' && !adb.HARDWARE_KINDS[kind]) return res.status(400).json({ error: 'unknown kind' });
    try {
      const { buildWorkbook } = require('../services/tableExcel');
      const filters = _assetHardwareFilters(req);
      const keys = kind === 'all' ? Object.keys(adb.HARDWARE_KINDS) : [kind];
      const sheets = [];
      for (const key of keys) {
        sheets.push({ name: adb.HARDWARE_KINDS[key].label || key,
          rows: await adb.getHardwareHealthExceptions(key, filters) });
      }
      const buf = buildWorkbook(sheets);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="assets-hardware.xlsx"');
      res.send(buf);
    } catch (e) {
      console.error('[api/assets/hardware/export.xlsx]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── ASSETS · FINANCE + LICENCES (Licence/Finance sub-project) ────────────────
  // Finance shows money in USD ONLY (raw XOF ×xof_usd_rate applied ONCE by the reader).
  // Licences show type families + expiry exceptions. Same session guard + whitelisted,
  // parameter-bound filters as the hygiene block; every dual-backend reader is awaited.
  const _assetFinanceFilters = (req) => {
    const q = {};
    for (const k of ['site', 'state', 'product_type', 'manufacturer', 'q']) {
      if (req.query[k] != null && req.query[k] !== '') q[k] = String(req.query[k]);
    }
    return q;
  };
  const _assetLicenceFilters = (req) => {
    const q = {};
    for (const k of ['site', 'family', 'state', 'q']) {
      if (req.query[k] != null && req.query[k] !== '') q[k] = String(req.query[k]);
    }
    return q;
  };
  // Resolve the XOF→USD rate from config, falling back to the DEFAULT (never to 1 —
  // rate 1 would mislabel raw XOF as USD). A blank/0/NaN admin value → the default.
  const _assetUsdRate = async () => {
    const reportConfig = require('../services/reportConfig');
    const rdb = require('../reports-db');
    let rate = parseFloat((await reportConfig.getConfig(rdb.db)).xof_usd_rate);
    if (!(rate > 0)) rate = parseFloat(reportConfig.DEFAULTS.xof_usd_rate);
    return rate;
  };

  router.get('/api/assets/finance/summary', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const adb = require('../assets-db');
      const rate = await _assetUsdRate();
      const s = await adb.getFinanceSummary(_assetFinanceFilters(req), rate);
      res.json({ ...s, rate });   // echo the applied rate so the page can label it
    } catch (e) {
      console.error('[api/assets/finance/summary]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // One-sheet USD-only workbook (no raw XOF ever leaves this route).
  router.get('/api/assets/finance/export.xlsx', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const adb = require('../assets-db');
      const { buildWorkbook } = require('../services/tableExcel');
      const rate = await _assetUsdRate();
      const s = await adb.getFinanceSummary(_assetFinanceFilters(req), rate);
      const buf = buildWorkbook([{ name: 'Finance by site', rows: s.by_site }]);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="assets-finance.xlsx"');
      res.send(buf);
    } catch (e) {
      console.error('[api/assets/finance/export.xlsx]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/assets/licences/summary', requireReportSession, requireAdmin, async (req, res) => {
    try {
      res.json(await require('../assets-db').getLicenceSummary(_assetLicenceFilters(req)));
    } catch (e) {
      console.error('[api/assets/licences/summary]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/assets/licences/exceptions', requireReportSession, requireAdmin, async (req, res) => {
    const adb = require('../assets-db');
    // Pre-validate BEFORE the try/catch: an unknown kind must be 400, not the catch's 500.
    const kind = String(req.query.kind || '');
    if (!adb.LICENCE_KINDS[kind]) return res.status(400).json({ error: 'unknown kind' });
    try {
      res.json(await adb.getLicenceExceptions(kind, _assetLicenceFilters(req)));
    } catch (e) {
      console.error('[api/assets/licences/exceptions]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/assets/licences/export.xlsx?kind=all|<kind> — one sheet per licence kind
  // (kind=all, the default), or a single sheet for a specific valid kind. Unknown specific
  // kind → 400 (pre-validated).
  router.get('/api/assets/licences/export.xlsx', requireReportSession, requireAdmin, async (req, res) => {
    const adb = require('../assets-db');
    const kind = String(req.query.kind || 'all');
    if (kind !== 'all' && !adb.LICENCE_KINDS[kind]) return res.status(400).json({ error: 'unknown kind' });
    try {
      const { buildWorkbook } = require('../services/tableExcel');
      const filters = _assetLicenceFilters(req);
      const keys = kind === 'all' ? Object.keys(adb.LICENCE_KINDS) : [kind];
      const sheets = [];
      for (const key of keys) {
        sheets.push({ name: adb.LICENCE_KINDS[key].label || key,
          rows: await adb.getLicenceExceptions(key, filters) });
      }
      const buf = buildWorkbook(sheets);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="assets-licences.xlsx"');
      res.send(buf);
    } catch (e) {
      console.error('[api/assets/licences/export.xlsx]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── ASSETS · SOFTWARE COMPLIANCE (Assets C-2, Task 2) ───────────────────────
  // Count-based, NO money on the wire. Mirrors the licence route block. Whitelisted,
  // parameter-bound filters (the readers bind); unknown kind PRE-VALIDATED to 400 on
  // both exceptions + export BEFORE the try/catch (never a 500).
  const _assetSoftwareFilters = (req) => {
    const q = {};
    for (const k of ['manufacturer', 'software_type', 'q']) {
      if (req.query[k] != null && req.query[k] !== '') q[k] = String(req.query[k]);
    }
    return q;
  };

  router.get('/api/assets/software/summary', requireReportSession, async (req, res) => {
    try {
      res.json(await require('../assets-db').getSoftwareComplianceSummary(_assetSoftwareFilters(req)));
    } catch (e) {
      console.error('[api/assets/software/summary]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/assets/software/exceptions', requireReportSession, async (req, res) => {
    const adb = require('../assets-db');
    // Pre-validate BEFORE the try/catch: an unknown kind must be 400, not the catch's 500.
    const kind = String(req.query.kind || '');
    if (!adb.SOFTWARE_KINDS[kind]) return res.status(400).json({ error: 'unknown kind' });
    try {
      res.json(await adb.getSoftwareComplianceExceptions(kind, _assetSoftwareFilters(req)));
    } catch (e) {
      console.error('[api/assets/software/exceptions]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/assets/software/export.xlsx?kind=all|<kind> — one sheet per software kind
  // (kind=all, the default), or a single sheet for a specific valid kind. Unknown specific
  // kind → 400 (pre-validated).
  router.get('/api/assets/software/export.xlsx', requireReportSession, async (req, res) => {
    const adb = require('../assets-db');
    const kind = String(req.query.kind || 'all');
    if (kind !== 'all' && !adb.SOFTWARE_KINDS[kind]) return res.status(400).json({ error: 'unknown kind' });
    try {
      const { buildWorkbook } = require('../services/tableExcel');
      const filters = _assetSoftwareFilters(req);
      const keys = kind === 'all' ? Object.keys(adb.SOFTWARE_KINDS) : [kind];
      const sheets = [];
      for (const key of keys) {
        sheets.push({ name: adb.SOFTWARE_KINDS[key].label || key,
          rows: await adb.getSoftwareComplianceExceptions(key, filters) });
      }
      const buf = buildWorkbook(sheets);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="assets-software.xlsx"');
      res.send(buf);
    } catch (e) {
      console.error('[api/assets/software/export.xlsx]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── ASSETS · PROGRESS (effort trend) ────────────────────────────────────────
  // Effort-trend views for the Progress dashboard tab. Same session guard as the
  // other assets routes; every dual-backend reader is awaited. The effort-history
  // table has NO product_type/state/manufacturer columns → only `site` narrows the
  // trend (whitelist below returns {} or {site} ONLY). The snapshot POST WRITES, so
  // it is admin-only.
  const _assetProgressFilters = (req) => {
    const q = {};
    if (req.query.site != null && req.query.site !== '') q.site = String(req.query.site);
    return q;
  };

  router.get('/api/assets/progress/leaderboard', requireReportSession, async (req, res) => {
    try {
      const adb = require('../assets-db');
      // asOf optional — the reader defaults to today when undefined.
      res.json(await adb.getEffortLeaderboard({ asOf: req.query.asOf ? String(req.query.asOf) : undefined }));
    } catch (e) {
      console.error('[api/assets/progress/leaderboard]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/assets/progress/trend', requireReportSession, async (req, res) => {
    try {
      const adb = require('../assets-db');
      // months: positive int, default 6 (guard NaN/≤0 → 6), capped at 36.
      let months = parseInt(req.query.months, 10);
      if (!Number.isFinite(months) || months <= 0) months = 6;
      if (months > 36) months = 36;
      res.json(await adb.getEffortTrend(_assetProgressFilters(req), { months }));
    } catch (e) {
      console.error('[api/assets/progress/trend]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST — captures an effort snapshot NOW (a manual "capture a point" for demos /
  // first baseline). Writes, so requireAdmin. Returns {date, sites}.
  router.post('/api/assets/progress/snapshot', requireReportSession, requireAdmin, async (req, res) => {
    try {
      res.json(await require('../assets-db').snapshotEffort({}));
    } catch (e) {
      console.error('[api/assets/progress/snapshot]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── ASSETS · RÉCONCILIATION (SDP × AD × Entra × Defender) ───────────────────
  // Répond à « quelles machines vues récemment ailleurs sont absentes de SDP ? »
  // — l'angle mort de SelfScan : un inventaire ne peut pas signaler ce qu'il
  // ignore. Et au sens inverse : quels actifs SDP plus personne ne voit.
  //
  // Tout l'assemblage vit dans le service PUR `services/reconcileView.js`, pas
  // ici : écrit dans un handler il ne serait vérifiable que par un smoke test
  // HTTP, donc pas vérifiable contre les vraies données.
  const RECONCILE_SOURCES = ['ad', 'entra', 'defender'];

  /**
   * `asOf` et les fenêtres, résolus UNE fois, en haut, puis passés partout.
   *
   * Le piège documenté de la dépréciation : `asOf` correct dans l'enveloppe de
   * réponse et `undefined` passé au lecteur. Ici c'est pire — `asOf` pilote la
   * fenêtre de fraîcheur, donc `undefined` ferait passer TOUTES les machines
   * pour « jamais vues » et le rapport serait absurde sans rien signaler.
   */
  async function _reconcileWindow(req) {
    const raw = String(req.query.asOf || '').trim();
    const asOf = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : new Date().toISOString().slice(0, 10);
    // `getConfig` prend le handle DB et est ASYNCHRONE (double backend) — même
    // forme que `_assetUsdRate`. L'appeler sans argument jette sur `db.exec`.
    const cfg = require('../services/reportConfig');
    const rdb = require('../reports-db');
    const cfgDays = parseInt((await cfg.getConfig(rdb.db)).reconcile_recent_days, 10);
    let recentDays = parseInt(req.query.recentDays, 10);
    if (!Number.isFinite(recentDays) || recentDays <= 0) recentDays = Number.isFinite(cfgDays) && cfgDays > 0 ? cfgDays : 30;
    if (recentDays > 365) recentDays = 365;
    let staleDays = parseInt(req.query.staleDays, 10);
    if (!Number.isFinite(staleDays) || staleDays <= 0) staleDays = 90;
    if (staleDays > 730) staleDays = 730;
    return { asOf, recentDays, staleDays };
  }

  /** Charge les trois entrées de la vue. Le filtre Site s'applique APRÈS. */
  async function _reconcileView(req) {
    const adb = require('../assets-db');
    const { buildReconcileView } = require('../services/reconcileView');
    const w = await _reconcileWindow(req);
    const [external, decisions] = await Promise.all([
      adb.listExternalDevices(),
      adb.listDecisions(),
    ]);
    // Le parc SDP en entier : la comparaison a besoin de TOUT pour décider
    // qu'une machine est absente. Filtrer ici transformerait « pas à ce site »
    // en « absente de l'inventaire ».
    const sdpAssets = await adb.getEnrichedAssets({});
    const v = buildReconcileView(Object.assign({ sdpAssets, externalDevices: external, decisions }, w));
    const site = String(req.query.site || '').trim();
    if (!site) return v;
    const keep = (s) => String(s || '').toUpperCase() === site.toUpperCase();
    return Object.assign({}, v, {
      gaps: v.gaps.filter((g) => keep(g.site)),
      by_site: v.by_site.filter((r) => keep(r.site)),
      by_ou: v.by_ou.filter((r) => keep(r.site)),
      retirement_candidates: v.retirement_candidates.filter((r) => keep(r.site)),
      filtered_site: site,
    });
  }

  // Le collecteur PowerShell et la requête KQL, servis depuis le dépôt pour que
  // la page n'en héberge aucune copie — deux copies divergent.
  const _RECONCILE_FILES = {
    'collector.ps1': ['tools/reconcile/Collect-ADComputers.ps1', 'Collect-ADComputers.ps1'],
    'defender.kql': ['tools/reconcile/DeviceInfo.kql', 'DeviceInfo.kql'],
  };
  for (const [route, [rel, filename]] of Object.entries(_RECONCILE_FILES)) {
    router.get('/api/assets/reconcile/' + route, requireReportSession, (req, res) => {
      try {
        const body = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(body);
      } catch (e) {
        console.error('[api/assets/reconcile/' + route + ']', e.message);
        res.status(500).json({ error: e.message });
      }
    });
  }

  router.get('/api/assets/reconcile/summary', requireReportSession, async (req, res) => {
    try {
      const adb = require('../assets-db');
      const v = await _reconcileView(req);
      res.json({
        counts: v.counts, by_site: v.by_site, by_ou: v.by_ou, by_type: v.by_type,
        excluded: v.excluded, window: v.window,
        // La fraîcheur des imports fait partie du chiffre : un écart calculé sur
        // un export d'il y a trois mois ne dit rien d'aujourd'hui.
        imports: await adb.listImportRuns(),
      });
    } catch (e) {
      console.error('[api/assets/reconcile/summary]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/assets/reconcile/gaps', requireReportSession, async (req, res) => {
    try {
      const v = await _reconcileView(req);
      res.json({ gaps: v.gaps, retirement_candidates: v.retirement_candidates,
        retirement_review: v.retirement_review, window: v.window });
    } catch (e) {
      console.error('[api/assets/reconcile/gaps]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Prévisualisation et import partagent le même parseur ; seule la
   * prévisualisation NE PERSISTE RIEN. C'est ce qui permet de vérifier un export
   * inconnu sans risquer d'écraser une source entière.
   */
  function _reconcileParse(req) {
    const src = String(req.query.source || '').trim().toLowerCase();
    if (!RECONCILE_SOURCES.includes(src)) {
      const e = new Error(`source inconnue « ${src || '(vide)'} » — attendu : ${RECONCILE_SOURCES.join(', ')}`);
      e.status = 400;
      throw e;
    }
    const imp = require('../services/reconcileImport');
    const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
    const fn = { ad: imp.parseAdCsv, entra: imp.parseEntraCsv, defender: imp.parseDefenderCsv }[src];
    return { src, parsed: fn(text) };
  }

  function _reconcileError(res, e, where) {
    const { MissingColumnError } = require('../services/reconcileImport');
    // Une colonne absente est une erreur de FICHIER, pas de serveur : 400 qui
    // NOMME la colonne. Un 500 enverrait l'opérateur chercher une panne.
    if (e instanceof MissingColumnError) return res.status(400).json({ error: e.message, column: e.column, source: e.source });
    if (e && e.status === 400) return res.status(400).json({ error: e.message });
    console.error(where, e.message);
    return res.status(500).json({ error: e.message });
  }

  router.post('/api/assets/reconcile/preview', requireReportSession, requireAdmin, (req, res) => {
    try {
      const { src, parsed } = _reconcileParse(req);
      res.json({
        source: src, rows: parsed.rows.length, skipped_no_name: parsed.skipped_no_name,
        warnings: parsed.warnings, header: parsed.header,
        sample: parsed.rows.slice(0, 20).map((r) => ({
          device_name: r.device_name, os: r.os, last_seen: r.last_seen, enabled: r.enabled, ou_dn: r.ou_dn,
        })),
      });
    } catch (e) { _reconcileError(res, e, '[api/assets/reconcile/preview]'); }
  });

  router.post('/api/assets/reconcile/import', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const { src, parsed } = _reconcileParse(req);
      const adb = require('../assets-db');
      // Le remplacement est porté PAR SOURCE : importer AD ne doit jamais
      // toucher Entra ni Defender.
      await adb.replaceExternalDevices(src, parsed.rows);
      const who = (req.reportUser && (req.reportUser.username || req.reportUser.full_name)) || null;
      // Journal append-only : une trace par dépôt, qui survit au remplacement.
      // `dated_count` — les lignes portant une date exploitable — est le seul
      // chiffre qui rende le sens inverse applicable.
      const datedCount = parsed.rows.filter((r) => r && r.last_seen && Number.isFinite(Date.parse(r.last_seen))).length;
      try { await adb.logImport({ source: src, row_count: parsed.rows.length, dated_count: datedCount, imported_by: who }); }
      catch (e) { console.error('[Reconcile] logImport', e.message); }
      // Capture du point de courbe pour aujourd'hui, APRÈS le remplacement, à
      // partir de la vue complète (idempotent par jour : le dernier import du
      // jour fige l'image complète des sources chargées). Non bloquant.
      try {
        const view = await _reconcileView({ query: {} });
        await adb.snapshotReconcile(view, who, {});
      } catch (e) { console.error('[Reconcile] snapshot', e.message); }
      console.log(`[Reconcile] import ${src} rows=${parsed.rows.length} dated=${datedCount} by=${req.reportUser && req.reportUser.username}`);
      res.json({ source: src, imported: parsed.rows.length, skipped_no_name: parsed.skipped_no_name, warnings: parsed.warnings });
    } catch (e) { _reconcileError(res, e, '[api/assets/reconcile/import]'); }
  });

  // Poser une décision est un acte d'ÉDITEUR (le coordinateur traite sa liste),
  // pas d'administrateur — contrairement à l'import, qui remplace une source
  // entière pour tout le monde.
  // RBAC audit 2026-10-02 (A16): an editor act — it had no role check at all.
  router.post('/api/assets/reconcile/decision', requireReportSession, requireRole('editor'), async (req, res) => {
    try {
      const b = req.body || {};
      const who = (req.reportUser && (req.reportUser.username || req.reportUser.full_name)) || null;
      const adb = require('../assets-db');
      if (b.decision === null || b.decision === '') { await adb.clearDecision(b.device_key); return res.json({ ok: true, cleared: true }); }
      await adb.setDecision(b.device_key, b.decision, b.reason, who);
      res.json({ ok: true });
    } catch (e) {
      // `setDecision` refuse une décision inconnue et un hors-périmètre sans
      // motif : ce sont des erreurs d'appelant, donc 400.
      console.error('[api/assets/reconcile/decision]', e.message);
      res.status(400).json({ error: e.message });
    }
  });

  // Historique de la réconciliation — la courbe des écarts dans le temps, +
  // le journal des imports. C'est ce qui transforme « 545 écarts » en « 545 →
  // 210 sur trois mois » : la preuve chiffrée que rattacher les GPO fonctionne.
  router.get('/api/assets/reconcile/history', requireReportSession, async (req, res) => {
    try {
      const adb = require('../assets-db');
      let months = parseInt(req.query.months, 10);
      if (!Number.isFinite(months) || months <= 0) months = 12;
      const [history, imports] = await Promise.all([
        adb.getReconcileHistory({ months }),
        adb.listImportLog(50),
      ]);
      res.json({ months, points: history.points, series_by_site: history.series_by_site, imports });
    } catch (e) {
      console.error('[api/assets/reconcile/history]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Capture manuelle — un point de secours (démo, première ligne de base) quand
  // on ne veut pas attendre le prochain import. Écrit, donc requireAdmin.
  router.post('/api/assets/reconcile/snapshot', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const adb = require('../assets-db');
      const who = (req.reportUser && (req.reportUser.username || req.reportUser.full_name)) || null;
      const v = await _reconcileView({ query: {} });
      res.json(await adb.snapshotReconcile(v, who, {}));
    } catch (e) {
      console.error('[api/assets/reconcile/snapshot]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/assets/reconcile/export.xlsx', requireReportSession, async (req, res) => {
    try {
      const v = await _reconcileView(req);
      const XLSX = require('xlsx');
      const wb = XLSX.utils.book_new();

      // Feuille de SYNTHÈSE en tête — le fichier doit se lire sans revenir à
      // l'écran, et surtout dire quand une section est « non applicable » plutôt
      // que de laisser croire à un zéro mesuré.
      const c = v.counts || {};
      const NM = { ad: 'Active Directory', entra: 'Entra ID', defender: 'Defender' };
      const srcLbl = (c.sources_present || []).map((s) => NM[s] || s).join(', ') || '(aucune)';
      const summaryRows = [
        { Indicateur: 'Généré le (as-of)', Valeur: v.window.as_of },
        { Indicateur: 'Fenêtre de fraîcheur (jours)', Valeur: v.window.recent_days },
        { Indicateur: 'Seuil de retrait (jours sans vue)', Valeur: v.window.stale_days },
        { Indicateur: 'Sources importées', Valeur: srcLbl },
        { Indicateur: '— Écarts à traiter', Valeur: c.gaps_open },
        { Indicateur: '— Écarts tranchés (traités / hors périmètre)', Valeur: c.gaps_decided },
        { Indicateur: '— Sites nommés touchés', Valeur: c.sites_touched },
        { Indicateur: '— OU à rattacher à une GPO', Valeur: c.ous_touched },
        {
          Indicateur: '— Candidats au retrait',
          // « Non applicable » explicite, jamais un 0 qui se lirait « rien à retirer ».
          Valeur: c.retirement_applicable === false ? 'Non applicable (aucune observation datée)' : c.retirement_candidates,
        },
        { Indicateur: '— écartés : renommés (à corriger, pas à retirer)', Valeur: c.retirement_excluded_renamed },
        { Indicateur: '— écartés : hors réseau (état ≠ In Use)', Valeur: c.retirement_excluded_off_network },
        { Indicateur: '— écartés : jamais scannés avec succès', Valeur: c.retirement_excluded_never_scanned },
        { Indicateur: '— écartés : matériel non joignable au domaine', Valeur: c.retirement_excluded_not_joinable },
      ];
      if (v.filtered_site) summaryRows.unshift({ Indicateur: 'Filtre site appliqué', Valeur: v.filtered_site });
      const sumWs = XLSX.utils.json_to_sheet(summaryRows);
      sumWs['!cols'] = [{ wch: 46 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(wb, sumWs, 'Synthèse');

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(v.gaps.map((g) => ({
        'Machine': g.device_name, 'Site présumé': g.site || '', 'Origine du site': g.site_source || '',
        'Type': g.type || '', 'Origine du type': g.type_source || '',
        'Système': g.os || '', 'Vue le': g.last_seen || '', 'Jours': g.age_days,
        'Sources': (g.sources || []).join(' + '), 'Conteneur AD': g.container_dn || '',
        'Décision': g.decision || '', 'Motif': g.reason || '',
      }))), 'Écarts');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(v.by_ou.map((r) => ({
        'Conteneur AD (unité GPO)': r.ou_dn, 'Écarts': r.gaps, 'Total AD': r.total, 'Site': r.site || '',
      }))), 'Par OU');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(v.retirement_candidates.map((r) => ({
        'Actif SDP': r.asset_name, 'Site': r.site || '', 'Vu ailleurs le': r.last_seen_external || 'jamais',
        'Jours': r.age_days == null ? '' : r.age_days,
      }))), 'Candidats au retrait');
      // Feuille « À vérifier » — les écartés, avec le motif : renommage (fiche à
      // corriger), hors réseau, jamais scanné. Rien ne disparaît sans explication.
      const RLBL = { renamed: 'Renommage probable', off_network: 'Hors réseau (état ≠ In Use)', never_scanned: 'Jamais scanné' };
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((v.retirement_review || []).map((r) => ({
        'Actif SDP': r.asset_name, 'Site': r.site || '', 'Motif': RLBL[r.reason] || r.reason,
        'État SDP': r.state || '', 'Service tag': r.serial_number || '',
      }))), 'À vérifier');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="reconciliation_${v.window.as_of}.xlsx"`);
      res.send(buf);
    } catch (e) {
      console.error('[api/assets/reconcile/export.xlsx]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── ASSETS · DEPRECIATION (Depreciation sub-project, Task 2) ─────────────────
  // Book value + annual schedule computed from purchase_cost + acquisition_date +
  // the admin-managed depreciation config; money CONVERTED to USD via the SAME
  // _assetUsdRate the finance routes use (never rate 1). asOf is an optional query
  // (reader defaults to today internally) and is echoed. Whitelisted, param-bound
  // filters; the config PUT validates before persisting (requireAdmin).
  const _assetDeprecFilters = (req) => {
    const q = {};
    // Honour ALL shared filters (the reader's _assetWhere applies every one). Same
    // whitelist as _assetFinanceFilters so the Finance book-value band + schedule
    // chart narrow on Manufacturer / Product Type / State, not just Site.
    for (const k of ['site', 'state', 'product_type', 'manufacturer', 'q']) {
      if (req.query[k] != null && req.query[k] !== '') q[k] = String(req.query[k]);
    }
    return q;
  };
  // Validate an incoming depreciation config: `default` object required, and for the
  // default AND every by_type entry — method ∈ METHODS, useful_life_months > 0,
  // salvage_pct (optional, default 0) in [0,1]. Any breach → false → 400.
  const _validDeprecCfg = (cfg) => {
    const { METHODS } = require('../services/depreciation');
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return false;
    if (!cfg.default || typeof cfg.default !== 'object') return false;
    const okEntry = (e) => {
      if (!e || typeof e !== 'object') return false;
      if (!METHODS[e.method]) return false;
      const life = Number(e.useful_life_months);
      if (!Number.isFinite(life) || !(life > 0)) return false;
      const sv = e.salvage_pct == null ? 0 : Number(e.salvage_pct);
      if (!Number.isFinite(sv) || sv < 0 || sv > 1) return false;
      return true;
    };
    if (!okEntry(cfg.default)) return false;
    const byType = cfg.by_type || {};
    if (typeof byType !== 'object' || Array.isArray(byType)) return false;
    for (const k of Object.keys(byType)) { if (!okEntry(byType[k])) return false; }
    return true;
  };
  const _deprecConfig = async () => {
    const reportConfig = require('../services/reportConfig');
    const rdb = require('../reports-db');
    return require('../services/depreciation')
      .parseDepreciationConfig((await reportConfig.getConfig(rdb.db)).asset_depreciation_config);
  };

  router.get('/api/assets/depreciation/summary', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const adb = require('../assets-db');
      const rate = await _assetUsdRate();
      const config = await _deprecConfig();
      // Default asOf to TODAY before it reaches the reader — the pure
      // computeDepreciation treats an undefined asOf as 0 months elapsed (full
      // cost, no depreciation), so resolving here is what makes the computed
      // book value actually depreciate. Echoed unchanged in the response.
      const asOf = req.query.asOf ? String(req.query.asOf) : new Date().toISOString().slice(0, 10);
      const s = await adb.getAssetDepreciation(_assetDeprecFilters(req), { config, rate, asOf });
      res.json({ ...s, rate, asOf });
    } catch (e) {
      console.error('[api/assets/depreciation/summary]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/assets/depreciation/schedule', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const adb = require('../assets-db');
      const rate = await _assetUsdRate();
      const config = await _deprecConfig();
      // Default asOf to TODAY before the reader (see summary route note).
      const asOf = req.query.asOf ? String(req.query.asOf) : new Date().toISOString().slice(0, 10);
      const sch = await adb.getDepreciationSchedule(_assetDeprecFilters(req), { config, rate, asOf });
      res.json({ ...sch, rate, asOf });
    } catch (e) {
      console.error('[api/assets/depreciation/schedule]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/assets/depreciation-config', requireReportSession, async (req, res) => {
    try {
      res.json(await _deprecConfig());
    } catch (e) {
      console.error('[api/assets/depreciation-config GET]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/api/assets/depreciation-config', requireReportSession, requireSuperAdmin, async (req, res) => {
    const cfg = req.body;
    // Validate BEFORE persist — an invalid config must be 400, not the catch's 500.
    if (!_validDeprecCfg(cfg)) return res.status(400).json({ error: 'invalid depreciation config' });
    try {
      const reportConfig = require('../services/reportConfig');
      const rdb = require('../reports-db');
      await reportConfig.setConfig(rdb.db, { asset_depreciation_config: JSON.stringify(cfg) }, req.reportUser?.username);
      res.json(cfg);
    } catch (e) {
      console.error('[api/assets/depreciation-config PUT]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── ASSETS · INVESTMENT & FORECAST ───────────────────────────────────────────
  // Historical CAPEX/OPEX curve + forward hardware-replacement & software-renewal
  // forecast. Money is USD (assets XOF ×_assetUsdRate; licence cost native USD).
  // The forecast grows replacement prices by an admin-managed annual uplift %; the
  // response ECHOES uplift_pct (as a percent, e.g. 3 for 0.03) so the UI can label
  // "prices grown X%/yr". Whitelisted, param-bound filters; the depreciation config
  // (already parsed) drives per-product-type useful life. Same session guard as the
  // hardware/finance blocks; every dual-backend reader is awaited.
  const _assetInvestmentFilters = (req) => {
    const q = {};
    for (const k of ['site', 'state', 'product_type', 'manufacturer', 'q']) {
      if (req.query[k] != null && req.query[k] !== '') q[k] = String(req.query[k]);
    }
    return q;
  };
  // Annual replacement-price uplift as a FRACTION (config stores a percent). Falls
  // back to 0 (no growth) on a blank/negative/NaN admin value.
  const _assetUpliftPct = async () => {
    const reportConfig = require('../services/reportConfig');
    const rdb = require('../reports-db');
    const p = Number((await reportConfig.getConfig(rdb.db)).asset_replacement_uplift_pct) / 100;
    return Number.isFinite(p) && p >= 0 ? p : 0;
  };

  router.get('/api/assets/investment/history', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const rate = await _assetUsdRate();
      res.json(await require('../assets-db').getInvestmentSummary(_assetInvestmentFilters(req), { rate }));
    } catch (e) {
      console.error('[api/assets/investment/history]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/assets/investment/forecast', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const adb = require('../assets-db');
      const config = await _deprecConfig();          // already parsed → pass straight through
      const upliftPct = await _assetUpliftPct();
      let horizon = parseInt(req.query.horizon, 10);
      if (!Number.isFinite(horizon) || horizon < 1) horizon = 5;   // default
      if (horizon > 15) horizon = 15;                              // clamp
      const asOf = new Date().toISOString().slice(0, 10);          // resolve BEFORE the reader
      const rate = await _assetUsdRate();
      const out = await adb.getInvestmentForecast(_assetInvestmentFilters(req),
        { config, rate, upliftPct, horizonYears: horizon, asOf });
      // Echo the uplift as a percent (e.g. 3 for 0.03) so the UI can label the growth.
      res.json({ ...out, uplift_pct: Math.round(upliftPct * 10000) / 100 });
    } catch (e) {
      console.error('[api/assets/investment/forecast]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Multi-sheet workbook: History + Hardware forecast + Software forecast. Each
  // forecast sheet is the year rows plus a "Due now" and a "Beyond horizon" row
  // (the Year column labels those two). Same horizon-clamp + config/rate/uplift reads
  // as the forecast route.
  router.get('/api/assets/investment/export.xlsx', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const adb = require('../assets-db');
      const { buildWorkbook } = require('../services/tableExcel');
      const filters = _assetInvestmentFilters(req);
      const rate = await _assetUsdRate();
      const config = await _deprecConfig();
      const upliftPct = await _assetUpliftPct();
      let horizon = parseInt(req.query.horizon, 10);
      if (!Number.isFinite(horizon) || horizon < 1) horizon = 5;
      if (horizon > 15) horizon = 15;
      const asOf = new Date().toISOString().slice(0, 10);

      const history = await adb.getInvestmentSummary(filters, { rate });
      const fcst = await adb.getInvestmentForecast(filters,
        { config, rate, upliftPct, horizonYears: horizon, asOf });

      const historyRows = (history.years || []).map(y => ({
        Year: y.year, 'Hardware (USD)': y.hardware_usd, 'Software (USD)': y.software_usd,
        'Total (USD)': y.total_usd, 'Cumulative (USD)': y.cumulative_usd,
      }));
      const hw = fcst.hardware || {};
      const hardwareRows = [
        ...(hw.years || []).map(y => ({ Year: y.year, 'Replacement (USD)': y.replacement_usd, Count: y.count })),
        { Year: 'Due now', 'Replacement (USD)': hw.due_now && hw.due_now.replacement_usd, Count: hw.due_now && hw.due_now.count },
        { Year: 'Beyond horizon', 'Replacement (USD)': hw.beyond_horizon && hw.beyond_horizon.usd, Count: hw.beyond_horizon && hw.beyond_horizon.count },
      ];
      const sw = fcst.software || {};
      const softwareRows = [
        ...(sw.years || []).map(y => ({ Year: y.year, 'Renewal (USD)': y.renewal_usd, Count: y.count })),
        { Year: 'Due now', 'Renewal (USD)': sw.due_now && sw.due_now.renewal_usd, Count: sw.due_now && sw.due_now.count },
        { Year: 'Beyond horizon', 'Renewal (USD)': sw.beyond_horizon && sw.beyond_horizon.usd, Count: sw.beyond_horizon && sw.beyond_horizon.count },
      ];

      const buf = buildWorkbook([
        { name: 'Spend history', rows: historyRows },
        { name: 'Hardware forecast', rows: hardwareRows },
        { name: 'Software forecast', rows: softwareRows },
      ]);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="assets-investment.xlsx"');
      res.send(buf);
    } catch (e) {
      console.error('[api/assets/investment/export.xlsx]', e.message);
      res.status(500).json({ error: e.message });
    }
  });


  return router;
};
