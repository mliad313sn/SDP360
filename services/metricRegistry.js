'use strict';
// Step 3 — ONE figure = ONE definition = ONE colour.
//
// The metric registry is the single dictionary of every KPI the platform shows or exports:
// key, name (EN/FR), module, unit, formula (committee-approved wording), window kind, RAG
// policy (a kpi_rag_policies name — never a literal cut-off) and the server-side READER that
// produces the value. Dashboards, exports and the public API resolve a metric by KEY only.
//
//   SEED      — the in-code dictionary (≥ 40 inherited KPIs, registered verbatim with their
//               current formula and window). It is the fallback when no database row exists.
//   load()    — at boot: kpi_rag_policies → KpiRag.definePolicy (DB wins over code), then
//               metric_registry rows (DB wins over the seed) and the seed is inserted for the
//               rows that do not exist yet, so the committee edits rows, never code.
//   READERS   — reader id → async (deps, {site, window}) → one RECORD; a metric picks a
//               `field` of that record. A reader never throws to the caller: an unreadable
//               value is { value: null, error } — null ≠ 0 (CLAUDE.md).
//
// Pure except load()/resolve() which take their readers through `deps` (injectable, tested
// against stubs AND the real sqlite readers in tests/metrics-registry.test.js).

const KpiRag = require('./kpiRag');

const WINDOW_KINDS = ['month', 'week', 'rolling3m', 'rolling13w', 'ytd', 'current'];

// ── Seed ──────────────────────────────────────────────────────────────────────────────
// owner_role = the committee role accountable for the definition (docs/sdp360/02).
const M = (key, name, name_fr, module, unit, formula, window_kind, rag_policy, reader, field, o = {}) =>
  ({ key, name, name_fr, module, unit, formula, window_kind, rag_policy, reader, field, higher_is_better: o.hib !== false, owner_role: o.owner || 'service-support-manager', source: o.source || null, status: 'published' });

