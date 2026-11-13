'use strict';
// P9 / goal B7 — ONE export policy: module × format × role → allow / mask / deny.
//
// Every data-export route (Excel, PowerPoint, PDF, CSV, JSON dump, printable HTML) mounts `gate(id)` as the
// last middleware before its handler. The gate:
//   1. decides allow / mask / deny for the session user from the CATALOGUE below (deny → 403 via httpError);
//   2. publishes the decision on req.exportPolicy = { id, module, decision, money, strict, watermark } — the
//      handlers that carry amounts read `req.exportPolicy.money` instead of their own role test, so the amount
//      rule has one source (invariant 2: admin tier + finance-viewer);
//   3. logs every delivered export to system_log, category `export` (who, module, format, site scope, row count
//      — null when unknown, never 0), fire-and-forget;
//   4. stamps a watermark (user + UTC timestamp) on the file while export_watermark_enabled = '1'
//      (services/exportWatermark.js).
//
// TWO matrices:
//   • DEFAULT (export_policy_strict = '0', today): reproduces today's behaviour exactly. The route's own guard
//     (requireMoneyRead, requireAdmin, site-scope helpers…) still decides who reaches it; the policy never denies
//     anyone who reaches the gate (business-only accounts never do — services/businessGuard refuses them before),
//     and the amount rule is today's (including the documented portfolio exception: a committee-member sees
//     project amounts — GAP-MATRIX invariant 2 deviation).
//   • STRICT (export_policy_strict = '1') — PROPOSED for the data owner / security, NOT approved: closes the
//     incoherences listed in `strict` (viewer PV deck, viewer action register, fleet-wide risk register for a
//     site account…) and applies the amount rule without exception (admin tier + finance-viewer only).
// The sensitivity matrix itself is a human decision (data owner + security). Nothing here claims it is adopted.

const { fail } = require('./httpError');

