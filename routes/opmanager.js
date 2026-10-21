'use strict';
const { fail, logError } = require('../services/httpError');
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
        basis: r.basis || null,   // 'monitoring_gap' when the site's probe was down that period
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
    } catch (e) { fail(res, e); }
  });

  // Coverage governance — shared by the /opmanager/coverage route AND /infra/summary. Returns
  // {available, source, ...} or {available:false, reason}. Best-effort: never throws (caller-safe).
  async function _coverage(cfg) {
    try {
      const { coverageSummary } = require('../services/opmAnalytics');
      const codes = (await rdb.listSiteModuleCodes('opmanager')) || [];
      const byProbe = {}; for (const c of codes) byProbe[String(c.code).trim().toLowerCase()] = c.site_id;
      const probeToSite = p => { const k = String(p == null ? '' : p).trim().toLowerCase(); return byProbe[k] != null ? byProbe[k] : null; };

      // V1b-B — coverage from the REST device list when OpManager REST is configured
      // (else the availability snapshots + this governance view would derive from two sources).
      if (cfg && cfg.opmanager_api_key && cfg.opmanager_base_url) {
        const client = deps.opmanagerClient || require('../services/opmanagerClient').makeOpmanagerClient(
          require('../services/opmanagerClient').optionsFromConfig(cfg));
        const raw = (await client.listDevices({ rows: 5000, page: 1 })) || [];
        const rows = raw.map(d => ({ device_key: d.name || d.deviceName || d.displayName, probe: d.probeName, type: d.type, category: d.category }));
        const cov = coverageSummary(rows, { classify: classifyKpiFamily, probeToSite });
        return { available: true, source: 'opmanager_rest', ...cov };
      }

      // V1a fallback — the prepared Analytics view (dormant).
      const viewId = cfg && cfg.opm_availability_view_id;
      if (!viewId) return { available: false, reason: 'opmanager REST or opm_availability_view_id not configured' };
      const { readDailyRows } = require('../services/opmAnalytics');
      const rows = await readDailyRows({ fetchView: deps.fetchView, viewId });
      const cov = coverageSummary(rows, { classify: classifyKpiFamily, probeToSite });
      return { available: true, source: 'analytics', ...cov };
    } catch (e) { return { available: false, reason: e.message }; }
  }

  router.get('/api/analytics/opmanager/coverage', requireReportSession, async (req, res) => {
    const cfg = await reportConfig.getConfig(rdb.db);
    res.json(await _coverage(cfg));
  });

  // ── Infrastructure Health — unified per-site availability matrix (LAN/WLAN/Servers from
  //    the OpManager snapshots + WAN from wan_link_snapshots), merged by the pure
  //    services/infraHealth.buildInfraMatrix, plus the coverage governance summary. Best-effort,
  //    session-guarded like the sibling opmanager/wan routes; never 500. ──
  router.get('/api/analytics/infra/summary', requireReportSession, async (req, res) => {
    try {
      const { buildInfraMatrix } = require('../services/infraHealth');
      const { latestPerSite } = require('../services/wanDashboard');
      const period = req.query.period === 'month' ? 'month' : 'week';
      const cfg = await reportConfig.getConfig(rdb.db);
      const targets = _safeParse(cfg.opm_targets, {});
      const staleDays = parseInt(cfg.opm_stale_days, 10) || 9;
      const asOf = new Date().toISOString().slice(0, 10);
      const nowMs = Date.now();

      const siteList = (await rdb.listSites({ includeInactive: true })) || [];
      const nameById = {}; for (const s of siteList) nameById[s.id] = s.name;

      // opmSites — mirror /opmanager/availability's all-sites branch: group snapshots by site → fillFamilies.
      const snaps = (await rdb.getInfraSnapshots({ period_type: period })) || [];
      const bySite = {};
      for (const r of snaps) (bySite[r.site_id] = bySite[r.site_id] || []).push(r);
      const opmSites = Object.keys(bySite).map(sid => ({
        site_id: Number(sid), site_name: nameById[sid] || null,
        families: fillFamilies(bySite[sid], targets, staleDays, nowMs),
      }));

      // wanSites — latest per site/uplink from wan_link_snapshots (carry availability_pct + site_name).
      const wanRows = (await rdb.getWanSnapshots({ period_type: period })) || [];
      const wanSites = latestPerSite(wanRows).map(s => ({ ...s, site_name: nameById[s.site_id] || null }));

      const wanTarget = Number(_safeParse(cfg.opm_targets, {}).wan) || 98;
      const coverage = await _coverage(cfg);
      const matrix = buildInfraMatrix({ opmSites, wanSites, wanTarget, asOf });
      res.json({ period, as_of: asOf, sites: matrix.sites, fleet: matrix.fleet, coverage });
    } catch (e) { res.json({ sites: [], reason: 'internal_error', correlation_id: logError(e, req) }); }
  });

  // ── Infrastructure Health — monthly availability trend for ONE site: LAN/WLAN/Servers
  //    (OpManager snapshots) + WAN1/WAN2 (Meraki wan_link_snapshots). getInfraSnapshots /
  //    getWanSnapshots return ALL monthly rows for the site; the pure buildInfraTrend slices
  //    to N months ending at asOf and trims the empty lead-in. Best-effort; never 500. ──
  router.get('/api/analytics/infra/trend', requireReportSession, async (req, res) => {
    try {
      const { buildInfraTrend } = require('../services/infraHealth');
      const code = String(req.query.site || '').trim();
      const site = await resolveSiteParam(code);
      if (!site) return res.json({ site: code, site_id: null, labels: [], series: {} });
      const months = Math.min(Math.max(parseInt(req.query.months, 10) || 12, 1), 36);
      const opmMonthly = await rdb.getInfraSnapshots({ site_id: site.site_id, period_type: 'month' });
      let wanMonthly = [];
      try { wanMonthly = (await rdb.getWanSnapshots({ site_id: site.site_id, period_type: 'month' })) || []; } catch (_) {}
      const asOf = new Date().toISOString().slice(0, 10);
      const trend = buildInfraTrend({ opmMonthly: opmMonthly || [], wanMonthly, months, asOf });
      res.json({ site: code, site_id: site.site_id, site_name: site.name, months, labels: trend.labels, series: trend.series });
    } catch (e) { res.json({ labels: [], series: {}, reason: 'internal_error', correlation_id: logError(e, req) }); }
  });

  router.post('/api/analytics/opmanager/sync', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const r = await require('../tools/opmanager/sync-availability').main({ fetchView: deps.fetchView });
      res.json(r);
    } catch (e) { fail(res, e); }
  });

  // ── V1b-D — WAN Health dashboard (reads wan_link_snapshots, the Meraki WAN archive) ──
  router.get('/api/analytics/wan/summary', requireReportSession, async (req, res) => {
    try {
      const { latestPerSite } = require('../services/wanDashboard');
      const { applySiteEventAvailability } = require('../services/wanEventAvailability');
      const { parseSlaWanConfig, resolveCircuit } = require('../services/slaWanConfig');
      const { merakiWindow } = require('../services/wanWindow');
      const periodRaw = String(req.query.period || 'week');
      const period = (periodRaw === 'month' || periodRaw === 'day') ? periodRaw : 'week';
      // No daily snapshot exists → 'day' borrows the 'week' snapshot for the site/uplink structure
      // and quality (loss/latency); only the availability WINDOW differs (computed on the fly).
      const snapPeriod = period === 'day' ? 'week' : period;
      const rows = await rdb.getWanSnapshots({ period_type: snapPeriod });
      const siteList = (await rdb.listSites({ includeInactive: true })) || [];
      const nameById = {}; for (const s of siteList) nameById[s.id] = s.name;
      const sites = latestPerSite(rows).map(s => ({ ...s, site_name: nameById[s.site_id] || null }));

      // FAITHFUL availability = event-based, from the poller's outage log (Meraki uplink
      // status) — NOT the disqualified loss-derived snapshot value. Only when the poller has
      // run (heartbeat wan_poll_last_run); otherwise availability is '—' (never a fabricated %).
      // loss/latency/jitter stay from the snapshot (they are quality, and accurate).
      let pollActive = false;
      let win = null;
      try {
        const cfg = await require('../services/reportConfig').getConfig(rdb.db);
        pollActive = !!(cfg && cfg.wan_poll_last_run);
        let target = 98; try { const t = JSON.parse(cfg && cfg.opm_targets || '{}'); if (t && t.wan != null) target = Number(t.wan); } catch (_) {}
        if (pollActive && sites.length) {
          // Availability window MIRRORS Meraki's Summary Report presets (Day/Week/Month = rolling
          // N complete days ENDING YESTERDAY), so this number reconciles with what the editor sees
          // when they click the matching preset in Meraki (they use presets, never Custom).
          // Computed on-demand from the event-fed outage log — the loss/latency snapshot is a
          // PAST-week archive and must NOT bound availability (that lag once read every link 100%).
          const w = merakiWindow(period, Date.now());
          // Denominator = time actually COLLECTED: clamp the window start to when monitoring began
          // (wan_poll_first_run), so a not-yet-full window isn't inflated by counting the
          // un-monitored span as up. requested_from is kept for the UI.
          const firstRun = cfg.wan_poll_first_run ? Date.parse(cfg.wan_poll_first_run) : null;
          const toISO = w.toISO, tMs = w.toMs;
          const effFromMs = (firstRun && Number.isFinite(firstRun)) ? Math.max(w.fromMs, firstRun) : w.fromMs;
          const effFromISO = new Date(effFromMs).toISOString();
          win = { from: effFromISO, to: toISO, requested_from: w.fromISO, days: w.days };
          let outages = [];
          try { outages = (await rdb.getWanOutagesOverlapping(effFromISO, toISO)) || []; } catch (_) { outages = []; }
          const circuits = parseSlaWanConfig(cfg.sla_wan_config);   // to name each link by its ISP once mapped
          // Group uplinks by DEVICE (site_id, sub_site) so a both-down period (device offline /
          // power) is excluded on the fly — the symmetric both-uplinks-identical figures were real
          // SITE outages that A must exclude, but the nightly 'site' attribution hadn't run yet.
          const groups = new Map();
          for (const s of sites) for (const u of s.uplinks) {
            u.site_id = s.site_id;
            const k = s.site_id + '|' + (u.sub_site || '');
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(u);
          }
          // PRIMARY = the snapshot's loss<100 "% Time Up" (deriveAvailability, Meraki's own
          // method — ≈ the Summary Report figure). applySiteEventAvailability overwrites
          // availability_pct with the EVENT-based value, so stash the % Time Up first and restore
          // it after; the event figure becomes the secondary "· up X%" (avail_event_pct).
          const { statusColor: _sc } = require('../services/merakiWanQuality');
          for (const g of groups.values()) {
            for (const u of g) u.__timeup = u.availability_pct;
            applySiteEventAvailability(g, outages, { target, fromMs: effFromMs, toMs: tMs });
            for (const u of g) {
              u.avail_event_pct = u.availability_pct;                       // event-based (rolling) → secondary
              u.availability_pct = (u.__timeup == null) ? null : u.__timeup; // restore % Time Up as primary
              u.status_color = (u.availability_pct == null) ? 'none' : _sc(u.availability_pct, target);
              u.basis = 'timeup';
              delete u.__timeup;
            }
          }
          for (const s of sites) for (const u of s.uplinks) {
            const circ = resolveCircuit(circuits, { site_id: s.site_id, sub_site: u.sub_site, uplink: u.uplink });
            if (circ && (circ.isp || circ.circuit_id)) {
              u.uplink_label = circ.isp ? (circ.circuit_id ? circ.isp + ' (' + circ.circuit_id + ')' : circ.isp) : circ.circuit_id;
            }
          }
        } else {
          // % Time Up comes from the snapshot (loss/latence), INDEPENDENT of the poller → keep it
          // as the primary even before the poller runs; only the event-based "· up X%" is absent.
          const { statusColor: _sc2 } = require('../services/merakiWanQuality');
          for (const s of sites) for (const u of s.uplinks) {
            u.status_color = (u.availability_pct == null) ? 'none' : _sc2(u.availability_pct, target);
            u.basis = 'timeup';
          }
        }
      } catch (_) { /* availability override is best-effort; quality data already stands */ }

      // Resolution floor: a sample-counted availability with N samples can only prove
      // ">= 100 - 100/N" when no down sample was seen — the page prints "≥ 99.9 %" then,
      // never a "100 %" it cannot measure. null until the sync has stored avail_samples.
      try {
        const { availabilityFloorPct } = require('../services/merakiWanQuality');
        for (const s of sites) for (const u of s.uplinks) {
          u.avail_samples = (u.avail_samples == null) ? null : Number(u.avail_samples);
          u.avail_floor_pct = availabilityFloorPct(u.avail_samples);
        }
      } catch (_) {}

      res.json({ period, as_of: new Date().toISOString().slice(0, 10), poll_active: pollActive, window: win, sites });
    } catch (e) { res.json({ sites: [], reason: 'internal_error', correlation_id: logError(e, req) }); }
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
    } catch (e) { res.json({ series: [], reason: 'internal_error', correlation_id: logError(e, req) }); }
  });

  router.post('/api/analytics/wan/sync', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const r = await require('../tools/meraki/sync-wan').main({});
      res.json(r);
    } catch (e) { fail(res, e); }
  });

  // Editable Site ↔ Meraki-network map (the sync's own source). super_admin — this
  // is admin config. GET lists every active site (mapped or not); PUT saves rows.
  router.get('/api/analytics/wan/mappings', requireReportSession, requireSuperAdmin, async (req, res) => {
    try {
      res.json({
        sites: (await rdb.listSiteMerakiMap()) || [],
        subsites: (await rdb.listWanSubsiteNetworks()) || [],
      });
    } catch (e) { fail(res, e); }
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
    } catch (e) { fail(res, e); }
  });

  // ── V1c — WAN SLA / ISP chargeback. Reads wan_outages (the poller + ingester archive) and
  //    the sla_wan_config policy; computes the monthly binding availability + credit per mapped
  //    circuit, and surfaces UNMAPPED outages so no ISP interruption goes unaccounted. All
  //    best-effort — never 500 (on throw, return the safe empty shape). ──
  // RBAC lot 4d (2026-10-02): the SLA views are open to coordinators, locked to their site.
  // null = admin tier (every site); otherwise the caller's site_id (-1 = no site → nothing).
  // Multi-site editors (2026-10-05): the list of the caller's site ids ([] = nothing).
  const _slaSite = (user) => (rdb.userHasRole(user, 'admin') ? null : require('../services/userSites').siteIds(user));
  const _slaKeep = (user) => { const s = _slaSite(user); return (o) => s === null || s.includes(Number(o.site_id)); };

  router.get('/api/analytics/wan/sla/summary', requireReportSession, async (req, res) => {
    const { monthStart, monthEnd, label, fromISO, toISO } = _monthBounds(req.query.month);
    try {
      const cfg = parseSlaWanConfig((await reportConfig.getConfig(rdb.db)).sla_wan_config);
      const nowMs = Date.now();
      const clockStart = cfg.clock_start;
      const triggerMinutes = (cfg.notify && cfg.notify.trigger_minutes) || 15;
      // Resolve site_id → name for display (the raw numeric id is meaningless to a reader).
      const _siteList = (await rdb.listSites({ includeInactive: true })) || [];
      const _nameById = {}; for (const s of _siteList) _nameById[s.id] = s.name;
      const _siteName = (id) => _nameById[id] || null;

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
          site_id, site_name: _siteName(site_id), sub_site, uplink, tier: c.tier, isp: resolved.isp || null,
          circuit_id: resolved.circuit_id || null, outage_count: outages.length,
          resolution_breaches: resolutionBreaches(outages, resolved.tier, resolved), ...sla });
      }

      // UNMAPPED — distinct (site_id, sub_site, uplink) with month outages that match no circuit.
      const seen = new Map();
      for (const o of ((await rdb.getWanOutages({ from: fromISO, to: toISO })) || [])) {
        const site_id = o.site_id, sub_site = o.sub_site || '', uplink = o.uplink;
        if (resolveCircuit(cfg, { site_id, sub_site, uplink })) continue;
        const k = `${site_id}|${sub_site}|${uplink}`;
        const e = seen.get(k) || { unmapped: true, site_id, site_name: _siteName(site_id), sub_site, uplink, outage_count: 0, availability_pct: null };
        e.outage_count += 1;
        seen.set(k, e);
      }
      const keep = _slaKeep(req.reportUser);
      res.json({ month: label, circuits: circuits.filter(keep), unmapped: [...seen.values()].filter(keep) });
    } catch (e) { res.json({ month: label, circuits: [], unmapped: [], reason: 'internal_error', correlation_id: logError(e, req) }); }
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
      const scoped = _slaSite(req.reportUser);
      // a coordinator only sees their own site(s): keep ?site= when it is one of them, else filter after
      if (scoped !== null && !(f.site_id && scoped.includes(Number(f.site_id)))) delete f.site_id;
      const siteList = (await rdb.listSites({ includeInactive: true })) || [];
      const nameById = {}; for (const s of siteList) nameById[s.id] = s.name;
      const outages = ((await rdb.getWanOutages(f)) || []).filter(_slaKeep(req.reportUser))
        .map(o => ({ ...o, site_name: nameById[o.site_id] || null }));
      res.json({ outages });
    } catch (e) { res.json({ outages: [], reason: 'internal_error', correlation_id: logError(e, req) }); }
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
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });

  // Run the nightly event-log ingester on demand. Config-gated (self-skips) + best-effort.
  router.post('/api/analytics/wan/sla/sync', requireReportSession, requireAdmin, async (req, res) => {
    try {
      // ?days=N → reconcile the last N days from Meraki's event log (default 3; up to 90 for a
      // one-time historical cleanup that fixes poller-inflated durations + sets attribution).
      const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 3));
      const since = new Date(Date.now() - days * 86400000).toISOString();
      res.json(await require('../tools/meraki/sync-wan-events').main({ since }));
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });

  // CSV evidence export for the month — UTF-8 BOM + CRLF + quote-escaped (index.html convention).
  router.get('/api/analytics/wan/sla/export.csv', requireReportSession, async (req, res) => {
    const cols = ['site_id', 'sub_site', 'uplink', 'isp', 'circuit_id', 'detected_start', 'restored_end',
      'notified_at', 'duration_s', 'attribution', 'attribution_reason'];
    try {
      const { label, fromISO, toISO } = _monthBounds(req.query.month);
      const outages = ((await rdb.getWanOutages({ from: fromISO, to: toISO })) || []).filter(_slaKeep(req.reportUser));
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

  // ── XLSX evidence exports (the CSV routes stay for compatibility) ──────────
  // One workbook, three sheets: the real outages (a duration, or still open), the poller's
  // 24 h stale-open chains (closed rows with NO duration — never-active uplinks such as an
  // unplugged wan port; kept apart so the evidence sheet reads clean, not dropped), and a
  // per site × uplink summary. Site names resolved server-side; timestamps stay ISO text
  // (sortable, unambiguous — no Excel locale guessing).
  const _fmtDur = (s) => { const n = Number(s); if (!Number.isFinite(n) || n < 0) return ''; const h = Math.floor(n / 3600), m = Math.round((n % 3600) / 60); return `${h}h${String(m).padStart(2, '0')}`; };
  function _outageSheets(outages, nameById, label) {
    const row = (o) => ({
      'Site': nameById[o.site_id] || ('#' + o.site_id),
      'Sous-site': o.sub_site || '',
      'Uplink': o.uplink || '',
      'ISP': o.isp || '',
      'Circuit': o.circuit_id || '',
      'Détectée (UTC)': o.detected_start || '',
      'Rétablie (UTC)': o.restored_end || '',
      'Notifiée (UTC)': o.notified_at || '',
      'Durée (s)': o.duration_s == null ? '' : Number(o.duration_s),
      'Durée (h:mm)': _fmtDur(o.duration_s),
      'Attribution': o.attribution || '',
      'Motif': o.attribution_reason || '',
      'site_id': o.site_id,
    });
    const real = [], chains = [];
    for (const o of (outages || [])) ((o.restored_end && o.duration_s == null) ? chains : real).push(row(o));
    // summary per site × uplink over the REAL rows
    const agg = new Map();
    for (const r of real) {
      const k = `${r.Site}|${r['Sous-site']}|${r.Uplink}`;
      if (!agg.has(k)) agg.set(k, { 'Site': r.Site, 'Sous-site': r['Sous-site'], 'Uplink': r.Uplink, 'ISP': r.ISP, 'Coupures': 0, 'Durée totale (s)': 0, 'Durée totale (h:mm)': '', 'Plus longue (h:mm)': '', _max: 0, 'Ouvertes': 0, 'Attributions': new Set() });
      const a = agg.get(k);
      a.Coupures++;
      if (r['Durée (s)'] !== '') { a['Durée totale (s)'] += r['Durée (s)']; a._max = Math.max(a._max, r['Durée (s)']); }
      if (!r['Rétablie (UTC)']) a.Ouvertes++;
      if (r.Attribution) a.Attributions.add(r.Attribution);
    }
    const summary = [...agg.values()].map(a => ({
      ...a, 'Durée totale (h:mm)': _fmtDur(a['Durée totale (s)']), 'Plus longue (h:mm)': _fmtDur(a._max),
      'Attributions': [...a.Attributions].join(', '), _max: undefined,
    })).map(a => { delete a._max; return a; })
      .sort((x, y) => y['Durée totale (s)'] - x['Durée totale (s)']);
    return [
      { name: `Coupures ${label}`, rows: real },
      { name: 'Résumé site × uplink', rows: summary },
      { name: 'Chaînes 24h sans durée', rows: chains },
    ];
  }
  async function _siteNames() {
    const nameById = {};
    try { for (const s of ((await rdb.listSites({ includeInactive: true })) || [])) nameById[s.id] = s.name; } catch (_) {}
    return nameById;
  }
  function _sendXlsx(res, buf, filename) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  }
  // Month evidence workbook (same scope as export.csv).
  router.get('/api/analytics/wan/sla/export.xlsx', requireReportSession, async (req, res) => {
    try {
      const { buildWorkbook } = require('../services/tableExcel');
      const { label, fromISO, toISO } = _monthBounds(req.query.month);
      const outages = ((await rdb.getWanOutages({ from: fromISO, to: toISO })) || []).filter(_slaKeep(req.reportUser));
      _sendXlsx(res, buildWorkbook(_outageSheets(outages, await _siteNames(), label)), `wan-sla-outages-${label}.xlsx`);
    } catch (e) { fail(res, e); }
  });
  // "What I see" workbook: the page POSTs the rows it currently shows (its own filters applied:
  // period, min duration, ISP, uplink, attribution) — same three sheets, server-side names.
  router.post('/api/analytics/wan/sla/export-filtered.xlsx', requireReportSession, express.json({ limit: '5mb' }), async (req, res) => {
    try {
      const { buildWorkbook } = require('../services/tableExcel');
      const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
      const label = String((req.body && req.body.label) || '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 24) || 'filtre';
      _sendXlsx(res, buildWorkbook(_outageSheets(rows, await _siteNames(), label)), `wan-outages-${label}-filtre.xlsx`);
    } catch (e) { fail(res, e); }
  });

  return router;
};
