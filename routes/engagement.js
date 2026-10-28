'use strict';
const { fail: httpFail } = require('../services/httpError');
// Step 9 — engagement: notification centre, comments, subscriptions, alert rules (admin), share
// links with read receipts, public signed share / embed views, API consumers (admin).
//
//   GET  /api/engagement/notifications[?unread=1] · GET /notifications/count · POST /notifications/read { ids | all }
//   GET/POST /api/engagement/comments?source_kind=&source_ref=            comment from a notification
//   GET/POST /api/engagement/subscriptions · DELETE /subscriptions/:id
//   GET  /api/engagement/rules (any) · PUT /rules · DELETE /rules/:key · POST /rules/evaluate (run now)       admin
//   GET  /api/engagement/firings · PUT /firings/:id { false_positive, note } · GET /stats                      admin
//   POST /api/engagement/share { target_kind, target_key, site_id, ttl_hours, max_views, embed, label } → token (shown once)
//   GET  /api/engagement/share (mine, admins all) · DELETE /share/:id · GET /share/:id/receipts
//   GET  /share/:token            PUBLIC (no session) read-only view, expiring, receipt recorded; ?embed=1 for an iframe
//   GET/POST /api/engagement/consumers · DELETE /consumers/:id · GET /consumers/stats                          admin
// Share links: a dashboard of one of the creator's sites, or a PUBLISHED report run. Tokens are hashed at rest.

const { resolveWidgets } = require('../services/dashboardData');
const { analyse } = require('../services/reportAnalysis');
const { renderHtml } = require('../services/reportPack');

function createStore(rdbMod) {
  const pg = rdbMod.REPORTS_BACKEND === 'postgres';
  const st = require('../services/engagementStore').makeEngagementStore(({ prepare: (sql) => rdbMod.pgHandle().prepare(sql) }), { isPg: pg });
  const { SEED_RULES } = require('../services/alertRulesSeed');
  
  st.seedAtBoot = async () => {
                                await st.init(); return st.seedRules(SEED_RULES);
                              };
  return st;
}

