'use strict';
// B-02 — Pilot measurement kit, PURE half (no database, no clock, no I/O).
//
// The pilot report answers "is the platform used for real work, and how fast does work move?"
// from data the platform ALREADY records. Nothing here is a target, a verdict or a score:
// each measure is a median, a count or a share, with its definition and its source tables
// carried in the output so a reader never has to guess what a number means.
//
// Rules this module keeps (CLAUDE.md, .claude/rules/SDP360_BOUNDARIES.md):
//   - a measure with no data prints "no data" — a median of nothing is null, never 0;
//   - no username, full name or e-mail ever reaches the output: the collector only hands in
//     numeric user ids, and the per-user section shows an HMAC pseudonym, never the id;
//   - read-only: this file performs no write and contains no write statement (pinned by a test).
//
// The collector (tools/pilot/pilot-metrics.js) selects the rows; this module filters them to the
// window and the site, buckets them by site × persona × ISO week, and formats Markdown / CSV.

const crypto = require('crypto');
const publishGate = require('./publishGate');

// ── Measure dictionary ──────────────────────────────────────────────────────────────────
const MEASURES = [
  {
    key: 'active_users', label: 'Active users on business events', unit: 'users',
    definition: 'distinct users with at least one business event in the ISO week. Business event = a system_log row '
      + 'whose category is not auth / identity / sync / api / config and whose action is not a page view (*_viewed), '
      + 'or an audit_log row (report actions). Page visits and sign-ins are NOT activity.',
    sources: ['system_log', 'audit_log', 'users'],
  },
  {
    key: 'report_created_to_submitted', label: 'Weekly report created → submitted (proxy, not effort)', unit: 'hours',
    definition: 'median hours from weekly_reports.created_at to weekly_reports.submitted_at, bucketed by the week of '
      + 'submission. PROXY, NOT EFFORT: wall-clock time between opening the report and submitting it, not the time '
      + 'spent writing it — writing time is measured with WEEKLY-REPORT-STOPWATCH.csv. Persona = the submitter.',
    sources: ['weekly_reports', 'sites', 'users'],
  },
  {
    key: 'pv_submitted_to_action', label: 'PV submitted → action created', unit: 'hours',
    definition: 'median hours from md_meetings.submitted_at to md_actions.created_at, for actions created at or after '
      + 'the submission, bucketed by the week of submission. Actions written into the PV before it was submitted are '
      + 'not delays; they are counted in the "before" column. Persona = the PV author.',
    sources: ['md_meetings', 'md_actions', 'users'],
  },
  {
    key: 'action_created_to_closed', label: 'Action created → closed', unit: 'hours',
    definition: 'median hours from creation to closure, bucketed by the week of closure. Meetings: md_actions.created_at '
      + '→ closed_at (else the first resolved/closed row in md_action_updates), status resolved/closed. Inspections: '
      + 'insp_actions.created_at → closed_at, status Closed. Report follow-ups: action_items carry no creation time, so '
      + 'creation = created_at of the first weekly report holding the action (its lineage root), closure = '
      + 'status_changed_at of its newest row when that row is closed. Cancelled and transferred actions are excluded. '
      + 'Persona = the author of the parent PV / inspection / report.',
    sources: ['md_actions', 'md_action_updates', 'md_meetings', 'insp_actions', 'insp_inspections', 'action_items', 'weekly_reports', 'users'],
  },
  {
    key: 'field_outcomes', label: 'Field entries applied / refused / conflicted', unit: 'entries',
    definition: 'field_outbox rows by the week they were received: applied, refused (status rejected), failed '
      + '(retryable), pending (received / applying). Conflicted is NOT RECORDED: a same-uuid-different-payload send is '
      + 'answered 409 and never stored, so the column is null, never 0. Site and persona = the sending user\'s.',
    sources: ['field_outbox', 'users'],
  },
  {
    key: 'field_task_time', label: 'Field task time (form open → queued)', unit: 'seconds',
    definition: 'median and 75th percentile of the active time a field entry took on the phone, from opening the form '
      + 'to queueing it (pauses longer than 2 minutes excluded), per site × kind × ISO week of application. Recorded only '
      + 'while report_config field_task_timing = 1, in the details of the field_<kind>_applied system_log row (user id and '
      + 'role tier only, never a name). No target is set: this is a baseline. Persona column = the kind of entry.',
    sources: ['system_log'],
  },
  {
    key: 'metrics_unknown_or_stale', label: 'Pilot metrics UNKNOWN or stale', unit: '%',
    definition: 'share of published metric-registry entries whose source module has never synced (UNKNOWN) or is past '
      + 'its freshness limit (STALE), with the limits of services/publishGate.js SOURCES; modules typed into the app '
      + '(meetings, inspection, tracker, commitments) have no external source and count as FRESH. Evaluated at the run '
      + 'date, not per week. A metric whose reader returns null for a site is not counted here (that needs the app '
      + 'runtime — see PILOT-MEASUREMENT.md).',
    sources: ['metric registry (services/metricRegistry.js SEED)', 'sync_runs'],
  },
];

