'use strict';
// E-I02 (audit I-02, candidate half) — recurring-incident "problem candidates".
//
// A candidate is a group of INCIDENTS on one site (scoped by the site's Zoho resolver groups, never by the free-form
// request_records.site column) sharing the same category × sub-category over a rolling window, whose count reaches
// report_config `problem_candidate_min`. It is a CANDIDATE only — causality is not validated: a problem owner decides
// (by promoting it to a commitment, owner chosen by a person) whether a real problem stands behind it.
//
//   • `problem_candidate_min` empty / not a positive integer → feature off: no candidate at all (no threshold invented).
//   • a site with no Zoho group → `scoped:false`, candidates null (not measured — never "0 candidates").
//   • open AND closed incidents are both counted (recurrence is about occurrences, not backlog); cancelled ones are
//     reported apart and NOT counted (a cancelled duplicate is not an occurrence).
//   • ServiceDesk Plus Problem records are not synced (X-I-01): this works on request_records only, no connector.
//
// Pure core: computeCandidates(rows, opts). Reader: loadSiteIncidents(H, siteId, from, to) — the one PG reader of this
// goal (kept here, beside its only consumer, because reports-db.js belongs to another work bundle). created_time is TEXT
// holding ISO-with-T-and-Z, so the window filter is substr(created_time,1,10) BETWEEN ? AND ? (inclusive days).

const CLOSED = new Set(['closed', 'resolved', 'confirmed resolution', 'confirm resolution']);
const NONE = '(none)';
const WORDING = 'candidate — causality not validated';

/** report_config value → positive integer threshold, or null (= feature off). */
function parseMin(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 2 ? n : null;   // a "recurrence" of 1 is not a recurrence
}

/** Window length in days: 7..365, default 90 (only a reading window — the threshold is the policy). */
function parseDays(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 7) return 90;
  return Math.min(n, 365);
}

const isIncident = (r) => /incident/i.test(String((r && r.request_type) || ''));
const stateOf = (r) => {
  const st = String(r.request_status || '').trim().toLowerCase();
  if (st === 'cancelled' || st === 'canceled') return 'cancelled';
  if (Number(r.pending_status) === 0 || CLOSED.has(st)) return 'closed';
  return 'open';
};

/** Stable key of a candidate group (also the commitment source id: `<site>|<category>|<sub-category>`). */
const sourceKey = (siteId, category, sub) => `${siteId}|${category}|${sub}`;
/** Parse a source key; null when malformed. */
function parseSourceKey(id) {
  const m = /^(\d+)\|([^|]{1,200})\|([^|]{1,200})$/.exec(String(id == null ? '' : id));
  return m ? { site_id: Number(m[1]), category: m[2], sub_category: m[3] } : null;
}

/**
 * @param rows   request_records rows of ONE site's groups (request_id, display_id, request_type, request_status,
 *               pending_status, category, sub_category, created_time)
 * @param opts   { min (already parsed, null = off), siteId, scoped (false = site has no Zoho group) }
 * @returns { enabled, scoped, min, candidates:[…]|null, incidents, cancelled }
 */
function computeCandidates(rows, { min = null, siteId = null, scoped = true } = {}) {
  if (min == null) return { enabled: false, scoped, min: null, candidates: [], incidents: 0, cancelled: 0, wording: WORDING };
  if (!scoped) return { enabled: true, scoped: false, min, candidates: null, incidents: null, cancelled: null, wording: WORDING };
  const groups = new Map();
  let incidents = 0, cancelled = 0;
  for (const r of rows || []) {
    if (!isIncident(r)) continue;
    const st = stateOf(r);
    if (st === 'cancelled') { cancelled++; continue; }
    incidents++;
    const cat = String(r.category || '').trim() || NONE;
    const sub = String(r.sub_category || '').trim() || NONE;
    const k = cat + '\u0000' + sub;
    let g = groups.get(k);
    if (!g) { g = { category: cat, sub_category: sub, count: 0, open: 0, closed: 0, first: null, last: null, tickets: [] }; groups.set(k, g); }
    g.count++; g[st]++;
    const day = r.created_time ? String(r.created_time).slice(0, 10) : null;
    if (day) { if (!g.first || day < g.first) g.first = day; if (!g.last || day > g.last) g.last = day; }
    g.tickets.push({ request_id: r.request_id == null ? null : String(r.request_id), display_id: r.display_id == null ? null : String(r.display_id), day, state: st });
  }
  const candidates = [...groups.values()]
    .filter((g) => g.count >= min)
    .map((g) => ({ ...g, tickets: g.tickets.sort((a, b) => String(b.day || '').localeCompare(String(a.day || ''))).slice(0, 20),
      source_key: siteId == null ? null : sourceKey(siteId, g.category, g.sub_category) }))
    .sort((a, b) => (b.count - a.count) || a.category.localeCompare(b.category) || a.sub_category.localeCompare(b.sub_category));
  return { enabled: true, scoped: true, min, candidates, incidents, cancelled, wording: WORDING };
}

/** PG reader — incidents of one site's Zoho groups created in [from, to] (inclusive 'YYYY-MM-DD'). */
async function loadSiteIncidents(H, siteId, from, to) {
  const site = await H.prepare('SELECT zoho_group FROM sites WHERE id=?').get(siteId);
  const groups = String((site && site.zoho_group) || '').split(',').map((g) => g.trim()).filter(Boolean);
  if (!groups.length) return { scoped: false, rows: [] };
  const ph = groups.map(() => '?').join(',');
  const rows = await H.prepare(`
    SELECT request_id, display_id, request_type, request_status, pending_status, category, sub_category, created_time
    FROM request_records
    WHERE tech_group IN (${ph}) AND request_type ILIKE '%incident%' AND substr(created_time,1,10) BETWEEN ? AND ?`).all(...groups, from, to);
  return { scoped: true, rows };
}

module.exports = { computeCandidates, loadSiteIncidents, parseMin, parseDays, sourceKey, parseSourceKey, WORDING };
