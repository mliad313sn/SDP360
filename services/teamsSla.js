'use strict';
// Teams SLA alerts (2026-10-03) — PURE: SDP Cloud API v3 request → ticket, rules →
// alerts, group → Teams channel. No I/O, `nowMs` injected. The job lives in
// tools/teams/poll-sla.js; the card in services/teamsCard.js.
// Spec: docs/superpowers/specs/2026-10-03-teams-sla-alerts-design.md

const KINDS = ['fr_breach', 'res_breach', 'fr_soon', 'res_soon', 'unassigned'];

const DEFAULT_RULES = Object.freeze({
  kinds: { fr_soon: true, fr_breach: true, res_soon: true, res_breach: true, unassigned: true },
  // minutes before the FIRST-RESPONSE deadline at which a ticket is "soon due", by priority
  fr_soon_minutes: { P1: 10, P2: 20, P3: 60, P4: 240 },
  // share of the RESOLUTION window (created → due_by) consumed before "soon due"
  res_soon_pct: 75,
  // a breach is announced only if it happened at most this long ago — otherwise the
  // first run would post every ticket that breached last week
  breach_window_minutes: 60,
  unassigned_minutes: 30,
  unassigned_max_age_hours: 24,
  // a status matching this (case-insensitive) pauses the SLA clock → no alert
  paused_status: 'hold',
  // a status matching this is finished → never alerts, whatever the API filter returned
  finished_status: 'resolved|closed|cancel|completed|confirm',
  max_tickets_per_card: 15,
  // tickets created more than N days ago are ignored (0 = no limit) — keeps forgotten old
  // tickets out of the alerts AND lets the API listing stop early (it is newest first)
  max_ticket_age_days: 30,
});

function _clone(o) { return JSON.parse(JSON.stringify(o)); }

