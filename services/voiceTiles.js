'use strict';
// A8 — Voice of the user: CSAT / NPS tiles per site and per helpdesk group (pure; no I/O).
//
// Population = tickets CREATED in the month (the Helpdesk page's period rule). For each site / group:
//   responses          scored survey replies on those tickets
//   closed / inbound   tickets created in the month that are closed now / all created (link to helpdesk volumes)
//   response_rate_pct  responses ÷ closed tickets — "survey replies on tickets created in the month ÷ those tickets
//                      that are closed" (RESPONSE_RATE_DEFINITION). null when nothing closed (no base), never 0.
//   csat_pct           replies scoring ≥ 80 ÷ replies · nps = (≥ 90 − < 70) ÷ replies × 100 — null with no reply.
//   trend              the same per month over the last N months (null months stay null).
//   state              'ok' · 'no_responses' (closed tickets, no reply) · 'no_tickets' · 'unknown' (survey sync failed
//                      or never ran — the cause rides in freshness.cause; figures are then not trusted).
// A site = the union of its sites.zoho_group entries (lowercased), the same key as every per-site helpdesk reader.

const RESPONSE_RATE_DEFINITION = 'scored survey replies on tickets created in the month ÷ tickets created in the month and closed (closed tickets only)';
const PERIOD_BASIS = 'ticket creation month';

function months(year, month, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** freshness from the sync_metadata 'survey' row: a failure newer than the last success, or no success at all → unknown. */
function freshness(meta) {
  const m = meta || null;
  if (!m || !m.last_sync_at) return { state: 'unknown', cause: m && m.last_error ? String(m.last_error) : 'survey sync has never run', last_sync_at: null };
  if (m.last_error && m.last_error_at && String(m.last_error_at) > String(m.last_sync_at)) {
    return { state: 'unknown', cause: String(m.last_error), last_sync_at: m.last_sync_at, last_error_at: m.last_error_at };
  }
  return { state: 'ok', cause: null, last_sync_at: m.last_sync_at };
}

function _sum(rows, keys) {
  const o = { responses: 0, satisfied: 0, promoters: 0, passives: 0, detractors: 0, inbound: 0, closed: 0 };
  for (const r of rows) for (const k of keys) o[k] += Number(r[k]) || 0;
  return o;
}
function _figures(s, t) {
  const n = s.responses;
  return {
    responses: n, closed: t.closed, inbound: t.inbound,
    response_rate_pct: t.closed > 0 ? Math.round(n / t.closed * 100) : null,
    csat_pct: n > 0 ? Math.round(s.satisfied / n * 100) : null,
    nps: n > 0 ? Math.round((s.promoters - s.detractors) / n * 100) : null,
  };
}

/**
 * build({ data:{survey,tickets}, sites:[{id,name,zoho_group}], year, month, trendMonths, scopeGroups, scopeSiteIds, meta })
 *   scopeGroups = null (admin tier) | [] (nothing) | lowercased groups; scopeSiteIds = null | [ids].
 */
function build(o) {
  const ym = `${o.year}-${String(o.month).padStart(2, '0')}`;
  const ms = months(o.year, o.month, o.trendMonths || 6);
  const fresh = freshness(o.meta);
  const survey = (o.data && o.data.survey) || [];
  const tickets = (o.data && o.data.tickets) || [];
  const inScope = (g) => o.scopeGroups == null || o.scopeGroups.includes(g);
  const rowsFor = (groups, m) => ({
    s: _sum(survey.filter((r) => groups.includes(r.grp) && (!m || r.ym === m)), ['responses', 'satisfied', 'promoters', 'passives', 'detractors']),
    t: _sum(tickets.filter((r) => groups.includes(r.grp) && (!m || r.ym === m)), ['inbound', 'closed']),
  });
  const tile = (groups) => {
    const cur = rowsFor(groups, ym);
    const f = _figures(cur.s, cur.t);
    const trend = ms.map((m) => { const x = rowsFor(groups, m); const y = _figures(x.s, x.t); return { month: m, responses: y.responses, csat_pct: y.csat_pct, nps: y.nps }; });
    const state = fresh.state === 'unknown' ? 'unknown' : (f.inbound === 0 && f.responses === 0 ? 'no_tickets' : (f.responses === 0 ? 'no_responses' : 'ok'));
    return { ...f, trend, state };
  };
  const sites = (o.sites || [])
    .filter((s) => o.scopeSiteIds == null || o.scopeSiteIds.includes(Number(s.id)))
    .map((s) => ({ s, groups: String(s.zoho_group || '').split(',').map((g) => g.trim().toLowerCase()).filter(Boolean).filter(inScope) }))
    .filter((x) => x.groups.length)
    .map((x) => ({ site_id: Number(x.s.id), site: x.s.name, groups: x.groups, ...tile(x.groups) }))
    .sort((a, b) => a.site.localeCompare(b.site));
  const allGroups = [...new Set([...survey, ...tickets].filter((r) => r.ym === ym).map((r) => r.grp))].filter(inScope).sort();
  const groups = allGroups.map((g) => ({ group: g, ...tile([g]) }));
  // the display name of a group keeps the source spelling when one site lists it
  const spell = new Map();
  for (const s of o.sites || []) for (const g of String(s.zoho_group || '').split(',').map((x) => x.trim()).filter(Boolean)) spell.set(g.toLowerCase(), g);
  for (const g of groups) g.group = spell.get(g.group) || g.group;
  return { period: ym, period_basis: PERIOD_BASIS, response_rate_definition: RESPONSE_RATE_DEFINITION,
    csat_definition: 'replies scoring ≥ 80 ÷ replies', nps_definition: '(replies ≥ 90 − replies < 70) ÷ replies × 100',
    freshness: fresh, sites, groups };
}

module.exports = { build, freshness, months, RESPONSE_RATE_DEFINITION, PERIOD_BASIS };