const SEED = [
  // Helpdesk — calendar month, scoped by the site's Zoho groups (never request_records.site).
  M('helpdesk.inbound', 'Inbound tickets', 'Tickets entrants', 'helpdesk', 'count', 'COUNT(request_records) created in the month, tech_group IN site.zoho_group', 'month', null, 'helpdesk.calendar_month', 'inbound', { source: 'reports-db.getCalendarMonthlyHelpdesk' }),
  M('helpdesk.closed', 'Closed tickets', 'Tickets clôturés', 'helpdesk', 'count', 'COUNT of month tickets whose status is in the closed set', 'month', null, 'helpdesk.calendar_month', 'closed', { source: 'reports-db.getCalendarMonthlyHelpdesk' }),
  M('helpdesk.closure_pct', 'Closure rate', 'Taux de clôture', 'helpdesk', '%', 'closed / inbound × 100', 'month', 'sla-percent', 'helpdesk.calendar_month', 'close_pct', { source: 'reports-db.getCalendarMonthlyHelpdesk' }),
  M('helpdesk.resolution_sla_pct', 'Resolution SLA', 'SLA de résolution', 'helpdesk', '%', '(closed AND NOT overdue) / closed × 100 — ITSM denominator, never /total', 'month', 'sla-percent', 'helpdesk.calendar_month', 'sla_res_pct', { source: 'reports-db.getCalendarMonthlyHelpdesk' }),
  M('helpdesk.first_reply_sla_pct', 'First-reply SLA', 'SLA de première réponse', 'helpdesk', '%', '(responded AND NOT violated) / responded × 100', 'month', 'sla-percent', 'helpdesk.calendar_month', 'sla_reply_pct', { source: 'reports-db.getCalendarMonthlyHelpdesk' }),
  M('helpdesk.window_created', 'Tickets created (window)', 'Tickets créés (fenêtre)', 'helpdesk', 'count', 'COUNT created in [from,to], site Zoho groups', 'week', null, 'helpdesk.window', 'created', { source: 'reports-db.getSiteHelpdeskWindow' }),
  M('helpdesk.window_resolved', 'Tickets resolved (window)', 'Tickets résolus (fenêtre)', 'helpdesk', 'count', 'COUNT resolved in [from,to]', 'week', null, 'helpdesk.window', 'resolved', { source: 'reports-db.getSiteHelpdeskWindow' }),
  M('helpdesk.window_overdue', 'Overdue tickets (window)', 'Tickets en retard (fenêtre)', 'helpdesk', 'count', 'COUNT created in window with overdue_status set', 'week', null, 'helpdesk.window', 'overdue', { hib: false, source: 'reports-db.getSiteHelpdeskWindow' }),
  M('helpdesk.window_major_incidents', 'Major incidents raised', 'Incidents majeurs ouverts', 'helpdesk', 'count', 'COUNT major incidents created in window (template / request type)', 'week', null, 'helpdesk.window', 'major_incidents', { hib: false, source: 'reports-db.getSiteHelpdeskWindow' }),
  M('helpdesk.avg_resolution_h', 'Average resolution time', 'Temps moyen de résolution', 'helpdesk', 'hours', 'mean(resolved_time − created_time) over resolved tickets; null when none resolved', 'week', null, 'helpdesk.window', 'avg_resolution_h', { hib: false, source: 'reports-db.getSiteHelpdeskWindow' }),
  // Meetings — 5 Engagements, trailing window (insights default = 6 months).
  M('meetings.pvs_held', 'Department reviews held', 'PV tenus', 'meetings', 'count', 'COUNT md_meetings for the site in the window', 'rolling3m', null, 'meetings.insights_site', 'meetings_count', { owner: 'site-coordinator', source: 'meetings-db.insights' }),
  M('meetings.engagement_1_pct', 'Engagement #1 — 3 departments / month', 'Engagement n°1 — 3 départements / mois', 'meetings', '%', 'departments with a PV / 3 × 100, per month, averaged', 'rolling3m', 'sla-percent', 'meetings.insights_site', 'engagement_1', { source: 'meetings-db.insights' }),
  M('meetings.diffused_48h_pct', 'Engagement #2 — diffused within 48 h', 'Engagement n°2 — diffusé sous 48 h', 'meetings', '%', 'PVs with submitted_at − meeting_date ≤ 2 days / PVs × 100', 'rolling3m', 'sla-percent', 'meetings.insights_site', 'diffused_48h_pct', { source: 'meetings-db.insights' }),
  M('meetings.champion_pct', 'Engagement #3 — actions with a champion', 'Engagement n°3 — actions avec champion', 'meetings', '%', 'actions with owner_it / actions × 100', 'rolling3m', 'sla-percent', 'meetings.insights_site', 'champion_pct', { source: 'meetings-db.insights' }),
  M('meetings.escalation_discipline_pct', 'Engagement #5 — escalation discipline', 'Engagement n°5 — discipline d’escalade', 'meetings', '%', 'escalated issues with reason AND theme / escalated × 100', 'rolling3m', 'sla-percent', 'meetings.insights_site', 'escalation_disc', { source: 'meetings-db.insights' }),
  M('meetings.engagement_score', 'Engagements composite score', 'Score composite des engagements', 'meetings', '%', 'mean of the non-null engagement scores E1, E2, E3, E5 (E4 excluded)', 'rolling3m', 'sla-percent', 'meetings.insights_site', 'score_pct', { source: 'meetings-db.insights' }),
  M('meetings.open_issues', 'Open issues', 'Problèmes ouverts', 'meetings', 'count', 'COUNT md_issues not in a terminal status (all-time)', 'current', null, 'meetings.insights_site', 'open', { hib: false, source: 'meetings-db.insights' }),
  M('meetings.overdue_issues', 'Overdue issues', 'Problèmes en retard', 'meetings', 'count', 'open issues with target_date < today', 'current', null, 'meetings.insights_site', 'overdue', { hib: false, source: 'meetings-db.insights' }),
  // Inspections — report window.
  M('inspection.count', 'Inspections done', 'Inspections réalisées', 'inspection', 'count', 'COUNT insp_inspections in window for the site', 'month', null, 'inspection.aggregate_site', 'total', { owner: 'site-coordinator', source: 'inspection-db.aggregate' }),
  M('inspection.critical_count', 'Critical-risk inspections', 'Inspections à risque critique', 'inspection', 'count', 'COUNT inspections whose overall_risk contains Critical', 'month', null, 'inspection.aggregate_site', 'critical_count', { hib: false, source: 'inspection-db.aggregate' }),
  M('inspection.conformity_pct', 'Checklist conformity', 'Conformité de la checklist', 'inspection', '%', 'findings ok / (ok + minor + major + critical + opp) × 100; null when nothing applicable', 'month', 'sla-percent', 'inspection.aggregate_site', 'conformity_pct', { source: 'inspection-db.aggregate' }),
  M('inspection.open_actions', 'Open corrective actions', 'Actions correctives ouvertes', 'inspection', 'count', 'insp_actions not Closed/Cancelled', 'current', null, 'inspection.aggregate_site', 'open_actions', { hib: false, source: 'inspection-db.aggregate' }),
  M('inspection.overdue_actions', 'Overdue corrective actions', 'Actions correctives en retard', 'inspection', 'count', 'open actions with due_date < today', 'current', null, 'inspection.aggregate_site', 'overdue_actions', { hib: false, source: 'inspection-db.aggregate' }),
  // Assets — register hygiene (today), effort (nightly snapshot).
  M('assets.total', 'Assets in register', 'Actifs au registre', 'assets', 'count', 'COUNT assets for the site labels', 'current', null, 'assets.hygiene_site', 'total', { owner: 'asset-manager', source: 'assets-db.getHygieneSummary' }),
  M('assets.no_owner', 'Assets without user', 'Actifs sans utilisateur', 'assets', 'count', 'HYGIENE_KINDS.no_owner', 'current', null, 'assets.hygiene_site', 'no_owner', { hib: false, source: 'assets-db.HYGIENE_KINDS' }),
  M('assets.no_age', 'Assets without acquisition date', 'Actifs sans date d’acquisition', 'assets', 'count', 'HYGIENE_KINDS.no_age (acquisition_date IS NULL OR = \'\')', 'current', null, 'assets.hygiene_site', 'no_age', { hib: false, source: 'assets-db.HYGIENE_KINDS' }),
  M('assets.no_cost', 'Assets without cost', 'Actifs sans coût', 'assets', 'count', 'HYGIENE_KINDS.no_cost (purchase_cost IN (\'0.00\',\'0\',\'\'))', 'current', null, 'assets.hygiene_site', 'no_cost', { hib: false, source: 'assets-db.HYGIENE_KINDS' }),
  M('assets.no_asset_tag', 'Assets without QR code', 'Actifs sans QR code', 'assets', 'count', 'HYGIENE_KINDS.no_asset_tag (barcode empty)', 'current', null, 'assets.hygiene_site', 'no_asset_tag', { hib: false, source: 'assets-db.HYGIENE_KINDS' }),
  M('assets.never_scanned', 'Assets never scanned', 'Actifs jamais scannés', 'assets', 'count', 'HYGIENE_KINDS.never_scanned', 'current', null, 'assets.hygiene_site', 'never_scanned', { hib: false, source: 'assets-db.HYGIENE_KINDS' }),
  M('assets.ghost', 'Ghost assets (> 90 d after a clean scan)', 'Actifs fantômes (> 90 j)', 'assets', 'count', 'HYGIENE_KINDS.ghost', 'current', null, 'assets.hygiene_site', 'ghost', { hib: false, source: 'assets-db.HYGIENE_KINDS' }),
  M('assets.completeness_pct', 'Register completeness', 'Complétude du registre', 'assets', '%', 'mean of present-pct over owner / age / cost; null when total = 0', 'current', 'sla-percent', 'assets.hygiene_site', 'completeness_pct', { source: 'assets-db.getHygieneSummary' }),
  M('assets.effort_score', 'Asset-manager effort score', 'Score d’effort du responsable parc', 'assets', 'points', 'round(100 × mean(cost, age, owner, scan, tag, enrolled present-rates)) — nightly snapshot', 'current', 'site-composite', 'assets.effort_site', 'effort_score', { source: 'assets-db.getEffortLeaderboard' }),
  M('assets.effort_rank', 'Effort rank', 'Rang d’effort', 'assets', 'rank', 'rank among sites with ≥ MIN_RANKED_ASSETS', 'current', null, 'assets.effort_site', 'rank', { hib: false, source: 'assets-db.getEffortLeaderboard' }),
  M('assets.effort_delta_30d', 'Effort Δ 30 days', 'Effort Δ 30 jours', 'assets', 'points', 'score − score at asOf − 30 d (null when not comparable)', 'current', null, 'assets.effort_site', 'delta', { source: 'assets-db.getEffortLeaderboard' }),
  // Tracker — month-to-date vs pro-rated target.
  M('tracker.site_score_pct', 'Activity tracker site score', 'Score du tracker d’activités (site)', 'tracker', '%', 'Σ effective weight × attainment (capped 1.0) over active activities', 'ytd', 'tracker-executive', 'tracker.site', 'score_pct', { owner: 'site-coordinator', source: 'tracker-pptx.ss' }),
  M('tracker.site_green', 'Activities GREEN', 'Activités en VERT', 'tracker', 'count', 'activities whose attainment ≥ policy tracker-activity.green', 'ytd', null, 'tracker.site', 'g', { source: 'tracker-pptx.ss' }),
  M('tracker.site_amber', 'Activities AMBER', 'Activités en ORANGE', 'tracker', 'count', 'activities between amber and green cut-offs', 'ytd', null, 'tracker.site', 'a', { hib: false, source: 'tracker-pptx.ss' }),
  M('tracker.site_red', 'Activities RED', 'Activités en ROUGE', 'tracker', 'count', 'activities below the amber cut-off', 'ytd', null, 'tracker.site', 'r', { hib: false, source: 'tracker-pptx.ss' }),
  M('tracker.fleet_score_pct', 'Activity tracker fleet score', 'Score du tracker (flotte)', 'tracker', '%', 'mean of site scores over active sites', 'ytd', 'tracker-executive', 'tracker.fleet', 'avg_pct', { source: 'tracker-pptx.fleetStats' }),
  M('tracker.fleet_attainment_pct', 'Fleet attainment', 'Atteinte flotte', 'tracker', '%', 'GREEN activities / scored activities × 100', 'ytd', 'tracker-executive', 'tracker.fleet', 'attainment_pct', { source: 'tracker-pptx.fleetStats' }),
  // WAN — latest weekly snapshot per uplink (Meraki, calibrated % Time Up).
  M('wan.wan1_availability_pct', 'WAN1 availability (% Time Up)', 'Disponibilité WAN1 (% Time Up)', 'wan', '%', 'calibrated % Time Up (loss ≥ wan_timeup_loss_pct per sample = down), latest weekly snapshot', 'week', 'wan-availability', 'wan.latest_site', 'wan1_availability_pct', { source: 'wan_link_snapshots' }),
  M('wan.wan2_availability_pct', 'WAN2 availability (% Time Up)', 'Disponibilité WAN2 (% Time Up)', 'wan', '%', 'same as wan1 for the second uplink', 'week', 'wan-availability', 'wan.latest_site', 'wan2_availability_pct', { source: 'wan_link_snapshots' }),
  M('wan.wan1_loss_pct', 'WAN1 packet loss', 'Perte de paquets WAN1', 'wan', '%', 'mean lossPercent over the week', 'week', null, 'wan.latest_site', 'wan1_loss_pct', { hib: false, source: 'wan_link_snapshots' }),
  M('wan.wan1_latency_ms', 'WAN1 latency', 'Latence WAN1', 'wan', 'ms', 'mean latencyMs over the week', 'week', null, 'wan.latest_site', 'wan1_latency_ms', { hib: false, source: 'wan_link_snapshots' }),
  // Programme scores — the two authoritative models, registered as metrics (policies as data).
  M('programme.site_score', 'Programme score (sbDims)', 'Score programme (sbDims)', 'programme', 'points', '6 dims × 0/1/2 ÷ 12 × 100 over a rolling 3-month window — the author’s model, ported verbatim', 'rolling3m', 'site-score', 'programme.site_score', 'score', { source: 'services/siteScore.js' }),
  M('programme.composite', 'Operational composite (4 dims)', 'Composite opérationnel (4 dimensions)', 'programme', 'points', 'weighted 40/20/20/20 mean renormalised over present dims (helpdesk SLA, inspections, meetings, assets)', 'month', 'site-composite', 'programme.composite', 'score', { source: 'services/siteScoreboard.js' }),
];

