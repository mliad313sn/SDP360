'use strict';
const xpGate = require('../services/exportPolicy').gate;   // P9 / B7 — one export policy (allow / mask / deny + export log + watermark)
const { fail } = require('../services/httpError');
// Site Actions register hub — GET /api/reports/site-actions?site=CODE[&closed=1] (moved out of
// server.js, handler unchanged: composes the three action sources + open issues, folds Meridian links).
module.exports = function siteActionsRoutes(deps) {
  const { express, requireReportSession, siteCodeReadDenied, reportConfig } = deps;
  const router = express.Router();
  const json = express.json({ limit: '64kb' });
  const rdbM = () => deps.rdb || require('../reports-db');

  // P5 (B2) — the three sources + open issues of one site, as the hub composes them (export reuses it).
  async function composeSite(code, asOf) {
    const { buildSiteActions } = require('../services/siteActionsRegister');
    const rdb = rdbM();
    const meetings = await require('../meetings-db').listActions({ site: code });
    const inspection = await require('../inspection-db').listActions({ site: code });
    const resolved = await rdb.getSiteIdByModuleCode('meetings', code);
    const report = resolved && resolved.site_id ? { actions: (await rdb.getSiteOpenReportActions(resolved.site_id)).actions } : null;
    const issues = await require('../meetings-db').listIssues({ site: code, limit: 1000 });
    return buildSiteActions({ meetings, inspection, report, issues, asOf });
  }

  // P5 (B2) — GET /api/reports/site-actions/export.xlsx?site=CODE — the hub's open lines of ONE site, as Excel.
  // Same perimeter as the hub (siteCodeReadDenied: editor = own sites, admin tier = any). Explicit column list
  // (services/siteActionsRegister.exportRows): no amount, no comment — nothing to mask, and nothing can leak.
  router.get('/api/reports/site-actions/export.xlsx', requireReportSession, xpGate('reports.site_actions'), async (req, res) => {
    try {
      const code = String(req.query.site || '').trim();
      if (!code || code === 'all' || !/^[A-Za-z0-9_-]{1,16}$/.test(code)) return fail(res, new Error('site code required'), 400);
      if (await siteCodeReadDenied(req.reportUser, code)) return fail(res, new Error('Access denied: another site'), 403);
      const R = require('../services/siteActionsRegister');
      const rows = R.exportRows(await composeSite(code, new Date().toISOString().slice(0, 10)), code);
      const buf = require('../services/tableExcel').buildWorkbook([{ name: 'Site actions', rows: rows.length ? rows : [] }]);
      try { rdbM().logEvent({ category: 'report', action: 'site_actions_export', target: code, details: { rows: rows.length }, ...rdbM()._logCtx(req) }); } catch (_) { /* best-effort */ }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="site-actions-${code}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
      res.send(buf);
    } catch (e) { fail(res, e); }
  });

  // P5 (B2) — POST /api/reports/site-actions/bulk-status { items:[{source, id}], status, note?, helpdesk_ticket? }
  // LOOPS THE EXISTING PER-ITEM UPDATE ROUTES (same server, same session, same RBAC, same transfer-status justification
  // in public/lib/statusTransfer.js, same audit rows): nothing is decided here. Each line answers on its own; one
  // refused line never blocks the others. ≤ 50 lines per call.
  const BULK_MAX = 50;
  const bulkTarget = (src, id, status, note, ticket) => {
    if (src === 'meetings' && /^\d+$/.test(id)) return { path: `/api/meetings/actions/${id}/update`, body: { status_change: status, body: note || '', helpdesk_ticket: ticket || undefined } };
    if (src === 'inspections' && /^\d+$/.test(id)) return { path: `/api/inspection/actions/${id}/update`, body: { status_change: status, body: note || '' } };
    if (src === 'report' && /^[A-Za-z0-9_.-]{1,64}$/.test(id)) return { path: `/api/reports/action/${encodeURIComponent(id)}/status`, body: { status, note: note || '' } };
    return null;
  };
  // the caller's own session goes along, over loopback (services/selfDispatch); tests may inject deps.dispatch
  const loopback = (req, path, body) => (deps.dispatch ? deps.dispatch(req, path, body) : require('../services/selfDispatch').selfPost(req, path, body));
  router.post('/api/reports/site-actions/bulk-status', requireReportSession, json, async (req, res) => {
    try {
      const b = req.body || {};
      const items = Array.isArray(b.items) ? b.items : [];
      const status = String(b.status || '').trim();
      if (!items.length || !status) return fail(res, new Error('items and status are required'), 400);
      if (items.length > BULK_MAX) return fail(res, new Error(`at most ${BULK_MAX} lines per call`), 400);
      const results = [];
      for (const it of items) {
        const src = String((it && it.source) || ''), id = String((it && it.id) || '');
        const t = bulkTarget(src, id, status, b.note, b.helpdesk_ticket);
        if (!t) { results.push({ source: src, id, status: 400, error: 'unknown source or id' }); continue; }
        const r = await loopback(req, t.path, t.body);
        results.push({ source: src, id, status: r.status, ...(r.status >= 300 ? { error: (r.json && r.json.error) || 'refused' } : {}) });
      }
      const ok = results.filter((x) => x.status >= 200 && x.status < 300).length;
      try { rdbM().logEvent({ category: 'report', action: 'site_actions_bulk_status', target: status, details: { lines: results.length, ok }, ...rdbM()._logCtx(req) }); } catch (_) { /* best-effort */ }
      res.json({ ok: ok === results.length, done: ok, refused: results.length - ok, results });
    } catch (e) { fail(res, e); }
  });

  // P5 (B2) — POST /api/reports/site-actions/reassign { source, id, owner, justification } — change ONE action's owner.
  // Same write rule as the per-item update of its source: editor role, the action's site among the user's sites (admin
  // tier: any; a site-less account: nothing); a report follow-up also follows the report rule (submitted = frozen).
  // A justification of 10+ characters is mandatory; an audit row is written in the source's own history.
  router.post('/api/reports/site-actions/reassign', requireReportSession, json, async (req, res) => {
    try {
      const R = rdbM(); const u = req.reportUser; const b = req.body || {};
      const src = String(b.source || ''), id = String(b.id || ''), owner = String(b.owner || '').trim().slice(0, 200);
      const why = String(b.justification || '').trim();
      if (!owner) return fail(res, new Error('owner is required'), 400);
      if (why.length < 10) return fail(res, new Error('a justification (10+ characters) is required'), 400);
      if (!R.userHasRole(u, 'editor')) return fail(res, new Error('editor role required'), 403);
      const isAdmin = R.userHasRole(u, 'admin');
      const userSites = require('../services/userSites');
      const siteOk = async (code) => {
        if (isAdmin) return true;
        const hit = code ? await R.getSiteIdByModuleCode('meetings', code) : null;
        return !!(hit && hit.site_id && userSites.hasSite(u, hit.site_id));
      };
      const actor = { author_id: u.id || null, author_name: u.full_name || u.username, justification: why.slice(0, 1000) };
      let out, site = null;
      if (src === 'meetings' && /^\d+$/.test(id)) {
        const mdb = require('../meetings-db'); const p = await mdb.getActionParent(Number(id));
        if (!p) return fail(res, new Error('action not found'), 404);
        if (!(await siteOk(p.site_code))) return fail(res, new Error('Access denied: another site'), 403);
        site = p.site_code; out = await mdb.setActionOwner(Number(id), { owner, ...actor });
      } else if (src === 'inspections' && /^\d+$/.test(id)) {
        const idb = require('../inspection-db'); const p = await idb.getActionParent(Number(id));
        if (!p) return fail(res, new Error('action not found'), 404);
        if (!(await siteOk(p.site_code))) return fail(res, new Error('Access denied: another site'), 403);
        site = p.site_code; out = await idb.setActionOwner(Number(id), { owner, ...actor });
      } else if (src === 'report' && /^[A-Za-z0-9_.-]{1,64}$/.test(id)) {
        const o = await R.getActionItemOwner(id);
        if (!o) return fail(res, new Error('action not found'), 404);
        const denial = deps.reportWriteDenial ? deps.reportWriteDenial(u, { site_id: o.site_id, status: o.report_status }) : { status: 403, error: 'not available' };
        if (denial) return fail(res, new Error(denial.error), denial.status);
        out = await R.setActionOwner(id, owner);
        if (out.ok) { try { await R.logAudit({ report_id: o.report_id, site_id: o.site_id, user_id: u.id, username: u.username, action: 'action_owner_reassigned', details: { uid: id, from: out.previous, to: owner, justification: actor.justification } }); } catch (_) { /* audit best-effort, the system log below still records it */ } }
        site = String(o.site_id);
      } else return fail(res, new Error('unknown source or id'), 400);
      if (!out || !out.ok) return fail(res, new Error('action not found'), 404);
      try { R.logEvent({ category: 'report', action: 'action_owner_reassigned', target: `${src}:${id}`, details: { site, from: out.previous, to: owner, justification: actor.justification }, ...R._logCtx(req) }); } catch (_) { /* best-effort */ }
      res.json({ ok: true, previous: out.previous, owner });
    } catch (e) { fail(res, e); }
  });

  router.get('/api/reports/site-actions', requireReportSession, async (req, res) => {
  try {
    const { buildSiteActions } = require('../services/siteActionsRegister');
    const rdb = require('../reports-db');
    const meetingsDb = require('../meetings-db');
    const inspectionDb = require('../inspection-db');
    const code = String(req.query.site || '').trim();
    if (await siteCodeReadDenied(req.reportUser, code)) return res.status(403).json({ error: 'Access denied: another site' });
    const asOf = new Date().toISOString().slice(0, 10);
    if (!code || code === 'all') {
      return res.json({ site: code || null, week_label: null, ...buildSiteActions({ asOf }) });
    }
    // meetings + inspection share the 'meetings' namespace code (SMI/MGO/HGO…).
    const meetings = await meetingsDb.listActions({ site: code });
    const inspection = await inspectionDb.listActions({ site: code });
    // Report follow-ups = every open, non-merged follow-up across ALL the site's
    // reports, deduped by carry-forward lineage (SP1b-lignée) — so an open item
    // on an old report never carried forward still surfaces, once. Each row
    // carries its own report_id/week_label. resolved.site_id (NOT .id) — the
    // documented falsy-id pitfall.
    let report = null;
    const resolved = await rdb.getSiteIdByModuleCode('meetings', code);
    if (resolved && resolved.site_id) {
      report = { actions: (await rdb.getSiteOpenReportActions(resolved.site_id)).actions };
    }
    // Open issues of the site (resolved/cancelled are dropped by the engine) — the hub
    // shows who has no action yet and lets the user add one from the issue.
    const issues = await meetingsDb.listIssues({ site: code, limit: 1000 });
    const sa = buildSiteActions({ meetings, inspection, report, issues, asOf });
    // "Show closed / cancelled" (2026-10-16): the last 30 days, so a wrong click can be reopened.
    if (req.query.closed === '1') {
      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const closedReport = (resolved && resolved.site_id) ? await rdb.getSiteClosedReportActions(resolved.site_id, since) : null;
      sa.recent_closed = require('../services/siteActionsRegister').buildRecentlyClosed(
        { meetings, inspection, issues, report: closedReport, since });
      sa.recent_since = since;
    }
    // Best-effort: fold Meridian project links onto matching rows for the "▸ Projet: X"
    // badge (F1). NEVER blocks the hub — a Meridian outage/misconfig leaves every
    // it.project null. getConfig is a Promise on pg → await it.
    let links = {}, baseUrl = '';
    try {
      const cfg = await reportConfig.getConfig(rdb.db);
      if (String(cfg.meridian_enabled) !== '0') {   // A-20 kill switch: retired → no read-back, project stays null
        baseUrl = cfg.meridian_base_url || '';
        links = await require('../services/meridianLinks').getLinksForSite(code, { config: cfg });
      }
    } catch (_) { links = {}; }
    require('../services/meridianActions').attachProjectLinks(sa, links, baseUrl);
    // 2027 Goal 02 — commitment status + "awaiting verification" badge on linked rows (flag
    // commitments_enabled). Best-effort, never blocks the hub; flag off → no field added.
    try {
      const cfg = await reportConfig.getConfig(rdb.db);
      const store = String(cfg.commitments_enabled) === '1' && deps.getCommitmentStore && deps.getCommitmentStore();
      if (store) require('../services/commitmentBackfill').attachCommitments(sa, await store.linksFor(require('../services/commitmentBackfill').hubPairs(sa)));
    } catch (_) { /* hub renders without the badge */ }
    res.json({ site: code, ...sa });
  } catch (e) { fail(res, e); }
});
  return router;
};
