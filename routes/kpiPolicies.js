'use strict';
// C-31 — KPI Policy Builder API (migration 065). Every error goes through httpError.fail.
//   GET  /api/kpi-policies/catalogue                      building blocks (any session)
//   GET  /api/kpi-policies[?metric=]                      versions + metrics + enforced switch (any session)
//   GET  /api/kpi-policies/effective/:metric              what the screens use: {enforced, policy, page_opts} (any session)
//   POST /api/kpi-policies/validate                       { definition } → errors (any session)
//   POST /api/kpi-policies/preview                        { definition, sample_rows? , as_of? } → value(s)            kpi-committee | super_admin
//   POST /api/kpi-policies/shadow                         { policy_id | definition, against?, as_of? } → per-site diff  kpi-committee | super_admin
//   GET  /api/kpi-policies/:id                            one version + who may adopt + history (any session)
//   GET  /api/kpi-policies/:id/diff?against=<id>          setting-by-setting diff (any session)
//   POST /api/kpi-policies                                new draft (copy_of to start from a version)                 kpi-committee | super_admin
//   PUT  /api/kpi-policies/:id                            edit a DRAFT                                                kpi-committee | super_admin
//   POST /api/kpi-policies/:id/propose                    the AUTHOR proposes                                         kpi-committee | super_admin
//   POST /api/kpi-policies/:id/decide                     { decision adopt|reject|retire, committee_ref, minutes? }    kpi-committee | super_admin
//                                                         adopt: not the author / proposer / their deputy (sodPolicy)
// Read-only routes never touch a screen; the shadow test reads real data and writes nothing.
const { fail, typed } = require('../services/httpError');
const Engine = require('../services/kpiPolicyEngine');
const SlaDef = require('../services/slaDefinition');

