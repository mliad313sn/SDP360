'use strict';
// The WEEKLY send pipeline. Sibling of services/sendCoordinator.js (monthly),
// deliberately NOT a shared implementation: the two share reportDirectory /
// reportSentLog / mailer but nothing else, so a weekly bug cannot destabilise
// the monthly send the coordinators already depend on.
//
// Contract — sendWeeklyReport({db, cfg, site, year, week, force, preview, deps}):
//   loader refused    → { skipped:true, reason:<the loader's own words, verbatim> }
//   preview           → { preview:true, subject, html }   (never sends, never logs)
//   no confirmed rcpt → { skipped:true, reason:'no confirmed recipient' }
//   already sent today→ { skipped:true, reason:'already sent today' }
//   otherwise         → { ok:true, to, cc, pptx:boolean, messageId }
//
// ── THE ORDER, and why it is two paths and not one ──────────────────────────
//
//   PREVIEW: data → compose({...data, pptxFailed:false}) → return
//   SEND:    data → recipients → dedup → PPTX → compose({...data, pptxFailed}) → mail → log
//
// `subject`/`html` are OUTPUTS of composeWeekly, so a preview cannot short-
// circuit before composing. `pptxFailed` is an INPUT to it (weekly.js:316 prints
// a "the deck could not be attached" note), so the send path cannot compose
// before attempting the deck. Those two constraints do not fit one linear order.
// Composition still happens exactly ONCE per path.
//
// PPTX sits AFTER the gates, never before — mirroring sendCoordinator.js:140-148,
// where the expensive PDF follows the dedup check. A ~13-site fleet loop at 60s
// each would otherwise burn ~13 minutes rendering decks for a run that mails
// nothing. Tests 4 and 6 pin this by asserting generatePptx ran zero times.

const REPORT_TYPE = 'weekly_report';

// A per-site cap on the deck. The send route caps the whole request at 120s
// (server.js:4933), so 60s leaves room for the mail round-trip after it.
const PPTX_TIMEOUT_MS = 60_000;

// Resolved lazily and ONLY for the keys the caller did not inject — requiring
// reports-db/meetings-db opens a real database connection as a side effect, so
// a fully-injected call (every test) must never touch them. Spreading real
// modules into a defaults object would evaluate all of them eagerly and defeat
// that. Same pattern as weeklyReportData.js:27.
const DEFAULTS = {
  weeklyReportData: () => require('./weeklyReportData.js').loadWeeklyReportData,
  composeWeekly:    () => require('./reportTemplates/weekly.js').composeWeekly,
  reportDirectory:  () => require('./reportDirectory.js'),
  reportSentLog:    () => require('./reportSentLog.js'),
  reportConfig:     () => require('./reportConfig.js'),
  buildMailer:      () => require('./mailer.js').buildMailer,
  generatePptx:     () => require('../reports-weekly-pptx.js').generateWeeklyPptx,
  reportsDb:        () => require('../reports-db.js'),
  meetingsDb:       () => { try { return require('../meetings-db.js'); } catch (e) { return null; } },
};
function _resolveDeps(deps) {
  const out = {};
  for (const [name, load] of Object.entries(DEFAULTS)) {
    out[name] = (deps && deps[name] !== undefined) ? deps[name] : load();
  }
  return out;
}

// The ONE place the period string is built. The dedup key, the log row and the
// attachment filename all read from here, so they can never disagree.
// ZERO-PADDED: '2026-W3' and '2026-W03' are different strings to
// alreadySentToday, and a mix of the two silently defeats dedup for weeks 1-9.
function weekPeriod(year, week) {
  const y = parseInt(year, 10);
  const w = parseInt(week, 10);
  if (!Number.isFinite(y) || !Number.isFinite(w)) {
    throw new Error(`invalid week (year=${year}, week=${week})`);
  }
  return `${y}-W${String(w).padStart(2, '0')}`;
}

/** Reject after `ms` rather than hanging the whole send on one slow deck. */
function _withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    if (timer.unref) timer.unref();   // never hold the CLI process open
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/**
 * Build the deck. BEST-EFFORT: every failure — arg assembly, render, timeout —
 * degrades to an html-only e-mail. A missing attachment must never cost the
 * coordinator their report, and the template says so in the footer when this
 * returns null.
 *
 * The five args mirror server.js:6046-6063 exactly. Two things there are easy to
 * get wrong: `prevReport` is NOT a report, it is `{infra_kpis}`; and the groups
 * come from the site's comma-separated zoho_group. That route reaches for
 * listSites() to get it, but getReport already selects `s.zoho_group` on BOTH
 * backends (reports-db.js:2039 and :2537) — so no extra round-trip is needed.
 */
