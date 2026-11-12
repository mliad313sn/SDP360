'use strict';
// A-27 — catalogue rule A11: nightly PPM exception alerts (task / milestone late, blocked or unowned, dependency
// blocked, baseline slip). ARMED OFF: while report_config ppm_alerts_enabled != '1' (or with --dry-run) it only
// prints the would-notify list and records nothing. Armed: in-app notice to the project owner (matched to a user by
// username / full name / e-mail) and to the committee (admin tier + committee-member), one alert_firings row per new
// item (dedup ppm_alert_state: the same item is not re-notified within 7 days; an item that disappears is cleared).
// External channels (e-mail) only when alert_external_enabled = '1' AND notifications_stop != '1' (G16).
//
//   node tools/governance/ppm-alerts.js            # one pass (dry run while disarmed)
//   node tools/governance/ppm-alerts.js --dry-run  # preview only
const path = require('path');
if (require.main === module) require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { findExceptions } = require('../../services/ppmAlerts');
const { resourceConflicts } = require('../../services/projectSchedule');
const { ownerMatches } = require('../../services/portfolioAccess');

const RENOTIFY_DAYS = 7;
const num = (x, d) => (x != null && String(x).trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : d);

function _defaultDeps() {
  const rdb = require('../../reports-db');
  const gov = require('../../routes/governance').createStore(rdb);
  const eng = require('../../services/engagementStore').makeEngagementStore({ prepare: (sql) => rdb.pgHandle().prepare(sql) }, { isPg: true });
  return {
    loadConfig: () => require('../../services/reportConfig').getConfig(rdb.db),
    store: gov, eng,
    listUsers: () => rdb.listUsers(),
    isCommittee: (u) => rdb.userHasRole(u, 'admin') || rdb.userHasRole(u, 'committee-member'),
    buildMailer: (cfg) => require('../../services/mailer').buildMailer(cfg),
    now: () => new Date(),
  };
}

/** Who receives an item: the owner's user account (if the free-text owner matches one) + every committee member. */
function recipientsFor(item, users, isCommittee) {
  const active = (users || []).filter((u) => u.active !== 0 && u.active !== false);
  const owner = item.owner ? active.filter((u) => ownerMatches({ owner: item.owner }, u)) : [];
  const out = new Map();
  for (const u of [...owner, ...active.filter((u) => isCommittee(u))]) out.set(Number(u.id), u);
  return [...out.values()];
}

async function run({ dryRun = false, deps = {}, log = console.log } = {}) {
  const D = { ...(deps.store ? {} : _defaultDeps()), ...deps };
  const cfg = D.config || await D.loadConfig();
  const nowD = D.now(); const nowIso = nowD.toISOString(); const today = nowIso.slice(0, 10);
  const armed = String(cfg.ppm_alerts_enabled) === '1' && !dryRun;
  const pf = await D.store.portfolio();
  // E-R02 (A10) — stage-gate reminders only with a10_gate_lead_days set, never while notifications_stop = '1'
  const stop = String(cfg.notifications_stop || '0') === '1';
  const items = findExceptions(pf, { today, blockedDays: num(cfg.ppm_alert_blocked_days, 5), slipDays: num(cfg.ppm_alert_slip_days, 10), gateLeadDays: stop ? null : num(cfg.a10_gate_lead_days, null),
    capacity: resourceConflicts(pf.tasks || []) });   // F-PRODUCT-02: over-allocation reaches A11 (known allocations only)
  const states = new Map((await D.store.alertStates()).map((s) => [s.item_key, s]));
  const due = items.filter((it) => { const s = states.get(it.key); if (!s || s.cleared_at || !s.last_notified) return true; return (Date.parse(nowIso) - Date.parse(s.last_notified)) / 86400000 >= RENOTIFY_DAYS; });
  const users = await D.listUsers();
  const preview = due.map((it) => ({ key: it.key, kind: it.kind, project: it.project_key, message: it.message, recipients: recipientsFor(it, users, D.isCommittee).map((u) => u.username) }));
  if (!armed) {
    log(`[ppm-alerts] ${dryRun ? 'dry run' : 'disarmed (ppm_alerts_enabled != 1) — dry run'}: ${items.length} exception(s), ${due.length} would notify`);
    for (const p of preview) log(`  - ${p.key} → ${p.recipients.join(', ') || '(nobody)'} · ${p.message}`);
    return { dry_run: true, armed: false, items: items.length, would_notify: preview };
  }
  const external = String(cfg.alert_external_enabled || '0') === '1' && String(cfg.notifications_stop || '0') !== '1';
  const mailer = external && D.buildMailer ? D.buildMailer(cfg) : null;
  let notified = 0, firings = 0, mailed = 0, cleared = 0;
  for (const it of due) {
    const rc = recipientsFor(it, users, D.isCommittee);
    for (const u of rc) { await D.eng.notify({ userId: u.id, kind: 'ppm_exception', title: `PPM exception: ${it.kind.replace(/_/g, ' ')}`, body: it.message, link: it.project_id ? `/project.html?id=${it.project_id}` : '/cockpit.html', sourceKind: 'ppm_exception', sourceRef: it.key }); notified++; }
    const channels = ['inapp'];
    if (mailer) { const to = rc.map((u) => u.email).filter(Boolean); if (to.length) { const r = await mailer.send({ to, subject: `[PPM exception] ${it.kind.replace(/_/g, ' ')} — ${it.project_key || ''}`.trim(), html: `<p>${String(it.message).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>` }); if (r && r.ok) { mailed++; channels.push('email'); } } }
    await D.eng.recordFiring({ rule: { key: 'ppm.' + it.kind, severity: 'warning', channels }, reading: { site_id: it.site_id, value: 1 }, message: it.message }); firings++;
    const s = states.get(it.key);
    await D.store.saveAlertState({ item_key: it.key, kind: it.kind, project_id: it.project_id, first_seen: s && !s.cleared_at ? s.first_seen : today, last_notified: nowIso, cleared_at: null });
  }
  const live = new Set(items.map((i) => i.key));
  for (const s of states.values()) if (!s.cleared_at && !live.has(s.item_key)) { await D.store.saveAlertState({ ...s, cleared_at: nowIso }); cleared++; }
  log(`[ppm-alerts] ${items.length} exception(s), ${firings} new firing(s), ${notified} in-app notice(s), ${mailed} e-mail(s), ${cleared} cleared`);
  return { dry_run: false, armed: true, items: items.length, firings, notified, mailed, cleared };
}

async function main(argv = process.argv.slice(2)) { return run({ dryRun: argv.includes('--dry-run') }); }

if (require.main === module) {
  (async () => { await require('../../reports-db').initPgReports(); await main(); process.exit(0); })()
    .catch((e) => { console.error('[ppm-alerts]', String(e && e.message || e).slice(0, 300)); process.exit(1); });
}

module.exports = { run, main, recipientsFor, RENOTIFY_DAYS };
