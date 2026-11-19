#!/usr/bin/env node
'use strict';
// P04 PPM certification — WITNESS PROJECT KIT (gate "Business witness project"). The PMO supplies ONE real project from
// its tool of record (an MSPDI .xml saved by Microsoft Project, or a Primavera .xer). This script:
//   1. reads the file locally and computes what SDP360's engine makes of it (the same import mapping the server uses:
//      services/ppm/mspdi.modelToEngine / services/ppm/xer → services/ppm/scheduleEngine);
//   2. optionally loads it into a TEST instance through the normal import API (dry run first, apply only with --apply)
//      and reads back the server's schedule;
//   3. writes a comparison sheet (CSV, one row per task): tool-of-record start / finish / duration / % complete next to
//      SDP360's start / finish / duration / total float / critical, the differences in days, and EMPTY columns
//      "PMO verdict" / "PMO comment" that only a person fills.
// It never decides that the witness passed. The data is the PMO's: keep the sheet inside the TEST perimeter.
//
//   node tools/ppm/witness-load.js --file=plan.xml [--out=sheet.csv]                       local comparison only
//   SDP_WITNESS_TOKEN=<session token> node tools/ppm/witness-load.js --file=plan.xml \
//        --base=https://sdp360-test.example --project-id=42 --i-confirm-test-instance [--apply] [--out=sheet.csv]
// The project must exist and be EMPTY (the import refuses otherwise); the apply needs a committee account.
// The token is read from the environment only (never argv). Production host names are refused.
const fs = require('fs');
const path = require('path');
const MSPDI = require('../../services/ppm/mspdi');
const ENGINE = require('../../services/ppm/scheduleEngine');

const PROD_HOSTS = ['itops-dashboard.edv-ops.com'].concat(String(process.env.SDP_PROD_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean));
const DAY = 86400000;
const dd = (a, b) => (a && b ? Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY) : null);

/** The model of a tool-of-record file (MSPDI or XER), by content. */
function readModel(text) {
  if (/^\s*ERMHDR/.test(text)) { const x = require('../../services/ppm/xer').fromXer(text); return { model: x.model, format: 'xer', warnings: x.warnings }; }
  return { model: MSPDI.fromXml(text), format: 'mspdi' };
}
/** What SDP360's engine computes for the model (local, no server). */
function engineOf(model) {
  const e = MSPDI.modelToEngine(model);
  return ENGINE.schedule(e.tasks, e.opts);
}
/**
 * PURE. One row per task of the file: the tool of record's values and SDP360's, side by side.
 * @param {object} model   the parsed file (tasks carry start / finish / duration_days / percent_complete)
 * @param {object|null} schedule  SDP360 schedule keyed by the FILE uid (local engine) or mapped from the server ids
 */
