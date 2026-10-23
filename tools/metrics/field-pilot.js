#!/usr/bin/env node
'use strict';
// Step 10 — the field pilot's acceptance criteria, measured (docs/ops/PILOTE-TERRAIN.md). READ ONLY: reads the field
// app's sync reports (System Logs, action field_sync) and prints COUNTS and durations (never a name).
//
//   node tools/metrics/field-pilot.js [--days=42] [--nps=answers.csv] [--json]
//
//  1. an inspection of 10 photos synchronised in ≤ 2 min at 1 Mbit/s → duration of the inspection sends with ≥ 10 photos
//  2. zero loss on network cuts                                       → sends that never succeeded after retries
//  3. weekly entry ≤ 20 min on 3 sites                               → measured on the pilot sheet (protocol), not here
//  4. technicians' NPS ≥ +30                                          → the NPS of the questionnaire CSV
if (require.main === module) require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const TARGETS = { ten_photo_send_seconds: 120, nps: 30 };

function median(xs) { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function p90(xs) { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)]; }

/** rows: system_log rows (action field_sync, details JSON). */
function summarise(rows) {
  const ops = [];
  for (const r of rows || []) {
    let d = r.details; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { d = {}; } }
    for (const o of (d && d.ops) || []) ops.push({ ...o, low_bandwidth: !!(d && d.low_bandwidth) });
  }
  const insp = ops.filter(o => o.kind === 'inspection');
  const ten = insp.filter(o => o.ok && o.photos >= 10).map(o => o.duration_ms / 1000);
  const failed = ops.filter(o => !o.ok).length;
  return {
    sends: ops.length, ok: ops.length - failed, failed_attempts: failed,
    inspections: insp.filter(o => o.ok).length,
    ten_photo_sends: { count: ten.length, median_seconds: median(ten), p90_seconds: p90(ten), within_target: ten.filter(s => s <= TARGETS.ten_photo_send_seconds).length },
    queued_minutes_median: median(ops.filter(o => o.ok).map(o => o.queued_ms / 60000)),
    low_bandwidth_share: ops.length ? Math.round(100 * ops.filter(o => o.low_bandwidth).length / ops.length) : null,
  };
}

/** NPS from a CSV of 0-10 answers (one per line, header optional): % promoters (9-10) − % detractors (0-6). */
function npsFromCsv(text) {
  const v = String(text || '').split(/\r?\n/).map(l => l.split(/[;,]/).pop().trim()).filter(x => /^\d{1,2}$/.test(x)).map(Number).filter(n => n >= 0 && n <= 10);
  if (!v.length) return { n: 0, nps: null };
  const pro = v.filter(n => n >= 9).length, det = v.filter(n => n <= 6).length;
  return { n: v.length, nps: Math.round(100 * (pro - det) / v.length) };
}

async function main(argv) {
  const arg = (k, d) => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
  const days = Math.max(1, Math.min(365, Number(arg('days', 42)) || 42));
  const rdb = require('../../reports-db');
  if (process.env.REPORTS_BACKEND === 'postgres' && rdb.initPgReports) await rdb.initPgReports();
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = [];
  for (let offset = 0; ; offset += 500) { const p = await rdb.listSystemLog({ action: 'field_sync', from }, { limit: 500, offset }); rows.push(...p.rows); if (p.rows.length < 500) break; }
  const s = summarise(rows);
  const npsFile = arg('nps', null);
  const nps = npsFile ? npsFromCsv(require('fs').readFileSync(npsFile, 'utf8')) : null;
  if (argv.includes('--json')) { console.log(JSON.stringify({ days, ...s, nps }, null, 2)); return; }
  console.log(`Field pilot — last ${days} day(s)`);
  console.log(`Sends: ${s.sends} (${s.ok} ok, ${s.failed_attempts} attempt(s) to retry) · inspections sent: ${s.inspections} · low bandwidth: ${s.low_bandwidth_share == null ? '—' : s.low_bandwidth_share + ' %'}`);
  const t = s.ten_photo_sends;
  console.log(`1. Inspections with ≥ 10 photos: ${t.count} — median ${t.median_seconds == null ? '—' : Math.round(t.median_seconds) + ' s'}, 90 % under ${t.p90_seconds == null ? '—' : Math.round(t.p90_seconds) + ' s'} (target ≤ ${TARGETS.ten_photo_send_seconds} s at 1 Mbit/s; ${t.within_target}/${t.count} within)`);
  console.log(`2. Zero loss: every failed attempt stays in the phone's outbox until it succeeds; check the pilot sheet for any send never confirmed.`);
  console.log(`   Median wait in the outbox before sending: ${s.queued_minutes_median == null ? '—' : Math.round(s.queued_minutes_median) + ' min'}`);
  console.log(`3. Weekly entry ≤ 20 min: measured on the pilot sheet (docs/ops/PILOTE-TERRAIN.md).`);
  console.log(`4. NPS of the technicians: ${nps ? (nps.nps == null ? 'no answer' : (nps.nps > 0 ? '+' : '') + nps.nps + ` over ${nps.n} answer(s)`) : 'not provided (--nps=answers.csv)'} (target ≥ +${TARGETS.nps})`);
}

module.exports = { summarise, npsFromCsv, median, p90, TARGETS };
if (require.main === module) main(process.argv.slice(2)).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
