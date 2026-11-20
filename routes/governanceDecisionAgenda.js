'use strict';
// PORTFOLIO LOT 4 (IT portfolio reconstruction spec §14, §22, §31.9) — decision agenda + actionable management alerts,
// registered on the governance router (routes/governance.js passes its own helpers, so the read rules are the SAME
// functions: viewFor = A-15 site scope / B3 sensitive / W4 project roles; visibleDecisions = the decision register's
// visibility; canSeeMoney = the amount rule). ADR: docs/ai-decisions/ADR-PORTFOLIO-LOT4-decision-agenda-alerts.md
//
// Decision agenda — 404 while report_config ppm_decision_agenda_enabled = '0' (PROPOSED, default = today):
//   GET  /api/governance/portfolio/decision-agenda              projects with decision required yes / tbc + their
//                                                              linked decisions (existing DEC register)   session
//   POST /api/governance/portfolio/project/:id/decisions       record a decision about a project           committee
//   PUT  /api/governance/portfolio/decisions/:id/record        authority / outcome / decision date         committee
// Management alerts — 404 while ppm_alert_actions_enabled = '0' (PROPOSED, default = today):
//   GET  /api/governance/portfolio/alerts                      the six spec kinds over the readable portfolio,
//                                                              with the commitment each was promoted to   session
//   POST /api/governance/portfolio/alerts/promote {key, owner, due_date}
//                                                              alert → commitment (existing register; assign →
//                                                              follow → escalate (escalation matrix) → verify / close).
//                                                              Idempotent: one commitment per alert key.  committee
// Nothing here sends anything: no e-mail, no Teams, no notification. Outbound channels stay with their own (OFF) switches.
const { fail: httpFail } = require('../services/httpError');
const PX = require('../services/ppmAlerts');
const DA = require('../services/ppm/decisionAgenda');

