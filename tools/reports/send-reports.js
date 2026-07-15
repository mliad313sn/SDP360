'use strict';
// Scheduled entry point. Foundation scope: resolves config + recipients + dedup
// and PRINTS what it would send (no composing yet — that lands in sub-project 2).
// Usage: node tools/reports/send-reports.js --type=coordinator --cadence=weekly
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));

(async () => {
  const reportsDb = require('../../reports-db');
  if ((process.env.REPORTS_BACKEND || 'sqlite').toLowerCase() === 'postgres') await reportsDb.initPgReports();
  const reportConfig = require('../../services/reportConfig');
  const reportDirectory = require('../../services/reportDirectory');
  const cfg = await reportConfig.getConfig(reportsDb.db);
  const recipients = await reportDirectory.listRecipients(reportsDb.db);
  const kind = args.type === 'finance' ? 'fm' : 'coordinator';
  const sendable = recipients.filter(r => reportDirectory.resolveFromRows(recipients, r.site_code, kind, { neverSendUnconfirmed: cfg.never_send_unconfirmed === '1' }));
  console.log(`[send-reports] type=${args.type} cadence=${args.cadence} → ${sendable.length}/${recipients.length} site(s) have a confirmed recipient. (composing lands in sub-project 2)`);
  process.exit(0);
})().catch(e => { console.error('[send-reports] fatal:', e.message); process.exit(1); });