function comparisonRows(model, schedule) {
  const by = new Map(((schedule && schedule.tasks) || []).map((r) => [Number(r.id), r]));
  return MSPDI.normalizeModel(model).tasks.map((t) => {
    const r = by.get(Number(t.uid)) || null;
    const ds = r ? dd(t.start, r.es_date) : null, df = r ? dd(t.finish, r.ef_date) : null;
    return { uid: t.uid, wbs: t.wbs, name: t.name, summary: t.summary ? 1 : 0,
      tor_start: t.start || null, tor_finish: t.finish || null, tor_duration_days: t.duration_days == null ? null : t.duration_days, tor_pct: t.percent_complete == null ? null : t.percent_complete,
      sdp_start: r ? r.es_date : null, sdp_finish: r ? r.ef_date : null, sdp_duration_days: r ? r.duration_days : null, sdp_total_float: r ? r.total_float : null, sdp_critical: r ? (r.critical ? 1 : 0) : null,
      delta_start_days: ds, delta_finish_days: df, same_dates: r && ds === 0 && df === 0 ? 1 : 0, pmo_verdict: '', pmo_comment: '' };
  });
}
function summaryOf(rows) {
  const leaves = rows.filter((r) => !r.summary);
  const cmp = leaves.filter((r) => r.delta_start_days != null && r.delta_finish_days != null);
  return { tasks: rows.length, leaves: leaves.length, compared: cmp.length, same_dates: cmp.filter((r) => r.same_dates).length,
    max_abs_finish_delta_days: cmp.length ? Math.max(...cmp.map((r) => Math.abs(r.delta_finish_days))) : null, not_compared: leaves.length - cmp.length };
}
function toCsv(rows) {
  const cols = ['uid', 'wbs', 'name', 'summary', 'tor_start', 'tor_finish', 'tor_duration_days', 'tor_pct', 'sdp_start', 'sdp_finish', 'sdp_duration_days', 'sdp_total_float', 'sdp_critical', 'delta_start_days', 'delta_finish_days', 'same_dates', 'pmo_verdict', 'pmo_comment'];
  const q = (v) => (v == null ? '' : /[",\n;]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  return [cols.join(',')].concat(rows.map((r) => cols.map((c) => q(r[c])).join(','))).join('\n') + '\n';
}

async function remote({ base, pid, xml, apply, token, format }) {
  const host = new URL(base).hostname;
  if (PROD_HOSTS.includes(host)) throw new Error(`refused: ${host} is a production host — the witness load runs on a TEST instance only`);
  const route = format === 'xer' ? 'xer' : 'mspdi';
  const H = { 'x-report-token': token, 'content-type': format === 'xer' ? 'text/plain' : 'application/xml' };
  const imp = await fetch(`${base}/api/governance/ppm/project/${pid}/${route}/import${apply ? '?apply=1' : ''}`, { method: 'POST', headers: H, body: xml });
  const ij = await imp.json().catch(() => ({}));
  if (!imp.ok) throw new Error(`import ${imp.status}: ${ij.code || ''} ${ij.error || ''}`);
  if (!apply) return { dry_run: ij };
  const sch = await fetch(`${base}/api/governance/ppm/project/${pid}/schedule`, { headers: { 'x-report-token': token } });
  const sj = await sch.json().catch(() => ({}));
  if (!sch.ok) throw new Error(`schedule ${sch.status}: ${sj.code || ''} (switch ppm_schedule_engine_v2_ui must be on in TEST)`);
  // server ids → file uids
  const back = new Map(Object.entries((ij.result && ij.result.task_ids) || {}).map(([uid, id]) => [Number(id), Number(uid)]));
  return { imported: ij, schedule: { ...sj.schedule, tasks: sj.schedule.tasks.map((r) => ({ ...r, id: back.get(Number(r.id)) })) } };
}

async function main() {
  const a = (k) => { const x = process.argv.find((s) => s.startsWith('--' + k + '=')); return x ? x.split('=').slice(1).join('=') : null; };
  const file = a('file'); if (!file) { console.error('usage: --file=<MSPDI .xml or .xer> [--base=… --project-id=… --i-confirm-test-instance [--apply]] [--out=sheet.csv]'); process.exit(2); }
  const text = fs.readFileSync(file, 'utf8');
  const { model, format } = readModel(text);
  let schedule = engineOf(model), source = 'local engine (no server)';
  if (a('base')) {
    if (!process.argv.includes('--i-confirm-test-instance')) { console.error('refused: add --i-confirm-test-instance (the witness load is for a TEST instance only)'); process.exit(2); }
    const token = process.env.SDP_WITNESS_TOKEN; if (!token) { console.error('refused: SDP_WITNESS_TOKEN is not set (the token is read from the environment, never from the command line)'); process.exit(2); }
    const r = await remote({ base: a('base').replace(/\/$/, ''), pid: Number(a('project-id')), xml: text, apply: process.argv.includes('--apply'), token, format });
    if (r.dry_run) { console.log(JSON.stringify({ dry_run: r.dry_run }, null, 1)); console.log('dry run only: re-run with --apply (committee account) to load the project'); }
    else { schedule = r.schedule; source = 'TEST instance ' + a('base') + ' project ' + a('project-id'); }
  }
  const rows = comparisonRows(model, schedule);
  const out = a('out') || path.basename(file).replace(/\.[^.]+$/, '') + '.witness-comparison.csv';
  fs.writeFileSync(out, toCsv(rows));
  console.log(JSON.stringify({ format, source, sheet: path.resolve(out), summary: summaryOf(rows), note: 'PMO verdict / comment columns are left empty on purpose' }, null, 1));
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { comparisonRows, summaryOf, toCsv, readModel, engineOf, PROD_HOSTS };
