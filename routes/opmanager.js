'use strict';
// V1a — OPManager infrastructure availability READ API. Serves the snapshots the sync
// composed from the prepared Analytics view; OPS never polls devices. DI factory like
// routes/meridian.js: server.js passes { express, requireReportSession, requireAdmin,
// fetchView }. Every getSiteIdByModuleCode/getInfraSnapshots/getConfig/listSites call is
// AWAITED — all return Promises on postgres (prod). Absence is rendered as
// {metric_value:null, status_color:'none'}, NEVER 0. Staleness is derived from
// data_through vs opm_stale_days; opm_targets drives status_color, not staleness.
module.exports = function opmanagerRoutes(deps) {
  const { express, requireReportSession, requireAdmin } = deps;
  const requireSuperAdmin = deps.requireSuperAdmin || requireAdmin;   // fallback if not injected
  const router = express.Router();
  const rdb = require('../reports-db');
  const reportConfig = require('../services/reportConfig');
  const { classifyKpiFamily } = require('../services/opmClassify');
  const { computeCircuitSla, resolutionBreaches } = require('../services/wanSla');
  const { parseSlaWanConfig, resolveCircuit } = require('../services/slaWanConfig');

  const FAMILIES = ['lan', 'wifi', 'wan', 'servers'];

  // month=YYYY-MM → UTC [monthStart, monthEnd) ms. Garbage/absent → current UTC month.
  function _monthBounds(raw) {
    const now = new Date();
    const m = /^(\d{4})-(\d{2})$/.exec(String(raw || '').trim());
    const y = m ? Number(m[1]) : now.getUTCFullYear();
    const mo = m ? Number(m[2]) - 1 : now.getUTCMonth();       // 0-based
    const monthStart = Date.UTC(y, mo, 1);
    const monthEnd = Date.UTC(y, mo + 1, 1);                   // exclusive
    const label = `${y}-${String(mo + 1).padStart(2, '0')}`;
    return { monthStart, monthEnd, label,
      fromISO: new Date(monthStart).toISOString(), toISO: new Date(monthEnd).toISOString() };
  }
  function _csvCell(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }

  function _safeParse(s, d) { try { return JSON.parse(s); } catch { return d; } }
  function _numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  function _isStale(ref, staleDays, nowMs) {
    if (!ref) return false;
    const t = Date.parse(String(ref).slice(0, 10));
    if (Number.isNaN(t)) return false;
    return Math.floor((nowMs - t) / 86400000) > staleDays;
  }

  // Tolerant: probe name (opmanager, the complete namespace) → meetings code
  // (HGO/MGO/… convenience) → site name. Works for sites with no meetings code
  // (Tanda/Abidjan are addressed by their probe name). Returns {site_id, name} or null.
  async function resolveSiteParam(code) {
    if (!code) return null;
    let r = await rdb.getSiteIdByModuleCode('opmanager', code);
    if (r && r.site_id) return { site_id: r.site_id, name: r.name };
    r = await rdb.getSiteIdByModuleCode('meetings', code);
    if (r && r.site_id) return { site_id: r.site_id, name: r.name };
    const sites = (await rdb.listSites({ includeInactive: true })) || [];
    const lc = code.trim().toLowerCase();
    const s = sites.find(x => String(x.name || '').trim().toLowerCase() === lc);
    return s ? { site_id: s.id, name: s.name } : null;
  }

  // Fill the 4 families from the snapshot rows: present → mapped row; absent → null/none.
  function fillFamilies(snaps, targets, staleDays, nowMs) {
    const byFam = {};
    for (const r of (snaps || [])) if (r.metric_name === 'availability') byFam[r.kpi_family] = r;
    return FAMILIES.map(fam => {
      const r = byFam[fam];
      if (!r) return {
        kpi_family: fam, metric_value: null, target: _numOrNull(targets[fam]),
        status_color: 'none', trend: null, stale: false, source: 'analytics_opmanager',
      };
      const ref = r.data_through || r.collected_at;
      return {
        kpi_family: fam,
        metric_value: r.metric_value,
        target: r.target_value != null ? r.target_value : _numOrNull(targets[fam]),
        status_color: r.status_color || 'none',
        trend: r.trend || null,
        stale: _isStale(ref, staleDays, nowMs),
        source: r.source || 'analytics_opmanager',
        period_start: r.period_start, period_end: r.period_end,
        data_through: r.data_through || null,
        collected_at: r.collected_at || null,
        device_count: r.device_count, included_device_count: r.included_device_count,
      };
    });
  }

  router.get('/api/analytics/opmanager/availability', requireReportSession, async (req, res) => {
    try {
      const period = req.query.period === 'month' ? 'month' : 'week';
      const cfg = await reportConfig.getConfig(rdb.db);          // Promise on pg — MUST await
      const targets = _safeParse(cfg.opm_targets, {});
      const staleDays = parseInt(cfg.opm_stale_days, 10) || 9;
      const asOf = new Date().toISOString().slice(0, 10);
      const nowMs = Date.now();
      const code = String(req.query.site || '').trim();

      if (!code || code === 'all') {
        const snaps = await rdb.getInfraSnapshots({ period_type: period });
        const siteList = (await rdb.listSites({ includeInactive: true })) || [];
        const nameById = {}; for (const s of siteList) nameById[s.id] = s.name;
        const bySite = {};
        for (const r of snaps) (bySite[r.site_id] = bySite[r.site_id] || []).push(r);
        const sites = Object.keys(bySite).map(sid => ({
          site_id: Number(sid), site_name: nameById[sid] || null,
          families: fillFamilies(bySite[sid], targets, staleDays, nowMs),
        }));
        return res.json({ period, as_of: asOf, sites });
      }

      const site = await resolveSiteParam(code);
      if (!site) return res.json({ site: code, site_id: null, period, as_of: asOf, families: [] });
      const snaps = await rdb.getInfraSnapshots({ site_id: site.site_id, period_type: period });
      return res.json({
        site: code, site_id: site.site_id, site_name: site.name, period, as_of: asOf,
        families: fillFamilies(snaps, targets, staleDays, nowMs),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/analytics/opmanager/coverage', requireReportSession, async (req, res) => {
    try {
      const cfg = await reportConfig.getConfig(rdb.db);
      const { coverageSummary } = require('../services/opmAnalytics');
      const codes = (await rdb.listSiteModuleCodes('opmanager')) || [];
      const byProbe = {}; for (const c of codes) byProbe[String(c.code).trim().toLowerCase()] = c.site_id;
      const probeToSite = p => { const k = String(p == null ? '' : p).trim().toLowerCase(); return byProbe[k] != null ? byProbe[k] : null; };

      // V1b-B — coverage from the REST device list when OpManager REST is configured
      // (else the availability snapshots + this governance view would derive from two sources).
      if (cfg && cfg.opmanager_api_key && cfg.opmanager_base_url) {
        const client = deps.opmanagerClient || require('../services/opmanagerClient').makeOpmanagerClient({
          apiKey: cfg.opmanager_api_key, baseUrl: cfg.opmanager_base_url, tlsInsecure: cfg.opmanager_tls_insecure !== '0' });
        const raw = (await client.listDevices({ rows: 5000, page: 1 })) || [];
        const rows = raw.map(d => ({ device_key: d.name || d.deviceName || d.displayName, probe: d.probeName, type: d.type, category: d.category }));
        const cov = coverageSummary(rows, { classify: classifyKpiFamily, probeToSite });
        return res.json({ available: true, source: 'opmanager_rest', ...cov });
      }

      // V1a fallback — the prepared Analytics view (dormant).
      const viewId = cfg && cfg.opm_availability_view_id;
      if (!viewId) return res.json({ available: false, reason: 'opmanager REST or opm_availability_view_id not configured' });
      const { readDailyRows } = require('../services/opmAnalytics');
      const rows = await readDailyRows({ fetchView: deps.fetchView, viewId });
      const cov = coverageSummary(rows, { classify: classifyKpiFamily, probeToSite });
      return res.json({ available: true, source: 'analytics', ...cov });
    } catch (e) { return res.json({ available: false, reason: e.message }); }
  });

  router.post('/api/analytics/opmanager/sync', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const r = await require('../tools/opmanager/sync-availability').main({ fetchView: deps.fetchView });
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── V1b-D — WAN Health dashboard (reads wan_link_snapshots, the Meraki WAN archive) ──
  router.get('/api/analytics/wan/summary', requireReportSession, async (req, res) => {
    try {
      const { latestPerSite } = require('../services/wanDashboard');
      const { applyEventAvailability } = require('../services/wanEventAvailability');
      const period = req.query.period === 'month' ? 'month' : 'week';
      const rows = await rdb.getWanSnapshots({ period_type: period });
      const siteList = (await rdb.listSites({ includeInactive: true })) || [];
      const nameById = {}; for (const s of siteList) nameById[s.id] = s.name;
      const sites = latestPerSite(rows).map(s => ({ ...s, site_name: nameById[s.site_id] || null }));

      // FAITHFUL availability = event-based, from the poller's outage log (Meraki uplink
      // status) — NOT the disqualified loss-derived snapshot value. Only when the poller has
      // run (heartbeat wan_poll_last_run); otherwise availability is '—' (never a fabricated %).
      // loss/latency/jitter stay from the snapshot (they are quality, and accurate).
      let pollActive = false;
      try {
        const cfg = await require('../services/reportConfig').getConfig(rdb.db);
        pollActive = !!(cfg && cfg.wan_poll_last_run);
        let target = 98; try { const t = JSON.parse(cfg && cfg.opm_targets || '{}'); if (t && t.wan != null) target = Number(t.wan); } catch (_) {}
        if (pollActive && sites.length) {
          // Flatten to circuit cells carrying site_id, then apply the ONE shared event-based
          // path (same helper the site-report auto-fill uses → the two can never disagree).
          const cells = [];
          for (const s of sites) for (const u of s.uplinks) { u.site_id = s.site_id; cells.push(u); }
          let minFrom = null, maxTo = null;
          for (const u of cells) {
            const f = (u.period_start || '') + 'T00:00:00Z'; if (u.period_start && (!minFrom || f < minFrom)) minFrom = f;
            const end = u.period_end || u.period_start; const t = (end || '') + 'T23:59:59Z'; if (end && (!maxTo || t > maxTo)) maxTo = t;
          }
          let outages = [];
          if (minFrom && maxTo) { try { outages = (await rdb.getWanOutagesOverlapping(minFrom, maxTo)) || []; } catch (_) { outages = []; } }
          applyEventAvailability(cells, outages, { target });
        } else {
          // poller not yet active → do NOT present the disqualified loss-based figure as availability
          for (const s of sites) for (const u of s.uplinks) { u.availability_pct = null; u.status_color = 'none'; u.basis = 'pending_poller'; }
        }
      } catch (_) { /* availability override is best-effort; quality data already stands */ }

      res.json({ period, as_of: new Date().toISOString().slice(0, 10), poll_active: pollActive, sites });
    } catch (e) { res.json({ sites: [], reason: e.message }); }
  });

  router.get('/api/analytics/wan/trend', requireReportSession, async (req, res) => {
    try {
      const { trendSeries } = require('../services/wanDashboard');
      const period = req.query.period === 'month' ? 'month' : 'week';
      const code = String(req.query.site || '').trim();
      const site = await resolveSiteParam(code);
      if (!site) return res.json({ site: code, site_id: null, period, series: [] });
      const rows = await rdb.getWanSnapshots({ site_id: site.site_id, period_type: period });
      res.json({ site: code, site_id: site.site_id, site_name: site.name, period, series: trendSeries(rows) });
    } catch (e) { res.json({ series: [], reason: e.message }); }
  });

  router.post('/api/analytics/wan/sync', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const r = await require('../tools/meraki/sync-wan').main({});
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Editable Site ↔ Meraki-network map (the sync's own source). super_admin — this
  // is admin config. GET lists every active site (mapped or not); PUT saves rows.
  router.get('/api/analytics/wan/mappings', requireReportSession, requireSuperAdmin, async (req, res) => {
    try {
      res.json({
        sites: (await rdb.listSiteMerakiMap()) || [],
        subsites: (await rdb.listWanSubsiteNetworks()) || [],
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/api/analytics/wan/mappings', requireReportSession, requireSuperAdmin, express.json(), async (req, res) => {
    try {
      const list = Array.isArray(req.body && req.body.mappings) ? req.body.mappings : [];
      for (const m of list) {
        const sid = Number(m && m.site_id);
        if (Number.isFinite(sid)) await rdb.setSiteMerakiCode(sid, m.network);
      }
      await rdb.setWanSubsiteNetworks((req.body && req.body.subsites) || []);
      res.json({
        ok: true,
        sites: (await rdb.listSiteMerakiMap()) || [],
        subsites: (await rdb.listWanSubsiteNetworks()) || [],
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── V1c — WAN SLA / ISP chargeback. Reads wan_outages (the poller + ingester archive) and
  //    the sla_wan_config policy; computes the monthly binding availability + credit per mapped
  //    circuit, and surfaces UNMAPPED outages so no ISP interruption goes unaccounted. All
  //    best-effort — never 500 (on throw, return the safe empty shape). ──
  router.get('/api/analytics/wan/sla/summary', requireReportSession, async (req, res) => {
    const { monthStart, monthEnd, label, fromISO, toISO } = _monthBounds(req.query.month);
    try {
      const cfg = parseSlaWanConfig((await reportConfig.getConfig(rdb.db)).sla_wan_config);
      const nowMs = Date.now();
      const clockStart = cfg.clock_start;
      const triggerMinutes = (cfg.notify && cfg.notify.trigger_minutes) || 15;

      const circuits = [];
      for (const c of (Array.isArray(cfg.circuits) ? cfg.circuits : [])) {
        if (!c) continue;
        const site_id = c.site_id, sub_site = c.sub_site || '', uplink = c.uplink;
        const resolved = resolveCircuit(cfg, { site_id, sub_site, uplink });
        if (!resolved) continue;
        const rows = (await rdb.getWanOutages({ site_id, from: fromISO, to: toISO, uplink })) || [];
        const outages = rows.filter(o => (o.sub_site || '') === sub_site);   // getWanOutages has no sub_site filter
        const sla = computeCircuitSla({
          outages, circuit: resolved, tier: resolved.tier, maintenance: cfg.maintenance,
          monthStart, monthEnd, clockStart, triggerMinutes, nowMs });
        circuits.push({
          site_id, sub_site, uplink, tier: c.tier, isp: resolved.isp || null,
          circuit_id: resolved.circuit_id || null, outage_count: outages.length,
          resolution_breaches: resolutionBreaches(outages, resolved.tier, resolved), ...sla });
      }

      // UNMAPPED — distinct (site_id, sub_site, uplink) with month outages that match no circuit.
      const seen = new Map();
      for (const o of ((await rdb.getWanOutages({ from: fromISO, to: toISO })) || [])) {
        const site_id = o.site_id, sub_site = o.sub_site || '', uplink = o.uplink;
        if (resolveCircuit(cfg, { site_id, sub_site, uplink })) continue;
        const k = `${site_id}|${sub_site}|${uplink}`;
        const e = seen.get(k) || { unmapped: true, site_id, sub_site, uplink, outage_count: 0, availability_pct: null };
        e.outage_count += 1;
        seen.set(k, e);
      }
      res.json({ month: label, circuits, unmapped: [...seen.values()] });
    } catch (e) { res.json({ month: label, circuits: [], unmapped: [], reason: e.message }); }
  });

  // Raw outage evidence. Tolerant `site` (numeric id, probe/meetings code, or site name) → site_id.
  router.get('/api/analytics/wan/sla/outages', requireReportSession, async (req, res) => {
    try {
      const f = {};
      const code = String(req.query.site || '').trim();
      if (code) {
        if (/^\d+$/.test(code)) f.site_id = Number(code);
        else { const s = await resolveSiteParam(code); if (!s) return res.json({ outages: [] }); f.site_id = s.site_id; }
      }
      if (req.query.from) f.from = String(req.query.from);
      if (req.query.to) f.to = String(req.query.to);
      if (req.query.uplink) f.uplink = String(req.query.uplink);
      res.json({ outages: (await rdb.getWanOutages(f)) || [] });
    } catch (e) { res.json({ outages: [], reason: e.message }); }
  });

  // Policy read — super_admin (admin config). No redaction (isp_notify_email is not a secret).
  router.get('/api/analytics/wan/sla/config', requireReportSession, requireSuperAdmin, async (req, res) => {
    try {
      res.json(parseSlaWanConfig((await reportConfig.getConfig(rdb.db)).sla_wan_config));
    } catch (e) { res.json(parseSlaWanConfig('')); }   // safe defaults, never 500
  });
  router.put('/api/analytics/wan/sla/config', requireReportSession, requireSuperAdmin, express.json(), async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'body must be an object' });
      await reportConfig.setConfig(rdb.db, { sla_wan_config: JSON.stringify(body) }, req.reportUser && req.reportUser.username);
      res.json({ ok: true });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });

  // Run the nightly event-log ingester on demand. Config-gated (self-skips) + best-effort.
  router.post('/api/analytics/wan/sla/sync', requireReportSession, requireAdmin, async (req, res) => {
    try {
      res.json(await require('../tools/meraki/sync-wan-events').main({}));
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });

  // CSV evidence export for the month — UTF-8 BOM + CRLF + quote-escaped (index.html convention).
  router.get('/api/analytics/wan/sla/export.csv', requireReportSession, async (req, res) => {
    const cols = ['site_id', 'sub_site', 'uplink', 'isp', 'circuit_id', 'detected_start', 'restored_end',
      'notified_at', 'duration_s', 'attribution', 'attribution_reason'];
    try {
      const { label, fromISO, toISO } = _monthBounds(req.query.month);
      const outages = (await rdb.getWanOutages({ from: fromISO, to: toISO })) || [];
      const lines = [cols.map(_csvCell).join(',')];
      for (const o of outages) lines.push(cols.map(c => _csvCell(o[c])).join(','));
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="wan-sla-outages-${label}.csv"`);
      res.send('﻿' + lines.join('\r\n'));
    } catch (e) {
      res.setHeader('Content-Type', 'text/csv');
      res.send('﻿' + cols.join(','));
    }
  });

  return router;
};
