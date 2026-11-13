'use strict';
// Standalone runs (Task Scheduler, a manual `node tools/reports/...`) must read the app's .env BEFORE any *-db module
// loads (each picks its backend at require time). In-process calls and tests skip this.
if (require.main === module) require('dotenv').config({ quiet: true, path: require('path').join(__dirname, '..', '..', '.env') });
// W3-GOVERNANCE (PPM parity H6) — the scheduled PROJECT STATUS report: one e-mail to a management distribution list
// with a PDF (when a browser is present on the server; HTML attached otherwise) and an Excel workbook covering every
// in-progress project. Scaffolding mirrors tools/reports/send-asset-group.js: a pure decision gate, gate FIRST, a
// require.main guard, injectable I/O.
//
// SAFETY: armed OFF. Nothing is gathered, composed, mailed or logged unless ppm_report_send_enabled === '1' AND
// ppm_report_recipients holds at least one address. NO AMOUNTS: a distribution list is not a finance reader
// (invariant 2), so the report is always composed with money = false.
//
// Usage: node tools/reports/send-ppm-reports.js --type=ppm_project --cadence=weekly|monthly [--preview] [--force]

function decidePpmReportSend(cfg) {
  const c = cfg || {};
  if (String(c.ppm_report_send_enabled) !== '1') return { send: false, reason: 'disabled' };
  const recipients = String(c.ppm_report_recipients || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!recipients.length) return { send: false, reason: 'no recipients' };
  return { send: true, recipients };
}

const pad2 = (n) => String(n).padStart(2, '0');

async function main(deps = {}) {
  const args = deps.args || Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const preview = deps.preview !== undefined ? deps.preview : ('preview' in args);
  const force = deps.force !== undefined ? deps.force : (('force' in args) && args.force !== '0' && args.force !== 'false');
  const cadence = deps.cadence || args.cadence || 'weekly';
  let rdb = deps.reportsDb, db = deps.db, cfg = deps.cfg;
  if (!rdb) { rdb = require('../../reports-db'); await rdb.initPgReports(); }
  if (!db) db = rdb.db;
  if (!cfg) cfg = await require('../../services/reportConfig').getConfig(db);
  const now = deps.now || new Date();
  const period = `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;

  const gate = decidePpmReportSend(cfg);
  if (!preview && !gate.send) { console.log(`[send-ppm-reports] cadence=${cadence} → not sending (reason=${gate.reason})`); return { sent: 0, reason: gate.reason }; }
  const recipients = gate.recipients || [];

  const alreadySentToday = deps.alreadySentToday || require('../../services/reportSentLog').alreadySentToday;
  if (!preview && !force && await alreadySentToday(db, 'ppm_project', 'GROUP', period)) { console.log('[send-ppm-reports] already sent today — skipping (use --force)'); return { sent: 0, skipped: true, reason: 'already sent' }; }

  // Gather: every live in-progress project (the governance store reads soft-deleted rows as missing)
  const store = deps.store || require('../../routes/governance').createStore(rdb);
  const H = rdb.pgHandle();
  const ids = deps.projectIds || (await H.prepare(`SELECT id FROM portfolio_projects WHERE deleted_at IS NULL AND COALESCE(stage,'proposal') IN ('in_progress','on_hold','closure') ORDER BY key, id`).all()).map((r) => Number(r.id));
  const { projectContext } = require('../../services/ppm/w3Context');
  const blocks = [];
  for (const id of ids.slice(0, 200)) {
    const x = await projectContext({ store, rdb, cfg, projectId: id, money: false });
    if (x) blocks.push({ project: x.project, summary: x.summary, rag: x.rag, dcma: x.dcma, raid: x.raid || [], gates: x.gates });
  }
  const RP = require('../../services/ppm/projectReport');
  const title = `Project status report — ${period}`;
  const html = RP.buildReportHtml({ title, asOf: period, blocks, money: false });
  const xlsx = RP.buildReportWorkbook({ blocks, money: false, asOf: period });
  if (preview) { console.log(`[send-ppm-reports] PREVIEW ${blocks.length} project(s) to=${recipients.join(',') || '—'} — not sending`); return { preview: true, subject: title, html, projects: blocks.length }; }

  const renderPdf = deps.renderPdf || require('../../services/reportRender').renderPdf;
  const pdf = await renderPdf(html).catch(() => ({ ok: false }));
  const attachments = [{ filename: `project-status-${period}.xlsx`, content: xlsx }];
  if (pdf && pdf.ok && pdf.pdf) attachments.push({ filename: `project-status-${period}.pdf`, content: pdf.pdf });
  else attachments.push({ filename: `project-status-${period}.html`, content: Buffer.from(html, 'utf8') });
  const mailerSend = deps.mailerSend || ((msg) => require('../../services/mailer').buildMailer(cfg).send(msg));
  const res = await mailerSend({ to: recipients.join(','), subject: title, html: `<p>${blocks.length} project(s). The report is attached (PDF or HTML, and Excel). No amounts are included.</p>`, attachments });
  const record = deps.record || require('../../services/reportSentLog').record;
  await record(db, { report_type: 'ppm_project', site_code: 'GROUP', period, recipients: recipients.join(','), result: res && res.ok ? (force ? 'resent' : 'ok') : 'fail' });
  console.log(`[send-ppm-reports] DONE ${blocks.length} project(s) → sent=${res && res.ok ? 1 : 0}`);
  return { sent: res && res.ok ? 1 : 0, projects: blocks.length };
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error('[send-ppm-reports] fatal:', e.message); process.exit(1); });
}

module.exports = { decidePpmReportSend, main };
