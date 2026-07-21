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

/**
 * Which REAL `assets.site` labels belong to this site code.
 *
 * ⚠ Do NOT invert `aliases.ALIAS` to get these. Its KEYS are accent-folded
 * lowercase (`sabodala`, `massawa`) because they exist to be looked up AFTER
 * folding the input — they are not the spellings stored in the database. But
 * `_assetWhere` (assets-db.js:116) filters with exact `a.site = ?`, so feeding
 * a folded key back as a filter matches ZERO rows against a real `'Sabodala'`,
 * and every site's worklist silently reads empty. An empty worklist looks like
 * a clean site, which is the exact failure the block exists to prevent.
 *
 * So we go the direction the map was designed for: take the ACTUAL distinct
 * labels from the data and fold each one FORWARD through assetLabelToCode.
 *
 * Two label vocabularies are in play and both must match:
 *   • the AP export's mine names — 'Sabodala', 'MASSAWA', 'Houndé'  → via ALIAS
 *   • a site CODE used directly as the label — 'HGO', 'MGO'         → ALIAS has
 *     no 'hgo' key, so these resolve to null and need the direct comparison.
 */
function _labelsForCode(siteLabels, siteCode, assetLabelToCode) {
  const code = String(siteCode || '').trim().toUpperCase();
  return (siteLabels || []).filter((label) => {
    if (assetLabelToCode(label) === code) return true;              // mine name
    return String(label || '').trim().toUpperCase() === code;        // literal code
  });
}

/**
 * Sum by_kind across every label folding to this code, then DROP the zeros.
 *
 * The sum has to come from per-label getHygieneSummary calls: the summary's own
 * `by_site` carries only four columns and they are present-counts (inverted
 * gaps), so it has no discovered / ghost / no_asset_tag / lifecycle_exception —
 * folding it would ship a worklist missing half its kinds.
 *
 * Zero-count kinds are dropped entirely. A block of zeros trains the reader to
 * skip the section, which costs us the non-zero weeks too.
 */
async function _loadHygiene(assetsDb, labels) {
  const totals = {};
  for (const label of labels) {
    const summary = await assetsDb.getHygieneSummary({ site: label });
    const byKind = (summary && summary.by_kind) || {};
    for (const [kind, n] of Object.entries(byKind)) {
      totals[kind] = (totals[kind] || 0) + (Number(n) || 0);
    }
  }
  const out = {};
  for (const [kind, n] of Object.entries(totals)) if (n > 0) out[kind] = n;
  return out;
}

/**
 * Fold the effort leaderboard by code and RECOMPUTE the rank.
 *
 * foldEffortByCode returns a Map (use .get, not index access) and means the
 * score across a code's labels. The raw per-label `rank` cannot survive that —
 * averaging two ranks is meaningless — so rank is re-derived as this code's
 * position among all folded codes, score-descending (code asc breaks ties so the
 * result is deterministic).
 *
 * `delta` is deliberately dropped: it is a ~30-day lookback, so on a weekly
 * cadence it barely moves and would read as a dead number.
 */
async function _loadEffort(assetsDb, aliases, code) {
  const board = await assetsDb.getEffortLeaderboard({});
  const rows = (board && board.rows) || [];
  const folded = aliases.foldEffortByCode(rows);      // Map<code, score|null>

  const score = folded.get(code);
  if (score == null) return null;

  const ordered = [...folded.entries()]
    .filter(([, s]) => s != null)
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  return { effort_score: score, rank: ordered.findIndex(([c]) => c === code) + 1 };
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
