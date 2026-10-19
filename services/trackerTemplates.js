'use strict';
// Step 7 — shipped tracker templates (doc 08 §9.8): a business user starts from one of these in
// the builder instead of an empty form. Seeded as DRAFTS (never published automatically — a
// template has no units of its own until the sponsor picks the sites/teams).
// Items bound to the KPI dictionary carry `source.metric`; the others are manual entry.

const SITES = [{ code: 'SGO', name: 'Sabodala' }, { code: 'HGO', name: 'Houndé' }, { code: 'MGO', name: 'Mana' }, { code: 'SMI', name: 'Ity' }, { code: 'SML', name: 'Lafigué' }];
const year = () => String(new Date().getUTCFullYear() + 1);
const monthly = (count = 12) => ({ kind: 'monthly', start: year(), count });
const I = (code, name, kpiType, weight, extra = {}) => ({ code, name, kpiType, weight, start: 1, end: 12, shared: false, target: null, source: null, ...extra });

const TEMPLATES = [
  {
    key: 'tpl-field-dispatch', name: 'Field dispatch (template)', version: 1, period: monthly(), units: SITES, ragPolicy: 'tracker-activity',
    groups: [
      { code: 'G1', name: 'Dispatch volume', weight: 0.4, items: [I('G1-01', 'Field visits completed', 'COUNT', 1, { target: 24 }), I('G1-02', 'Emergency call-outs', 'COUNT', 1, { target: 12 })] },
      { code: 'G2', name: 'Quality', weight: 0.6, items: [I('G2-01', 'Visits closed with report', 'PERCENT', 1, { target: 100 }), I('G2-02', 'User rating', 'RATING', 1, { target: 4 })] },
    ],
  },
  {
    key: 'tpl-hardware-deployment', name: 'Hardware deployment (template)', version: 1, period: monthly(), units: SITES, ragPolicy: 'tracker-activity',
    groups: [
      { code: 'G1', name: 'Roll-out', weight: 0.5, items: [I('G1-01', 'Workstations deployed', 'COUNT', 1, { target: 60 }), I('G1-02', 'Deployment plan signed', 'BOOLEAN', 1, { end: 3 })] },
      { code: 'G2', name: 'Register hygiene', weight: 0.5, items: [I('G2-01', 'Assets in register', 'COUNT', 1, { source: { metric: 'assets.total' } }), I('G2-02', 'Register completeness', 'PERCENT', 1, { target: 95, source: { metric: 'assets.completeness_pct' } })] },
    ],
  },
  {
    key: 'tpl-site-maintenance', name: 'Site maintenance (template)', version: 1, period: monthly(), units: SITES, ragPolicy: 'tracker-activity',
    groups: [
      { code: 'G1', name: 'Inspections', weight: 0.5, items: [I('G1-01', 'Inspections done', 'COUNT', 1, { target: 12, source: { metric: 'inspection.count' } }), I('G1-02', 'Checklist conformity', 'PERCENT', 1, { target: 90, source: { metric: 'inspection.conformity_pct' } })] },
      { code: 'G2', name: 'Preventive work', weight: 0.5, items: [I('G2-01', 'UPS tests', 'COUNT', 1, { target: 12 }), I('G2-02', 'Datacentre cleaning', 'COUNT', 1, { target: 4 })] },
    ],
  },
  {
    key: 'tpl-meetings-compliance', name: 'Meetings compliance (template)', version: 1, period: monthly(), units: SITES, ragPolicy: 'tracker-activity',
    groups: [
      { code: 'G1', name: 'Cadence', weight: 0.5, items: [I('G1-01', 'Department reviews held', 'COUNT', 1, { target: 36, source: { metric: 'meetings.pvs_held' } })] },
      { code: 'G2', name: 'Engagements', weight: 0.5, items: [I('G2-01', 'Diffused within 48 h', 'PERCENT', 1, { target: 100, source: { metric: 'meetings.diffused_48h_pct' } }), I('G2-02', 'Actions with a champion', 'PERCENT', 1, { target: 100, source: { metric: 'meetings.champion_pct' } })] },
    ],
  },
];

module.exports = { TEMPLATES };
