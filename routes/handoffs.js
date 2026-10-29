'use strict';
// G-22 — interdepartmental business handoffs (committee review 2026-10-28). Feature flag handoffs_enabled
// (default '0'): off → every /api/handoffs route answers 404.
//
//   GET  /api/handoffs?status=                 scoped list: admin all; others their sites + where they are requester / receiver
//   GET  /api/handoffs/:id                     detail + events + allowed transitions
//   POST /api/handoffs                         { title, description, site_id, from_department, to_department, receiver, due_date,
//                                                source_kind, source_ref, commitment_id, idem_key, receiver_contact? }  editor of the site | admin
//   (receiver_contact: a named person without an account — only under the site policy handoffs.proxy_accept)
// ADR-006: a deputy named in Governance ▸ Roles (table deputies) sees and acts on the handoffs of the person
// they replace, recorded as acting_for; a deputy never verifies the work of the person they replace.
//   POST /api/handoffs/:id/transition          { to, version, reason }   rules: services/handoffLifecycle
//   POST /api/handoffs/:id/reassign            { receiver, version, reason }   requester | admin  → back to `requested`
//   GET  /handoffs.html
// The receiver is a named, ACTIVE user who has the handoff's site; departments are checked against the
// department list. Notifications (in-app only) are sent only when handoff_notify_enabled = '1'.

const { fail: httpFail, typed } = require('../services/httpError');

function createStore(rdbMod) {
  return require('../services/handoffStore').makeHandoffStore({ prepare: (sql) => rdbMod.pgHandle().prepare(sql), runTransaction: (fn) => rdbMod.pgHandle().runTransaction(fn) });
}

