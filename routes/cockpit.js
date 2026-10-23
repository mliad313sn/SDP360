'use strict';
// ---------------------------------------------------------------------------
// Step 8 (SDP-DASH-2.0) — meeting cockpit and requests register.
//
// Cadences (meeting-chair):        GET /api/cockpit/catalog · GET /api/cockpit/cadences · GET /api/cockpit/cadences/:id
//                                  POST /api/cockpit/cadences · PUT …/:id/draft · POST …/:id/publish · …/:id/retire
//                                  GET /api/cockpit/cadences/:id/agenda?date=   (live preview of the agenda)
// Sessions (meeting-chair runs):   GET /api/cockpit/sessions · POST /api/cockpit/sessions · GET /api/cockpit/sessions/:id
//                                  POST …/:id/start · …/:id/items/:seq/start · …/:id/items/:seq/end · PUT …/:id/items/:seq/notes
//                                  POST …/:id/decisions · POST …/:id/actions · POST …/:id/close
//                                  GET …/:id/minutes.html · GET …/:id/minutes.pdf · POST …/:id/minutes/send
// Actions (follow-up):             GET /api/cockpit/actions · POST /api/cockpit/actions/:id  (chair, owner, admin tier)
// Requests (anyone submits):       GET /api/cockpit/rfis · POST /api/cockpit/rfis
//          (committee-member):     POST /api/cockpit/rfis/:id/triage · POST /api/cockpit/rfis/:id/decide
//
// A meeting's agenda is generated from its cadence and FROZEN at the start (services/cockpit/agenda.js); the minutes
// (services/cockpit/minutes.js) are generated at the close and sent by e-mail only when a chair asks for it.
// ---------------------------------------------------------------------------
const cdef = require('../services/cockpit/definition');
const store = require('../services/cockpit/store');
const agenda = require('../services/cockpit/agenda');
const minutes = require('../services/cockpit/minutes');
const { audienceAllows } = require('../services/dashboards/definition');
const registry = require('../services/metrics/registry');
const live = require('../services/metrics/liveDeps');

