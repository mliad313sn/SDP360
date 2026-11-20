/* PORTFOLIO LOT 3 (IT portfolio reconstruction spec §21, §23.1, §24.5, §30) — the register + executive dashboard
   vocabulary shared by the server (services/ppm/portfolioRegister.js, routes/governancePortfolioRegister.js) and the page
   (public/portfolio-register.html via lib/portfolioRegisterPage.js). UMD, PURE: no DOM write, no fetch.
     SCHEMA      the ONLY query keys the register reads from / writes to the URL (lib/urlFilters.js) — a saved view IS
                 a URL; filter selections only, never a data value
     COLUMNS     the register columns (money: shown only to an amount reader; frozen: identity columns, spec §24.5)
     REPORTS     the §30 standard reports (each = a filter preset; definitions PROPOSED in the server engine)
     T           EN / FR labels (the page picks the shell language)
     kpiHtml / tableHtml / groupTableHtml — escaped HTML for the page; unknown (null) always renders "—", never 0 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PortfolioRegister = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var C = function (key, en, fr, o) { var c = { key: key, en: en, fr: fr }; for (var k in (o || {})) c[k] = o[k]; return c; };
  var COLUMNS = [
    C('ref', 'Project ID', 'Identifiant', { frozen: true }),
    C('site', 'Site', 'Site', { frozen: true }),
    C('name', 'Project name', 'Nom du projet', { frozen: true }),
    C('project_type', 'Type', 'Type'),
    C('priority', 'Priority', 'Priorité'),
    C('status', 'Status', 'Statut'),
    C('stage', 'Stage', 'Étape'),
    C('stage_age_days', 'Days in stage', 'Jours dans l’étape', { num: true }),
    C('risk_exposure', 'Risk exposure', 'Exposition au risque'),
    C('high_risks', 'Open high risks', 'Risques élevés ouverts', { num: true }),
    C('owner', 'IT owner', 'Responsable IT'),
    C('sponsor', 'Business sponsor', 'Sponsor métier'),
    C('delivery_lead', 'Delivery lead', 'Réalisation'),
    C('decision_required', 'Decision required', 'Décision requise'),
    C('budget_status', 'Budget status', 'Statut du budget', { money: true }),
    C('budget', 'Budget', 'Budget', { money: true, num: true }),
    C('currency', 'Currency', 'Devise', { money: true }),
    C('avg_fte', 'Average FTE', 'ETP moyen', { num: true }),
    C('delivery_effort', 'Delivery effort', 'Effort'),
    C('start_date', 'Start', 'Début'),
    C('end_date', 'Finish', 'Fin'),
    C('duration_days', 'Duration (days)', 'Durée (jours)', { num: true }),
    C('baselined', 'Schedule baselined', 'Planning de référence'),
    C('dq_score', 'Data quality', 'Qualité des données', { num: true }),
  ];
  var KEYS = COLUMNS.map(function (c) { return c.key; });
  var DEFAULT_COLS = ['ref', 'site', 'name', 'project_type', 'priority', 'status', 'stage', 'risk_exposure', 'owner', 'delivery_lead', 'decision_required', 'budget_status', 'budget', 'currency', 'start_date', 'end_date', 'baselined', 'dq_score'];
  var REPORTS = [
    C('unfunded', 'Unfunded projects', 'Projets non financés', { money: true }),
    C('without_owners', 'Projects without owners', 'Projets sans responsable'),
    C('on_hold', 'Projects on hold', 'Projets en attente'),
    C('high_risk', 'High-risk projects', 'Projets à risque élevé'),
    C('data_quality', 'Data quality report', 'Rapport qualité des données'),
    C('not_baselined', 'Schedule not baselined', 'Planning sans référence'),
  ];
  var L = function (max) { return { type: 'list', max: max || 50, def: null }; };
  var SCHEMA = {
    year: L(5), site: L(), project_type: L(), priority: L(), status: L(), risk: L(), budget_status: L(),
    owner: L(), delivery_lead: L(), sponsor: L(), decision_required: L(), q: L(10),
    report: { type: 'enum', values: [''].concat(REPORTS.map(function (r) { return r.key; })), def: '' },
    dq: { type: 'enum', values: ['', 'scored'], def: '' },
    budget: { type: 'enum', values: ['', 'identified'], def: '' },
    sort: { type: 'enum', values: KEYS, def: 'ref' },
    dir: { type: 'enum', values: ['asc', 'desc'], def: 'asc' },
    cols: { type: 'list', max: KEYS.length, def: null },
  };
  var T = {
    en: { title: 'Portfolio register', intro: 'One row per project, from the portfolio you may read. Unknown values show "—", never 0. Filters, sort and columns live in the address: copy the link to save or share a view.',
      kpis: 'Executive dashboard', total_projects: 'Total projects', data_quality: 'Data quality', critical_high: 'Critical + High', budget_identified: 'Budget identified', decisions_required: 'Decisions required',
      drill: 'Show these projects', search: 'Search', filters: 'Filters', reset: 'Clear filters', apply: 'Apply filters', reports: 'Standard reports', columns: 'Columns', exportCsv: 'Export CSV', exportXlsx: 'Export Excel',
      rows: 'projects shown', of: 'of', none: 'No project matches these filters.', unknown: '—', yes: 'yes', no: 'no', bySite: 'By site', byPriority: 'By priority', status: 'Status',
      risk: 'Risk (high-risk projects)', budget: 'Budget (per currency, never added across currencies)', load: 'Monthly active load', proposed: 'PROPOSED rules — not approved policy',
      MONEY_HIDDEN: 'amounts are shown to the admin tier, the committee and finance', DQ_DISABLED: 'data quality is not switched on', INTAKE_DISABLED: 'the intake register is not switched on', NO_SCORE: 'no project has a score yet',
      count: 'Projects', pct: '% of portfolio', fte: 'FTE', fte_unknown: 'FTE unknown', sites: 'Sites', unfunded: 'Unfunded', high_risk: 'High risk', dq: 'DQ',
      on_hold: 'On hold', stalled: 'Stalled in stage', avg_stage_age: 'Average days in stage', approved_not_started: 'In approval, not started', in_progress_without_lead: 'In progress without a delivery lead',
      month: 'Month', active: 'Active', critical: 'Critical', very_large: 'Very large', undated: 'projects without dates are not in the monthly load', total: 'Total', approved: 'Approved', requested: 'Requested', not_budgeted: 'Not budgeted', tbc: 'TBC',
      key: 'Value', loadErr: 'Could not load', off: 'This page is not switched on.',
      dq_scope_with: 'Score includes the budget checks (amount reader).', dq_scope_without: 'Score without the budget checks: amounts are hidden for you, so those checks are left out.' },
    fr: { title: 'Registre du portefeuille', intro: 'Une ligne par projet, sur le portefeuille que vous pouvez lire. Une valeur inconnue s’affiche « — », jamais 0. Filtres, tri et colonnes sont dans l’adresse : copiez le lien pour enregistrer ou partager une vue.',
      kpis: 'Tableau de bord de direction', total_projects: 'Projets', data_quality: 'Qualité des données', critical_high: 'Critiques + hauts', budget_identified: 'Budget identifié', decisions_required: 'Décisions requises',
      drill: 'Voir ces projets', search: 'Recherche', filters: 'Filtres', reset: 'Effacer les filtres', apply: 'Appliquer les filtres', reports: 'Rapports types', columns: 'Colonnes', exportCsv: 'Exporter CSV', exportXlsx: 'Exporter Excel',
      rows: 'projets affichés', of: 'sur', none: 'Aucun projet ne correspond à ces filtres.', unknown: '—', yes: 'oui', no: 'non', bySite: 'Par site', byPriority: 'Par priorité', status: 'Statut',
      risk: 'Risque (projets à risque élevé)', budget: 'Budget (par devise, jamais additionné entre devises)', load: 'Charge mensuelle active', proposed: 'Règles PROPOSÉES — non approuvées',
      MONEY_HIDDEN: 'les montants sont réservés au palier admin, au comité et à la finance', DQ_DISABLED: 'la qualité des données n’est pas activée', INTAKE_DISABLED: 'le registre d’intake n’est pas activé', NO_SCORE: 'aucun projet n’a encore de score',
      count: 'Projets', pct: '% du portefeuille', fte: 'ETP', fte_unknown: 'ETP inconnus', sites: 'Sites', unfunded: 'Non financés', high_risk: 'Risque élevé', dq: 'QD',
      on_hold: 'En attente', stalled: 'Bloqués dans l’étape', avg_stage_age: 'Jours moyens dans l’étape', approved_not_started: 'En approbation, non démarrés', in_progress_without_lead: 'En cours sans responsable de réalisation',
      month: 'Mois', active: 'Actifs', critical: 'Critiques', very_large: 'Très grands', undated: 'les projets sans dates ne figurent pas dans la charge mensuelle', total: 'Total', approved: 'Approuvé', requested: 'Demandé', not_budgeted: 'Non budgété', tbc: 'À confirmer',
      key: 'Valeur', loadErr: 'Chargement impossible', off: 'Cette page n’est pas activée.',
      dq_scope_with: 'Score avec les contrôles budgétaires (lecteur des montants).', dq_scope_without: 'Score sans les contrôles budgétaires : les montants vous sont masqués, ces contrôles sont donc exclus.' },
  };
  function dash(v, esc) { return v == null || v === '' ? '—' : esc(String(v)); }
  function cell(r, c, esc, t) {
    var v = r[c.key];
    if (c.key === 'baselined') return v == null ? '—' : esc(v ? t.yes : t.no);
    if (c.key === 'name' && r.id != null) return '<a href="project.html?id=' + encodeURIComponent(String(r.id)) + '">' + dash(v, esc) + '</a>';
    if (c.key === 'budget' && v != null) return esc(Number(v).toLocaleString('en-US'));
    return dash(v, esc);
  }
  function money(v, esc) {
    if (v == null) return '—';
    if (typeof v === 'object') { var ks = Object.keys(v); return ks.length ? ks.map(function (k) { return esc(Number(v[k]).toLocaleString('en-US') + ' ' + k); }).join('<br>') : '—'; }
    return esc(String(v));
  }
  /** KPI cards: each a link to its drill-through. P11 F-21: k.drill is the exact patch merged into the current address
   *  (list keys already intersected with the active filters server-side), and k.count is the size of that list. */
  function kpiHtml(kpis, o) {
    var esc = o.esc, t = o.T, merge = o.merge || function () { return '?'; };
    return '<div class="pr-kpis">' + (kpis || []).map(function (k) {
      var val = k.value == null ? '<span class="pr-unk">—</span>' : (k.unit === 'money' ? money(k.value, esc) : esc(String(k.value)) + (k.unit === '%' ? ' %' : ''));
      var why = k.value == null && k.reason ? '<div class="pr-muted">' + esc(t[k.reason] || k.reason) + '</div>' : '';
      if (k.scope) why += '<div class="pr-muted">' + esc(k.scope === 'with_budget_checks' ? t.dq_scope_with : t.dq_scope_without) + '</div>';   // P11 F-22
      var link = k.drill ? '<a class="pr-drill" href="' + esc(merge(k.drill)) + '">' + esc(t.drill) + ' (' + esc(String(k.count == null ? '—' : k.count)) + ')</a>' : '';
      return '<section class="pr-kpi" aria-label="' + esc(t[k.key] || k.key) + '"><h3>' + esc(t[k.key] || k.key) + '</h3><div class="pr-kpi-v">' + val + '</div>' + why + link + '</section>';
    }).join('') + '</div>';
  }
  /** The register table: sortable headers (links), sticky header, frozen identity columns (CSS), escaped cells. */
  function tableHtml(rows, o) {
    var esc = o.esc, t = o.T, lang = o.lang === 'fr' ? 'fr' : 'en', merge = o.merge || function () { return '#'; };
    var cols = (o.cols || DEFAULT_COLS).map(function (k) { return COLUMNS.find(function (c) { return c.key === k; }); }).filter(Boolean);
    var head = cols.map(function (c, i) {
      var on = o.sort === c.key; var nextDir = on && o.dir === 'asc' ? 'desc' : 'asc';
      return '<th scope="col" class="' + (c.frozen ? 'pr-frz pr-frz' + i : '') + (c.num ? ' pr-num' : '') + '"' + (on ? ' aria-sort="' + (o.dir === 'desc' ? 'descending' : 'ascending') + '"' : '') + '><a href="' + esc(merge({ sort: c.key, dir: nextDir })) + '">' + esc(c[lang]) + (on ? (o.dir === 'desc' ? ' ▼' : ' ▲') : '') + '</a></th>';
    }).join('');
    if (!rows || !rows.length) return '<p class="pr-muted">' + esc(t.none) + '</p>';
    var body = rows.map(function (r) {
      return '<tr>' + cols.map(function (c, i) { return (c.frozen && i === 0 ? '<th scope="row" class="pr-frz pr-frz0">' : '<td class="' + (c.frozen ? 'pr-frz pr-frz' + i : '') + (c.num ? ' pr-num' : '') + '">') + cell(r, c, esc, t) + (c.frozen && i === 0 ? '</th>' : '</td>'); }).join('') + '</tr>';
    }).join('');
    return '<div class="pr-scroll" tabindex="0" role="region" aria-label="' + esc(t.title) + '"><table class="pr-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  /** A small analysis table: rows of objects, columns [key, label-key]; money cells render per currency. */
  function groupTableHtml(rows, cols, o) {
    var esc = o.esc, t = o.T;
    if (!rows || !rows.length) return '<p class="pr-muted">—</p>';
    return '<table class="pr-mini"><thead><tr>' + cols.map(function (c) { return '<th scope="col">' + esc(t[c[1]] || c[1]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + cols.map(function (c) { var v = r[c[0]]; return '<td>' + (v != null && typeof v === 'object' ? money(v, esc) : dash(v, esc)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }
  return { COLUMNS: COLUMNS, DEFAULT_COLS: DEFAULT_COLS, REPORTS: REPORTS, SCHEMA: SCHEMA, T: T, kpiHtml: kpiHtml, tableHtml: tableHtml, groupTableHtml: groupTableHtml };
}));