module.exports = function kpiPolicyRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  const json = express.json({ limit: '512kb' });
  const rdb = () => deps.rdb || require('../reports-db');
  const reportConfig = deps.reportConfig || require('../services/reportConfig');
  const registry = () => deps.registry || require('../services/metricRegistry').current();
  const store = () => deps.store || (deps._store = deps._store || require('../services/kpiPolicyStore').makeKpiPolicyStore(rdb().pgHandle(), { knownKey: (k) => !!registry().get(String(k || '')) }));
  const cfg = async () => { try { return await reportConfig.getConfig(rdb().db); } catch (_) { return {}; } };
  const isCommittee = (u) => !!u && (rdb().userHasRole(u, 'super_admin') || rdb().userHasRole(u, 'kpi-committee'));
  const requireKpiCommittee = (req, res, next) => (isCommittee(req.reportUser) ? next() : fail(res, typed('FORBIDDEN', 'kpi-committee role required', 403)));
  requireKpiCommittee.legacyRoles = ['super_admin', 'kpi-committee'];   // C-17 capability catalogue tag
  const principals = async (u) => { try { return deps.rolesStore ? await deps.rolesStore.principalsOf(u.id, undefined, { any: true }) : []; } catch (_) { return []; } };
  const log = (req, action, target, details) => { try { Promise.resolve(rdb().logEvent({ category: 'governance', action, target: String(target), details, ...rdb()._logCtx(req) })).catch(() => {}); } catch (_) {} };
  const today = () => new Date().toISOString().slice(0, 10);
  const asOf = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : today());

  // ── real data (read-only) for the shadow test / preview ──────────────────────────────────────────────────
  async function siteByGroup() {
    const map = new Map();
    for (const s of await rdb().listSites({ includeInactive: true })) for (const g of String(s.zoho_group || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) map.set(g, { id: Number(s.id), name: s.name });
    return map;
  }
  async function loadRows(dataset, { from, to }) {
    const H = rdb().pgHandle();
    if (dataset === 'helpdesk_tickets') {
      return H.prepare(`SELECT request_status, pending_status, overdue_status, due_by_time, resolved_time, completed_time, created_time, responded_time,
          request_type, template, mode, site, tech_group, impact, category, sub_category FROM request_records WHERE substr(created_time,1,10) BETWEEN ? AND ?`).all(from, to);
    }
    if (dataset === 'changes') {
      return (await H.prepare('SELECT status, change_type, risk, category, group_name, closure_code, emergency, created_time, completed_time FROM change_records WHERE substr(created_time,1,10) BETWEEN ? AND ?').all(from, to))
        .map((r) => ({ ...r, tech_group: r.group_name }));
    }
    throw typed('VALIDATION', 'no real-data reader for this dataset yet — use the sample preview', 400);
  }
  const siteKey = (m) => (r) => { const s = m.get(String(r.tech_group || '').trim().toLowerCase()); return s ? s.id : null; };

  // today's server code for helpdesk.resolution_sla_pct (independent of the engine): closed (pending_status = 0)
  // tickets, missed under report_config helpdesk_sla_definition (services/slaDefinition), cancelled in the denominator
  function currentCode(rows, mode) {
    const closed = rows.filter((r) => Number(r.pending_status) === 0);
    const viol = closed.filter((r) => SlaDef.resOverdueRow(r, mode)).length;
    const n = closed.length;
    return { value: n ? Math.round((1 - viol / n) * 1000) / 10 : null, n };
  }

  router.get('/api/kpi-policies/catalogue', requireReportSession, (req, res) => res.json({ ok: true, catalogue: Engine.catalogue() }));

  router.get('/api/kpi-policies', requireReportSession, async (req, res) => {
    try {
      const policies = await store().list({ metric: req.query.metric ? String(req.query.metric).slice(0, 80) : null });
      const metrics = registry().list({}).map((m) => ({ key: m.key, name: m.name, name_fr: m.name_fr, module: m.module, unit: m.unit, higher_is_better: m.higher_is_better !== false }));
      res.json({ ok: true, enforced: String((await cfg()).kpi_policy_enforced) === '1', can_edit: isCommittee(req.reportUser), policies, metrics });
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });

  // What the screens read. enforced = '0' → no policy is applied (today's computation), whatever is adopted.
  router.get('/api/kpi-policies/effective/:metric', requireReportSession, async (req, res) => {
    try {
      const enforced = String((await cfg()).kpi_policy_enforced) === '1';
      const p = enforced ? await store().inForce(String(req.params.metric).slice(0, 80), today()) : null;
      const opts = p ? Engine.toResolutionSlaOpts(p.definition) : null;
      res.json({ ok: true, enforced, policy: p ? { id: p.id, version: p.version, title: p.title, effective_from: p.effective_from } : null,
        page_opts: p && String(req.params.metric) === 'helpdesk.resolution_sla_pct' ? opts : null,
        note: !enforced ? 'kpi_policy_enforced = 0: screens compute as today' : !p ? 'no adopted policy in force: screens compute as today' : opts ? null : 'the adopted policy cannot be expressed by the page helper: the page keeps today’s rule' });
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });

  router.post('/api/kpi-policies/validate', requireReportSession, json, (req, res) => {
    const v = Engine.validate((req.body || {}).definition);
    res.json({ ok: true, valid: v.ok, errors: v.errors });
  });

  router.post('/api/kpi-policies/preview', requireReportSession, requireKpiCommittee, json, async (req, res) => {
    try {
      const b = req.body || {}; const def = b.definition;
      const v = Engine.validate(def); if (!v.ok) { const e = typed('VALIDATION', 'invalid policy definition', 400); e.errors = v.errors; throw e; }
      if (Array.isArray(b.sample_rows)) {
        if (b.sample_rows.length > 5000) throw typed('VALIDATION', 'at most 5000 sample rows', 400);
        const rows = def.dataset === 'helpdesk_tickets' && b.sample_shape === 'zoho' ? b.sample_rows.map(Engine.fromZohoTicket) : b.sample_rows;
        return res.json({ ok: true, source: 'sample', result: Engine.evaluate(def, rows) });
      }
      const win = Engine.windowRange(def.window, asOf(b.as_of));
      const rows = await loadRows(def.dataset, win); const m = await siteByGroup();
      const per = Engine.evaluateBy(def, rows, siteKey(m), {});
      const names = new Map([...m.values()].map((s) => [s.id, s.name]));
      res.json({ ok: true, source: 'real', window: win, fleet: Engine.evaluate(def, rows), sites: Object.entries(per).map(([id, r]) => ({ site_id: Number(id), site: names.get(Number(id)) || id, ...r })) });
    } catch (e) { fail(res, e, undefined, { ok: false, errors: e.errors }); }
  });

  // Shadow test: the proposed policy vs the adopted one in force (or, without one, today's code) on real data.
  router.post('/api/kpi-policies/shadow', requireReportSession, requireKpiCommittee, json, async (req, res) => {
    try {
      const b = req.body || {};
      const proposed = b.policy_id != null ? await store().get(b.policy_id) : null;
      const def = proposed ? proposed.definition : b.definition;
      const metric = proposed ? proposed.metric_key : String(b.metric_key || '');
      const v = Engine.validate(def); if (!v.ok) { const e = typed('VALIDATION', 'invalid policy definition', 400); e.errors = v.errors; throw e; }
      const day = asOf(b.as_of); const win = Engine.windowRange(def.window, day);
      let baseline = null, baseLabel;
      if (b.against != null) { baseline = await store().get(b.against); baseLabel = `v${baseline.version} (${baseline.status})`; }
      else { baseline = metric ? await store().inForce(metric, day) : null; baseLabel = baseline ? `adopted v${baseline.version}` : null; }
      const mode = SlaDef.normalizeMode((await cfg()).helpdesk_sla_definition);
      if (!baseline && !(metric === 'helpdesk.resolution_sla_pct' && def.dataset === 'helpdesk_tickets')) throw typed('VALIDATION', 'nothing to compare against: no adopted version and no code baseline for this metric — pass "against"', 400);
      if (!baseline) baseLabel = `today’s code (helpdesk_sla_definition = ${mode})`;
      const rows = await loadRows(def.dataset, win);
      const baseRows = baseline && baseline.definition.dataset !== def.dataset ? await loadRows(baseline.definition.dataset, win) : rows;
      const m = await siteByGroup(); const key = siteKey(m);
      const classes = b.site_classes && typeof b.site_classes === 'object' ? b.site_classes : {};
      const ctx = { siteClassOf: (id) => (['mine', 'office'].includes(classes[id]) ? classes[id] : undefined) };
      const nw = Engine.evaluateBy(def, rows, key, ctx);
      let old;
      if (baseline) old = Engine.evaluateBy(baseline.definition, baseRows, key, ctx);
      else {
        old = {}; const g = new Map();
        for (const r of rows) { const k = key(r); if (k == null) continue; if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
        for (const [k, list] of g) { const c = currentCode(list, mode); old[k] = { ...c, rag: c.value == null ? 'UNKNOWN' : null, comparable: c.value != null }; }
      }
      const names = new Map([...m.values()].map((s) => [s.id, s.name]));
      const sites = [...new Set([...Object.keys(nw), ...Object.keys(old)])].map((id) => {
        const a = old[id] || { value: null, n: 0, rag: 'UNKNOWN' }, z = nw[id] || { value: null, n: 0, rag: 'UNKNOWN' };
        return { site_id: Number(id), site: names.get(Number(id)) || id, baseline: { value: a.value, n: a.n, rag: a.rag }, proposed: { value: z.value, n: z.n, rag: z.rag, comparable: z.comparable },
          delta: a.value != null && z.value != null ? Math.round((z.value - a.value) * 1000) / 1000 : null, rag_changed: (a.rag || null) !== (z.rag || null) };
      }).sort((x, y) => String(x.site).localeCompare(String(y.site)));
      res.json({ ok: true, read_only: true, window: win, baseline: baseLabel, proposed: proposed ? `v${proposed.version} (${proposed.status})` : 'unsaved definition',
        diff: baseline ? Engine.diff(baseline.definition, def) : null, sites, changed: sites.filter((s) => s.delta !== 0 || s.rag_changed).length });
    } catch (e) { fail(res, e, undefined, { ok: false, errors: e.errors }); }
  });

  router.get('/api/kpi-policies/:id', requireReportSession, async (req, res) => {
    try {
      const p = await store().get(req.params.id); const u = req.reportUser;
      const committee = isCommittee(u);
      const may = committee ? store().adoptCheck(p, u.id, await principals(u)) : { ok: false, reason: 'kpi-committee role required' };
      let members = null;
      if (committee) members = (await rdb().listUsers()).filter((x) => x.active !== 0 && x.active !== false && (x.roles || []).some((r) => r === 'kpi-committee' || r === 'super_admin')).map((x) => ({ id: Number(x.id), full_name: x.full_name || x.username }));
      res.json({ ok: true, policy: p, history: await store().history(p.id), may_adopt: may,
        adoption_rule: 'Adopted by a kpi-committee member (or super_admin) who is not the author or the proposer, nor their deputy, with a committee session reference.',
        may_edit: committee && p.status === 'draft', may_propose: committee && p.status === 'draft' && p.created_by === Number(u.id), committee: members });
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });

  router.get('/api/kpi-policies/:id/diff', requireReportSession, async (req, res) => {
    try {
      const a = await store().get(req.query.against); const b = await store().get(req.params.id);
      res.json({ ok: true, from: { id: a.id, version: a.version }, to: { id: b.id, version: b.version }, changes: Engine.diff(a.definition, b.definition) });
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });

  router.post('/api/kpi-policies', requireReportSession, requireKpiCommittee, json, async (req, res) => {
    try {
      const b = { ...(req.body || {}) };
      if (b.copy_of != null && b.definition === undefined) { const src = await store().get(b.copy_of); b.definition = src.definition; b.metric_key = b.metric_key || src.metric_key; }
      const id = await store().create(b, { actorId: req.reportUser.id });
      log(req, 'kpi_policy_drafted', id, { metric_key: b.metric_key });
      res.status(201).json({ ok: true, id });
    } catch (e) { fail(res, e, undefined, { ok: false, errors: e.errors }); }
  });
  router.put('/api/kpi-policies/:id', requireReportSession, requireKpiCommittee, json, async (req, res) => {
    try { await store().update(req.params.id, req.body || {}, { actorId: req.reportUser.id }); res.json({ ok: true }); } catch (e) { fail(res, e, undefined, { ok: false, errors: e.errors }); }
  });
  router.post('/api/kpi-policies/:id/propose', requireReportSession, requireKpiCommittee, async (req, res) => {
    try { await store().propose(req.params.id, { actorId: req.reportUser.id }); log(req, 'kpi_policy_proposed', req.params.id, {}); res.json({ ok: true }); } catch (e) { fail(res, e, undefined, { ok: false }); }
  });
  router.post('/api/kpi-policies/:id/decide', requireReportSession, requireKpiCommittee, json, async (req, res) => {
    try {
      const u = req.reportUser;
      await store().decide(req.params.id, req.body || {}, { actorId: u.id, principals: await principals(u) });
      log(req, 'kpi_policy_' + String((req.body || {}).decision), req.params.id, { committee_ref: String((req.body || {}).committee_ref || '').slice(0, 200) });
      res.json({ ok: true });
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });
  return router;
};
