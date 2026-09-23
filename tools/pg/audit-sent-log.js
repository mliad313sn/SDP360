'use strict';
// READ-ONLY audit (2026-09-21): which report e-mails may have gone out with stale data?
//
// Until 1e1bfdf the tools/reports CLIs did not load .env when run on their own
// (Task Scheduler, manual `node`), so they used the SQLite archives frozen at the
// PostgreSQL cutover — both to COMPOSE the mail and to LOG it. Hence three sources:
//   1. PostgreSQL report_sent_log  → sends made by the server (admin "Send now") = fresh data
//   2. SQLite data/reports.db report_sent_log after the cutover → standalone CLI sends
//      = composed from the July archive (the ones to check with recipients)
//   3. Windows scheduled tasks SDP-Report-*  → what is still set to run on its own
// Nothing is written anywhere.
//
//   node tools/pg/audit-sent-log.js [--since=2026-07-13]
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const SINCE = arg('since', '2026-07-13');

function table(rows, cols) {
  if (!rows.length) { console.log('  (aucune ligne)'); return; }
  const w = cols.map(c => Math.min(40, Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length))));
  console.log('  ' + cols.map((c, i) => c.padEnd(w[i])).join('  '));
  for (const r of rows) console.log('  ' + cols.map((c, i) => String(r[c] ?? '').slice(0, 40).padEnd(w[i])).join('  '));
}

async function fromPg() {
  if (!process.env.PG_URL) { console.log('  PG_URL absent du .env — section ignorée'); return; }
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.PG_URL });
  await c.connect();
  try {
    // [1] What is ARMED: a scheduled task that runs still sends nothing when its
    // arm flag is '0'. Recipients are shown as set/empty only (no addresses printed).
    const cfg = (await c.query(`SELECT key, value FROM report_config
      WHERE key LIKE '%_send_enabled' OR key = 'asset_new_alert_enabled'
         OR key LIKE '%_recipients' OR key IN ('smtp_host','smtp_user','smtp_from','mail_from')
      ORDER BY key`)).rows;
    // Every known arm flag, stored or not: a key ABSENT from report_config means the
    // DEFAULTS value applies (all of them default to '0' = disarmed), so listing only the
    // stored rows would hide most of the answer behind an empty table.
    const DEF = require('../../services/reportConfig').DEFAULTS || {};
    const stored = new Map(cfg.map(r => [r.key, String(r.value == null ? '' : r.value)]));
    const arm = Object.keys(DEF).filter(k => /_enabled$/.test(k)).sort().map((k) => {
      const v = stored.has(k) ? stored.get(k) : String(DEF[k]);
      return { envoi: k.replace(/_send_enabled$|_enabled$/, ''),
        etat: v === '1' ? 'ARME - part' : 'desarme - inerte',
        source: stored.has(k) ? 'enregistre' : 'defaut' };
    });
    console.log("");
    console.log("[0a] Interrupteurs d'envoi (un envoi desarme ne part pas, meme si sa tache tourne)");
    table(arm, ['envoi', 'etat', 'source']);
    const sched = (await c.query(`SELECT report_type, cadence, enabled, day, time, updated_by,
      to_char(updated_at,'YYYY-MM-DD') AS updated FROM report_schedules ORDER BY report_type, cadence`)).rows;
    console.log('\n[1a] Planifications enregistrées dans le dashboard (PostgreSQL report_schedules)');
    table(sched, ['report_type', 'cadence', 'enabled', 'day', 'time', 'updated', 'updated_by']);
    const log = (await c.query(`SELECT report_type, site_code, period, result, recipients,
      to_char(sent_at,'YYYY-MM-DD HH24:MI') AS sent_at FROM report_sent_log
      WHERE sent_at >= $1::date ORDER BY sent_at`, [SINCE])).rows;
    console.log(`\n[1b] Envois faits PAR LE SERVEUR depuis ${SINCE} (PostgreSQL) — données à jour`);
    table(log, ['sent_at', 'report_type', 'site_code', 'period', 'result', 'recipients']);
  } finally { await c.end(); }
}

function fromSqliteArchive() {
  const dataDir = process.env.SDP_DATA_DIR ? path.resolve(process.env.SDP_DATA_DIR) : path.join(__dirname, '..', '..', 'data');
  const file = path.join(dataDir, 'reports.db');
  console.log(`\n[2] Envois LANCÉS SEULS depuis ${SINCE} (archive SQLite ${file}) — composés avec les données de juillet`);
  if (!fs.existsSync(file)) { console.log('  archive absente — section ignorée'); return []; }
  const Database = require('better-sqlite3');
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const has = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='report_sent_log'`).get();
    if (!has) { console.log('  pas de table report_sent_log dans l\'archive'); return []; }
    const rows = db.prepare(`SELECT sent_at, report_type, site_code, period, result, recipients
      FROM report_sent_log WHERE substr(sent_at,1,10) >= ? ORDER BY sent_at`).all(SINCE);
    table(rows, ['sent_at', 'report_type', 'site_code', 'period', 'result', 'recipients']);
    const ok = rows.filter(r => r.result === 'ok' || r.result === 'resent');
    if (ok.length) console.log(`  → ${ok.length} e-mail(s) réellement envoyé(s) avec des données périmées.`);
    return rows;
  } finally { db.close(); }
}

function fromTaskScheduler() {
  console.log('\n[3] Tâches Windows SDP-Report-* (lancent les outils seuls)');
  if (process.platform !== 'win32') { console.log('  (pas Windows)'); return; }
  try {
    const out = require('child_process').execFileSync('schtasks', ['/query', '/fo', 'CSV', '/v'], { encoding: 'utf8', windowsHide: true });
    const lines = out.split(/\r?\n/).filter(l => /SDP-Report-/.test(l));
    if (!lines.length) { console.log('  (aucune)'); return; }
    for (const l of lines) {
      const f = l.split('","').map(s => s.replace(/^"|"$/g, ''));
      // CSV /v columns (en/fr locales keep the order): HostName, TaskName, NextRun, Status, Logon, LastRun, LastResult, …
      console.log(`  ${f[1]}  · prochain: ${f[2]}  · dernier: ${f[5]}  · statut: ${f[3]}`);
    }
  } catch (e) { console.log('  lecture impossible:', e.message.split('\n')[0]); }
}

(async () => {
  console.log(`Audit des envois de rapports depuis ${SINCE} (lecture seule)`);
  await fromPg();
  fromSqliteArchive();
  fromTaskScheduler();
  console.log('\nLecture : [2] liste les e-mails partis avec des chiffres de juillet ; [3] ce qui tournera encore'
    + ' seul (désormais sur PostgreSQL depuis le ZIP 1e1bfdf).');
})().catch(e => { console.error('[audit-sent-log] fatal:', e.message); process.exit(1); });