// amounts: 'none'   — the file carries no amount;
//          'gated'  — the route itself already requires an amount reader (requireMoneyRead / finance admin);
//          'masked' — the file carries amounts, stripped by the handler when req.exportPolicy.money is false.
// legacyMoney: 'committee' — today a committee-member also reads the amounts of this export (default matrix only).
// strict: { minTier: 'editor' | 'admin', orRoles: [...] , why } — PROPOSED stricter row; absent = same as today.
const CATALOGUE = Object.freeze({
  // ── Assets (server.js) ──
  'assets.inventory':           { module: 'assets',     formats: ['xlsx'], amounts: 'gated', today: 'requireMoneyRead' },
  'assets.hygiene':             { module: 'assets',     formats: ['xlsx'], amounts: 'none',  today: 'session' },
  'assets.hardware':            { module: 'assets',     formats: ['xlsx'], amounts: 'none',  today: 'session' },
  'assets.finance':             { module: 'assets',     formats: ['xlsx'], amounts: 'gated', today: 'requireMoneyRead' },
  'assets.finance_outliers':    { module: 'assets',     formats: ['xlsx'], amounts: 'gated', today: 'requireMoneyRead' },
  'assets.licences':            { module: 'assets',     formats: ['xlsx'], amounts: 'gated', today: 'requireMoneyRead' },
  'assets.software':            { module: 'assets',     formats: ['xlsx'], amounts: 'none',  today: 'session' },
  'assets.reconcile':           { module: 'assets',     formats: ['xlsx'], amounts: 'none',  today: 'session' },
  'assets.investment':          { module: 'assets',     formats: ['xlsx'], amounts: 'gated', today: 'requireMoneyRead' },
  // ── Reports / decks (server.js, routes/siteActions.js, routes/sites.js) ──
  'reports.system_log':         { module: 'reports',    formats: ['json', 'csv'], amounts: 'none', today: 'system-log gate (super_admin / audit-viewer)' },
  'reports.weekly_pptx':        { module: 'reports',    formats: ['pptx'], amounts: 'none',  today: 'session + report site read guard' },
  'reports.monthly_all_pptx':   { module: 'reports',    formats: ['pptx'], amounts: 'none',  today: 'requireAdmin' },
  'reports.monthly_pptx':       { module: 'reports',    formats: ['pptx'], amounts: 'none',  today: 'session + site read guard' },
  'reports.weekly_summary_pptx':{ module: 'reports',    formats: ['pptx'], amounts: 'none',  today: 'requireAdmin' },
  'reports.exec_new_pptx':      { module: 'reports',    formats: ['pptx'], amounts: 'none',  today: 'report-author' },
  'reports.exec_pptx':          { module: 'reports',    formats: ['pptx'], amounts: 'none',  today: 'deck builder gate' },
  'reports.site_actions':       { module: 'reports',    formats: ['xlsx'], amounts: 'none',  today: 'session + site read (a viewer of the site exports the action register)',
    strict: { minTier: 'editor', why: 'action register export: editor of the site or admin tier (viewer reads on screen only)' } },
  'reports.site_master':        { module: 'reports',    formats: ['csv', 'json'], amounts: 'none', today: 'super_admin' },
  'reports.studio_run':         { module: 'reports',    formats: ['html', 'pdf', 'csv', 'pptx', 'xlsx'], amounts: 'none', today: 'session + published/site visibility' },
  // ── Meetings / Inspection ──
  'meetings.table':             { module: 'meetings',   formats: ['xlsx'], amounts: 'none',  today: 'editor on own sites, admin tier any' },
  'meetings.pv_pptx':           { module: 'meetings',   formats: ['pptx'], amounts: 'none',  today: 'session + site read (a viewer exports a PV deck)',
    strict: { minTier: 'editor', why: 'PV deck export: editor of the site or admin tier (viewer reads on screen only)' } },
  'meetings.progress_pptx':     { module: 'meetings',   formats: ['pptx'], amounts: 'none',  today: 'session + meetings read scope (own sites)',
    strict: { minTier: 'editor', why: 'pre-brief deck export: editor of the site or admin tier (viewer reads on screen only)' } },
  'inspection.table':           { module: 'inspection', formats: ['xlsx'], amounts: 'none',  today: 'editor on own sites, admin tier any' },
  'inspection.aggregate_pptx':  { module: 'inspection', formats: ['pptx'], amounts: 'none',  today: 'editor on own sites, admin tier any' },
  'inspection.single_pptx':     { module: 'inspection', formats: ['pptx'], amounts: 'none',  today: 'editor on own site, admin tier any' },
  // ── Tracker / generic trackers / dashboards ──
  'tracker.pptx':               { module: 'tracker',    formats: ['pptx'], amounts: 'none',  today: 'admin | tracker-admin' },
  'trackers.xlsx':              { module: 'trackers',   formats: ['xlsx'], amounts: 'none',  today: 'session + tracker read' },
  'trackers.pptx':              { module: 'trackers',   formats: ['pptx'], amounts: 'none',  today: 'session + tracker read' },
  'trackers.legacy_compare':    { module: 'trackers',   formats: ['csv', 'json'], amounts: 'none', today: 'tracker builder' },
  'dashboards.csv':             { module: 'dashboards', formats: ['csv'],  amounts: 'none',  today: 'session + dashboard read' },
  // ── WAN SLA ──
  'wan_sla.outages':            { module: 'wan_sla',    formats: ['csv', 'xlsx'], amounts: 'none', today: 'session, rows filtered to the reader sites' },
  'wan_sla.outages_filtered':   { module: 'wan_sla',    formats: ['xlsx'], amounts: 'none',  today: 'session (formats rows posted by the page)' },
  'wan_sla.claim_evidence':     { module: 'wan_sla',    formats: ['csv', 'html', 'pdf'], amounts: 'masked', today: 'claims gate; amounts admin tier + finance-viewer' },
  // ── Risk register ──
  'risk_register.xlsx':         { module: 'risk_register', formats: ['xlsx'], amounts: 'none', today: 'session (fleet-wide occurrence table)',
    strict: { minTier: 'admin', orRoles: ['executive'], why: 'fleet-wide risk register: admin tier (a site account would read every site)' } },
  // ── Finance ──
  'finance.certifications':     { module: 'finance',    formats: ['xlsx'], amounts: 'gated', today: 'requireMoneyRead + switch' },
  'finance.actuals_batch':      { module: 'finance',    formats: ['xlsx'], amounts: 'gated', today: 'finance admin + switch' },
  // ── Governance / portfolio / PPM ──
  'governance.minutes':         { module: 'governance', formats: ['html', 'pdf'], amounts: 'none', today: 'session + session site scope' },
  'governance.oversight':       { module: 'governance', formats: ['csv', 'json'], amounts: 'none', today: 'committee' },
  'governance.portfolio_deck':  { module: 'governance', formats: ['pptx'], amounts: 'masked', legacyMoney: 'committee', today: 'session; amounts admin tier + committee + finance-viewer' },
  'governance.portfolio_workbook': { module: 'governance', formats: ['xlsx'], amounts: 'masked', legacyMoney: 'committee', today: 'session; amounts admin tier + committee + finance-viewer' },
  'governance.portfolio_report':{ module: 'governance', formats: ['html'], amounts: 'masked', legacyMoney: 'committee', today: 'session; amounts admin tier + committee + finance-viewer' },
  'governance.raci':            { module: 'governance', formats: ['csv'],  amounts: 'none',  today: 'session + project read' },
  'governance.annual_pack':     { module: 'governance', formats: ['xlsx'], amounts: 'masked', legacyMoney: 'committee', today: 'switch; amounts admin tier + committee + finance-viewer' },
});

