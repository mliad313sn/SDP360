'use strict';
// PORTFOLIO LOT 6 — store of the structured dependencies, demand lines, effort factors, residual risk and project
// documents (migration 130). Same handle shape as services/governanceStore; every write leaves a hash-chained ppm_events
// row through the governance store's ppmEvent (entity 'project'). No amount is ever written here or to the ledger.
// The routes (routes/governancePortfolioPhase2.js) decide the switches and the access rules; the pure rules live in
// structuredDependencies.js / resourceDemand.js / effortScoring.js / riskExposure.js / projectDocuments.js.
// Readers always filter deleted_at (tests/soft-delete-readers.test.js).
const crypto = require('crypto');
const SD = require('./structuredDependencies');
const RD = require('./resourceDemand');
const ES = require('./effortScoring');
const RX = require('./riskExposure');
const PD = require('./projectDocuments');

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const J = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch (_) { return d; } };
const who = (u) => (u ? String(u.full_name || u.username || '') : null);
const uid = (u) => (u && u.id != null ? Number(u.id) : null);
const ids = (list) => [...new Set((list || []).map(Number).filter(Number.isInteger))];
const inList = (list) => list.map(() => '?').join(',');
const nf = (what) => Object.assign(new Error(what + ' not found'), { code: 'NOT_FOUND', status: 404 });

