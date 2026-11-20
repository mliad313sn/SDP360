'use strict';
// P11 F-19 — Helpdesk week bucketing (public/index.html isoWk / isoWkYr / prevWk) agrees with the shared
// ReportingWeek in a DST time zone (Europe/London — LONDON is a site), and the week before W01 is W53 in a
// 53-week year. Each case runs in a child process with TZ set, since Node fixes the zone at start-up.
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = `
const fs=require('fs'); const src=fs.readFileSync(${JSON.stringify(path.join(ROOT, 'public', 'index.html'))},'utf8');
const grab=(n)=>{const i=src.indexOf('function '+n+'('); if(i<0) throw new Error(n); let d=0; for(let k=src.indexOf('{',i);k<src.length;k++){if(src[k]=='{')d++; if(src[k]=='}'){d--; if(!d) return src.slice(i,k+1);}}};
global.window={ReportingWeek:require(${JSON.stringify(path.join(ROOT, 'public', 'lib', 'reportingWeek.js'))})};
eval(['_zFirstSun','isoWk','isoWkYr','prevWk','wkStart'].map(grab).join('\\n')+';global.F={isoWk,isoWkYr,prevWk,wkStart};');
const RW=window.ReportingWeek; let mism=0;
for(let t=Date.UTC(2026,0,1); t<Date.UTC(2030,0,1); t+=6*3600000){const d=new Date(t); const b=RW.weekOf(d); if(F.isoWkYr(d)!==b.year||F.isoWk(d)!==b.week) mism++;}
const sun=new Date(2026,3,5,10,0,0);   // Sunday 5 April 2026, local (BST in London)
process.stdout.write(JSON.stringify({tz:Intl.DateTimeFormat().resolvedOptions().timeZone, mism, sunday:[F.isoWkYr(sun),F.isoWk(sun)],
  prev2029:F.prevWk(2029,1), prev2027:F.prevWk(2027,1), prevMid:F.prevWk(2026,30), rwPrev:RW.previous(2029,1),
  w53:RW.weekOf(new Date(2029,0,6,12)), startW14:F.wkStart(2026,14).getDate()}));`;

function run(tz) {
  const r = spawnSync(process.execPath, ['-e', SCRIPT], { env: { ...process.env, TZ: tz, NODE_OPTIONS: '' }, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

for (const tz of ['Europe/London', 'UTC', 'America/New_York']) {
  test(`F-19 (${tz}): Helpdesk week helpers == ReportingWeek on every 6-hour sample 2026–2029`, () => {
    const o = run(tz);
    assert.strictEqual(o.mism, 0);
    assert.deepStrictEqual(o.sunday, [2026, 14], 'a summer Sunday is in its own week (W14), not the previous one');
    assert.strictEqual(o.startW14, 5);
  });
}

test('F-19: the week before 2029-W01 is 2028-W53 (53-week year); ordinary years and mid-year unchanged', () => {
  const o = run('Europe/London');
  assert.deepStrictEqual(o.w53, { year: 2028, week: 53 }, 'Jan 1–6 2029 belong to 2028-W53');
  assert.deepStrictEqual(o.prev2029, { yr: 2028, wk: 53 });
  assert.deepStrictEqual(o.rwPrev, { year: 2028, week: 53 });
  assert.deepStrictEqual(o.prevMid, { yr: 2026, wk: 29 });
  assert.strictEqual(o.prev2027.yr, 2026);
});
