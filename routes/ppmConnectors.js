'use strict';
// W4-CONNECTORS (PPM parity J3 · J4) — OPTIONAL interoperability with external PPM tools. The native tool never needs
// any of this: each connector is behind its own PROPOSED switch (404 while '0' = today) and nothing native reads it.
// Registered by routes/governancePpm.js after routes/ppmEngine.js (it reuses h.ppmEngine: the export model and the
// SAME import flow as MSPDI — plan-write dry run, committee apply, empty project, no cycle).
//   ppm_xer_enabled           GET  /api/governance/ppm/project/:id/project.xer                 read scope (no money in XER)
//                             POST /api/governance/ppm/project/:id/xer/import[?apply=1]        plan write = dry run; apply = committee
//   ppm_mpp_import_enabled    POST /api/governance/ppm/project/:id/mpp/import[?apply=1]        idem; 501 while ppm_mpp_converter_cmd is empty
//   ppm_jira_sync_enabled     GET  /api/governance/ppm/project/:id/work-items/jira             read scope: opt-in, links, last sync
//   ppm_azdo_sync_enabled     PUT  /api/governance/ppm/project/:id/work-items/:system          plan write: {scope} opts in · {enabled:false} opts out
//   (one switch per system)   POST /api/governance/ppm/project/:id/work-items/:system/sync[?apply=1]  plan write; dry run = preview
//   any connector switch      GET  /api/governance/ppm/connectors/status                        committee / admin tier
// Credentials (ppm_jira_api_token, ppm_azdo_pat) are report_config SECRETS: super_admin writes them through
// /api/reports/config, they are redacted on read, blank-kept and encrypted at rest; this file only says whether one is set.
const { fail: httpFail } = require('../services/httpError');

