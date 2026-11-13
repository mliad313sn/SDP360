'use strict';
// B6 (P7a) — audience-scoped roadmap publications, registered on the governance router with its helpers. Every action
// exists only while report_config roadmap_audience_publication_enabled = '1' (404 while '0' = today). Rules live in
// services/roadmapAudience.js (pure); this file maps the session and does the I/O (table roadmap_publications, 101).
//   GET  /api/governance/roadmap-publications              the publications this session may read (metadata only)
//   POST /api/governance/roadmap-publications {audience, site_id|programme_id, title, expires_in_days, include_amounts}
//        site → committee or an editor of that site; programme / committee / exec → committee. Frozen at once.
//   GET  /api/governance/roadmap-publications/:id          the frozen snapshot (amounts only for admin tier + finance-viewer)
//   POST /api/governance/roadmap-publications/:id/revoke   publisher or committee
//   POST /api/governance/roadmap-publications/:id/share {ttl_hours}  site / programme audiences only; reuses the
//        engagement share links (target_kind roadmap_publication); the public view never carries an amount and
//        stops with the publication (expiry / revocation).
// Nothing here changes the Roadmap Manager → portfolio migration (roadmap_publication_enabled, R2-WB-06).
const { fail: httpFail } = require('../services/httpError');
const RA = require('../services/roadmapAudience');

const pubRow = (r) => r && ({
  id: Number(r.id), audience: r.audience, audience_ref: r.audience_ref == null ? null : Number(r.audience_ref), title: r.title,
  site_ids: (() => { try { return JSON.parse(r.site_ids || '[]').map(Number); } catch (_) { return []; } })(),
  has_amounts: Number(r.has_amounts) === 1, created_by: r.created_by == null ? null : Number(r.created_by), created_by_name: r.created_by_name || null,
  created_at: r.created_at, expires_at: r.expires_at || null, revoked_at: r.revoked_at || null,
});

