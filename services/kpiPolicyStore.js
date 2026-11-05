'use strict';
// C-31 — KPI policy store (migration 065). Governance in one place:
//   • a draft is created / edited by a kpi-committee member (or super_admin) — the route checks the role;
//   • only its AUTHOR moves it to 'proposed';
//   • ADOPTION is a separate human act by a committee member who is NOT the author (services/sodPolicy.js
//     'kpi_policy.adopt'), with a committee reference; the adopted version is immutable (DB trigger) and
//     effective-dated: the previous adopted version of the metric is closed at the new effective_from;
//   • reject = back to draft; retire = closes an adopted version. Every step appends a history row.
// Nothing is ever adopted by code: ensureSeed() inserts today's rules as 'proposed' (origin imported_from_code).
const Engine = require('./kpiPolicyEngine');
const Sod = require('./sodPolicy');
const { typed } = require('./httpError');

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const _day = (v) => String(v || '').slice(0, 10);

function makeKpiPolicyStore(db, { now = () => new Date().toISOString(), knownKey = () => true } = {}) {
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (db.runTransaction ? db.runTransaction(fn) : fn());
  const hist = (id, action, actorId, details) => P('INSERT INTO kpi_policy_history (policy_id, action, actor_id, at, details_json) VALUES (?, ?, ?, ?, ?)')
    .run(Number(id), action, actorId == null ? null : Number(actorId), now(), JSON.stringify(details || {}));
  const norm = (r) => {
    if (!r) return null;
    let definition = null; try { definition = JSON.parse(r.definition_json); } catch (_) { definition = null; }
    const out = { ...r, id: Number(r.id), version: Number(r.version), definition };
    for (const k of ['created_by', 'proposed_by', 'adopted_by']) out[k] = r[k] == null ? null : Number(r[k]);
    delete out.definition_json; return out;
  };
  const getRow = async (id) => norm(await P('SELECT * FROM kpi_policies WHERE id=?').get(Number(id)));
  async function get(id) {
    const p = await getRow(id);
    if (!p) throw typed('NOT_FOUND', 'policy not found', 404);
    return p;
  }

  function _check(body, { partial } = {}) {
    if (!partial || body.definition !== undefined) {
      const v = Engine.validate(body.definition);
      if (!v.ok) { const e = typed('VALIDATION', 'invalid policy definition: ' + v.errors.map((x) => `${x.path} ${x.code}`).join(', '), 400); e.errors = v.errors; throw e; }
    }
    if (body.effective_from != null && body.effective_from !== '' && !DAY.test(String(body.effective_from))) throw typed('VALIDATION', 'effective_from must be YYYY-MM-DD', 400);
    if (!partial || body.title !== undefined) if (String(body.title || '').trim().length < 3) throw typed('VALIDATION', 'a title (3+ characters) is required', 400);
  }

  async function ensureSeed() {
    for (const [key, list] of Object.entries(Engine.IMPORTED_DEFINITIONS)) {
      const has = await P('SELECT 1 AS x FROM kpi_policies WHERE metric_key=? LIMIT 1').get(key);
      if (has) continue;
      await tx(async () => {
        let v = 0;
        for (const s of list) {
          v++;
          const r = await P(`INSERT INTO kpi_policies (metric_key, version, title, status, definition_json, owner, rationale, origin, created_by, created_at, updated_at, proposed_at)
            VALUES (?, ?, ?, 'proposed', ?, ?, ?, 'imported_from_code', NULL, ?, ?, ?) ON CONFLICT (metric_key, version) DO NOTHING RETURNING id`)
            .get(key, v, s.title, JSON.stringify(s.definition), 'service-support-manager', s.rationale, now(), now(), now());
          if (r) await hist(r.id, 'imported', null, { note: 'imported from current code, not yet adopted by the committee' });
        }
      });
    }
  }

  async function list({ metric } = {}) {
    await ensureSeed();
    const rows = metric ? await P('SELECT * FROM kpi_policies WHERE metric_key=? ORDER BY metric_key, version').all(String(metric))
      : await P('SELECT * FROM kpi_policies ORDER BY metric_key, version').all();
    return rows.map(norm);
  }

  async function create(body, { actorId }) {
    if (!knownKey(body.metric_key)) throw typed('VALIDATION', 'unknown metric key', 400);
    _check(body);
    return tx(async () => {
      const mx = await P('SELECT COALESCE(MAX(version), 0) AS v FROM kpi_policies WHERE metric_key=?').get(String(body.metric_key));
      const r = await P(`INSERT INTO kpi_policies (metric_key, version, title, status, definition_json, effective_from, owner, rationale, origin, created_by, created_at, updated_at)
        VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, 'committee', ?, ?, ?) RETURNING id`)
        .get(String(body.metric_key), Number(mx.v) + 1, String(body.title).trim().slice(0, 200), JSON.stringify(body.definition),
          body.effective_from ? String(body.effective_from) : null, body.owner ? String(body.owner).slice(0, 200) : null,
          body.rationale ? String(body.rationale).slice(0, 4000) : null, actorId == null ? null : Number(actorId), now(), now());
      await hist(r.id, 'created', actorId, { from_version: body.copy_of || null });
      return Number(r.id);
    });
  }

  async function update(id, patch, { actorId }) {
    const p = await get(id);
    if (p.status !== 'draft') throw typed('CONFLICT', `a ${p.status} policy cannot be edited — create a new version`, 409);
    _check(patch, { partial: true });
    const sets = [], args = [];
    if (patch.title !== undefined) { sets.push('title=?'); args.push(String(patch.title).trim().slice(0, 200)); }
    if (patch.definition !== undefined) { sets.push('definition_json=?'); args.push(JSON.stringify(patch.definition)); }
    if (patch.effective_from !== undefined) { sets.push('effective_from=?'); args.push(patch.effective_from ? String(patch.effective_from) : null); }
    if (patch.owner !== undefined) { sets.push('owner=?'); args.push(patch.owner ? String(patch.owner).slice(0, 200) : null); }
    if (patch.rationale !== undefined) { sets.push('rationale=?'); args.push(patch.rationale ? String(patch.rationale).slice(0, 4000) : null); }
    if (!sets.length) return;
    return tx(async () => {
      const r = await P(`UPDATE kpi_policies SET ${sets.join(', ')}, updated_at=? WHERE id=? AND status='draft'`).run(...args, now(), Number(id));
      if (Number(r && r.changes) !== 1) throw typed('CONFLICT', 'the policy is no longer a draft', 409);
      await hist(id, 'edited', actorId, { changes: patch.definition !== undefined ? Engine.diff(p.definition, patch.definition) : [], fields: Object.keys(patch) });
    });
  }

  async function propose(id, { actorId }) {
    const p = await get(id);
    if (p.status !== 'draft') throw typed('CONFLICT', 'only a draft can be proposed', 409);
    if (p.created_by == null || Number(p.created_by) !== Number(actorId)) throw typed('FORBIDDEN', 'only the author of the draft proposes it', 403);
    return tx(async () => {
      const r = await P("UPDATE kpi_policies SET status='proposed', proposed_by=?, proposed_at=?, updated_at=? WHERE id=? AND status='draft'").run(Number(actorId), now(), now(), Number(id));
      if (Number(r && r.changes) !== 1) throw typed('CONFLICT', 'the policy is no longer a draft', 409);
      await hist(id, 'proposed', actorId, {});
    });
  }

  /** May this actor adopt this policy? (proposed + not its author/proposer + not a deputy of them). */
  // principals = the people the actor stands in for as a deputy (any scope) — a deputy of the author never adopts.
  function adoptCheck(p, actorId, principals) {
    if (p.status !== 'proposed') return { ok: false, reason: 'only a proposed policy can be adopted' };
    const any = (principals || []).map(Number);
    const deputyIds = [p.created_by, p.proposed_by].some((x) => x != null && any.includes(Number(x))) ? new Set([Number(actorId)]) : new Set();
    const s = Sod.evaluate('kpi_policy.adopt', { actorId, subjectId: p.created_by, requesterId: p.proposed_by, deputyIds });
    return s.refuse ? { ok: false, reason: s.refuse.error, rule: s.refuse.rule } : { ok: true };
  }

  async function decide(id, body, { actorId, principals }) {
    const decision = String(body.decision || '');
    if (!['adopt', 'reject', 'retire'].includes(decision)) throw typed('VALIDATION', 'decision must be adopt, reject or retire', 400);
    const ref = String(body.committee_ref || '').trim();
    if (ref.length < 3) throw typed('VALIDATION', 'a committee session / PV reference is required', 400);
    if (actorId == null) throw typed('FORBIDDEN', 'no actor', 403);
    const p = await get(id);
    const today = _day(now());
    return tx(async () => {
      if (decision === 'adopt') {
        const c = adoptCheck(p, actorId, principals);
        if (!c.ok) throw typed(p.status !== 'proposed' ? 'CONFLICT' : 'FORBIDDEN', c.reason, p.status !== 'proposed' ? 409 : 403);
        const from = body.effective_from ? String(body.effective_from) : (p.effective_from || today);
        if (!DAY.test(from)) throw typed('VALIDATION', 'effective_from must be YYYY-MM-DD', 400);
        // the version in force for the metric is closed where the new one starts (history keeps it)
        const prev = await P("SELECT id, effective_from FROM kpi_policies WHERE metric_key=? AND status='adopted' AND id<>? AND (effective_to IS NULL OR effective_to > ?)").all(p.metric_key, p.id, from);
        for (const q of prev) {
          if (String(q.effective_from) >= from) throw typed('CONFLICT', `version starting ${q.effective_from} is already adopted — choose a later effective date`, 409);
          await P('UPDATE kpi_policies SET effective_to=?, updated_at=? WHERE id=?').run(from, now(), q.id);
          await hist(q.id, 'superseded', actorId, { by: p.id, effective_to: from });
        }
        const r = await P("UPDATE kpi_policies SET status='adopted', effective_from=?, adopted_by=?, adopted_at=?, updated_at=? WHERE id=? AND status='proposed'").run(from, Number(actorId), now(), now(), p.id);
        if (Number(r && r.changes) !== 1) throw typed('CONFLICT', 'the policy is no longer proposed', 409);
      } else if (decision === 'reject') {
        if (p.status !== 'proposed') throw typed('CONFLICT', 'only a proposed policy can be rejected', 409);
        await P("UPDATE kpi_policies SET status='draft', proposed_by=NULL, proposed_at=NULL, updated_at=? WHERE id=? AND status='proposed'").run(now(), p.id);
      } else {
        if (p.status !== 'adopted') throw typed('CONFLICT', 'only an adopted policy can be retired', 409);
        const to = p.effective_to && p.effective_to < today ? p.effective_to : today;
        await P("UPDATE kpi_policies SET status='retired', effective_to=?, updated_at=? WHERE id=? AND status='adopted'").run(to, now(), p.id);
      }
      await P('INSERT INTO kpi_policy_decisions (policy_id, decision, decided_by, decided_at, committee_ref, minutes) VALUES (?, ?, ?, ?, ?, ?)')
        .run(p.id, decision, Number(actorId), now(), ref.slice(0, 200), body.minutes ? String(body.minutes).slice(0, 8000) : null);
      await hist(p.id, decision === 'adopt' ? 'adopted' : decision === 'reject' ? 'rejected' : 'retired', actorId, { committee_ref: ref.slice(0, 200) });
    });
  }

  async function history(id) {
    const h = await P('SELECT * FROM kpi_policy_history WHERE policy_id=? ORDER BY id').all(Number(id));
    const d = await P('SELECT * FROM kpi_policy_decisions WHERE policy_id=? ORDER BY id').all(Number(id));
    return {
      events: h.map((r) => ({ ...r, id: Number(r.id), actor_id: r.actor_id == null ? null : Number(r.actor_id), details: (() => { try { return JSON.parse(r.details_json); } catch (_) { return {}; } })(), details_json: undefined })),
      decisions: d.map((r) => ({ ...r, id: Number(r.id), decided_by: Number(r.decided_by) })),
    };
  }

  /** The ADOPTED version in force for a metric on a day (effective-dated; null = none adopted). */
  async function inForce(metric, day) {
    const d = _day(day || now());
    const r = await P(`SELECT * FROM kpi_policies WHERE metric_key=? AND status IN ('adopted','retired') AND effective_from <= ?
      AND (effective_to IS NULL OR effective_to > ?) ORDER BY effective_from DESC, id DESC LIMIT 1`).get(String(metric), d, d);
    return norm(r);
  }

  return { list, get, create, update, propose, decide, history, inForce, adoptCheck, ensureSeed };
}

module.exports = { makeKpiPolicyStore };
