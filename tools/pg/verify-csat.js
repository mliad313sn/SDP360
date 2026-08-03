'use strict';
// CSAT / NPS raw-data verifier (2026-08-03, v2). Reproduces EXACTLY what the deck
// computes on slide 7 — including the two things v1 missed:
//   1) the Operations GROUP FILTER (survey joined to its ticket's tech_group),
//   2) the month rule COALESCE(responded_on, sent_on)  [responded first].
// getSurveyKpisDB q1 (reports-db.js) is: survey_results sr LEFT JOIN request_records
// rr ON sr.request_id = rr.request_id, WHERE overall_score NOT NULL, month = ?,
// AND rr.tech_group IN (<selected groups>). CSAT% = (>=80)/n, NPS = (>=90 minus <70)/n.
//
// Run ON PROD from C:\Apps\SDP-Dashboard:
//     node tools\pg\verify-csat.js               (current month, OPS scope)
//     node tools\pg\verify-csat.js 2026-07        (a month, OPS scope)
//     node tools\pg\verify-csat.js 2026-07 all    ('all' = no group filter = org-wide)
//     node tools\pg\verify-csat.js 2026-07 "Hounde IT Agents,Mana IT Agent"  (custom groups)
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// The Operations preset (mirrors public/lib/dashboard-shared.js OPS_GROUPS_DEFAULT).
const OPS_GROUPS = [
  'Abidjan IT Agents', 'Exploration BF Support', 'Exploration CI Support',
  'Exploration IT Support', 'Hounde IT Agents', 'ITY IT Agents', 'Kalana IT Agents',
  'Lafigue IT Agents', 'Mana IT Agent', 'Ouaga IT Agents', 'Sabodala IT Agents',
  'Tanda IT Agents',
];

const MONTH = (process.argv[2] || new Date().toISOString().slice(0, 7));
const GROUP_ARG = process.argv[3];
const GROUPS = !GROUP_ARG ? OPS_GROUPS
  : (GROUP_ARG.toLowerCase() === 'all' ? null
    : GROUP_ARG.split(',').map(s => s.trim()).filter(Boolean));

function pgUrl() {
  if (process.env.PG_URL) return process.env.PG_URL;
  try {
    const line = fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8')
      .split(/\r?\n/).find(l => /^\s*PG_URL\s*=/.test(l));
    if (line) return line.replace(/^\s*PG_URL\s*=\s*/, '').replace(/^["']|["']$/g, '').trim();
  } catch (_) {}
  return null;
}

function kpis(rows) {
  let n = 0, sat = 0, pro = 0, det = 0;
  rows.forEach(r => { const s = +r.overall_score; n++; if (s >= 80) sat++; if (s >= 90) pro++; else if (s < 70) det++; });
  const csat = n ? Math.round(sat / n * 100) : null;
  const nps = n ? Math.round((pro - det) / n * 100) : null;
  return { n, sat, pro, det, csat, nps };
}

(async () => {
  const url = pgUrl();
  if (!url) { console.error('✖ PG_URL not found.'); process.exit(1); }
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    // month = COALESCE(responded_on, sent_on) — the deck's rule
    const monthExpr = `substr(COALESCE(sr.survey_responded_on, sr.survey_sent_on),1,7)`;
    const base = `FROM survey_results sr LEFT JOIN request_records rr ON sr.request_id = rr.request_id
                  WHERE sr.overall_score IS NOT NULL AND ${monthExpr} = $1`;

    // 1) per-group breakdown (all groups)
    const grp = (await c.query(
      `SELECT COALESCE(NULLIF(TRIM(rr.tech_group),''),'(no ticket / no group)') AS grp,
              COUNT(*) AS n, COUNT(*) FILTER (WHERE sr.overall_score>=80) AS sat
       ${base} GROUP BY grp ORDER BY n DESC`, [MONTH])).rows;

    // 2) all groups + 3) the selected scope
    const allRows = (await c.query(`SELECT sr.overall_score ${base}`, [MONTH])).rows;
    const scoped = GROUPS
      ? (await c.query(`SELECT sr.overall_score ${base} AND rr.tech_group = ANY($2)`, [MONTH, GROUPS])).rows
      : allRows;

    const A = kpis(allRows), S = kpis(scoped);
    console.log(`\n=== survey_results — ${MONTH}  (month = COALESCE(responded, sent)) ===`);
    console.log(`by ticket tech_group:`);
    grp.forEach(r => console.log(`  ${String(r.n).padStart(4)}  ${r.grp}`));
    console.log(`\nALL GROUPS (org-wide) : n=${A.n}  CSAT=${A.csat}%  NPS=${A.nps>0?'+':''}${A.nps}   (donut ${A.pro}/${A.n-A.pro-A.det}/${A.det})`);
    if (GROUPS) {
      console.log(`OPS SCOPE (the deck)  : n=${S.n}  CSAT=${S.csat}%  NPS=${S.nps>0?'+':''}${S.nps}   (donut ${S.pro}/${S.n-S.pro-S.det}/${S.det})`);
      console.log(`  scope = ${GROUPS.length} groups: ${GROUPS.join(', ')}`);
      console.log(`\n>> The deck's slide 7 should match the OPS SCOPE line above.`);
    } else {
      console.log(`(no group filter applied — 'all' = org-wide)`);
    }
  } catch (e) {
    console.error('✖ query failed:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
