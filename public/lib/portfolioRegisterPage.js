// PORTFOLIO LOT 3 — the register + executive dashboard page (public/portfolio-register.html). Data: GET
// /api/governance/portfolio/register?<filters> (404 while ppm_portfolio_dashboard_v2_enabled = '0'). The view is the
// address: every filter / sort / column choice rewrites the query string (lib/urlFilters.js), so a saved view is a link.
// Every value escaped; unknown shows "—", never 0. EN / FR from the shell. No inline handler (strict CSP page).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const UF = window.UrlFilters, PR = window.PortfolioRegister;
  let lang = 'en';
  try { lang = (window.__shell && window.__shell.shellLang && window.__shell.shellLang()) || 'en'; } catch (_) { lang = 'en'; }
  if (lang === 'fr') document.documentElement.lang = 'fr';
  const T = PR.T[lang === 'fr' ? 'fr' : 'en'];
  $('prTitle').textContent = T.title; $('prIntro').textContent = T.intro;
  ['prFiltersH:filters', 'prColsH:columns', 'prKpisH:kpis', 'prReset:reset', 'prCsv:exportCsv', 'prXlsx:exportXlsx'].forEach((p) => { const [id, k] = p.split(':'); $(id).textContent = T[k]; });

  let state = UF.parse(location.search, PR.SCHEMA);
  let drawn = false;
  const merge = (patch) => UF.merge(location.search, Object.assign({}, state, patch), PR.SCHEMA) || '?';
  async function api(path) {
    const r = await fetch(path, { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return j;
  }
  // [key, English fallback, French fallback] — the fallback is used only when no register column carries the label
  const FILTERS = [['q', 'search', 'search'], ['year', 'Year', 'Année'], ['site', 'Site', 'Site'], ['project_type', 'Type', 'Type'], ['priority', 'Priority', 'Priorité'], ['status', 'Status', 'Statut'], ['risk', 'Risk', 'Risque'],
    ['budget_status', 'Budget status', 'Statut budgétaire'], ['decision_required', 'Decision required', 'Décision requise'], ['owner', 'IT owner', 'Responsable IT'], ['delivery_lead', 'Delivery lead', 'Responsable de livraison'], ['sponsor', 'Business sponsor', 'Sponsor métier']];
  const label = (k, en, fr) => { const c = PR.COLUMNS.find((x) => x.key === k); return T[k] || (c ? c[lang === 'fr' ? 'fr' : 'en'] : (lang === 'fr' && fr ? fr : en)); };

  function drawFilters(j) {
    const o = j.options || {};
    const parts = FILTERS.map(([k, en, fr]) => {
      if (k === 'q') return `<label>${esc(T.search)}<input type="search" id="pf_q" name="q" value="${esc((state.q || []).join(' '))}"></label>`;
      const opts = o[k]; if (!opts || !opts.length) return '';
      const sel = new Set(state[k] || []);
      return `<label>${esc(label(k === 'risk' ? 'risk_exposure' : k, en, fr))}<select multiple id="pf_${k}" name="${k}" aria-label="${esc(label(k === 'risk' ? 'risk_exposure' : k, en, fr))}">${
        opts.map((v) => { const val = typeof v === 'object' ? v.value : v, lab = typeof v === 'object' ? v.label : v; return `<option value="${esc(val)}"${sel.has(String(val)) ? ' selected' : ''}>${esc(lab)}</option>`; }).join('')}</select></label>`;
    });
    const reports = PR.REPORTS.filter((r) => !r.money || !j.money_hidden);
    parts.push(`<label>${esc(T.reports)}<select id="pf_report" name="report"><option value="">—</option>${reports.map((r) => `<option value="${esc(r.key)}"${state.report === r.key ? ' selected' : ''}>${esc(r[lang === 'fr' ? 'fr' : 'en'])}</option>`).join('')}</select></label>`);
    parts.push(`<button type="submit" class="pr-btn">${esc(T.apply || 'Apply filters')}</button>`);
    $('prFilters').innerHTML = parts.join('');
    $('prCols').innerHTML = PR.COLUMNS.filter((c) => !c.money || !j.money_hidden).map((c) => `<label><input type="checkbox" value="${esc(c.key)}"${(j.cols || []).includes(c.key) ? ' checked' : ''}${c.frozen ? ' disabled' : ''}> ${esc(c[lang === 'fr' ? 'fr' : 'en'])}</label>`).join('');
  }
  function readFilters() {
    const next = Object.assign({}, state);
    FILTERS.forEach(([k]) => {
      const el = $('pf_' + k); if (!el) { next[k] = null; return; }
      if (k === 'q') { const v = el.value.trim(); next.q = v ? v.split(/\s+/).slice(0, 10) : null; return; }
      const vals = Array.from(el.selectedOptions).map((x) => x.value); next[k] = vals.length ? vals : null;
    });
    next.report = $('pf_report') ? $('pf_report').value : '';
    const cols = Array.from($('prCols').querySelectorAll('input[type=checkbox]:checked')).map((x) => x.value);
    next.cols = cols.length ? cols : null;
    return next;
  }
  function go(next) { state = next; const q = UF.merge(location.search, state, PR.SCHEMA); history.replaceState(null, '', location.pathname + q); load(); }
  $('prFilters').addEventListener('submit', (e) => { e.preventDefault(); go(readFilters()); });
  $('prFilters').addEventListener('change', () => go(readFilters()));
  $('prCols').addEventListener('change', () => go(readFilters()));

  function analysesHtml(a, j) {
    const g = (rows, cols) => PR.groupTableHtml(rows, cols, { esc, T });
    const cards = [];
    cards.push(`<div class="pr-card"><h2>${esc(T.bySite)}</h2>${g(a.by_site.map((s) => Object.assign({}, s, { site: s.site || '—' })), [['site', 'Site'], ['count', 'count'], ['critical_high', 'critical_high'], ['high_risk', 'high_risk'], ['fte', 'fte'], ['fte_unknown', 'fte_unknown'], ['dq', 'dq']].concat(j.money_hidden ? [] : [['budget', 'budget']]))}</div>`);
    if (a.by_priority && a.by_priority.length) cards.push(`<div class="pr-card"><h2>${esc(T.byPriority)}</h2>${g(a.by_priority, [['priority', 'Priority'], ['count', 'count'], ['pct', 'pct'], ['fte', 'fte'], ['sites', 'sites']].concat(j.money_hidden ? [] : [['unfunded', 'unfunded'], ['budget', 'budget']]))}</div>`);
    const s = a.status;
    cards.push(`<div class="pr-card"><h2>${esc(T.status)}</h2>${g([
      { key: T.on_hold, v: s.on_hold }, { key: T.stalled + ' (> ' + s.stalled_days + ')', v: s.stalled }, { key: T.avg_stage_age, v: s.avg_stage_age_days },
      { key: T.approved_not_started, v: s.approved_not_started }, { key: T.in_progress_without_lead, v: s.in_progress_without_lead }], [['key', 'Status'], ['v', 'key']])}
      ${g(s.by_status, [['key', 'Status'], ['count', 'count']])}<p class="pr-muted">${esc(T.proposed)}</p></div>`);
    cards.push(`<div class="pr-card"><h2>${esc(T.risk)}</h2>${g(a.risk.by_site.map((r) => Object.assign({}, r, { key: (a.by_site.find((x) => String(x.site_id) === r.key) || {}).site || r.key || '—' })), [['key', 'Site'], ['projects', 'count'], ['high_risk', 'high_risk']])}</div>`);
    if (a.budget) {
      const cur = Object.entries(a.budget.by_currency).map(([c, b]) => ({ key: c, total: b.total, approved: b.approved, requested: b.requested, count: b.projects }));
      cards.push(`<div class="pr-card"><h2>${esc(T.budget)}</h2>${g(cur, [['key', 'Currency'], ['count', 'count'], ['total', 'total'], ['approved', 'approved'], ['requested', 'requested']])}<p class="pr-muted">${esc(T.not_budgeted)}: ${a.budget.not_budgeted == null ? '—' : esc(a.budget.not_budgeted)} · ${esc(T.tbc)}: ${a.budget.tbc == null ? '—' : esc(a.budget.tbc)}</p></div>`);
    } else cards.push(`<div class="pr-card"><h2>${esc(T.budget)}</h2><p class="pr-muted">— ${esc(T.MONEY_HIDDEN)}</p></div>`);
    const L = j.load;
    cards.push(`<div class="pr-card"><h2>${esc(T.load)} ${esc(L.year)}</h2>${g(L.months, [['month', 'month'], ['active', 'active'], ['fte', 'fte'], ['critical', 'critical'], ['high_risk', 'high_risk'], ['very_large', 'very_large']])}<p class="pr-muted">${esc(L.undated)} ${esc(T.undated)}</p></div>`);
    return cards.join('');
  }

  async function load() {
    const q = UF.serialise(state, PR.SCHEMA);
    $('prReset').href = location.pathname;
    $('prCsv').href = '/api/governance/portfolio/register.csv' + q; $('prXlsx').href = '/api/governance/portfolio/register.xlsx' + q;
    try {
      const j = await api('/api/governance/portfolio/register' + q);
      $('prMeta').textContent = `${j.rows.length} ${T.rows} ${T.of} ${j.total} · ${String(j.as_of || '').slice(0, 16).replace('T', ' ')}${j.money_hidden ? ' · ' + T.MONEY_HIDDEN : ''} · ${T.proposed}`;
      if (!drawn) { drawFilters(j); drawn = true; }   // drawn once: a re-render would move the keyboard focus
      $('prKpis').innerHTML = PR.kpiHtml(j.kpis, { esc, T, merge });
      // P11 F-21: each report link opens exactly r.drill; its count is computed on that same state.
      $('prReports').innerHTML = (j.reports || []).map((r) => { const d = PR.REPORTS.find((x) => x.key === r.key); const lab = `${esc(d[lang === 'fr' ? 'fr' : 'en'])} (${r.count == null ? '—' : esc(r.count)})`; return r.drill ? `<a href="${esc(merge(r.drill))}">${lab}</a>` : `<span>${lab}</span>`; }).join(' · ');
      $('prRowsH').textContent = `${T.title} (${j.rows.length})`;
      $('prTable').innerHTML = PR.tableHtml(j.rows, { cols: j.cols, esc, T, lang, sort: state.sort, dir: state.dir, merge });
      $('prAnalyses').innerHTML = analysesHtml(j.analyses, j);
      ['prFilterCard', 'prKpiCard', 'prTableCard', 'prAnalyses'].forEach((id) => { $(id).hidden = false; });
    } catch (e) { $('prMeta').textContent = e.status === 404 ? T.off : T.loadErr + ': ' + e.message; }
  }
  load();
})();
