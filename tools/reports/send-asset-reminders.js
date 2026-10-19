'use strict';
// Standalone runs (Task Scheduler, a manual `node tools/reports/...`) must read the app's
// .env BEFORE any *-db module loads: each picks its backend (*_BACKEND) at require time,
// and without it a prod run silently reads the frozen SQLite archives. In-process calls
// (server.js already loaded .env) and tests skip this.
if (require.main === module) require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
// Asset engagement reminders (2026-09-18). Two types, one core:
//   --type=asset_reminder   weekly recap per site (scheduled, Monday 07:00 by default)
//   --type=asset_new_alert  same-day "new hardware" alert (called IN-PROCESS after
//                           the nightly assets sync — see assets-sync.afterAssetsSync)
// Flags: --preview (compose only, gate ignored, nothing sent/logged), --site=CODE,
// --force (ignore same-day dedup). Armed OFF by default (two config flags).
// Recipients: confirmed asset manager (to) + confirmed coordinator (cc); else the
// confirmed coordinator alone; else skip. cc_emails are NOT used (site report CC).
// Every reader is async under PostgreSQL — always `await`, never chain onto it.
//
// IN-PROCESS SAFETY: main() never reads process.argv, never calls process.exit, and
// never re-runs initPgReports/initPgAssets when reportsDb/assetsDb are injected (the
// server passes its own, already-initialised modules). Only the require.main block
// below parses argv, boots pg and exits.
const TYPES = { asset_reminder: 'asset_reminder_send_enabled', asset_new_alert: 'asset_new_alert_enabled' };

function decideReminderSend(type, cfg) {
  const key = TYPES[type];
  return !!key && String((cfg || {})[key]) === '1';
}

function recipientsFor(rows, site, neverSendUnconfirmed = true) {
  const { resolveFromRows } = require('../../services/reportDirectory');
  const opts = { neverSendUnconfirmed };
  const am = resolveFromRows(rows, site, 'asset_manager', opts);
  const coord = resolveFromRows(rows, site, 'coordinator', opts);
  if (am) return { to: am.to, cc: coord && coord.to !== am.to ? [coord.to] : [] };
  if (coord) return { to: coord.to, cc: [] };
  return null;
}

async function _defaultLoadSiteLabels(assetsDb, code) {
  const lookups = (await assetsDb.getAssetLookups()) || {};
  const { labelsForCode } = require('../../services/assetHygieneForSite');
  const { assetLabelToCode } = require('../../services/scoreboardAliases');
  return labelsForCode(lookups.sites, code, assetLabelToCode);
}

// Bare `--x` parses to {x: undefined} — present means ON unless it says 0/false.
function _flag(args, name) {
  return (name in args) && args[name] !== '0' && args[name] !== 'false';
}

function parseArgs(argv) {
  return Object.fromEntries((argv || []).map(a => a.replace(/^--/, '').split('=')));
}