// Categories and actions that are NOT business work: sign-in, identity plumbing, sync jobs,
// machine API calls, configuration, and page views.
const NON_BUSINESS_CATEGORIES = new Set(['auth', 'identity', 'sync', 'api', 'config']);
const NON_BUSINESS_ACTIONS = new Set(['login_success', 'login_failed', 'logout', 'session_killed', 'breakglass_login', 'dashkey_call']);

function isBusinessEvent(category, action) {
  const c = String(category || '').toLowerCase();
  const a = String(action || '').toLowerCase();
  if (!a) return false;
  if (NON_BUSINESS_CATEGORIES.has(c)) return false;
  if (NON_BUSINESS_ACTIONS.has(a)) return false;
  if (/_viewed$/.test(a) || /^view(ed)?_/.test(a)) return false;
  return true;
}

// ── Time helpers ────────────────────────────────────────────────────────────────────────
// TEXT timestamps in this schema are 'YYYY-MM-DD', 'YYYY-MM-DD HH:MM:SS' (to_char, no zone) or ISO;
// TIMESTAMPTZ columns come back as Date. A zone-less text is read as UTC so the result never
// depends on the machine running the report.
function toMs(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  let s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z';
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d\d)?$/.test(s.replace(/\.\d{1,9}$/, ''))) s = s.replace(' ', 'T') + 'Z';
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
const dayOf = (v) => { const t = toMs(v); return t == null ? null : new Date(t).toISOString().slice(0, 10); };

