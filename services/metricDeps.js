'use strict';
// F-DATA-03 — ONE place that builds what the metric readers (services/metricRegistry.js READERS) need.
//
// WHY: six routes each built their own `readerDeps` object and none of them supplied `deps.programme`, so the two
// PUBLISHED programme metrics (programme.site_score, programme.composite) were null on every surface, for ever —
// a published figure that can never be computed. Here the reader dependencies are derived once:
//
//   build(o)      the full production set (rdb, mdb, idb, adb, tracker, trackerScore, commitmentStore, programme)
//                 — what a route hands to registry.resolve();
//   complete(d)   adds `programme` to a deps object that carries rdb + mdb + idb but no programme, WITHOUT
//                 requiring any database module (a test stub stays a stub). registry.resolve() calls it, so
//                 every existing caller is wired with no route change;
//   integrity()   published metrics whose reader, or a dependency of it, nothing provides ("reader not wired").
//
// The programme pair sits behind report_config `metric_programme_readers` (default '0' = today: not computed,
// value null). Reason: a number would appear where "—" was, and the two scores are NOT certified (decisions
// D-01 / D-02 / D-03 pending) — turning it on is a KPI-committee + model-author decision. The author's models are
// not edited: the score is services/siteScore.computeSiteScore on the coordinator report's own inputs
// (services/siteReportDeps scoreInputs, rolling 3 months) and the composite is services/siteScoreboard on
// services/scoreboardData — the same code the site report and the scoreboard e-mail already run.

const SWITCH = 'metric_programme_readers';
const CFG_TTL_MS = 30 * 1000;
const BOARD_TTL_MS = 60 * 1000;

// reader → the deps keys it cannot work without (a reader absent from this map needs rdb only, or nothing).
const REQUIRES = {
  'helpdesk.calendar_month': ['rdb'], 'helpdesk.window': ['rdb'], 'changes.window': ['rdb'], 'wan.latest_site': ['rdb'],
  'meetings.insights_site': ['rdb', 'mdb'], 'inspection.aggregate_site': ['rdb', 'idb'],
  'assets.hygiene_site': ['rdb', 'adb'], 'assets.effort_site': ['rdb', 'adb'],
  'tracker.site': ['rdb', 'tracker', 'trackerScore'], 'tracker.fleet': ['tracker', 'trackerScore'],
  'commitments.summary': ['commitmentStore'],
  'programme.site_score': ['programme'], 'programme.composite': ['programme'],
};
// What build() supplies. Kept as data so integrity() needs no database.
const PROVIDES = ['rdb', 'mdb', 'idb', 'adb', 'tracker', 'trackerScore', 'commitmentStore', 'programme'];
// Readers that return null while their switch is at its default (today's behaviour), so nobody reads a silent
// "—" as a wiring fault.
const SWITCHED = { 'programme.site_score': SWITCH, 'programme.composite': SWITCH };

const _canProgramme = (d) => !!(d && d.rdb && typeof d.rdb.listSiteModuleCodes === 'function'
  && d.mdb && typeof d.mdb.getSiteScoreInputs === 'function' && d.idb && typeof d.idb.getSiteScoreInputs === 'function');

/** The programme readers on top of base deps { rdb, mdb, idb, adb?, cfg?, now? }. Never throws at build time. */
function programmeFor(d) {
  let cfgAt = 0, cfgVal = null;
  async function enabled() {
    if (d.cfg) return String(d.cfg[SWITCH] || '0') === '1';                 // injected (tests, CLIs)
    const t = Date.now();
    if (cfgVal == null || t - cfgAt > CFG_TTL_MS) {
      try { const c = await require('./reportConfig').getConfig(d.rdb.db); cfgVal = String((c && c[SWITCH]) || '0'); }
      catch (_) { cfgVal = '0'; }                                            // unreadable config = today's behaviour
      cfgAt = t;
    }
    return cfgVal === '1';
  }
  // site_id → meetings-namespace code (the namespace both score models are keyed on). No code → not measured.
  let codesP = null;
  const codes = () => (codesP || (codesP = Promise.resolve(d.rdb.listSiteModuleCodes('meetings')).then((r) => r || [])));
  async function codeOf(site) {
    if (site == null) return null;
    const row = (await codes()).find((r) => Number(r.site_id) === Number(site));
    return row ? row.code : null;
  }
  const srd = () => require('./siteReportDeps').buildSiteReportDeps({ meetingsDb: d.mdb, inspectionDb: d.idb, reportsDb: d.rdb, assetsDb: d.adb });
  const boards = new Map();   // 'YYYY-MM' → { at, p }
  function board(year, m, asOf) {
    const k = `${year}-${String(m).padStart(2, '0')}`;
    const hit = boards.get(k);
    if (hit && Date.now() - hit.at < BOARD_TTL_MS) return hit.p;
    const sb = {
      listSiteModuleCodes: (mod) => d.rdb.listSiteModuleCodes(mod),
      getCalendarMonthlyHelpdesk: (s, y, mm) => d.rdb.getCalendarMonthlyHelpdesk(s, y, mm),
      getMeetingsInsights: (a) => d.mdb.insights(a),
      getInspectionAggregate: (a) => d.idb.aggregate(a),
      getEffortLeaderboard: (a) => (d.adb && d.adb.getEffortLeaderboard ? d.adb.getEffortLeaderboard(a) : { rows: [] }),
    };
    const p = require('./scoreboardData').loadScoreboardData({ month: { year, m }, asOf, deps: sb })
      .then((sd) => require('./siteScoreboard').buildSiteScoreboard(sd.perSite, { prev: sd.prev }));
    p.catch(() => boards.delete(k));                                         // a failed gather is not cached
    boards.set(k, { at: Date.now(), p });
    return p;
  }
  const today = () => (d.now ? new Date(d.now()) : new Date()).toISOString().slice(0, 10);

  return {
    switch: SWITCH,
    enabled,
    /** sbDims programme score over the rolling 3 months ending at the window's last day. null = not computed / not applicable. */
    async siteScore(site, win) {
      if (!(await enabled())) return null;
      const code = await codeOf(site); if (!code) return null;
      const asOf = (win && win.to) || today();
      const si = await srd().scoreInputs(code, { as_of: asOf });
      const r = require('./siteScore').computeSiteScore(si.inputs, si.window, null);
      if (!r.applicable) return null;                                        // nothing measured ≠ a score
      return { score: r.score, points: r.points, model_rag: r.rag, window_from: si.window.from, window_to: si.window.to, certified: false };
    },
    /** Operational 4-dimension composite for the window's month. null = not computed / no dimension measured. */
    async composite(site, win) {
      if (!(await enabled())) return null;
      const code = await codeOf(site); if (!code) return null;
      const t = today();
      const year = (win && win.year) || Number(t.slice(0, 4)); const m = (win && win.month) || Number(t.slice(5, 7));
      const sb = await board(year, m, (win && win.to) || t);
      const row = (sb.rows || []).find((x) => x.code === code);
      if (!row || !row.applicable || row.score == null) return null;
      return { score: row.score, model_rag: row.rag, coverage_present: row.coverage.present, coverage_total: row.coverage.total, rank: row.rank, certified: false };
    },
  };
}

