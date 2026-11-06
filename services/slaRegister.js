'use strict';
// E-I01 — SLA/OLA reconciliation register (prepares audit I-01 for the ITSM owner / KPI committee).
//
// PURE: no I/O. Input = request_records rows created in ONE month (snake_case, as stored by zoho-sync)
// + the sites (id, name, zoho_group). Output = one line per site × tech_group with:
//   - resolution SLA % under BOTH definitions of services/slaDefinition.js ('flag' and 'due_vs_resolved'),
//   - first-reply SLA % (responded tickets; late only when first_response_overdue SAYS so),
//   - n closed, n responded, n cancelled (excluded from every denominator),
//   - the documented Zoho target profile ("as documented, to be confirmed by the ITSM owner"),
//   - OLA = UNKNOWN (no OLA is defined anywhere in the product).
// A percentage with an empty denominator is null (UNKNOWN), never 0.
//
// Denominators follow the ITSM doctrine of this repo (CLAUDE.md "KPI denominator doctrine"):
//   resolution % = closed, not missed / closed (cancelled excluded; under 'flag' a ticket whose stored
//   overdue_status is NULL has no SLA rule and is out of the denominator, as getCalendarMonthlyHelpdesk does)
//   first-reply % = responded, not late / responded.

const SlaDef = require('./slaDefinition');

const CANCELLED = new Set(['cancelled', 'canceled']);
const CLOSED = new Set(['closed', 'resolved', 'confirmed resolution', 'confirm resolution']);

// The per-site SLA profiles live in Zoho, not in code. This is the documented copy (CLAUDE.md
// "Incident SLA Configuration") — shown for reconciliation, never used to compute anything.
const ZOHO_PROFILES = Object.freeze({
  standard: 'Standard (P1 30 min / P2 1 h / P3 4 h / P4 1 d response; resolution 2 h / 4 h / 1 d / 5 d)',
  enhanced: 'Enhanced (P1 15 min / P2 30 min / P3 2 h / P4 1 d response; resolution 2 h / 4 h / 1 d / 5 d)',
  abidjan: 'Abidjan (P1 30 min / P2 1 h / P3 2 h / P4 1 d response; resolution 2 h / 4 h / 1 d / 5 d)',
});
const PROFILE_BY_SITE = Object.freeze({
  dakar: 'enhanced', ouaga: 'enhanced', ouagadougou: 'enhanced', sabodala: 'enhanced',
  abidjan: 'abidjan',
  mana: 'standard', london: 'standard', exploration: 'standard', hounde: 'standard', ity: 'standard',
  kalana: 'standard', lafigue: 'standard', tanda: 'standard',
});
const PROFILE_NOTE = 'as documented, to be confirmed by the ITSM owner';

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\bit agents?\b/g, '').trim();

function zohoProfile(siteName) {
  const k = PROFILE_BY_SITE[fold(siteName).split(/\s+/)[0]];
  return k ? `${ZOHO_PROFILES[k]} — ${PROFILE_NOTE}` : 'not documented — to be confirmed by the ITSM owner';
}

const pct = (num, den) => (den > 0 ? Math.round((1000 * num) / den) / 10 : null);
const _st = (r) => String(r.request_status || '').toLowerCase().trim();
const _isClosed = (r) => CLOSED.has(_st(r)) || Number(r.pending_status) === 0;
const _late = (v) => ['true', '1', 'yes'].includes(String(v == null ? '' : v).toLowerCase().trim());
const _has = (v) => v != null && String(v).trim() !== '';

/** Aggregate a set of rows into one register line (without the labels). */
function measure(rows) {
  const m = { n: 0, cancelled: 0, closed: 0, flag_den: 0, flag_ok: 0, dvr_ok: 0, responded: 0, reply_ok: 0 };
  for (const r of rows || []) {
    m.n++;
    if (CANCELLED.has(_st(r))) { m.cancelled++; continue; }   // cancelled: out of every denominator
    if (_has(r.responded_time)) { m.responded++; if (!_late(r.first_response_overdue)) m.reply_ok++; }
    if (!_isClosed(r)) continue;
    m.closed++;
    if (r.overdue_status != null && String(r.overdue_status).trim() !== '') {
      m.flag_den++;
      if (!SlaDef.resOverdueRow(r, 'flag')) m.flag_ok++;
    }
    if (!SlaDef.resOverdueRow(r, 'due_vs_resolved')) m.dvr_ok++;
  }
  return {
    n_tickets: m.n,
    n_cancelled_excluded: m.cancelled,
    n_closed: m.closed,
    n_responded: m.responded,
    resolution_sla_flag_pct: pct(m.flag_ok, m.flag_den),
    resolution_sla_due_vs_resolved_pct: pct(m.dvr_ok, m.closed),
    first_reply_sla_pct: pct(m.reply_ok, m.responded),
  };
}