async function _buildPptx(D, report, timeoutMs) {
  const prevData = await D.reportsDb.getPreviousWeekInfraKpis(report.site_id, report.id);
  const prevReport = prevData && prevData.kpis && prevData.kpis.length
    ? { infra_kpis: prevData.kpis } : null;

  const groups = String(report.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
  const openChanges     = await D.reportsDb.getOpenChangesForSite(groups);
  const activeIncidents = await D.reportsDb.getActiveMajorIncidentsForSite(groups);

  // server.js's _meetingsSummaryForSite (server.js:6033-6040) is not exported,
  // so its eight lines are inlined here — same mapping, same degrade-to-null.
  const ref = String(report.end_date || report.start_date || '');
  const meetingsSummary = await _meetingsSummary(D.meetingsDb, report.site_name, ref.slice(0, 4), ref.slice(5, 7));

  return _withTimeout(
    Promise.resolve(D.generatePptx(report, prevReport, openChanges, activeIncidents, meetingsSummary)),
    timeoutMs,
    'pptx',
  );
}

async function _meetingsSummary(meetingsDb, siteName, year, month) {
  try {
    if (!meetingsDb || !siteName || !year || !month) return null;
    const code = meetingsDb.siteNameToCode(siteName);
    if (!code) return null;
    return await meetingsDb.getSiteMonthlyMeetingSummary(code, parseInt(year, 10), parseInt(month, 10));
  } catch (e) {
    console.warn('[weekly-send] meetings summary failed:', e.message);
    return null;
  }
}

async function sendWeeklyReport({ db, cfg, site, year, week, force = false, preview = false, pptxTimeoutMs = PPTX_TIMEOUT_MS, deps } = {}) {
  const D = _resolveDeps(deps);
  const t0 = Date.now();

  if (!site) throw new Error('site is required');
  const period = weekPeriod(year, week);

  console.log(`[weekly-send] START site=${site} period=${period}${preview ? ' preview=1' : ''}${force ? ' force=1' : ''}`);

  // 1 · load. The loader owns every "why not" decision (unknown code, inactive
  // site, no report, not submitted) and words each one for the Service Desk
  // Manager. Propagate its reason VERBATIM — rewording it here would give the
  // same condition two different explanations depending on the caller.
  const data = await D.weeklyReportData({ siteCode: site, year, week });
  if (!data || !data.ok) {
    const reason = (data && data.reason) || 'weekly report data unavailable';
    console.warn(`[weekly-send] SKIP site=${site} period=${period} reason=${reason}`);
    return { skipped: true, reason };
  }

  // 2 · PREVIEW PATH — composes and returns. No recipients, no deck, no mail,
  // no log row: a preview must be free of side effects. pptxFailed is false
  // because no deck was attempted, and the preview is not an e-mail with a
  // missing attachment.
  // Config is resolved BEFORE the preview branch, not after: the composer reads
  // public_base_url from it to link the asset figures, and a preview that
  // silently dropped those links would not be a preview of what gets sent. It is
  // a read, so the preview stays side-effect-free.
  const config = cfg || await D.reportConfig.getConfig(db);
  const baseUrl = String(config.public_base_url || '').replace(/\/+$/, '');

  if (preview) {
    const { subject, fullHtml } = D.composeWeekly({ ...data, base_url: baseUrl, pptxFailed: false });
    return { preview: true, subject, html: fullHtml };
  }

  // 3 · safety gate: no confirmed recipient → never send. Same rule as the
  // monthly sender; the weekly must not become the loophole that mails an
  // unconfirmed address.
  const rows = await D.reportDirectory.listRecipients(db);
  const rcpt = D.reportDirectory.resolveFromRows(rows, site, 'coordinator', {
    neverSendUnconfirmed: config.never_send_unconfirmed === '1',
  });
  if (!rcpt) {
    const reason = 'no confirmed recipient';
    console.warn(`[weekly-send] SKIP site=${site} period=${period} reason=${reason}`);
    return { skipped: true, reason };
  }

  // 4 · dedup — note the db FIRST arg; omitting it silently defeats the check.
  if (!force && await D.reportSentLog.alreadySentToday(db, REPORT_TYPE, site, period)) {
    const reason = 'already sent today';
    console.log(`[weekly-send] SKIP site=${site} period=${period} reason=${reason}`);
    return { skipped: true, reason };
  }

  // 5 · the deck, best-effort — and only now, past both gates.
  let pptx = null;
  try {
    pptx = await _buildPptx(D, data.report, pptxTimeoutMs);
  } catch (e) {
    console.warn(`[weekly-send] pptx unavailable site=${site} period=${period} reason=${e.message} — sending html-only`);
    pptx = null;
  }

  // 6 · compose, now that the deck's fate is known — pptxFailed is an INPUT.
  const { subject, htmlBody } = D.composeWeekly({ ...data, base_url: baseUrl, pptxFailed: !pptx });

  // 7 · send.
  const sent = await D.buildMailer(config).send({
    to: rcpt.to,
    cc: rcpt.cc,
    subject,
    html: htmlBody,
    attachments: pptx ? [{ filename: `Weekly-Report-${site}-${period}.pptx`, content: pptx }] : [],
  });

  // 8 · record EITHER WAY. Only 'ok' and 'resent' count for dedup, so a logged
  // failure stays retryable while still leaving an audit trail. A deliberate
  // force=1 re-send is tagged 'resent' — a dedup-VISIBLE value, so the period
  // still reads as sent; renaming it to anything outside ('ok','resent') would
  // silently disable "already sent today" forever.
  const recipientLine = [rcpt.to, ...(rcpt.cc || [])].join(',');
  await D.reportSentLog.record(db, {
    report_type: REPORT_TYPE, site_code: site, period, recipients: recipientLine,
    result: sent.ok ? (force ? 'resent' : 'ok') : 'fail',
  });

  const dur = Date.now() - t0;
  if (!sent.ok) {
    console.error(`[weekly-send] FAIL site=${site} period=${period} to=${rcpt.to} reason=${sent.error} (${dur}ms)`);
    throw new Error(`send failed: ${sent.error}`);
  }
  console.log(`[weekly-send] OK site=${site} period=${period} to=${rcpt.to} pptx=${pptx ? pptx.length + 'B' : 'none'} (${dur}ms)`);
  return { ok: true, to: rcpt.to, cc: rcpt.cc, pptx: !!pptx, messageId: sent.messageId };
}

module.exports = { sendWeeklyReport, weekPeriod, REPORT_TYPE, PPTX_TIMEOUT_MS };
