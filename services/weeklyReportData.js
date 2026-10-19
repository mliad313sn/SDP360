'use strict';

/**
 * weeklyReportData — the loader behind the weekly report e-mail.
 *
 * Turns a site code + ISO week into everything the composer needs, or an
 * operator-facing reason why nothing should be sent. It NEVER sends, renders or
 * logs — Tasks 3-6 own that.
 *
 *   loadWeeklyReportData({ siteCode, year, week, deps })
 *     → { ok:true, report, week:{year,week,label,start,end}, assets }
 *     | { ok:false, reason:'<english, operator-facing>' }
 *
 * The reasons are read by the Service Desk Manager in the CLI log and the admin
 * card — the coordinator gets no e-mail at all — so each non-send outcome is
 * distinguishable and says what to DO about it.
 *
 * Every reader below is async under PostgreSQL. Await each one, and never chain
 * onto the dispatcher (`await f().method()` binds the method to the Promise —
 * see tests/await-precedence.test.js).
 */

// Resolved lazily and ONLY for the deps the caller did not inject — requiring
// reports-db.js/assets-db.js opens a real database connection as a side effect,
// so a fully-injected call (every test) must never touch them. A spread of
// getter-backed defaults would evaluate all three eagerly and defeat that.
const DEFAULTS = {
  reportsDb: () => require('../reports-db.js'),
  assetsDb:  () => require('../assets-db.js'),
  aliases:   () => require('./scoreboardAliases.js'),
};
function _resolveDeps(deps) {
  const out = {};
  for (const [name, load] of Object.entries(DEFAULTS)) {
    out[name] = (deps && deps[name]) || load();
  }
  return out;
}

// The label fold + the per-kind sum now live in services/assetHygieneForSite.js
// so the site-report page and the monthly report reuse them rather than growing
// a third copy. Behaviour here is unchanged — the two functions moved verbatim,
// including the "never invert ALIAS" warning that guards the fold direction.
const { labelsForCode: _labelsForCode, sumHygieneByKind: _loadHygiene } = require('./assetHygieneForSite.js');

/**
 * Fold the effort leaderboard by code and RECOMPUTE the rank.
 *
 * The fold+rank logic now lives in the shared, synchronous
 * services/assetEffortForSite.js so the monthly report can reuse it. This wrapper
 * fetches the board (async under PostgreSQL) and maps the shared shape onto the
 * weekly contract, which is `{ effort_score, rank }` and NOTHING else.
 *
 * `delta`/`of` are deliberately dropped here: delta is a ~30-day lookback, so on a
 * weekly cadence it barely moves and would read as a dead number.
 */
async function _loadEffort(assetsDb, aliases, code) {
  const board = await assetsDb.getEffortLeaderboard({});
  const e = require('./assetEffortForSite.js').effortForSite(code, { leaderboard: board, aliases });
  return e ? { effort_score: e.score, rank: e.rank } : null;
}

async function loadWeeklyReportData({ siteCode, year, week, deps } = {}) {
  const { reportsDb, assetsDb, aliases } = _resolveDeps(deps);

  // 1 · resolve the code in the meetings namespace.
  //
  // getSiteIdByModuleCode returns { site_id, name, zoho_group } — NOT { id }.
  // The `!row.site_id` guard is load-bearing, not defensive noise: listReports
  // does `if (site_id) { sql += ' AND wr.site_id=?' }` in BOTH backends, so a
  // falsy site_id silently DROPS the filter and returns every site's report for
  // that week. Combined with a {site_id}-vs-{id} mis-destructure that mails one
  // site's report to a different site's coordinator, with no error anywhere.
  // Fail closed before undefined can ever reach listReports.
  const resolved = await reportsDb.getSiteIdByModuleCode('meetings', siteCode);
  if (!resolved || !resolved.site_id) {
    return { ok: false, reason: `site "${siteCode}" has no meetings module code — cannot send a weekly report` };
  }
  const siteId = resolved.site_id;

  // 2 · the site must still be active. listSites() defaults to active-only.
  const sites = await reportsDb.listSites();
  if (!(sites || []).some(s => s.id === siteId)) {
    return { ok: false, reason: `site "${siteCode}" is inactive — cannot send a weekly report` };
  }

  // 3 · find the week's report header.
  const reports = await reportsDb.listReports(siteId, year, week);
  const header = (reports || [])[0];
  if (!header) {
    return { ok: false, reason: `no report for site "${siteCode}" in ${year}-W${week} — nothing to send` };
  }

  // 4 · status gate. Four values, not two: server.js whitelists
  // draft|in_progress|ready|submitted and reports.html auto-advances
  // draft → in_progress (any section saved) → ready (all four done). The schema
  // comment in reports-db.js still says "draft | submitted" and is stale.
  //
  // `ready` gets its own reason on purpose. It is the most common real skip — a
  // coordinator who filled everything in and never clicked Submit — and telling
  // them "not submitted" is technically true and operationally useless. We do
  // NOT report "N of 4 sections": that count exists only in browser DOM classes
  // and is never persisted.
  const status = header.status;
  if (status === 'ready') {
    return {
      ok: false,
      reason: `report for site "${siteCode}" ${year}-W${week} is complete but was never submitted — ask the coordinator to click Submit`,
    };
  }
  if (status !== 'submitted') {
    return {
      ok: false,
      reason: `report for site "${siteCode}" ${year}-W${week} is not finished (status: ${status || 'unknown'})`,
    };
  }

  // 5 · the hydrated read. listReports returns headers only — no children.
  const report = await reportsDb.getReport(header.id);
  if (!report) {
    return { ok: false, reason: `no report for site "${siteCode}" in ${year}-W${week} — nothing to send` };
  }

  // The week's label and dates come from the getReport row (there is no weeks
  // reader and none is to be written).
  const weekBlock = {
    year, week,
    label: report.week_label,
    start: report.start_date,
    end:   report.end_date,
  };

  // 6 · assets. A code with no AP label gets `assets: null` so the composer omits
  // the block entirely — zeros would read as a clean site rather than an unmeasured one.
  // Real labels from the data, folded FORWARD to this code — never ALIAS inverted
  // (its keys are folded lookup keys, not DB spellings). See _labelsForCode.
  const lookups = (await assetsDb.getAssetLookups()) || {};
  const labels = _labelsForCode(lookups.sites, siteCode, aliases.assetLabelToCode);
  let assets = null;
  if (labels.length) {
    assets = {
      // The AP labels ride along so the composer can deep-link each count into
      // the Assets hygiene worklist. It needs the LABEL, not the site code: the
      // target's site filter is built from getAssetLookups().sites.
      labels,
      hygiene: await _loadHygiene(assetsDb, labels),
      effort:  await _loadEffort(assetsDb, aliases, siteCode),
    };
  }

  // Echo site_code back. Nothing downstream can re-derive it: `sites` has no code
  // column (reports-db.js:30) and getReport() returns only `site_name`. The
  // composer needs it for the subject line, and a sender that forgot to thread it
  // through would silently degrade every subject to the site name — a defect with
  // no failing test anywhere. Closing it here means the caller cannot get it wrong.
  return { ok: true, site_code: siteCode, report, week: weekBlock, assets };
}

module.exports = { loadWeeklyReportData };
