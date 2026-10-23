'use strict';
// ---------------------------------------------------------------------------
// Step 9 (SDP-DASH-2.0) — engagement: alert rules, notification centre, subscriptions, delivery channels.
//
// Everyone signed in:   GET /api/notifications · GET /api/notifications/count · POST /api/notifications/read
//                       GET /api/engagement/rules (to subscribe) · GET/POST /api/engagement/subscriptions
//                       GET /api/engagement/fires/:id · POST /api/engagement/fires/:id/comments   (if notified)
// alert-manager:        GET /api/engagement/catalog · POST /api/engagement/rules · POST …/rules/:id/enable
//                       DELETE …/rules/:id · POST …/rules/:id/test · POST /api/engagement/catalogue/import
//                       GET …/rules/:id/fires (with read receipts)
// super_admin:          GET/POST/DELETE /api/engagement/channels (URLs are secrets: write-only)
//                       POST /api/engagement/evaluate (run the evaluation now)
//
// Rules are evaluated every 30 minutes by the job `engagement.evaluate` (services/sync/jobs.js); the daily digest by
// `engagement.digest`. E-mail delivery is armed by the setting `engagement_email` = 1 (Admin ▸ Rapports ▸ e-mail).
// ---------------------------------------------------------------------------
const store = require('../services/engagement/store');
const rules = require('../services/engagement/rules');
const engine = require('../services/engagement/engine');
const registry = require('../services/metrics/registry');
const live = require('../services/metrics/liveDeps');
const { AUDIENCE_ROLES } = require('../services/dashboards/definition');

