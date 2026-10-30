'use strict';
// SDP360 — ONE place for KPI value types and RAG (Red / Amber / Green) policies.
//
// WHY: the inherited platform carries at least five different RAG cut-off sets, each hard-coded
// in its own module (tracker engine 90/75, exec summary 70/50, siteScore & deck v2 70/45,
// composite & siteScoreboard 75/55) and the tracker bands are duplicated between
// public/activity-tracker/engine.js and tracker-pptx.js ("edit both"). The Expert Review
// Committee owns these numbers; this registry makes them DATA the committee can version
// (tracker_rag_policies / kpi_types tables) instead of code only a developer can change.
//
// UMD-style export so the same file runs in the browser (future dashboard widgets) and on the
// server (PPTX, reports), exactly like public/lib/statusTransfer.js.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KpiRag = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  // Value types a tracker activity or dashboard metric may carry.
  //   aggregate : how monthly inputs roll up into one period value
  //   attainment: how the rolled-up value compares to its target → ratio in [0, +inf)
  //   proRata   : whether the target is pro-rated by elapsed months (COUNT-style targets)
  const KPI_TYPES = {
    BOOLEAN:   { label: 'Done / Not done',  aggregate: 'max',  attainment: 'ratio',  proRata: false, defaultTarget: 1 },
    COUNT:     { label: 'Count vs target',  aggregate: 'sum',  attainment: 'ratio',  proRata: true,  defaultTarget: null },
    PERCENT:   { label: 'Percentage',       aggregate: 'avg',  attainment: 'ratio',  proRata: false, defaultTarget: 100 },
    MILESTONE: { label: 'Milestone phase',  aggregate: 'last', attainment: 'ratio',  proRata: false, defaultTarget: null },
    CURRENCY:  { label: 'Amount vs budget', aggregate: 'sum',  attainment: 'ratio',  proRata: false, defaultTarget: null },
    RATING:    { label: 'Rating 1-5',       aggregate: 'avgNonZero', attainment: 'ratio', proRata: false, defaultTarget: 4 },
    DURATION:  { label: 'Duration (lower is better)', aggregate: 'avg', attainment: 'inverse', proRata: false, defaultTarget: null },
  };

  // Named RAG policies. `green`/`amber` are attainment ratios (1.0 = 100 % of target) unless
  // `scale` is 'points' (0-100 scores such as the site scoreboard).
  // The inherited cut-offs are registered verbatim so every module can be migrated WITHOUT a
  // visible change, then the committee can converge them deliberately (see roadmap Phase 2).
  const POLICIES = {
    'tracker-activity':  { scale: 'ratio',  green: 0.90, amber: 0.75, source: 'public/activity-tracker/engine.js' },
    'tracker-executive': { scale: 'ratio',  green: 0.70, amber: 0.50, source: 'engine.js executive summary bands' },
    'site-score':        { scale: 'points', green: 70,   amber: 45,   source: 'services/siteScore.js + deckGovernanceV2.js' },
    'site-composite':    { scale: 'points', green: 75,   amber: 55,   source: 'services/siteComposite.js + siteScoreboard.js' },
    'sla-percent':       { scale: 'points', green: 90,   amber: 70,   source: 'docs/EXEC_PPTX_CHART_AUDIT.md CSAT bands' },
    'tracker-boolean':   { scale: 'ratio',  green: 1.0,  amber: 0.5,  source: 'engine.js BOOLEAN done / in progress' },
    'kpi-target':        { scale: 'target-ratio', green: 1.0, amber: 0.9, source: 'services/kpiTargets.js — value vs the per-site KPI target (committee #40)' },
  };

  function aggregate(values, type) {
    const t = KPI_TYPES[type] || KPI_TYPES.COUNT;
    const nums = (values || []).map(Number).filter((v) => Number.isFinite(v));
    if (!nums.length) return 0;
    switch (t.aggregate) {
      case 'max': return Math.max(...nums);
      case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
      case 'avgNonZero': { const nz = nums.filter((v) => v !== 0); return nz.length ? nz.reduce((a, b) => a + b, 0) / nz.length : 0; }
      case 'last': return nums[nums.length - 1];
      case 'sum':
      default: return nums.reduce((a, b) => a + b, 0);
    }
  }

  /**
   * Attainment ratio of a value against a target.
   * @param {number} value
   * @param {number|null} target
   * @param {string} type           - KPI type key
   * @param {object} [ctx]
   * @param {number} [ctx.elapsed]  - months elapsed within the activity span (for pro-rata)
   * @param {number} [ctx.span]     - total months in the activity span
   * @returns {number|null}  null when it cannot be computed (no target, not started)
   */
  function attainment(value, target, type, ctx = {}) {
    const t = KPI_TYPES[type] || KPI_TYPES.COUNT;
    let tgt = target == null || target === '' ? t.defaultTarget : Number(target);
    if (tgt == null || !Number.isFinite(tgt)) return null;
    if (t.proRata && ctx.span > 0) {
      if (!(ctx.elapsed > 0)) return null;             // not started yet → N/A, never RED
      tgt = tgt * Math.min(1, ctx.elapsed / ctx.span);
    }
    if (tgt === 0) return null;                        // division by zero → AMBER by policy below
    const v = Number(value) || 0;
    if (t.attainment === 'inverse') return v === 0 ? Infinity : tgt / v;
    return v / tgt;
  }

  /**
   * Map an attainment ratio (or a 0-100 score) to a RAG colour under a policy.
   * @returns {'GREEN'|'AMBER'|'RED'|'NA'}
   */
  function rag(x, policy = 'tracker-activity', overrides) {
    const p = Object.assign({}, typeof policy === 'string' ? POLICIES[policy] : policy, overrides || {});
    if (!p || p.green == null) throw new Error('rag(): unknown policy ' + policy);
    if (x === null || x === undefined || Number.isNaN(x)) return 'NA';
    if (x >= p.green) return 'GREEN';
    if (x >= p.amber) return 'AMBER';
    return 'RED';
  }

  // Register or override a policy at runtime (loaded from tracker_rag_policies).
  function definePolicy(name, def) {
    if (!name || typeof def !== 'object' || !(def.green > def.amber)) throw new Error('definePolicy: green must exceed amber');
    POLICIES[name] = Object.assign({ scale: 'ratio' }, def);
    return POLICIES[name];
  }

  return { KPI_TYPES, POLICIES, aggregate, attainment, rag, definePolicy };
}));
