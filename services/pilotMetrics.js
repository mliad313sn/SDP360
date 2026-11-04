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
      else if (m.key === 'metrics_unknown_or_stale') lines.push([m.key, '', r.module, '', r.metrics, '', '', '', '', '', '', '', r.state].map(_csv).join(','));
      else lines.push([m.key, r.site, r.persona, r.week, r.n, r.median_h, r.before, '', '', '', '', '', ''].map(_csv).join(','));
    }
    if (m.key === 'metrics_unknown_or_stale' && s.total) lines.push([m.key, '', 'TOTAL', '', s.total, s.share_pct, '', '', '', '', '', '', ''].map(_csv).join(','));
    if (m.key === 'active_users') for (const u of s.users || []) lines.push(['active_user_pseudonym', u.site, u.persona, u.week, u.events, u.pseudonym, '', '', '', '', '', '', ''].map(_csv).join(','));
  }
  if (!rows) lines.push('# no data');
  return lines.join('\n') + '\n';
}

module.exports = {
  MEASURES, isBusinessEvent, isoWeek, toMs, hoursBetween, median, pseudonym,
  buildReport, freshnessShare, toMarkdown, toCsv,
};