async function main(deps = {}) {
  const args = deps.args || {};
  // A bare `--type` (or `--type=`) is a typo, not "use the default".
  if (!deps.type && ('type' in args) && !String(args.type || '').trim()) throw new Error('--type needs a value (asset_reminder | asset_new_alert)');
  const type = deps.type || args.type || 'asset_reminder';
  if (!TYPES[type]) throw new Error(`unknown --type "${type}" (asset_reminder | asset_new_alert)`);
  const preview = deps.preview !== undefined ? !!deps.preview : _flag(args, 'preview');
  const force = deps.force !== undefined ? !!deps.force : _flag(args, 'force');
  const onlySite = String(deps.site || args.site || '').trim().toUpperCase() || null;

  // Boot only what was not injected. The pg init lives in the CLI entrypoint
  // (bootForCli) — the core never opens a second pool.
  let rdb = deps.reportsDb, adb = deps.assetsDb, db = deps.db, cfg = deps.cfg;
  const getRdb = () => { if (!rdb) rdb = require('../../reports-db'); if (!db) db = rdb.db; return rdb; };
  const getAdb = () => { if (!adb) adb = require('../../assets-db'); return adb; };
  if (!cfg) { getRdb(); cfg = (await require('../../services/reportConfig').getConfig(db)) || {}; }

  if (!preview && !decideReminderSend(type, cfg)) {
    console.log(`[send-asset-reminders] type=${type} → not sending (reason=disabled)`);
    return { type, sent: 0, reason: 'disabled' };
  }

  // ── window + dedup period ──
  const now = deps.now || new Date();
  let win, period, weekInfo = null;
  if (type === 'asset_reminder') {
    const getPreviousWeek = deps.getPreviousWeek || getRdb().getPreviousWeek;
    const getWeekRange = deps.getWeekRange || getRdb().getWeekRange;
    const pw = getPreviousWeek();
    const wr = getWeekRange(pw.year, pw.week);
    win = { newFrom: wr.start, newTo: wr.end };
    period = wr.label;                                   // 'Wnn YYYY' (Zoho week)
    weekInfo = { year: pw.year, week: pw.week, label: wr.label };
  } else {
    const today = now.toISOString().slice(0, 10);      // UTC, like recordAssetSightings
    win = { newFrom: today, newTo: today };
    period = today;
  }

  if (!db && !deps.listRecipients) getRdb();
  const listRecipients = deps.listRecipients || ((d) => require('../../services/reportDirectory').listRecipients(d));
  const rows = (await listRecipients(db)) || [];
  const loadSiteLabels = deps.loadSiteLabels || ((code) => _defaultLoadSiteLabels(getAdb(), code));
  const loadFollowups = deps.loadFollowups || ((labels, w) => getAdb().getSiteAssetFollowups(labels, w));
  const alreadySentToday = deps.alreadySentToday || require('../../services/reportSentLog').alreadySentToday;
  const record = deps.record || require('../../services/reportSentLog').record;
  // SMTP not configured → stop before the loop (one clear reason, not one 'fail'
  // row per site). Only when WE build the mailer; an injected sender is trusted.
  if (!deps.mailerSend && !preview) {
    const smtpErr = require('../../services/mailer').smtpConfigError(cfg);
    if (smtpErr) {
      console.warn(`[send-asset-reminders] type=${type} → not sending (smtp not configured: ${smtpErr})`);
      return { type, sent: 0, reason: 'smtp not configured', period };
    }
  }
  const mailerSend = deps.mailerSend || (msg => require('../../services/mailer').buildMailer(cfg).send(msg));
  const { buildAssetRecap, buildNewAssetAlert } = require('../../services/assetReminderReport');
  const neverUnconfirmed = String(cfg.never_send_unconfirmed ?? '1') !== '0';
  const baseUrl = String(cfg.public_base_url || '').replace(/\/+$/, '');

  const sites = rows.filter(r => r && r.site_code && Number(r.active ?? 1) !== 0)
    .map(r => r.site_code).filter(s => !onlySite || String(s).toUpperCase() === onlySite);

  const results = [], previews = [];
  let sent = 0;
  for (const site of sites) {
    try {
      const labels = (await loadSiteLabels(site)) || [];
      if (!labels.length) { results.push({ site, ok: false, reason: 'no asset label for this site' }); continue; }
      const f = (await loadFollowups(labels, win)) || {};
      const c = f.counts || {};
      const empty = type === 'asset_reminder'
        ? !(c.no_tag || c.unassigned || c.no_cost || c.no_date)
        : !c.new;
      if (empty) { results.push({ site, ok: false, reason: 'nothing to report' }); continue; }
      const rcpt = recipientsFor(rows, site, neverUnconfirmed);
      if (!rcpt) { results.push({ site, ok: false, reason: 'no confirmed asset manager or coordinator' }); continue; }
      const msg = type === 'asset_reminder'
        ? buildAssetRecap({ site, followups: f, baseUrl, weekLabel: weekInfo.label, year: weekInfo.year, week: weekInfo.week, labels })
        : buildNewAssetAlert({ site, rows: f.new, baseUrl, date: period, labels });
      if (preview) { previews.push({ site, subject: msg.subject, to: rcpt.to, cc: rcpt.cc.join(',') }); continue; }
      if (!force && await alreadySentToday(db, type, site, period)) { results.push({ site, ok: false, reason: 'already sent today' }); continue; }
      const res = await mailerSend({ to: rcpt.to, cc: rcpt.cc.length ? rcpt.cc.join(',') : undefined, subject: msg.subject, html: msg.html, attachments: msg.attachments });
      const ok = !!(res && res.ok);
      if (ok) sent++;
      // 'resent' for a forced re-send (traceable, and still counted by alreadySentToday
      // — see the report_sent_log vocabulary pitfall); 'fail' stays retryable.
      try {
        await record(db, { report_type: type, site_code: site, period, recipients: [rcpt.to, ...rcpt.cc].join(','), result: ok ? (force ? 'resent' : 'ok') : 'fail' });
      } catch (e) {
        console.error(`[send-asset-reminders] log failed site=${site} reason=${e.message}`);
        // The mail DID go out — say so, separately from a send error (a retry would
        // re-send it, since dedup never saw this row).
        if (ok) { results.push({ site, ok: true, to: rcpt.to, logFailed: true, reason: 'sent, log failed' }); continue; }
        throw e;
      }
      results.push(ok ? { site, ok: true, to: rcpt.to } : { site, ok: false, reason: 'send failed: ' + ((res && res.error) || 'unknown') });
    } catch (e) {
      console.error(`[send-asset-reminders] FAIL site=${site} reason=${e.message}`);
      results.push({ site, ok: false, reason: 'error: ' + e.message });
    }
  }
  if (preview) return { type, previewed: true, sent: 0, period, previews, results };
  console.log(`[send-asset-reminders] DONE type=${type} period=${period} → sent=${sent}`);
  return { type, sent, period, results };
}

// A run "failed" when any site ended with a send failure, an error, or a mail that
// went out but could not be logged (dedup is then blind to it). Skips are not failures.
function hasFailures(r) {
  return ((r && r.results) || []).some(x => x.logFailed
    || /^send failed|^error:/.test(String(x.reason || '')));
}

// CLI-only boot: open the pg pools once, then hand the initialised modules to the
// core so it never touches init itself.
async function bootForCli() {
  const reportsDb = require('../../reports-db');
  if ((process.env.REPORTS_BACKEND || 'sqlite').toLowerCase() === 'postgres') await reportsDb.initPgReports();
  const assetsDb = require('../../assets-db');
  if (assetsDb.ASSETS_BACKEND === 'postgres') await assetsDb.initPgAssets();
  return { reportsDb, assetsDb };
}

if (require.main === module) {
  (async () => {
    const handles = await bootForCli();
    const r = await main({ ...handles, args: parseArgs(process.argv.slice(2)) });
    if (r && r.previewed) console.log(JSON.stringify(r.previews, null, 2));
    return hasFailures(r) ? 1 : 0;
  })().then((code) => process.exit(code)).catch(e => { console.error('[send-asset-reminders] fatal:', e.message); process.exit(1); });
}

module.exports = { decideReminderSend, recipientsFor, main, parseArgs, hasFailures, TYPES };
