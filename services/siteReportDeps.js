'use strict';
// Binds siteReport's injected deps to the live readers, translating the real
// reader shapes into the §4 contract via siteReportAdapters. `mods` is
// injectable so this is unit-testable without DBs.
const A = require('./siteReportAdapters');
const { computeSiteScore } = require('./siteScore');
const { rollingWindow, prevDay } = require('./scoreWindow');
const { deriveSiteStatus } = require('./execSummary');
// Both PURE (no DB): safe to require at module load. assets-db is NOT — it opens
// a connection as a side effect — so it is lazy-required inside the binder only.
const { effortForSite } = require('./assetEffortForSite');
const { labelsForCode, sumHygieneByKind } = require('./assetHygieneForSite');
const scoreboardAliases = require('./scoreboardAliases');

const MODULE_NS = 'meetings';   // the report's site codes come from the meetings/inspection namespace

function buildSiteReportDeps(mods) {
  const m = mods || {
    meetingsDb: require('../meetings-db'),
    inspectionDb: require('../inspection-db'),
    reportsDb: require('../reports-db'),
  };
  const { meetingsDb, inspectionDb, reportsDb } = m;
  const aliases = m.aliases || scoreboardAliases;
  // Lazy so a fully-injected test that never touches assetEffort never opens the
  // assets DB. Injectable via mods.assetsDb.
  const _assetsDb = () => m.assetsDb || require('../assets-db');

  // The FLEET effort leaderboard is identical for every site (no site filter), so
  // fetch it ONCE per deps object and memoise the PROMISE — a batch send reusing
  // one deps object across sites must not refetch it, and concurrent callers share
  // the one in-flight fetch.
  let _effortBoard = null;
  const effortBoard = () => (_effortBoard || (_effortBoard = Promise.resolve(_assetsDb().getEffortLeaderboard({}))));

  // Same reasoning for the distinct `assets.site` labels: fleet-wide, identical
  // for every site, so fetch once per deps object and share the in-flight promise.
  let _lookups = null;
  const assetLookups = () => (_lookups || (_lookups = Promise.resolve(_assetsDb().getAssetLookups())));

  // code (HGO) → { site_id, name, zoho_group } | null
  const resolve = async (code) => (await reportsDb.getSiteIdByModuleCode(MODULE_NS, code)) || null;

  const meetingsSummary = async (code, p) =>
    A.adaptMeetingsSummary(await meetingsDb.getSiteMonthlyMeetingSummary(code, p.year, p.month));

  // PERIOD-SCOPED. inspection-db.aggregate({site,from,to}) filters on
  // inspection_date — verified. All-time would pin 30% of the composite to a
  // constant (inspections dim → always 100 once ever inspected; findings dim →
  // 0 once lifetime critical+major >= 5), which is exactly the bug this
  // sub-project exists to kill.
  const inspectionAggregate = async (code, p) =>
    A.adaptInspectionAggregate(await inspectionDb.aggregate({ site: code, ..._monthBounds(p) }));

  return {
    meetingsSummary,
    meetingsActions: async (code) => A.adaptMeetingsActions(await meetingsDb.listActions({ site: code, overdue: 1 })),
    inspectionAggregate,
    inspectionActions: async (code) => A.adaptInspectionActions(await inspectionDb.listActions({ site: code, overdue: 1 })),

    // SP2 — open-actions-by-theme summary for the email block. Reuses the PURE
    // buildSiteActions over the 3 sources (ALL non-closed, not overdue-only like
    // the two adapters above) and keeps only the counts + oldest. report follow-ups
    // come from the SP1b-lignée reader (deduped across weeks, merged folded out).
    openActions: async (code, p) => {
      const s = await resolve(code);
      if (!s) return null;
      const asOf = p.as_of || _asOfFor(p);
      const meetings = await meetingsDb.listActions({ site: code });
      const inspection = await inspectionDb.listActions({ site: code });
      const report = { actions: (await reportsDb.getSiteOpenReportActions(s.site_id)).actions };
      const { buildSiteActions } = require('./siteActionsRegister');
      const g = buildSiteActions({ meetings, inspection, report, asOf }).groups;
      const pick = (x) => ({ count: x.count, oldest: x.oldest_days });
      return {
        meetings: pick(g.meetings), inspection: pick(g.inspection), report: pick(g.report),
        total: g.meetings.count + g.inspection.count + g.report.count,
      };
    },

    // demande 1 — weekly volume + resolution-SLA trend for the site-report page's
    // HELPDESK chart. Built from the SAME getSiteHelpdeskWindow the block's KPIs
    // use, per ISO week, so the chart reconciles with the headline numbers. Only
    // resolution SLA (overdue_status) exists on request_records — no first-reply,
    // so no first-reply line is fabricated. missed_pct = overdue/inbound (null on
    // an empty week). 6 window reads per render (bounded; a single-span reader is
    // the optimisation if this ever profiles hot).
    helpdeskWeekly: async (code, p) => {
      const s = await resolve(code);
      if (!s) return null;
      const asOf = p.as_of || _asOfFor(p);
      const out = [];
      for (const w of _lastIsoWeeks(asOf, 6)) {
        const hd = (await reportsDb.getSiteHelpdeskWindow(s.site_id, w.from, w.to)) || {};
        const inbound = hd.created || 0, closed = hd.resolved || 0, overdue = hd.sla_overdue || 0;
        out.push({ label: w.label, inbound, closed, overdue,
          missed_pct: inbound > 0 ? Math.round((overdue / inbound) * 1000) / 10 : null });
      }
      return out;
    },

    helpdesk: async (code, p) => {
      const s = await resolve(code);
      if (!s) return null;                       // siteReport._safe → zeroed block
      return reportsDb.getSiteHelpdeskMonthly(s.site_id, p.year, p.month);
    },

    // THE SITE REPORT IS MONTHLY — every other block here covers the report
    // month, so the changes block does too. This deliberately differs from the
    // IT Review panel, which reads changes over a rolling 90 days because its
    // default WEEK window contains zero of them. Two products, two windows, both
    // labelled: that is a decision, not a drift.
    //
    // Takes s.site_id, NOT s.zoho_group: getSiteChangesWindow resolves the group
    // ITSELF (SELECT zoho_group FROM sites WHERE id=?). Handing it a group string
    // matches no row → an all-zero block with NO error, which _safe then swallows
    // — the "binder that looks wired can silently read zeros" pitfall.
    changes: async (code, p) => {
      const s = await resolve(code);
      if (!s) return null;                       // siteReport._safe → EMPTY.changes
      const { from, to } = _monthBounds(p);      // returns an OBJECT — destructure, never spread
      return reportsDb.getSiteChangesWindow(s.site_id, from, to);
    },

    // Changes STILL OPEN right now — no date window, deliberately. The `changes`
    // block above covers the report month, which is exactly why stalled work can
    // hide: a site reads "0 changes" in July while carrying one open since April
    // 2025. asOf is the report's own as-of date, never a live clock, so the page
    // and the emailed PDF of the same report agree on what is overdue.
    openChanges: async (code, p) => {
      const s = await resolve(code);
      if (!s) return null;                       // siteReport._safe → null → block omitted
      return reportsDb.getSiteOpenChanges(s.site_id, p.as_of || _asOfFor(p));
    },

    // Major incidents OPEN RIGHT NOW for the site's groups. A DIFFERENT
    // population from helpdesk.major_incidents, which counts MIs CREATED in the
    // report month: an incident opened in May and still running appears here and
    // not there. Both are surfaced, each labelled with what it counts.
    majorIncidents: async (code) => {
      const s = await resolve(code);
      if (!s || !s.zoho_group) return [];
      const groups = String(s.zoho_group).split(',').map(g => g.trim()).filter(Boolean);
      if (!groups.length) return [];
      return (await reportsDb.getActiveMajorIncidentsForSite(groups)) || [];
    },

    technicians: async (code, p) => {
      const s = await resolve(code);
      if (!s) return [];
      return reportsDb.getSiteTechnicianStats(s.site_id, p.year, p.month);
    },

    // The site's asset-effort standing out of the memoised fleet leaderboard.
    // effortForSite folds AP labels → codes (aliases) and re-derives rank; a code
    // with no label / no effort history → null, so the composer omits the block
    // (zeros would read as a well-kept site rather than an unmeasured one).
    assetEffort: async (code) => effortForSite(code, { leaderboard: await effortBoard(), aliases }),

    // The site's OUT-OF-COMPLIANCE assets, per hygiene kind, so the report can be
    // acted on rather than merely read. Same contract as the weekly e-mail's
    // block: labels folded FORWARD (never ALIAS inverted — see
    // assetHygieneForSite.labelsForCode), zero-count kinds dropped, and a code
    // that maps to NO label returns null so the renderer omits the section
    // entirely. Zeros would read as a spotless parc rather than an unmeasured one.
    //
    // TODAY'S SNAPSHOT, not the report month: `assets` is DELETE+INSERT
    // full-replaced nightly and asset_effort_history keeps only the composite
    // score, so no per-kind history exists to look back at. The renderer says so.
    assetHygiene: async (code) => {
      const lookups = (await assetLookups()) || {};
      const labels = labelsForCode(lookups.sites, code, aliases.assetLabelToCode);
      if (!labels.length) return null;
      const byKind = await sumHygieneByKind(_assetsDb(), labels);
      return { labels, by_kind: byKind };
    },

    // Incident-derived (documented in the spec — NOT live uptime).
    // deriveSiteStatus omits healthy sites → absent means 'operational'.
    siteStatus: async (code) => {
      const s = await resolve(code);
      if (!s || !s.zoho_group) return 'operational';
      const groups = String(s.zoho_group).split(',').map(g => g.trim()).filter(Boolean);
      if (!groups.length) return 'operational';
      const mis = (await reportsDb.getActiveMajorIncidentsForSite(groups)) || [];
      const row = { code, name: s.name, has_active_mi: mis.length > 0, open_incidents: mis.length, overdue_open: 0 };
      const out = deriveSiteStatus([row]);
      return out.length ? out[0].status : 'operational';
    },

    // The score's as-of date + its 3-MONTH ROLLING window. The score is measured
    // by its own readers, NOT derived from the monthly meetings/inspection
    // blocks above: the user's thresholds (reviews >= 8, inspections >= 3
    // "quarterly") are calibrated for ~3 months, so scoring them on one month
    // would read RED forever.
    scoreInputs: async (code, p) => {
      const asOf = p.as_of || _asOfFor(p);                    // 'YYYY-MM-DD'
      const w = rollingWindow(asOf, 3);
      const m = await meetingsDb.getSiteScoreInputs(code, w.from, w.to);
      const i = await inspectionDb.getSiteScoreInputs(code, w.from, w.to);
      // `raised` rides along as an APPLICABILITY SIGNAL, NOT A DIMENSION — it is
      // never scored. It is `resolution`'s denominator (resolution = resolved ÷
      // raised), and without it computeSiteScore cannot tell "0% of 4 issues
      // resolved" (a real, bad measurement) from "no issues at all" (nothing
      // measured). See the gate rationale in services/siteScore.js.
      return { window: w, inputs: { reviews: m.reviews, raised: m.raised, resolution: m.resolution, overdue: m.overdue, inspections: i.inspections, findings: i.findings, signoff: m.signoff } };
    },

    // The same score recomputed as-of the PREVIOUS window's end, so trend_pts is
    // like-for-like: asOf 2026-07-14 → this window {2026-04-14 … 2026-07-14} →
    // prevAsOf 2026-04-13 → prev window {2026-01-13 … 2026-04-13}. Non-overlapping
    // trailing 3 months. Returns null when the previous window has nothing to score
    // against, so a site's first quarter shows "no trend" rather than a fabricated
    // one (zeroed inputs still score 33 — overdue 0 and findings 0 each earn 2 pts
    // by inversion — which would read as a confident trend against a window that
    // never happened).
    prevScore: async (code, p) => {
      const asOf = p.as_of || _asOfFor(p);
      const prevAsOf = prevDay(rollingWindow(asOf, 3).from);   // NEVER `new Date(from) - 86400e3`
      const w = rollingWindow(prevAsOf, 3);
      const m = await meetingsDb.getSiteScoreInputs(code, w.from, w.to);
      const i = await inspectionDb.getSiteScoreInputs(code, w.from, w.to);
      if (!m.reviews && !m.raised && !i.inspections) return null;   // nothing happened → no trend
      // `raised` is passed for APPLICABILITY ONLY (it is `resolution`'s
      // denominator), never scored — see scoreInputs above + siteScore.js.
      // Without it, a previous window with issues raised but none resolved reads
      // as "nothing measured" and the trend silently disappears.
      return computeSiteScore(
        { reviews: m.reviews, raised: m.raised, resolution: m.resolution, overdue: m.overdue, inspections: i.inspections, findings: i.findings, signoff: m.signoff },
        w,
      ).score;
    },
  };
}

