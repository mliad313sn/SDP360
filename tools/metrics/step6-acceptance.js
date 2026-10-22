#!/usr/bin/env node
'use strict';
// Step 6 (lot 6.7) — the acceptance criteria of docs/design/ETAPE-06-design-espace-direction-composeur.md §10,
// measured. READ ONLY: reads System Logs and the user list, prints COUNTS (never a name).
//
//   node tools/metrics/step6-acceptance.js [--weeks=8] [--sus=answers.csv] [--tech-roles=super_admin,admin] [--json]
//
//  1. leadership space used weekly by ≥ 3 leaders  → distinct `direction_viewed` actors per ISO week (Monday)
//  2. ≥ 5 dashboards published by committee members without a developer
//                                                  → distinct dashboards whose publisher holds no technical role
//  3. SUS ≥ 75                                     → mean SUS of the questionnaire CSV (docs/ops/USABILITY-TEST-PROTOCOL.md)
//  4. AA audit without blocking defect            → not measured here: tests/a11y-step6.test.js + the manual pass
if (require.main === module) require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const TARGETS = { weekly_leaders: 3, published_by_non_tech: 5, sus: 75 };

/** ISO week Monday of an ISO timestamp ('YYYY-MM-DD…'), as 'YYYY-MM-DD'. */
function mondayOf(ts) {
  const d = new Date(String(ts).slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** rows: system_log rows of action direction_viewed → [{week, viewers}] for the last `weeks` Mondays up to `today`. */
function weeklyViewers(rows, { weeks = 8, today = new Date().toISOString().slice(0, 10) } = {}) {
  const by = new Map();
  for (const r of rows || []) {
    if (!r.actor || r.actor === 'anonymous') continue;
    const w = mondayOf(r.ts);
    if (!by.has(w)) by.set(w, new Set());
    by.get(w).add(String(r.actor).toLowerCase());
  }
  const out = [];
  const last = new Date(mondayOf(today) + 'T00:00:00Z');
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(last); d.setUTCDate(d.getUTCDate() - 7 * i);
    const w = d.toISOString().slice(0, 10);
    out.push({ week: w, viewers: by.has(w) ? by.get(w).size : 0, partial: i === 0 });
  }
  return out;
}

/** rows: dashboard_published rows; rolesOf(actor) → roles[]. Distinct dashboards published by a non-technical person. */
function nonTechnicalPublications(rows, rolesOf, techRoles = ['super_admin', 'admin']) {
  const tech = new Set(techRoles);
  const boards = new Set(), people = new Set();
  for (const r of rows || []) {
    if (!r.actor || r.actor === 'system' || r.actor === 'anonymous') continue;
    const roles = rolesOf(r.actor);
    if (!roles || roles.some(x => tech.has(x))) continue;
    boards.add(r.target); people.add(String(r.actor).toLowerCase());
  }
  return { dashboards: boards.size, authors: people.size };
}

/** One SUS questionnaire: 10 answers 1..5 → 0..100 (odd items r-1, even items 5-r, sum × 2.5). Null if incomplete. */
function susScore(answers) {
  if (!Array.isArray(answers) || answers.length !== 10) return null;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const r = Number(answers[i]);
    if (!Number.isInteger(r) || r < 1 || r > 5) return null;
    sum += i % 2 === 0 ? r - 1 : 5 - r;
  }
  return sum * 2.5;
}

/** CSV text 'participant,q1,…,q10' (header optional, ; or , separated) → {n, mean, scores, rejected}. */
function susFromCsv(text) {
  const scores = [], rejected = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const cells = line.split(/[;,]/).map(c => c.trim());
    if (!line.trim() || /^q?1$/i.test(cells[1] || '') || /participant/i.test(cells[0])) continue;
    const s = susScore(cells.slice(1, 11));
    if (s == null) rejected.push(cells[0] || '?'); else scores.push(s);
  }
  const mean = scores.length ? Math.round(10 * scores.reduce((a, b) => a + b, 0) / scores.length) / 10 : null;
  return { n: scores.length, mean, scores, rejected };
}

async function allRows(rdb, action, from) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await rdb.listSystemLog({ category: 'dashboard', action, from }, { limit: 500, offset });
    rows.push(...page.rows);
    if (page.rows.length < 500) return rows;
  }
}

async function main(argv) {
  const arg = (k, d) => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
  const weeks = Math.max(1, Math.min(52, Number(arg('weeks', 8)) || 8));
  const techRoles = String(arg('tech-roles', 'super_admin,admin')).split(',').map(s => s.trim()).filter(Boolean);
  const rdb = require('../../reports-db');
  if (process.env.REPORTS_BACKEND === 'postgres' && rdb.initPgReports) await rdb.initPgReports();
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - (weeks * 7 + 7) * 86400000).toISOString().slice(0, 10);

  const views = weeklyViewers(await allRows(rdb, 'direction_viewed', from), { weeks, today });
  const users = await rdb.listUsers();
  const byName = new Map((users || []).map(u => [String(u.username).toLowerCase(), [...new Set([u.role, ...(u.roles || [])].filter(Boolean))]]));
  const pubs = nonTechnicalPublications(await allRows(rdb, 'dashboard_published', null), a => byName.get(String(a).toLowerCase()), techRoles);
  const susFile = arg('sus', null);
  const sus = susFile ? susFromCsv(require('fs').readFileSync(susFile, 'utf8')) : null;

  const complete = views.filter(v => !v.partial);
  const weeksOk = complete.filter(v => v.viewers >= TARGETS.weekly_leaders).length;
  const report = {
    as_of: today, targets: TARGETS, tech_roles: techRoles,
    leadership_space: { weeks: views, complete_weeks_meeting_target: weeksOk, complete_weeks: complete.length },
    published_by_non_tech: { ...pubs, met: pubs.dashboards >= TARGETS.published_by_non_tech },
    sus: sus ? { n: sus.n, mean: sus.mean, rejected: sus.rejected.length, met: sus.mean != null && sus.mean >= TARGETS.sus } : 'not provided (--sus=answers.csv)',
    aa: 'tests/a11y-step6.test.js (static) + manual screen-reader pass — see docs/ops/USABILITY-TEST-PROTOCOL.md',
  };
  if (argv.includes('--json')) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(`Step 6 acceptance — ${today}`);
  console.log(`1. Leadership space, distinct viewers per week (target ≥ ${TARGETS.weekly_leaders}):`);
  for (const v of views) console.log(`   ${v.week}  ${String(v.viewers).padStart(3)}${v.partial ? '  (current week)' : v.viewers >= TARGETS.weekly_leaders ? '  ✓' : ''}`);
  console.log(`   → ${weeksOk} of ${complete.length} complete weeks meet the target`);
  console.log(`2. Dashboards published by non-technical people: ${pubs.dashboards} (by ${pubs.authors} people; target ≥ ${TARGETS.published_by_non_tech}) ${report.published_by_non_tech.met ? '✓' : '✗'}`);
  console.log(`   technical roles excluded: ${techRoles.join(', ')}`);
  console.log(`3. SUS: ${sus ? `${sus.mean} over ${sus.n} questionnaires${sus.rejected.length ? `, ${sus.rejected.length} rejected (incomplete)` : ''} (target ≥ ${TARGETS.sus}) ${report.sus.met ? '✓' : '✗'}` : 'not provided — pass --sus=answers.csv'}`);
  console.log(`4. AA: ${report.aa}`);
}

module.exports = { mondayOf, weeklyViewers, nonTechnicalPublications, susScore, susFromCsv, TARGETS };

if (require.main === module) main(process.argv.slice(2)).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
