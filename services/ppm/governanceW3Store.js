'use strict';
// W3-GOVERNANCE — store of the gate checklists / evidence / sign-offs, the RAID details, the RAG hysteresis memory and
// the simplified/expert view preference (migration 110). Same handle shape as services/governanceStore; every write
// leaves a hash-chained ppm_events row through the governance store's ppmEvent (entity 'project'). No amount is ever
// written to the ledger (RAID exposure edits are logged as "changed", the figures stay in ppm_raid_details).
// The routes decide the switches and the access rules; the pure rules live in gateChecklist.js / raid.js / projectRag.js.
const GC = require('./gateChecklist');
const RAID = require('./raid');

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const J = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch (_) { return d; } };
const who = (u) => (u ? String(u.full_name || u.username || '') : null);
const uid = (u) => (u && u.id != null ? Number(u.id) : null);

function makeW3Store(db, gov, { now = () => new Date().toISOString() } = {}) {
  if (!db || !gov) throw new Error('w3 store needs a db handle and the governance store');
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (typeof db.runTransaction === 'function' ? db.runTransaction(fn) : fn());

  // ---- gate checklists --------------------------------------------------------------------------------------
  /** The cycle of a gate = the id of the project's latest stage ledger row ('0' before any move). */
  async function cycleKey(projectId) {
    const r = await P(`SELECT MAX(id) AS id FROM ppm_events WHERE entity='project' AND entity_id=? AND action='stage'`).get(Number(projectId));
    return String((r && r.id) || 0);
  }
  const checklistRow = (r) => r && { id: Number(r.id), project_id: Number(r.project_id), gate_to: r.gate_to, version: Number(r.version), definition: J(r.definition_json, null), defined_by: r.defined_by == null ? null : Number(r.defined_by), defined_by_name: r.defined_by_name || null, defined_at: r.defined_at };
  async function listChecklists(projectId) { return (await P(`SELECT * FROM ppm_gate_checklists WHERE project_id=? ORDER BY id`).all(Number(projectId))).map(checklistRow); }
  async function getChecklist(projectId, gateTo) { return checklistRow(await P(`SELECT * FROM ppm_gate_checklists WHERE project_id=? AND gate_to=?`).get(Number(projectId), String(gateTo))); }
  async function saveChecklist(projectId, gateTo, body, { user } = {}) {
    if (!GC.STAGES.includes(gateTo)) throw Object.assign(new Error('unknown stage ' + gateTo), { code: 'INVALID', reason: 'STAGE_UNKNOWN', status: 400 });
    const def = GC.normaliseDefinition(body);
    return tx(async () => {
      const before = await getChecklist(projectId, gateTo);
      if (before) await P(`UPDATE ppm_gate_checklists SET version=version+1, definition_json=?, defined_by=?, defined_by_name=?, defined_at=? WHERE id=?`).run(JSON.stringify(def), uid(user), who(user), now(), before.id);
      else await P(`INSERT INTO ppm_gate_checklists (project_id, gate_to, version, definition_json, defined_by, defined_by_name, defined_at) VALUES (?,?,?,?,?,?,?)`).run(Number(projectId), gateTo, 1, JSON.stringify(def), uid(user), who(user), now());
      const after = await getChecklist(projectId, gateTo);
      await gov.ppmEvent({ entity: 'project', entity_id: Number(projectId), action: 'gate_checklist_defined', field: `gate:${gateTo}`, old_value: before ? `v${before.version}` : null, new_value: `v${after.version} · ${def.items.length} item(s) · ${def.approvers.length} approver slot(s) · ${def.rule}${def.quorum ? ' ' + def.quorum : ''}`, note: 'earlier sign-offs of this gate no longer count' }, user);
      return after;
    });
  }
  async function evidenceOf(projectId, gateTo) {
    return (await P(`SELECT * FROM ppm_gate_evidence WHERE project_id=? AND gate_to=? ORDER BY id`).all(Number(projectId), String(gateTo))).map((r) => ({ ...r, id: Number(r.id), withdrawn: Number(r.withdrawn) === 1 }));
  }
  async function addEvidence(projectId, gateTo, body, { user } = {}) {
    const cl = await getChecklist(projectId, gateTo);
    if (!cl) throw Object.assign(new Error('no checklist is defined for this gate'), { code: 'NOT_FOUND', status: 404 });
    const key = String((body && body.item_key) || '');
    const item = cl.definition.items.find((i) => i.key === key);
    if (!item) throw Object.assign(new Error('unknown checklist item'), { code: 'INVALID', reason: 'BAD_ITEM_KEY', status: 400 });
    const withdrawn = !!(body && (body.withdrawn === true || body.withdrawn === 1 || body.withdrawn === '1'));
    const link = body && body.link != null && String(body.link).trim() !== '' ? String(body.link).trim() : null;
    if (!withdrawn && item.kind === 'artifact' && !GC.validLink(link)) throw Object.assign(new Error('an artifact needs a link (https://… or an internal /path)'), { code: 'INVALID', reason: 'BAD_LINK', status: 400 });
    if (link != null && !GC.validLink(link)) throw Object.assign(new Error('the link must be https://… or an internal /path'), { code: 'INVALID', reason: 'BAD_LINK', status: 400 });
    const note = body && body.note ? String(body.note).slice(0, 2000) : null;
    return tx(async () => {
      const cyc = await cycleKey(projectId);
      await P(`INSERT INTO ppm_gate_evidence (project_id, gate_to, cycle_key, item_key, link, note, withdrawn, added_by, added_by_name, added_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(Number(projectId), gateTo, cyc, key, link, note, withdrawn ? 1 : 0, uid(user), who(user), now());
      await gov.ppmEvent({ entity: 'project', entity_id: Number(projectId), action: withdrawn ? 'gate_evidence_withdrawn' : 'gate_evidence_added', field: `gate:${gateTo}:${key}`, new_value: link, note }, user);
      return { cycle_key: cyc };
    });
  }
  async function signoffsOf(projectId, gateTo) {
    return (await P(`SELECT * FROM ppm_gate_signoffs WHERE project_id=? AND gate_to=? ORDER BY id`).all(Number(projectId), String(gateTo)))
      .map((r) => ({ ...r, id: Number(r.id), approver_id: Number(r.approver_id), slot_index: Number(r.slot_index), checklist_version: Number(r.checklist_version) }));
  }
  /** Record a sign-off. eligible = slot indexes the caller computed (GC.eligibleSlots); throws CONFLICT when taken. */
  async function addSignoff(projectId, gateTo, { decision, reason }, { user, eligible }) {
    return tx(async () => {
      const cl = await getChecklist(projectId, gateTo);
      if (!cl) throw Object.assign(new Error('no checklist is defined for this gate'), { code: 'NOT_FOUND', status: 404 });
      const cyc = await cycleKey(projectId);
      const decisions = GC.currentDecisions(await signoffsOf(projectId, gateTo), { cycleKey: cyc, version: cl.version });
      const slot = GC.pickSlot(eligible, decisions, uid(user));
      if (slot == null) throw Object.assign(new Error('every approver slot you could fill is already held by someone else'), { code: 'CONFLICT', reason: 'SLOT_TAKEN', status: 409 });
      const a = cl.definition.approvers[slot];
      await P(`INSERT INTO ppm_gate_signoffs (project_id, gate_to, cycle_key, checklist_version, slot_index, slot_desc, decision, reason, approver_id, approver_name, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(Number(projectId), gateTo, cyc, cl.version, slot, a.user_id != null ? `user:${a.user_id}` : `role:${a.role}`, decision, reason, uid(user), who(user), now());
      await gov.ppmEvent({ entity: 'project', entity_id: Number(projectId), action: decision === 'approve' ? 'gate_signoff_approved' : 'gate_signoff_rejected', field: `gate:${gateTo}`, new_value: `slot ${slot + 1} · v${cl.version}`, note: reason }, user);
      return { slot, cycle_key: cyc, version: cl.version };
    });
  }
  /** The full evaluation of one gate (null definition = no checklist = today). */
  async function evaluateGate(projectId, gateTo) {
    const cl = await getChecklist(projectId, gateTo);
    if (!cl) return { gate_to: gateTo, ...GC.evaluate({ definition: null }) };
    const cyc = await cycleKey(projectId);
    return { gate_to: gateTo, defined_by_name: cl.defined_by_name, defined_at: cl.defined_at, cycle_key: cyc, ...GC.evaluate({ definition: cl.definition, version: cl.version, evidence: await evidenceOf(projectId, gateTo), signoffs: await signoffsOf(projectId, gateTo), cycleKey: cyc }) };
  }

  // ---- RAID ------------------------------------------------------------------------------------------------
  async function listRaid(projectId) {
    const rows = await P(`SELECT r.*, d.response AS d_response, d.review_date AS d_review_date, d.probability_pct AS d_probability_pct, d.impact_amount AS d_impact_amount, d.impact_currency AS d_impact_currency, d.dependency_ref AS d_dependency_ref
      FROM portfolio_risks r LEFT JOIN ppm_raid_details d ON d.risk_id = r.id WHERE r.project_id=? AND r.deleted_at IS NULL ORDER BY r.id`).all(Number(projectId));
    return rows.map((r) => ({ row: r, details: { response: r.d_response, review_date: r.d_review_date, probability_pct: num(r.d_probability_pct), impact_amount: num(r.d_impact_amount), impact_currency: r.d_impact_currency, dependency_ref: r.d_dependency_ref } }));
  }
  async function raidEntry(id) {
    const r = await P(`SELECT id, project_id FROM portfolio_risks WHERE id=? AND deleted_at IS NULL`).get(Number(id));
    return r ? { id: Number(r.id), project_id: Number(r.project_id) } : null;
  }
  /** Create (no id) or update a RAID entry of a project. `keepMoney`: a reader without money rights cannot change the amount. */
  async function saveRaid(projectId, body, { user, keepMoney = false } = {}) {
    const n = RAID.normalise(body);
    const pid = Number(projectId);
    return tx(async () => {
      let id = body && body.id != null ? Number(body.id) : null;
      const ts = now();
      if (id != null) {
        const ex = await P(`SELECT * FROM portfolio_risks WHERE id=? AND project_id=? AND deleted_at IS NULL`).get(id, pid);
        if (!ex) throw Object.assign(new Error('RAID entry not found'), { code: 'NOT_FOUND', status: 404 });
        await P(`UPDATE portfolio_risks SET kind=?, title=?, probability=?, impact=?, owner=?, status=?, mitigation=?, updated_at=now(), closed_at=? WHERE id=?`)
          .run(n.row.kind, n.row.title, n.row.probability == null ? ex.probability : n.row.probability, n.row.impact == null ? ex.impact : n.row.impact, n.row.owner, n.row.status, n.row.mitigation, n.row.status === 'closed' ? (ex.closed_at || ts.slice(0, 10)) : null, id);
      } else {
        await P(`INSERT INTO portfolio_risks (project_id, kind, title, probability, impact, owner, status, mitigation, closed_at) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(pid, n.row.kind, n.row.title, n.row.probability == null ? 2 : n.row.probability, n.row.impact == null ? 2 : n.row.impact, n.row.owner, n.row.status, n.row.mitigation, n.row.status === 'closed' ? ts.slice(0, 10) : null);
        id = Number((await P(`SELECT MAX(id) AS id FROM portfolio_risks WHERE project_id=?`).get(pid)).id);
      }
      const prev = await P(`SELECT * FROM ppm_raid_details WHERE risk_id=?`).get(id);
      const d = { ...n.details };
      if (keepMoney) { d.impact_amount = prev ? num(prev.impact_amount) : null; d.impact_currency = prev ? prev.impact_currency : null; }
      if (prev) await P(`UPDATE ppm_raid_details SET response=?, review_date=?, probability_pct=?, impact_amount=?, impact_currency=?, dependency_ref=?, updated_by=?, updated_at=? WHERE risk_id=?`)
        .run(d.response, d.review_date, d.probability_pct, d.impact_amount, d.impact_currency, d.dependency_ref, uid(user), ts, id);
      else await P(`INSERT INTO ppm_raid_details (risk_id, response, review_date, probability_pct, impact_amount, impact_currency, dependency_ref, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, d.response, d.review_date, d.probability_pct, d.impact_amount, d.impact_currency, d.dependency_ref, uid(user), ts);
      const moneyChanged = !keepMoney && (!prev ? d.impact_amount != null : num(prev.impact_amount) !== d.impact_amount || (prev.impact_currency || null) !== d.impact_currency);
      await gov.ppmEvent({ entity: 'project', entity_id: pid, action: body && body.id != null ? 'raid_updated' : 'raid_created', field: `raid:${id}`, new_value: `${n.row.kind} · P${n.row.probability ?? '—'}×I${n.row.impact ?? '—'} · ${n.row.status}`, note: moneyChanged ? 'exposure figures changed (amounts are kept in the RAID details, not in the ledger)' : null }, user);
      return id;
    });
  }

  // ---- RAG hysteresis memory ---------------------------------------------------------------------------------
  async function ragState(projectId) { const r = await P(`SELECT * FROM ppm_project_rag_state WHERE project_id=?`).get(Number(projectId)); return r ? { rag: r.rag || null, metrics: (J(r.state_json, {}) || {}).metrics || {}, computed_at: r.computed_at } : null; }
  /** Store the new state; a colour change is a ppm_events row. Returns true when the composite changed. */
  async function saveRagState(projectId, result, inputs, { user = null } = {}) {
    const prev = await ragState(projectId);
    const st = JSON.stringify(result.state);
    if (prev) await P(`UPDATE ppm_project_rag_state SET rag=?, state_json=?, inputs_json=?, computed_at=? WHERE project_id=?`).run(result.rag, st, JSON.stringify(inputs), now(), Number(projectId));
    else await P(`INSERT INTO ppm_project_rag_state (project_id, rag, state_json, inputs_json, computed_at) VALUES (?,?,?,?,?)`).run(Number(projectId), result.rag, st, JSON.stringify(inputs), now());
    const changed = !prev || (prev.rag || null) !== (result.rag || null);
    if (changed && prev) await gov.ppmEvent({ entity: 'project', entity_id: Number(projectId), action: 'rag_changed', field: 'rag', old_value: prev.rag, new_value: result.rag, note: 'composite RAG (PROPOSED thresholds unless configured)' }, user);
    return changed;
  }

  // ---- view preference ---------------------------------------------------------------------------------------
  async function viewMode(userId) { const r = await P(`SELECT project_view_mode FROM ppm_user_view_prefs WHERE user_id=?`).get(Number(userId)); return r ? r.project_view_mode : null; }
  async function setViewMode(userId, mode) {
    if (!['simplified', 'expert'].includes(mode)) throw Object.assign(new Error('mode must be simplified | expert'), { code: 'INVALID', reason: 'BAD_MODE', status: 400 });
    const ex = await viewMode(userId);
    if (ex) await P(`UPDATE ppm_user_view_prefs SET project_view_mode=?, updated_at=? WHERE user_id=?`).run(mode, now(), Number(userId));
    else await P(`INSERT INTO ppm_user_view_prefs (user_id, project_view_mode, updated_at) VALUES (?,?,?)`).run(Number(userId), mode, now());
    return mode;
  }

  return { cycleKey, listChecklists, getChecklist, saveChecklist, evidenceOf, addEvidence, signoffsOf, addSignoff, evaluateGate, listRaid, raidEntry, saveRaid, ragState, saveRagState, viewMode, setViewMode };
}

module.exports = { makeW3Store };
