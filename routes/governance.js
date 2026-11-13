'use strict';
const { fail: httpFail, logError } = require('../services/httpError');
// Step 8 — meeting cockpit (cadences, sessions, agenda, minutes), decision register, RFI register,
// portfolio (programmes → objectives → projects → milestones → deliverables, risks), governance overview,
// Roadmap Manager migration. All figures come from the KPI dictionary / registers; no formula here
// (services/agendaBuilder, minutesRenderer, portfolioEvidence are pure).
//
//   GET  /api/governance/overview                     counts for the governance dashboard
//   GET/PUT /api/governance/cadences  · DELETE /cadences/:id            committee
//   GET  /api/governance/sessions?cadence=&status=    · GET /sessions/:id (agenda, items, decisions, actions)
//   POST /api/governance/cadences/:id/sessions        generate the agenda + create a session       committee | chair | secretary
//   POST /api/governance/sessions/:id/{start,close}   lifecycle planned → held → logged → accepted (services/sessionLifecycle, G-21)
//   POST /api/governance/sessions/:id/cancel {reason} · /exception/approve (committee) · /accept (≠ who closed) · /reopen {reason} (admin)
//   POST /sessions/:id/items/:item/{start,end,notes} · PUT /sessions/:id (attendees, notes)
//   E-G03: PUT /sessions/:id/attendance (secretary/chair/committee) · GET /cadences/:id/draft-agenda (agenda_cron_enabled)
//   POST /api/governance/sessions/:id/decisions       DEC-YYYY-NNN                                  chair | secretary | admin
//   POST /api/governance/sessions/:id/actions         action linked to its source                   runner
//   GET  /api/governance/sessions/:id/minutes.html|.pdf · POST /sessions/:id/minutes/send
//   GET  /api/governance/decisions  · PUT /decisions/:id   (C-15: each decision carries source_links)
//   GET  /api/governance/engagement-delays             open decisions + session actions: days overdue + ageing (C-15)
//   E-I04: GET/POST /api/governance/rfi/from-meeting/:id · GET /rfi/:id/lineage (incubation_rfi_link_enabled, 404 while '0')
//   GET  /api/governance/rfi · POST /rfi (any session) · PUT /rfi/:id (triage/score/decide — committee) · POST /rfi/:id/verify (requester)
//   GET  /api/governance/portfolio (tree + evidence + gantt + risks + summary) · PUT /portfolio/:kind · DELETE /portfolio/:kind/:id   committee
//        (A-15: site-scoped reads + editor plan writes behind portfolio_site_scope_reads / portfolio_editor_plan_writes, off = today)
//   PUT  /api/governance/portfolio/project/:id/sites {site_ids}   extra sites of a project   committee
//   GET  /api/governance/portfolio/report.html        monthly portfolio report
//   A-27 (switches ppm_baseline_versions / ppm_rebaseline_enabled / ppm_alerts_enabled, '0' = today):
//   GET  /api/governance/portfolio/project/:id/baselines · POST /project/:id/rebaseline (committee, 404 while off)
//   GET  /api/governance/portfolio/deck.pptx · /workbook.xlsx (money only for canSeeMoney) · /exceptions (A11)
//   POST /api/governance/roadmap-migration?apply=1    Roadmap Manager → portfolio (dry run by default)   super_admin
//   W2-PPM (E-P03..E-P08): /api/governance/ppm/* in routes/governancePpm.js (each behind its PROPOSED switch)
//
// Committee = admin tier OR feature role `committee-member`. Runner of a session = committee, or the
// cadence's chair/secretary, or an editor of the cadence's site (services/userSites).

const { buildAgenda, metricKeysFor } = require('../services/agendaBuilder');
const { renderMinutes, acceptanceStamp } = require('../services/minutesRenderer');
const PE = require('../services/portfolioEvidence');
const GL = require('../services/governanceLinks');
const SA = require('../services/sessionAttendance');

function createStore(rdbMod, { log = console.log } = {}) {
  const pg = rdbMod.REPORTS_BACKEND === 'postgres';
  const st = require('../services/governanceStore').makeGovernanceStore(({ prepare: (sql) => rdbMod.pgHandle().prepare(sql), runTransaction: (fn) => rdbMod.pgHandle().runTransaction(fn) }), { isPg: pg });
  
  st.initAtBoot = async () => { await st.init(); return []; };
  return st;
}