const TIERS = ['viewer', 'editor', 'admin'];   // reports-db hierarchy: admin includes executive + super_admin

function _hasRoleDefault(u, r) {
  try { return !!require('../reports-db').userHasRole(u, r); } catch (_) { return false; }
}
function _isBusinessOnly(u) {
  try { return require('../public/lib/businessRoles').isBusinessOnly((u && u.roles) || []); } catch (_) { return false; }
}

/** Invariant 2 — amounts for the admin tier and finance-viewer. In the default matrix an export marked
 *  legacyMoney 'committee' keeps today's wider rule (committee-member too). */
function moneyVisible(user, id, { strict = false, hasRole = _hasRoleDefault } = {}) {
  if (!user) return false;
  const base = hasRole(user, 'admin') || hasRole(user, 'finance-viewer');
  const e = CATALOGUE[id];
  if (!strict && e && e.legacyMoney === 'committee') return base || hasRole(user, 'committee-member');
  return base;
}

/** → { decision: 'allow' | 'mask' | 'deny', money, reason }. Pure given hasRole. */
function decide(user, id, { strict = false, hasRole = _hasRoleDefault } = {}) {
  const e = CATALOGUE[id];
  if (!e) return { decision: 'allow', money: moneyVisible(user, id, { strict, hasRole }), reason: 'uncatalogued' };
  if (!user) return { decision: 'deny', money: false, reason: 'no session' };
  if (_isBusinessOnly(user)) return { decision: 'deny', money: false, reason: 'business-only account' };
  if (strict && e.strict) {
    const need = TIERS.indexOf(e.strict.minTier);
    const ok = (need < 0 || hasRole(user, e.strict.minTier)) || (e.strict.orRoles || []).some((r) => hasRole(user, r));
    if (!ok) return { decision: 'deny', money: false, reason: e.strict.why };
  }
  const money = moneyVisible(user, id, { strict, hasRole });
  if (e.amounts === 'masked' && !money) return { decision: 'mask', money, reason: 'amounts restricted' };
  return { decision: 'allow', money, reason: null };
}

const on = (v) => String(v) === '1';
function _format(res, req) {
  const ct = String(res.getHeader('Content-Type') || '');
  if (/presentationml/.test(ct)) return 'pptx';
  if (/spreadsheetml/.test(ct)) return 'xlsx';
  if (/pdf/.test(ct)) return 'pdf';
  if (/csv/.test(ct)) return 'csv';
  if (/html/.test(ct)) return 'html';
  if (/json/.test(ct)) return 'json';
  return (req.params && req.params.fmt) || 'other';
}
function _siteScope(req) {
  const q = req.query || {}, p = req.params || {}, b = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? req.body : {};
  const explicit = q.site || p.site_id || (b.filters && b.filters.site) || null;
  if (explicit) return String(explicit);
  const u = req.reportUser || {};
  if (_hasRoleDefault(u, 'admin')) return 'all';
  const ids = Array.isArray(u.site_ids) && u.site_ids.length ? u.site_ids : (u.site_id != null ? [u.site_id] : []);
  return ids.length ? 'sites:' + ids.join(',') : 'none';
}
function _rowsOf(chunk, format) {
  if (chunk == null) return null;
  if (chunk.exportRows != null) return chunk.exportRows;   // services/tableExcel.buildWorkbook tags its buffer
  if (format === 'csv') {
    const s = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    const n = s.split(/\r?\n/).filter((l) => l.trim() !== '').length;
    return n > 0 ? n - 1 : 0;
  }
  if (format === 'json') {
    try { const j = JSON.parse(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)); if (Array.isArray(j)) return j.length; if (j && Array.isArray(j.rows)) return j.rows.length; } catch (_) { /* unknown */ }
  }
  return null;
}

