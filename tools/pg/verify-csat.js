'use strict';
// CSAT / NPS raw-data verifier (2026-08-03). Reproduces EXACTLY what
// getSurveyKpisDB (reports-db.js) computes for one month, straight off the raw
// survey_results rows, so the deck's Customer Satisfaction slide (slide 7) can be
// reconciled against the source of truth.
//
// Run ON THE PROD SERVER from C:\Apps\SDP-Dashboard (where `pg` + `.env` live):
//     node tools\pg\verify-csat.js            (current month)
//     node tools\pg\verify-csat.js 2026-07     (a specific YYYY-MM)
//
// It prints the raw score buckets + the three DIFFERENT cut-offs the slide mixes:
//   • CSAT tile %  = responses scoring >= 80          (the "76%" tile value)
//   • Donut/subtitle counts = NPS buckets >=90/70-89/<70 (the "74 / 33 / 33")
//   • NPS          = (promoters - detractors) / base
// so you can see at a glance why "74 satisfied" and "76%" don't reconcile.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MONTH = (process.argv[2] || new Date().toISOString().slice(0, 7)); // YYYY-MM

function pgUrl() {
  if (process.env.PG_URL) return process.env.PG_URL;
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find(l => /^\s*PG_URL\s*=/.test(l));
    if (line) return line.replace(/^\s*PG_URL\s*=\s*/, '').replace(/^["']|["']$/g, '').trim();
  } catch (_) { /* fall through */ }
  return null;
}

(async () => {
  const url = pgUrl();
  if (!url) { console.error('✖ PG_URL not found (env or .env). Aborting.'); process.exit(1); }
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const r = (await c.query(`
      SELECT COUNT(*) FILTER (WHERE overall_score IS NOT NULL)                         AS scored,
             ROUND(AVG(overall_score)::numeric, 1)                                     AS avg_score,
             COUNT(*) FILTER (WHERE overall_score >= 80)                               AS sat80,
             COUNT(*) FILTER (WHERE overall_score >= 90)                               AS pro90,
             COUNT(*) FILTER (WHERE overall_score >= 70 AND overall_score < 90)        AS pas7089,
             COUNT(*) FILTER (WHERE overall_score < 70)                                AS det70
      FROM survey_results
      WHERE substr(COALESCE(survey_sent_on, survey_responded_on), 1, 7) = $1
    `, [MONTH])).rows[0];

    const sc = +r.scored || 0, sat = +r.sat80 || 0, pr = +r.pro90 || 0, pa = +r.pas7089 || 0, de = +r.det70 || 0;
    const base = pr + pa + de;
    const csatPct = sc ? Math.round(sat / sc * 100) : null;
    const nps = base ? Math.round((pr - de) / base * 100) : null;
    const satShare = sc ? Math.round(pr / sc * 100) : null; // what the donut "Satisfied" slice ACTUALLY is as a %

    console.log(`\n=== survey_results — ${MONTH} ===`);
    console.log(`scored responses      : ${sc}`);
    console.log(`avg overall_score     : ${r.avg_score}`);
    console.log(`--- score buckets ---`);
    console.log(`>= 80  (CSAT satisfied): ${sat}`);
    console.log(`>= 90  (NPS promoter)  : ${pr}   <-- donut "Satisfied" slice`);
    console.log(`70-89  (NPS passive)   : ${pa}   <-- donut "Neutral" slice`);
    console.log(`<  70  (NPS detractor) : ${de}   <-- donut "Dissatisfied" slice`);
    console.log(`--- what the slide shows ---`);
    console.log(`CSAT tile %  = ${sat}/${sc} = ${csatPct}%           (cut-off >= 80)`);
    console.log(`Donut counts = ${pr} / ${pa} / ${de}  (sum ${base})   (cut-offs >=90 / 70-89 / <70)`);
    console.log(`NPS          = (${pr}-${de})/${base} = ${nps > 0 ? '+' : ''}${nps}`);
    console.log(`\n>> The donut "Satisfied ${pr}" is ${satShare}% of ${sc} — NOT the ${csatPct}% on the tile,`);
    console.log(`   because they use different cut-offs (>=90 vs >=80). Same word, two definitions.`);
  } catch (e) {
    console.error('✖ query failed:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