module.exports = function governanceDecisionAgendaRoutes(router, h) {
  const { store, rdb, reportConfig, requireReportSession, json, requireCommittee, isCommittee, viewFor, visibleDecisions, canSeeMoney, log } = h;
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false, ...(e && e.code && e.expose ? { code: e.code } : {}) });
  const notFound = (res) => httpFail(res, new Error('not found'), 404, { ok: false });
  const commitments = () => h.commitments || require('./commitments').createStore(rdb());
  const today = () => new Date().toISOString().slice(0, 10);
  const swOn = (key) => async (req, res, next) => {
    try { if (String((await reportConfig.getConfig(rdb().db))[key]) === '1') return next(); return notFound(res); } catch (e) { return fail(res, e); }
  };
  const agendaOn = swOn('ppm_decision_agenda_enabled');
  const alertsOn = swOn('ppm_alert_actions_enabled');

  /** The decision records (with project link) this reader may see, for the readable projects. */
  async function readableDecisions(u, projects) {
    const ids = (projects || []).map((p) => Number(p.id));
    if (!ids.length) return [];
    const visible = new Set((await visibleDecisions(u, null)).map((d) => Number(d.id)));
    return (await store.listDecisions({ withRecord: true, projectIds: ids, limit: 2000 })).filter((d) => visible.has(Number(d.id)));
  }
  async function readableProject(u, id) {
    const { v } = await viewFor(u);
    return (v.projects || []).find((p) => Number(p.id) === Number(id) && !p.deleted_at) || null;
  }

  router.get('/api/governance/portfolio/decision-agenda', requireReportSession, agendaOn, async (req, res) => {
    try {
      const cfg = await reportConfig.getConfig(rdb().db);
      const { v } = await viewFor(req.reportUser);
      const sites = (await rdb().listSites({ includeInactive: true })) || [];
      const decisions = await readableDecisions(req.reportUser, v.projects);
      const g = DA.buildAgenda(v.projects || [], decisions, { today: today(), intake: String(cfg.ppm_intake_register_enabled) === '1', siteName: new Map(sites.map((s) => [Number(s.id), s.name])) });
      res.json({ ok: true, proposed: true, ...g, outcomes: DA.OUTCOMES, can_record: !!isCommittee(req.reportUser), as_of: new Date().toISOString() });
    } catch (e) { fail(res, e); }
  });

  router.post('/api/governance/portfolio/project/:id/decisions', requireReportSession, requireCommittee, agendaOn, json, async (req, res) => {
    try {
      const p = await readableProject(req.reportUser, req.params.id);
      if (!p) return notFound(res);
      const b = req.body || {};
      const rec = DA.normaliseRecord({ authority: b.authority });
      const d = await store.addProjectDecision(p, { title: b.title, text: b.text, owner: b.owner, due_date: b.due_date, authority: rec.authority }, { user: req.reportUser });
      log(req, 'project_decision_created', d.ref, { project_id: Number(p.id) });
      res.json({ ok: true, decision: d });
    } catch (e) { fail(res, e); }
  });

  router.put('/api/governance/portfolio/decisions/:id/record', requireReportSession, requireCommittee, agendaOn, json, async (req, res) => {
    try {
      const cur = await store.getDecisionRecord(req.params.id);
      if (!cur) return notFound(res);
      if (cur.project_id == null) return httpFail(res, Object.assign(new Error('this decision is not about a portfolio project'), { code: 'NOT_PROJECT_DECISION' }), 409, { ok: false, code: 'NOT_PROJECT_DECISION' });
      if (!(await readableProject(req.reportUser, cur.project_id))) return notFound(res);
      const b = req.body || {};
      // an outcome given without a date keeps the stored decision date (if any); none → 400
      const rec = DA.normaliseRecord({ authority: b.authority, outcome: b.outcome, decided_at: b.decided_at !== undefined ? b.decided_at : (b.outcome ? (cur.decided_at || undefined) : undefined) });
      const d = await store.setDecisionRecord(cur.id, rec, { user: req.reportUser });
      log(req, 'project_decision_recorded', d.ref, { fields: Object.keys(rec) });
      res.json({ ok: true, decision: d });
    } catch (e) { fail(res, e); }
  });

  /** The six kinds over what this reader may read; money kinds only for an amount reader. */
  async function alertsFor(u) {
    const cfg = await reportConfig.getConfig(rdb().db);
    const { v } = await viewFor(u);   // marks a W4 client role before the money decision
    const money = !!canSeeMoney(u) && !u.__ppmClient;
    const decisions = await readableDecisions(u, v.projects);
    const opts = { today: today(), money, decisions, decisionAgeDays: cfg.ppm_alert_decision_age_days };
    return { cfg, items: PX.findManagementAlerts(v, opts), coverage: PX.managementCoverage(v, opts), money };
  }

  router.get('/api/governance/portfolio/alerts', requireReportSession, alertsOn, async (req, res) => {
    try {
      const { cfg, items, coverage, money } = await alertsFor(req.reportUser);
      const states = new Map((await store.alertStates()).map((s) => [s.item_key, s]));
      const links = await commitments().linksFor(items.map((i) => ({ system: 'ppm_alert', id: i.key })));
      const out = items.map((i) => {
        const l = links.get(`ppm_alert:${i.key}`) || null; const s = states.get(i.key);
        return { ...i, status: l ? 'promoted' : 'open', first_seen: s && !s.cleared_at ? s.first_seen || null : null,
          commitment: l ? { id: l.id, status: l.status, uid: (s && s.commitment_uid) || null } : null };
      });
      res.json({ ok: true, proposed: true, items: out, coverage, money_hidden: !money, kinds: PX.MANAGEMENT_KINDS, severity: PX.SEVERITY,
        thresholds: { decision_age_days: String(cfg.ppm_alert_decision_age_days || '').trim() === '' ? null : Number(cfg.ppm_alert_decision_age_days) },
        outbound: { nightly_in_app_armed: String(cfg.ppm_alerts_enabled) === '1', external_armed: String(cfg.alert_external_enabled) === '1' },
        can_promote: !!isCommittee(req.reportUser), as_of: new Date().toISOString() });
    } catch (e) { fail(res, e); }
  });

  router.post('/api/governance/portfolio/alerts/promote', requireReportSession, requireCommittee, alertsOn, json, async (req, res) => {
    try {
      const b = req.body || {};
      const key = String(b.key || '').slice(0, 200);
      const { items } = await alertsFor(req.reportUser);
      const al = items.find((i) => i.key === key);
      if (!al) return httpFail(res, Object.assign(new Error('this alert is not active on the portfolio you can read'), { code: 'ALERT_NOT_ACTIVE' }), 404, { ok: false, code: 'ALERT_NOT_ACTIVE' });
      const r = await commitments().create(PX.commitmentFromAlert(al, { owner: b.owner, due_date: b.due_date }), { user: req.reportUser });
      await store.linkAlertCommitment({ item_key: al.key, kind: al.kind, project_id: al.project_id, commitment_uid: r.commitment.uid, severity: al.severity, recommended_action: al.recommended_action.en });
      log(req, 'ppm_alert_promoted', al.key, { commitment_id: r.commitment.id, created: r.created });
      res.json({ ok: true, created: r.created, commitment: { id: r.commitment.id, uid: r.commitment.uid, status: r.commitment.status, href: 'commitments.html?id=' + r.commitment.id } });
    } catch (e) { fail(res, e); }
  });
};
