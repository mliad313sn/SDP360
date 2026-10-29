'use strict';
// Governance policies — Admin ▸ Governance policies (validation request 2026-10-28).
//
//   GET  /api/governance/policies                 registry + global value + per-site values + effective   committee | admin
//   GET  /api/governance/policies/effective?site= resolved values for one context (who sees which rules)   any session (own sites)
//   PUT  /api/governance/policies                 { scope:'global'|'site:<id>', key, value|null, reason }  admin tier
//                                                 relaxing a PROTECTED rule needs a super_admin + 10-char reason (risk event)
//   GET  /api/governance/policies/history?key=    append-only change history (with names)                   committee | admin
//   GET  /api/governance/policies/proposals       pending two-person relaxations · POST …/proposals/:id/approve|reject  super_admin ≠ proposer
//   GET  /api/governance/oversight?from=&to=[&format=csv]   relaxations, overrides, proposals, deviations (MEA02)  committee | admin
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
  const requireAdminTier = (req, res, next) => (isAdmin(req.reportUser) ? next() : res.status(403).json({ ok: false, error: 'admin role required' }));

  router.get('/policies.html', (req, res) => deps.sendHtmlPage(res, 'policies.html', false, 'Policies page unavailable'));

  router.get('/api/governance/policies', requireReportSession, requireCommittee, async (req, res) => {
    try {
      const sites = ((await rdb().listSites({ includeInactive: false })) || []).map((s) => ({ id: Number(s.id), name: s.name }));
      res.json({ ok: true, can_write: isAdmin(req.reportUser), is_super: isSuper(req.reportUser), areas: GP.AREAS, sites,
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
      if (req.query.format === 'csv') {
        const { neutralize } = require('../public/lib/csvSafe');
        const q = (v) => '"' + String(neutralize(v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v)).replace(/"/g, '""') + '"';
        const lines = [['kind', 'when', 'scope_or_target', 'rule_or_action', 'detail', 'who', 'second_person'].map(q).join(',')];
        for (const h of o.relaxations) lines.push(['relaxation', h.at, h.scope, h.key, `${JSON.stringify(h.old_value)} -> ${JSON.stringify(h.new_value)} | ${h.reason}`, h.actor, h.proposer && h.approver ? `${h.proposer} / ${h.approver}` : ''].map(q).join(','));
        for (const x of o.overrides || []) lines.push(['override', x.ts, x.target, x.action, x.details, x.actor, ''].map(q).join(','));
        for (const x of o.proposals) lines.push(['proposal', x.proposed_at, x.scope, x.key, `${x.status} | ${x.reason}`, x.proposer, x.decider || ''].map(q).join(','));
        for (const d of o.deviations) lines.push(['deviation', '', d.scope, d.key, `value ${JSON.stringify(d.value)} default ${JSON.stringify(d.default)}${d.less_strict ? ' LESS STRICT' : ''}`, '', ''].map(q).join(','));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="governance-oversight.csv"');
        return res.send('\ufeff' + lines.join('\r\n'));
      }
      res.json({ ok: true, ...o });
    } catch (e) { fail(res, e); }
  });
  return router;
};
