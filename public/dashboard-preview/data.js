// IT Activity Tracker — mock dataset
// Plausible numbers per the brief: overall 62%, ▼6pp, best HGO 69%, watch ITY 50%

window.DASHBOARD_DATA = {
  period: { month: 'May', year: 2026 },

  overall: {
    score: 62,
    delta: -6,       // percentage points vs last month
    onTarget: 31,    // % of activities meeting target
    progressing: 82, // % of activities showing month-on-month progress
    bestSite: { code: 'HGO', score: 69 },
    watchSite: { code: 'ITY', score: 50 },
  },

  // 6-month trend, Dec → May
  trend: [
    { month: 'Dec', value: 71 },
    { month: 'Jan', value: 68 },
    { month: 'Feb', value: 65 },
    { month: 'Mar', value: 70 },
    { month: 'Apr', value: 68 },
    { month: 'May', value: 62 },
  ],

  pillars: [
    { id: 'P1', name: 'Network Infrastructure',  weight: 30, sites: 5, score: 68, delta:  -2, color: '#145FAE' },
    { id: 'P2', name: 'Business Partnering',     weight: 35, sites: 5, score: 58, delta: -11, color: '#EF631A' },
    { id: 'P3', name: 'Risk & Compliance',       weight: 20, sites: 5, score: 71, delta:  +3, color: '#7C3AED' },
    { id: 'P4', name: 'People Management',       weight: 15, sites: 5, score: 54, delta:  -8, color: '#0D9488' },
  ],

  // Site rows now carry G/A/R activity counts the legacy dashboard
  // exposed — information that was being lost in the rolled-up score
  // alone. Each tuple is (green, amber, red) = number of activities in
  // that RAG state this month. Total active activities = g + a + r.
  sites: [
    { code: 'HGO', name: 'Houndé',    country: 'Burkina Faso',  score: 69, delta:  -1, active: true,  g: 13, a:  8, r:  7 },
    { code: 'MGO', name: 'Mana',      country: 'Burkina Faso',  score: 66, delta:  +2, active: true,  g: 12, a:  8, r:  8 },
    { code: 'SML', name: 'Lafigué',   country: "Côte d'Ivoire", score: 64, delta:  -4, active: true,  g: 12, a:  5, r:  9 },
    { code: 'SGO', name: 'Sabodala',  country: 'Senegal',       score: 60, delta:  -7, active: true,  g:  9, a:  9, r: 10 },
    { code: 'ITY', name: 'Ity',       country: "Côte d'Ivoire", score: 50, delta: -12, active: true,  g: 10, a:  4, r:  8 },
    { code: 'BGO', name: 'Boungou',   country: 'Burkina Faso',  score:  0, delta:   0, active: false, g:  0, a:  0, r:  0 },
    { code: 'WGO', name: 'Wahgnion',  country: 'Burkina Faso',  score:  0, delta:   0, active: false, g:  0, a:  0, r:  0 },
    { code: 'KLN', name: 'Kalana',    country: 'Mali',          score:  0, delta:   0, active: false, g:  0, a:  0, r:  0 },
    { code: 'AFM', name: 'Afema',     country: 'Côte d’Ivoire', score:  0, delta:   0, active: false, g:  0, a:  0, r:  0 },
    { code: 'TIG', name: 'Tanda-Iguela', country: "Côte d'Ivoire", score: 0, delta: 0, active: false, g:  0, a:  0, r:  0 },
  ],

  watchlist: [
    { site: 'ITY', ref: 'P1-7',  rag: 'red',   activity: 'Network uptime targets', reason: '94.1% vs 99.0% target — second consecutive month', owner: 'D. Ouattara' },
    { site: 'ITY', ref: 'P2-3',  rag: 'red',   activity: 'Helpdesk SLA — Tier 2',  reason: 'Median resolution 38h vs 24h target',                owner: 'A. Coulibaly' },
    { site: 'SGO', ref: 'P1-11', rag: 'red',   activity: 'Backup verification',     reason: '2 critical systems unverified this month',            owner: 'M. Diop' },
    { site: 'SGO', ref: 'P3-4',  rag: 'amber', activity: 'Access reviews',          reason: 'Quarterly review overdue by 9 days',                  owner: 'M. Diop' },
    { site: 'ITY', ref: 'P4-2',  rag: 'amber', activity: 'Training compliance',     reason: '71% completion vs 90% target',                        owner: 'A. Coulibaly' },
    { site: 'SML', ref: 'P2-9',  rag: 'amber', activity: 'Project intake backlog',  reason: '14 open requests > 30 days',                          owner: 'K. Touré' },
    { site: 'HGO', ref: 'P3-1',  rag: 'amber', activity: 'Patch compliance',        reason: '88% vs 95% target — improving',                       owner: 'B. Sawadogo' },
    { site: 'MGO', ref: 'P4-5',  rag: 'amber', activity: 'Skills matrix update',    reason: 'Last updated 11 weeks ago',                           owner: 'F. Kaboré' },
    { site: 'SGO', ref: 'P2-7',  rag: 'amber', activity: 'Stakeholder NPS',         reason: '+12 vs +20 target',                                    owner: 'M. Diop' },
  ],

  // Drill-down strip
  drilldowns: [
    { id: 'scoring',  icon: '◷', title: 'Scoring',       description: '31 activities · 5 sites · 155 cells this month', href: '#scoring' },
    { id: 'roadmap',  icon: '▦', title: 'Roadmap Gantt', description: '12-month rolling plan by pillar & site',         href: '#roadmap', isNew: true },
    { id: 'heatmap',  icon: '▤', title: 'Heatmap',       description: 'RAG matrix · site × activity ·  trend overlay',  href: '#heatmap' },
  ],

  tabs: [
    { id: 'dashboard', label: 'Dashboard', active: true },
    { id: 'scoring',   label: 'Scoring' },
    { id: 'input',     label: 'Input' },
    { id: 'heatmap',   label: 'Heatmap' },
    { id: 'activities',label: 'Activities' },
    { id: 'targets',   label: 'Targets' },
    { id: 'roadmap',   label: 'Roadmap', badge: 'NEW' },
    { id: 'decisions', label: 'Decisions', badge: 'NEW' },
  ],

  // ── Meetings Decision Tracker — NEW MODULE proposal ─────────────────
  // This is a SEPARATE module from the Activity Tracker. The preview
  // shows it as a tab here for review only; in production it'll be its
  // own page under Insights ▾ (sibling to Executive Scorecard /
  // Analytics / Activity Tracker), with its own meetings.db, /api/
  // meetings/* routes, and an inline editor.
  //
  // Three seeded categories — admin can add more via Settings (the
  // category list is parametrable in the DB, not hard-coded).
  decisionsModel: {
    categories: [
      { code: 'dept_meeting',   name: 'Department Meeting',      color: '#145FAE', icon: '🏛' },
      { code: 'survey_concern', name: 'Survey Concern',          color: '#EF631A', icon: '📣' },
      { code: 'mic_decision',   name: 'Mine IT Council',         color: '#7C3AED', icon: '⚙' },
    ],
    statuses: [
      { code: 'open',         label: 'Open',         color: '#6B7785' },
      { code: 'in_progress',  label: 'In progress',  color: '#145FAE' },
      { code: 'blocked',      label: 'Blocked',      color: '#D90038' },
      { code: 'done',         label: 'Done',         color: '#1B9A3A' },
      { code: 'cancelled',    label: 'Cancelled',    color: '#94A3B8' },
    ],
    priorities: [
      { code: 'critical', label: 'Critical', color: '#7F1D1D' },
      { code: 'high',     label: 'High',     color: '#D90038' },
      { code: 'medium',   label: 'Medium',   color: '#D97706' },
      { code: 'low',      label: 'Low',      color: '#145FAE' },
    ],
  },

  // KPI roll-up for the Decisions tab header
  decisionsKpi: {
    total: 47, open: 23, inProgress: 11, blocked: 3, done: 9, cancelled: 1,
    overdue: 7,
    thisWeek: 4,
    byCategory: { dept_meeting: 18, survey_concern: 15, mic_decision: 14 },
  },

  // Sample decisions — realistic mix across the 3 categories + 5 sites
  decisions: [
    { ref: 'MD-2026-00042', category: 'mic_decision', site: 'HGO', title: 'Standardise distribution-layer switches across HGO racks',
      source: 'MIC Council · Apr 22', source_date: '2026-04-22',
      owner: 'Wendpanga Yves Berenger OUEDRAOGO', dueDate: '2026-06-15', priority: 'high',  status: 'in_progress',
      comment: 'BOM signed off, vendor lead time confirmed at 4 weeks.' },
    { ref: 'MD-2026-00041', category: 'survey_concern', site: 'MGO', title: 'Slow VPN at Mana mess hall — multiple users in Mar survey',
      source: 'Survey Q1 2026', source_date: '2026-04-05',
      owner: 'Thomas DAO', dueDate: '2026-05-30', priority: 'medium', status: 'open',
      comment: 'Pending site visit to measure AP coverage.' },
    { ref: 'MD-2026-00040', category: 'dept_meeting', site: 'ITY', title: 'Add LTE coverage to ITY pit western flank',
      source: 'Operations Dept · Apr 18', source_date: '2026-04-18',
      owner: 'Ndiamoi AKASSIMANDOU', dueDate: '2026-08-01', priority: 'high',  status: 'in_progress',
      comment: 'RFP issued, awaiting 3 vendor proposals.' },
    { ref: 'MD-2026-00039', category: 'mic_decision', site: null, title: 'Group-wide backup vault refresh — Veeam → Rubrik',
      source: 'MIC Council · Apr 22', source_date: '2026-04-22',
      owner: 'Cezar MARIN', dueDate: '2026-09-30', priority: 'critical', status: 'open',
      comment: 'Budget approval pending, target restore-test cycle in Q4.' },
    { ref: 'MD-2026-00038', category: 'survey_concern', site: 'SGO', title: 'Printers in Sabodala admin block — frequent paper jams',
      source: 'Survey Q1 2026', source_date: '2026-04-05',
      owner: 'Hamdiatou Kanoute', dueDate: '2026-05-15', priority: 'low',    status: 'done',
      comment: 'Replaced 2 Brother MFC units; reset firmware on remaining 3.' },
    { ref: 'MD-2026-00037', category: 'dept_meeting', site: 'SML', title: 'IT cost reporting cadence — switch monthly → bi-weekly',
      source: 'Finance Dept · Apr 11', source_date: '2026-04-11',
      owner: 'Pénin Débora OUATTARA', dueDate: '2026-05-01', priority: 'medium', status: 'blocked',
      comment: 'Blocked on Finance ERP data refresh schedule.' },
    { ref: 'MD-2026-00036', category: 'survey_concern', site: 'HGO', title: 'Email outage post-cyclone — RTO discussion',
      source: 'Survey Q1 2026', source_date: '2026-04-05',
      owner: 'Lazare Aziz TRAORE NIGNAN', dueDate: '2026-06-01', priority: 'high',  status: 'in_progress',
      comment: 'Failover DR-test scheduled May 24.' },
    { ref: 'MD-2026-00035', category: 'mic_decision', site: 'SGO', title: 'Decommission legacy file server SAB-FS01 — migrate to SharePoint',
      source: 'MIC Council · Mar 18', source_date: '2026-03-18',
      owner: 'Moussa Sarr', dueDate: '2026-05-31', priority: 'medium', status: 'in_progress',
      comment: 'Data migration 70% complete, ACL audit in progress.' },
    { ref: 'MD-2026-00034', category: 'dept_meeting', site: 'MGO', title: 'New mining-fleet dispatch tablets — IT provisioning plan',
      source: 'Operations Dept · Mar 14', source_date: '2026-03-14',
      owner: 'Mwin Maal Silvère Olivier KPAGNAWNE PODA', dueDate: '2026-04-30', priority: 'high',  status: 'open',
      comment: 'OVERDUE — escalated at last weekly catch-up. Awaiting tablet delivery.' },
  ],

  // ── Scoring view — per-site activity-by-activity breakdown ──────────
  // Mock data for the Site Scoring view. The real engine produces this
  // via score(site) / ss(site) / ps2(site, pillar) in activity-tracker.html.
  // Shape mirrors what the live engine returns so the eventual port is
  // a mechanical wire-up (read the same fields from the real D object).
  scoring: {
    site:       'HGO',
    siteName:   'Houndé',
    siteColor:  '#D97706',
    overall:    { score: 69, delta: -1, g: 13, a: 8, r: 7 },
    pillars: [
      {
        id: 'P1', name: 'Network Infrastructure', weight: 30, score: 68, delta: -2, color: '#145FAE',
        activities: [
          { num: 1,  name: 'Link 1 Upgrade',                       kpi: 'BOOLEAN', weight: 12,  ytd: 'Done',     target: 'Done', score: 100, rag: 'green' },
          { num: 2,  name: 'Link 2 Upgrade',                       kpi: 'BOOLEAN', weight:  8,  ytd: '—',        target: 'Done', score:   0, rag: 'red'   },
          { num: 4,  name: 'Distribution Layer Standardization',   kpi: 'BOOLEAN', weight: 12,  ytd: 'In prog',  target: 'Done', score:  50, rag: 'amber' },
          { num: 5,  name: 'Local Infrastructure Monitoring',      kpi: 'COUNT',   weight:  8,  ytd: 3,           target: 3,      score: 100, rag: 'green' },
          { num: 7,  name: 'Radio Infrastructure Upgrade',         kpi: 'BOOLEAN', weight: 12,  ytd: 'In prog',  target: 'Done', score:  50, rag: 'amber' },
          { num: 8,  name: 'Coverage & Capacity Improvement',      kpi: 'BOOLEAN', weight: 12,  ytd: 'Done',     target: 'Done', score: 100, rag: 'green' },
          { num: 9,  name: 'Resilience & DC Standardization',      kpi: 'BOOLEAN', weight: 12,  ytd: '—',        target: 'Done', score:   0, rag: 'red'   },
          { num: 10, name: 'Centralized Fire Suppression System',  kpi: 'BOOLEAN', weight:  8,  ytd: 'In prog',  target: 'Done', score:  50, rag: 'amber' },
        ],
      },
      {
        id: 'P2', name: 'Business Partnering', weight: 35, score: 71, delta: +3, color: '#EF631A',
        activities: [
          { num: 11, name: 'Weekly IT Meeting',                    kpi: 'COUNT', weight:  8.3, ytd: 18, target: 20, score:  90, rag: 'green' },
          { num: 12, name: 'Monthly / Quarterly Cost Review',      kpi: 'COUNT', weight:  8.3, ytd:  3, target:  5, score:  60, rag: 'amber' },
          { num: 13, name: 'Monthly Department Meeting',           kpi: 'COUNT', weight: 12.5, ytd:  5, target:  5, score: 100, rag: 'green' },
          { num: 15, name: 'Toolbox & Awareness Campaigns',        kpi: 'COUNT', weight:  8.3, ytd:  4, target:  5, score:  80, rag: 'green' },
          { num: 17, name: 'End-User Satisfaction Survey',         kpi: 'COUNT', weight:  8.5, ytd:  1, target:  2, score:  50, rag: 'amber', shared: true },
          { num: 18, name: 'Stakeholder Management Workshops',     kpi: 'COUNT', weight:  8.3, ytd:  1, target:  6, score:  17, rag: 'red'   },
          { num: 19, name: 'IT Project / Initiatives',             kpi: 'COUNT', weight: 16.5, ytd:  8, target: 12, score:  67, rag: 'amber' },
        ],
      },
      {
        id: 'P3', name: 'Risk & Compliance', weight: 20, score: 65, delta: -4, color: '#7C3AED',
        activities: [
          { num: 20, name: 'Risk & Major Incident Review',         kpi: 'COUNT', weight: 10, ytd: 5, target: 5,   score: 100, rag: 'green' },
          { num: 22, name: 'Monthly Changes Review',               kpi: 'COUNT', weight: 10, ytd: 4, target: 5,   score:  80, rag: 'green' },
          { num: 23, name: 'Bi-Weekly CAB',                        kpi: 'COUNT', weight: 10, ytd: 8, target: 10,  score:  80, rag: 'green' },
          { num: 21, name: 'Quarterly Backup / Restore Test',      kpi: 'COUNT', weight: 10, ytd: 0, target: 1,   score:   0, rag: 'red'   },
          { num: 24, name: 'Daily Check',                          kpi: 'COUNT', weight: 10, ytd: 142, target: 150, score: 95, rag: 'green' },
          { num: 25, name: 'Monthly Inspection',                   kpi: 'COUNT', weight: 10, ytd: 3, target: 5,   score:  60, rag: 'amber' },
          { num: 28, name: 'Monthly Access Review',                kpi: 'COUNT', weight: 10, ytd: 2, target: 5,   score:  40, rag: 'red'   },
        ],
      },
      {
        id: 'P4', name: 'People Management', weight: 15, score: 73, delta: 0, color: '#0D9488',
        activities: [
          { num: 29, name: 'Monthly Mentoring / Coaching Session', kpi: 'COUNT', weight: 45, ytd: 4, target: 5, score:  80, rag: 'green' },
          { num: 30, name: 'Quarterly People Assessment',          kpi: 'COUNT', weight: 30, ytd: 1, target: 2, score:  50, rag: 'amber' },
          { num: 31, name: 'Mid Year and Yearly Review',           kpi: 'COUNT', weight: 25, ytd: 1, target: 1, score: 100, rag: 'green' },
        ],
      },
    ],
  },

  // ── INPUT view — monthly data-entry grid ────────────────────────────
  // The IT site admin lands here every month-end to log actuals against
  // each active activity. We show 12 months of history per activity
  // (Jan–Dec) so the admin can spot drift while entering the current
  // month. May = "current month, being edited"; values from Jun→Dec are
  // empty / future.
  inputView: {
    site:        'HGO',
    siteName:    'Houndé',
    siteColor:   '#D97706',
    currentMonth: 'May',
    currentYear: 2026,
    months: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    // Status bar facts
    summary: {
      activities_total:   25,
      activities_entered: 22,
      activities_pending: 3,
      lastSavedAt:        '2026-05-22 18:42',
      lastSavedBy:        'B. Sawadogo',
    },
    // Editable cells. `vals` is per-month; 0 = not yet entered. `unit` is
    // a render hint (#, %, USD, "Done/In prog/—" etc.).
    activitiesByPillar: [
      { id:'P1', name:'Network Infrastructure', color:'#145FAE', items: [
        { num: 1, name:'Link 1 Upgrade',                      unit:'milestone', target:'Done', vals:['—','—','In prog','In prog','Done','','','','','','',''] },
        { num: 2, name:'Link 2 Upgrade',                      unit:'milestone', target:'Done', vals:['—','—','—','—','—','','','','','','',''] },
        { num: 4, name:'Distribution Layer Standardization',  unit:'milestone', target:'Done', vals:['—','In prog','In prog','In prog','In prog','','','','','','',''] },
        { num: 5, name:'Local Infrastructure Monitoring',     unit:'#',         target:3,      vals:[3,3,3,3,3,'','','','','','',''] },
        { num: 7, name:'Radio Infrastructure Upgrade',        unit:'milestone', target:'Done', vals:['—','—','In prog','In prog','In prog','','','','','','',''] },
        { num: 8, name:'Coverage & Capacity Improvement',     unit:'milestone', target:'Done', vals:['—','In prog','Done','Done','Done','','','','','','',''] },
        { num: 9, name:'Resilience & DC Standardization',     unit:'milestone', target:'Done', vals:['—','—','—','—','—','','','','','','',''] },
        { num:10, name:'Centralized Fire Suppression System', unit:'milestone', target:'Done', vals:['—','—','In prog','In prog','In prog','','','','','','',''] },
      ]},
      { id:'P2', name:'Business Partnering', color:'#EF631A', items: [
        { num:11, name:'Weekly IT Meeting',                kpi:'COUNT', unit:'#', target:4, vals:[4,4,4,3,3,'','','','','','',''] },
        { num:12, name:'Monthly / Quarterly Cost Review',  kpi:'COUNT', unit:'#', target:1, vals:[1,1,1,0,1,'','','','','','',''] },
        { num:13, name:'Monthly Department Meeting',       kpi:'COUNT', unit:'#', target:1, vals:[1,1,1,1,1,'','','','','','',''] },
        { num:15, name:'Toolbox & Awareness Campaigns',    kpi:'COUNT', unit:'#', target:1, vals:[1,1,0,1,1,'','','','','','',''] },
        { num:17, name:'End-User Satisfaction Survey',     kpi:'COUNT', unit:'#', target:'',vals:[0,0,1,0,0,'','','','','','',''] },
        { num:18, name:'Stakeholder Management Workshops', kpi:'COUNT', unit:'#', target:1, vals:[0,1,0,0,0,'','','','','','',''] },
        { num:19, name:'IT Project / Initiatives',         kpi:'COUNT', unit:'#', target:1, vals:[1,2,2,2,1,'','','','','','',''] },
      ]},
      { id:'P3', name:'Risk & Compliance', color:'#7C3AED', items: [
        { num:20, name:'Risk & Major Incident Review',       kpi:'COUNT', unit:'#',   target:1,   vals:[1,1,1,1,1,'','','','','','',''] },
        { num:21, name:'Quarterly Backup / Restore Test',    kpi:'COUNT', unit:'#',   target:'',  vals:[0,0,1,0,0,'','','','','','',''] },
        { num:22, name:'Monthly Changes Review',             kpi:'COUNT', unit:'#',   target:1,   vals:[1,1,1,0,1,'','','','','','',''] },
        { num:23, name:'Bi-Weekly CAB',                      kpi:'COUNT', unit:'#',   target:2,   vals:[2,2,2,1,1,'','','','','','',''] },
        { num:24, name:'Daily Check',                        kpi:'COUNT', unit:'#',   target:30,  vals:[30,28,29,28,27,'','','','','','',''] },
        { num:25, name:'Monthly Inspection',                 kpi:'COUNT', unit:'#',   target:1,   vals:[1,1,0,1,0,'','','','','','',''] },
        { num:28, name:'Monthly Access Review',              kpi:'COUNT', unit:'#',   target:1,   vals:[1,0,1,0,0,'','','','','','',''] },
      ]},
      { id:'P4', name:'People Management', color:'#0D9488', items: [
        { num:29, name:'Monthly Mentoring / Coaching Session', kpi:'COUNT', unit:'#', target:1, vals:[1,1,1,0,1,'','','','','','',''] },
        { num:30, name:'Quarterly People Assessment',          kpi:'COUNT', unit:'#', target:'',vals:[0,0,1,0,0,'','','','','','',''] },
        { num:31, name:'Mid Year and Yearly Review',           kpi:'COUNT', unit:'#', target:'',vals:[0,0,0,0,0,'','','','','','',''] },
      ]},
    ],
  },

  // ── HEATMAP — RAG matrix · site × activity ─────────────────────────
  // Each cell is { rag: 'green|amber|red|na', score: 0-100 }. The 5
  // active sites × 25 activities = 125 cells. Inactive sites omitted.
  heatmap: {
    sites: [
      { code:'HGO', name:'Houndé',   color:'#D97706' },
      { code:'MGO', name:'Mana',     color:'#10B981' },
      { code:'SML', name:'Lafigué',  color:'#7C3AED' },
      { code:'SGO', name:'Sabodala', color:'#0891B2' },
      { code:'ITY', name:'Ity',      color:'#EF631A' },
    ],
    pillars: [
      { id:'P1', name:'Network Infra',     color:'#145FAE', range:[1,10] },
      { id:'P2', name:'Biz Partnering',    color:'#EF631A', range:[11,19] },
      { id:'P3', name:'Risk & Compliance', color:'#7C3AED', range:[20,28] },
      { id:'P4', name:'People',            color:'#0D9488', range:[29,31] },
    ],
    activities: [
      { num: 1, name:'Link 1 Upgrade',                       pillar:'P1' },
      { num: 2, name:'Link 2 Upgrade',                       pillar:'P1' },
      { num: 4, name:'Distribution Layer',                   pillar:'P1' },
      { num: 5, name:'Infra Monitoring',                     pillar:'P1' },
      { num: 7, name:'Radio Upgrade',                        pillar:'P1' },
      { num: 8, name:'Coverage Improvement',                 pillar:'P1' },
      { num: 9, name:'DC Standardization',                   pillar:'P1' },
      { num:10, name:'Fire Suppression',                     pillar:'P1' },
      { num:11, name:'Weekly IT Meeting',                    pillar:'P2' },
      { num:12, name:'Cost Review',                          pillar:'P2' },
      { num:13, name:'Dept Meeting',                         pillar:'P2' },
      { num:15, name:'Toolbox / Awareness',                  pillar:'P2' },
      { num:17, name:'EUS Survey',                           pillar:'P2' },
      { num:18, name:'Stakeholder Workshop',                 pillar:'P2' },
      { num:19, name:'Projects',                             pillar:'P2' },
      { num:20, name:'Incident Review',                      pillar:'P3' },
      { num:21, name:'Backup Test',                          pillar:'P3' },
      { num:22, name:'Changes Review',                       pillar:'P3' },
      { num:23, name:'Bi-Weekly CAB',                        pillar:'P3' },
      { num:24, name:'Daily Check',                          pillar:'P3' },
      { num:25, name:'Inspection',                           pillar:'P3' },
      { num:28, name:'Access Review',                        pillar:'P3' },
      { num:29, name:'Coaching',                             pillar:'P4' },
      { num:30, name:'People Assessment',                    pillar:'P4' },
      { num:31, name:'Annual Review',                        pillar:'P4' },
    ],
    // Score per site×activity. Designed so HGO trends green (best site),
    // ITY trends red (watch site), MGO green/amber mix, SML/SGO mixed.
    cells: {
      HGO: { 1:100, 2:0,   4:50,  5:100, 7:50,  8:100, 9:0,   10:50, 11:90, 12:60,  13:100, 15:80, 17:50,  18:17, 19:67, 20:100, 21:0,  22:80, 23:80,  24:95, 25:60, 28:40, 29:80, 30:50, 31:100 },
      MGO: { 1:100, 2:50,  4:100, 5:100, 7:100, 8:100, 9:50,  10:100,11:100,12:80,  13:100, 15:80, 17:75,  18:50, 19:67, 20:100, 21:50, 22:80, 23:100, 24:95, 25:60, 28:80, 29:80, 30:50, 31:100 },
      SML: { 1:50,  2:0,   4:50,  5:67,  7:50,  8:100, 9:0,   10:50, 11:90, 12:60,  13:100, 15:80, 17:0,   18:33, 19:50, 20:80,  21:0,  22:60, 23:80,  24:90, 25:60, 28:60, 29:80, 30:50, 31:100 },
      SGO: { 1:50,  2:0,   4:50,  5:67,  7:50,  8:50,  9:0,   10:50, 11:90, 12:40,  13:100, 15:60, 17:50,  18:17, 19:50, 20:80,  21:0,  22:60, 23:80,  24:85, 25:40, 28:40, 29:60, 30:0,  31:0   },
      ITY: { 1:0,   2:0,   4:0,   5:67,  7:0,   8:50,  9:0,   10:0,  11:75, 12:20,  13:80,  15:40, 17:0,   18:17, 19:50, 20:80,  21:0,  22:40, 23:60,  24:80, 25:40, 28:20, 29:60, 30:0,  31:100 },
    },
  },

  // ── ACTIVITIES catalog — master list (parametrable) ────────────────
  // The catalog is the parametrable source of truth — every other tab
  // derives from it. Editable by super_admin via Settings.
  activitiesCatalog: [
    // ── P1 Network Infrastructure ──
    { num: 1, pillar:'P1', name:'Link 1 Upgrade',                       kpi:'BOOLEAN', weight:12, scope:'all',      target:'Done', desc:'Primary WAN/SD-WAN link upgraded to current generation hardware + capacity.' },
    { num: 2, pillar:'P1', name:'Link 2 Upgrade',                       kpi:'BOOLEAN', weight: 8, scope:'all',      target:'Done', desc:'Secondary diverse-path WAN link upgraded; failover proven.' },
    { num: 4, pillar:'P1', name:'Distribution Layer Standardization',   kpi:'BOOLEAN', weight:12, scope:'all',      target:'Done', desc:'Convergence to Group standard distribution switches + uniform config templates.' },
    { num: 5, pillar:'P1', name:'Local Infrastructure Monitoring',      kpi:'COUNT',   weight: 8, scope:'all',      target:3,      desc:'Number of independent monitoring agents (NMS, APM, OOB) actively reporting from site.' },
    { num: 7, pillar:'P1', name:'Radio Infrastructure Upgrade',         kpi:'BOOLEAN', weight:12, scope:'mine',     target:'Done', desc:'Operational radio (VHF/UHF/DMR/TETRA) backbone refresh + repeater coverage validated.' },
    { num: 8, pillar:'P1', name:'Coverage & Capacity Improvement',      kpi:'BOOLEAN', weight:12, scope:'all',      target:'Done', desc:'Plant + camp + pit coverage uplift to remove documented dead zones.' },
    { num: 9, pillar:'P1', name:'Resilience & DC Standardization',      kpi:'BOOLEAN', weight:12, scope:'all',      target:'Done', desc:'Dual-PSU, dual-UPS, redundant cooling, gas suppression — Group DC standard.' },
    { num:10, pillar:'P1', name:'Centralized Fire Suppression System',  kpi:'BOOLEAN', weight: 8, scope:'all',      target:'Done', desc:'FM-200 / Novec / Inergen suppression + central monitoring + service certificates current.' },
    // ── P2 Business Partnering ──
    { num:11, pillar:'P2', name:'Weekly IT Meeting',                    kpi:'COUNT',   weight: 8, scope:'all',      target:4,      desc:'Internal IT-team weekly stand-up, minimum 4/month.' },
    { num:12, pillar:'P2', name:'Monthly / Quarterly Cost Review',      kpi:'COUNT',   weight: 8, scope:'all',      target:1,      desc:'IT cost review with site finance partner, monthly.' },
    { num:13, pillar:'P2', name:'Monthly Department Meeting',           kpi:'COUNT',   weight:13, scope:'all',      target:1,      desc:'IT engages with each mine/plant department once per month — feeds the Meetings module.' },
    { num:15, pillar:'P2', name:'Toolbox & Awareness Campaigns',        kpi:'COUNT',   weight: 8, scope:'all',      target:1,      desc:'IT-led safety / awareness toolbox sessions for site staff.' },
    { num:17, pillar:'P2', name:'End-User Satisfaction Survey',         kpi:'COUNT',   weight: 8, scope:'all-shared',target:'',    desc:'IT Survey run via Zoho — concerns flow into Meetings module.' , shared:true },
    { num:18, pillar:'P2', name:'Stakeholder Management Workshops',     kpi:'COUNT',   weight: 8, scope:'all',      target:1,      desc:'Workshop-style stakeholder engagement with department heads.' },
    { num:19, pillar:'P2', name:'IT Project / Initiatives',             kpi:'COUNT',   weight:17, scope:'all',      target:1,      desc:'Active IT projects on the site portfolio.' },
    // ── P3 Risk & Compliance ──
    { num:20, pillar:'P3', name:'Risk & Major Incident Review',         kpi:'COUNT',   weight:10, scope:'all',      target:1,      desc:'Major-incident retrospective + risk register review, monthly.' },
    { num:21, pillar:'P3', name:'Quarterly Backup / Restore Test',      kpi:'COUNT',   weight:10, scope:'all',      target:'',     desc:'Documented restore-test of one critical system, every quarter.' },
    { num:22, pillar:'P3', name:'Monthly Changes Review',               kpi:'COUNT',   weight:10, scope:'all',      target:1,      desc:'Review of all changes implemented in the month (closure quality + drift).' },
    { num:23, pillar:'P3', name:'Bi-Weekly CAB',                        kpi:'COUNT',   weight:10, scope:'all-shared',target:2,     desc:'Change Advisory Board, fortnightly (Group-shared).', shared:true },
    { num:24, pillar:'P3', name:'Daily Check',                          kpi:'COUNT',   weight:10, scope:'all',      target:30,     desc:'Documented daily systems-health check (servers, network, backup).' },
    { num:25, pillar:'P3', name:'Monthly Inspection',                   kpi:'COUNT',   weight:10, scope:'all',      target:1,      desc:'IT site inspection via the Inspection module.' },
    { num:28, pillar:'P3', name:'Monthly Access Review',                kpi:'COUNT',   weight:10, scope:'all',      target:1,      desc:'Privileged-access review + leaver-cleanup, monthly.' },
    // ── P4 People ──
    { num:29, pillar:'P4', name:'Monthly Mentoring / Coaching Session', kpi:'COUNT',   weight:45, scope:'all',      target:1,      desc:'Site IT Lead runs at least one structured mentoring session per month.' },
    { num:30, pillar:'P4', name:'Quarterly People Assessment',          kpi:'COUNT',   weight:30, scope:'all',      target:'',     desc:'Documented assessment of team member, quarterly.' },
    { num:31, pillar:'P4', name:'Mid Year and Yearly Review',           kpi:'COUNT',   weight:25, scope:'all',      target:'',     desc:'Mid-year + end-of-year people-performance review.' },
  ],

  // ── TARGETS — per-site overrides ───────────────────────────────────
  // Default targets come from activitiesCatalog. The targets view lets a
  // super_admin override per site (e.g. ITY runs a higher daily-check
  // bar). Each entry: site → { num: customTarget | null }. Null means
  // "use catalog default".
  targets: {
    perSite: {
      HGO: { 24: 30, 11: 4 },
      MGO: { 24: 28, 11: 4 },
      SML: { 24: 28, 11: 4 },
      SGO: { 24: 28 },
      ITY: { 24: 30, 11: 4 },
    },
    lastEditedBy: 'Cezar MARIN · super_admin',
    lastEditedAt: '2026-04-10 14:08',
  },

  // ── ROADMAP — 12-month Gantt ───────────────────────────────────────
  // Swimlanes grouped by pillar. Each bar carries a site code so the
  // user can see WHO is delivering WHAT in any given month.
  roadmap: {
    year:   2026,
    months: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    today:  { month: 4 }, // 0-indexed, May = index 4
    swimlanes: [
      { id:'P1', name:'Network Infrastructure', color:'#145FAE', items: [
        { name:'HGO · Link 1 Upgrade',                    site:'HGO', start:0,  end:4,  status:'done',        owner:'B. Sawadogo'   },
        { name:'HGO · Distribution Layer Standardization',site:'HGO', start:2,  end:7,  status:'in_progress', owner:'B. Sawadogo'   },
        { name:'MGO · Link 2 + Coverage Uplift',          site:'MGO', start:1,  end:5,  status:'done',        owner:'F. Kaboré'     },
        { name:'SGO · Radio Repeater Refresh',            site:'SGO', start:4,  end:9,  status:'in_progress', owner:'M. Diop'       },
        { name:'ITY · DC Standardization (gas + UPS)',    site:'ITY', start:3,  end:11, status:'in_progress', owner:'A. Coulibaly'  },
        { name:'SML · Fire Suppression Recommission',     site:'SML', start:5,  end:8,  status:'planned',     owner:'K. Touré'      },
        { name:'Group · OOB Mgmt Rollout',                site:'all', start:6,  end:11, status:'planned',     owner:'Cezar MARIN'   },
      ]},
      { id:'P2', name:'Business Partnering', color:'#EF631A', items: [
        { name:'All sites · Monthly Dept Meetings cadence',site:'all',start:0,  end:11, status:'in_progress', owner:'Site IT Leads' },
        { name:'IT Survey Q1',                            site:'all', start:2,  end:3,  status:'done',        owner:'L. Traoré'     },
        { name:'IT Survey Q2',                            site:'all', start:5,  end:6,  status:'planned',     owner:'L. Traoré'     },
        { name:'Stakeholder Workshop · HGO Mining',       site:'HGO', start:1,  end:1,  status:'done',        owner:'B. Sawadogo'   },
        { name:'IT Cost Review cadence',                  site:'all', start:0,  end:11, status:'in_progress', owner:'P.D. Ouattara' },
      ]},
      { id:'P3', name:'Risk & Compliance', color:'#7C3AED', items: [
        { name:'Q1 Backup Restore Test',                  site:'all', start:2,  end:2,  status:'done',        owner:'Cezar MARIN'   },
        { name:'Q2 Backup Restore Test',                  site:'all', start:5,  end:5,  status:'planned',     owner:'Cezar MARIN'   },
        { name:'Bi-Weekly CAB cadence',                   site:'all', start:0,  end:11, status:'in_progress', owner:'CAB owners'    },
        { name:'Privileged Access Audit',                 site:'all', start:6,  end:8,  status:'planned',     owner:'Cezar MARIN'   },
        { name:'Veeam → Rubrik vault refresh',            site:'all', start:7,  end:11, status:'planned',     owner:'Cezar MARIN'   },
        { name:'ISO 27001 Pre-Audit',                     site:'all', start:9,  end:10, status:'planned',     owner:'Cezar MARIN'   },
      ]},
      { id:'P4', name:'People Management', color:'#0D9488', items: [
        { name:'Mentoring cadence — all sites',           site:'all', start:0,  end:11, status:'in_progress', owner:'Site IT Leads' },
        { name:'Mid-Year Reviews',                        site:'all', start:5,  end:6,  status:'planned',     owner:'Cezar MARIN'   },
        { name:'Skills Matrix Refresh',                   site:'all', start:8,  end:9,  status:'planned',     owner:'HR · Cezar'    },
        { name:'End-of-Year Reviews',                     site:'all', start:11, end:11, status:'planned',     owner:'Cezar MARIN'   },
      ]},
    ],
  },
};
