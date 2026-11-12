'use strict';
// R2-WB-06 (REBUILD-SPEC R5) — controlled roadmap publication (Roadmap Manager → portfolio), PURE (no I/O).
// The migration plan itself is built by POST /api/governance/roadmap-migration (routes/governance.js); this module
// finds what would be published twice, before anything is written:
//   duplicates(plan, { existingObjectiveKeys }) → { count, objectives: [{ key, name, reason }], deliverables: [{ objective_key, name, reason }] }
//     objective: 'exists'   — the key is already used by a portfolio objective (live or soft-deleted: keys are unique)
//                'repeated' — the same key twice in the source
//     deliverable: 'repeated' — the same name (normalised like roadmapParity.norm: accents, case, spaces) earlier in the
//                  plan (same objective or another one)
//   withoutDuplicates(plan, dups) → the plan with every reported objective and repeated deliverable left out (the
//     first occurrence of a name is kept). Used only with ?skip_duplicates=1 — otherwise the apply is refused.
const { norm } = require('./roadmapParity');

function duplicates(plan, { existingObjectiveKeys = [] } = {}) {
  const existing = new Set((existingObjectiveKeys || []).map(String));
  const objectives = [], deliverables = [], seenKey = new Set(), seenName = new Map();
  for (const o of (plan && plan.objectives) || []) {
    if (existing.has(String(o.key))) objectives.push({ key: o.key, name: o.name, reason: 'exists' });
    else if (seenKey.has(String(o.key))) objectives.push({ key: o.key, name: o.name, reason: 'repeated' });
    seenKey.add(String(o.key));
    for (const d of o.deliverables || []) {
      const k = norm(d.name);
      if (!k) continue;
      if (seenName.has(k)) deliverables.push({ objective_key: o.key, name: d.name, reason: 'repeated', first_in: seenName.get(k) });
      else seenName.set(k, o.key);
    }
  }
  return { count: objectives.length + deliverables.length, objectives, deliverables };
}

function withoutDuplicates(plan, dups) {
  const dropObj = new Set(), out = [];
  const seen = new Set();
  // drop the reported objectives (an 'exists' key entirely; a 'repeated' key = every occurrence after the first)
  const keyCount = new Map();
  for (const o of plan.objectives || []) {
    const n = (keyCount.get(o.key) || 0) + 1; keyCount.set(o.key, n);
    const exists = (dups.objectives || []).some((x) => x.key === o.key && x.reason === 'exists');
    if (exists || n > 1) { dropObj.add(o); continue; }
    const dels = (o.deliverables || []).filter((d) => { const k = norm(d.name); if (!k) return true; if (seen.has(k)) return false; seen.add(k); return true; });
    out.push({ ...o, deliverables: dels });
  }
  return { ...plan, objectives: out };
}

module.exports = { duplicates, withoutDuplicates };