function makeStore(H) {
  const P = (sql) => H.prepare(sql);
  return {
    async create(p) {
      const r = await P(`INSERT INTO roadmap_publications (audience, audience_ref, title, payload_json, site_ids, has_amounts, created_by, created_by_name, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).run(p.audience, p.audience_ref, p.title, JSON.stringify(p.snapshot), JSON.stringify(p.snapshot.site_ids || []), p.snapshot.has_amounts ? 1 : 0, p.user ? Number(p.user.id) : null, p.user ? String(p.user.full_name || p.user.username || '') : null, p.now, p.expires_at);
      return Number(r && (r.lastID != null ? r.lastID : r.id));
    },
    async get(id) { const r = await P(`SELECT * FROM roadmap_publications WHERE id=?`).get(Number(id)); return r ? { ...pubRow(r), snapshot: JSON.parse(r.payload_json) } : null; },
    async list() { return (await P(`SELECT id, audience, audience_ref, title, site_ids, has_amounts, created_by, created_by_name, created_at, expires_at, revoked_at FROM roadmap_publications ORDER BY id DESC LIMIT 500`).all()).map(pubRow); },
    async revoke(id, user, now) { await P(`UPDATE roadmap_publications SET revoked_at=?, revoked_by=? WHERE id=? AND revoked_at IS NULL`).run(now, user ? Number(user.id) : null, Number(id)); },
  };
}

module.exports = function governanceRoadmapAudienceRoutes(router, h) {
  const { store: govStore, rdb, reportConfig, requireReportSession, json, isCommittee, isAdmin, portfolioView, log } = h;
  const S = () => makeStore(rdb().pgHandle());
  const notFound = (res) => httpFail(res, new Error('not found'), 404, { ok: false });
  const on = async (res) => { if (String((await reportConfig.getConfig(rdb().db)).roadmap_audience_publication_enabled) !== '1') { notFound(res); return false; } return true; };
  const roles = (u) => ({ isAdmin: !!isAdmin(u), isCommittee: !!isCommittee(u), isEditor: !!rdb().userHasRole(u, 'editor') });
  // invariant 2 — amounts: the admin tier and finance-viewer ONLY (a committee member without admin does not read them here)
  const moneyReader = (u) => !!isAdmin(u) || !!rdb().userHasRole(u, 'finance-viewer');
  const nowIso = () => new Date().toISOString();
  const bad = (res, msg, code) => httpFail(res, Object.assign(new Error(msg), { reason: code }), 400, { ok: false, code });
  const mayManage = (u, pub) => !!isCommittee(u) || (pub && pub.created_by != null && Number(pub.created_by) === Number(u.id));

  router.get('/api/governance/roadmap-publications', requireReportSession, async (req, res) => {
    try {
      if (!(await on(res))) return;
      const u = req.reportUser, r = roles(u);
      const rows = (await S().list()).filter((p) => RA.canRead(u, p, r) || (mayManage(u, p) && (p.revoked_at || !RA.isLive(p))));
      res.json({ ok: true, audiences: RA.AUDIENCES, can_publish_committee: r.isCommittee || r.isAdmin, money_reader: moneyReader(u),
        publications: rows.map((p) => ({ ...p, live: RA.isLive(p), shareable: RA.shareable(p) && RA.isLive(p) && mayManage(u, p), can_revoke: mayManage(u, p) && RA.isLive(p) })) });
    } catch (e) { httpFail(res, e, undefined, { ok: false }); }
  });

  router.post('/api/governance/roadmap-publications', requireReportSession, json, async (req, res) => {
    try {
      if (!(await on(res))) return;
      const u = req.reportUser, b = req.body || {}, audience = String(b.audience || '');
      const ref = audience === 'site' ? b.site_id : audience === 'programme' ? b.programme_id : null;
      if (!RA.validRef(audience, ref)) return bad(res, 'audience must be site (with site_id), programme (with programme_id), committee or exec', 'INVALID_AUDIENCE');
      const title = String(b.title || '').trim().slice(0, 200);
      if (!title) return bad(res, 'a title is required', 'TITLE_REQUIRED');
      let expires = null;
      if (b.expires_in_days != null && b.expires_in_days !== '') {
        const d = Math.floor(Number(b.expires_in_days));
        if (!Number.isFinite(d) || d < 1 || d > 365) return bad(res, 'expires_in_days must be 1..365', 'INVALID_EXPIRY');
        expires = new Date(Date.now() + d * 864e5).toISOString();
      }
      if (!RA.canPublish(u, audience, ref, roles(u))) return httpFail(res, new Error('you may publish a roadmap only for your own site (or be on the committee)'), 403, { ok: false, code: 'PUBLISH_SCOPE' });
      const view = await portfolioView();
      if (audience === 'programme' && !(view.programmes || []).some((g) => Number(g.id) === Number(ref))) return notFound(res);
      // amounts: only for the committee / exec audiences, on request, by someone who reads money (admin tier / finance-viewer)
      const amounts = b.include_amounts === true && (audience === 'committee' || audience === 'exec') && moneyReader(u);
      const snapshot = RA.buildSnapshot(view, { audience, ref, amounts, asOf: view.as_of });
      const id = await S().create({ audience, audience_ref: snapshot.audience_ref, title, snapshot, user: u, now: nowIso(), expires_at: expires });
      log(req, 'roadmap_published', `roadmap_publication:${id}`, { audience, ref: snapshot.audience_ref, projects: snapshot.projects.length, amounts, expires_at: expires });
      if (govStore && govStore.ppmEvent) await govStore.ppmEvent({ entity: 'roadmap_publication', entity_id: id, action: 'published', field: 'audience', new_value: `${audience}${snapshot.audience_ref != null ? ':' + snapshot.audience_ref : ''}`, note: `${snapshot.projects.length} project(s)${amounts ? ', with amounts' : ''}` }, u).catch(() => {});
      res.json({ ok: true, id, projects: snapshot.projects.length, has_amounts: snapshot.has_amounts, expires_at: expires });
    } catch (e) { httpFail(res, e, e.status === 400 ? 400 : undefined, { ok: false, ...(e.reason ? { code: e.reason } : {}) }); }
  });

  router.get('/api/governance/roadmap-publications/:id', requireReportSession, async (req, res) => {
    try {
      if (!(await on(res))) return;
      if (!Number.isInteger(Number(req.params.id))) return notFound(res);
      const u = req.reportUser, p = await S().get(req.params.id);
      if (!p || !RA.canRead(u, p, roles(u))) return notFound(res);   // out of audience, expired or revoked = does not exist
      const { snapshot, ...meta } = p;
      res.json({ ok: true, publication: { ...meta, live: true }, roadmap: RA.visible(snapshot, { money: moneyReader(u) }) });
    } catch (e) { httpFail(res, e, undefined, { ok: false }); }
  });

  router.post('/api/governance/roadmap-publications/:id/revoke', requireReportSession, async (req, res) => {
    try {
      if (!(await on(res))) return;
      const u = req.reportUser, p = Number.isInteger(Number(req.params.id)) ? await S().get(req.params.id) : null;
      if (!p || !(RA.canRead(u, p, roles(u)) || mayManage(u, p))) return notFound(res);
      if (!mayManage(u, p)) return httpFail(res, new Error('only the publisher or the committee revokes a publication'), 403, { ok: false });
      await S().revoke(p.id, u, nowIso());
      log(req, 'roadmap_publication_revoked', `roadmap_publication:${p.id}`);
      res.json({ ok: true });
    } catch (e) { httpFail(res, e, undefined, { ok: false }); }
  });

  router.post('/api/governance/roadmap-publications/:id/share', requireReportSession, json, async (req, res) => {
    try {
      if (!(await on(res))) return;
      const u = req.reportUser, p = Number.isInteger(Number(req.params.id)) ? await S().get(req.params.id) : null;
      if (!p || !RA.canRead(u, p, roles(u))) return notFound(res);
      if (!mayManage(u, p)) return httpFail(res, new Error('only the publisher or the committee shares a publication'), 403, { ok: false });
      if (!RA.shareable(p)) return httpFail(res, new Error('a committee or exec roadmap is read in the application only — no public link'), 403, { ok: false, code: 'NOT_SHAREABLE' });
      const ttl = RA.shareTtlHours(p, req.body && req.body.ttl_hours);
      if (ttl == null) return notFound(res);
      const es = require('../services/engagementStore').makeEngagementStore({ prepare: (sql) => rdb().pgHandle().prepare(sql) }, { isPg: true });
      const l = await es.createShareLink({ targetKind: 'roadmap_publication', targetKey: String(p.id), siteId: p.audience === 'site' ? p.audience_ref : null, label: p.title, ttlHours: ttl, user: u });
      const base = String((await reportConfig.getConfig(rdb().db)).public_base_url || '');
      log(req, 'share_link_created', l.id, { kind: 'roadmap_publication', key: String(p.id) });
      res.json({ ok: true, id: l.id, token: l.token, url: `${base}/share/${l.token}`, expires_at: l.expires_at });
    } catch (e) { httpFail(res, e, undefined, { ok: false }); }
  });
};

/** For the public /share/:token view (routes/engagement.js): the HTML of a live publication, or null. Never an amount. */
module.exports.sharedHtml = async function sharedHtml(H, id, { enabled } = {}) {
  if (!enabled) return null;
  const p = await makeStore(H).get(id);
  if (!p || !RA.isLive(p) || !RA.shareable(p)) return null;
  return RA.renderHtml(p, p.snapshot);
};
module.exports.makeStore = makeStore;
