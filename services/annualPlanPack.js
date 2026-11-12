'use strict';
// E-P08 (audit P-08, catalogue R16) — annual planning DRAFT pack. PURE: no DB, no clock (the caller passes asOf).
// buildAnnualPack({ year, view, money, capacity, rfis, rfiVisible, asOf }) → { sheets: [{ name, rows }] } where
//   • every sheet starts with the row "DRAFT — not approved" (the pack is preparation for the committee, not a plan);
//   • Projects: the projects planned / running in the year (dates overlapping the year, or undated and not closed);
//   • Budget: per CURRENCY roll-up (never added across currencies); the "envelope" column is UNKNOWN until Finance
//     enters it (null in the data, the word UNKNOWN in the sheet); amounts only when `money` is true (money-read rule)
//     — otherwise the sheet says the amounts are restricted and carries none;
//   • Capacity: per site, weeks with someone over 100 %, peak team load, tasks without allocation (unknown ≠ 0);
//   • RFI: the requests in the queue with their PROVISIONAL committee score (the scoring rubric is not approved).
// The fiscal year is assumed to be the calendar year until Finance confirms it (stated in the About sheet).
const DRAFT = 'DRAFT — not approved';
const OPEN_STATUSES = ['planned', 'active', 'on_hold'];
const QUEUE = ['submitted', 'triaged', 'accepted', 'scheduled'];

function inYear(p, year) {
  const y0 = `${year}-01-01`, y1 = `${year}-12-31`;
  const s = p.start_date ? String(p.start_date).slice(0, 10) : null, e = p.end_date ? String(p.end_date).slice(0, 10) : null;
  if (!s && !e) return OPEN_STATUSES.includes(p.status || 'planned');
  return (s || y0) <= y1 && (e || y1) >= y0;
}

function budgetByCurrency(projects) {
  const by = {};
  for (const p of projects) {
    if (p.budget == null || !p.currency) continue;
    const c = (by[p.currency] = by[p.currency] || { currency: p.currency, projects: 0, budget: 0, spent: 0, envelope: null });
    c.projects++; c.budget += Number(p.budget) || 0; c.spent += Number(p.spent) || 0;
  }
  return Object.values(by).sort((a, b) => a.currency.localeCompare(b.currency));
}

function buildAnnualPack({ year, view, money = false, capacity = null, rfis = [], rfiVisible = true, asOf = null } = {}) {
  const y = Number(year);
  const v = view || { projects: [] };
  const projects = (v.projects || []).filter((p) => inYear(p, y));
  const sheets = [];
  sheets.push({ name: 'About', rows: [[DRAFT], [`Annual planning pack ${y} — prepared ${String(asOf || '').slice(0, 10)}`],
    [`Fiscal year assumed = calendar year ${y} (Finance to confirm).`], ['Envelopes are UNKNOWN until Finance enters them; arbitration is the committee\'s.'],
    ['Amounts in different currencies are never added together.'], [money ? 'Amounts shown: the reader may read money.' : 'Amounts restricted: this reader may not read money.']] });
  const head = ['Key', 'Project', 'Status', 'Stage', 'Start', 'End', 'Site'].concat(money ? ['Budget', 'Spent', 'Currency'] : []);
  sheets.push({ name: 'Projects', rows: [[DRAFT], head].concat(projects.map((p) => [p.key, p.name, p.status || null, p.stage || null, p.start_date || null, p.end_date || null, p.site_id == null ? null : p.site_id]
    .concat(money ? [p.budget == null ? null : Number(p.budget), p.spent == null ? null : Number(p.spent), p.currency || null] : []))) });
  const budget = money ? budgetByCurrency(projects) : null;
  sheets.push({ name: 'Budget', rows: money
    ? [[DRAFT], ['Currency', 'Projects with a budget', 'Budget', 'Spent', 'Envelope (Finance)']].concat(budget.map((b) => [b.currency, b.projects, Math.round(b.budget * 100) / 100, Math.round(b.spent * 100) / 100, 'UNKNOWN']))
      .concat([[`Projects without a budget: ${projects.filter((p) => p.budget == null).length}`]])
    : [[DRAFT], ['Amounts are restricted to the committee, the admin tier and the finance role.']] });
  const cap = capacity && capacity.sites ? capacity.sites : [];
  sheets.push({ name: 'Capacity', rows: [[DRAFT], ['Site', 'Weeks with someone over 100 %', 'Peak team load (% of one person)', 'Tasks without allocation (unknown)']]
    .concat(cap.map((s) => { const peaks = s.weeks.map((w) => w.total_pct).filter((x) => x != null); return [s.site, s.over_weeks, peaks.length ? Math.max(...peaks) : null, s.unknown_tasks]; })) });
  sheets.push({ name: 'RFI (provisional)', rows: rfiVisible
    ? [[DRAFT], ['Ref', 'Title', 'Status', 'Provisional score (rubric not approved)']].concat((rfis || []).filter((r) => QUEUE.includes(r.status)).map((r) => [r.ref || null, r.title || null, r.status, r.score == null ? null : Number(r.score)]))
    : [[DRAFT], ['The RFI queue is read by the committee.']] });
  return { year: y, draft: true, money: !!money, budget, envelope: budget ? budget.map(() => null) : null, sheets };
}

function toWorkbookBuffer(pack) {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of pack.sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows.map((r) => r.map((c) => (c == null ? '' : c)))), s.name.slice(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { DRAFT, buildAnnualPack, toWorkbookBuffer, inYear, budgetByCurrency };