// The report's as-of date: the last day of the period's month, or TODAY if that
// month is still running — an MTD send must not score against a future date.
// `now` is injected: an internal new Date() makes the MTD branch untestable.
function _asOfFor(period, now = new Date()) {
  const mm = String(period.month).padStart(2, '0');
  const last = new Date(period.year, period.month, 0).getDate();   // day 0 of next month
  const monthEnd = `${period.year}-${mm}-${String(last).padStart(2, '0')}`;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return today < monthEnd ? today : monthEnd;
}

// {from,to} ISO bounds for a calendar month — inspection-db.aggregate filters
// inspection_date >= from AND <= to.
function _monthBounds(p) {
  const mm = String(p.month).padStart(2, '0');
  const last = new Date(p.year, p.month, 0).getDate();   // day 0 of next month = last day of this one
  return { from: `${p.year}-${mm}-01`, to: `${p.year}-${mm}-${String(last).padStart(2, '0')}` };
}

// ISO-8601 week number (UTC). Standard nearest-Thursday algorithm.
function _isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;                 // 1..7 (Mon..Sun)
  d.setUTCDate(d.getUTCDate() + 4 - day);         // shift to the week's Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}
const _isoDate = (d) => d.toISOString().slice(0, 10);

// The last `n` ISO weeks ending at (and including) asOf's week — Monday-aligned,
// ascending, each `{year, week, from, to, label:'W## YYYY'}`. Deterministic
// (no new Date()) so it is unit-testable.
function _lastIsoWeeks(asOfIso, n) {
  const base = new Date(asOfIso + 'T00:00:00Z');
  const dow = (base.getUTCDay() + 6) % 7;         // 0=Mon..6=Sun
  const monday = new Date(base); monday.setUTCDate(base.getUTCDate() - dow);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(monday); start.setUTCDate(monday.getUTCDate() - i * 7);
    const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
    const { year, week } = _isoWeek(start);
    out.push({ year, week, from: _isoDate(start), to: _isoDate(end), label: `W${week} ${year}` });
  }
  return out;
}

module.exports = { buildSiteReportDeps, _monthBounds, _asOfFor, _lastIsoWeeks };
