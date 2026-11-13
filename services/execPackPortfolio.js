'use strict';
// D3 (P10) — the "Portfolio highlights" block of the monthly Group IT pack (exec-pptx render.py), PURE.
// Built from the portfolio the deck AUTHOR may read (the caller filters with services/portfolioAccess first) and only
// when report_config exec_pack_portfolio_slide = '1' (default '0' = the deck is exactly today's).
// Rules: amounts only when `money` is true (admin tier or finance-viewer — invariant 2, no committee exception here);
// otherwise every amount field is absent and `money_hidden` says so. A date or variance nobody recorded is null ("—"),
// never 0. Currencies are never added together (budgets are listed per project with their own ISO code).

const { varianceOf } = require('./projectSchedule');
const CLOSED = new Set(['done', 'cancelled', 'closed']);
const MAX_ROWS = 8, MAX_BENEFITS = 5;

/** @param pf portfolio { projects, milestones, benefits } · opts { money:boolean, today:'YYYY-MM-DD' } */
function buildPortfolioBlock(pf, { money = false, today = null } = {}) {
  const v = pf || {};
  const t = String(today || new Date().toISOString()).slice(0, 10);
  const projects = (v.projects || []).filter((p) => !CLOSED.has(String(p.status || '').toLowerCase()));
  const ms = v.milestones || [];
  const nextMs = (pid) => ms.filter((m) => Number(m.project_id) === Number(pid) && !m.done_at && !CLOSED.has(String(m.status || '').toLowerCase()) && m.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0] || null;
  const rows = projects.map((p) => {
    const var_ = varianceOf(p).finish_variance_days;
    const n = nextMs(p.id);
    const r = { key: p.key, name: p.name, status: p.status || null, stage: p.stage || null,
      finish_variance_days: var_ == null ? null : var_, next_milestone: n ? n.name : null, next_milestone_due: n ? String(n.due_date).slice(0, 10) : null,
      milestone_overdue: n ? String(n.due_date).slice(0, 10) < t : null };
    if (money) { r.budget = p.budget == null ? null : Number(p.budget); r.currency = p.currency || null; }
    return r;
  }).sort((a, b) => (b.finish_variance_days ?? -1e9) - (a.finish_variance_days ?? -1e9) || String(a.key).localeCompare(String(b.key)));
  const late = rows.filter((r) => r.finish_variance_days != null && r.finish_variance_days > 0).length;
  const benefits = (v.benefits || []).filter((b) => projects.some((p) => Number(p.id) === Number(b.project_id))).map((b) => {
    const p = projects.find((x) => Number(x.id) === Number(b.project_id));
    const out = { project: p ? p.key : null, description: b.description || null, review_date: b.review_date ? String(b.review_date).slice(0, 10) : null, realised: b.realised_value != null };
    if (b.value_kind !== 'money' || money) { out.target_value = b.target_value == null ? null : Number(b.target_value); out.unit = b.value_kind === 'money' ? (b.currency || null) : (b.unit || null); }
    return out;
  }).sort((a, b) => String(a.review_date || '9999').localeCompare(String(b.review_date || '9999')));
  return {
    as_of: t, money: !!money, money_hidden: !money,
    open_projects: projects.length, late_vs_baseline: late,
    milestones_overdue: rows.filter((r) => r.milestone_overdue === true).length,
    rows: rows.slice(0, MAX_ROWS), more: Math.max(0, rows.length - MAX_ROWS),
    benefits: benefits.slice(0, MAX_BENEFITS),
  };
}

/** Reads the portfolio for the author (filtered like the portfolio page), or null when it cannot be read. */
async function loadForAuthor(user, { rdb, getConfig, store } = {}) {
  const R = rdb || require('../reports-db');
  const cfg = getConfig ? await getConfig() : await require('./reportConfig').getConfig(R.db);
  if (String(cfg.exec_pack_portfolio_slide || '0') !== '1') return null;
  const st = store || require('./governanceStore').makeGovernanceStore(R.pgHandle(), { isPg: true });
  const pf = await st.portfolio();
  const has = (r) => { try { return !!R.userHasRole(user, r); } catch (_) { return false; } };
  const isAdmin = has('admin');
  const ctx = { scopeOn: String(cfg.portfolio_site_scope_reads) === '1', sensitiveOn: String(cfg.portfolio_sensitive_projects) === '1', memberProjectIds: [],
    isCommittee: isAdmin || has('committee-member'), isAdmin, isEditor: has('editor') };
  const view = require('./portfolioAccess').filterPortfolio(pf, user, ctx);
  return buildPortfolioBlock(view, { money: isAdmin || has('finance-viewer') });
}

module.exports = { buildPortfolioBlock, loadForAuthor, MAX_ROWS };
