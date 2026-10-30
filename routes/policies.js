'use strict';
// Governance policies — Admin ▸ Governance policies (validation request 2026-10-28).
//
//   GET  /api/governance/policies                 registry + global value + per-site values + effective   committee | admin
//   GET  /api/governance/policies/effective?site= resolved values for one context (who sees which rules)   any session (own sites)
//   PUT  /api/governance/policies                 { scope:'global'|'site:<id>', key, value|null, reason }  admin tier
//                                                 relaxing a PROTECTED rule needs a super_admin + 10-char reason (risk event)
//   GET  /api/governance/policies/history?key=    append-only change history (with names)                   committee | admin
//   GET  /api/governance/policies/proposals       pending two-person relaxations · POST …/proposals/:id/approve|reject  super_admin ≠ proposer
//   GET  /api/governance/oversight?from=&to=[&format=csv]   relaxations, overrides, proposals, deviations, role gaps (MEA02)  committee | admin
//   GET  /policies.html
// The rules, bounds and defaults live in services/governancePolicy.js; nothing here decides a value.

const { fail: httpFail } = require('../services/httpError');

module.exports = function policyRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  const json = express.json({ limit: '32kb' });
  const rdb = () => deps.rdb || require('../reports-db');
  const GP = require('../services/governancePolicy');
  const store = () => deps.policyStore || GP.shared();
  const userSites = require('../services/userSites');
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false });
  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  const isSuper = (u) => rdb().userHasRole(u, 'super_admin');
  const isCommittee = (u) => isAdmin(u) || rdb().userHasRole(u, 'committee-member');
  const requireCommittee = (req, res, next) => (isCommittee(req.reportUser) ? next() : res.status(403).json({ ok: false, error: 'committee or admin role required' }));
  const requireSuperTier = (req, res, next) => (isSuper(req.reportUser) ? next() : res.status(403).json({ ok: false, error: 'super_admin role required' }));
  const requireAdminTier = (req, res, next) => (isAdmin(req.reportUser) ? next() : res.status(403).json({ ok: false, error: 'admin role required' }));

  // committee #49 — country / business unit of each site (migration 036); empty map if not migrated
  async function siteAttrs() {
    try { const m = new Map(); for (const r of await rdb().pgHandle().prepare('SELECT id, country, business_unit FROM sites').all()) m.set(Number(r.id), { country: r.country || null, business_unit: r.business_unit || null }); return m; }
    catch (_) { return new Map(); }
  }
  //   PUT /api/governance/sites/:id/hierarchy  { country, business_unit, reason }   super_admin — groups a site for group-scoped policies
  router.put('/api/governance/sites/:id/hierarchy', requireReportSession, requireSuperTier, json, async (req, res) => {
    try {
      const b = req.body || {}; const id = Number(req.params.id);
      const norm = (v) => { if (v == null || String(v).trim() === '') return null; const c = GP.groupCode(v); if (!c) throw require('../services/httpError').typed('VALIDATION', 'a country / business unit code is 2 to 16 letters, digits, - or _', 400); return c; };
      const country = norm(b.country), bu = norm(b.business_unit);
      if (String(b.reason || '').trim().length < 5) return res.status(400).json({ ok: false, error: 'a reason (5+ characters) is required' });
      const before = (await siteAttrs()).get(id);
      if (!before) return res.status(404).json({ ok: false, error: 'site not found' });
      const was = await store().snapshot({ siteId: id });
      await rdb().pgHandle().prepare('UPDATE sites SET country=?, business_unit=? WHERE id=?').run(country, bu, id);
      store().invalidate();
      // moving a site between groups can make its rules less strict: named and logged as a risk
      const now = await store().snapshot({ siteId: id });
      const relaxed = GP.PARAMS.filter((p) => p.protected && GP.relaxes(p, was[p.key], now[p.key])).map((p) => ({ key: p.key, before: was[p.key], after: now[p.key] }));
      // security review: regrouping must not bypass the two-person rule — when the move would relax a
      // protected rule and two-person approval is on, undo and say which site values to set first
      if (relaxed.length && was['governance.dual_approval_relaxations'] !== false) {
        await rdb().pgHandle().prepare('UPDATE sites SET country=?, business_unit=? WHERE id=?').run(before.country, before.business_unit, id);
        store().invalidate();
        try { await rdb().logEvent({ category: 'governance', action: 'site_hierarchy_refused', target: `site:${id}`, details: { wanted: { country, business_unit: bu }, relaxed }, risk: 1, ...rdb()._logCtx(req) }); } catch (_) {}
        return res.status(409).json({ ok: false, code: 'RELAXES_PROTECTED', relaxed, error: 'this move would relax protected rules for the site — first set those values on the site itself (a relaxation there goes through the two-person proposal), then move it' });
      }
      try { await rdb().logEvent({ category: 'governance', action: 'site_hierarchy_changed', target: `site:${id}`, details: { before, after: { country, business_unit: bu }, relaxed, reason: String(b.reason).slice(0, 300) }, risk: relaxed.length ? 1 : 0, ...rdb()._logCtx(req) }); } catch (_) {}
      res.json({ ok: true, site_id: id, country, business_unit: bu, relaxed });
    } catch (e) { fail(res, e); }
  });

  // DEC-4 — site-code registry vs the modules' hard-coded maps (services/siteCodeRegistry)
  //   GET /api/governance/site-codes                         status + every disagreement   committee | admin
  //   PUT /api/governance/site-codes/:site  { module, code, reason }   fill the registry       super_admin
  //   PUT /api/governance/site-codes        { enabled, reason }        registry wins / not     super_admin
  const SCR = require('../services/siteCodeRegistry');
  const hardMaps = () => ({ tracker: (n) => require('../tracker-db').hardSiteNameToCode(n), inspection: (n) => require('../inspection-db').hardSiteNameToCode(n), meetings: (n) => require('../inspection-db').hardSiteNameToCode(n) });
  router.get('/api/governance/site-codes', requireReportSession, requireCommittee, async (req, res) => {
    try { res.json({ ok: true, ...SCR.status(), diff: await SCR.diff(rdb(), hardMaps()) }); } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/site-codes/:site', requireReportSession, requireSuperTier, json, async (req, res) => {
    try {
      const b = req.body || {}; const site = Number(req.params.site); const mod = String(b.module || '');
      if (!SCR.MODULES.includes(mod)) return res.status(400).json({ ok: false, error: `module must be one of ${SCR.MODULES.join(', ')}` });
      const code = String(b.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9_-]{2,16}$/.test(code)) return res.status(400).json({ ok: false, error: 'a site code is 2 to 16 letters, digits, - or _' });
      if (String(b.reason || '').trim().length < 5) return res.status(400).json({ ok: false, error: 'a reason (5+ characters) is required' });
      const H = rdb().pgHandle();
      if (!(await H.prepare('SELECT 1 FROM sites WHERE id=?').get(site))) return res.status(404).json({ ok: false, error: 'site not found' });
      const clash = await H.prepare('SELECT site_id FROM site_module_codes WHERE module=? AND code=? AND site_id<>?').get(mod, code, site);
      if (clash) return res.status(409).json({ ok: false, error: 'this code is already used by another site in this module' });
      const before = await H.prepare('SELECT code FROM site_module_codes WHERE site_id=? AND module=?').get(site, mod);
      await H.prepare('INSERT INTO site_module_codes (site_id, module, code) VALUES (?, ?, ?) ON CONFLICT (site_id, module) DO UPDATE SET code=EXCLUDED.code').run(site, mod, code);
      await SCR.refresh(rdb());
      try { await rdb().logEvent({ category: 'governance', action: 'site_code_set', target: `site:${site}`, details: { module: mod, before: before ? before.code : null, after: code, reason: String(b.reason).slice(0, 300) }, risk: 0, ...rdb()._logCtx(req) }); } catch (_) {}
      res.json({ ok: true, site_id: site, module: mod, code });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/site-codes', requireReportSession, requireSuperTier, json, async (req, res) => {
    try {
      const b = req.body || {};
      if (String(b.reason || '').trim().length < 10) return res.status(400).json({ ok: false, error: 'a reason (10+ characters) is required' });
      const on = b.enabled === true || b.enabled === '1';
      const gaps = await SCR.diff(rdb(), hardMaps());
      await require('../services/reportConfig').setConfig(rdb().db, { site_codes_from_registry: on ? '1' : '0' }, req.reportUser.username);
      await SCR.refresh(rdb());
      // switching it on with disagreements left is allowed (the committee decides), but recorded as a risk
      try { await rdb().logEvent({ category: 'governance', action: on ? 'site_registry_enabled' : 'site_registry_disabled', target: 'site_codes', details: { open_differences: gaps.length, reason: String(b.reason).slice(0, 300) }, risk: on && gaps.length ? 1 : 0, ...rdb()._logCtx(req) }); } catch (_) {}
      res.json({ ok: true, ...SCR.status(), open_differences: gaps.length });
    } catch (e) { fail(res, e); }
  });

  router.get('/policies.html', (req, res) => deps.sendHtmlPage(res, 'policies.html', false, 'Policies page unavailable'));

  router.get('/api/governance/policies', requireReportSession, requireCommittee, async (req, res) => {
    try {
      const attrs = await siteAttrs();
      const sites = ((await rdb().listSites({ includeInactive: false })) || []).map((s) => ({ id: Number(s.id), name: s.name, ...(attrs.get(Number(s.id)) || {}) }));
      const groups = [...new Set(sites.flatMap((s) => GP.groupsFor(s)))].sort();
      res.json({ ok: true, can_write: isAdmin(req.reportUser), is_super: isSuper(req.reportUser), areas: GP.AREAS, sites, groups,
        policies: await store().view({ siteIds: sites.map((s) => s.id) }) });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/policies/effective', requireReportSession, async (req, res) => {
    try {
      const u = req.reportUser; const site = req.query.site == null || req.query.site === '' ? null : Number(req.query.site);
      if (site != null && !isAdmin(u) && !userSites.hasSite(u, site)) return res.status(403).json({ ok: false, error: 'site not in your scope' });
      res.json({ ok: true, site, values: await store().snapshot({ siteId: site }) });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/policies', requireReportSession, requireAdminTier, json, async (req, res) => {
    try {
      const b = req.body || {}; const u = req.reportUser;
      const out = await store().set({ scope: String(b.scope || 'global'), key: String(b.key || ''), value: b.value === undefined ? null : b.value, reason: b.reason,
        expiresDays: b.expires_days, actor: { id: u.id, isAdmin: isAdmin(u), isSuper: isSuper(u) } });
      const action = out.pending ? (out.relaxes ? 'policy_relaxation_proposed' : 'policy_change_proposed') : out.relaxes ? 'policy_relaxed' : 'policy_changed';
      try { await rdb().logEvent({ category: 'governance', action, target: `${out.scope}:${out.key}`, details: { before: out.before, after: out.after, reason: String(b.reason || '').slice(0, 300), proposal: out.pending ? out.pending.id : undefined, expires_at: out.expires_at }, risk: out.relaxes ? 1 : 0, ...rdb()._logCtx(req) }); } catch (_) {}
      res.status(out.pending ? 202 : 200).json({ ok: true, change: out, pending: out.pending || null });
    } catch (e) { fail(res, e); }
  });
  const names = async () => { const m = {}; for (const x of (await rdb().listUsers()) || []) m[Number(x.id)] = x.full_name || x.username; return m; };
  const named = (m, id) => (id == null ? null : (m[Number(id)] || `#${id}`));
  // Site profiles: one action applies a named bundle of rules to a site, rule by rule through the store
  // (relaxations become two-person proposals, every change is reasoned and in the history).
  const Profiles = require('../services/governanceProfiles');
  router.get('/api/governance/profiles', requireReportSession, requireCommittee, (req, res) => {
    res.json({ ok: true, profiles: Object.entries(Profiles.PROFILES).map(([name, p]) => ({ name, en: p.en, fr: p.fr, values: p.values })) });
  });
  router.post('/api/governance/policies/profile', requireReportSession, requireAdminTier, json, async (req, res) => {
    try {
      const b = req.body || {}; const u = req.reportUser; const site = Number(b.site_id);
      if (!Number.isInteger(site) || site <= 0) return res.status(400).json({ ok: false, error: 'site_id is required' });
      if (String(b.reason || '').trim().length < 3) return res.status(400).json({ ok: false, error: 'a short reason is required for every policy change' });
      const results = await Profiles.applyProfile(store(), { siteId: site, profile: String(b.profile || ''), reason: b.reason, actor: { id: u.id, isAdmin: isAdmin(u), isSuper: isSuper(u) } });
      try { await rdb().logEvent({ category: 'governance', action: 'policy_profile_applied', target: `site:${site}`, details: { profile: b.profile, results }, risk: results.some((r) => r.relaxes) ? 1 : 0, ...rdb()._logCtx(req) }); } catch (_) {}
      res.json({ ok: true, profile: b.profile, results });
    } catch (e) { fail(res, e); }
  });
  // Tamper evidence: recompute the hash chains of the audit tables now (migration 034).
  router.get('/api/governance/audit-chain', requireReportSession, requireCommittee, async (req, res) => {
    try { res.json({ ok: true, ...(await require('../services/auditChain').verify(rdb().pgHandle ? rdb().pgHandle() : rdb().db)) }); } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/policies/history', requireReportSession, requireCommittee, async (req, res) => {
    try { const m = await names(); res.json({ ok: true, history: (await store().history({ key: req.query.key || null, limit: req.query.limit })).map((h) => ({ ...h, actor: named(m, h.actor_id), proposer: named(m, h.proposed_by), approver: named(m, h.approved_by) })) }); } catch (e) { fail(res, e); }
  });
  // Two-person rule for protected relaxations (committee review 2026-10-28): a super_admin proposes, ANOTHER decides.
  router.get('/api/governance/policies/proposals', requireReportSession, requireCommittee, async (req, res) => {
    try { const m = await names(); res.json({ ok: true, proposals: (await store().listProposals({ status: req.query.status === 'all' ? null : (req.query.status || 'pending') })).map((x) => ({ ...x, proposer: named(m, x.proposed_by), decider: named(m, x.decided_by) })) }); } catch (e) { fail(res, e); }
  });
  const decideRoute = (decision) => async (req, res) => {
    try {
      const u = req.reportUser;
      const out = await store().decide(req.params.id, decision, { actor: { id: u.id, isSuper: isSuper(u) }, reason: req.body && req.body.reason });
      try { await rdb().logEvent({ category: 'governance', action: out.status === 'approved' ? 'policy_relaxed' : 'policy_relaxation_rejected', target: out.key ? `${out.scope}:${out.key}` : `proposal:${out.id}`, details: { proposal: out.id, before: out.before, after: out.after, expires_at: out.expires_at }, risk: 1, ...rdb()._logCtx(req) }); } catch (_) {}
      res.json({ ok: true, decision: out });
    } catch (e) { fail(res, e); }
  };
  router.post('/api/governance/policies/proposals/:id/approve', requireReportSession, json, decideRoute('approve'));
  router.post('/api/governance/policies/proposals/:id/reject', requireReportSession, json, decideRoute('reject'));
  // Oversight / exceptions register (MEA02): relaxations, overrides, proposals, values that differ from the defaults.
  router.get('/api/governance/oversight', requireReportSession, requireCommittee, async (req, res) => {
    try {
      const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
      const o = await store().oversight({ from: day(req.query.from), to: day(req.query.to) }); const m = await names();
      o.relaxations = o.relaxations.map((h) => ({ ...h, actor: named(m, h.actor_id), proposer: named(m, h.proposed_by), approver: named(m, h.approved_by) }));
      o.proposals = o.proposals.map((x) => ({ ...x, proposer: named(m, x.proposed_by), decider: named(m, x.decided_by) }));
      // ADR-006 — roles nobody holds (an escalation would reach nobody) belong in the exceptions register
      try {
        const R = require('../services/governanceRoles');
        const snap = await (deps.rolesStore || require('./governanceRoles').createStore(rdb())).snapshot();
        const sites = ((await rdb().listSites({ includeInactive: false })) || []).map((s) => ({ id: Number(s.id), name: s.name }));
        o.role_gaps = R.coverageGaps(snap, sites, new Date().toISOString().slice(0, 10));
      } catch (_) { o.role_gaps = null; }   // null = not measured (migration 035 absent), never "no gap"
      if (req.query.format === 'csv') {
        const { neutralize } = require('../public/lib/csvSafe');
        const q = (v) => '"' + String(neutralize(v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v)).replace(/"/g, '""') + '"';
        const lines = [['kind', 'when', 'scope_or_target', 'rule_or_action', 'detail', 'who', 'second_person'].map(q).join(',')];
        for (const h of o.relaxations) lines.push(['relaxation', h.at, h.scope, h.key, `${JSON.stringify(h.old_value)} -> ${JSON.stringify(h.new_value)} | ${h.reason}`, h.actor, h.proposer && h.approver ? `${h.proposer} / ${h.approver}` : ''].map(q).join(','));
        for (const x of o.overrides || []) lines.push(['override', x.ts, x.target, x.action, x.details, x.actor, ''].map(q).join(','));
        for (const x of o.proposals) lines.push(['proposal', x.proposed_at, x.scope, x.key, `${x.status} | ${x.reason}`, x.proposer, x.decider || ''].map(q).join(','));
        for (const g of o.role_gaps || []) lines.push(['role_gap', '', g.site || `site:${g.site_id}`, g.role, g.kind === 'matrix' ? `escalation rule #${g.matrix_id} (${g.register}) reaches nobody` : 'required role has no holder', '', ''].map(q).join(','));
        for (const d of o.deviations) lines.push(['deviation', '', d.scope, d.key, `value ${JSON.stringify(d.value)} default ${JSON.stringify(d.default)}${d.less_strict ? ' LESS STRICT' : ''}`, '', ''].map(q).join(','));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="governance-oversight.csv"');
        return res.send('\ufeff' + lines.join('\r\n'));
      }
      res.json({ ok: true, ...o });
    } catch (e) { fail(res, e); }
  });
  return router;
};
