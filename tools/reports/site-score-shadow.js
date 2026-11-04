'use strict';
// Standalone runs must read .env BEFORE any db module loads (tests/reports-cli-dotenv.test.js).
if (require.main === module) require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
// A-11 — READ-ONLY shadow report for decision D-03 ("reference site score", OPEN).
// Prints, per site, both verdicts side by side for one month so the committee can decide on
// evidence: the programme score (sbDims · 70/45 · 3-month rolling window — the coordinator
// e-mail headline) and the operational composite (4 dimensions · 75/55 · current month —
// the scoreboard e-mail). Nothing is written, mailed or switched.
//
// Usage: node tools/reports/site-score-shadow.js [--month=YYYY-MM] [--json]

const pad2 = (n) => String(n).padStart(2, '0');

function parseMonth(v, now = new Date()) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v || ''));
  if (m) return { year: Number(m[1]), m: Number(m[2]) };
  // default = last CLOSED month
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { year: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

// PURE: rows of the shadow table. `programmeBySite` = {CODE: computeSiteScore result|null}.
function shadowRows(scoreboard, programmeBySite) {
  const { publishedVerdict } = require('../../services/publishedSiteScore');
  return ((scoreboard && scoreboard.rows) || []).map((row) => {
    const v = publishedVerdict({ model: 'programme', programme: programmeBySite[row.code], operational: row });
    const p = v, o = v.other;
    const agree = p.rag && o.rag ? (p.rag === o.rag ? 'yes' : 'no') : 'n/a';
    return {
      site: row.code, name: row.name,
      programme_score: p.score, programme_rag: p.rag,
      operational_score: o.score, operational_rag: o.rag,
      agree,
    };
  });
}

function formatTable(rows, label) {
  const cell = (s, r) => (s == null ? 'non applicable' : `${s} ${String(r || '').toUpperCase()}`);
  const lines = [
    `Site score shadow — ${label} (read-only; decision D-03 is OPEN)`,
    'programme = 3 mois glissants (70/45) · operational = mois courant (75/55)',
    '',
    ['site', 'programme', 'operational', 'agree?'].join(' | '),
  ];
  for (const r of rows) lines.push([`${r.site} ${r.name || ''}`.trim(), cell(r.programme_score, r.programme_rag), cell(r.operational_score, r.operational_rag), r.agree].join(' | '));
  const n = rows.filter((r) => r.agree === 'yes').length, d = rows.filter((r) => r.agree !== 'n/a').length;
  lines.push('', `colour agreement: ${n} of ${d} comparable site(s)`);
  return lines.join('\n');
}

async function main(deps = {}) {
  const args = deps.args || Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const month = parseMonth(args.month, deps.now);
  const label = `${month.year}-${pad2(month.m)}`;
  const asOf = `${label}-${pad2(new Date(month.year, month.m, 0).getDate())}`;

  let sd, programmeScore;
  if (deps.loadScoreboardData && deps.programmeScore) {
    sd = await deps.loadScoreboardData({ month, asOf });
    programmeScore = deps.programmeScore;
  } else {
    const rdb = require('../../reports-db');
    await rdb.initPgReports();
    const sbDeps = {
      listSiteModuleCodes: rdb.listSiteModuleCodes,
      getCalendarMonthlyHelpdesk: rdb.getCalendarMonthlyHelpdesk,
      getMeetingsInsights: (a) => require('../../meetings-db').insights(a),
      getInspectionAggregate: (a) => require('../../inspection-db').aggregate(a),
      getEffortLeaderboard: require('../../assets-db').getEffortLeaderboard,
    };
    sd = await require('../../services/scoreboardData').loadScoreboardData({ month, asOf, deps: sbDeps });
    const { computeSiteScore } = require('../../services/siteScore');
    const srd = require('../../services/siteReportDeps').buildSiteReportDeps();
    const p = { year: month.year, month: month.m, as_of: asOf };
    programmeScore = async (code) => {
      const si = await srd.scoreInputs(code, p);
      const prev = await srd.prevScore(code, p);
      return si ? computeSiteScore(si.inputs, si.window, prev) : computeSiteScore({}, null, null);
    };
  }
  const board = require('../../services/siteScoreboard').buildSiteScoreboard(sd.perSite, { prev: sd.prev });
  const programmeBySite = {};
  for (const row of board.rows) {
    try { programmeBySite[row.code] = await programmeScore(row.code); } catch (e) { programmeBySite[row.code] = null; }
  }
  const rows = shadowRows(board, programmeBySite);
  const out = 'json' in args ? JSON.stringify({ month: label, rows }, null, 2) : formatTable(rows, label);
  (deps.print || console.log)(out);
  return { month: label, rows };
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error('[site-score-shadow] fatal:', e.message); process.exit(1); });
}

module.exports = { main, shadowRows, formatTable, parseMonth };
