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
//   POST /api/governance/sessions/:id/decisions       DEC-YYYY-NNN                                  chair | secretary | admin
//   POST /api/governance/sessions/:id/actions         action linked to its source                   runner
//   GET  /api/governance/sessions/:id/minutes.html|.pdf · POST /sessions/:id/minutes/send
//   GET  /api/governance/decisions  · PUT /decisions/:id
//   GET  /api/governance/rfi · POST /rfi (any session) · PUT /rfi/:id (triage/score/decide — committee) · POST /rfi/:id/verify (requester)
//   GET  /api/governance/portfolio (tree + evidence + gantt + risks + summary) · PUT /portfolio/:kind · DELETE /portfolio/:kind/:id   committee
//   GET  /api/governance/portfolio/report.html        monthly portfolio report
//   POST /api/governance/roadmap-migration?apply=1    Roadmap Manager → portfolio (dry run by default)   super_admin
//
// Committee = admin tier OR feature role `committee-member`. Runner of a session = committee, or the
// cadence's chair/secretary, or an editor of the cadence's site (services/userSites).

const { buildAgenda, metricKeysFor } = require('../services/agendaBuilder');
const { renderMinutes, acceptanceStamp } = require('../services/minutesRenderer');
const PE = require('../services/portfolioEvidence');