/** Express middleware. opts.skip(req) → true lets a shared path fall through untouched (e.g. /:id vs /progress). */
function gate(id, opts = {}) {
  if (!CATALOGUE[id]) throw new Error('exportPolicy: uncatalogued export id ' + id);
  const e = CATALOGUE[id];
  async function exportPolicyGate(req, res, next) {
    if (opts.skip && opts.skip(req)) return next();
    let cfg = {};
    try { const rdb = require('../reports-db'); cfg = await require('./reportConfig').getConfig(rdb.db); } catch (_) { cfg = {}; }
    const strict = on(cfg.export_policy_strict);
    const d = decide(req.reportUser, id, { strict });
    if (d.decision === 'deny') return fail(res, new Error('Export not allowed by the export policy: ' + d.reason), 403, { ok: false, export_policy: { id, decision: 'deny', strict } });
    const u = req.reportUser || {};
    const watermark = on(cfg.export_watermark_enabled) ? `Export · ${u.username || 'unknown'} · ${new Date().toISOString()}` : null;
    const first = !req.exportPolicy;
    req.exportPolicy = { id, module: e.module, decision: d.decision, money: d.money, strict, watermark };
    if (!first) return next();   // a second gate on the same request (shared path) updates the decision only
    let captured = null;
    const origEnd = res.end;
    res.end = function (chunk, encoding, cb) {
      if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
      captured = chunk;
      const wm = req.exportPolicy && req.exportPolicy.watermark;
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      if (!wm || !ok || chunk == null || res.headersSent) return origEnd.call(res, chunk, encoding, cb);
      const W = require('./exportWatermark');
      Promise.resolve(W.apply(chunk, String(res.getHeader('Content-Type') || ''), wm))
        .then((out) => {
          res.setHeader('X-Export-Watermark', encodeURIComponent(wm));
          if (out !== chunk) { captured = out; if (out && out.exportRows == null && chunk.exportRows != null) { try { Object.defineProperty(out, 'exportRows', { value: chunk.exportRows }); } catch (_) { /* rows unknown */ } } res.setHeader('Content-Length', String(Buffer.isBuffer(out) ? out.length : Buffer.byteLength(String(out), encoding || 'utf8'))); }
          origEnd.call(res, out, encoding, cb);
        })
        .catch(() => origEnd.call(res, chunk, encoding, cb));   // a watermark failure never costs the export
      return res;
    };
    res.on('finish', () => {
      try {
        if (res.statusCode < 200 || res.statusCode >= 300) return;
        const format = _format(res, req);
        const disp = String(res.getHeader('Content-Disposition') || '');
        if (format === 'json' && !/attachment/i.test(disp)) return;   // dual JSON/CSV routes: the JSON answer is not an export
        const rdb = require('../reports-db');
        if (!rdb || !rdb.logEvent) return;
        rdb.logEvent({ category: 'export', action: 'export_' + id.replace(/[^a-z0-9_.]/gi, '_'), target: e.module,
          details: { module: e.module, format, site_scope: _siteScope(req), rows: _rowsOf(captured, format), decision: req.exportPolicy.decision, strict, watermark: !!req.exportPolicy.watermark },
          ...rdb._logCtx(req) });
      } catch (_) { /* fire-and-forget */ }
    });
    next();
  }
  return exportPolicyGate;
}

module.exports = { CATALOGUE, decide, moneyVisible, gate, _rowsOf, _siteScope };