/** ISO-8601 week label 'YYYY-Www' (Thursday rule, UTC), or null. */
function isoWeek(v) {
  const t = toMs(v); if (t == null) return null;
  const d = new Date(t); d.setUTCHours(0, 0, 0, 0);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const y = d.getUTCFullYear();
  const wk = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-W${String(wk).padStart(2, '0')}`;
}

function hoursBetween(a, b) {
  const x = toMs(a), y = toMs(b);
  return x == null || y == null ? null : (y - x) / 36e5;
}

/** Median of the finite numbers, or null when there are none (never 0 for "nothing"). */
function median(values) {
  const v = (values || []).filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
/** Linear-interpolated quantile of the finite numbers, or null when there are none. */
function quantile(values, q) {
  const v = (values || []).filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/** HMAC pseudonym of a user id. Throws without a key: a guessable "pseudonym" is no pseudonym. */
function pseudonym(userId, key) {
  if (!key || String(key).length < 16) throw Object.assign(new Error('pseudonymisation key missing or shorter than 16 characters'), { code: 'NO_KEY' });
  return 'u_' + crypto.createHmac('sha256', String(key)).update('sdp360-pilot-user:' + String(userId)).digest('hex').slice(0, 12);
}

// ── Filtering and bucketing ─────────────────────────────────────────────────────────────
function _inWindow(v, from, to) {
  const d = dayOf(v); if (!d) return false;
  return (!from || d >= from) && (!to || d <= to);
}
function _siteOk(site, siteSet) {
  if (!siteSet) return true;
  return siteSet.has(String(site == null ? '' : site).trim().toLowerCase());
}
const _site = (s) => (s == null || String(s).trim() === '' ? '(no site)' : String(s).trim());

function _userIndex(users) {
  const m = new Map();
  for (const u of users || []) if (u && u.id != null) m.set(Number(u.id), { role: u.role || 'unknown', site: u.site == null ? null : u.site });
  return m;
}
const _persona = (ux, id) => (id != null && ux.get(Number(id)) ? ux.get(Number(id)).role : 'unknown');

function _sortRows(rows) {
  return rows.sort((a, b) => a.site.localeCompare(b.site) || a.persona.localeCompare(b.persona) || a.week.localeCompare(b.week));
}

/** Delays → [{site, persona, week, n, median_h, before}]; a bucket with no delay has no row. */
function _medianRows(items) {
  const g = new Map();
  for (const it of items) {
    const k = `${it.site}\u0000${it.persona}\u0000${it.week}`;
    if (!g.has(k)) g.set(k, { site: it.site, persona: it.persona, week: it.week, delays: [], before: 0 });
    const b = g.get(k);
    if (it.hours < 0) b.before++; else b.delays.push(it.hours);
  }
  return _sortRows([...g.values()].map((b) => ({ site: b.site, persona: b.persona, week: b.week, n: b.delays.length, median_h: round1(median(b.delays)), before: b.before })));
}

/**
 * Build the report object. Inputs are rows the collector selected — never names or e-mails.
 * @param {object} o
 *   from, to          'YYYY-MM-DD' inclusive window
 *   siteSet           Set of lower-case site labels to keep (null = every site)
 *   users             [{id, role, site}]
 *   events            [{user_id, ts}]                         (business events only)
 *   reports           [{site, user_id, created_at, submitted_at}]
 *   pvActions         [{site, user_id, submitted_at, action_created_at}]
 *   closures          [{source, site, user_id, created_at, closed_at}]
 *   field             [{user_id, status, received_at}]
 *   fieldTiming       [{site, kind, ts, task_ms}]   (E-F03, from field_*_applied system_log details)
 *   metrics           [{key, module, status}]  (metric registry)
 *   lastOk            {job: ISO|null}           (last successful sync per job)
 *   nowMs, generatedAt, pseudonymKey, policy
 */
function buildReport(o = {}) {
  const { from = null, to = null, siteSet = null } = o;
  const ux = _userIndex(o.users);
  const userSite = (id) => (id != null && ux.get(Number(id)) ? ux.get(Number(id)).site : null);
  const sections = {};

  // Active users — distinct per site × persona × week; per-user lines only under a pseudonym.
  {
    const seen = new Map(); const perUser = new Map();
    for (const e of o.events || []) {
      if (e == null || e.user_id == null || !_inWindow(e.ts, from, to)) continue;
      const site = _site(userSite(e.user_id)); if (!_siteOk(site, siteSet)) continue;
      const persona = _persona(ux, e.user_id), week = isoWeek(e.ts);
      const k = `${site}\u0000${persona}\u0000${week}`;
      if (!seen.has(k)) seen.set(k, { site, persona, week, users: new Set() });
      seen.get(k).users.add(Number(e.user_id));
      const uk = `${Number(e.user_id)}\u0000${week}`;
      if (!perUser.has(uk)) perUser.set(uk, { user_id: Number(e.user_id), site, persona, week, events: 0 });
      perUser.get(uk).events++;
    }
    const rows = _sortRows([...seen.values()].map((b) => ({ site: b.site, persona: b.persona, week: b.week, n: b.users.size })));
    let users = null, note = null;
    if (o.pseudonymKey) {
      users = [...perUser.values()].map((r) => ({ pseudonym: pseudonym(r.user_id, o.pseudonymKey), site: r.site, persona: r.persona, week: r.week, events: r.events }))
        .sort((a, b) => a.site.localeCompare(b.site) || a.week.localeCompare(b.week) || a.pseudonym.localeCompare(b.pseudonym));
    } else note = 'per-user lines omitted: PILOT_PSEUDONYM_KEY is not set in .env (16+ characters).';
    sections.active_users = { rows, users, note };
  }

  // Weekly report created → submitted.
  {
    const items = [];
    for (const r of o.reports || []) {
      if (!r || !r.submitted_at || !_inWindow(r.submitted_at, from, to)) continue;
      const site = _site(r.site); if (!_siteOk(site, siteSet)) continue;
      const h = hoursBetween(r.created_at, r.submitted_at); if (h == null) continue;
      items.push({ site, persona: _persona(ux, r.user_id), week: isoWeek(r.submitted_at), hours: h });
    }
    sections.report_created_to_submitted = { rows: _medianRows(items) };
  }

  // PV submitted → action created.
  {
    const items = [];
    for (const r of o.pvActions || []) {
      if (!r || !r.submitted_at || !_inWindow(r.submitted_at, from, to)) continue;
      const site = _site(r.site); if (!_siteOk(site, siteSet)) continue;
      const h = hoursBetween(r.submitted_at, r.action_created_at); if (h == null) continue;
      items.push({ site, persona: _persona(ux, r.user_id), week: isoWeek(r.submitted_at), hours: h });
    }
    sections.pv_submitted_to_action = { rows: _medianRows(items) };
  }

  // Action created → closed, one row per source.
  {
    const items = [];
    for (const r of o.closures || []) {
      if (!r || !r.closed_at || !_inWindow(r.closed_at, from, to)) continue;
      const site = _site(r.site); if (!_siteOk(site, siteSet)) continue;
      const h = hoursBetween(r.created_at, r.closed_at); if (h == null) continue;
      items.push({ site: `${site} · ${r.source || 'unknown'}`, persona: _persona(ux, r.user_id), week: isoWeek(r.closed_at), hours: h });
    }
    sections.action_created_to_closed = { rows: _medianRows(items) };
  }

  // Field outbox outcomes.
  {
    const g = new Map();
    for (const r of o.field || []) {
      if (!r || !_inWindow(r.received_at, from, to)) continue;
      const site = _site(userSite(r.user_id)); if (!_siteOk(site, siteSet)) continue;
      const persona = _persona(ux, r.user_id), week = isoWeek(r.received_at);
      const k = `${site}\u0000${persona}\u0000${week}`;
      if (!g.has(k)) g.set(k, { site, persona, week, applied: 0, refused: 0, failed: 0, pending: 0, conflicted: null });
      const b = g.get(k); const s = String(r.status || '');
      if (s === 'applied') b.applied++; else if (s === 'rejected') b.refused++; else if (s === 'failed') b.failed++; else b.pending++;
    }
    sections.field_outcomes = { rows: _sortRows([...g.values()]) };
  }

  // E-F03 — field task time: median / p75 per site × kind × week; a bucket with no sample has no row.
  {
    const g = new Map();
    for (const r of o.fieldTiming || []) {
      if (!r || !_inWindow(r.ts, from, to)) continue;
      const ms = Number(r.task_ms); if (!Number.isFinite(ms) || ms < 0) continue;
      const site = _site(r.site); if (!_siteOk(site, siteSet)) continue;
      const kind = String(r.kind || 'unknown'), week = isoWeek(r.ts);
      const k = `${site}\u0000${kind}\u0000${week}`;
      if (!g.has(k)) g.set(k, { site, persona: kind, week, v: [] });
      g.get(k).v.push(ms / 1000);
    }
    sections.field_task_time = { rows: _sortRows([...g.values()].map((b) => ({ site: b.site, persona: b.persona, week: b.week, n: b.v.length, median_s: round1(median(b.v)), p75_s: round1(quantile(b.v, 0.75)) }))) };
  }

  // Registry freshness share (as of the run date).
  sections.metrics_unknown_or_stale = freshnessShare(o.metrics, o.lastOk, o.nowMs, o.policy);

  return { from, to, sites: siteSet ? [...siteSet].sort() : null, generated_at: o.generatedAt || null, measures: MEASURES, sections };
}

/** Share of published registry metrics whose source is UNKNOWN or STALE. */
function freshnessShare(metrics, lastOk, nowMs, policy) {
  const list = (metrics || []).filter((m) => m && (m.status == null || m.status === 'published'));
  if (!list.length || !Number.isFinite(Number(nowMs))) return { rows: [], total: 0, unknown: 0, stale: 0, share_pct: null };
  const byModule = new Map();
  for (const m of list) {
    const mod = m.module || 'unknown';
    if (!byModule.has(mod)) byModule.set(mod, { module: mod, metrics: 0, state: publishGate.moduleFreshness(mod, lastOk || {}, Number(nowMs), policy).state });
    byModule.get(mod).metrics++;
  }
  const rows = [...byModule.values()].sort((a, b) => a.module.localeCompare(b.module));
  const unknown = rows.filter((r) => r.state === 'UNKNOWN').reduce((t, r) => t + r.metrics, 0);
  const stale = rows.filter((r) => r.state === 'STALE').reduce((t, r) => t + r.metrics, 0);
  return { rows, total: list.length, unknown, stale, share_pct: round1(100 * (unknown + stale) / list.length) };
}

// ── Formatting ──────────────────────────────────────────────────────────────────────────
const _cell = (v) => (v == null ? '—' : String(v).replace(/\|/g, '/'));
function _mdTable(head, rows) {
  return ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|', ...rows.map((r) => '| ' + r.map(_cell).join(' | ') + ' |')].join('\n');
}

function toMarkdown(rep) {
  const out = [];
  out.push('# SDP360 pilot measurement report');
  out.push('');
  out.push(`Window: ${rep.from || '…'} → ${rep.to || '…'} · Sites: ${rep.sites ? rep.sites.join(', ') : 'all'} · Generated: ${rep.generated_at || '—'}`);
  out.push('');
  out.push('Read-only report built from data the platform already records. Not a target, not a verdict. '
    + 'A measure with no data says "no data" — it is never shown as 0. No user name or e-mail appears below.');
  for (const m of rep.measures) {
    const s = rep.sections[m.key] || { rows: [] };
    out.push('', `## ${m.label}`, '', `- Definition: ${m.definition}`, `- Source tables: ${m.sources.join(', ')}`, `- Unit: ${m.unit}`, '');
    if (m.key === 'metrics_unknown_or_stale') {
      if (!s.total) { out.push('no data'); continue; }
      out.push(`${s.unknown + s.stale} of ${s.total} published metrics are UNKNOWN or stale: ${s.share_pct} % (UNKNOWN ${s.unknown}, STALE ${s.stale}).`, '');
      out.push(_mdTable(['Module', 'Metrics', 'Source state'], s.rows.map((r) => [r.module, r.metrics, r.state])));
      continue;
    }
    if (!s.rows.length) { out.push('no data'); }
    else if (m.key === 'active_users') out.push(_mdTable(['Site', 'Persona', 'Week', 'Active users'], s.rows.map((r) => [r.site, r.persona, r.week, r.n])));
    else if (m.key === 'field_task_time') out.push(_mdTable(['Site', 'Kind', 'Week', 'n', 'Median (s)', 'p75 (s)'], s.rows.map((r) => [r.site, r.persona, r.week, r.n, r.median_s, r.p75_s])));
    else if (m.key === 'field_outcomes') out.push(_mdTable(['Site', 'Persona', 'Week', 'Applied', 'Refused', 'Failed', 'Pending', 'Conflicted'], s.rows.map((r) => [r.site, r.persona, r.week, r.applied, r.refused, r.failed, r.pending, r.conflicted == null ? 'not recorded' : r.conflicted])));
    else out.push(_mdTable(['Site', 'Persona', 'Week', 'n', 'Median (h)', 'Before'], s.rows.map((r) => [r.site, r.persona, r.week, r.n, r.median_h == null ? 'no data' : r.median_h, r.before])));
    if (m.key === 'active_users') {
      out.push('');
      if (s.users && s.users.length) { out.push('Per-user activity (pseudonymised):', '', _mdTable(['Pseudonym', 'Site', 'Persona', 'Week', 'Business events'], s.users.map((u) => [u.pseudonym, u.site, u.persona, u.week, u.events]))); }
      else if (s.note) out.push(s.note);
    }
  }
  return out.join('\n') + '\n';
}