module.exports = function governanceRoutes(deps) {
  const { express, requireReportSession, store } = deps;
  const router = express.Router();
  const json = express.json({ limit: '1mb' });
  const rdb = () => deps.rdb || require('../reports-db');
  const registry = () => deps.registry || require('../services/metricRegistry').current();
  const reportConfig = deps.reportConfig || require('../services/reportConfig');
  const userSites = require('../services/userSites');
  const readerDeps = () => deps.readerDeps || { rdb: rdb(), mdb: require('../meetings-db'), idb: require('../inspection-db'), adb: require('../assets-db'), tracker: require('../tracker-db'), trackerScore: require('../tracker-pptx') };
  const trackerStore = () => deps.trackerStore || null;

  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  const isCommittee = (u) => isAdmin(u) || rdb().userHasRole(u, 'committee-member');
  const isSuper = (u) => rdb().userHasRole(u, 'super_admin');
  const requireCommittee = (req, res, next) => isCommittee(req.reportUser) ? next() : httpFail(res, new Error('committee-member or admin role required'), 403, { ok: false });
  requireCommittee.legacyRoles = ['admin', 'committee-member'];   // C-17 capability catalogue tag
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false });
  const DL = require('../services/decisionLifecycle');   // F-PRODUCT-06
  const decisionLifecycleOn = async () => String((await reportConfig.getConfig(rdb().db)).decision_lifecycle_enforced) === '1';
  const decisionMotiveOn = async () => String((await reportConfig.getConfig(rdb().db)).decision_motive_required) === '1';   // A5
  const log = (req, action, target, details) => { try { rdb().logEvent({ category: 'governance', action, target: String(target), details, ...rdb()._logCtx(req) }); } catch (_) {} };
  // ADR-006 — role holders and deputies, from a snapshot refreshed before every governance request
  // (empty tables = the behaviour until now). deputyFor(u) = people u stands in for today.
  let roles = null, rolesVersion = -1;
  // UAT-OI-05 — portfolio_executive_readonly ('0' = today): an executive-only account reads but does not write portfolio objects
  const PXR = require('../services/portfolioExecutiveReadonly');
  router.use('/api/governance', PXR.middleware({
    getConfig: () => reportConfig.getConfig(rdb().db),
    resolveUser: (req) => rdb().validateSession(require('../services/sessionAuth').sessionToken(req)),
    fail: (res, e, st) => httpFail(res, e, st, { ok: false, code: e.reason }),
  }));
  router.use('/api/governance', async (req, res, next) => {
    const rs = deps.getRolesStore && deps.getRolesStore();
    if (rs) { try { const v = await rs.version(); if (v !== rolesVersion) { roles = await rs.snapshot(); rolesVersion = v; } } catch (_) { /* keep the last snapshot */ } }
    next();
  });
  const R = require('../services/governanceRoles');
  const today = () => new Date().toISOString().slice(0, 10);
  const deputyFor = (u) => (roles && u ? R.principalsOf(roles.deputies, u.id, today()) : []);
  const holds = (u, role, siteId) => !!(roles && u && R.holders(roles.assignments, role, siteId, today()).includes(Number(u.id)));
  const leads = (u, cad) => !!cad && [u.id, ...deputyFor(u)].map(Number).some((x) => x === Number(cad.chair_id) || x === Number(cad.secretary_id));
  const canRun = (u, cad) => isCommittee(u) || leads(u, cad) || (cad && holds(u, 'meetings.chair', cad.site_id)) || (cad && cad.site_id != null && rdb().userHasRole(u, 'editor') && userSites.hasSite(u, cad.site_id));
  // A group-level (site-less) cadence is the committee's: its sessions and minutes are read by the
  // committee, its chair / secretary and its named participants only (committee security review).
  const isParticipant = (u, cad) => { const me = [u && u.username, u && u.email].filter(Boolean).map(x => String(x).toLowerCase()); return (cad && cad.participants || []).some(p => me.includes(String(p).toLowerCase())); };
  const seesCadence = (u, cad) => !cad || cad.site_id != null || isCommittee(u) || canRun(u, cad) || isParticipant(u, cad);
  // minutes acceptor / group reviewer (the second pair of eyes from the group for one-person sites)
  const canDecide = (u, cad) => isAdmin(u) || leads(u, cad) || (cad && (holds(u, 'meetings.minutes_acceptor', cad.site_id) || holds(u, 'group.reviewer', cad.site_id)));
  // The RFI register is the committee's; anyone else sees their own requests and their sites' (G-08).
  const rfiScope = (u) => (isCommittee(u) ? null : { userId: u.id, siteIds: userSites.siteIds(u) });
  async function scopeIds(u) { if (isAdmin(u)) return null; return userSites.siteIds(u).map(Number); }
  // G-21 — lifecycle rules live in services/sessionLifecycle (pure); routes only map the actor.
  const SL = require('../services/sessionLifecycle');
  const actorFor = (u, cad) => ({ id: u && u.id, canRun: !!canRun(u, cad), canDecide: !!canDecide(u, cad), isCommittee: !!isCommittee(u), isAdmin: !!isAdmin(u), deputyFor: deputyFor(u) });
  const refuse = (res, c) => { res.status(c.status).json({ ok: false, error: c.error, code: c.code }); return true; };
  const GP = require('../services/governancePolicy');
  const polFor = (cad) => GP.forContext({ siteId: cad && cad.site_id != null ? cad.site_id : null });
  // meetings.compliance_as_of: a session is judged with the rules in force at its scheduled date (audit P1-3)
  const polForSession = async (cad, s) => {
    const now = await polFor(cad);
    if (now['meetings.compliance_as_of'] !== true || !s || !s.scheduled_at) return now;
    return GP.forContextAt({ siteId: cad && cad.site_id != null ? cad.site_id : null, at: String(s.scheduled_at) });
  };
  const lifecycle = async (req, res, x, action, o) => { const c = SL.check(x.s, action, actorFor(req.reportUser, x.cad), { ...(o || {}), policy: await polFor(x.cad) }); return c ? refuse(res, c) : false; };
  const withStage = async (s, u, cad) => { if (!s) return s; const policy = await polForSession(cad, s); return { ...s, stage: SL.stage(s, new Date(), policy), allowed: ['start', 'close', 'cancel', 'accept', 'approve_exception', 'reopen'].filter((a) => !SL.check(s, a, actorFor(u, cad), { reason: 'x'.repeat(500), policy })) }; };
  async function loadSession(req, res, { run = false, decide = false } = {}) {
    const s = await store.getSession(req.params.id); if (!s) { httpFail(res, new Error('session not found'), 404, { ok: false }); return null; }
    const cad = await store.getCadence(s.cadence_id);
    const u = req.reportUser;
    if (!isCommittee(u) && cad && cad.site_id != null && !userSites.hasSite(u, cad.site_id) && !canRun(u, cad)) { httpFail(res, new Error('session belongs to another site'), 403, { ok: false }); return null; }
    if (!seesCadence(u, cad)) { httpFail(res, new Error('group sessions are read by the committee and their participants'), 403, { ok: false }); return null; }
    if (run && !canRun(u, cad)) { httpFail(res, new Error('only the chair, the secretary, the site editors or the committee may run this session'), 403, { ok: false }); return null; }
    if (decide && !canDecide(u, cad)) { httpFail(res, new Error('only the chair, the secretary or an admin may record a decision'), 403, { ok: false }); return null; }
    return { s, cad };
  }

  // ---- agenda inputs ---------------------------------------------------------------------
  async function siteFacts(site) {
    const out = { actions: { open: null, overdue: null, list: [] }, incidents: [] };
    if (!site) return out;
    try {
      const codes = await rdb().listSiteModuleCodes('meetings'); const row = (codes || []).find(c => Number(c.site_id) === Number(site.id));
      if (row) {
        const { buildSiteActions } = require('../services/siteActionsRegister'); const mdb = require('../meetings-db'), idb = require('../inspection-db');
        const sa = buildSiteActions({ meetings: await mdb.listActions({ site: row.code }), inspection: await idb.listActions({ site: row.code }), report: { actions: (await rdb().getSiteOpenReportActions(site.id)).actions }, asOf: new Date().toISOString().slice(0, 10) });
        const list = []; for (const g of ['meetings', 'incubation', 'inspection', 'report']) for (const it of (sa.groups[g] && sa.groups[g].items) || []) if (it.overdue) list.push({ source: g, title: it.task || it.description || it.title, owner: it.owner, due_date: it.target_date || it.due_date, age_days: it.age_days });
        out.actions = { open: sa.totals.open, overdue: list.length, list: list.sort((a, b) => (b.age_days || 0) - (a.age_days || 0)).slice(0, 15) };
      }
    } catch (e) { out.actions.error = 'internal_error'; out.actions.correlation_id = logError(e); }
    try { const groups = String(site.zoho_group || '').split(',').map(x => x.trim()).filter(Boolean); out.incidents = groups.length ? (await rdb().getActiveMajorIncidentsForSite(groups)) || [] : []; } catch (e) { out.incidents = []; }
    return out;
  }
  async function trackerFacts(site) {
    const ts = trackerStore(); if (!ts) return [];
    // W1-INTEGRITY — a tracker whose scoring fails stays listed as NOT MEASURED (null + reason), never dropped silently
    const unitCode = site ? (require('../tracker-db').siteToCode(site)) : null;
    return require('../services/trackerFacts').trackerFacts(await ts.list({ status: 'published' }), { score: (k) => ts.scoreTracker(k), unitCode, rag: (m) => require('../services/kpiRag').rag(m, 'tracker-executive'), onError: (e) => logError(e) });
  }
  async function objectiveViews(now = new Date()) {
    const pf = await store.portfolio(); const reg = registry(); const dd = readerDeps();
    const views = [];
    for (const o of pf.objectives) {
      let metric = null;
      if (o.evidence_metric && reg.has(o.evidence_metric)) { const m = reg.get(o.evidence_metric); const sites = isFleetReader(m) ? [null] : (await rdb().listSites({ includeInactive: false })) || []; const vals = []; let last = null;
        for (const s of sites) { const r = await reg.resolve(o.evidence_metric, { site: s ? Number(s.id) : null, deps: dd, now }); if (r && r.value != null) { vals.push(Number(r.value)); last = r; } }
        metric = last ? { ...last, value: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null } : { key: o.evidence_metric, value: null, unit: m.unit }; }
      views.push({ ...PE.objectiveView(o, { metric, projects: pf.projects.filter(p => p.objective_id === o.id), now }), programme_id: o.programme_id });
    }
    return { pf, views };
  }
  const isFleetReader = (m) => /\.fleet$/.test(m.reader || '');
  async function generateAgenda(cad, scheduledAt) {
    const reg = registry(); const dd = readerDeps(); const now = new Date();
    const sites = (await rdb().listSites({ includeInactive: true })) || [];
    const site = cad.site_id != null ? sites.find(s => Number(s.id) === Number(cad.site_id)) : null;
    const metrics = [];
    for (const k of metricKeysFor(cad.kind, cad.agenda_template)) {
      const m = reg.get(k); if (!m) continue;
      if (!site && !isFleetReader(m)) { const vals = []; let last = null; for (const s of sites.filter(x => x.active !== 0)) { const r = await reg.resolve(k, { site: Number(s.id), deps: dd, now }); if (r && r.value != null) { vals.push(Number(r.value)); last = r; } } metrics.push(last ? { ...last, site: null, value: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null, name: m.name + ' (fleet mean)' } : { key: k, name: m.name, unit: m.unit, value: null, rag: 'NA' }); continue; }
      const r = await reg.resolve(k, { site: isFleetReader(m) ? null : Number(site.id), deps: dd, now }); if (r) metrics.push(r);
    }
    const facts = await siteFacts(site);
    // UAT (PMO F2): the actions agreed in this cadence's earlier sessions come back to the table
    try {
      const today = now.toISOString().slice(0, 10);
      const carried = (await store.openSessionActions({ cadenceId: cad.id })).map(a => ({ source: 'session', title: a.title, owner: a.owner, due_date: a.due_date, overdue: !!(a.due_date && String(a.due_date).slice(0, 10) < today), from_session: String(a.session_at || '').slice(0, 10) }));
      if (carried.length) {
        facts.actions.list = [...carried, ...(facts.actions.list || [])].slice(0, 25);
        facts.actions.open = (facts.actions.open || 0) + carried.length;
        facts.actions.overdue = (facts.actions.overdue || 0) + carried.filter(a => a.overdue).length;
        facts.actions.carried = carried.length;
      }
    } catch (_) { /* the agenda still builds */ }
    const decisions = (await store.listDecisions({ status: DL.OPEN_STATUSES, siteIds: site ? [Number(site.id)] : null })).slice(0, 15);
    const rfis = isCommitteeKind(cad.kind) ? (await store.listRfi({ status: ['submitted', 'triaged'] })).slice(0, 10) : [];
    const trackers = await trackerFacts(site);
    const portfolio = isCommitteeKind(cad.kind) || cad.kind === 'group_monthly' ? { objectives: (await objectiveViews(now)).views } : { objectives: [] };
    return buildAgenda({ cadence: cad, scheduledAt, metrics, actions: facts.actions, incidents: facts.incidents, decisions, rfis, trackers, portfolio, now, nextSession: null });
  }
  const isCommitteeKind = (k) => k === 'committee' || k === 'group_monthly';
  require('../services/agendaDrafts').setCompiler((cad, at) => generateAgenda(cad, at));   // E-G03: the scheduled draft uses the cockpit's builder

  // ---- overview ---------------------------------------------------------------------------
  router.get('/api/governance/overview', requireReportSession, async (req, res) => {
    try {
      const ids = await scopeIds(req.reportUser);
      const [cad, dec, rfi, sess] = [await store.listCadences({ siteIds: ids }), await store.listDecisions({ status: DL.OPEN_STATUSES, siteIds: ids }), await store.listRfi({ status: ['submitted', 'triaged', 'accepted', 'scheduled'], scope: rfiScope(req.reportUser) }), await store.listSessions({ limit: 200 })];
      const today = new Date().toISOString().slice(0, 10);
      const allowedCad = new Set(cad.map(c => c.id));
      const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const recent = sess.filter(s => allowedCad.has(s.cadence_id) && String(s.scheduled_at || '').slice(0, 10) >= since);
      const cadById = new Map(cad.map(c => [c.id, c]));
      const groups = [];
      // one group per distinct policy: per cadence today, per session date when meetings.compliance_as_of is on
      const byPol = new Map();
      for (const s of recent) { const pol = await polForSession(cadById.get(s.cadence_id), s); const k = JSON.stringify(pol) + '|' + (pol.__off_days || []).join(','); if (!byPol.has(k)) byPol.set(k, { sessions: [], policy: pol }); byPol.get(k).sessions.push(s); }
      for (const g of byPol.values()) groups.push(g);
      const compliance30d = SL.complianceByContext(groups, new Date());
      res.json({ ok: true, committee: isCommittee(req.reportUser), cadences: cad.length, compliance_30d: compliance30d, sessions_held_30d: sess.filter(s => allowedCad.has(s.cadence_id) && s.status === 'closed' && String(s.closed_at || '').slice(0, 10) >= since).length, sessions_planned: sess.filter(s => allowedCad.has(s.cadence_id) && s.status === 'planned').length,   // UAT PMO F7: only the user's cadences
        decisions_open: dec.length, decisions_overdue: dec.filter(d => d.due_date && d.due_date < today).length, rfi_to_triage: rfi.filter(r => r.status === 'submitted').length, rfi_in_flight: rfi.filter(r => r.status !== 'submitted').length });
    } catch (e) { fail(res, e); }
  });

  // A-19c — soft delete when report_config soft_delete_enabled = '1' (default '0' = today's hard delete). Restore: routes/softDelete.js.
  // A5 (P6) — soft_delete_two_person = '1' (with soft delete on): a reason (≥ 10 chars) + a SECOND person. The first DELETE
  // records a request in the ledger (202), a DELETE by another authorised person confirms and stamps; the requester never confirms.
  // Returns the store options, or null when the response was already sent (refusal, or request recorded).
  const _softDelete = async (req, res, kind, id) => {
    const SD = require('../services/softDelete'); const cfg = await SD.readConfig(rdb());
    if (!SD.isEnabled(cfg)) return {};
    const u = req.reportUser; const reason = (req.body && req.body.reason) || req.query.reason || null;
    const softable = kind === 'cadence' || !!SD.TABLES['portfolio_' + kind + 's'];
    if (!SD.twoPersonEnabled(cfg) || !softable) return { soft: true, user: u, reason };
    const row = kind === 'cadence' ? await store.getCadenceTrashRow(id) : await store.getPortfolioTrashRow(kind, id);
    if (!row) { httpFail(res, new Error('not found'), 404, { ok: false }); return null; }
    if (row.deleted_at) { httpFail(res, new Error('already deleted'), 409, { ok: false }); return null; }
    const step = SD.twoPersonStep({ last: await store.deleteRequestState(kind, id), userId: u.id, reason });
    if (step.step === 'refuse') { res.status(step.status).json({ ok: false, code: step.code, error: step.error }); return null; }
    if (step.step === 'request') {
      await store.ppmEvent({ entity: 'delete_request:' + kind, entity_id: Number(id), action: 'requested', note: step.reason }, u);
      log(req, 'delete_requested', `${kind}:${id}`, { reason: step.reason });
      res.status(202).json({ ok: true, pending: true, soft: true, kind, id: Number(id), message: 'deletion requested — another authorised person must confirm it' }); return null;
    }
    return { soft: true, user: u, reason: `${step.reason} — requested by #${step.requested_by}, confirmed by #${u.id}`, _confirm: { kind, id: Number(id), note: step.reason } };
  };
  const _confirmed = async (req, soft) => { if (soft && soft._confirm) { await store.ppmEvent({ entity: 'delete_request:' + soft._confirm.kind, entity_id: soft._confirm.id, action: 'confirmed', note: soft._confirm.note }, req.reportUser); log(req, 'delete_confirmed', `${soft._confirm.kind}:${soft._confirm.id}`, {}); } };
  router.get('/api/governance/delete-requests', requireReportSession, requireCommittee, async (req, res) => { try { res.json({ ok: true, requests: await store.pendingDeleteRequests() }); } catch (e) { fail(res, e); } });
  // ---- cadences ---------------------------------------------------------------------------
  // Chair / secretary picker for the cadence form (committee field review): names, never typed ids.
  router.get('/api/governance/people', requireReportSession, async (req, res) => {
    try {
      if (!isCommittee(req.reportUser)) return httpFail(res, new Error('committee only'), 403, { ok: false });
      const site = req.query.site == null || req.query.site === '' ? null : Number(req.query.site);
      const people = ((await rdb().listUsers()) || []).filter((x) => x.active !== 0 && x.active !== false && (site == null || [x.site_id, ...(x.extra_site_ids || [])].filter((v) => v != null).map(Number).includes(site)))
        .map((x) => ({ id: Number(x.id), name: x.full_name || x.username })).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
      res.json({ ok: true, people });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/cadences', requireReportSession, async (req, res) => { try { const ids = await scopeIds(req.reportUser); const sites = ((await rdb().listSites({ includeInactive: false })) || []).filter(s => !ids || ids.includes(Number(s.id))).map(s => ({ id: s.id, name: s.name })); res.json({ ok: true, committee: isCommittee(req.reportUser), sites, cadences: (await store.listCadences({ siteIds: ids, includeInactive: isCommittee(req.reportUser) })).filter(c => seesCadence(req.reportUser, c)) }); } catch (e) { fail(res, e); } });
  router.put('/api/governance/cadences', requireReportSession, requireCommittee, json, async (req, res) => { try { const c = await store.saveCadence(req.body, { user: req.reportUser }); log(req, 'cadence_saved', c.key); res.json({ ok: true, cadence: c }); } catch (e) { fail(res, e); } });
  router.delete('/api/governance/cadences/:id', requireReportSession, requireCommittee, json, async (req, res) => { try { const soft = await _softDelete(req, res, 'cadence', req.params.id); if (!soft) return; await store.removeCadence(req.params.id, soft); await _confirmed(req, soft); log(req, soft.soft ? 'cadence_soft_deleted' : 'cadence_removed', req.params.id); res.json({ ok: true, soft: !!soft.soft }); } catch (e) { fail(res, e); } });
  router.post('/api/governance/cadences/:id/sessions', requireReportSession, json, async (req, res) => {
    try {
      const cad = await store.getCadence(req.params.id); if (!cad) return httpFail(res, new Error('cadence not found'), 404, { ok: false });
      if (!canRun(req.reportUser, cad)) return httpFail(res, new Error('not allowed to prepare this cadence'), 403, { ok: false });
      const when = (req.body && req.body.scheduled_at) || new Date().toISOString();
      if (!cad.active) return httpFail(res, new Error('the cadence is inactive'), 409, { ok: false });
      if (!SL.inEffectiveWindow(cad, when)) return res.status(400).json({ ok: false, error: `the cadence is effective ${cad.effective_from || '…'} → ${cad.effective_to || '…'}; ${String(when).slice(0, 10)} is outside it` });
      const agenda = await generateAgenda(cad, when);
      const s = await store.createSession({ cadenceId: cad.id, scheduledAt: when, agenda, user: req.reportUser });
      log(req, 'session_prepared', s.id, { cadence: cad.key, reds: agenda.summary.reds });
      res.json({ ok: true, session: s });
    } catch (e) { fail(res, e); }
  });

  // ---- sessions ---------------------------------------------------------------------------
  router.get('/api/governance/sessions', requireReportSession, async (req, res) => {
    try { const ids = await scopeIds(req.reportUser); const cads = (await store.listCadences({ siteIds: ids, includeInactive: true })).filter(c => seesCadence(req.reportUser, c)); const allowed = new Set(cads.map(c => c.id));
      const rows = (await store.listSessions({ cadenceId: req.query.cadence || null, status: req.query.status || null, limit: req.query.limit })).filter(s => allowed.has(s.cadence_id));
      res.json({ ok: true, sessions: rows.map(s => ({ ...s, cadence: (cads.find(c => c.id === s.cadence_id) || {}).name })) }); } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/sessions/:id', requireReportSession, async (req, res) => {
    try { const x = await loadSession(req, res); if (!x) return; res.json({ ok: true, session: (await withStage(x.s, req.reportUser, x.cad)), minutes_history: await store.minutesHistory(x.s.id), cadence: x.cad, decisions: await store.listDecisions({ sessionId: x.s.id }), actions: await store.sessionActions(x.s.id), can_run: canRun(req.reportUser, x.cad), can_decide: canDecide(req.reportUser, x.cad), can_record_attendance: isCommittee(req.reportUser) || leads(req.reportUser, x.cad), quorum: SA.quorum(x.s.attendance, (await polForSession(x.cad, x.s))['governance.quorum_min']) }); } catch (e) { fail(res, e); }
  });
  // E-G03 — attendance recorded by the secretary (or the chair, a deputy of either, the committee); quorum per
  // governance.quorum_min (null = not defined). Editing follows the session lifecycle like notes/attendees.
  router.put('/api/governance/sessions/:id/attendance', requireReportSession, json, async (req, res) => {
    try {
      const x = await loadSession(req, res, { run: true }); if (!x) return;
      if (!isCommittee(req.reportUser) && !leads(req.reportUser, x.cad)) return httpFail(res, new Error('attendance is recorded by the secretary, the chair or the committee'), 403, { ok: false });
      if (await lifecycle(req, res, x, 'edit')) return;
      const att = SA.normalize((req.body && req.body.attendance) || null, { by: req.reportUser.id });
      const s = await store.setAttendance(x.s.id, att);
      const quorum = SA.quorum(s.attendance, (await polForSession(x.cad, s))['governance.quorum_min']);
      log(req, 'session_attendance', x.s.id, { present: quorum.present, state: quorum.state });
      res.json({ ok: true, session: s, quorum });
    } catch (e) { fail(res, e); }
  });
  // E-G03 — the scheduled DRAFT agenda of a cadence (job governance.agenda_drafts; nothing sent). 404 while agenda_cron_enabled = '0'.
  router.get('/api/governance/cadences/:id/draft-agenda', requireReportSession, async (req, res) => {
    try {
      if (String((await reportConfig.getConfig(rdb().db)).agenda_cron_enabled) !== '1') return httpFail(res, new Error('not found'), 404, { ok: false });
      const cad = await store.getCadence(req.params.id); if (!cad) return httpFail(res, new Error('cadence not found'), 404, { ok: false });
      const u = req.reportUser;
      if (!isCommittee(u) && cad.site_id != null && !userSites.hasSite(u, cad.site_id) && !canRun(u, cad)) return httpFail(res, new Error('cadence belongs to another site'), 403, { ok: false });
      if (!seesCadence(u, cad)) return httpFail(res, new Error('group cadences are read by the committee and their participants'), 403, { ok: false });
      res.json({ ok: true, status: cad.draft_agenda ? 'draft' : 'none', for: cad.draft_agenda_for || null, compiled_at: cad.draft_agenda_at || null, agenda: cad.draft_agenda || null });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/sessions/:id', requireReportSession, json, async (req, res) => {
    try { const x = await loadSession(req, res, { run: true }); if (!x) return; if (await lifecycle(req, res, x, 'edit')) return; if (req.body.scheduled_at && await lifecycle(req, res, x, 'reschedule')) return; const p = {}; if (Array.isArray(req.body.attendees)) p.attendees = req.body.attendees.map(a => String(a).slice(0, 120)).slice(0, 50); if (req.body.notes !== undefined) p.notes = String(req.body.notes).slice(0, 20000); if (req.body.scheduled_at) p.scheduled_at = String(req.body.scheduled_at).slice(0, 25); const out = await store.updateSession(x.s.id, p); if (p.scheduled_at && p.scheduled_at !== x.s.scheduled_at) { log(req, 'session_rescheduled', x.s.id, { from: x.s.scheduled_at, to: p.scheduled_at }); await store.addMinutesHistory(x.s.id, 'rescheduled', req.reportUser.id, `from ${x.s.scheduled_at} to ${p.scheduled_at}${req.body.reason ? ' — ' + String(req.body.reason).slice(0, 300) : ''}`); } res.json({ ok: true, session: out }); } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/sessions/:id/start', requireReportSession, async (req, res) => {
    try { const x = await loadSession(req, res, { run: true }); if (!x) return; if (await lifecycle(req, res, x, 'start')) return; const s = await store.moveSession(x.s.id, 'planned', { status: 'live', started_at: x.s.started_at || new Date().toISOString() }); if (!s) return res.status(409).json({ ok: false, error: 'the session changed meanwhile — reload', code: 'CONFLICT' }); log(req, 'session_started', s.id); res.json({ ok: true, session: s }); } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/sessions/:id/items/:item/:op', requireReportSession, json, async (req, res) => {
    try { const x = await loadSession(req, res, { run: true }); if (!x) return; if (await lifecycle(req, res, x, 'edit')) return; const op = req.params.op; const item = String(req.params.item).slice(0, 40);
      if (op === 'notes') { const items = x.s.items || []; let it = items.find(i => i.id === item); if (!it) { it = { id: item, started_at: null, ended_at: null }; items.push(it); } it.notes = String(req.body && req.body.notes || '').slice(0, 5000); return res.json({ ok: true, session: await store.updateSession(x.s.id, { items }) }); }
      if (op !== 'start' && op !== 'end') return httpFail(res, new Error('op must be start | end | notes'), 400, { ok: false });
      res.json({ ok: true, session: await store.stampItem(x.s.id, item, op === 'start' ? 'started_at' : 'ended_at') }); } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/sessions/:id/decisions', requireReportSession, json, async (req, res) => {
    try { const x = await loadSession(req, res, { decide: true }); if (!x) return; if (await lifecycle(req, res, x, 'edit')) return; const d = await store.addDecision({ ...req.body, session_id: x.s.id, site_id: x.cad ? x.cad.site_id : null }, { user: req.reportUser }); log(req, 'decision_recorded', d.ref, { session: x.s.id }); res.json({ ok: true, decision: d }); } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/sessions/:id/actions', requireReportSession, json, async (req, res) => {
    try { const x = await loadSession(req, res, { run: true }); if (!x) return; if (await lifecycle(req, res, x, 'edit')) return; const a = await store.addSessionAction(x.s.id, req.body, { user: req.reportUser }); log(req, 'session_action_added', a.id, { session: x.s.id }); res.json({ ok: true, action: a }); } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/sessions/:id/actions/:aid', requireReportSession, json, async (req, res) => {
    // follow-up status stays editable after acceptance (the work lives on); the action must belong to THIS session
    try { const x = await loadSession(req, res, { run: true }); if (!x) return;
      const n = await store.setSessionActionStatus(req.params.aid, req.body && req.body.status, x.s.id);
      if (!n) return httpFail(res, new Error('action not found in this session'), 404, { ok: false });
      log(req, 'session_action_status', req.params.aid, { session: x.s.id, status: req.body && req.body.status }); res.json({ ok: true, actions: await store.sessionActions(x.s.id) }); } catch (e) { fail(res, e); }
  });
  async function minutesFor(x) {
    const sites = (await rdb().listSites({ includeInactive: true })) || []; const site = x.cad && x.cad.site_id != null ? sites.find(s => Number(s.id) === Number(x.cad.site_id)) : null;
    const cfg = await reportConfig.getConfig(rdb().db);
    const quorum = SA.quorum(x.s.attendance, (await polForSession(x.cad, x.s))['governance.quorum_min']);   // E-G03
    return renderMinutes({ cadence: x.cad, session: x.s, decisions: await store.listDecisions({ sessionId: x.s.id }), actions: await store.sessionActions(x.s.id), siteName: site ? site.name : null, baseUrl: cfg.public_base_url || '', quorum });
  }
  router.post('/api/governance/sessions/:id/close', requireReportSession, async (req, res) => {
    try { const x = await loadSession(req, res, { run: true }); if (!x) return; if (await lifecycle(req, res, x, 'close')) return; x.s.closed_at = new Date().toISOString(); x.s.status = 'closed'; const html = await minutesFor(x); const s = await store.moveSession(x.s.id, 'live', { status: 'closed', closed_at: x.s.closed_at, closed_by: req.reportUser.id, minutes_html: html }); if (!s) return res.status(409).json({ ok: false, error: 'the session changed meanwhile — reload', code: 'CONFLICT' }); log(req, 'session_closed', s.id); res.json({ ok: true, session: { ...(await withStage(s, req.reportUser, x.cad)), minutes_html: undefined }, minutes_bytes: html.length }); } catch (e) { fail(res, e); }
  });
  // G-21 — cancellation (an exception the committee approves), minutes acceptance (four-eyes), admin reopen.
  router.post('/api/governance/sessions/:id/cancel', requireReportSession, json, async (req, res) => {
    try { const x = await loadSession(req, res); if (!x) return; const reason = String((req.body && req.body.reason) || '').trim(); if (await lifecycle(req, res, x, 'cancel', { reason })) return;
      // always pending: the exception is approved by a committee member OTHER than the canceller (four-eyes)
      const s = await store.moveSession(x.s.id, 'planned', { status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: req.reportUser.id, cancel_reason: reason.slice(0, 1000), exception_status: 'pending' });
      if (!s) return res.status(409).json({ ok: false, error: 'the session changed meanwhile — reload', code: 'CONFLICT' });
      log(req, 'session_cancelled', s.id, { exception: s.exception_status }); res.json({ ok: true, session: (await withStage(s, req.reportUser, x.cad)) }); } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/sessions/:id/exception/approve', requireReportSession, async (req, res) => {
    try { const x = await loadSession(req, res); if (!x) return; if (await lifecycle(req, res, x, 'approve_exception')) return;
      const s = await store.updateSession(x.s.id, { exception_status: 'approved', exception_approved_by: req.reportUser.id, exception_approved_at: new Date().toISOString() });
      log(req, 'session_exception_approved', s.id); res.json({ ok: true, session: (await withStage(s, req.reportUser, x.cad)) }); } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/sessions/:id/accept', requireReportSession, async (req, res) => {
    try { const x = await loadSession(req, res); if (!x) return; if (await lifecycle(req, res, x, 'accept')) return;
      const at = new Date().toISOString();
      // UAT (PMO F4): the frozen minutes say who accepted them and when
      const stamped = acceptanceStamp(x.s.minutes_html || await minutesFor(x), { name: req.reportUser.full_name || req.reportUser.username, at });
      const s = await store.updateSession(x.s.id, { minutes_accepted_at: at, minutes_accepted_by: req.reportUser.id, minutes_html: stamped });
      // G08 — minutes accepted by the person who recorded them (four-eyes switched off, e.g. small-site profile)
      // are listed as an exception, so the group can review them afterwards instead of trusting a promise.
      const sameHand = x.s.closed_by != null && Number(x.s.closed_by) === Number(req.reportUser.id);
      await store.addMinutesHistory(s.id, sameHand ? 'accepted_without_second_person' : 'accepted', req.reportUser.id, sameHand ? 'four-eyes switched off by policy for this context' : null);
      if (sameHand) try { rdb().logEvent({ category: 'governance', action: 'minutes_single_signature', target: String(s.id), risk: 1, ...rdb()._logCtx(req) }); } catch (_) {}
      log(req, 'minutes_accepted', s.id); res.json({ ok: true, session: { ...(await withStage(s, req.reportUser, x.cad)), minutes_html: undefined } }); } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/sessions/:id/reopen', requireReportSession, json, async (req, res) => {
    try { const x = await loadSession(req, res); if (!x) return; const reason = String((req.body && req.body.reason) || '').trim(); if (await lifecycle(req, res, x, 'reopen', { reason })) return;
      // two-person reopening when the policy asks for it: the first admin records a request, another confirms
      const step = SL.reopenStep(await store.minutesHistory(x.s.id), req.reportUser, await polFor(x.cad));
      if (step === 'request') { await store.addMinutesHistory(x.s.id, 'reopen_requested', req.reportUser.id, reason); log(req, 'minutes_reopen_requested', x.s.id, { reason: reason.slice(0, 200) }); return res.status(202).json({ ok: true, pending: true, message: 'reopening requested — another admin must confirm it' }); }
      if (step !== 'reopen') return res.status(step.status).json({ ok: false, error: step.error, code: step.code });
      // back to live: the minutes are re-recorded at the next close and need a new acceptance
      const s = await store.moveSession(x.s.id, 'closed', { status: 'live', minutes_accepted_at: null, minutes_accepted_by: null, reopen_reason: reason.slice(0, 1000) });
      if (!s) return res.status(409).json({ ok: false, error: 'the session changed meanwhile — reload', code: 'CONFLICT' });
      await store.addMinutesHistory(s.id, 'reopened', req.reportUser.id, reason);
      log(req, 'minutes_reopened', s.id, { reason: reason.slice(0, 200) }); res.json({ ok: true, session: { ...(await withStage(s, req.reportUser, x.cad)), minutes_html: undefined } }); } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/sessions/:id/minutes.html', requireReportSession, async (req, res) => { try { const x = await loadSession(req, res); if (!x) return; res.type('html').send(x.s.minutes_html || await minutesFor(x)); } catch (e) { fail(res, e); } });
  router.get('/api/governance/sessions/:id/minutes.pdf', requireReportSession, async (req, res) => {
    try { const x = await loadSession(req, res); if (!x) return; const html = x.s.minutes_html || await minutesFor(x); const r = await (deps.renderPdf || require('../services/reportRender').renderPdf)(html, { stamp: `minutes-${x.s.id}` });
      if (!r.ok) return res.status(503).json({ ok: false, error: 'PDF unavailable: ' + r.reason, html_available: true }); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="minutes-${x.s.id}.pdf"`); res.send(r.pdf); } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/sessions/:id/minutes/send', requireReportSession, json, async (req, res) => {
    try { const x = await loadSession(req, res, { run: true }); if (!x) return;
      // UAT (PMO F3): minutes become official when a second person accepts them — never sent before
      if (!x.s.minutes_accepted_at) return res.status(409).json({ ok: false, code: 'NOT_ACCEPTED', error: 'the minutes are not accepted yet — a second person must accept them before they are sent' });
      const to = (x.cad && x.cad.participants || []).filter(p => /@/.test(String(p))); if (!to.length) return httpFail(res, new Error('the cadence has no participant e-mail address (edit the cadence)'), 400, { ok: false });
      const html = x.s.minutes_html || await minutesFor(x); const cfg = await reportConfig.getConfig(rdb().db);
      const pdf = await (deps.renderPdf || require('../services/reportRender').renderPdf)(html, { stamp: `minutes-${x.s.id}` });
      const sent = await (deps.buildMailer || require('../services/mailer').buildMailer)(cfg).send({ to, subject: `Minutes — ${x.cad.name} — ${String(x.s.started_at || x.s.scheduled_at).slice(0, 10)}`, html, attachments: pdf.ok ? [{ filename: `minutes-${x.s.id}.pdf`, content: pdf.pdf }] : [] });
      if (sent.ok) await store.updateSession(x.s.id, { minutes_sent_at: new Date().toISOString() });
      log(req, sent.ok ? 'minutes_sent' : 'minutes_send_failed', x.s.id, { to: to.length, pdf: pdf.ok }); res.json({ ok: !!sent.ok, error: sent.error, to: to.length, pdf: pdf.ok }); } catch (e) { fail(res, e); }
  });

  // ---- decisions / RFI --------------------------------------------------------------------
  // decisions the reader may see: the site scope, then group decisions follow the session's own visibility
  // when meetings.group_decisions_public = false (shared by /decisions and /engagement-delays — C-15)
  async function visibleDecisions(u, status) {
    let rows = await store.listDecisions({ status, siteIds: await scopeIds(u) });
    // meetings.group_decisions_public = false: decisions of group sessions follow the session's own visibility
    if (!isCommittee(u) && (await GP.forContext({}))['meetings.group_decisions_public'] === false) {
      const cads = new Map((await store.listCadences({ includeInactive: true })).map((c) => [c.id, c])); const sessCad = new Map();
      const keep = [];
      for (const d of rows) {
        if (d.site_id != null) { keep.push(d); continue; }
        if (d.session_id == null) continue;
        if (!sessCad.has(d.session_id)) { const s = await store.getSession(d.session_id); sessCad.set(d.session_id, s ? cads.get(s.cadence_id) : null); }
        const c = sessCad.get(d.session_id); if (c && seesCadence(u, c)) keep.push(d);
      }
      rows = keep;
    }
    return rows;
  }
  // C-15 (G23) — every decision carries its source links (session in the cockpit, PV / reference it names)
  async function withSourceLinks(rows) {
    const cadName = new Map((await store.listCadences({ includeInactive: true })).map((c) => [c.id, c.name]));
    const sessions = new Map();
    for (const d of rows) {
      if (d.session_id == null || sessions.has(d.session_id)) continue;
      const s = await store.getSession(d.session_id);
      sessions.set(d.session_id, s ? { id: s.id, scheduled_at: s.scheduled_at, cadence_name: cadName.get(s.cadence_id) || null } : null);
    }
    return rows.map((d) => ({ ...d, source_links: GL.decisionSourceLinks(d, { sessions }) }));
  }
  // A5 (P6) — a decision awaiting confirmation names who is expected to act: the chair / secretary of its session's
  // cadence (names, never ids typed by hand), who proposed it and when. The confirmation itself stays a committee act,
  // and never by the proposer (services/decisionLifecycle.selfConfirmRefusal).
  async function withApprovers(rows) {
    const waiting = rows.filter((d) => d.status === 'awaiting_confirmation'); if (!waiting.length) return rows;
    const names = new Map(((await rdb().listUsers()) || []).map((x) => [Number(x.id), x.full_name || x.username]));
    const who = (id) => (id == null ? null : { id: Number(id), name: names.get(Number(id)) || null });
    const out = new Map();
    for (const d of waiting) {
      let cad = null;
      if (d.session_id != null) { const sess = await store.getSession(d.session_id); cad = sess ? await store.getCadence(sess.cadence_id) : null; }
      const prop = await store.decisionProposal(d.id);
      out.set(d.id, { chair: cad ? who(cad.chair_id) : null, secretary: cad ? who(cad.secretary_id) : null, cadence_name: cad ? cad.name : null, confirmed_by: 'committee',
        proposed_by: prop ? { id: prop.actor_id, name: (prop.actor_id != null && names.get(prop.actor_id)) || prop.actor || null } : null, proposed_at: prop ? prop.at : null });
    }
    return rows.map((d) => (out.has(d.id) ? { ...d, pending_approver: out.get(d.id) } : d));
  }
  router.get('/api/governance/decisions', requireReportSession, async (req, res) => {
    try {
      const rows = await visibleDecisions(req.reportUser, req.query.status ? String(req.query.status).split(',') : null);
      res.json({ ok: true, decisions: await withApprovers(await withSourceLinks(rows)) });
    } catch (e) { fail(res, e); }
  });
  // C-15 (G23) — engagement delays: open decisions + open session actions the reader may see, with days overdue
  // and an ageing summary. A missing / unreadable due date is UNKNOWN (null), never 0 days.
  router.get('/api/governance/engagement-delays', requireReportSession, async (req, res) => {
    try {
      const u = req.reportUser; const asOf = new Date().toISOString().slice(0, 10);
      const decs = await withSourceLinks(await visibleDecisions(u, DL.OPEN_STATUSES));
      const cads = new Map((await store.listCadences({ siteIds: await scopeIds(u), includeInactive: true })).filter((c) => seesCadence(u, c)).map((c) => [c.id, c]));
      const acts = (await store.openSessionActions()).filter((a) => cads.has(a.cadence_id));
      const items = [
        ...decs.map((d) => ({ kind: 'decision', ref: d.ref, title: d.title, owner: d.owner || null, due_date: d.due_date || null, status: d.status, session_id: d.session_id, site_id: d.site_id, href: (d.source_links.find((l) => l.href) || {}).href || null, source_links: d.source_links })),
        ...acts.map((a) => ({ kind: 'action', ref: a.decision_ref || null, title: a.title, owner: a.owner || null, due_date: a.due_date || null, status: a.status, session_id: a.session_id, site_id: a.site_id == null ? null : Number(a.site_id), cadence_name: a.cadence_name, href: 'cockpit.html?session=' + a.session_id })),
      ];
      const r = GL.engagementDelays(items, asOf);
      res.json({ ok: true, as_of: asOf, items: r.items, summary: r.summary, compliance_href: 'meetings-compliance.html' });
    } catch (e) { fail(res, e); }
  });
  // UAT (PMO F8): the site follows its decisions between meetings — the chair / secretary of the session's
  // cadence or an editor of the decision's site may move its STATUS; the content stays a committee edit.
  // F-PRODUCT-06: who may move this decision's status at all — the committee, or (as a 'site' actor) the chair /
  // secretary of the session's cadence or an editor of the decision's site.
  async function decisionActor(u, dec) {
    if (isCommittee(u)) return 'committee';
    let allowed = false;
    if (dec.session_id != null) { const sess = await store.getSession(dec.session_id); const cad = sess && await store.getCadence(sess.cadence_id); allowed = !!(cad && canRun(u, cad)); }
    if (!allowed && dec.site_id != null) allowed = rdb().userHasRole(u, 'editor') && userSites.hasSite(u, Number(dec.site_id));
    return allowed ? 'site' : null;
  }
  router.put('/api/governance/decisions/:id', requireReportSession, json, async (req, res) => {
    try {
      const b = req.body || {}; const u = req.reportUser;
      const dec = await store.getDecision(req.params.id);
      if (!isCommittee(u)) {
        const keys = Object.keys(b).filter((k) => b[k] !== undefined);
        if (keys.some((k) => k !== 'status' && k !== 'reason')) return httpFail(res, new Error('only the committee edits a decision; the site may update its status'), 403, { ok: false });
      }
      if (!dec) return httpFail(res, new Error('decision not found'), 404, { ok: false });
      const actor = await decisionActor(u, dec);
      if (!actor) return httpFail(res, new Error('not allowed to update this decision'), 403, { ok: false });
      const d = await store.updateDecision(req.params.id, b, { user: u, reason: b.reason, lifecycle: { enforced: await decisionLifecycleOn(), actor, motive: await decisionMotiveOn() } }); if (!d) return httpFail(res, new Error('decision not found'), 404, { ok: false });
      log(req, 'decision_updated', d.ref, { status: b.status ? d.status : null, proposed: d.proposed === true || undefined }); res.json({ ok: true, decision: d });
    } catch (e) { if (e && e.expose === true && e.code) return httpFail(res, e, undefined, { ok: false, code: e.code }); fail(res, e); }
  });
  // F-PRODUCT-06 — the decision's own ledger (status changes with actor and reason), for whoever may see the decision
  router.get('/api/governance/decisions/:id/history', requireReportSession, async (req, res) => {
    try {
      // the committee owns the register; anyone else reads the history of a decision they can already see
      const dec = isCommittee(req.reportUser) ? await store.getDecision(req.params.id) : (await visibleDecisions(req.reportUser, null)).find((d) => Number(d.id) === Number(req.params.id));
      if (!dec) return httpFail(res, new Error('decision not found'), 404, { ok: false });
      const enforced = await decisionLifecycleOn(); const actor = await decisionActor(req.reportUser, dec);
      const motive = await decisionMotiveOn();
      res.json({ ok: true, ref: dec.ref, status: dec.status, lifecycle_enforced: enforced, motive_required: motive, allowed: actor ? DL.allowed(dec.status, actor, { enforced, motive }) : [], events: await store.decisionHistory(dec.id) });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/rfi', requireReportSession, async (req, res) => { try { res.json({ ok: true, committee: isCommittee(req.reportUser), me: Number(req.reportUser.id), rfi: await store.listRfi({ status: req.query.status ? String(req.query.status).split(',') : null, scope: rfiScope(req.reportUser) }), kinds: store.RFI_KINDS, statuses: store.RFI_STATUSES }); } catch (e) { fail(res, e); } });
  router.post('/api/governance/rfi', requireReportSession, json, async (req, res) => { try { const r = await store.submitRfi({ ...req.body, site_id: req.body && req.body.site_id != null ? req.body.site_id : (userSites.siteIds(req.reportUser)[0] || null) }, { user: req.reportUser }); log(req, 'rfi_submitted', r.ref, { kind: r.kind }); res.json({ ok: true, rfi: r }); } catch (e) { fail(res, e); } });
  router.post('/api/governance/rfi/:id/verify', requireReportSession, async (req, res) => { try { const r = await store.verifyRfi(req.params.id, { user: req.reportUser }); log(req, 'rfi_verified', r.ref); res.json({ ok: true, rfi: r }); } catch (e) { const known = { 403: 'only the requester confirms the delivery', 404: 'request not found', 409: 'only a delivered request can be confirmed' }; if (known[e.status]) return res.status(e.status).json({ ok: false, code: e.code, error: known[e.status] }); fail(res, e); } });
  // E-I04 — Business Incubation session → RFI (one per session) + lineage. Every route 404 while
  // incubation_rfi_link_enabled = '0' (default, today). Writer = editor of the session's site, or the admin tier.
  const incubationRfiOn = async () => String((await reportConfig.getConfig(rdb().db)).incubation_rfi_link_enabled) === '1';
  const mdb = () => deps.meetingsDb || require('../meetings-db');
  async function incubationSource(req, res, { write = false } = {}) {
    if (!(await incubationRfiOn())) { httpFail(res, new Error('not found'), 404, { ok: false }); return null; }
    const src = await mdb().getIncubationSource(req.params.id);
    if (!src) { httpFail(res, new Error('session not found'), 404, { ok: false }); return null; }
    const hit = src.site_code ? await rdb().getSiteIdByModuleCode('meetings', src.site_code) : null;
    const siteId = hit && hit.site_id != null ? Number(hit.site_id) : null;
    const u = req.reportUser;
    if (!isAdmin(u)) {
      if (write && !rdb().userHasRole(u, 'editor')) { httpFail(res, new Error('editor role or higher required'), 403, { ok: false }); return null; }
      if (siteId == null || !userSites.hasSite(u, siteId)) { httpFail(res, new Error('session belongs to another site'), 403, { ok: false }); return null; }
    }
    return { src, siteId };
  }
  router.get('/api/governance/rfi/from-meeting/:id', requireReportSession, async (req, res) => {
    try { const x = await incubationSource(req, res); if (!x) return; const r = await store.rfiForMeeting(x.src.id); res.json({ ok: true, is_incubation: x.src.is_incubation, rfi: r || null, lineage: r ? await store.rfiLineage(r.id) : null }); } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/rfi/from-meeting/:id', requireReportSession, async (req, res) => {
    try {
      const x = await incubationSource(req, res, { write: true }); if (!x) return;
      const out = await store.rfiFromMeeting(x.src, { siteId: x.siteId, user: req.reportUser });
      if (out.created) log(req, 'rfi_from_meeting', out.rfi.ref, { meeting_id: x.src.id });
      res.json({ ok: true, created: out.created, rfi: out.rfi, lineage: await store.rfiLineage(out.rfi.id) });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/rfi/:id/lineage', requireReportSession, async (req, res) => {
    try {
      if (!(await incubationRfiOn())) return httpFail(res, new Error('not found'), 404, { ok: false });
      const r = await store.getRfi(req.params.id); if (!r) return httpFail(res, new Error('request not found'), 404, { ok: false });
      const u = req.reportUser;
      if (!isCommittee(u) && Number(r.requester_id) !== Number(u.id) && !(r.site_id != null && userSites.hasSite(u, r.site_id))) return httpFail(res, new Error('request belongs to another site'), 403, { ok: false });
      res.json({ ok: true, lineage: await store.rfiLineage(r.id) });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/rfi/:id', requireReportSession, requireCommittee, json, async (req, res) => { try { const r = await store.triageRfi(req.params.id, req.body || {}, { user: req.reportUser }); log(req, 'rfi_triaged', r && r.ref, { status: r && r.status }); res.json({ ok: true, rfi: r }); } catch (e) { fail(res, e); } });

  // ---- portfolio --------------------------------------------------------------------------
  async function portfolioView() {
    const now = new Date(); const { pf, views } = await objectiveViews(now);
    const gantt = PE.ganttRows(pf.projects, pf.milestones, { now }).map(g => ({ ...g, objective_id: (pf.projects.find(p => p.id === g.id) || {}).objective_id }));
    const risks = pf.risks.map(PE.riskView);
    // G11 — plan per project: WBS tasks, critical path, baseline / forecast / actual; one resource view across projects
    const SCH = require('../services/projectSchedule');
    const tasks = pf.tasks || [];
    const plans = pf.projects.map(p => { const t = tasks.filter(x => x.project_id === p.id); const cp = SCH.criticalPath(t, { anchor: p.start_date || null, deadline: p.finish_deadline || null }); return { project_id: p.id, key: p.key, stage: p.stage || null, tasks: t.length, open_tasks: t.filter(x => !['done', 'cancelled'].includes(x.status)).length, critical_path: cp ? cp.path : null, critical_length_days: cp ? cp.length_days : null, variance: SCH.varianceOf(p) }; });
    return { ...pf, objective_views: views, gantt, risks, plans, resource_conflicts: SCH.resourceConflicts(tasks), resource_coverage: SCH.resourceCoverage(tasks), stages: SCH.STAGES, summary: PE.portfolioSummary({ programmes: pf.programmes, objectiveViews: views, gantt, risks: pf.risks }), as_of: now.toISOString() };
  }
  // G12 — amounts are read by the committee, the admin tier and the finance role; everyone else sees the plan without money.
  const canSeeMoney = (u) => isCommittee(u) || rdb().userHasRole(u, 'finance-viewer');
  function stripMoney(v) {
    const z = (o) => ({ ...o, budget: undefined, spent: undefined, budget_by_currency: undefined });
    return { ...v, projects: v.projects.map(z), gantt: v.gantt.map(z), summary: v.summary.map(z), benefits: (v.benefits || []).map((b) => BEN.visibleBenefit(b, { money: false })), money_hidden: true };
  }
  // A-15 — site scope + editor plan writes, both behind PROPOSED switches (off = today). Rules: services/portfolioAccess.
  const PA = require('../services/portfolioAccess');
  const PLAN_KINDS = ['task', 'milestone', 'risk', 'deliverable', 'benefit'];   // B-08: a benefit follows the plan-write rule
  const BEN = require('../services/portfolioBenefits');
  /** B-08 — a money benefit (value_kind 'money') is written only by someone who may read money. True when it answered. */
  async function refuseMoneyBenefit(req, res, { id = null, body = null } = {}) {
    if (canSeeMoney(req.reportUser)) return false;
    const existing = id ? await store.getBenefit(id) : null;
    if ((body && body.value_kind === 'money') || (existing && existing.value_kind === 'money')) { res.status(403).json({ ok: false, code: 'MONEY_SCOPE', error: 'a benefit expressed in money is maintained by the committee, the admin tier or the finance role' }); return true; }
    return false;
  }
  async function accessCtx(u) {
    const c = await reportConfig.getConfig(rdb().db);
    return { scopeOn: c.portfolio_site_scope_reads === '1', writesOn: c.portfolio_editor_plan_writes === '1', isCommittee: !!isCommittee(u), isAdmin: !!isAdmin(u), isEditor: !!rdb().userHasRole(u, 'editor') };
  }
  /** The portfolio view this user may read (filtered when the read switch is on) and the projects whose plan they may edit. */
  async function viewFor(u) {
    const ctx = await accessCtx(u); const v0 = await portfolioView();
    const v = PA.filterPortfolio(v0, u, ctx);
    const editable = v.projects.filter(p => PA.canEditPlan(u, p, { ...ctx, extraSites: v0.project_sites })).map(p => p.id);
    return { v, ctx, editable };
  }
  router.get('/api/governance/portfolio', requireReportSession, async (req, res) => { try { const { v, editable } = await viewFor(req.reportUser); const ro = PXR.enabled(await reportConfig.getConfig(rdb().db)) && PXR.isExecutiveOnly(req.reportUser);   // UAT-OI-05: the page hides edit controls it would refuse
    res.json({ ok: true, committee: !ro && isCommittee(req.reportUser), can_edit_plan_projects: !ro && editable, ...(ro ? { executive_read_only: true } : {}), ...(canSeeMoney(req.reportUser) ? v : stripMoney(v)) }); } catch (e) { fail(res, e); } });
  const planScope = (res) => res.status(403).json({ ok: false, code: 'PLAN_SCOPE', error: 'you may only maintain the plan of a project of your site(s), or one you own' });
  /**
   * Gate for a plan write (task / milestone / risk / deliverable). Committee → as today. Otherwise the switch must be on
   * and canEditPlan must hold on the row's STORED project (never trust body.project_id on an update) and, for a move,
   * on the target project too. Returns true when it has answered.
   */
  async function refusePlanWrite(req, res, kind, { id = null, body = null } = {}) {
    const u = req.reportUser;
    if (isCommittee(u)) return false;
    const ctx = await accessCtx(u);
    if (!ctx.writesOn) { httpFail(res, new Error('committee-member or admin role required'), 403, { ok: false }); return true; }
    const may = async (pid) => { if (pid == null || !Number.isFinite(Number(pid))) return false; const p = await store.getProject(pid); return !!p && PA.canEditPlan(u, p, { ...ctx, extraSites: await store.projectSites(p.id) }); };
    let target = body && body.project_id != null ? Number(body.project_id) : null;
    if (id) {
      const row = await store.planRow(kind, id);
      if (!row) { res.status(404).json({ ok: false, error: kind + ' not found' }); return true; }
      if (!(await may(row.project_id))) { planScope(res); return true; }
      if (target != null && target !== row.project_id && !(await may(target))) { planScope(res); return true; }
      if (target == null) target = row.project_id;
    } else if (!(await may(target))) { planScope(res); return true; }
    // a link to another element must stay inside the editable project (no reach into another site's plan)
    for (const [k, linkKind] of [['milestone_id', 'milestone'], ['parent_id', 'task']]) {
      if (body && body[k] != null && body[k] !== '') { const l = await store.planRow(linkKind, body[k]); if (!l || l.project_id !== target) { planScope(res); return true; } }
    }
    return false;
  }
  router.put('/api/governance/portfolio/project/:id/sites', requireReportSession, requireCommittee, json, async (req, res) => {
    try { const ids = await store.setProjectSites(req.params.id, (req.body && req.body.site_ids) || [], { user: req.reportUser }); log(req, 'project_sites', `project:${req.params.id}`, { site_ids: ids }); res.json({ ok: true, site_ids: ids }); }
    catch (e) { if (e.status === 404 || e.status === 400) return fail(res, e, e.status, { ok: false }); fail(res, e); }
  });
  router.put('/api/governance/portfolio/:kind', requireReportSession, json, async (req, res, next) => {
    if (PLAN_KINDS.includes(req.params.kind)) return next();
    requireCommittee(req, res, next);
  }, async (req, res) => {
    try {
      const kind = req.params.kind;
      if (PLAN_KINDS.includes(kind) && await refusePlanWrite(req, res, kind, { id: req.body && req.body.id ? Number(req.body.id) : null, body: req.body || {} })) return;
      if (kind === 'benefit' && await refuseMoneyBenefit(req, res, { id: req.body && req.body.id ? Number(req.body.id) : null, body: req.body || {} })) return;
      const cfgW = await reportConfig.getConfig(rdb().db);
      const requireOwnerReason = kind === 'task' && String(cfgW.ppm_capacity_view) === '1';   // E-P03
      if (kind === 'benefit' && req.body && String(cfgW.benefit_owner_link_enabled) !== '1') delete req.body.owner_user_id;   // E-P05: no link while off
      if (kind === 'benefit' && req.body && String(cfgW.benefit_value_class_enabled) !== '1') for (const f of BEN.CLASS_FIELDS) delete req.body[f];   // F-PRODUCT-03: the fields do not exist while off
      const warnings = [];   // F-DATA-10: an amount without a stated currency is a warning (a refusal with finance_currency_required = '1')
      const id = await store.upsertPortfolio(kind, req.body, { user: req.reportUser, reason: req.body && req.body.reason, requireOwnerReason, allocUnspecified: cfgW.ppm_alloc_unspecified, warnings, currencyRequired: String(cfgW.finance_currency_required) === '1' }); log(req, 'portfolio_saved', `${kind}:${id}`); res.json({ ok: true, id, ...(warnings.length ? { warnings } : {}) });
    } catch (e) { httpFail(res, e, undefined, { ok: false, ...(e.reason ? { code: e.reason } : {}) }); }
  });
  router.post('/api/governance/portfolio/project/:id/stage', requireReportSession, requireCommittee, json, async (req, res) => {
    try { const cfg = await reportConfig.getConfig(rdb().db); const p = await store.moveProjectStage(req.params.id, String((req.body && req.body.to) || ''), { user: req.reportUser, note: req.body && req.body.note, captureBaseline: String(cfg.ppm_baseline_versions) === '1' }); log(req, 'project_stage', `project:${req.params.id}`, { to: p.stage }); res.json({ ok: true, project: { ...p, id: Number(p.id) } }); }
    catch (e) { httpFail(res, e, undefined, { ok: false, ...(e.reason ? { code: e.reason } : {}) }); }
  });
  // A-14 — one project for the project page (public/project.html): plan (scheduleView), RAID, and the next stages
  // with the result of a DRY RUN of each gate for this user (never moves the stage). 404 when the A-15 read scope
  // hides it; amounts stripped unless canSeeMoney. Distinct path from /project/:id/{stage,history,sites}.
  router.get('/api/governance/portfolio/project/:id', requireReportSession, async (req, res) => {
    try {
      const u = req.reportUser; const SCH = require('../services/projectSchedule');
      const d = Number.isInteger(Number(req.params.id)) ? await store.projectDetail(req.params.id) : null;
      const ctx = await accessCtx(u); const pctx = { ...ctx, extraSites: d ? d.extra_sites : [] };
      if (!d || !PA.canReadProject(u, d.project, pctx)) return httpFail(res, new Error('project not found'), 404, { ok: false });
      const p = d.project; const from = p.stage || 'proposal'; const money = canSeeMoney(u);
      const allowed_stages = (SCH.GATES[from] || []).map((to) => {
        const needs_reason = to === 'on_hold' || (from === 'closure' && to === 'in_progress');
        // the reason is typed at the moment of the move: the dry run assumes one so the OTHER checks show
        return { to, needs_reason, refusal: SCH.stageGate(p, to, u, { ...d.gate_ctx, note: needs_reason ? 'reason given at the move' : undefined }) };
      });
      const project = money ? p : { ...p, budget: undefined, spent: undefined };
      // F-PRODUCT-03 / F-DATA-09 — class view + totals per class only while the switch is on (never added across classes)
      const clsOn = String((await reportConfig.getConfig(rdb().db)).benefit_value_class_enabled) === '1';
      const mvRole = await moneyVerifierRole();
      // R2-WB-04 — team switch on: a task of unknown allocation reads its owner's member allocation (none = today)
      const members = String((await reportConfig.getConfig(rdb().db)).ppm_project_team_enabled) === '1' ? await wbStore().listMembers(p.id) : [];
      const bens = (d.benefits || []).map((b) => BEN.visibleBenefit(b, { money, asOf: new Date().toISOString(), classes: clsOn }));
      // B4 — "plan updated X days ago": latest of the ledger and the plan rows; null = unknown (never 0)
      const FR = require('../services/ppm/planFreshness');
      const fresh = FR.freshness((await FR.planUpdatedAt(rdb().pgHandle(), [p.id]))[p.id], new Date().toISOString());
      res.json({ ok: true, committee: !!isCommittee(u), can_gate: !!isCommittee(u), can_edit_plan: PA.canEditPlan(u, p, pctx), can_see_history: !!money, money_hidden: !money,
        project, objective: d.objective, extra_sites: d.extra_sites, tasks: d.tasks, milestones: d.milestones, deliverables: d.deliverables, risks: d.risks.map(PE.riskView),
        benefits: bens, ...(clsOn ? { benefit_totals: BEN.benefitTotals(bens), benefit_classes: { value_classes: BEN.VALUE_CLASSES, bases: BEN.BASES, source_kinds: BEN.SOURCE_KINDS } } : {}), me: Number(u.id),
        ...(mvRole ? { money_verifier_role: mvRole, holds_money_verifier_role: holdsExactly(u, mvRole) } : {}),   // F-PRODUCT-04: who may verify a money benefit
        plan: SCH.scheduleView(d.tasks, { anchor: p.start_date || null, deadline: p.finish_deadline || null }), variance: SCH.varianceOf(p), resource_conflicts: SCH.resourceConflicts(d.tasks, members), resource_coverage: SCH.resourceCoverage(d.tasks, members),
        stages: SCH.STAGES, allowed_stages, gate_counts: d.gate_ctx, risk_kinds: store.RISK_KINDS, plan_freshness: fresh, as_of: new Date().toISOString() });
    } catch (e) { fail(res, e); }
  });
  // ---- B-08 benefits: realised value (evidence link) + independent verification (catalogue A09) ------------------
  // Same gate as a plan write (committee; or an editor of the project's site with portfolio_editor_plan_writes on);
  // a money benefit also needs the money-read rule. The verifier must not be the person who entered the value.
  const holdsExactly = (u, role) => !!role && Array.isArray(u && u.roles) && u.roles.includes(role);
  // A1: with finance_certification_enabled = '1' and no explicit role, a MONEY benefit is verified by the finance-verifier.
  async function moneyVerifierRole() { const c = await reportConfig.getConfig(rdb().db); return String(c.benefit_money_verifier_role || '').trim() || (String(c.finance_certification_enabled) === '1' ? 'finance-verifier' : ''); }
  async function moneyVerifier(u, benefitId) {
    const role = await moneyVerifierRole();
    const b = role ? await store.getBenefit(benefitId) : null;
    return { role, applies: !!(role && b && b.value_kind === 'money'), holds: holdsExactly(u, role) };
  }
  const benefitAction = (op) => async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return httpFail(res, new Error('benefit id must be a number'), 400, { ok: false });
      // F-PRODUCT-04 — with benefit_money_verifier_role set, a MONEY benefit is verified by a holder of that role
      // (held exactly; nothing is granted here) — that role, not the plan-write rule, opens the verification.
      const vr = op === 'verify' ? await moneyVerifier(req.reportUser, id) : null;
      if (!(vr && vr.applies && vr.holds) && await refusePlanWrite(req, res, 'benefit', { id })) return;
      if (await refuseMoneyBenefit(req, res, { id })) return;
      const b = op === 'realised' ? await store.recordBenefitRealised(id, req.body || {}, { user: req.reportUser }) : await store.verifyBenefit(id, { user: req.reportUser, requiredRole: vr && vr.applies ? vr.role : '', holdsRole: !!(vr && vr.holds) });
      log(req, op === 'realised' ? 'benefit_realised' : 'benefit_verified', `benefit:${id}`, { project_id: b.project_id });
      res.json({ ok: true, benefit: BEN.visibleBenefit(b, { money: canSeeMoney(req.reportUser), asOf: new Date().toISOString() }) });
    } catch (e) { httpFail(res, e, undefined, { ok: false, ...(e.reason ? { code: e.reason } : {}) }); }
  };
  router.post('/api/governance/portfolio/benefit/:id/realised', requireReportSession, json, benefitAction('realised'));
  router.post('/api/governance/portfolio/benefit/:id/verify', requireReportSession, json, benefitAction('verify'));
  // ---- A-27 baselines, re-baseline gate, deck / workbook, exceptions (PROPOSED switches, all '0' = today) ----------
  const BL = require('../services/ppmBaseline');
  const wbStore = () => require('../services/ppmWorkbenchStore').makeWorkbenchStore(rdb().pgHandle(), store);   // R2-WORKBENCH (migration 085)
  const PX = require('../services/ppmAlerts');
  /** The project if this user may read it (A-15 read scope), else null. */
  async function readableProject(u, id) {
    if (!Number.isInteger(Number(id))) return null;
    const p = await store.getProject(id); if (!p) return null;
    const ctx = await accessCtx(u);
    return PA.canReadProject(u, p, { ...ctx, extraSites: await store.projectSites(p.id) }) ? p : null;
  }
  router.get('/api/governance/portfolio/project/:id/baselines', requireReportSession, async (req, res) => {
    try {
      if (!(await readableProject(req.reportUser, req.params.id))) return httpFail(res, new Error('project not found'), 404, { ok: false });
      const d = await store.projectDetail(req.params.id); const current = BL.snapshotPayload(d.project, d.tasks, d.milestones);
      const cfg = await reportConfig.getConfig(rdb().db);
      const versions = (await store.listBaselines(req.params.id)).map((b) => ({ ...b, diff_vs_current: BL.diffBaselines(b.payload, current) }));
      res.json({ ok: true, versions, current, capture_enabled: String(cfg.ppm_baseline_versions) === '1', rebaseline_enabled: String(cfg.ppm_rebaseline_enabled) === '1', can_rebaseline: !!isCommittee(req.reportUser) && String(cfg.ppm_rebaseline_enabled) === '1' });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/portfolio/project/:id/rebaseline', requireReportSession, json, async (req, res) => {
    try {
      const cfg = await reportConfig.getConfig(rdb().db);
      if (String(cfg.ppm_rebaseline_enabled) !== '1') return httpFail(res, new Error('not found'), 404, { ok: false });   // the action does not exist while the switch is off
      if (!isCommittee(req.reportUser)) return httpFail(res, new Error('committee-member or admin role required'), 403, { ok: false });
      const r = await store.rebaseline(req.params.id, req.body || {}, { user: req.reportUser });
      log(req, 'project_rebaseline', `project:${req.params.id}`, { version: r.version, baseline_end: r.baseline_end });
      res.json({ ok: true, ...r });
    } catch (e) { httpFail(res, e, undefined, { ok: false, ...(e.reason ? { code: e.reason } : {}) }); }
  });
  /** Exceptions (A11) on the portfolio this user may read — the Friday queue. */
  async function exceptionsFor(v) {
    const cfg = await reportConfig.getConfig(rdb().db);
    const num = (x, d) => (Number.isFinite(Number(x)) && String(x).trim() !== '' ? Number(x) : d);
    // B4 — stale-plan rule only with stale_plan_days set ('' = off = today); the update dates come from the ledger + plan rows
    const staleDays = num(cfg.stale_plan_days, null);
    const planUpdated = staleDays != null ? await require('../services/ppm/planFreshness').planUpdatedAt(rdb().pgHandle(), (v.projects || []).map((p) => p.id)) : null;
    return PX.findExceptions(v, { today: new Date().toISOString().slice(0, 10), blockedDays: num(cfg.ppm_alert_blocked_days, 5), slipDays: num(cfg.ppm_alert_slip_days, 10),
      capacity: require('../services/projectSchedule').resourceConflicts(v.tasks || []), staleDays, planUpdated });   // F-PRODUCT-02: same list as the tile and the workbook
  }
  router.get('/api/governance/portfolio/exceptions', requireReportSession, async (req, res) => {
    try { const { v } = await viewFor(req.reportUser); const items = await exceptionsFor(v);
      const cfg = await reportConfig.getConfig(rdb().db);
      res.json({ ok: true, alerts_armed: String(cfg.ppm_alerts_enabled) === '1', thresholds: { blocked_days: Number(cfg.ppm_alert_blocked_days), slip_days: Number(cfg.ppm_alert_slip_days), stale_plan_days: String(cfg.stale_plan_days || '').trim() === '' ? null : Number(cfg.stale_plan_days) }, items, as_of: new Date().toISOString() }); } catch (e) { fail(res, e); }
  });
  /** The deck / workbook data: the readable portfolio, money stripped unless canSeeMoney, + baselines and exceptions. */
  async function exportData(u) {
    const { v: v0 } = await viewFor(u); const money = canSeeMoney(u);
    const v = money ? v0 : stripMoney(v0);
    const ids = new Set(v.projects.map((p) => p.id));
    const baselines = (await store.listBaselines()).filter((b) => ids.has(b.project_id));
    const cx = await reportConfig.getConfig(rdb().db);
    // R2-WB-02 — actual hours per task (sum of the time entries; no entry = unknown) only while the switch is on
    const actualHours = String(cx.ppm_time_entries_enabled) === '1'
      ? require('../services/projectSchedule').actualHours(v.tasks || [], await wbStore().listTimeEntriesForTasks((v.tasks || []).map((t) => t.id))) : null;
    // R2-WB-03 — the budget periods of the readable projects, for a money reader, while ppm_budget_periods_enabled is on
    let budgetPeriods = null;
    if (money && String(cx.ppm_budget_periods_enabled) === '1') { budgetPeriods = []; for (const id of ids) budgetPeriods.push(...await store.listBudgetPeriods(id)); }
    // R2-WB-01 — change requests of the readable projects while ppm_change_requests_enabled is on
    const changeRequests = String(cx.ppm_change_requests_enabled) === '1' ? await wbStore().listChangeRequestsFor([...ids]) : null;
    return { v: { ...v, benefits: (v.benefits || []).filter((b) => ids.has(b.project_id)) }, money, baselines, exceptions: await exceptionsFor(v0),
      benefitClasses: String(cx.benefit_value_class_enabled) === '1', actualHours, budgetPeriods, changeRequests };
  }
  router.get('/api/governance/portfolio/deck.pptx', requireReportSession, async (req, res) => {
    try { const x = await exportData(req.reportUser); const buf = await require('../services/portfolioDeck').buildDeck(x.v, { money: x.money, exceptions: x.exceptions, asOf: x.v.as_of });
      log(req, 'portfolio_deck', 'portfolio', { money: x.money });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'); res.setHeader('Content-Disposition', `attachment; filename="portfolio-${x.v.as_of.slice(0, 10)}.pptx"`); res.send(buf); } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/portfolio/workbook.xlsx', requireReportSession, async (req, res) => {
    try { const x = await exportData(req.reportUser); const buf = require('../services/portfolioDeck').buildWorkbookBuffer(x.v, { money: x.money, baselines: x.baselines, exceptions: x.exceptions, benefitClasses: x.benefitClasses, actualHours: x.actualHours, budgetPeriods: x.budgetPeriods, changeRequests: x.changeRequests });
      log(req, 'portfolio_workbook', 'portfolio', { money: x.money });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="portfolio-${x.v.as_of.slice(0, 10)}.xlsx"`); res.send(buf); } catch (e) { fail(res, e); }
  });
  const historyOf = (entity) => async (req, res) => {
    try {
      if (!canSeeMoney(req.reportUser)) return httpFail(res, new Error('committee, admin or finance-viewer role required'), 403, { ok: false });
      if (entity === 'project') {   // A-15 — with the read switch on, a project of another site does not exist for this reader
        const ctx = await accessCtx(req.reportUser);
        if (ctx.scopeOn && !ctx.isCommittee && !ctx.isAdmin) {
          const p = await store.getProject(req.params.id);
          if (!p || !PA.canReadProject(req.reportUser, p, { ...ctx, extraSites: await store.projectSites(p.id) })) return httpFail(res, new Error('project not found'), 404, { ok: false });
        }
      }
      res.json({ ok: true, events: await store.ppmEvents(entity, req.params.id) });
    } catch (e) { fail(res, e); }
  };
  router.get('/api/governance/portfolio/project/:id/history', requireReportSession, historyOf('project'));
  // an RFI's decision trail is a governance record: committee only (finance-viewer reads project money, not requests)
  router.get('/api/governance/portfolio/rfi/:id/history', requireReportSession, requireCommittee, historyOf('rfi'));
  router.post('/api/governance/rfi/:id/to-project', requireReportSession, requireCommittee, json, async (req, res) => {
    try { const pid = await store.rfiToProject(req.params.id, req.body || {}, { user: req.reportUser }); log(req, 'rfi_to_project', `rfi:${req.params.id}`, { project_id: pid }); res.json({ ok: true, project_id: pid }); }
    catch (e) { httpFail(res, e, undefined, { ok: false, ...(e.project_id ? { project_id: e.project_id } : {}) }); }
  });
  router.delete('/api/governance/portfolio/:kind/:id', requireReportSession, json, (req, res, next) => (PLAN_KINDS.includes(req.params.kind) ? next() : requireCommittee(req, res, next)), async (req, res) => { try { if (PLAN_KINDS.includes(req.params.kind) && await refusePlanWrite(req, res, req.params.kind, { id: Number(req.params.id) })) return; const soft = await _softDelete(req, res, req.params.kind, req.params.id); if (!soft) return; await store.removePortfolio(req.params.kind, req.params.id, { user: req.reportUser, ...soft }); await _confirmed(req, soft); log(req, soft.soft ? 'portfolio_soft_deleted' : 'portfolio_removed', `${req.params.kind}:${req.params.id}`); res.json({ ok: true, soft: !!soft.soft }); } catch (e) { fail(res, e); } });
  router.get('/api/governance/portfolio/report.html', requireReportSession, async (req, res) => {
    try { const v0 = (await viewFor(req.reportUser)).v; const v = canSeeMoney(req.reportUser) ? v0 : stripMoney(v0); const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const month = new Date().toISOString().slice(0, 7);
      const amt = (n) => (n == null ? '—' : String(Math.round(n)));   // E-NULL-3: an unknown amount is "—", never 0
      const rows = v.summary.map(s => `<tr><td>${esc(s.name)}</td><td>${s.objectives}</td><td>${s.auto_evidence_pct == null ? '—' : s.auto_evidence_pct + ' %'}</td><td>${s.weighted_evidence_pct == null ? '—' : s.weighted_evidence_pct + ' %'}</td><td>${s.projects}</td><td>${s.late_projects}</td><td>${s.high_risks}</td><td>${v.money_hidden ? '<small>restricted</small>' : s.currency_mixed ? Object.entries(s.budget_by_currency).map(([c, b]) => amt(b.spent) + ' / ' + amt(b.budget) + ' ' + esc(c)).join('<br>') : s.budget != null ? amt(s.spent) + ' / ' + amt(s.budget) + ' ' + esc(s.currency || '') : '—'}</td></tr>`).join('');
      const objs = v.objective_views.map(o => `<tr><td>${esc(o.name)}</td><td>${esc(o.status)}</td><td>${esc(o.confidence)}</td><td>${o.evidence_pct == null ? '—' : o.evidence_pct + ' %'} <small>(${esc(o.evidence_source)}${o.metric ? ' · ' + esc(o.metric.key) + ' @ ' + esc(o.metric.window || '') : ''})</small></td><td>${o.slip_days == null ? '—' : o.slip_days + ' d'}</td></tr>`).join('');
      const late = v.gantt.filter(g => g.alerts.length).map(g => `<li><b>${esc(g.key)}</b> ${esc(g.name)} — ${esc(g.alerts.join('; '))}</li>`).join('');
      const risks = v.risks.filter(r => r.status === 'open' && r.severity !== 'low').map(r => `<li>${esc(r.title)} — exposure ${r.exposure}${r.incident_ref ? ' · incident ' + esc(r.incident_ref) : ''}</li>`).join('');
      res.type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Portfolio report ${month}</title><style>body{font-family:Calibri,Arial,sans-serif;color:#1F2A33;max-width:960px;margin:0 auto;padding:16px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e4e8ee;padding:4px 8px;font-size:13px;text-align:left}th{background:#f4f6f7}h2{font-size:16px;color:#3A4A60}</style></head><body><h1 style="font-size:20px;color:#3A4A60">Portfolio report — ${month}</h1><p style="color:#6b7785;font-size:12px">As of ${esc(v.as_of.slice(0, 16).replace('T', ' '))}. Evidence “metric” = read from the KPI dictionary; “—” = not measured.</p>
<h2>Programmes</h2><table><tr><th>Programme</th><th>Objectives</th><th>Auto evidence</th><th>Weighted evidence</th><th>Projects</th><th>Late</th><th>High risks</th><th>Spent / budget</th></tr>${rows || '<tr><td colspan="8">No programme.</td></tr>'}</table>
<h2>Objectives</h2><table><tr><th>Objective</th><th>Status</th><th>Confidence</th><th>Evidence</th><th>Slip</th></tr>${objs || '<tr><td colspan="5">None.</td></tr>'}</table>
<h2>Schedule alerts</h2>${late ? '<ul>' + late + '</ul>' : '<p>None.</p>'}<h2>Open risks (medium / high)</h2>${risks ? '<ul>' + risks + '</ul>' : '<p>None.</p>'}</body></html>`); } catch (e) { fail(res, e); }
  });

  // ---- Roadmap Manager migration -----------------------------------------------------------
  router.post('/api/governance/roadmap-migration', requireReportSession, json, async (req, res) => {
    try {
      if (!isSuper(req.reportUser)) return httpFail(res, new Error('super_admin required'), 403, { ok: false });
      const apply = req.query.apply === '1'; const uid = Number(req.body && req.body.user_id) || req.reportUser.id;
      const rm = await rdb().getRoadmap(uid); const pf = await store.portfolio();
      const KEY = 'itsm-roadmap'; const EVID = { catalogue: 'helpdesk.closure_pct', platform: 'assets.completeness_pct', incidents: 'helpdesk.resolution_sla_pct', knowledge: null };
      let plan = { programme: { key: KEY, name: 'ITSM roadmap (migrated from Roadmap Manager)', sponsor: 'Service & Support Manager' }, exists: pf.programmes.some(p => p.key === KEY),
        objectives: (rm.objectives || []).map(o => ({ key: `${KEY}-${o.obj_key}`, name: o.title || o.name || o.obj_key, weight: Number(o.weight) || 1, progress_pct: o.progress_pct != null ? Number(o.progress_pct) : null, status: /red|rouge/i.test(o.status || '') ? 'at_risk' : /orange|amber/i.test(o.status || '') ? 'at_risk' : 'on_track', confidence: /low|faible/i.test(o.confidence || '') ? 'low' : /high|élevée|elevee/i.test(o.confidence || '') ? 'high' : 'medium', target_date: o.target_date || null, evidence_metric: EVID[o.obj_key] || null, evidence_target: EVID[o.obj_key] ? 90 : null, manual_evidence: o.evidence || null,
          deliverables: (rm.deliverables || []).filter(d => d.obj_key === o.obj_key).map(d => ({ name: d.label || d.title || d.name, due_date: d.delivery_date || d.due_date || d.target_date || null, status: /exec|done|fait/i.test(d.status || '') ? 'done' : /cours|progress/i.test(d.status || '') ? 'in_progress' : 'todo' })) })) };
      // R2-WB-06 — controlled publication (roadmap_publication_enabled; '0' = this route exactly as before): duplicates
      // are reported on the dry run and refused at apply unless ?skip_duplicates=1; the apply is a recorded ppm_events row
      const PUB = require('./governanceWorkbench').roadmapPublication; const pub = await PUB.enabled(rdb, reportConfig);
      const dups = pub ? await PUB.duplicates(rdb, plan) : null;
      if (!apply) return res.json({ ok: true, dry_run: true, plan, ...(dups ? { duplicates: dups } : {}) });
      if (plan.exists) return httpFail(res, new Error('programme already migrated (delete it to redo)'), 409, { ok: false, plan });
      if (dups && dups.count) { if (req.query.skip_duplicates !== '1') return httpFail(res, new Error('duplicates found: review them, then apply with skip_duplicates=1 to leave them out'), 409, { ok: false, code: 'DUPLICATES', duplicates: dups, plan }); plan = PUB.withoutDuplicates(plan, dups); }
      const pid = await store.upsertPortfolio('programme', plan.programme);
      for (const [i, o] of plan.objectives.entries()) {
        const oid = await store.upsertPortfolio('objective', { programme_id: pid, key: o.key, name: o.name, weight: o.weight, progress_pct: o.progress_pct, status: o.status, confidence: o.confidence, target_date: o.target_date, evidence_metric: o.evidence_metric, evidence_target: o.evidence_target, evidence_hib: 1, manual_evidence: o.manual_evidence, sort_order: i });
        const prj = await store.upsertPortfolio('project', { objective_id: oid, key: `${o.key}-deliverables`, name: `${o.name} — deliverables`, status: 'active', progress_pct: o.progress_pct, confidence: o.confidence, end_date: o.target_date });
        for (const [j, d] of o.deliverables.entries()) await store.upsertPortfolio('deliverable', { project_id: prj, name: d.name, due_date: d.due_date, status: d.status, sort_order: j, closed_at: d.status === 'done' ? new Date().toISOString() : null });
      }
      log(req, 'roadmap_migrated', KEY, { objectives: plan.objectives.length });
      if (pub) await store.ppmEvent({ entity: 'programme', entity_id: pid, action: 'roadmap_migrated', field: 'key', old_value: null, new_value: KEY, note: `${plan.objectives.length} objective(s)${dups && dups.count ? `, ${dups.count} duplicate(s) left out` : ''}` }, req.reportUser);
      res.json({ ok: true, dry_run: false, programme_id: pid, plan });
    } catch (e) { fail(res, e); }
  });
  // Plan E wave 2 (W2-PPM): capacity, budget periods, RACI, templates, annual pack — same helpers, switch-gated
  // ---- F-PRODUCT-05 — department crosswalk (migration 082): list-only admin view + roll-up behind a switch ------------
  const DX = require('../services/departmentCrosswalk');
  const dxStore = () => { let meetings = null; try { meetings = require('../meetings-db').getDB(); } catch (_) { meetings = null; } return require('../services/departmentCrosswalkStore').makeDepartmentCrosswalkStore({ reports: rdb().pgHandle(), meetings }); };
  const rollupOn = async () => String((await reportConfig.getConfig(rdb().db)).department_rollup_enabled) === '1';
  // list-only: the pairs are PROPOSED; approving or adding one is a decision for people, there is no write route
  router.get('/api/governance/department-crosswalk', requireReportSession, async (req, res) => {
    try {
      if (!isAdmin(req.reportUser)) return httpFail(res, new Error('admin only'), 403, { ok: false });
      const S = dxStore(); const [rows, mdNames, data] = [await S.listCrosswalk(), await S.mdNames(), await S.collectValues()];
      const c = DX.check(data.values, DX.makeIndex(rows, { mdNames }));
      res.json({ ok: true, read_only: true, rollup_enabled: await rollupOn(), rows: rows.map((r) => ({ ...r, md_name: r.md_code ? (mdNames[r.md_code] || null) : null })),
        data: { total: c.total, mapped: c.mapped, not_set: c.not_set, unmapped_total: c.unmapped_total, unmapped: c.unmapped, not_measured: data.not_measured } });
    } catch (e) { fail(res, e); }
  });
  // counts per crosswalked department across commitments, handoffs, report actions and PV issues (committee, fleet-wide);
  // a value without a pair stays under "unmapped", listed as stored
  router.get('/api/governance/department-rollup', requireReportSession, async (req, res) => {
    try {
      if (!(await rollupOn())) return httpFail(res, new Error('not found'), 404, { ok: false });
      if (!isCommittee(req.reportUser)) return httpFail(res, new Error('committee only'), 403, { ok: false });
      const S = dxStore(); const [rows, mdNames, data] = [await S.listCrosswalk(), await S.mdNames(), await S.collectValues()];
      res.json({ ok: true, proposed: rows.some((r) => r.status === 'proposed'), sources: S.SOURCES, not_measured: data.not_measured, ...DX.rollup(data.values, DX.makeIndex(rows, { mdNames })) });
    } catch (e) { fail(res, e); }
  });
  require('./governancePpm')(router, { store, rdb, reportConfig, requireReportSession, json, isCommittee, canSeeMoney, viewFor, readableProject, refusePlanWrite, log });
  return router;
};
module.exports.createStore = createStore;