const SOURCE_KINDS = ['free', 'incident', 'metric', 'issue', 'rfi', 'project', 'decision'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

module.exports = function cockpitRoutes(d) {
  const { express, rdb, requireReportSession, requireRole } = d;
  const router = express.Router();
  const CHAIR = requireRole(['meeting-chair', 'super_admin']);
  const COMMITTEE = requireRole(['committee-member', 'super_admin']);
  const has = (u, r) => rdb.userHasRole(u, r);
  const who = (req) => (req.reportUser && (req.reportUser.username || req.reportUser.full_name)) || 'unknown';
  const isChair = (u) => has(u, 'meeting-chair') || has(u, 'super_admin');
  const served = () => new Set(registry.list().filter(m => m.serve).map(m => m.key));
  const log = (req, action, target, details) => { try { rdb.logEvent({ category: 'cockpit', action, target, details, ...rdb._logCtx(req) }); } catch (_) {} };

  async function agendaDeps() {
    return { sites: await live.groupSites(rdb), targets: await live.targets(rdb), metrics: live.liveDeps(rdb),
      readers: require('../services/dashboards/readers').readers(rdb) };
  }
  async function siteIds() { return new Set((await live.groupSites(rdb)).map(s => s.site_id)); }
  async function sessionWithCadence(req, res, needLive) {
    const s = await store.getSession(String(req.params.id));
    if (!s) { res.status(404).json({ error: 'Meeting not found' }); return null; }
    const ver = s.cadence_version ? await store.cadences.getVersion(s.cadence_id, s.cadence_version) : await store.cadences.getPublished(s.cadence_id);
    if (!ver) { res.status(404).json({ error: 'Cadence not found' }); return null; }
    if (!audienceAllows(ver.definition, req.reportUser, has) && !isChair(req.reportUser)) { res.status(403).json({ error: 'This meeting is not open to your role.' }); return null; }
    if (needLive && s.status !== 'live') { res.status(409).json({ error: s.status === 'planned' ? 'Start the meeting first.' : 'This meeting is closed.' }); return null; }
    return { s, cadence: ver.definition };
  }
  const seqOf = (req) => Number(req.params.seq);

  // ── Cadences ───────────────────────────────────────────────────────────
  router.get('/api/cockpit/catalog', requireReportSession, CHAIR, async (req, res) => {
    const sites = await live.groupSites(rdb);
    res.json({ types: cdef.TYPES, sections: Object.fromEntries(Object.entries(cdef.SECTIONS).map(([k, v]) => [k, v.label])), templates: cdef.TEMPLATES,
      sites: sites.map(s => ({ site_id: s.site_id, code: s.code, name: s.name })), source_kinds: SOURCE_KINDS,
      metrics: registry.list().filter(m => m.serve).map(m => ({ key: m.key, fr: m.fr, unit: m.unit })),
      audience_roles: require('../services/dashboards/definition').AUDIENCE_ROLES });
  });

  router.get('/api/cockpit/cadences', requireReportSession, async (req, res) => {
    try {
      const u = req.reportUser, chair = isChair(u), out = [];
      for (const row of await store.cadences.list()) {
        const visible = row.published && !row.retired && audienceAllows(row.published, u, has);
        if (!visible && !chair) continue;
        const dd = row.published || row.draft || {};
        out.push({ id: row.id, title: dd.title, type: dd.type, site_id: dd.site_id, rhythm: dd.rhythm, weekday: dd.weekday, time: dd.time,
          published_version: row.published_version, retired: row.retired, has_draft: !!row.draft, visible });
      }
      res.json({ cadences: out, chair, committee: has(u, 'committee-member') || has(u, 'super_admin') });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/cockpit/cadences/:id', requireReportSession, async (req, res) => {
    try {
      const row = await store.cadences.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Cadence not found' });
      const pub = await store.cadences.getPublished(row.id), chair = isChair(req.reportUser);
      if (!chair && !(pub && audienceAllows(pub.definition, req.reportUser, has))) return res.status(pub ? 403 : 404).json({ error: pub ? 'Not open to your role.' : 'Cadence not found' });
      res.json({ id: row.id, published: pub, retired: row.retired, chair, draft: chair ? row.draft : undefined, versions: chair ? await store.cadences.versions(row.id) : undefined });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/cockpit/cadences', requireReportSession, CHAIR, async (req, res) => {
    try {
      const b = req.body || {};
      const draft = b.definition || { id: b.id, title: b.title, type: b.type, site_id: b.site_id, agenda: cdef.TEMPLATES[b.type] || cdef.TEMPLATES.other, preparer: who(req), participants: [] };
      const v = cdef.validate(draft, { servedMetrics: served(), siteIds: await siteIds() });
      if (!v.ok) return res.status(400).json({ error: 'Invalid cadence', details: v.errors });
      if (await store.cadences.get(v.definition.id)) return res.status(409).json({ error: 'A cadence with this id already exists' });
      await store.cadences.saveDraft(v.definition.id, v.definition, who(req));
      log(req, 'cadence_created', v.definition.id);
      res.status(201).json({ id: v.definition.id, draft: v.definition, warnings: v.warnings });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/api/cockpit/cadences/:id/draft', requireReportSession, CHAIR, async (req, res) => {
    try {
      const row = await store.cadences.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Cadence not found' });
      const v = cdef.validate({ ...((req.body || {}).definition || {}), id: row.id }, { servedMetrics: served(), siteIds: await siteIds() });
      if (!v.ok) return res.status(400).json({ error: 'Invalid cadence', details: v.errors, warnings: v.warnings });
      await store.cadences.saveDraft(row.id, v.definition, who(req));
      res.json({ id: row.id, draft: v.definition, warnings: v.warnings });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/cockpit/cadences/:id/publish', requireReportSession, CHAIR, async (req, res) => {
    try {
      const row = await store.cadences.get(String(req.params.id));
      if (!row || !row.draft) return res.status(404).json({ error: 'No draft to publish' });
      const v = cdef.validate(row.draft, { servedMetrics: served(), siteIds: await siteIds() });
      if (!v.ok) return res.status(400).json({ error: 'The draft is not valid', details: v.errors });
      const version = await store.cadences.publishDefinition(row.id, v.definition, who(req), (req.body || {}).note);
      log(req, 'cadence_published', row.id, { version });
      res.json({ id: row.id, version });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/cockpit/cadences/:id/retire', requireReportSession, CHAIR, async (req, res) => {
    try { await store.cadences.retire(String(req.params.id)); log(req, 'cadence_retired', String(req.params.id)); res.json({ retired: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/cockpit/cadences/:id/agenda', requireReportSession, CHAIR, async (req, res) => {
    try {
      const row = await store.cadences.get(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Cadence not found' });
      const v = cdef.validate(row.draft || (await store.cadences.getPublished(row.id) || {}).definition, { servedMetrics: served() });
      if (!v.ok) return res.status(400).json({ error: 'Invalid cadence', details: v.errors });
      const date = DATE_RE.test(String(req.query.date || '')) ? String(req.query.date) : new Date().toISOString().slice(0, 10);
      res.json(await agenda.build(v.definition, date, await agendaDeps()));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Sessions ───────────────────────────────────────────────────────────
  router.get('/api/cockpit/sessions', requireReportSession, async (req, res) => {
    try {
      const rows = await store.listSessions({ cadence_id: req.query.cadence ? String(req.query.cadence) : undefined, status: req.query.status ? String(req.query.status) : undefined });
      const out = [];
      const cache = new Map();
      for (const s of rows) {
        if (!cache.has(s.cadence_id)) cache.set(s.cadence_id, await store.cadences.getPublished(s.cadence_id));
        const pub = cache.get(s.cadence_id);
        if (!isChair(req.reportUser) && !(pub && audienceAllows(pub.definition, req.reportUser, has))) continue;
        out.push({ id: s.id, cadence_id: s.cadence_id, title: pub ? pub.definition.title : s.cadence_id, held_on: s.held_on, status: s.status, has_minutes: s.has_minutes, minutes_sent_at: s.minutes_sent_at });
      }
      res.json({ sessions: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/cockpit/sessions', requireReportSession, CHAIR, async (req, res) => {
    try {
      const b = req.body || {};
      const pub = await store.cadences.getPublished(String(b.cadence_id || ''));
      if (!pub) return res.status(404).json({ error: 'Publish the cadence first.' });
      const held = DATE_RE.test(String(b.held_on || '')) ? String(b.held_on) : new Date().toISOString().slice(0, 10);
      const s = await store.createSession({ cadence_id: pub.definition.id, cadence_version: pub.version, held_on: held }, who(req));
      log(req, 'meeting_planned', s.id, { cadence: s.cadence_id, held_on: held });
      res.status(201).json(s);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/cockpit/sessions/:id', requireReportSession, async (req, res) => {
    try {
      const x = await sessionWithCadence(req, res, false); if (!x) return;
      res.json({ session: x.s, cadence: x.cadence, items: await store.items(x.s.id), decisions: await store.decisions({ session_id: x.s.id }),
        actions: await store.listActions({ session_id: x.s.id }), chair: isChair(req.reportUser) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/cockpit/sessions/:id/start', requireReportSession, CHAIR, async (req, res) => {
    try {
      const x = await sessionWithCadence(req, res, false); if (!x) return;
      if (x.s.status !== 'planned') return res.status(409).json({ error: 'This meeting has already started.' });
      const ag = await agenda.build(x.cadence, x.s.held_on, await agendaDeps());
      const s = await store.startSession(x.s.id, ag);
      log(req, 'meeting_started', s.id, { cadence: s.cadence_id });
      res.json({ session: s, items: await store.items(s.id) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/cockpit/sessions/:id/items/:seq/start', requireReportSession, CHAIR, async (req, res) => {
    try { const x = await sessionWithCadence(req, res, true); if (!x) return; res.json({ items: await store.startItem(x.s.id, seqOf(req)) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/cockpit/sessions/:id/items/:seq/end', requireReportSession, CHAIR, async (req, res) => {
    try { const x = await sessionWithCadence(req, res, true); if (!x) return; res.json({ items: await store.endItem(x.s.id, seqOf(req)) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/api/cockpit/sessions/:id/items/:seq/notes', requireReportSession, CHAIR, async (req, res) => {
    try { const x = await sessionWithCadence(req, res, true); if (!x) return; await store.setNotes(x.s.id, seqOf(req), (req.body || {}).notes); res.json({ saved: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  function sourceOf(b) {
    const kind = SOURCE_KINDS.includes(b.source_kind) ? b.source_kind : 'free';
    return { source_kind: kind, source_ref: kind === 'free' ? null : str(b.source_ref, 80) || null };
  }
  router.post('/api/cockpit/sessions/:id/decisions', requireReportSession, CHAIR, async (req, res) => {
    try {
      const x = await sessionWithCadence(req, res, true); if (!x) return;
      const b = req.body || {}, text = str(b.text, 1000);
      if (!text) return res.status(400).json({ error: 'The decision text is empty.' });
      const id = await store.addDecision({ session_id: x.s.id, item_seq: Number(b.item_seq) || null, text, owner: str(b.owner, 80) || null, ...sourceOf(b) }, who(req));
      log(req, 'decision_recorded', id, { session: x.s.id });
      res.status(201).json({ id, decisions: await store.decisions({ session_id: x.s.id }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/cockpit/sessions/:id/actions', requireReportSession, CHAIR, async (req, res) => {
    try {
      const x = await sessionWithCadence(req, res, true); if (!x) return;
      const b = req.body || {}, title = str(b.title, 300);
      if (!title) return res.status(400).json({ error: 'The action is empty.' });
      const due = DATE_RE.test(String(b.due_date || '')) ? String(b.due_date) : null;
      const a = await store.addAction({ session_id: x.s.id, cadence_id: x.s.cadence_id, item_seq: Number(b.item_seq) || null, title, owner: str(b.owner, 80) || null, due_date: due, ...sourceOf(b) }, who(req));
      log(req, 'action_recorded', a.id, { session: x.s.id, source: a.source_kind });
      res.status(201).json({ action: a, actions: await store.listActions({ session_id: x.s.id }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/cockpit/sessions/:id/close', requireReportSession, CHAIR, async (req, res) => {
    try {
      const x = await sessionWithCadence(req, res, true); if (!x) return;
      const t = new Date().toISOString();
      const items = (await store.items(x.s.id)).map(it => (it.started_at && !it.ended_at ? { ...it, ended_at: t } : it));
      const html = minutes.render({ cadence: x.cadence, session: { ...x.s, ended_at: t }, items,
        decisions: await store.decisions({ session_id: x.s.id }), actions: await store.listActions({ session_id: x.s.id }) });
      const s = await store.closeSession(x.s.id, html);
      log(req, 'meeting_closed', s.id, { cadence: s.cadence_id });
      res.json({ session: s });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/cockpit/sessions/:id/minutes.html', requireReportSession, async (req, res) => {
    try {
      const x = await sessionWithCadence(req, res, false); if (!x) return;
      const html = await store.getMinutes(x.s.id);
      if (!html) return res.status(404).json({ error: 'The minutes are written when the meeting is closed.' });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
      res.send(html);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/api/cockpit/sessions/:id/minutes.pdf', requireReportSession, async (req, res) => {
    try {
      const x = await sessionWithCadence(req, res, false); if (!x) return;
      const html = await store.getMinutes(x.s.id);
      if (!html) return res.status(404).json({ error: 'The minutes are written when the meeting is closed.' });
      const r = await (d.renderPdf || require('../services/reportRender').renderPdf)(html, { stamp: 'pv-' + x.s.id });
      if (!r.ok) return res.status(503).json({ error: 'PDF unavailable on this server (' + r.reason + '). Use the HTML minutes.' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="pv-${x.s.cadence_id}-${x.s.held_on}.pdf"`);
      res.send(r.pdf);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/cockpit/sessions/:id/minutes/send', requireReportSession, CHAIR, async (req, res) => {
    try {
      const x = await sessionWithCadence(req, res, false); if (!x) return;
      const html = await store.getMinutes(x.s.id);
      if (!html) return res.status(409).json({ error: 'Close the meeting first.' });
      const to = (x.cadence.participants || []).map(p => p.email).filter(Boolean);
      if (!to.length) return res.status(400).json({ error: 'No participant has an e-mail address in the cadence.' });
      const mailer = d.mailer || require('../services/mailer').buildMailer(await require('../services/reportConfig').getConfig(rdb.db));
      const r = await mailer.send({ to: to.join(', '), subject: `Procès-verbal — ${x.cadence.title} — ${x.s.held_on}`, html });
      if (!r.ok) return res.status(502).json({ error: 'The e-mail was not sent: ' + r.error });
      await store.markMinutesSent(x.s.id);
      log(req, 'minutes_sent', x.s.id, { recipients: to.length });
      res.json({ sent: true, recipients: to.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Actions (follow-up between meetings) ───────────────────────────────
  router.get('/api/cockpit/actions', requireReportSession, async (req, res) => {
    try {
      const q = req.query || {};
      res.json({ actions: await store.listActions({ status: q.status ? String(q.status) : undefined, cadence_id: q.cadence ? String(q.cadence) : undefined,
        source_kind: q.source_kind ? String(q.source_kind) : undefined, source_ref: q.source_ref ? String(q.source_ref) : undefined }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/cockpit/actions/:id', requireReportSession, async (req, res) => {
    try {
      const a = await store.getAction(String(req.params.id));
      if (!a) return res.status(404).json({ error: 'Action not found' });
      const u = req.reportUser;
      const mine = a.owner && [u.username, u.full_name].filter(Boolean).map(s => s.toLowerCase()).includes(String(a.owner).toLowerCase());
      if (!isChair(u) && !mine && !has(u, 'admin')) return res.status(403).json({ error: 'Only its owner or a meeting chair updates an action.' });
      const b = req.body || {};
      const patch = {};
      if (b.status !== undefined) { if (!['open', 'done', 'cancelled'].includes(b.status)) return res.status(400).json({ error: 'status: open, done or cancelled' }); patch.status = b.status; }
      if (b.due_date !== undefined) { if (b.due_date && !DATE_RE.test(String(b.due_date))) return res.status(400).json({ error: 'due_date: YYYY-MM-DD' }); patch.due_date = b.due_date || null; }
      if (b.owner !== undefined) patch.owner = str(b.owner, 80) || null;
      const out = await store.updateAction(a.id, patch, who(req));
      log(req, 'action_updated', a.id, patch);
      res.json({ action: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Requests for information / decision ────────────────────────────────
  router.get('/api/cockpit/rfis', requireReportSession, async (req, res) => {
    try {
      const rows = await store.listRfis({ status: req.query.status ? String(req.query.status) : undefined });
      res.json({ rfis: rows.map(r => ({ ...r, score: r.score == null ? null : Number(r.score) })), committee: has(req.reportUser, 'committee-member') || has(req.reportUser, 'super_admin') });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/cockpit/rfis', requireReportSession, async (req, res) => {
    try {
      const b = req.body || {}, title = str(b.title, 200);
      if (!title) return res.status(400).json({ error: 'Give the request a title.' });
      const r = await store.addRfi({ title, description: str(b.description, 4000), category: str(b.category, 60) }, who(req));
      log(req, 'rfi_submitted', r.id);
      res.status(201).json({ rfi: r });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/cockpit/rfis/:id/triage', requireReportSession, COMMITTEE, async (req, res) => {
    try {
      const r = await store.getRfi(String(req.params.id));
      if (!r) return res.status(404).json({ error: 'Request not found' });
      const b = req.body || {};
      const n = (k) => { const v = Number(b[k]); return Number.isInteger(v) && v >= 1 && v <= 5 ? v : null; };
      const value = n('value'), urgency = n('urgency'), effort = n('effort');
      const status = ['triage', 'scored', 'rejected'].includes(b.status) ? b.status : (value && urgency && effort ? 'scored' : 'triage');
      // Score (DEC-8.5 recommended): value × urgency ÷ effort, on 1-5 scales → 0.2 to 25.
      const score = value && urgency && effort ? Math.round((value * urgency / effort) * 10) / 10 : null;
      const out = await store.triageRfi(r.id, { status, value, urgency, effort, score, note: str(b.note, 1000) }, who(req));
      log(req, 'rfi_triaged', r.id, { status, score });
      res.json({ rfi: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/cockpit/rfis/:id/decide', requireReportSession, COMMITTEE, async (req, res) => {
    try {
      const r = await store.getRfi(String(req.params.id));
      if (!r) return res.status(404).json({ error: 'Request not found' });
      const b = req.body || {}, text = str(b.text, 1000);
      if (!text) return res.status(400).json({ error: 'Write the decision.' });
      const decisionId = await store.addDecision({ rfi_id: r.id, text, owner: str(b.owner, 80) || null, source_kind: 'rfi', source_ref: r.id }, who(req));
      const out = await store.decideRfi(r.id, decisionId, b.rejected ? 'rejected' : 'decided');
      log(req, 'rfi_decided', r.id, { decision: decisionId, rejected: !!b.rejected });
      res.json({ rfi: out, decision_id: decisionId });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
