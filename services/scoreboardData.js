'use strict';

// Glue reader for the operational scoreboard. Gathers, per site, the 4 sub-scores
// (helpdesk · inspections · meetings · assets) for a month + the previous month,
// with the readers dependency-injected so it is unit-testable without a DB.
//
// Real server-side deps (wired in Task 3):
//   listSiteModuleCodes     ← reports-db.listSiteModuleCodes
//   getCalendarMonthlyHelpdesk ← reports-db.getCalendarMonthlyHelpdesk
//   getMeetingsInsights     ← meetings-db.insights
//   getInspectionAggregate  ← inspection-db.aggregate
//   getEffortLeaderboard    ← assets-db.getEffortLeaderboard

const { foldEffortByCode } = require('./scoreboardAliases');

const pad2 = n => String(n).padStart(2, '0');

// {from,to} as YYYY-MM-DD for a {year, m} month (m is 1-based).
function monthWindow({ year, m }) {
  const lastDay = new Date(year, m, 0).getDate(); // day 0 of next month = last of this
  return { from: `${year}-${pad2(m)}-01`, to: `${year}-${pad2(m)}-${pad2(lastDay)}` };
}

function prevMonthOf({ year, m }) {
  return m === 1 ? { year: year - 1, m: 12 } : { year, m: m - 1 };
}

async function assembleMonth({ monthObj, from, to, asOf, deps }) {
  const sites = (await deps.listSiteModuleCodes('meetings')) || [];

  // Fetch ONCE per window (not per site).
  const effRows = (await deps.getEffortLeaderboard({ asOf })).rows || [];
  const effMap = foldEffortByCode(effRows); // Map code → mean effort (simple mean, no total)

  const insights = (await deps.getMeetingsInsights({ from, to })) || {};
  const mtgMap = new Map();
  for (const r of insights.site_leaderboard || []) {
    // Real leaderboard aliases m.site_code AS site; score is 0-1 and can be null.
    mtgMap.set(r.site, r.score == null ? null : r.score * 100);
  }

  const perSite = [];
  for (const s of sites) {
    const code = s.code;

    // Helpdesk — null-OBJECT guard (whole object is null when the site has no zoho_group).
    const hd = await deps.getCalendarMonthlyHelpdesk(s.site_id, monthObj.year, monthObj.m);
    const helpdesk = hd ? hd.sla_res_pct : null;

    // Inspections — conformity from findingStatus (month-scoped): ok / applicable.
    const agg = (await deps.getInspectionAggregate({ site: code, from, to })) || {};
    const fs = agg.findingStatus || [];
    const applicable = fs.filter(x => x.status !== 'na').reduce((a, x) => a + x.n, 0);
    const ok = fs.filter(x => x.status === 'ok').reduce((a, x) => a + x.n, 0);
    const inspections = applicable > 0 ? Math.round((100 * ok) / applicable) : null;

    // Meetings — score already scaled to 0-100 above; null score stays null (NOT 0).
    const meetings = mtgMap.has(code) ? mtgMap.get(code) : null;

    // Assets — folded effort mean; unmatched code → null.
    const assets = effMap.has(code) ? effMap.get(code) : null;

    perSite.push({ code, name: s.name, helpdesk, inspections, meetings, assets });
  }

  return perSite;
}

async function loadScoreboardData({ month, asOf, deps }) {
  const window = monthWindow(month);
  const prevMonth = prevMonthOf(month);
  const prevWindow = monthWindow(prevMonth);

  const perSite = await assembleMonth({
    monthObj: month, from: window.from, to: window.to, asOf, deps,
  });

  // Previous-month gather uses the previous window's end as its asOf reference.
  const prevRows = await assembleMonth({
    monthObj: prevMonth, from: prevWindow.from, to: prevWindow.to, asOf: prevWindow.to, deps,
  });
  const prev = Object.fromEntries(prevRows.map(r => [r.code, r]));

  return { perSite, prev, month, window };
}

module.exports = { loadScoreboardData };