// WAN report band (≥ target → green, ≥ target × 0.9 → amber) expressed as a policy on the
// ratio value/target so merakiWanQuality.statusColor and infraHealth read the same numbers.
const EXTRA_POLICIES = { 'wan-availability': { scale: 'target-ratio', green: 1.0, amber: 0.9, source: 'services/merakiWanQuality.js statusColor' } };
for (const [n, p] of Object.entries(EXTRA_POLICIES)) if (!KpiRag.POLICIES[n]) KpiRag.definePolicy(n, p);

// ── Window resolution ────────────────────────────────────────────────────────────────
function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}`, year: y, month: m };
}
/** window param → { kind, label, from, to, year, month } (dates ISO, UTC). */
function resolveWindow(kind, win, now = new Date()) {
  const ymNow = now.toISOString().slice(0, 7);
  if (kind === 'month' || kind === 'ytd') {
    const ym = /^\d{4}-\d{2}$/.test(win || '') ? win : ymNow;
    const b = monthBounds(ym);
    return kind === 'ytd' ? { kind, label: ym, from: `${b.year}-01-01`, to: b.to, year: b.year, month: b.month } : { kind, label: ym, ...b };
  }
  if (kind === 'rolling3m' || kind === 'rolling13w') {
    const to = /^\d{4}-\d{2}-\d{2}$/.test(win || '') ? win : now.toISOString().slice(0, 10);
    const d = new Date(to + 'T00:00:00Z');
    if (kind === 'rolling3m') d.setUTCMonth(d.getUTCMonth() - 3); else d.setUTCDate(d.getUTCDate() - 91);
    const from = d.toISOString().slice(0, 10);
    return { kind, label: `${from}..${to}`, from, to };
  }
  if (kind === 'week') {
    // ISO week "YYYY-Www" or a date inside it; default = the PREVIOUS full week (the report period).
    let d;
    const m = /^(\d{4})-W(\d{2})$/.exec(win || '');
    if (m) { const jan4 = new Date(Date.UTC(+m[1], 0, 4)); const dow = jan4.getUTCDay() || 7; d = new Date(jan4); d.setUTCDate(jan4.getUTCDate() - dow + 1 + (+m[2] - 1) * 7); }
    else { d = /^\d{4}-\d{2}-\d{2}$/.test(win || '') ? new Date(win + 'T00:00:00Z') : new Date(now); if (!m && !win) d.setUTCDate(d.getUTCDate() - 7); const dow = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - dow + 1); }
    const to = new Date(d); to.setUTCDate(d.getUTCDate() + 6);
    return { kind, label: d.toISOString().slice(0, 10), from: d.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  return { kind: 'current', label: now.toISOString().slice(0, 10), from: null, to: now.toISOString().slice(0, 10) };
}

// ── Readers ──────────────────────────────────────────────────────────────────────────
// deps: { rdb, mdb, idb, adb, tracker (loadTracker), trackerScore ({ss,fleetStats}), siteResolve, listSites, aliases }
// site: canonical site_id (number). A reader returns ONE record (fields for several metrics).
const READERS = {
  async 'helpdesk.calendar_month'(d, { site, win }) {
    const r = await d.rdb.getCalendarMonthlyHelpdesk(site, win.year, win.month);
    if (!r) return null; // site has no Zoho group → not measured
    return { inbound: r.inbound, closed: r.closed, close_pct: r.close_pct, sla_res_pct: r.sla_res_pct, sla_reply_pct: r.sla_reply_pct };
  },
  async 'helpdesk.window'(d, { site, win }) {
    const r = await d.rdb.getSiteHelpdeskWindow(site, win.from, win.to);
    return r || null;
  },
  async 'meetings.insights_site'(d, { site, win }) {
    const code = (await codeFor(d, site)).meetings_code; if (!code) return null;
    const ins = await d.mdb.insights({ site: code, from: win.from, to: win.to });
    const lb = (ins.site_leaderboard || []).find((r) => r.site === code) || {};
    const hm = (ins.compliance_heatmap || []).find((r) => r.site === code) || {};
    const k = ins.kpis || {};
    return { meetings_count: hm.meetings_count ?? lb.meetings ?? null, engagement_1: hm.e1 ?? null, diffused_48h_pct: hm.e2 ?? null, champion_pct: hm.e3 ?? null, escalation_disc: hm.e5 ?? null,
      score_pct: lb.score == null ? null : (lb.score <= 1 ? Math.round(lb.score * 100) : Math.round(lb.score)), open: lb.open ?? k.open_issues ?? null, overdue: lb.overdue ?? k.overdue ?? null };
  },
  async 'inspection.aggregate_site'(d, { site, win }) {
    const code = (await codeFor(d, site)).inspection_code; if (!code) return null;
    const a = await d.idb.aggregate({ site: code, from: win.from, to: win.to });
    const fs = a.findingStatus || []; const n = (s) => Number((fs.find((x) => x.status === s) || {}).n) || 0;
    const applicable = ['ok', 'minor', 'major', 'critical', 'opp'].reduce((t, s) => t + n(s), 0);
    return { total: a.counts ? a.counts.total : null, critical_count: a.counts ? a.counts.critical_count : null, conformity_pct: applicable ? Math.round(n('ok') / applicable * 100) : null, open_actions: a.open_actions, overdue_actions: a.overdue_actions };
  },
  async 'assets.hygiene_site'(d, { site }) {
    const labels = await assetLabelsFor(d, site); if (!labels.length) return null;
    const acc = { total: 0, no_owner: 0, no_age: 0, no_cost: 0, no_asset_tag: 0, never_scanned: 0, ghost: 0 };
    for (const label of labels) {
      const s = await d.adb.getHygieneSummary({ site: label }); if (!s) continue;
      acc.total += Number(s.total) || 0;
      for (const k of Object.keys(acc)) if (k !== 'total') acc[k] += Number((s.by_kind || {})[k]) || 0;
    }
    const pres = (k) => acc.total ? 1 - acc[k] / acc.total : null;
    acc.completeness_pct = acc.total ? Math.round(100 * (pres('no_owner') + pres('no_age') + pres('no_cost')) / 3) : null;
    return acc;
  },
  async 'assets.effort_site'(d, { site }) {
    const code = (await codeFor(d, site)).meetings_code; if (!code) return null;
    const lb = await d.adb.getEffortLeaderboard({});
    const r = require('./assetEffortForSite').effortForSite(code, { leaderboard: lb, aliases: d.aliases || require('./scoreboardAliases') });
    return r ? { effort_score: r.score, rank: r.rank, delta: r.delta } : null;
  },
  async 'tracker.site'(d, { site, win }) {
    const code = (await codeFor(d, site)).tracker_code; if (!code) return null;
    const D = await d.tracker.loadTracker(); if (!D || !(D.activeSites || []).includes(code)) return null;
    const s = d.trackerScore.ss(D, code, win.year || new Date().getUTCFullYear(), win.month || new Date().getUTCMonth() + 1);
    return { score_pct: s.active ? Math.round(s.avg * 100) : null, g: s.g, a: s.a, r: s.r };
  },
  async 'tracker.fleet'(d, { win }) {
    const D = await d.tracker.loadTracker(); if (!D) return null;
    const f = d.trackerScore.fleetStats(D, D.activeSites || [], win.year || new Date().getUTCFullYear(), win.month || new Date().getUTCMonth() + 1);
    return { avg_pct: f && f.avg != null ? Math.round(f.avg * 100) : null, attainment_pct: f && f.attainment != null ? Math.round(f.attainment * 100) : null };
  },
  async 'wan.latest_site'(d, { site }) {
    const rows = await d.rdb.getWanSnapshots({ site_id: site, period_type: 'week' });
    if (!rows || !rows.length) return null;
    const latest = {}; for (const r of rows) { const k = r.uplink; if (!latest[k] || String(r.period_start) > String(latest[k].period_start)) latest[k] = r; }
    const out = {}; for (const [u, r] of Object.entries(latest)) { out[`${u}_availability_pct`] = r.availability_pct ?? null; out[`${u}_loss_pct`] = r.loss_pct ?? null; out[`${u}_latency_ms`] = r.latency_ms ?? null; }
    return out;
  },
  async 'programme.site_score'(d, { site }) { return d.programme ? d.programme.siteScore(site) : null; },
  async 'programme.composite'(d, { site }) { return d.programme ? d.programme.composite(site) : null; },
};

// resolveSite is pure + synchronous; on PostgreSQL the readers return Promises, so the lists
// are awaited HERE and handed in as arrays (the await-precedence rule: never chain on a Promise).
async function codeFor(d, site) {
  if (d.codeFor) return d.codeFor(site);
  const { resolveSite } = require('./siteResolve');
  const sites = await (d.listSites ? d.listSites({ includeInactive: true }) : d.rdb.listSites({ includeInactive: true }));
  const codes = {};
  for (const m of ['meetings', 'inspection', 'tracker']) codes[m] = await d.rdb.listSiteModuleCodes(m);
  return resolveSite({ listSites: () => sites, listSiteModuleCodes: (m) => codes[m] || [],
    inspectionSiteCode: d.idb && d.idb.siteNameToCode, trackerSiteCode: d.tracker && d.tracker.siteNameToCode, meetingsSiteCode: d.mdb && d.mdb.siteNameToCode }, site) || {};
}
async function assetLabelsFor(d, site) {
  if (d.assetLabelsFor) return d.assetLabelsFor(site);
  const code = (await codeFor(d, site)).meetings_code; if (!code) return [];
  const aliases = d.aliases || require('./scoreboardAliases');
  const lookups = await d.adb.getAssetLookups();
  return (lookups && lookups.sites || []).filter((l) => aliases.assetLabelToCode(l) === code);
}

// ── Registry object ──────────────────────────────────────────────────────────────────
function createRegistry(rows = SEED) {
  const map = new Map(rows.map((r) => [r.key, r]));
  return {
    list({ module, status = 'published' } = {}) { return [...map.values()].filter((m) => (!module || m.module === module) && (!status || m.status === status)); },
    get(key) { return map.get(key) || null; },
    has(key) { return map.has(key); },
    keys() { return [...map.keys()]; },
    upsert(m) { map.set(m.key, { ...(map.get(m.key) || {}), ...m }); },
    policies() { return KpiRag.POLICIES; },
    /** Evaluate one metric for a site. Never throws: { key, site, window, value, unit, rag, as_of, error? }. */
    async resolve(key, { site, window, deps, now = new Date() }) {
      const m = map.get(key); if (!m) return null;
      const win = resolveWindow(m.window_kind, window, now);
      const base = { key: m.key, name: m.name, module: m.module, unit: m.unit, site: site == null ? null : Number(site), window: { kind: win.kind, label: win.label, from: win.from, to: win.to }, as_of: now.toISOString() };
      const reader = READERS[m.reader];
      if (!reader) return { ...base, value: null, rag: 'NA', error: `reader not wired: ${m.reader}` };
      try {
        const rec = await reader(deps, { site: site == null ? null : Number(site), win });
        const v = rec && rec[m.field] != null && Number.isFinite(Number(rec[m.field])) ? Number(rec[m.field]) : null;
        return { ...base, value: v, rag: ragFor(m, v), record: rec || null };
      } catch (e) { return { ...base, value: null, rag: 'NA', error: String(e && e.message || e).slice(0, 200) }; }
    },
  };
}
function ragFor(m, v) {
  if (!m.rag_policy || v == null) return 'NA';
  const p = KpiRag.POLICIES[m.rag_policy]; if (!p) return 'NA';
  const x = p.scale === 'ratio' ? v / 100 : v; // ratio policies read a 0-1 attainment; % metrics are 0-100
  if (p.scale === 'target-ratio') return 'NA';   // needs a target: evaluated by the caller that knows it
  return KpiRag.rag(x, m.rag_policy);
}

// ── Boot loader ──────────────────────────────────────────────────────────────────────
/**
 * @param {object} o  { pg (services/pgDb handle, optional), log }
 * Returns the registry. DB policies override code; DB metric rows override the seed; seed rows
 * missing from the DB are inserted (ON CONFLICT DO NOTHING) so the committee can edit them.
 */
async function load({ pg = null, log = () => {} } = {}) {
  const reg = createRegistry(SEED.map((m) => ({ ...m })));
  if (!pg) return reg;
  try {
    const pols = await pg.prepare('SELECT name, scale, green, amber, source FROM kpi_rag_policies').all();
    for (const p of pols) { try { KpiRag.definePolicy(p.name, { scale: p.scale || 'ratio', green: Number(p.green), amber: Number(p.amber), source: p.source || 'kpi_rag_policies' }); } catch (e) { log(`[metrics] policy ${p.name} rejected: ${e.message}`); } }
    for (const n of Object.keys(EXTRA_POLICIES)) if (!pols.find((p) => p.name === n)) await pg.prepare('INSERT INTO kpi_rag_policies (name, scale, green, amber, source) VALUES (?, ?, ?, ?, ?) ON CONFLICT (name) DO NOTHING').run(n, EXTRA_POLICIES[n].scale, EXTRA_POLICIES[n].green, EXTRA_POLICIES[n].amber, EXTRA_POLICIES[n].source);
    const rows = await pg.prepare('SELECT key, name, module, unit, formula, window_kind, rag_policy, reader, owner_role, status FROM metric_registry').all();
    const inDb = new Set(rows.map((r) => r.key));
    for (const r of rows) reg.upsert({ ...r, rag_policy: r.rag_policy || null });
    let inserted = 0;
    for (const m of SEED) if (!inDb.has(m.key)) {
      await pg.prepare('INSERT INTO metric_registry (key, name, module, unit, formula, window_kind, rag_policy, reader, owner_role, status) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (key) DO NOTHING')
        .run(m.key, m.name, m.module, m.unit, m.formula, m.window_kind, m.rag_policy, m.reader, m.owner_role, m.status); inserted++;
    }
    log(`[metrics] registry loaded: ${reg.keys().length} metrics (${rows.length} from DB, ${inserted} seeded), ${Object.keys(KpiRag.POLICIES).length} RAG policies`);
  } catch (e) { log(`[metrics] registry DB load failed (seed in use): ${e.message}`); }
  return reg;
}

let _current = null;
function current() { if (!_current) _current = createRegistry(SEED.map((m) => ({ ...m }))); return _current; }
function setCurrent(r) { _current = r; return r; }

module.exports = { SEED, READERS, WINDOW_KINDS, EXTRA_POLICIES, createRegistry, resolveWindow, load, current, setCurrent, ragFor };
