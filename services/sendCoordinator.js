'use strict';
// The coordinator send pipeline — ONE implementation, TWO callers:
//   - POST /api/reports/send   (server.js, a thin wrapper over this)
//   - tools/reports/send-reports.js  (the scheduled CLI)
// Do not duplicate the pipeline in either caller: the dedup rule + the safety
// gate + the outcome logging must be identical on both paths or a scheduled
// run and a manual click disagree about what was sent.
//
// Contract — sendCoordinatorReport({db, cfg, site, period, kind, force, preview, deps}):
//   unresolvable site → { skipped:true, reason:'site "X" has no meetings module code — cannot report' }
//   preview           → { preview:true, subject, html }   (never sends, never logs)
//   no confirmed rcpt → { skipped:true, reason:'no confirmed recipient' }
//   already sent today→ { skipped:true, reason:'already sent today' }
//   otherwise         → { ok:true, to, cc, pdf:boolean, messageId }
//
// Every external edge (data, template, pdf, mail, directory, log) is injectable
// via `deps` so tests never hit real SMTP or spawn Chrome.

const REPORT_TYPE = 'coordinator';

function _defaults() {
  return {
    siteReportData: require('./siteReport').siteReportData,
    buildSiteReportDeps: require('./siteReportDeps').buildSiteReportDeps,
    composeCoordinator: require('./reportTemplates/coordinator').composeCoordinator,
    renderPdf: require('./reportRender').renderPdf,
    buildMailer: require('./mailer').buildMailer,
    reportConfig: require('./reportConfig'),
    reportDirectory: require('./reportDirectory'),
    reportSentLog: require('./reportSentLog'),
    reportsDb: require('../reports-db'),
  };
}

// 'YYYY-MM' → {year, month}. The caller owns period formatting so the log row,
// the dedup key and the PDF filename all carry the SAME string.
function _parsePeriod(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!m) throw new Error(`invalid period "${period}" (expected YYYY-MM)`);
  return { year: +m[1], month: +m[2] };
}

async function sendCoordinatorReport({ db, cfg, site, period, kind = 'weekly', force = false, preview = false, deps } = {}) {
  const D = { ..._defaults(), ...(deps || {}) };
  const t0 = Date.now();

  if (!site) throw new Error('site is required');
  const { year, month } = _parsePeriod(period);

  console.log(`[report-send] START type=${REPORT_TYPE} site=${site} period=${period} kind=${kind}${preview ? ' preview=1' : ''}${force ? ' force=1' : ''}`);

  // 1 · resolve the site BEFORE composing. Every reader downstream degrades
  // silently on an unknown code: siteReport's _safe() zeroes each failed block,
  // and getSiteMonthlyMeetingSummary answers {available:true, kpis:0...} for a
  // well-formed-but-unmapped code. Those zeros score 50/AMBER — a report that
  // looks measured and is entirely fabricated. The recipients site_code field is
  // free text (PUT /api/reports/recipients/:site upserts any string), so one
  // typo would mail that fiction to a confirmed address. Fail CLOSED instead.
  const resolved = await D.reportsDb.getSiteIdByModuleCode('meetings', site);
  if (!resolved) {
    const reason = `site "${site}" has no meetings module code — cannot report`;
    console.warn(`[report-send] SKIP site=${site} period=${period} reason=${reason}`);
    return { skipped: true, reason };
  }

  // 2-3 · compose the data, then the document.
  const data = await D.siteReportData(site, { year, month, kind }, D.buildSiteReportDeps());
  const { subject, htmlBody, fullHtml } = D.composeCoordinator(data);

  // 4 · preview short-circuits BEFORE recipient resolution, PDF and mail.
  // No send, no log row — a preview must be free of side effects.
  if (preview) return { preview: true, subject, html: fullHtml };

  // 5 · safety gate: no confirmed recipient → never send.
  const config = cfg || await D.reportConfig.getConfig(db);
  const rows = await D.reportDirectory.listRecipients(db);
  const rcpt = D.reportDirectory.resolveFromRows(rows, site, REPORT_TYPE, {
    neverSendUnconfirmed: config.never_send_unconfirmed === '1',
  });
  if (!rcpt) {
    const reason = 'no confirmed recipient';
    console.warn(`[report-send] SKIP site=${site} period=${period} reason=${reason}`);
    return { skipped: true, reason };
  }

  // 6 · dedup — note the db FIRST arg; omitting it silently defeats the check.
  if (!force && await D.reportSentLog.alreadySentToday(db, REPORT_TYPE, site, period)) {
    const reason = 'already sent today';
    console.log(`[report-send] SKIP site=${site} period=${period} reason=${reason}`);
    return { skipped: true, reason };
  }

  // 7 · PDF is BEST-EFFORT. A missing browser / a render timeout degrades the
  // email to html-only — it must never cost the coordinator their report.
  const pdf = await D.renderPdf(fullHtml, { stamp: `${site}-${period}` });
  if (!pdf.ok) console.warn(`[report-send] pdf unavailable site=${site} period=${period} reason=${pdf.reason} — sending html-only`);

  // 8 · send.
  const sent = await D.buildMailer(config).send({
    to: rcpt.to,
    cc: rcpt.cc,
    subject,
    html: htmlBody,
    attachments: pdf.ok ? [{ filename: `IT-Report-${site}-${period}.pdf`, content: pdf.pdf }] : [],
  });

  // 9 · record the outcome EITHER WAY. Only result='ok' rows count for dedup,
  // so a logged failure stays retryable while still leaving an audit trail.
  const recipients = [rcpt.to, ...(rcpt.cc || [])].join(',');
  await D.reportSentLog.record(db, {
    report_type: REPORT_TYPE, site_code: site, period, recipients,
    result: sent.ok ? 'ok' : 'fail',
  });

  const dur = Date.now() - t0;
  if (!sent.ok) {
    console.error(`[report-send] FAIL site=${site} period=${period} to=${rcpt.to} reason=${sent.error} (${dur}ms)`);
    throw new Error(`send failed: ${sent.error}`);
  }
  console.log(`[report-send] OK site=${site} period=${period} to=${rcpt.to} pdf=${pdf.ok ? pdf.pdf.length + 'B' : 'none'} (${dur}ms)`);
  return { ok: true, to: rcpt.to, cc: rcpt.cc, pdf: !!pdf.ok, messageId: sent.messageId };
}

module.exports = { sendCoordinatorReport, _parsePeriod, REPORT_TYPE };
