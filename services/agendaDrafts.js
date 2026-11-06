'use strict';
// E-G03 (catalogue A13 "agenda built on demand; not compiled on a schedule") — the scheduled job
// governance.agenda_drafts compiles the exception-only agenda of every active cadence due THIS week as a
// DRAFT stored on the cadence (meeting_cadences.draft_agenda, migration 071). It creates no session, sends
// nothing, publishes nothing. Skipped unless report_config agenda_cron_enabled = '1' (default '0').
// The compiler is the cockpit's own agenda builder, registered by routes/governance.js at mount time.
let _compiler = null;
function setCompiler(fn) { _compiler = typeof fn === 'function' ? fn : null; }

const pad = (n) => String(n).padStart(2, '0');
/** PURE: cadences with an ISO weekday (1-7) whose occurrence in the current Mon..Sun week is today or later. */
function dueThisWeek(cadences, now = new Date()) {
  const dow = ((now.getUTCDay() + 6) % 7) + 1;   // ISO 1..7
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out = [];
  for (const c of cadences || []) {
    if (!c || c.active === false || c.active === 0 || c.weekday == null) continue;
    const wd = Number(c.weekday); if (!(wd >= 1 && wd <= 7) || wd < dow) continue;
    const d = new Date(today + (wd - dow) * 864e5);
    const hm = /^\d{2}:\d{2}$/.test(String(c.time_local || '')) ? c.time_local : '09:00';
    out.push({ cadence: c, scheduled_at: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${hm}:00Z` });
  }
  return out;
}

async function run(d = {}) {
  const rdb = d.rdb || require('../reports-db');
  const cfg = d.cfg || await require('./reportConfig').getConfig(rdb.db);
  if (String((cfg && cfg.agenda_cron_enabled) || '0') !== '1') return { skipped: true, reason: 'agenda_cron_enabled is 0' };
  const compile = d.compile || _compiler;
  if (!compile) return { skipped: true, reason: 'cockpit not mounted' };
  const store = d.store || require('./governanceStore').makeGovernanceStore(rdb.pgHandle());
  const due = dueThisWeek(await store.listCadences({}), d.now || new Date());
  let rows = 0; const errors = [];
  for (const x of due) {
    try { const agenda = await compile(x.cadence, x.scheduled_at); await store.saveDraftAgenda(x.cadence.id, { ...agenda, status: 'draft' }, x.scheduled_at); rows++; }
    catch (e) { errors.push({ cadence: x.cadence.key, error: String((e && e.message) || e).slice(0, 120) }); }
  }
  return { rows, due: due.length, errors };
}

module.exports = { setCompiler, dueThisWeek, run };