module.exports = function handoffRoutes(deps) {
  const { express, requireReportSession, store } = deps;
  const router = express.Router();
  const json = express.json({ limit: '64kb' });
  const rdb = () => deps.rdb || require('../reports-db');
  const reportConfig = deps.reportConfig || require('../services/reportConfig');
  const userSites = require('../services/userSites');
  const L = require('../services/handoffLifecycle');
  const fail = (res, e) => httpFail(res, e);
  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  // ADR-006 — deputyFor = the people this user stands in for today (table deputies; empty = as before)
  const actorOf = (u, h, deputyFor = []) => ({ id: u.id, isAdmin: isAdmin(u), active: u.active !== 0 && u.active !== false, hasSite: h ? userSites.hasSite(u, h.site_id) : false, deputyFor });
  const deputyFor = async (u) => { try { return deps.rolesStore ? await deps.rolesStore.principalsOf(u.id) : []; } catch (_) { return []; } };
  const log = (req, action, target, details) => { try { rdb().logEvent({ category: 'handoffs', action, target: String(target), details, ...rdb()._logCtx(req) }); } catch (_) {} };
  const polFor = (siteId) => require('../services/governancePolicy').forContext({ siteId });
  const cfg = async () => { try { return await reportConfig.getConfig(rdb().db); } catch (_) { return {}; } };

  async function enabled(req, res, next) {
    try { if (String((await cfg()).handoffs_enabled) !== '1') return res.status(404).json({ error: 'handoffs are not enabled' }); next(); } catch (e) { fail(res, e); }
  }
  const visible = (u, h, dep = []) => !!h && (isAdmin(u) || userSites.hasSite(u, h.site_id) || [u.id, ...dep].map(Number).some((x) => x === Number(h.requested_by) || x === Number(h.receiver_id)));
  async function load(req, res) {
    const h = await store.get(req.params.id);
    req.deputyFor = await deputyFor(req.reportUser);
    if (!visible(req.reportUser, h, req.deputyFor)) { res.status(404).json({ error: 'handoff not found' }); return null; }
    return h;
  }
  // idem_key stays server-side; can_reassign is probed with a reason long enough for any policy minimum
  const view = (h, u, dep = []) => { const { idem_key: _idem, ...rest } = h || {}; void _idem; const a = actorOf(u, h, dep); return { ...rest, allowed: L.allowed(h, a), can_reassign: !L.checkReassign(h, a, -1, { reason: 'x'.repeat(500) }), acting_for: L.actingFor(h, a, 'receiver') || L.actingFor(h, a, 'requester') }; };

  /** The receiver must be a real, active user who has the handoff's site (no hand-off into the void). */
  async function resolveReceiver(ref, siteId) {
    if (ref == null || ref === '') throw typed('VALIDATION', 'receiver is required', 400);
    const users = (await rdb().listUsers()) || [];
    const key = String(ref).trim().toLowerCase();
    const u = users.find((x) => String(x.id) === key || String(x.username || '').toLowerCase() === key || String(x.email || '').toLowerCase() === key);
    // ONE answer for "no such account", "inactive" and "another site": the form cannot be used to probe
    // which accounts exist (committee security). The site-scoped picker (GET /api/handoffs/people) is the way to choose.
    const NOPE = 'no active person with this username or e-mail works on this site — pick the receiver from the list';
    if (!u || u.active === 0 || u.active === false) throw typed('VALIDATION', NOPE, 400);
    const ids = [u.site_id, ...((u.extra_site_ids) || [])].filter((x) => x != null).map(Number);
    if (!rdb().userHasRole(u, 'admin') && !ids.includes(Number(siteId))) throw typed('VALIDATION', NOPE, 400);
    return Number(u.id);
  }
  async function checkDepartments(from, to) {
    const names = new Set(((await rdb().listDepartments()) || []).map((d) => String(d.name).trim().toLowerCase()));
    for (const d of [from, to]) if (!names.has(String(d || '').trim().toLowerCase())) throw typed('VALIDATION', `unknown department "${String(d || '').slice(0, 60)}"`, 400);
  }
  async function notify(userId, h, title) {
    if (String((await cfg()).handoff_notify_enabled) !== '1' || !deps.notify) return false;
    try { await deps.notify({ userId, kind: 'handoff', title: `${h.ref} — ${title}`, body: h.title, link: `handoffs.html?id=${h.id}`, sourceKind: 'handoff', sourceRef: String(h.id) }); return true; } catch (_) { return false; }
  }

  router.get('/handoffs.html', (req, res) => deps.sendHtmlPage(res, 'handoffs.html', false, 'Handoffs page unavailable'));

  // Site-scoped receiver picker: the active people of ONE of the caller's sites (id + name only).
  router.get('/api/handoffs/people', requireReportSession, enabled, async (req, res) => {
    try {
      const u = req.reportUser; const site = Number(req.query.site);
      if (!Number.isFinite(site)) return res.status(400).json({ ok: false, error: 'site is required' });
      if (!isAdmin(u) && !userSites.hasSite(u, site)) return res.status(403).json({ ok: false, error: 'not one of your sites' });
      const people = ((await rdb().listUsers()) || []).filter((x) => x.active !== 0 && x.active !== false && Number(x.id) !== Number(u.id)
        && [x.site_id, ...((x.extra_site_ids) || [])].filter((v) => v != null).map(Number).includes(site))
        .map((x) => ({ id: Number(x.id), username: x.username, name: x.full_name || x.username }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
      res.json({ ok: true, people });
    } catch (e) { fail(res, e); }
  });

  router.get('/api/handoffs', requireReportSession, enabled, async (req, res) => {
    try {
      const u = req.reportUser;
      const rows = await store.list({ siteIds: isAdmin(u) ? null : userSites.siteIds(u), userId: u.id, userIds: await deputyFor(u), status: req.query.status || null });
      const mine = isAdmin(u) ? null : userSites.siteIds(u).map(Number);
      const sites = ((await rdb().listSites({ includeInactive: false })) || []).filter((x) => !mine || mine.includes(Number(x.id))).map((x) => ({ id: Number(x.id), name: x.name }));
      res.json({ handoffs: rows.map(({ idem_key: _i, ...r }) => r), statuses: L.STATUSES, sites, departments: ((await rdb().listDepartments()) || []).map((d) => d.name) });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/handoffs/:id', requireReportSession, enabled, async (req, res) => {
    try { const h = await load(req, res); if (h) res.json({ handoff: view(h, req.reportUser, req.deputyFor) }); } catch (e) { fail(res, e); }
  });
  router.post('/api/handoffs', requireReportSession, enabled, json, async (req, res) => {
    try {
      const u = req.reportUser, b = req.body || {};
      if (!isAdmin(u)) {
        if (!rdb().userHasRole(u, 'editor')) return res.status(403).json({ error: 'editor role required' });
        if (b.site_id == null || !userSites.hasSite(u, b.site_id)) return res.status(403).json({ error: 'Access denied: another site' });
      }
      await checkDepartments(b.from_department, b.to_department);
      // committee #34: a receiver without an account only under the site policy handoffs.proxy_accept
      const cc = L.contactCheck(b.receiver_contact, await polFor(b.site_id)); if (cc) return res.status(cc.status).json({ error: cc.error, code: cc.code });
      const receiverId = await resolveReceiver(b.receiver, b.site_id);
      if (b.commitment_id != null && b.commitment_id !== '' && deps.commitmentStore) {
        const c = await deps.commitmentStore.getRaw(b.commitment_id);
        if (!c || Number(c.site_id) !== Number(b.site_id)) return res.status(400).json({ error: 'the linked commitment is not on this site' });
      }
      const r = await store.create({ ...b, receiver_id: receiverId }, { user: u });
      if (r.created) { log(req, 'handoff_created', r.handoff.ref, { to_department: r.handoff.to_department }); await notify(receiverId, r.handoff, 'handed to you'); }
      // committee #39 — under handoffs.commitment_ledger the handoff is also recorded as a commitment
      if (r.created && r.handoff.commitment_id == null && deps.commitmentStore && (await polFor(r.handoff.site_id))['handoffs.commitment_ledger'] === true && String((await cfg()).commitments_enabled) === '1') {
        const recv = ((await rdb().listUsers()) || []).find((x) => Number(x.id) === Number(receiverId));
        const c = await deps.commitmentStore.create({ kind: 'corrective_action', title: `${r.handoff.ref} — ${r.handoff.title}`.slice(0, 300), site_id: r.handoff.site_id, due_date: r.handoff.due_date || undefined,
          department: r.handoff.to_department, accountable_owner: (recv && (recv.username || recv.email)) || undefined, source: { system: 'handoff', id: String(r.handoff.id) } }, { user: u });
        if (c && c.commitment) { await store.setCommitment(r.handoff.id, c.commitment.id, u.id); r.handoff = await store.get(r.handoff.id); }
      }
      res.status(r.created ? 201 : 200).json({ created: r.created, handoff: view(r.handoff, u) });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/handoffs/:id/transition', requireReportSession, enabled, json, async (req, res) => {
    try {
      const h = await load(req, res); if (!h) return;
      const b = req.body || {};
      const a = actorOf(req.reportUser, h, req.deputyFor);
      const out = await store.transition(h.id, String(b.to || ''), { actor: a, expectedVersion: b.version, reason: b.reason, policy: await polFor(h.site_id), idemKey: req.headers['idempotency-key'] || b.idem_key });
      if (out.replayed) return res.json({ handoff: view(out, req.reportUser, req.deputyFor), replayed: true });
      log(req, 'handoff_transition', h.ref, { from: h.status, to: out.status, acting_for: L.actingFor(h, a, 'receiver') || L.actingFor(h, a, 'requester') || undefined });
      await notify(L.actsAsRequester(h, a) ? out.receiver_id : out.requested_by, out, out.status);
      res.json({ handoff: view(out, req.reportUser, req.deputyFor) });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/handoffs/:id/reassign', requireReportSession, enabled, json, async (req, res) => {
    try {
      const h = await load(req, res); if (!h) return;
      const b = req.body || {};
      const to = await resolveReceiver(b.receiver, h.site_id);
      const out = await store.reassign(h.id, to, { actor: actorOf(req.reportUser, h, req.deputyFor), expectedVersion: b.version, reason: b.reason, policy: await polFor(h.site_id) });
      log(req, 'handoff_reassigned', h.ref, { from: h.receiver_id, to });
      await notify(to, out, 'handed to you');
      res.json({ handoff: view(out, req.reportUser, req.deputyFor) });
    } catch (e) { fail(res, e); }
  });
  return router;
};
module.exports.createStore = createStore;
