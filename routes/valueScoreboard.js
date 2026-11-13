'use strict';
// D2 (P10) — Value scoreboard (admin-only, read-only figures). DI factory like routes/connectorHealth.js.
//
//   GET  /value-scoreboard.html                 the page (sendHtmlPage — nonce + ?v=), auth.js gate admin
//   GET  /api/value-scoreboard                  metrics (services/valueScoreboard) — admin tier; site rows limited to the
//                                               reader's own sites below super_admin (a site-less admin sees fleet-only rows)
//   GET  /api/value-scoreboard/rollouts?days=   config_changed journal × stored snapshots → before / after per switch flip
//   POST /api/value-scoreboard/snapshot         {config_event_id?, note?} — stores today's FLEET values (super_admin)
// Behind report_config value_scoreboard_enabled ('0' = today: every route 404s, nothing is written).
const { fail } = require('../services/httpError');
const userSites = require('../services/userSites');

module.exports = function valueScoreboardRoutes(deps) {
  const { express, requireReportSession, sendHtmlPage } = deps;
  const router = express.Router();
  const rdb = () => deps.rdb || require('../reports-db');
  const cfgOf = async () => (deps.getConfig ? deps.getConfig() : require('../services/reportConfig').getConfig(rdb().db));
  const has = (u, r) => { try { return !!rdb().userHasRole(u, r); } catch (_) { return false; } };
  const V = require('../services/valueScoreboard');

  /** 404 while the switch is off, 403 below the admin tier; returns the config when the caller may proceed. */
  async function gate(req, res, { superOnly = false } = {}) {
    const cfg = (await cfgOf()) || {};
    if (String(cfg.value_scoreboard_enabled) !== '1') { fail(res, new Error('value scoreboard is not enabled'), 404, { ok: false }); return null; }
    if (!has(req.reportUser, superOnly ? 'super_admin' : 'admin')) { fail(res, new Error(superOnly ? 'super_admin role required' : 'Admin role required'), 403, { ok: false }); return null; }
    return cfg;
  }
  const allowedOf = (u) => (has(u, 'super_admin') ? null : userSites.siteIds(u));
  const board = async (cfg, u, today) => {
    const allowed = allowedOf(u);
    const readings = await require('../services/valueScoreboardData').gather({ rdb: rdb() }, { allowed, today, cfg });
    return V.assemble(readings);
  };

  router.get('/value-scoreboard.html', (req, res) => sendHtmlPage(res, 'value-scoreboard.html', false, 'Value scoreboard unavailable'));

  router.get('/api/value-scoreboard', requireReportSession, async (req, res) => {
    try {
      const cfg = await gate(req, res); if (!cfg) return;
      const today = new Date().toISOString().slice(0, 10);
      res.json({ ok: true, as_of: today, ...(await board(cfg, req.reportUser, today)) });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  router.get('/api/value-scoreboard/rollouts', requireReportSession, async (req, res) => {
    try {
      const cfg = await gate(req, res); if (!cfg) return;
      const days = Math.max(1, Math.min(90, Number.parseInt(req.query.days, 10) || 30));
      const R = rdb();
      const { rows } = await R.listSystemLog({ category: 'config', action: 'config_changed' }, { limit: 200 });
      const events = require('../services/configJournal').historyRows(rows).map((r, i) => ({ id: rows[i] && rows[i].id, key: r.key, from: r.from, to: r.to, ts: r.ts }));
      const snaps = (await R.pgHandle().prepare('SELECT id, taken_at, config_event_id, config_key, note, metrics_json FROM value_scoreboard_snapshots ORDER BY taken_at DESC LIMIT 500').all())
        .map((s) => { let m = {}; try { m = JSON.parse(s.metrics_json); } catch (_) { m = {}; } return { id: Number(s.id), taken_at: s.taken_at, config_event_id: s.config_event_id == null ? null : Number(s.config_event_id), config_key: s.config_key, note: s.note, metrics: m }; });
      res.json({ ok: true, window_days: days, rollouts: V.compareRollouts(events, snaps, { windowDays: days }),
        snapshots: snaps.slice(0, 50).map(({ metrics, ...s }) => s) });   // eslint-disable-line no-unused-vars
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  router.post('/api/value-scoreboard/snapshot', requireReportSession, express.json(), async (req, res) => {
    try {
      const cfg = await gate(req, res, { superOnly: true }); if (!cfg) return;
      const b = req.body || {};
      const today = new Date().toISOString();
      const values = V.snapshotValues(await board(cfg, req.reportUser, today.slice(0, 10)));   // super_admin → fleet values
      const ev = b.config_event_id == null || b.config_event_id === '' ? null : Number(b.config_event_id);
      if (ev != null && !Number.isInteger(ev)) return fail(res, new Error('config_event_id must be an integer'), 400, { ok: false });
      const key = b.config_key ? String(b.config_key).slice(0, 80) : null;
      const note = b.note ? String(b.note).slice(0, 500) : null;
      const u = req.reportUser;
      const row = await rdb().pgHandle().prepare('INSERT INTO value_scoreboard_snapshots (taken_at, config_event_id, config_key, note, metrics_json, taken_by, taken_by_name) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
        .get(today, ev, key, note, JSON.stringify(values), u && u.id != null ? Number(u.id) : null, u ? String(u.username || '') : null);
      try { rdb().logEvent({ category: 'ops', action: 'value_snapshot_taken', target: key || 'manual', actor: u && u.username, actor_id: u && u.id, details: { id: row && row.id, config_event_id: ev } }); } catch (_) { /* never blocks */ }
      res.status(201).json({ ok: true, id: row ? Number(row.id) : null, taken_at: today, metrics: values });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  return router;
};