// Formula-injection guard (CWE-1236): a site label is data, never a spreadsheet formula.
const { neutralize } = require('../public/lib/csvSafe');
const _csv = (v) => { const s = neutralize(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function toCsv(rep) {
  const lines = [];
  lines.push(`# SDP360 pilot measurement report; window ${rep.from || ''}..${rep.to || ''}; sites ${rep.sites ? rep.sites.join(' ') : 'all'}; generated ${rep.generated_at || ''}`);
  lines.push('# empty value = no data (never 0); conflicted = not recorded by the server');
  for (const m of rep.measures) lines.push('# ' + [m.key, m.unit, 'sources: ' + m.sources.join(' '), m.definition].map((x) => String(x).replace(/[\r\n]+/g, ' ')).join(' | '));
  lines.push(['measure', 'site', 'persona', 'week', 'n', 'value', 'before', 'applied', 'refused', 'failed', 'pending', 'conflicted', 'state'].join(','));
  let rows = 0;
  for (const m of rep.measures) {
    const s = rep.sections[m.key] || { rows: [] };
    for (const r of s.rows || []) {
      rows++;
      if (m.key === 'active_users') lines.push([m.key, r.site, r.persona, r.week, r.n, r.n, '', '', '', '', '', '', ''].map(_csv).join(','));
      else if (m.key === 'field_outcomes') lines.push([m.key, r.site, r.persona, r.week, r.applied + r.refused + r.failed + r.pending, '', '', r.applied, r.refused, r.failed, r.pending, r.conflicted, ''].map(_csv).join(','));
      else if (m.key === 'field_task_time') lines.push([m.key, r.site, r.persona, r.week, r.n, r.median_s, '', '', '', '', '', '', 'p75=' + r.p75_s].map(_csv).join(','));
      else if (m.key === 'metrics_unknown_or_stale') lines.push([m.key, '', r.module, '', r.metrics, '', '', '', '', '', '', '', r.state].map(_csv).join(','));
      else lines.push([m.key, r.site, r.persona, r.week, r.n, r.median_h, r.before, '', '', '', '', '', ''].map(_csv).join(','));
    }
    if (m.key === 'metrics_unknown_or_stale' && s.total) lines.push([m.key, '', 'TOTAL', '', s.total, s.share_pct, '', '', '', '', '', '', ''].map(_csv).join(','));
    if (m.key === 'active_users') for (const u of s.users || []) lines.push(['active_user_pseudonym', u.site, u.persona, u.week, u.events, u.pseudonym, '', '', '', '', '', '', ''].map(_csv).join(','));
  }
  if (!rows) lines.push('# no data');
  return lines.join('\n') + '\n';
}

// ── E-B03 — value table (audit §9): one row per proposed indicator ─────────────────────
// Every row carries a PROPOSED definition, its formula, source, population, observations n, value, and the ROLES
// that own and validate it (never a name). A value with no recorded source is null with state UNKNOWN and the
// missing source named — never 0. No target is set anywhere: this is the baseline instrument (§9.1).
const VALUE_OWNER = 'Product owner (pilot)';
const VALUE_VALIDATOR = 'Business validator (to be named)';
function _vRow(o) {
  return { key: o.key, indicator: o.indicator, definition: o.definition, formula: o.formula, source: o.source,
    population: o.population == null ? null : o.population, n: o.n == null ? null : o.n, value: o.value == null ? null : o.value,
    unit: o.unit || null, state: o.value == null ? 'UNKNOWN' : 'MEASURED', missing: o.value == null ? (o.missing || 'no observation in the window') : null,
    owner_role: o.owner_role || VALUE_OWNER, validator_role: o.validator_role || VALUE_VALIDATOR };
}
const _num = (v) => (v == null || String(v).trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const _pct = (a, b) => (b > 0 ? round1(100 * a / b) : null);

/**
 * @param {object} o  from, to, events [{user_id, ts}], targetedUserIds [ids]|null, lastOk {job: ISO|null}, nowMs, policy,
 *   commitmentsEnabled bool, commitments [{status, created_at, technical_completed_at, verified_at}],
 *   fieldTiming [{ts, task_ms}], stopwatch [{phase, active_minutes}]|null
 */
function buildValueTable(o = {}) {
  const { from = null, to = null } = o;
  const rows = [];
  // Report preparation time — WEEKLY-REPORT-STOPWATCH.csv, one row per phase (baseline vs pilot, constant scope §9.1)
  for (const phase of ['baseline', 'pilot']) {
    const v = (o.stopwatch || []).filter((r) => String(r.phase || '').trim().toLowerCase() === phase).map((r) => _num(r.active_minutes)).filter((x) => x != null);
    rows.push(_vRow({ key: `report_preparation_${phase}`, indicator: `Report preparation time — ${phase}`, unit: 'minutes',
      definition: 'median active minutes per complete weekly report, from start to submission, stopwatch-observed (proposed)',
      formula: 'median(active_minutes) over the sheet rows of this phase', source: 'docs/ops/pilot/WEEKLY-REPORT-STOPWATCH.csv',
      population: 'observed reports, per site and role', n: v.length, value: round1(median(v)),
      missing: o.stopwatch == null ? 'stopwatch sheet not supplied (--stopwatch=FILE)' : `no filled ${phase} row in the stopwatch sheet`, owner_role: 'Site IT coordinator', validator_role: 'Service & Support Manager' }));
  }
  // Verified closure delay + share of verified actions — commitment model only
  {
    const off = !o.commitmentsEnabled;
    const list = off ? [] : (o.commitments || []);
    const verified = list.filter((c) => c && c.status === 'verified_closed' && c.verified_at && _inWindow(c.verified_at, from, to));
    const delays = verified.map((c) => hoursBetween(c.created_at, c.verified_at)).filter((h) => h != null && h >= 0);
    const missingC = off ? 'commitment model off (report_config commitments_enabled = 0)' : 'no commitment verified in the window';
    rows.push(_vRow({ key: 'verified_closure_delay', indicator: 'Verified closure delay', unit: 'hours',
      definition: 'median of verified closure date − opening date (proposed; split by severity is a follow-up)',
      formula: 'median(verified_at − created_at) for commitments verified_closed in the window', source: 'commitments (db 021)',
      population: 'commitments verified in the window', n: delays.length, value: round1(median(delays)), missing: missingC, validator_role: 'Independent reviewer role (commitments.reviewer)' }));
    const tech = list.filter((c) => c && c.technical_completed_at && _inWindow(c.technical_completed_at, from, to));
    const ok = tech.filter((c) => c.status === 'verified_closed').length;
    rows.push(_vRow({ key: 'verified_action_share', indicator: 'Share of verified actions', unit: '%',
      definition: 'actions closed with independent verification ÷ actions technically completed (proposed)',
      formula: 'count(verified_closed) ÷ count(technical_completed_at in window)', source: 'commitments (db 021)',
      population: 'commitments technically completed in the window', n: tech.length, value: _pct(ok, tech.length),
      missing: off ? missingC : 'no commitment technically completed in the window', validator_role: 'Independent reviewer role (commitments.reviewer)' }));
  }
  // Data freshness — sources within their declared limit ÷ ACTIVE sources (synced at least once)
  {
    const jobs = Object.values(publishGate.SOURCES).flat().map(([j]) => j);
    const active = jobs.filter((j) => o.lastOk && o.lastOk[j]);
    let fresh = null;
    if (active.length && Number.isFinite(Number(o.nowMs))) {
      const f = publishGate.freshness(Object.keys(publishGate.SOURCES), o.lastOk || {}, Number(o.nowMs), o.policy);
      fresh = f.sources.filter((x) => active.includes(x.job) && x.state === 'FRESH').length;
    }
    rows.push(_vRow({ key: 'data_freshness', indicator: 'Data freshness', unit: '%',
      definition: 'external sources within their freshness limit ÷ active sources (synced at least once), at the run date (proposed)',
      formula: 'count(source age ≤ limit) ÷ count(sources with a successful sync)', source: 'sync_runs + services/publishGate.js SOURCES',
      population: `${active.length} active of ${jobs.length} declared sources${jobs.length - active.length ? ` (never synced: ${jobs.filter((j) => !active.includes(j)).join(', ')})` : ''}`,
      n: active.length, value: fresh == null ? null : _pct(fresh, active.length), missing: 'no source has ever synced successfully', owner_role: 'Ops / SRE', validator_role: 'Product owner (pilot)' }));
  }
  // Active adoption — users with ≥ 1 business action ÷ targeted users (targeted list = input file)
  {
    const targeted = Array.isArray(o.targetedUserIds) ? [...new Set(o.targetedUserIds.map(Number).filter(Number.isFinite))] : null;
    const doers = new Set((o.events || []).filter((e) => e && e.user_id != null && _inWindow(e.ts, from, to)).map((e) => Number(e.user_id)));
    const hit = targeted ? targeted.filter((id) => doers.has(id)).length : 0;
    rows.push(_vRow({ key: 'active_adoption', indicator: 'Active adoption', unit: '%',
      definition: 'targeted users with at least one business action in the window ÷ targeted users (page views and sign-ins excluded) (proposed)',
      formula: 'count(targeted ∩ users with a business event) ÷ count(targeted)', source: 'system_log + audit_log; targeted list = input file',
      population: targeted ? `${targeted.length} targeted users` : null, n: targeted ? targeted.length : null, value: targeted && targeted.length ? _pct(hit, targeted.length) : null,
      missing: targeted ? 'the targeted list is empty' : 'targeted users list not supplied (--targeted=FILE, one user id per line)' }));
  }
  // Field task time (E-F03)
  {
    const v = (o.fieldTiming || []).filter((r) => r && _inWindow(r.ts, from, to)).map((r) => _num(r.task_ms)).filter((x) => x != null).map((ms) => ms / 1000);
    rows.push(_vRow({ key: 'field_task_time', indicator: 'Field task time', unit: 'seconds',
      definition: 'median active seconds from opening a field form to queueing it (pauses > 2 min excluded) (proposed)',
      formula: 'median(task_ms) ÷ 1000', source: 'system_log field_<kind>_applied details (report_config field_task_timing = 1)',
      population: 'field entries applied in the window', n: v.length, value: round1(median(v)), missing: 'no timed field entry (field_task_timing = 0, or no entry)', owner_role: 'Site IT coordinator', validator_role: 'Field technician representative' }));
  }
  // Not computable from recorded data today — named, never 0
  const NOT_SOURCED = [
    ['certified_resolution_sla', 'Certified resolution SLA', '%', 'compliant tickets ÷ eligible population, with published exclusions', 'ServiceDesk Plus + KPI committee', 'no resolution-SLA policy adopted by the KPI committee (docs/kpi/FORMULA-REFERENCE.md DV-01..03)', 'KPI committee'],
    ['duplicate_entry_reduction', 'Reduction of duplicate entries', 'ratio', 'repeated entries per event / site', 'journey observation', 'no journey observation recorded (data_re_entered_count in the stopwatch sheet is a partial proxy)', 'Product owner (pilot)'],
    ['kpi_reliability', 'KPI reliability', '%', 'indicators officially approved and reconciled ÷ indicators used in decisions', 'KPI catalogue + committee minutes', 'no committee minutes recorded; which indicators are "used in decisions" is not recorded', 'KPI committee'],
    ['usability', 'Usability', '%', 'critical tasks completed without help ÷ attempts, per role', 'UX sessions (T1-T8-SHEET.csv)', 'UX sessions not run yet (tools/pilot/usability-score.js reads the sheet)', 'UX lead'],
    ['project_benefits', 'Project benefits realised', '%', 'verified benefits ÷ benefits due and eligible', 'native portfolio', 'benefits are not recorded in the portfolio', 'Finance / BRM'],
    ['service_availability', 'Service availability', '%', 'measured available time ÷ contractual window, measurement gaps excluded', 'SRE + monitoring', 'no service-availability monitoring is recorded by the platform', 'SRE'],
    ['delivery_rate', 'Correct delivery rate', '%', 'reports received / validated ÷ reports scheduled', 'delivery engine + acknowledgements', 'report_sent_log records sends, not receipts or validations', 'Product owner (pilot)'],
  ];
  for (const [key, indicator, unit, definition, source, missing, validator] of NOT_SOURCED) {
    rows.push(_vRow({ key, indicator, unit, definition: definition + ' (proposed)', formula: definition, source, population: null, n: null, value: null, missing, validator_role: validator }));
  }
  return { from, to, generated_at: o.generatedAt || null, rows,
    note: 'Baseline before the pilot, then compare on a constant scope (same sites, roles, formula); note any formula change and keep n (audit §9.1). No target is set.' };
}
function valueTableMarkdown(t) {
  const head = ['Indicator', 'Definition (proposed)', 'Formula', 'Source', 'Population', 'n', 'Value', 'Unit', 'State / missing source', 'Owner role', 'Validator role'];
  const body = t.rows.map((r) => [r.indicator, r.definition, r.formula, r.source, r.population, r.n, r.value, r.unit, r.state === 'UNKNOWN' ? 'UNKNOWN — ' + r.missing : 'measured', r.owner_role, r.validator_role]);
  return `# Value table ${t.from || ''} → ${t.to || ''}\n\n${t.note}\n\n${_mdTable(head, body)}\n`;
}
function valueTableCsv(t) {
  const cols = ['key', 'indicator', 'definition', 'formula', 'source', 'population', 'n', 'value', 'unit', 'state', 'missing', 'owner_role', 'validator_role'];
  const cell = (v) => { let x = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
  return [cols.join(','), ...t.rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

module.exports = {
  MEASURES, isBusinessEvent, isoWeek, toMs, hoursBetween, median, quantile, pseudonym,
  buildReport, freshnessShare, toMarkdown, toCsv, buildValueTable, valueTableMarkdown, valueTableCsv,
};
