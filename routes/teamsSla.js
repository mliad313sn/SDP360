'use strict';
// Teams SLA alerts (2026-10-03) — admin routes, super_admin only. Webhook URLs and the
// SDP API secrets are WRITE-ONLY: GET says which groups are mapped and whether a secret
// is set, never the value (a webhook URL lets anyone post in the channel).
// DI factory like routes/roadmap.js: server.js passes { express, requireReportSession, requireSuperAdmin }.
module.exports = function teamsSlaRoutes(deps) {
  const { express, requireReportSession, requireSuperAdmin } = deps;
  const router = express.Router();
  const rdb = require('../reports-db');
  const reportConfig = require('../services/reportConfig');
  const S = require('../services/teamsSla');
  const poll = require('../tools/teams/poll-sla');
  const safeUrl = require('../services/safeUrl');   // M4 — outbound URL guard (save + test card)
  const jsonBody = express.json({ limit: '200kb' });
  const guard = [requireReportSession, requireSuperAdmin];

  // SDP groups seen on tickets of the last 90 days — helps the admin type the exact names.
  async function knownGroups() {
    const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const SQL = `SELECT DISTINCT tech_group AS g FROM request_records
                  WHERE tech_group IS NOT NULL AND tech_group <> '' AND substr(created_time, 1, 10) >= ?`;
    const H = rdb.REPORTS_BACKEND === 'postgres' ? rdb.pgHandle() : rdb.db;
    const rows = await H.prepare(SQL).all(since);
    return [...new Set(rows.flatMap(r => String(r.g).split(',').map(s => s.trim())).filter(Boolean))].sort();
  }

  router.get('/api/teams-sla/settings', ...guard, async (req, res) => {
    try {
      const c = await reportConfig.getConfig(rdb.db);
      let groups = [];
      try { groups = await knownGroups(); } catch (e) { /* best-effort */ }
      res.json({
        enabled: String(c.teams_sla_enabled) === '1',
        rules: S.parseRules(c.teams_sla_rules),
        sdp_api_base_url: c.sdp_api_base_url, sdp_api_accounts_url: c.sdp_api_accounts_url,
        sdp_api_client_id: c.sdp_api_client_id, sdp_api_open_filter: c.sdp_api_open_filter,
        has_client_secret: !!c.sdp_api_client_secret, has_refresh_token: !!c.sdp_api_refresh_token,
        channels: S.parseChannels(c.teams_sla_channels).map(ch => ({ group: ch.group, configured: true })),
        known_groups: groups,
        last_run: c.teams_sla_last_run || null,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/api/teams-sla/settings', ...guard, jsonBody, async (req, res) => {
    try {
      const b = req.body || {};
      const cur = await reportConfig.getConfig(rdb.db);
      const patch = {};
      const allow = safeUrl.allowHostsFromConfig(cur);
      const urlLog = [];   // M4 — [target, from, to] rows journalled after the save (scheme+host only)
      if ('enabled' in b) patch.teams_sla_enabled = b.enabled ? '1' : '0';
      for (const k of ['sdp_api_base_url', 'sdp_api_accounts_url', 'sdp_api_client_id', 'sdp_api_open_filter']) {
        if (k in b) patch[k] = String(b[k] == null ? '' : b[k]).trim();
      }
      // M4 — a changed, non-blank API base URL must pass the outbound guard (https, no private address).
      for (const k of ['sdp_api_base_url', 'sdp_api_accounts_url']) {
        if (k in patch && patch[k] && patch[k] !== String(cur[k] || '').trim()) {
          try { await safeUrl.validateOutboundUrl(patch[k], { allowHosts: allow }); }
          catch (e) { return res.status(400).json({ error: `${k}: ${e.message}` }); }
          urlLog.push([k, cur[k], patch[k]]);
        }
      }
      // blank = keep (reportConfig drops a blank secret on its own)
      for (const k of ['sdp_api_client_secret', 'sdp_api_refresh_token']) if (k in b) patch[k] = String(b[k] == null ? '' : b[k]).trim();
      if ('rules' in b) {
        let r = b.rules;
        if (typeof r === 'string' && r.trim()) { try { r = JSON.parse(r); } catch (e) { return res.status(400).json({ error: 'Règles : JSON invalide' }); } }
        patch.teams_sla_rules = r && typeof r === 'object' ? JSON.stringify(S.parseRules(r)) : '';
      }
      if ('channels' in b) {
        if (!Array.isArray(b.channels)) return res.status(400).json({ error: 'channels doit être une liste' });
        const prev = S.parseChannels(cur.teams_sla_channels);
        const next = [];
        for (const ch of b.channels) {
          const group = String((ch && ch.group) || '').trim();
          const url = String((ch && ch.url) || '').trim();
          if (!group) continue;
          if (next.some(n => n.group.toLowerCase() === group.toLowerCase())) return res.status(400).json({ error: `Groupe en double : ${group}` });
          if (url) {
            if (!/^https:\/\/\S+$/i.test(url)) return res.status(400).json({ error: `URL du webhook invalide pour ${group} (https:// requis)` });
            // M4 — refuse a webhook that points inside the network (SSRF) before it is stored.
            const old = prev.find(p => p.group.toLowerCase() === group.toLowerCase());
            if (!old || old.url !== url) {
              try { await safeUrl.validateOutboundUrl(url, { allowHosts: allow }); }
              catch (e) { return res.status(400).json({ error: `Webhook URL for ${group}: ${e.message}` }); }
              urlLog.push([`teams_sla_channels[${group}]`, old && old.url, url]);
            }
            next.push({ group, url });
          } else {
            const old = prev.find(p => p.group.toLowerCase() === group.toLowerCase());
            if (!old) return res.status(400).json({ error: `URL du webhook manquante pour ${group}` });
            next.push({ group, url: old.url });   // blank = keep the stored URL
          }
        }
        // An empty list must be able to clear the channels: write a non-blank JSON value.
        patch.teams_sla_channels = JSON.stringify(next);
      }
      await reportConfig.setConfig(rdb.db, patch, req.reportUser && req.reportUser.username);
      for (const [target, from, to] of urlLog) {
        try { rdb.logEvent({ category: 'config', action: 'config_url_changed', target, details: { from: from ? safeUrl.redactUrl(from) : '', to: safeUrl.redactUrl(to) }, ...rdb._logCtx(req) }); } catch (_) { /* best-effort */ }
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Post a test card to one group's channel.
  router.post('/api/teams-sla/test', ...guard, jsonBody, async (req, res) => {
    try {
      const group = String((req.body && req.body.group) || '').trim();
      const c = await reportConfig.getConfig(rdb.db);
      const url = S.resolveChannel(group, S.parseChannels(c.teams_sla_channels).filter(ch => ch.group !== '*' || group === '*'));
      if (!group || !url) return res.status(404).json({ error: `Aucun canal configuré pour « ${group} »` });
      const { buildGroupCard } = require('../services/teamsCard');
      const card = buildGroupCard(group, [{ kind: 'fr_soon', request_id: '0', display_id: 'TEST', subject: 'Message de test — alertes SLA du dashboard IT OPS',
        p: 'P3', group, technician: '', minutes: 15 }], { apiBaseUrl: c.sdp_api_base_url });
      // M4 — a channel stored before the guard existed may still be private: re-check before posting.
      await safeUrl.safePost(safeUrl.allowHostsFromConfig(c), { timeout: 15000, headers: { 'Content-Type': 'application/json' } })(url, card);
      res.json({ ok: true });
    } catch (e) {
      if (e && e.code === safeUrl.UNSAFE) return res.status(400).json({ error: `Webhook URL refused: ${e.message}` });
      const st = e && e.response && e.response.status;
      res.status(502).json({ error: `Échec de l'envoi${st ? ` (HTTP ${st})` : ''} : ${String(e.message || '').replace(/https?:\/\/\S+/g, '<url>')}` });
    }
  });

  // What a pass would send right now — no post, no record, even when disarmed.
  router.post('/api/teams-sla/preview', ...guard, async (req, res) => {
    res.json(await poll.run({ dryRun: true }));
  });
  // One real pass now (respects the arm flag).
  router.post('/api/teams-sla/run', ...guard, async (req, res) => {
    res.json(await poll.run({}));
  });

  return router;
};