function makePhase2Store(db, gov, { now = () => new Date().toISOString(), blobStore = require('../blobStore') } = {}) {
  if (!db || !gov) throw new Error('phase-2 store needs a db handle and the governance store');
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (typeof db.runTransaction === 'function' ? db.runTransaction(fn) : fn());
  const ev = (pid, action, field, oldV, newV, user, note) => gov.ppmEvent({ entity: 'project', entity_id: Number(pid), action, field, old_value: oldV, new_value: newV, note: note || null }, user);

  // ---- §12 dependencies --------------------------------------------------------------------------------------
  const depRow = (r) => r && { ...r, id: Number(r.id), project_id: Number(r.project_id), predecessor_project_id: r.predecessor_project_id == null ? null : Number(r.predecessor_project_id) };
  async function listDependencies(projectIds) {
    const l = ids(projectIds); if (!l.length) return [];
    return (await P(`SELECT * FROM ppm_project_dependencies WHERE deleted_at IS NULL AND project_id IN (${inList(l)}) ORDER BY project_id, id`).all(...l)).map(depRow);
  }
  async function dependency(id) { return depRow(await P(`SELECT * FROM ppm_project_dependencies WHERE id=? AND deleted_at IS NULL`).get(Number(id))); }
  /** Every live project→project edge (the whole portfolio: a loop through a project the reader cannot see is still a loop). */
  // P11 R5-1 — { includeDeletedProjects:true } (the loop check of saveDependency) also counts the edges of a SOFT-deleted
  // project: an admin can restore it, and restoring must never close a loop that was refused while it was live.
  async function allEdges({ includeDeletedProjects = false } = {}) {
    const live = includeDeletedProjects ? '' : ' AND a.deleted_at IS NULL', liveB = includeDeletedProjects ? '' : ' AND b.deleted_at IS NULL';
    return (await P(`SELECT d.project_id, d.predecessor_project_id FROM ppm_project_dependencies d JOIN portfolio_projects a ON a.id = d.project_id${live}
      JOIN portfolio_projects b ON b.id = d.predecessor_project_id${liveB} WHERE d.deleted_at IS NULL AND d.predecessor_project_id IS NOT NULL AND d.status <> 'cancelled'`).all())
      .map((r) => ({ from: Number(r.project_id), to: Number(r.predecessor_project_id) }));
  }
  async function saveDependency(projectId, body, { user, id = null } = {}) {
    const n = SD.normalise(body, { projectId });
    return tx(async () => {
      // P11 R5-1 — one writer at a time on the portfolio dependency graph: two opposite links sent together would each
      // read the graph without the other and both pass the loop check (write skew under READ COMMITTED).
      await P('SELECT pg_advisory_xact_lock(hashtext(?))').get('ppm:project-dependency-graph');
      if (n.predecessor_project_id != null) {
        const edges = (await allEdges({ includeDeletedProjects: true })).filter((e) => !(id != null && e.from === Number(projectId)));   // an update re-checks without its own old edge
        if (id != null) for (const d of await listDependencies([projectId])) if (d.id !== Number(id) && d.predecessor_project_id != null && d.status !== 'cancelled') edges.push({ from: d.project_id, to: d.predecessor_project_id });
        if (n.status !== 'cancelled' && SD.wouldCreateCycle(edges, Number(projectId), n.predecessor_project_id)) throw Object.assign(new Error('this dependency would create a loop between projects'), { code: 'CONFLICT', reason: 'DEP_CYCLE', status: 409 });
      }
      const ts = now();
      if (id != null) {
        const ex = await dependency(id); if (!ex || ex.project_id !== Number(projectId)) throw nf('dependency');
        await P(`UPDATE ppm_project_dependencies SET predecessor_project_id=?, external_category=?, description=?, owner=?, status=?, target_date=?, criticality=?, updated_at=? WHERE id=?`)
          .run(n.predecessor_project_id, n.external_category, n.description, n.owner, n.status, n.target_date, n.criticality, ts, Number(id));
        await ev(projectId, 'dependency_updated', `dependency:${id}`, ex.status, n.status, user);
        return Number(id);
      }
      const r = await P(`INSERT INTO ppm_project_dependencies (project_id, predecessor_project_id, external_category, description, owner, status, target_date, criticality, created_by, created_by_name, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id`)
        .get(Number(projectId), n.predecessor_project_id, n.external_category, n.description, n.owner, n.status, n.target_date, n.criticality, uid(user), who(user), ts);
      await ev(projectId, 'dependency_added', `dependency:${r.id}`, null, n.predecessor_project_id != null ? `project:${n.predecessor_project_id}` : `external:${n.external_category}`, user);
      return Number(r.id);
    });
  }
  async function deleteDependency(id, { user } = {}) {
    return tx(async () => { const ex = await dependency(id); if (!ex) throw nf('dependency'); await P(`UPDATE ppm_project_dependencies SET deleted_at=? WHERE id=?`).run(now(), Number(id)); await ev(ex.project_id, 'dependency_removed', `dependency:${id}`, ex.status, null, user); return ex; });
  }
  /** Backfill (tools/ppm/backfill-project-dependencies.js): the legacy depends_on entries not yet present as rows. */
  async function backfillPlan() {
    const projects = (await P(`SELECT id, key, depends_on FROM portfolio_projects WHERE deleted_at IS NULL ORDER BY id`).all()).map((p) => ({ ...p, id: Number(p.id) }));
    const existing = (await P(`SELECT project_id, predecessor_project_id, description FROM ppm_project_dependencies WHERE deleted_at IS NULL`).all()).map(depRow);
    return SD.backfillPlan(projects, existing);
  }

  // ---- §17 demand ---------------------------------------------------------------------------------------------
  const demRow = (r) => r && { ...r, id: Number(r.id), project_id: Number(r.project_id), avg_fte: num(r.avg_fte), peak_fte: num(r.peak_fte) };
  async function listDemand(projectIds) {
    const l = ids(projectIds); if (!l.length) return [];
    return (await P(`SELECT * FROM ppm_project_demand WHERE deleted_at IS NULL AND project_id IN (${inList(l)}) ORDER BY project_id, id`).all(...l)).map(demRow);
  }
  /** P11 R5-3 — ids of every live project (of a live chain) that carries live demand: the group's demand, for any reader. */
  async function demandProjectIds() {
    return (await P(`SELECT DISTINCT d.project_id FROM ppm_project_demand d JOIN portfolio_projects p ON p.id = d.project_id AND p.deleted_at IS NULL
      JOIN portfolio_objectives o ON o.id = p.objective_id AND o.deleted_at IS NULL JOIN portfolio_programmes g ON g.id = o.programme_id AND g.deleted_at IS NULL
      WHERE d.deleted_at IS NULL`).all()).map((r) => Number(r.project_id));
  }
  async function demandLine(id) { return demRow(await P(`SELECT * FROM ppm_project_demand WHERE id=? AND deleted_at IS NULL`).get(Number(id))); }
  async function saveDemand(projectId, body, { user, id = null } = {}) {
    const n = RD.normalise(body);
    return tx(async () => {
      const ts = now();
      if (id != null) {
        const ex = await demandLine(id); if (!ex || ex.project_id !== Number(projectId)) throw nf('demand line');
        await P(`UPDATE ppm_project_demand SET skill=?, avg_fte=?, peak_fte=?, start_month=?, finish_month=?, sourcing=?, owner=?, notes=?, updated_at=? WHERE id=?`)
          .run(n.skill, n.avg_fte, n.peak_fte, n.start_month, n.finish_month, n.sourcing, n.owner, n.notes, ts, Number(id));
        await ev(projectId, 'demand_updated', `demand:${id}`, `${ex.skill} ${ex.avg_fte ?? '—'}/${ex.peak_fte ?? '—'}`, `${n.skill} ${n.avg_fte ?? '—'}/${n.peak_fte ?? '—'}`, user);
        return Number(id);
      }
      const c = await P(`SELECT COUNT(*) AS n FROM ppm_project_demand WHERE project_id=? AND deleted_at IS NULL`).get(Number(projectId));
      if (Number(c.n) >= RD.MAX_LINES) throw Object.assign(new Error(`at most ${RD.MAX_LINES} demand lines per project`), { code: 'INVALID', reason: 'DEMAND_LIMIT', status: 400 });
      const r = await P(`INSERT INTO ppm_project_demand (project_id, skill, avg_fte, peak_fte, start_month, finish_month, sourcing, owner, notes, created_by, created_by_name, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`)
        .get(Number(projectId), n.skill, n.avg_fte, n.peak_fte, n.start_month, n.finish_month, n.sourcing, n.owner, n.notes, uid(user), who(user), ts);
      await ev(projectId, 'demand_added', `demand:${r.id}`, null, `${n.skill} ${n.avg_fte ?? '—'}/${n.peak_fte ?? '—'}`, user);
      return Number(r.id);
    });
  }
  async function deleteDemand(id, { user } = {}) {
    return tx(async () => { const ex = await demandLine(id); if (!ex) throw nf('demand line'); await P(`UPDATE ppm_project_demand SET deleted_at=? WHERE id=?`).run(now(), Number(id)); await ev(ex.project_id, 'demand_removed', `demand:${id}`, ex.skill, null, user); return ex; });
  }

  // ---- §16.2 effort --------------------------------------------------------------------------------------------
  async function effort(projectId) { const r = await P(`SELECT * FROM ppm_project_effort WHERE project_id=?`).get(Number(projectId)); return r ? { factors: J(r.factors_json, {}), updated_by_name: r.updated_by_name, updated_at: r.updated_at } : null; }
  async function effortMany(projectIds) {
    const l = ids(projectIds); if (!l.length) return {};
    return Object.fromEntries((await P(`SELECT project_id, factors_json FROM ppm_project_effort WHERE project_id IN (${inList(l)})`).all(...l)).map((r) => [Number(r.project_id), J(r.factors_json, {})]));
  }
  async function saveEffort(projectId, body, { user } = {}) {
    const f = ES.normalise(body);
    return tx(async () => {
      const before = await effort(projectId);
      await P(`INSERT INTO ppm_project_effort (project_id, factors_json, updated_by, updated_by_name, updated_at) VALUES (?,?,?,?,?) ON CONFLICT (project_id) DO UPDATE SET factors_json=EXCLUDED.factors_json, updated_by=EXCLUDED.updated_by, updated_by_name=EXCLUDED.updated_by_name, updated_at=EXCLUDED.updated_at`)
        .run(Number(projectId), JSON.stringify(f), uid(user), who(user), now());
      await ev(projectId, 'effort_scored', 'effort_factors', before ? JSON.stringify(before.factors) : null, JSON.stringify(f), user);
      return f;
    });
  }

  // ---- §13 residual risk -----------------------------------------------------------------------------------------
  async function listRisks(projectIds) {
    const l = ids(projectIds); if (!l.length) return [];
    return (await P(`SELECT id, project_id, kind, title, owner, status, mitigation, probability, impact, residual_probability, residual_impact, due_date, deleted_at FROM portfolio_risks WHERE deleted_at IS NULL AND project_id IN (${inList(l)}) ORDER BY project_id, id`).all(...l))
      .map((r) => ({ ...r, id: Number(r.id), project_id: Number(r.project_id) }));
  }
  async function riskEntry(id) { const r = await P(`SELECT id, project_id, residual_probability, residual_impact, due_date FROM portfolio_risks WHERE id=? AND deleted_at IS NULL`).get(Number(id)); return r ? { ...r, id: Number(r.id), project_id: Number(r.project_id) } : null; }
  async function saveResidual(riskId, body, { user } = {}) {
    const n = RX.normaliseResidual(body);
    return tx(async () => {
      const ex = await riskEntry(riskId); if (!ex) throw nf('risk');
      await P(`UPDATE portfolio_risks SET residual_probability=?, residual_impact=?, due_date=?, updated_at=now() WHERE id=?`).run(n.residual_probability, n.residual_impact, n.due_date, Number(riskId));
      await ev(ex.project_id, 'risk_residual_set', `risk:${riskId}`, `${ex.residual_probability ?? '—'}×${ex.residual_impact ?? '—'} due ${ex.due_date || '—'}`, `${n.residual_probability ?? '—'}×${n.residual_impact ?? '—'} due ${n.due_date || '—'}`, user);
      return n;
    });
  }

  // ---- §29 documents ------------------------------------------------------------------------------------------------
  const docRow = (r) => r && { ...r, id: Number(r.id), project_id: Number(r.project_id), version: Number(r.version), size_bytes: Number(r.size_bytes) };
  async function listDocuments(projectId) { return (await P(`SELECT * FROM ppm_project_documents WHERE project_id=? AND deleted_at IS NULL ORDER BY doc_type, title, version DESC LIMIT 500`).all(Number(projectId))).map(docRow); }
  async function documentRow(id) { return docRow(await P(`SELECT * FROM ppm_project_documents WHERE id=? AND deleted_at IS NULL`).get(Number(id))); }
  async function addDocument(projectId, input, { user } = {}) {
    const m = PD.validateUpload(input);
    const sha256 = crypto.createHash('sha256').update(input.buf).digest('hex');
    let saved = null;
    try { return await tx(async () => {
      // P11 R5-6 — one version allocator per (project, type, title) — the title compared case-insensitively, the same
      // grouping as PD.latestFirst — so two uploads at once get v1 and v2, never a UNIQUE conflict
      await P('SELECT pg_advisory_xact_lock(hashtext(?))').get(`ppm:doc:${Number(projectId)}:${m.doc_type}:${m.title.toLowerCase()}`);
      const v = await P(`SELECT MAX(version) AS v FROM ppm_project_documents WHERE project_id=? AND doc_type=? AND lower(title)=lower(?)`).get(Number(projectId), m.doc_type, m.title);
      const version = Number((v && v.v) || 0) + 1;
      // server-chosen name in a server-chosen namespace: the client's file name never reaches the filesystem
      saved = blobStore.putB64('ppm-doc', `p${Number(projectId)}`, crypto.randomUUID(), m.mime, input.buf.toString('base64'));
      const r = await P(`INSERT INTO ppm_project_documents (project_id, doc_type, title, version, blob_ref, mime, size_bytes, sha256, uploaded_by, uploaded_by_name, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id`)
        .get(Number(projectId), m.doc_type, m.title, version, saved.ref, m.mime, m.size_bytes, sha256, uid(user), who(user), now());
      await ev(projectId, 'document_added', `document:${r.id}`, null, `${m.doc_type} v${version}`, user, m.title);
      return documentRow(r.id);
    }); } catch (e) {
      // the row was never committed: the file must not stay behind as an orphan
      if (saved && typeof blobStore.removeRef === 'function') blobStore.removeRef(saved.ref);
      throw e;
    }
  }
  async function deleteDocument(id, { user } = {}) {
    return tx(async () => { const ex = await documentRow(id); if (!ex) throw nf('document'); await P(`UPDATE ppm_project_documents SET deleted_at=?, deleted_by=? WHERE id=?`).run(now(), uid(user), Number(id)); await ev(ex.project_id, 'document_removed', `document:${id}`, `${ex.doc_type} v${ex.version}`, null, user, ex.title); return ex; });
  }
  /** The file bytes of a row (null when missing / the ref escapes the blob root — blobStore validates the path). */
  function readDocument(row) {
    if (!row || typeof row.blob_ref !== 'string' || !row.blob_ref.startsWith(`ppm-doc/p${Number(row.project_id)}/`)) return null;
    const b64 = blobStore.getB64(row.blob_ref); return b64 == null ? null : Buffer.from(b64, 'base64');
  }

  // ---- BI (external API): live, NON-sensitive projects of a live chain — no amount, no person name -----------------
  async function extProjects({ intake = false } = {}) {
    const rows = await P(`SELECT p.id, p.key, p.name, p.project_ref, p.priority, p.status, p.stage, p.site_id, p.start_date, p.end_date, p.progress_pct, p.delivery_effort, p.risk_exposure, s.name AS site_name
      FROM portfolio_projects p JOIN portfolio_objectives o ON o.id = p.objective_id AND o.deleted_at IS NULL JOIN portfolio_programmes g ON g.id = o.programme_id AND g.deleted_at IS NULL
      LEFT JOIN sites s ON s.id = p.site_id WHERE p.deleted_at IS NULL AND p.sensitive IS DISTINCT FROM 1 ORDER BY p.id LIMIT 5000`).all();
    return rows.map((r) => ({ id: Number(r.id), key: r.key, name: r.name, project_ref: intake ? r.project_ref || null : null, priority: intake ? r.priority || null : null, status: r.status || null, stage: r.stage || null,
      site_id: r.site_id == null ? null : Number(r.site_id), site_name: r.site_name || null, start_date: r.start_date || null, end_date: r.end_date || null, progress_pct: num(r.progress_pct),
      declared_effort: intake ? r.delivery_effort || null : null, declared_risk_exposure: intake ? r.risk_exposure || null : null }));
  }

  return { listDependencies, dependency, allEdges, saveDependency, deleteDependency, backfillPlan, listDemand, demandProjectIds, demandLine, saveDemand, deleteDemand,
    effort, effortMany, saveEffort, listRisks, riskEntry, saveResidual, listDocuments, documentRow, addDocument, deleteDocument, readDocument, extProjects };
}
module.exports = { makePhase2Store };