function parseRules(raw) {
  const out = _clone(DEFAULT_RULES);
  let r;
  try { r = typeof raw === 'string' ? (raw.trim() ? JSON.parse(raw) : {}) : (raw || {}); } catch (e) { r = {}; }
  if (!r || typeof r !== 'object') return out;
  if (r.kinds && typeof r.kinds === 'object') for (const k of Object.keys(out.kinds)) if (k in r.kinds) out.kinds[k] = !!r.kinds[k];
  if (r.fr_soon_minutes && typeof r.fr_soon_minutes === 'object') {
    for (const p of ['P1', 'P2', 'P3', 'P4']) {
      const v = Number(r.fr_soon_minutes[p]);
      if (Number.isFinite(v) && v >= 0) out.fr_soon_minutes[p] = v;
    }
  }
  for (const k of ['max_ticket_age_days', 'res_soon_pct', 'breach_window_minutes', 'unassigned_minutes', 'unassigned_max_age_hours', 'max_tickets_per_card']) {
    const v = Number(r[k]);
    if (r[k] !== undefined && r[k] !== '' && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  if (typeof r.paused_status === 'string') out.paused_status = r.paused_status;
  if (typeof r.finished_status === 'string') out.finished_status = r.finished_status;
  return out;
}

function priorityLabel(name) {
  const s = String(name == null ? '' : name).trim().toLowerCase();
  if (/critical|urgent|^p1/.test(s)) return 'P1';
  if (/high|^p2/.test(s)) return 'P2';
  if (/low|^p4/.test(s)) return 'P4';
  return 'P3';
}

// v3 fields come as {value, display_value} (dates: value = epoch ms as a string),
// {name} (lookups) or bare values. Everything is optional.
const _name = (x) => (x && typeof x === 'object') ? String(x.name || x.display_value || '') : (x == null ? '' : String(x));
function _ms(x) {
  const v = (x && typeof x === 'object') ? x.value : x;
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  const p = Date.parse(String(v));
  return Number.isFinite(p) ? p : null;
}

function normalizeRequest(r) {
  const x = r || {};
  const priority = _name(x.priority);
  return {
    id: String(x.id == null ? '' : x.id),
    display_id: String(x.display_id == null ? (x.id == null ? '' : x.id) : x.display_id),
    subject: String(x.subject || ''),
    priority, p: priorityLabel(priority),
    group: _name(x.group).trim(),
    technician: _name(x.technician).trim(),
    site: _name(x.site),
    status: _name(x.status),
    created_ms: _ms(x.created_time),
    fr_due_ms: _ms(x.first_response_due_by_time),
    res_due_ms: _ms(x.due_by_time),
    responded: _ms(x.responded_time) != null,
  };
}

/** Creation cutoff (ms) from max_ticket_age_days, or null when unlimited. */
function createdAfterMs(rules, nowMs) {
  const d = Number((rules || DEFAULT_RULES).max_ticket_age_days);
  return Number.isFinite(d) && d > 0 ? nowMs - d * 86400000 : null;
}

function evaluate(tickets, rules, nowMs) {
  const R = rules || DEFAULT_RULES;
  const out = [];
  const cutoff = createdAfterMs(R, nowMs);
  const paused = R.paused_status ? new RegExp(R.paused_status.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  let finished = null;
  try { finished = R.finished_status ? new RegExp(R.finished_status, 'i') : null; } catch (e) { finished = null; }
  const win = R.breach_window_minutes * 60000;
  const push = (t, kind, dueMs) => out.push({
    kind, request_id: t.id, display_id: t.display_id, subject: t.subject, p: t.p, group: t.group,
    technician: t.technician, site: t.site,
    minutes: dueMs == null ? null : Math.round((dueMs - nowMs) / 60000),
  });
  for (const t of tickets || []) {
    if (!t || !t.id) continue;
    if (paused && paused.test(t.status || '')) continue;
    if (finished && finished.test(t.status || '')) continue;
    if (cutoff != null && t.created_ms != null && t.created_ms < cutoff) continue;
    const K = R.kinds;
    if (!t.responded && t.fr_due_ms != null) {
      const left = t.fr_due_ms - nowMs;
      if (left < 0) { if (K.fr_breach && -left <= win) push(t, 'fr_breach', t.fr_due_ms); }
      else if (K.fr_soon && left <= (R.fr_soon_minutes[t.p] ?? R.fr_soon_minutes.P3) * 60000) push(t, 'fr_soon', t.fr_due_ms);
    }
    if (t.res_due_ms != null) {
      const left = t.res_due_ms - nowMs;
      if (left < 0) { if (K.res_breach && -left <= win) push(t, 'res_breach', t.res_due_ms); }
      else if (K.res_soon && t.created_ms != null && t.res_due_ms > t.created_ms) {
        const used = (nowMs - t.created_ms) / (t.res_due_ms - t.created_ms);
        if (used >= R.res_soon_pct / 100) push(t, 'res_soon', t.res_due_ms);
      }
    }
    if (K.unassigned && !t.technician && t.created_ms != null) {
      const age = nowMs - t.created_ms;
      if (age >= R.unassigned_minutes * 60000 && age <= R.unassigned_max_age_hours * 3600000) {
        out.push({ kind: 'unassigned', request_id: t.id, display_id: t.display_id, subject: t.subject, p: t.p,
          group: t.group, technician: '', site: t.site, minutes: -Math.round(age / 60000) });
      }
    }
  }
  return out;
}

// Channels: [{group, url}] — `group` is the SDP group name, '*' = default channel.
function parseChannels(raw) {
  let a;
  try { a = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw; } catch (e) { return []; }
  if (!Array.isArray(a)) return [];
  return a.map(c => ({ group: String((c && c.group) || '').trim(), url: String((c && c.url) || '').trim() }))
    .filter(c => c.group && c.url);
}
const _key = (s) => String(s || '').trim().toLowerCase();
function resolveChannel(group, channels) {
  const g = _key(group);
  const hit = (channels || []).find(c => _key(c.group) === g && c.group !== '*');
  if (hit) return hit.url;
  const def = (channels || []).find(c => c.group === '*');
  return def ? def.url : null;
}

module.exports = { KINDS, DEFAULT_RULES, parseRules, createdAfterMs, priorityLabel, normalizeRequest, evaluate, parseChannels, resolveChannel };