module.exports = function ppmConnectorRoutes(router, h) {
  const { store, rdb, reportConfig, requireReportSession, json, isCommittee, readableProject, refusePlanWrite, log } = h;
  const XER = require('../services/ppm/xer');
  const MPP = require('../services/ppm/mppConverter');
  const MSPDI = require('../services/ppm/mspdi');
  const WIS = require('../services/ppm/workItemSync');
  const WIC = require('../services/ppm/workItemClient');
  const fail = (res, e) => httpFail(res, e, e && e.status, { ok: false, ...(e && e.reason ? { code: e.reason } : {}) });
  const notFound = (res) => httpFail(res, new Error('not found'), 404, { ok: false });
  const bad = (res, msg, code) => httpFail(res, Object.assign(new Error(msg), { reason: code }), 400, { ok: false, code });
  const cfg = async () => reportConfig.getConfig(rdb().db);
  const on = (c, k) => String(c[k]) === '1';
  const set = (v) => String(v == null ? '' : v).trim() !== '';
  const SWITCH = { jira: 'ppm_jira_sync_enabled', azdo: 'ppm_azdo_sync_enabled' };
  const links = () => require('../services/ppm/externalLinkStore').makeExternalLinkStore(rdb().pgHandle(), store);
  const fileBody = require('express').raw({ type: () => true, limit: '26mb' });
  const E = () => h.ppmEngine;   // set by routes/ppmEngine.js (registered first)
  const planWrite = (req, res, pid) => refusePlanWrite(req, res, 'task', { body: { project_id: Number(pid) } });
  // .mpp converter errors carry messages composed ONLY by services/ppm/mppConverter (no converter output, no paths), so
  // the 5xx ones (501 not configured, 502 failed, 504 timeout) keep their actionable text instead of 'internal_error'.
  const mppFail = (res, e) => httpFail(res, e, e && e.status, { ok: false, ...(e && e.reason ? { code: e.reason } : {}), ...(e && e.reason && /^MPP_|^EMPTY_BODY$/.test(e.reason) ? { error: e.message } : {}) });
  const textOf = (b) => (Buffer.isBuffer(b) ? b.toString('utf8') : typeof b === 'string' ? b : '');

  // ---- Primavera P6 XER (file format) -----------------------------------------------------------------------------
  router.get('/api/governance/ppm/project/:id/project.xer', requireReportSession, async (req, res) => {
    try {
      const c = await cfg(); if (!on(c, 'ppm_xer_enabled')) return notFound(res);
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      const { model, warnings } = await E().exportModel(p.id, E().switches(c), false);
      if (!model) return httpFail(res, Object.assign(new Error('the dependency network has a cycle'), { reason: 'CYCLE' }), 409, { ok: false, code: 'CYCLE' });
      const out = XER.toXer(model);
      const all = [...warnings.filter((w) => w.code !== 'MONEY_OMITTED'), ...out.warnings];
      log(req, 'ppm_xer_export', `project:${p.id}`, { tasks: model.tasks.length, warnings: all.length });
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="project-${p.id}.xer"`);
      if (all.length) res.setHeader('X-XER-Warnings', String(all.length));
      res.send(out.xer);
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/project/:id/xer/import', requireReportSession, fileBody, async (req, res) => {
    try {
      if (!on(await cfg(), 'ppm_xer_enabled')) return notFound(res);
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await E().refuseImport(req, res, p)) return;
      const text = textOf(req.body);
      if (!text.trim()) return bad(res, 'send the XER file as the request body', 'EMPTY_BODY');
      let parsed; try { parsed = XER.fromXer(text); } catch (e) { return bad(res, e.message, 'XER_PARSE'); }
      await E().finishImport(req, res, p, parsed.model, { source: 'xer', fileWarnings: parsed.warnings });
    } catch (e) { fail(res, e); }
  });

  // ---- .mpp through an admin-configured local converter -----------------------------------------------------------
  router.post('/api/governance/ppm/project/:id/mpp/import', requireReportSession, fileBody, async (req, res) => {
    try {
      const c = await cfg(); if (!on(c, 'ppm_mpp_import_enabled')) return notFound(res);
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await E().refuseImport(req, res, p)) return;
      // validate the command BEFORE touching the upload: with no command configured nothing is ever executed
      try { MPP.validateCommand(c.ppm_mpp_converter_cmd); } catch (e) { return mppFail(res, e); }
      let xml; try { xml = await MPP.convert(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), { cmd: c.ppm_mpp_converter_cmd }); } catch (e) { return mppFail(res, e); }
      let model; try { model = MSPDI.fromXml(xml); } catch (e) { return httpFail(res, Object.assign(new Error('the converter output is not MSPDI XML: ' + e.message), { reason: 'MPP_CONVERTER_BAD_OUTPUT' }), 502, { ok: false, code: 'MPP_CONVERTER_BAD_OUTPUT' }); }
      await E().finishImport(req, res, p, model, { source: 'mpp' });
    } catch (e) { fail(res, e); }
  });

  // ---- Jira / Azure DevOps read-only pull --------------------------------------------------------------------------
  const sysOf = (req, res) => { const s = String(req.params.system || ''); if (!SWITCH[s]) { notFound(res); return null; } return s; };
  const configured = (c, s) => (s === 'jira' ? set(c.ppm_jira_base_url) && set(c.ppm_jira_api_token) : set(c.ppm_azdo_org_url) && set(c.ppm_azdo_project) && set(c.ppm_azdo_pat));
  async function pull(c, system, scope) {
    const http = WIC.transport(require('../services/safeUrl').allowHostsFromConfig(c));
    if (system === 'jira') {
      const r = await WIC.fetchJira({ baseUrl: c.ppm_jira_base_url, user: String(c.ppm_jira_user || '').trim() || null, token: c.ppm_jira_api_token, jql: WIS.jiraQuery(scope), http });
      return { truncated: r.truncated, items: r.items.map((i) => WIS.mapJiraIssue(i, { baseUrl: c.ppm_jira_base_url })) };
    }
    const r = await WIC.fetchAzdo({ orgUrl: c.ppm_azdo_org_url, project: c.ppm_azdo_project, pat: c.ppm_azdo_pat, wiql: WIS.azdoWiql(scope, c.ppm_azdo_project), http });
    return { truncated: r.truncated, items: r.items.map((w) => WIS.mapAzdoItem(w, { orgUrl: c.ppm_azdo_org_url, project: c.ppm_azdo_project })) };
  }

  router.get('/api/governance/ppm/project/:id/work-items/:system', requireReportSession, async (req, res) => {
    try {
      const system = sysOf(req, res); if (!system) return;
      const c = await cfg(); if (!on(c, SWITCH[system])) return notFound(res);
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      const L = links();
      res.json({ ok: true, system, connection_configured: configured(c, system), source: await L.getSource(p.id, system),
        links: (await L.listLinks(p.id, system)).map((l) => ({ external_key: l.external_key, external_url: l.external_url, external_status: l.external_status, task_id: l.task_id, task_name: l.task.name, deleted: l.task.deleted, last_synced_at: l.last_synced_at })),
        read_only: true, note: 'items are only ever READ from the external tool; nothing is written back' });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/project/:id/work-items/:system', requireReportSession, json, async (req, res) => {
    try {
      const system = sysOf(req, res); if (!system) return;
      const c = await cfg(); if (!on(c, SWITCH[system])) return notFound(res);
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await planWrite(req, res, p.id)) return;
      const b = req.body || {};
      if (b.enabled === false) { const r = await links().removeSource(p.id, system, { user: req.reportUser }); log(req, 'ppm_external_source_removed', `project:${p.id}`, { system }); return res.json({ ok: true, ...r }); }
      try { system === 'jira' ? WIS.jiraQuery(b.scope) : WIS.azdoWiql(b.scope, c.ppm_azdo_project); } catch (e) { return bad(res, e.message, e.reason); }
      const src = await links().setSource(p.id, system, b.scope, { user: req.reportUser });
      log(req, 'ppm_external_source_set', `project:${p.id}`, { system });
      res.json({ ok: true, source: src });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/project/:id/work-items/:system/sync', requireReportSession, json, async (req, res) => {
    try {
      const system = sysOf(req, res); if (!system) return;
      const c = await cfg(); if (!on(c, SWITCH[system])) return notFound(res);
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await planWrite(req, res, p.id)) return;
      const L = links();
      const src = await L.getSource(p.id, system);
      if (!src) return httpFail(res, Object.assign(new Error(`this project has not opted in to ${system} (PUT …/work-items/${system} {scope})`), { reason: 'NOT_OPTED_IN' }), 409, { ok: false, code: 'NOT_OPTED_IN' });
      if (!configured(c, system)) return httpFail(res, Object.assign(new Error(`the ${system} connection is not configured (super_admin: Admin settings)`), { reason: 'CONNECTOR_NOT_CONFIGURED' }), 409, { ok: false, code: 'CONNECTOR_NOT_CONFIGURED' });
      const { items, truncated } = await pull(c, system, src.scope);
      const existing = await L.listLinks(p.id, system);
      const tasks = Object.fromEntries(existing.map((l) => [String(l.task_id), l.task]));
      const plan = WIS.planSync({ items, links: existing, tasks });
      const summary = { ...WIS.summarize(plan), fetched: items.length, truncated };
      const preview = { create: plan.create.slice(0, 200).map((i) => ({ external_key: i.external_key, name: i.name, status: i.status })), update: plan.update.slice(0, 200).map((u) => ({ external_key: u.external_key, task_id: u.task_id, fields: Object.keys(u.patch) })),
        missing_upstream: plan.missing_upstream.slice(0, 200), deleted_locally: plan.deleted_locally.slice(0, 200), skipped: plan.skipped.slice(0, 200) };
      if (!(req.query && req.query.apply === '1')) return res.json({ ok: true, dry_run: true, system, summary, preview, apply_with: `POST …/work-items/${system}/sync?apply=1` });
      const result = await L.applyPlan(p.id, system, plan, { user: req.reportUser, summary });
      log(req, 'ppm_external_sync', `project:${p.id}`, { system, created: result.created, updated: result.updated });
      res.json({ ok: true, dry_run: false, system, summary, result });
    } catch (e) { fail(res, e); }
  });

  router.get('/api/governance/ppm/connectors/status', requireReportSession, async (req, res) => {
    try {
      const c = await cfg();
      const sw = { xer: on(c, 'ppm_xer_enabled'), mpp: on(c, 'ppm_mpp_import_enabled'), jira: on(c, SWITCH.jira), azdo: on(c, SWITCH.azdo) };
      if (!Object.values(sw).some(Boolean)) return notFound(res);
      if (!isCommittee(req.reportUser)) return httpFail(res, new Error('committee-member or admin role required'), 403, { ok: false });
      const sources = sw.jira || sw.azdo ? (await links().listSources()).filter((s) => sw[s.system]) : [];
      res.json({ ok: true, switches: sw, mpp_converter_configured: set(c.ppm_mpp_converter_cmd),
        connections: { jira: sw.jira ? { configured: configured(c, 'jira'), base_url_set: set(c.ppm_jira_base_url), token_set: set(c.ppm_jira_api_token) } : null,
          azdo: sw.azdo ? { configured: configured(c, 'azdo'), org_url_set: set(c.ppm_azdo_org_url), project_set: set(c.ppm_azdo_project), pat_set: set(c.ppm_azdo_pat) } : null },
        sources: sources.map((s) => ({ project_id: s.project_id, system: s.system, last_sync_at: s.last_sync_at, last_result: s.last_result })),
        native_independent: true });
    } catch (e) { fail(res, e); }
  });
};