function createStore(rdbMod, { log = console.log } = {}) {
  const pg = rdbMod.REPORTS_BACKEND === 'postgres';
  const st = require('../services/governanceStore').makeGovernanceStore(({ prepare: (sql) => rdbMod.pgHandle().prepare(sql) }), { isPg: pg });
  
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
  const requireCommittee = (req, res, next) => isCommittee(req.reportUser) ? next() : res.status(403).json({ ok: false, error: 'committee-member or admin role required' });
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false });
  const log = (req, action, target, details) => { try { rdb().logEvent({ category: 'governance', action, target: String(target), details, ...rdb()._logCtx(req) }); } catch (_) {} };
  // ADR-006 — role holders and deputies, from a snapshot refreshed before every governance request
  // (empty tables = the behaviour until now). deputyFor(u) = people u stands in for today.
  let roles = null, rolesVersion = -1;
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
    const s = await store.getSession(req.params.id); if (!s) { res.status(404).json({ ok: false, error: 'session not found' }); return null; }
    const cad = await store.getCadence(s.cadence_id);
    const u = req.reportUser;
    if (!isCommittee(u) && cad && cad.site_id != null && !userSites.hasSite(u, cad.site_id) && !canRun(u, cad)) { res.status(403).json({ ok: false, error: 'session belongs to another site' }); return null; }
    if (!seesCadence(u, cad)) { res.status(403).json({ ok: false, error: 'group sessions are read by the committee and their participants' }); return null; }
    if (run && !canRun(u, cad)) { res.status(403).json({ ok: false, error: 'only the chair, the secretary, the site editors or the committee may run this session' }); return null; }
    if (decide && !canDecide(u, cad)) { res.status(403).json({ ok: false, error: 'only the chair, the secretary or an admin may record a decision' }); return null; }
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
    const out = [];
    for (const t of await ts.list({ status: 'published' })) {
      try { const r = await ts.scoreTracker(t.key); if (!r) continue; const unitCode = site ? (require('../tracker-db').siteToCode(site)) : null; const u = unitCode && r.units[unitCode]; out.push({ key: t.key, name: t.name, score: u ? u.score : r.fleet.mean, rag: u ? u.rag : (r.fleet.mean == null ? 'NA' : require('../services/kpiRag').rag(r.fleet.mean, 'tracker-executive')) }); } catch (_) {}
    }
    return out;
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
    const decisions = (await store.listDecisions({ status: ['open', 'in_progress'], siteIds: site ? [Number(site.id)] : null })).slice(0, 15);
    const rfis = isCommitteeKind(cad.kind) ? (await store.listRfi({ status: ['submitted', 'triaged'] })).slice(0, 10) : [];
    const trackers = await trackerFacts(site);
    const portfolio = isCommitteeKind(cad.kind) || cad.kind === 'group_monthly' ? { objectives: (await objectiveViews(now)).views } : { objectives: [] };
    return buildAgenda({ cadence: cad, scheduledAt, metrics, actions: facts.actions, incidents: facts.incidents, decisions, rfis, trackers, portfolio, now, nextSession: null });
  }
  const isCommitteeKind = (k) => k === 'committee' || k === 'group_monthly';

  // ---- overview ---------------------------------------------------------------------------
  router.get('/api/governance/overview', requireReportSession, async (req, res) => {
    try {
      const ids = await scopeIds(req.reportUser);
      const [cad, dec, rfi, sess] = [await store.listCadences({ siteIds: ids }), await store.listDecisions({ status: ['open', 'in_progress'], siteIds: ids }), await store.listRfi({ status: ['submitted', 'triaged', 'accepted', 'scheduled'], scope: rfiScope(req.reportUser) }), await store.listSessions({ limit: 200 })];
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

  // ---- cadences ---------------------------------------------------------------------------
  // Chair / secretary picker for the cadence form (committee field review): names, never typed ids.
  router.get('/api/governance/people', requireReportSession, async (req, res) => {
    try {
      if (!isCommittee(req.reportUser)) return res.status(403).json({ ok: false, error: 'committee only' });
      const site = req.query.site == null || req.query.site === '' ? null : Number(req.query.site);
      const people = ((await rdb().listUsers()) || []).filter((x) => x.active !== 0 && x.active !== false && (site == null || [x.site_id, ...(x.extra_site_ids || [])].filter((v) => v != null).map(Number).includes(site)))
        .map((x) => ({ id: Number(x.id), name: x.full_name || x.username })).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
      res.json({ ok: true, people });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/cadences', requireReportSession, async (req, res) => { try { const ids = await scopeIds(req.reportUser); const sites = ((await rdb().listSites({ includeInactive: false })) || []).filter(s => !ids || ids.includes(Number(s.id))).map(s => ({ id: s.id, name: s.name })); res.json({ ok: true, committee: isCommittee(req.reportUser), sites, cadences: (await store.listCadences({ siteIds: ids, includeInactive: isCommittee(req.reportUser) })).filter(c => seesCadence(req.reportUser, c)) }); } catch (e) { fail(res, e); } });
  router.put('/api/governance/cadences', requireReportSession, requireCommittee, json, async (req, res) => { try { const c = await store.saveCadence(req.body, { user: req.reportUser }); log(req, 'cadence_saved', c.key); res.json({ ok: true, cadence: c }); } catch (e) { fail(res, e); } });
  router.delete('/api/governance/cadences/:id', requireReportSession, requireCommittee, async (req, res) => { try { await store.removeCadence(req.params.id); log(req, 'cadence_removed', req.params.id); res.json({ ok: true }); } catch (e) { fail(res, e); } });
  router.post('/api/governance/cadences/:id/sessions', requireReportSession, json, async (req, res) => {
    try {
      const cad = await store.getCadence(req.params.id); if (!cad) return res.status(404).json({ ok: false, error: 'cadence not found' });
      if (!canRun(req.reportUser, cad)) return res.status(403).json({ ok: false, error: 'not allowed to prepare this cadence' });
      const when = (req.body && req.body.scheduled_at) || new Date().toISOString();
      if (!cad.active) return res.status(409).json({ ok: false, error: 'the cadence is inactive' });
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
    try { const x = await loadSession(req, res); if (!x) return; res.json({ ok: true, session: (await withStage(x.s, req.reportUser, x.cad)), minutes_history: await store.minutesHistory(x.s.id), cadence: x.cad, decisions: await store.listDecisions({ sessionId: x.s.id }), actions: await store.sessionActions(x.s.id), can_run: canRun(req.reportUser, x.cad), can_decide: canDecide(req.reportUser, x.cad) }); } catch (e) { fail(res, e); }
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
      if (op !== 'start' && op !== 'end') return res.status(400).json({ ok: false, error: 'op must be start | end | notes' });
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
      if (!n) return res.status(404).json({ ok: false, error: 'action not found in this session' });
      log(req, 'session_action_status', req.params.aid, { session: x.s.id, status: req.body && req.body.status }); res.json({ ok: true, actions: await store.sessionActions(x.s.id) }); } catch (e) { fail(res, e); }
  });
  async function minutesFor(x) {
    const sites = (await rdb().listSites({ includeInactive: true })) || []; const site = x.cad && x.cad.site_id != null ? sites.find(s => Number(s.id) === Number(x.cad.site_id)) : null;
    const cfg = await reportConfig.getConfig(rdb().db);
    return renderMinutes({ cadence: x.cad, session: x.s, decisions: await store.listDecisions({ sessionId: x.s.id }), actions: await store.sessionActions(x.s.id), siteName: site ? site.name : null, baseUrl: cfg.public_base_url || '' });
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
      const to = (x.cad && x.cad.participants || []).filter(p => /@/.test(String(p))); if (!to.length) return res.status(400).json({ ok: false, error: 'the cadence has no participant e-mail address (edit the cadence)' });
      const html = x.s.minutes_html || await minutesFor(x); const cfg = await reportConfig.getConfig(rdb().db);
      const pdf = await (deps.renderPdf || require('../services/reportRender').renderPdf)(html, { stamp: `minutes-${x.s.id}` });
      const sent = await (deps.buildMailer || require('../services/mailer').buildMailer)(cfg).send({ to, subject: `Minutes — ${x.cad.name} — ${String(x.s.started_at || x.s.scheduled_at).slice(0, 10)}`, html, attachments: pdf.ok ? [{ filename: `minutes-${x.s.id}.pdf`, content: pdf.pdf }] : [] });
      if (sent.ok) await store.updateSession(x.s.id, { minutes_sent_at: new Date().toISOString() });
      log(req, sent.ok ? 'minutes_sent' : 'minutes_send_failed', x.s.id, { to: to.length, pdf: pdf.ok }); res.json({ ok: !!sent.ok, error: sent.error, to: to.length, pdf: pdf.ok }); } catch (e) { fail(res, e); }
  });

  // ---- decisions / RFI --------------------------------------------------------------------
  router.get('/api/governance/decisions', requireReportSession, async (req, res) => {
    try {
      let rows = await store.listDecisions({ status: req.query.status ? String(req.query.status).split(',') : null, siteIds: await scopeIds(req.reportUser) });
      // meetings.group_decisions_public = false: decisions of group sessions follow the session's own visibility
      if (!isCommittee(req.reportUser) && (await GP.forContext({}))['meetings.group_decisions_public'] === false) {
        const cads = new Map((await store.listCadences({ includeInactive: true })).map((c) => [c.id, c])); const sessCad = new Map();
        const keep = [];
        for (const d of rows) {
          if (d.site_id != null) { keep.push(d); continue; }
          if (d.session_id == null) continue;
          if (!sessCad.has(d.session_id)) { const s = await store.getSession(d.session_id); sessCad.set(d.session_id, s ? cads.get(s.cadence_id) : null); }
          const c = sessCad.get(d.session_id); if (c && seesCadence(req.reportUser, c)) keep.push(d);
        }
        rows = keep;
      }
      res.json({ ok: true, decisions: rows });
    } catch (e) { fail(res, e); }
  });
  // UAT (PMO F8): the site follows its decisions between meetings — the chair / secretary of the session's
  // cadence or an editor of the decision's site may move its STATUS; the content stays a committee edit.
  router.put('/api/governance/decisions/:id', requireReportSession, json, async (req, res) => {
    try {
      const b = req.body || {}; const u = req.reportUser;
      if (!isCommittee(u)) {
        const keys = Object.keys(b).filter((k) => b[k] !== undefined);
        if (keys.some((k) => k !== 'status')) return res.status(403).json({ ok: false, error: 'only the committee edits a decision; the site may update its status' });
        const dec = await store.getDecision(req.params.id); if (!dec) return res.status(404).json({ ok: false, error: 'decision not found' });
        let allowed = false;
        if (dec.session_id != null) { const sess = await store.getSession(dec.session_id); const cad = sess && await store.getCadence(sess.cadence_id); allowed = !!(cad && canRun(u, cad)); }
        if (!allowed && dec.site_id != null) allowed = rdb().userHasRole(u, 'editor') && userSites.hasSite(u, Number(dec.site_id));
        if (!allowed) return res.status(403).json({ ok: false, error: 'not allowed to update this decision' });
      }
      const d = await store.updateDecision(req.params.id, b); if (!d) return res.status(404).json({ ok: false, error: 'decision not found' });
      log(req, 'decision_updated', d.ref, { status: b.status || null }); res.json({ ok: true, decision: d });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/rfi', requireReportSession, async (req, res) => { try { res.json({ ok: true, committee: isCommittee(req.reportUser), me: Number(req.reportUser.id), rfi: await store.listRfi({ status: req.query.status ? String(req.query.status).split(',') : null, scope: rfiScope(req.reportUser) }), kinds: store.RFI_KINDS, statuses: store.RFI_STATUSES }); } catch (e) { fail(res, e); } });
  router.post('/api/governance/rfi', requireReportSession, json, async (req, res) => { try { const r = await store.submitRfi({ ...req.body, site_id: req.body && req.body.site_id != null ? req.body.site_id : (userSites.siteIds(req.reportUser)[0] || null) }, { user: req.reportUser }); log(req, 'rfi_submitted', r.ref, { kind: r.kind }); res.json({ ok: true, rfi: r }); } catch (e) { fail(res, e); } });
  router.post('/api/governance/rfi/:id/verify', requireReportSession, async (req, res) => { try { const r = await store.verifyRfi(req.params.id, { user: req.reportUser }); log(req, 'rfi_verified', r.ref); res.json({ ok: true, rfi: r }); } catch (e) { const known = { 403: 'only the requester confirms the delivery', 404: 'request not found', 409: 'only a delivered request can be confirmed' }; if (known[e.status]) return res.status(e.status).json({ ok: false, code: e.code, error: known[e.status] }); fail(res, e); } });
  router.put('/api/governance/rfi/:id', requireReportSession, requireCommittee, json, async (req, res) => { try { const r = await store.triageRfi(req.params.id, req.body || {}, { user: req.reportUser }); log(req, 'rfi_triaged', r && r.ref, { status: r && r.status }); res.json({ ok: true, rfi: r }); } catch (e) { fail(res, e); } });

  // ---- portfolio --------------------------------------------------------------------------
  async function portfolioView() {
    const now = new Date(); const { pf, views } = await objectiveViews(now);
    const gantt = PE.ganttRows(pf.projects, pf.milestones, { now }).map(g => ({ ...g, objective_id: (pf.projects.find(p => p.id === g.id) || {}).objective_id }));
    const risks = pf.risks.map(PE.riskView);
    // G11 — plan per project: WBS tasks, critical path, baseline / forecast / actual; one resource view across projects
    const SCH = require('../services/projectSchedule');
    const tasks = pf.tasks || [];
    const plans = pf.projects.map(p => { const t = tasks.filter(x => x.project_id === p.id); const cp = SCH.criticalPath(t); return { project_id: p.id, key: p.key, stage: p.stage || null, tasks: t.length, open_tasks: t.filter(x => !['done', 'cancelled'].includes(x.status)).length, critical_path: cp ? cp.path : null, critical_length_days: cp ? cp.length_days : null, variance: SCH.varianceOf(p) }; });
    return { ...pf, objective_views: views, gantt, risks, plans, resource_conflicts: SCH.resourceConflicts(tasks), stages: SCH.STAGES, summary: PE.portfolioSummary({ programmes: pf.programmes, objectiveViews: views, gantt, risks: pf.risks }), as_of: now.toISOString() };
  }
  // G12 — amounts are read by the committee, the admin tier and the finance role; everyone else sees the plan without money.
  const canSeeMoney = (u) => isCommittee(u) || rdb().userHasRole(u, 'finance-viewer');
  function stripMoney(v) {
    const z = (o) => ({ ...o, budget: undefined, spent: undefined, budget_by_currency: undefined });
    return { ...v, projects: v.projects.map(z), gantt: v.gantt.map(z), summary: v.summary.map(z), money_hidden: true };
  }
  router.get('/api/governance/portfolio', requireReportSession, async (req, res) => { try { const v = await portfolioView(); res.json({ ok: true, committee: isCommittee(req.reportUser), ...(canSeeMoney(req.reportUser) ? v : stripMoney(v)) }); } catch (e) { fail(res, e); } });
  router.put('/api/governance/portfolio/:kind', requireReportSession, requireCommittee, json, async (req, res) => { try { const id = await store.upsertPortfolio(req.params.kind, req.body, { user: req.reportUser, reason: req.body && req.body.reason }); log(req, 'portfolio_saved', `${req.params.kind}:${id}`); res.json({ ok: true, id }); } catch (e) { httpFail(res, e, undefined, { ok: false, ...(e.reason ? { code: e.reason } : {}) }); } });
  router.post('/api/governance/portfolio/project/:id/stage', requireReportSession, requireCommittee, json, async (req, res) => {
    try { const p = await store.moveProjectStage(req.params.id, String((req.body && req.body.to) || ''), { user: req.reportUser, note: req.body && req.body.note }); log(req, 'project_stage', `project:${req.params.id}`, { to: p.stage }); res.json({ ok: true, project: { ...p, id: Number(p.id) } }); }
    catch (e) { httpFail(res, e, undefined, { ok: false, ...(e.reason ? { code: e.reason } : {}) }); }
  });
  const historyOf = (entity) => async (req, res) => {
    try { if (!canSeeMoney(req.reportUser)) return res.status(403).json({ ok: false, error: 'committee, admin or finance-viewer role required' }); res.json({ ok: true, events: await store.ppmEvents(entity, req.params.id) }); } catch (e) { fail(res, e); }
  };
  router.get('/api/governance/portfolio/project/:id/history', requireReportSession, historyOf('project'));
  router.get('/api/governance/portfolio/rfi/:id/history', requireReportSession, historyOf('rfi'));
  router.post('/api/governance/rfi/:id/to-project', requireReportSession, requireCommittee, json, async (req, res) => {
    try { const pid = await store.rfiToProject(req.params.id, req.body || {}, { user: req.reportUser }); log(req, 'rfi_to_project', `rfi:${req.params.id}`, { project_id: pid }); res.json({ ok: true, project_id: pid }); }
    catch (e) { httpFail(res, e, undefined, { ok: false, ...(e.project_id ? { project_id: e.project_id } : {}) }); }
  });
  router.delete('/api/governance/portfolio/:kind/:id', requireReportSession, requireCommittee, async (req, res) => { try { await store.removePortfolio(req.params.kind, req.params.id); log(req, 'portfolio_removed', `${req.params.kind}:${req.params.id}`); res.json({ ok: true }); } catch (e) { fail(res, e); } });
  router.get('/api/governance/portfolio/report.html', requireReportSession, async (req, res) => {
    try { const v0 = await portfolioView(); const v = canSeeMoney(req.reportUser) ? v0 : stripMoney(v0); const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const month = new Date().toISOString().slice(0, 7);
      const rows = v.summary.map(s => `<tr><td>${esc(s.name)}</td><td>${s.objectives}</td><td>${s.auto_evidence_pct == null ? '—' : s.auto_evidence_pct + ' %'}</td><td>${s.weighted_evidence_pct == null ? '—' : s.weighted_evidence_pct + ' %'}</td><td>${s.projects}</td><td>${s.late_projects}</td><td>${s.high_risks}</td><td>${v.money_hidden ? '<small>restricted</small>' : s.currency_mixed ? Object.entries(s.budget_by_currency).map(([c, b]) => Math.round(b.spent) + ' / ' + Math.round(b.budget) + ' ' + esc(c)).join('<br>') : s.budget != null ? Math.round(s.spent) + ' / ' + Math.round(s.budget) + ' ' + esc(s.currency || '') : '—'}</td></tr>`).join('');
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
      if (!isSuper(req.reportUser)) return res.status(403).json({ ok: false, error: 'super_admin required' });
      const apply = req.query.apply === '1'; const uid = Number(req.body && req.body.user_id) || req.reportUser.id;
      const rm = await rdb().getRoadmap(uid); const pf = await store.portfolio();
      const KEY = 'itsm-roadmap'; const EVID = { catalogue: 'helpdesk.closure_pct', platform: 'assets.completeness_pct', incidents: 'helpdesk.resolution_sla_pct', knowledge: null };
      const plan = { programme: { key: KEY, name: 'ITSM roadmap (migrated from Roadmap Manager)', sponsor: 'Service & Support Manager' }, exists: pf.programmes.some(p => p.key === KEY),
        objectives: (rm.objectives || []).map(o => ({ key: `${KEY}-${o.obj_key}`, name: o.title || o.name || o.obj_key, weight: Number(o.weight) || 1, progress_pct: o.progress_pct != null ? Number(o.progress_pct) : null, status: /red|rouge/i.test(o.status || '') ? 'at_risk' : /orange|amber/i.test(o.status || '') ? 'at_risk' : 'on_track', confidence: /low|faible/i.test(o.confidence || '') ? 'low' : /high|élevée|elevee/i.test(o.confidence || '') ? 'high' : 'medium', target_date: o.target_date || null, evidence_metric: EVID[o.obj_key] || null, evidence_target: EVID[o.obj_key] ? 90 : null, manual_evidence: o.evidence || null,
          deliverables: (rm.deliverables || []).filter(d => d.obj_key === o.obj_key).map(d => ({ name: d.label || d.title || d.name, due_date: d.delivery_date || d.due_date || d.target_date || null, status: /exec|done|fait/i.test(d.status || '') ? 'done' : /cours|progress/i.test(d.status || '') ? 'in_progress' : 'todo' })) })) };
      if (!apply) return res.json({ ok: true, dry_run: true, plan });
      if (plan.exists) return res.status(409).json({ ok: false, error: 'programme already migrated (delete it to redo)', plan });
      const pid = await store.upsertPortfolio('programme', plan.programme);
      for (const [i, o] of plan.objectives.entries()) {
        const oid = await store.upsertPortfolio('objective', { programme_id: pid, key: o.key, name: o.name, weight: o.weight, progress_pct: o.progress_pct, status: o.status, confidence: o.confidence, target_date: o.target_date, evidence_metric: o.evidence_metric, evidence_target: o.evidence_target, evidence_hib: 1, manual_evidence: o.manual_evidence, sort_order: i });
        const prj = await store.upsertPortfolio('project', { objective_id: oid, key: `${o.key}-deliverables`, name: `${o.name} — deliverables`, status: 'active', progress_pct: o.progress_pct, confidence: o.confidence, end_date: o.target_date });
        for (const [j, d] of o.deliverables.entries()) await store.upsertPortfolio('deliverable', { project_id: prj, name: d.name, due_date: d.due_date, status: d.status, sort_order: j, closed_at: d.status === 'done' ? new Date().toISOString() : null });
      }
      log(req, 'roadmap_migrated', KEY, { objectives: plan.objectives.length });
      res.json({ ok: true, dry_run: false, programme_id: pid, plan });
    } catch (e) { fail(res, e); }
  });
  return router;
};
module.exports.createStore = createStore;