/**
 * buildRegister({ rows, sites, month, slaDefinition }) → { month, configured_definition, lines[] }
 * A ticket belongs to a site when its tech_group is one of the site's comma-split zoho_group entries.
 * Groups that belong to no site are listed under site "(no site)" so nothing disappears silently.
 */
function buildRegister({ rows = [], sites = [], month = null, slaDefinition } = {}) {
  const groupToSite = new Map();
  for (const s of sites) {
    for (const g of String(s.zoho_group || '').split(',').map((x) => x.trim()).filter(Boolean)) {
      if (!groupToSite.has(g)) groupToSite.set(g, s);
    }
  }
  const buckets = new Map();
  for (const r of rows) {
    const g = String(r.tech_group || '').trim() || '(no group)';
    const s = groupToSite.get(g) || null;
    const key = `${s ? s.name : '(no site)'}\u0000${g}`;
    if (!buckets.has(key)) buckets.set(key, { site: s ? s.name : '(no site)', tech_group: g, rows: [] });
    buckets.get(key).rows.push(r);
  }
  const lines = [...buckets.values()]
    .sort((a, b) => a.site.localeCompare(b.site) || a.tech_group.localeCompare(b.tech_group))
    .map((b) => ({
      site: b.site,
      tech_group: b.tech_group,
      ...measure(b.rows),
      zoho_target_profile: b.site === '(no site)' ? 'not documented — to be confirmed by the ITSM owner' : zohoProfile(b.site),
      ola: null,   // UNKNOWN — no OLA is defined (audit I-01; owners to be named by the ITSM owner)
    }));
  return { month, configured_definition: SlaDef.normalizeMode(slaDefinition), lines };
}

const _c = (v) => (v == null ? 'UNKNOWN' : String(v).replace(/\|/g, '\\|'));
const _p = (v) => (v == null ? 'UNKNOWN' : `${v} %`);

function toMarkdown(reg, { source = 'database' } = {}) {
  const out = [
    '# SLA / OLA reconciliation register',
    '',
    `Generated by \`node tools/reports/sla-register.js\` (read-only). Source: ${source}. Month: ${reg.month || 'UNKNOWN'}.`,
    '',
    `Configured server definition (\`helpdesk_sla_definition\`): \`${reg.configured_definition}\`. Both definitions`,
    'are shown so the KPI committee can compare them; this register changes nothing.',
    '',
    'Rules: cancelled tickets are excluded from every denominator; a percentage with no ticket in its',
    'denominator is UNKNOWN (never 0); the Zoho target profile is copied from the documentation and must be',
    'confirmed by the ITSM owner; OLA is UNKNOWN because no OLA is defined.',
    '',
    '| Site | Tech group | Tickets | Cancelled (excluded) | Closed | Responded | Resolution SLA (flag) | Resolution SLA (due vs resolved) | First-reply SLA | Zoho target profile | OLA |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const l of reg.lines) {
    out.push(`| ${_c(l.site)} | ${_c(l.tech_group)} | ${l.n_tickets} | ${l.n_cancelled_excluded} | ${l.n_closed} | ${l.n_responded} | ${_p(l.resolution_sla_flag_pct)} | ${_p(l.resolution_sla_due_vs_resolved_pct)} | ${_p(l.first_reply_sla_pct)} | ${_c(l.zoho_target_profile)} | ${_c(l.ola)} |`);
  }
  if (!reg.lines.length) out.push('| — | — | 0 | 0 | 0 | 0 | UNKNOWN | UNKNOWN | UNKNOWN | — | UNKNOWN |');
  out.push('', '## Questions for the ITSM owner / KPI committee', '',
    '1. Which resolution definition is the reference (`flag` = Zoho Overdue Status at last sync, or `due_vs_resolved`)?',
    '2. Are the documented Zoho target profiles per site still the configured ones?',
    '3. Which thresholds turn a site green / amber / red?',
    '4. Which resolver groups get an OLA, with which targets, and who owns each one?', '');
  return out.join('\n');
}

module.exports = { buildRegister, measure, toMarkdown, zohoProfile, PROFILE_NOTE };
