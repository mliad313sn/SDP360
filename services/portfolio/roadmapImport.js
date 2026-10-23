'use strict';
// Step 8 — copy of a person's ITSM Roadmap (Roadmap Manager: roadmap_objectives + roadmap_deliverables) into the
// portfolio, as: programme "Roadmap ITSM" → one objective per roadmap objective → one project "Livrables" → one
// milestone per deliverable. A COPY, run on request (DEC-8.4 / DEC-6.3: the roadmap is its author's tool): the
// Roadmap Manager keeps working; running the import again refreshes the copy in place (stable ids).

const STATUS_OBJ = { green: 'on_track', orange: 'at_risk', amber: 'at_risk', red: 'late', done: 'done' };
const CONF = { high: 80, medium: 50, low: 25 };
const STATUS_DEL = { done: 'done', todo: 'not_started', doing: 'on_track', in_progress: 'on_track', blocked: 'at_risk', cancelled: 'cancelled' };

/** Pure: nodes (with stable ids) from the Roadmap Manager rows. */
function toNodes({ objectives, deliverables }, userId) {
  const P = `RM-${userId}`;
  const nodes = [{ id: P, parent_id: null, kind: 'programme', title: 'Roadmap ITSM', status: 'on_track', position: 0 }];
  (objectives || []).forEach((o, i) => {
    const oid = `${P}-${o.obj_key}`;
    nodes.push({ id: oid, parent_id: P, kind: 'objective', title: o.title || o.obj_key, status: STATUS_OBJ[String(o.status || '').toLowerCase()] || 'not_started',
      confidence: CONF[String(o.confidence || '').toLowerCase()] ?? null, due_date: o.target_date || null, risk: o.gap_note || null, position: Number(o.sort_order) || i });
    const dels = (deliverables || []).filter(d => d.obj_key === o.obj_key);
    if (!dels.length) return;
    const pid = `${oid}-livrables`;
    const dates = dels.map(d => d.delivery_date).filter(Boolean).sort();
    nodes.push({ id: pid, parent_id: oid, kind: 'project', title: `Livrables — ${o.title || o.obj_key}`, status: dels.every(d => d.status === 'done') ? 'done' : 'on_track',
      start_date: null, due_date: dates[dates.length - 1] || null, position: 0 });
    dels.forEach((d, k) => nodes.push({ id: `${P}-d-${d.uid}`, parent_id: pid, kind: 'milestone', title: d.label || '—', status: STATUS_DEL[String(d.status || '').toLowerCase()] || 'not_started',
      due_date: d.delivery_date || null, done_date: d.status === 'done' ? (d.delivery_date || null) : null, risk: d.notes || null, position: Number(d.sort_order) || k }));
  });
  return nodes;
}

/** Write the copy (insert or refresh by id). */
async function importRoadmap(rdb, userId, by) {
  const store = require('./store');
  const src = await rdb.getRoadmap(userId);
  const nodes = toNodes(src, userId);
  let created = 0, updated = 0;
  for (const n of nodes) {
    const exists = await store.get(n.id);
    const v = await store.validate(n, { existing: exists || null });
    if (v.errors.length) throw new Error(`${n.id}: ${v.errors.join(' ; ')}`);
    if (exists) { await store.save(n.id, { ...v.node, baseline_due: exists.baseline_due || v.node.baseline_due }, by); updated++; }
    else { await store.save(n.id, v.node, by, { create: true }); created++; }
  }
  return { programme: `RM-${userId}`, created, updated, nodes: nodes.length };
}

module.exports = { toNodes, importRoadmap };