const _done = new WeakMap();
/** Same deps + `programme` when it can be derived from what is already there. A stub without mdb/idb is returned untouched. */
function complete(d) {
  if (!d || typeof d !== 'object' || d.programme || !_canProgramme(d)) return d;
  let w = _done.get(d);
  if (!w) { w = { ...d, programme: programmeFor(d) }; _done.set(d, w); }
  return w;
}

/**
 * The production reader deps, built once per call site. Every module can be injected; anything absent is
 * required lazily (so requiring this file opens no database).
 * @param {object} [o] { rdb, mdb, idb, adb, tracker, trackerScore, commitmentStore, cfg, now }
 */
function build(o = {}) {
  const rdb = o.rdb || require('../reports-db');
  const d = {
    rdb, mdb: o.mdb || require('../meetings-db'), idb: o.idb || require('../inspection-db'), adb: o.adb || require('../assets-db'),
    tracker: o.tracker || require('../tracker-db'), trackerScore: o.trackerScore || require('../tracker-pptx'),
  };
  if (o.cfg) d.cfg = o.cfg;
  if (o.now) d.now = o.now;
  let cs = o.commitmentStore || null;
  if (!cs && typeof rdb.pgHandle === 'function') {
    try { cs = require('./commitmentStore').makeCommitmentStore({ prepare: (sql) => rdb.pgHandle().prepare(sql), runTransaction: (fn) => rdb.pgHandle().runTransaction(fn) }, { isPg: true }); }
    catch (_) { cs = null; }
  }
  if (cs) d.commitmentStore = cs;
  d.programme = programmeFor(d);
  return d;
}

/**
 * Published metrics that nothing can compute. rows = registry rows (default: every row of `registry.list()`).
 * `provided` = the deps keys available (default: what build() supplies).
 * @returns {Array<{key, reader, problem}>}  problem starts with "reader not wired"
 */
function integrity(registry, { provided = PROVIDES, readers = null } = {}) {
  const R = readers || require('./metricRegistry').READERS;
  const have = new Set(provided);
  const out = [];
  for (const m of registry.list({ status: 'published' })) {
    if (typeof R[m.reader] !== 'function') { out.push({ key: m.key, reader: m.reader, problem: `reader not wired: no reader named ${m.reader}` }); continue; }
    const missing = (REQUIRES[m.reader] || []).filter((k) => !have.has(k));
    if (missing.length) out.push({ key: m.key, reader: m.reader, problem: `reader not wired: ${m.reader} needs deps.${missing.join(', deps.')}` });
  }
  return out;
}

/** "wired" | "wired — computed only when <switch> = 1 (default 0)" | "reader not wired: …" for one registry row. */
function wiringOf(m, { provided = PROVIDES, readers = null } = {}) {
  const R = readers || require('./metricRegistry').READERS;
  if (typeof R[m.reader] !== 'function') return `reader not wired: no reader named ${m.reader}`;
  const have = new Set(provided);
  const missing = (REQUIRES[m.reader] || []).filter((k) => !have.has(k));
  if (missing.length) return `reader not wired: ${m.reader} needs deps.${missing.join(', deps.')}`;
  return SWITCHED[m.reader] ? `wired — computed only when ${SWITCHED[m.reader]} = 1 (default 0: not computed, shown as "—")` : 'wired';
}

module.exports = { build, complete, programmeFor, integrity, wiringOf, REQUIRES, PROVIDES, SWITCHED, SWITCH };