module.exports = function engagementRoutes(deps) {
  const { express, requireReportSession, store, dashStore, reportStore } = deps;
  const router = express.Router(); const json = express.json({ limit: '256kb' });
  const rdb = () => deps.rdb || require('../reports-db');
  const registry = () => deps.registry || require('../services/metricRegistry').current();
  const reportConfig = deps.reportConfig || require('../services/reportConfig');
  const userSites = require('../services/userSites');
  const readerDeps = () => deps.readerDeps || { rdb: rdb(), mdb: require('../meetings-db'), idb: require('../inspection-db'), adb: require('../assets-db'), tracker: require('../tracker-db'), trackerScore: require('../tracker-pptx') };
  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  const requireAdmin = (req, res, next) => isAdmin(req.reportUser) ? next() : res.status(403).json({ ok: false, error: 'admin role required' });
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false });
  const log = (req, action, target, details) => { try { rdb().logEvent({ category: 'engagement', action, target: String(target), details, ...rdb()._logCtx(req) }); } catch (_) {} };
  const cfg = async () => { try { return await reportConfig.getConfig(rdb().db); } catch (_) { return {}; } };

  // ── notifications ───────────────────────────────────────────────────────────────
  router.get('/api/engagement/notifications', requireReportSession, async (req, res) => { try { res.json({ ok: true, notifications: await store.listNotifications(req.reportUser.id, { unreadOnly: req.query.unread === '1', limit: req.query.limit }), unread: await store.unreadCount(req.reportUser.id) }); } catch (e) { fail(res, e); } });
  router.get('/api/engagement/notifications/count', requireReportSession, async (req, res) => { try { res.json({ ok: true, unread: await store.unreadCount(req.reportUser.id) }); } catch (e) { fail(res, e); } });
  router.post('/api/engagement/notifications/read', requireReportSession, json, async (req, res) => { try { const n = req.body && req.body.all ? await store.markAllRead(req.reportUser.id) : await store.markRead(req.reportUser.id, (req.body && req.body.ids) || []); res.json({ ok: true, marked: n, unread: await store.unreadCount(req.reportUser.id) }); } catch (e) { fail(res, e); } });
  router.get('/api/engagement/comments', requireReportSession, async (req, res) => { try { res.json({ ok: true, comments: await store.listComments(String(req.query.source_kind || ''), String(req.query.source_ref || '')) }); } catch (e) { fail(res, e); } });
  router.post('/api/engagement/comments', requireReportSession, json, async (req, res) => { try { const c = await store.addComment({ sourceKind: req.body && req.body.source_kind, sourceRef: req.body && req.body.source_ref, user: req.reportUser, body: req.body && req.body.body }); log(req, 'comment_added', `${req.body.source_kind}:${req.body.source_ref}`); res.json({ ok: true, comment: c }); } catch (e) { fail(res, e); } });

  // ── subscriptions ───────────────────────────────────────────────────────────────
  router.get('/api/engagement/subscriptions', requireReportSession, async (req, res) => { try { res.json({ ok: true, subscriptions: await store.listSubscriptions(req.reportUser.id), kinds: store.SUB_KINDS, channels: store.CHANNELS, digests: store.DIGESTS }); } catch (e) { fail(res, e); } });
  router.post('/api/engagement/subscriptions', requireReportSession, json, async (req, res) => { try { const id = await store.subscribe(req.reportUser.id, req.body || {}); res.json({ ok: true, id, subscriptions: await store.listSubscriptions(req.reportUser.id) }); } catch (e) { fail(res, e); } });
  router.delete('/api/engagement/subscriptions/:id', requireReportSession, async (req, res) => { try { await store.unsubscribe(req.reportUser.id, req.params.id); res.json({ ok: true }); } catch (e) { fail(res, e); } });

  // ── alert rules (admin) ─────────────────────────────────────────────────────────
  router.get('/api/engagement/rules', requireReportSession, async (req, res) => { try { res.json({ ok: true, admin: isAdmin(req.reportUser), rules: await store.listRules(), operators: require('../services/alertEngine').OPERATORS, channels: store.CHANNELS, metrics: registry().list({ status: 'published' }).map(m => ({ key: m.key, name: m.name, unit: m.unit, window_kind: m.window_kind })) }); } catch (e) { fail(res, e); } });
  router.put('/api/engagement/rules', requireReportSession, requireAdmin, json, async (req, res) => { try { if (req.body && req.body.metric && !registry().has(req.body.metric)) return res.status(400).json({ ok: false, error: 'unknown metric' }); const r = await store.saveRule(req.body, { user: req.reportUser }); log(req, 'alert_rule_saved', r.key); res.json({ ok: true, rule: r }); } catch (e) { fail(res, e); } });
  router.delete('/api/engagement/rules/:key', requireReportSession, requireAdmin, async (req, res) => { try { await store.removeRule(req.params.key); log(req, 'alert_rule_removed', req.params.key); res.json({ ok: true }); } catch (e) { fail(res, e); } });
  router.post('/api/engagement/rules/evaluate', requireReportSession, requireAdmin, async (req, res) => {
    try { const c = await cfg(); const { evaluateAlerts } = require('../services/engagementJobs'); const { buildMailer } = require('../services/mailer');
      const r = await evaluateAlerts({ store, registry: registry(), deps: readerDeps(), rdb: rdb(), mailer: c.smtp_host ? buildMailer(c) : null, post: deps.post || require('../services/engagementJobs').safePostFor(c), cfg: c, baseUrl: c.public_base_url || '' });
      log(req, 'alerts_evaluated', 'manual', r); res.json({ ok: true, ...r }); } catch (e) { fail(res, e); }
  });
  router.get('/api/engagement/firings', requireReportSession, requireAdmin, async (req, res) => { try { res.json({ ok: true, firings: await store.listFirings({ limit: req.query.limit, since: req.query.since || null }) }); } catch (e) { fail(res, e); } });
  router.put('/api/engagement/firings/:id', requireReportSession, requireAdmin, json, async (req, res) => { try { await store.markFalsePositive(req.params.id, { fp: req.body && req.body.false_positive !== false, note: req.body && req.body.note }); log(req, 'alert_firing_reviewed', req.params.id, { false_positive: req.body && req.body.false_positive !== false }); res.json({ ok: true }); } catch (e) { fail(res, e); } });
  router.get('/api/engagement/stats', requireReportSession, requireAdmin, async (req, res) => { try { res.json({ ok: true, alerts: await store.firingStats({ since: new Date(Date.now() - 30 * 864e5).toISOString() }), rules_live: (await store.listRules({ includeDisabled: false })).length, reports: reportStore ? await reportStore.ratingStats() : null, api: await store.callStats({ days: 7 }) }); } catch (e) { fail(res, e); } });

  // ── share links ─────────────────────────────────────────────────────────────────
  router.post('/api/engagement/share', requireReportSession, json, async (req, res) => {
    try { const u = req.reportUser; const b = req.body || {};
      if (!rdb().userHasRole(u, 'editor')) return res.status(403).json({ ok: false, error: 'editor role required' });
      let siteId = b.site_id == null || b.site_id === '' ? null : Number(b.site_id);
      if (b.target_kind === 'dashboard') { if (!dashStore || !(await dashStore.published(b.target_key))) return res.status(400).json({ ok: false, error: 'dashboard has no published version' }); if (!isAdmin(u)) { const mine = userSites.siteIds(u).map(Number); if (siteId == null) siteId = mine[0]; if (siteId == null || !mine.includes(siteId)) return res.status(403).json({ ok: false, error: 'site not in your scope' }); } }
      else if (b.target_kind === 'report_run') { const r = reportStore ? await reportStore.getRun(b.target_key) : null; if (!r || r.status !== 'published') return res.status(400).json({ ok: false, error: 'only a published report run can be shared' }); if (!isAdmin(u) && r.site_id != null && !userSites.hasSite(u, r.site_id)) return res.status(403).json({ ok: false, error: 'run belongs to another site' }); siteId = r.site_id; }
      const l = await store.createShareLink({ targetKind: b.target_kind, targetKey: b.target_key, siteId, label: b.label, embed: !!b.embed, ttlHours: b.ttl_hours, maxViews: b.max_views, user: u });
      const base = String((await cfg()).public_base_url || ''); log(req, 'share_link_created', l.id, { kind: b.target_kind, key: String(b.target_key), embed: !!b.embed });
      res.json({ ok: true, id: l.id, token: l.token, url: `${base}/share/${l.token}${b.embed ? '?embed=1' : ''}`, expires_at: l.expires_at }); } catch (e) { fail(res, e); }
  });
  router.get('/api/engagement/share', requireReportSession, async (req, res) => { try { res.json({ ok: true, links: await store.listShareLinks({ userId: isAdmin(req.reportUser) ? null : req.reportUser.id }) }); } catch (e) { fail(res, e); } });
  router.delete('/api/engagement/share/:id', requireReportSession, async (req, res) => { try { const mine = await store.listShareLinks({ userId: isAdmin(req.reportUser) ? null : req.reportUser.id }); if (!mine.some(l => l.id === Number(req.params.id))) return res.status(404).json({ ok: false, error: 'link not found' }); await store.revokeShareLink(req.params.id); log(req, 'share_link_revoked', req.params.id); res.json({ ok: true }); } catch (e) { fail(res, e); } });
  router.get('/api/engagement/share/:id/receipts', requireReportSession, async (req, res) => { try { const mine = await store.listShareLinks({ userId: isAdmin(req.reportUser) ? null : req.reportUser.id }); if (!mine.some(l => l.id === Number(req.params.id))) return res.status(404).json({ ok: false, error: 'link not found' }); res.json({ ok: true, receipts: await store.shareReceipts(req.params.id) }); } catch (e) { fail(res, e); } });

  // PUBLIC share / embed view — token in the path, never a session. Expired / revoked / exhausted → 404.
  router.get('/share/:token', async (req, res) => {
    try {
      const l = await store.openShareLink(String(req.params.token || ''), { agent: req.headers['user-agent'], ip: req.ip });
      if (!l) return res.status(404).type('html').send('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Link expired</title></head><body style="font-family:Calibri,Arial"><h1>This link has expired or was revoked.</h1><p>Ask the person who shared it for a new one.</p></body></html>');
      const c = await cfg(); let html = '';
      if (l.target_kind === 'report_run') { const r = reportStore ? await reportStore.getRun(l.target_key) : null; if (!r || r.status !== 'published') return res.status(404).send('Report no longer available'); html = r.html || ''; }
      else {
        const d = dashStore ? await dashStore.published(l.target_key) : null; if (!d) return res.status(404).send('Dashboard no longer available');
        const sites = ((await rdb().listSites({ includeInactive: false })) || []).map(s => ({ id: Number(s.id), name: s.name })); const site = l.site_id != null ? sites.find(s => s.id === l.site_id) : null;
        const now = new Date(); const widgets = await resolveWidgets({ def: d.definition, sites: site ? [site] : sites, site: site ? site.id : (sites[0] && sites[0].id), window: null, reg: registry(), dd: readerDeps(), rdb: rdb(), now });
        const a = analyse({ widgets, audience: d.definition.audience === 'executive' ? 'executive' : 'site', lang: 'en', siteName: site ? site.name : null, registry: registry() });
        html = renderHtml({ template: { name: d.definition.title || d.key, lang: 'en', dashboard_key: d.key, sections: ['headline', 'figures', 'analysis'] }, run: { status: 'published', window_label: null, created_at: now.toISOString(), figures: a.figures, analysis: { ...a, figures: undefined }, commentary: null }, siteName: site ? site.name : null, baseUrl: '' });
      }
      const embed = l.embed && req.query.embed === '1';
      if (embed) { res.removeHeader('X-Frame-Options'); res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors ${String(c.embed_frame_ancestors || '').trim() || "'self'"}`); }
      res.setHeader('Cache-Control', 'no-store'); /* E5: the global CSP is nonce-only on /share/ and shared HTML carries no script — none is ever nonced here */ res.type('html').send(html.replace('</body>', `<p style="font-family:Calibri,Arial;font-size:11px;color:#6b7785">Shared read-only view · expires ${String(l.expires_at).slice(0, 16).replace('T', ' ')} UTC${l.max_views ? ` · ${l.views}/${l.max_views} views` : ''}</p></body>`));
    } catch (e) { res.status(500).send('Share view failed'); }
  });

  // ── API consumers (admin) ────────────────────────────────────────────────────────
  router.get('/api/engagement/consumers', requireReportSession, requireAdmin, async (req, res) => { try { res.json({ ok: true, consumers: await store.listConsumers(), scopes: store.SCOPES, stats: await store.callStats({ days: 7 }) }); } catch (e) { fail(res, e); } });
  router.post('/api/engagement/consumers', requireReportSession, requireAdmin, json, async (req, res) => { try { const c = await store.createConsumer({ name: req.body && req.body.name, scopes: req.body && req.body.scopes, quotaPerDay: req.body && req.body.quota_per_day, user: req.reportUser }); log(req, 'api_consumer_created', c.id, { name: req.body && req.body.name }); res.json({ ok: true, id: c.id, key: c.key, hint: c.hint, note: 'the key is shown once — store it in the consumer\'s secret store' }); } catch (e) { fail(res, e); } });
  router.delete('/api/engagement/consumers/:id', requireReportSession, requireAdmin, async (req, res) => { try { await store.revokeConsumer(req.params.id); log(req, 'api_consumer_revoked', req.params.id); res.json({ ok: true }); } catch (e) { fail(res, e); } });
  return router;
};
module.exports.createStore = createStore;