/** The engine's dependencies (shared with the scheduled jobs). */
async function engineDeps(rdb, extra = {}) {
  const cfg = await require('../services/reportConfig').getConfig(rdb.db);
  const mailer = String(cfg.engagement_email || '0') === '1' ? require('../services/mailer').buildMailer(cfg) : null;
  return Object.assign({ rdb, metrics: live.liveDeps(rdb), sites: await live.groupSites(rdb), targets: await live.targets(rdb),
    syncStates: () => require('../services/sync/store').listStates(), mailer, baseUrl: String(cfg.public_base_url || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') }, extra);
}

function engagementRoutes(d) {
  const { express, rdb, requireReportSession, requireRole } = d;
  const router = express.Router();
  const MANAGER = requireRole(['alert-manager', 'super_admin']);
  const SUPER = requireRole(['super_admin']);
  const has = (u, r) => rdb.userHasRole(u, r);
  const me = (req) => String(req.reportUser.username);
  const isManager = (u) => has(u, 'alert-manager') || has(u, 'super_admin');
  const served = () => new Set(registry.list().filter(m => m.serve).map(m => m.key));
  const log = (req, action, target, details) => { try { rdb.logEvent({ category: 'engagement', action, target, details, ...rdb._logCtx(req) }); } catch (_) {} };
  const deps = (extra) => (d.engagementDeps ? Promise.resolve(Object.assign({}, d.engagementDeps, extra)) : engineDeps(rdb, extra));

  // ── Notification centre (self) ─────────────────────────────────────────
  router.get('/api/notifications', requireReportSession, async (req, res) => {
    try { res.json({ notifications: await store.listNotifications(me(req), { unread: req.query.unread === '1' }), unread: await store.unreadCount(me(req)) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/api/notifications/count', requireReportSession, async (req, res) => {
    try { res.json({ unread: await store.unreadCount(me(req)) }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/notifications/read', requireReportSession, async (req, res) => {
    try {
      const ids = (req.body || {}).ids;
      await store.markRead(me(req), ids === 'all' ? 'all' : (Array.isArray(ids) ? ids.slice(0, 500).map(String) : []));
      res.json({ unread: await store.unreadCount(me(req)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // A fired alert: its discussion is open to the people it notified and to the alert managers.
  async function fireAccess(req, res) {
    const f = await store.getFire(String(req.params.id));
    if (!f) { res.status(404).json({ error: 'Alert not found' }); return null; }
    const mine = (await store.receipts(f.id)).some(r => r.username === me(req));
    if (!mine && !isManager(req.reportUser)) { res.status(403).json({ error: 'This alert was not sent to you.' }); return null; }
    return f;
  }
  router.get('/api/engagement/fires/:id', requireReportSession, async (req, res) => {
    try {
      const f = await fireAccess(req, res); if (!f) return;
      const rule = await store.getRule(f.rule_id);
      await store.markRead(me(req), (await store.listNotifications(me(req), { limit: 500 })).filter(n => n.fire_id === f.id).map(n => n.id));
      res.json({ fire: { ...f, value: f.value == null ? null : Number(f.value) }, rule: rule ? { id: rule.id, title: rule.title, kind: rule.kind, config: rule.config } : null,
        comments: await store.comments(f.id), receipts: isManager(req.reportUser) ? await store.receipts(f.id) : undefined });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/engagement/fires/:id/comments', requireReportSession, async (req, res) => {
    try {
      const f = await fireAccess(req, res); if (!f) return;
      const text = String((req.body || {}).text || '').trim();
      if (!text) return res.status(400).json({ error: 'The comment is empty.' });
      await store.addComment(f.id, me(req), text);
      log(req, 'alert_commented', f.id);
      res.status(201).json({ comments: await store.comments(f.id) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Rules and subscriptions ────────────────────────────────────────────
  router.get('/api/engagement/rules', requireReportSession, async (req, res) => {
    try {
      const manager = isManager(req.reportUser);
      const list = await store.listRules();
      const out = [];
      for (const r of list) {
        if (!r.enabled && !manager) continue;
        const st = await store.getState(r.id);
        out.push(manager ? { ...r, state: st } : { id: r.id, title: r.title, kind: r.kind, enabled: r.enabled, firing: st.firing });
      }
      res.json({ rules: out, manager, subscriptions: await store.subscriptions(me(req)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/engagement/subscriptions', requireReportSession, async (req, res) => {
    try {
      const b = req.body || {}, rule = await store.getRule(String(b.rule_id || ''));
      if (!rule || (!rule.enabled && !isManager(req.reportUser))) return res.status(404).json({ error: 'Rule not found' });
      const channel = b.channel === 'email' ? 'email' : 'inapp';
      await store.setSubscription(me(req), rule.id, channel, b.on !== false);
      res.json({ subscriptions: await store.subscriptions(me(req)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/engagement/catalog', requireReportSession, MANAGER, async (req, res) => {
    try {
      const sites = await live.groupSites(rdb);
      res.json({ kinds: rules.KINDS, ops: rules.OPS, channels: rules.CHANNELS, age_days: rules.AGE_DAYS, roles: AUDIENCE_ROLES.filter(r => r !== 'any'),
        sites: sites.filter(s => s.code).map(s => ({ code: s.code, name: s.name })), channel_list: await store.listChannels(),
        metrics: registry.list().filter(m => m.serve).map(m => ({ key: m.key, fr: m.fr, unit: m.unit })), catalogue: rules.CATALOGUE });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  async function validRule(body) {
    const sites = await live.groupSites(rdb);
    const v = rules.validate(body, { servedMetrics: served(), siteCodes: new Set(sites.map(s => s.code).filter(Boolean)) });
    if (v.ok && v.rule.channel_id && !(await store.listChannels()).some(c => c.id === v.rule.channel_id)) { v.ok = false; v.errors.push('channel_id: unknown channel'); }
    return v;
  }
  router.post('/api/engagement/rules', requireReportSession, MANAGER, async (req, res) => {
    try {
      const v = await validRule(req.body || {});
      if (!v.ok) return res.status(400).json({ error: 'Invalid rule', details: v.errors });
      const r = await store.saveRule(v.rule, me(req));
      log(req, 'alert_rule_saved', r.id, { enabled: r.enabled });
      res.json({ rule: r });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/engagement/rules/:id/enable', requireReportSession, MANAGER, async (req, res) => {
    try {
      const r = await store.getRule(String(req.params.id));
      if (!r) return res.status(404).json({ error: 'Rule not found' });
      const saved = await store.saveRule({ ...r, enabled: (req.body || {}).enabled !== false }, me(req));
      log(req, saved.enabled ? 'alert_rule_enabled' : 'alert_rule_disabled', r.id);
      res.json({ rule: saved });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/api/engagement/rules/:id', requireReportSession, MANAGER, async (req, res) => {
    try { await store.deleteRule(String(req.params.id)); log(req, 'alert_rule_deleted', String(req.params.id)); res.json({ deleted: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/engagement/rules/:id/test', requireReportSession, MANAGER, async (req, res) => {
    try {
      const r = await store.getRule(String(req.params.id));
      if (!r) return res.status(404).json({ error: 'Rule not found' });
      const value = await engine.measure(r, await deps());
      res.json({ value, breach: rules.breaches(r, value), message: value == null ? 'Non mesuré : la règle ne se déclencherait pas.' : rules.message(r, value) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/engagement/catalogue/import', requireReportSession, MANAGER, async (req, res) => {
    try {
      let added = 0;
      for (const c of rules.CATALOGUE) { if (await store.getRule(c.id)) continue; const v = await validRule(c); if (v.ok) { await store.saveRule(v.rule, me(req)); added++; } }
      log(req, 'alert_catalogue_imported', 'catalogue', { added });
      res.json({ added, total: rules.CATALOGUE.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/api/engagement/rules/:id/fires', requireReportSession, MANAGER, async (req, res) => {
    try {
      const fires = await store.listFires(String(req.params.id));
      const out = [];
      for (const f of fires) { const r = await store.receipts(f.id); out.push({ ...f, value: f.value == null ? null : Number(f.value), notified: r.length, read: r.filter(x => x.read_at).length }); }
      res.json({ fires: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Channels (secrets) and manual run ──────────────────────────────────
  router.get('/api/engagement/channels', requireReportSession, MANAGER, async (req, res) => {
    try { res.json({ channels: await store.listChannels() }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/engagement/channels', requireReportSession, SUPER, async (req, res) => {
    try {
      const b = req.body || {};
      const name = String(b.name || '').trim().slice(0, 80), kind = b.kind === 'webhook' ? 'webhook' : 'teams', url = String(b.url || '').trim();
      if (!name) return res.status(400).json({ error: 'Name the channel.' });
      if (!/^https:\/\/[^\s]+$/i.test(url) || url.length > 2000) return res.status(400).json({ error: 'The address must be an https:// URL.' });
      const id = await store.addChannel({ name, kind, url, signingSecret: b.signing_secret ? String(b.signing_secret).slice(0, 200) : null }, me(req));
      log(req, 'alert_channel_added', id, { kind });   // never the URL
      res.status(201).json({ id, channels: await store.listChannels() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/api/engagement/channels/:id', requireReportSession, SUPER, async (req, res) => {
    try { await store.deleteChannel(String(req.params.id)); log(req, 'alert_channel_deleted', String(req.params.id)); res.json({ channels: await store.listChannels() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/api/engagement/evaluate', requireReportSession, SUPER, async (req, res) => {
    try { res.json(await engine.evaluateAll(await deps())); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

module.exports = engagementRoutes;
module.exports.engineDeps = engineDeps;
