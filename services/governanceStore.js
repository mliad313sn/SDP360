'use strict';
// Step 8 — governance persistence on both backends: meeting cadences & sessions (cockpit),
// the decision register (DEC-YYYY-NNN), the RFI register (rfi_requests, created by 016 on pg),
// and the portfolio (programmes → objectives → projects → milestones → deliverables, risks).
//
// PG tables come from db/postgres/reports/018_governance.sql (migrator).
// `db` = better-sqlite3 handle or a services/pgDb-shaped { prepare } (prepare().get/all/run async).
// No business formula here: agenda, minutes, evidence and slippage live in pure services.


const CADENCE_KINDS = ['site_weekly', 'site_monthly', 'group_monthly', 'committee', 'cab', 'custom'];
const SESSION_STATUSES = ['planned', 'live', 'closed', 'cancelled'];
const DECISION_STATUSES = ['open', 'in_progress', 'done', 'cancelled'];
const RFI_KINDS = ['tracker', 'widget', 'metric', 'integration', 'ux', 'data-quality'];
const RFI_STATUSES = ['submitted', 'triaged', 'accepted', 'scheduled', 'delivered', 'rejected', 'deferred'];
const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'done', 'cancelled'];
const CONFIDENCE = ['low', 'medium', 'high'];

const J = (v) => (v == null ? null : JSON.stringify(v));
const P_ = (s, d) => { if (s == null) return d; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch (_) { return d; } };
const num = (v) => (v == null || v === '' ? null : Number(v));
const str = (v, max = 4000) => (v == null ? null : String(v).slice(0, max));
// G-21 — effective dates: YYYY-MM-DD or null; anything else is refused rather than stored.
const _day = (v) => { if (v == null || v === '') return null; const d = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw Object.assign(new Error('effective dates must be YYYY-MM-DD'), { code: 'INVALID' }); return d; };

function makeGovernanceStore(db, { isPg = false, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new Error('governanceStore needs a db handle');
  const P = (sql) => db.prepare(sql);
  async function init() {  }
  /** INSERT returning the new id on both backends. */
  async function insert(table, cols, vals) {
    const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
    const r = await P(sql + ((' RETURNING id'))).run(...vals);
    return Number(r && (r.id != null ? r.id : r.lastID != null ? r.lastID : (r.rows && r.rows[0] && r.rows[0].id)));
  }
  async function updateRow(table, id, patch, allowed) {
    const keys = Object.keys(patch || {}).filter(k => allowed.includes(k));
    if (!keys.length) return;
    await P(`UPDATE ${table} SET ${keys.map(k => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`).run(...keys.map(k => patch[k]), now(), Number(id));
  }
  async function nextRef(table, prefix, year) {
    const like = `${prefix}-${year}-%`;
    const rows = await P(`SELECT ref FROM ${table} WHERE ref LIKE ?`).all(like);
    const n = rows.reduce((m, r) => Math.max(m, Number(String(r.ref).split('-').pop()) || 0), 0) + 1;
    return `${prefix}-${year}-${String(n).padStart(3, '0')}`;
  }

  // ── cadences ──────────────────────────────────────────────────────────────────────
  const cadRow = (r) => r && ({ ...r, id: Number(r.id), site_id: r.site_id == null ? null : Number(r.site_id), active: Number(r.active) !== 0, participants: P_(r.participants, []), agenda_template: P_(r.agenda_template, null) });
  async function listCadences({ siteIds = null, includeInactive = false } = {}) {
    const rows = (await P(`SELECT * FROM meeting_cadences${includeInactive ? '' : ' WHERE active=1'} ORDER BY kind, name`).all()).map(cadRow);
    return Array.isArray(siteIds) ? rows.filter(c => c.site_id == null || siteIds.includes(c.site_id)) : rows;
  }
  async function getCadence(id) { return cadRow(await P(`SELECT * FROM meeting_cadences WHERE id=?`).get(Number(id))); }
  async function saveCadence(c, { user } = {}) {
    if (!c || !c.key || !/^[a-z0-9][a-z0-9_-]{0,47}$/i.test(c.key)) throw Object.assign(new Error('cadence key is required (letters, digits, - _)'), { code: 'INVALID' });
    if (!c.name) throw Object.assign(new Error('cadence name is required'), { code: 'INVALID' });
    if (c.kind && !CADENCE_KINDS.includes(c.kind)) throw Object.assign(new Error('unknown cadence kind'), { code: 'INVALID' });
    const ex = await P(`SELECT id FROM meeting_cadences WHERE key=?`).get(c.key);
    const vals = { name: str(c.name, 200), kind: c.kind || 'site_weekly', site_id: num(c.site_id), weekday: num(c.weekday), time_local: str(c.time_local, 5), duration_min: num(c.duration_min) || 60,
      participants: J(Array.isArray(c.participants) ? c.participants.slice(0, 50) : []), chair_id: num(c.chair_id), secretary_id: num(c.secretary_id), agenda_template: J(c.agenda_template || null), active: c.active === false ? 0 : 1,
      effective_from: _day(c.effective_from), effective_to: _day(c.effective_to) };
    if (vals.effective_from && vals.effective_to && vals.effective_to < vals.effective_from) throw Object.assign(new Error('effective_to is before effective_from'), { code: 'INVALID' });
    if (ex) { // partial update: a field absent from the payload is left untouched (never wiped)
      const patch = {}; for (const k of Object.keys(vals)) if (c[k] !== undefined) patch[k] = vals[k];
      await updateRow('meeting_cadences', ex.id, patch, Object.keys(patch)); return getCadence(ex.id); }
    const id = await insert('meeting_cadences', ['key', ...Object.keys(vals), 'created_at', 'updated_at'], [c.key, ...Object.values(vals), now(), now()]);
    return getCadence(id);
  }
  async function removeCadence(id) { await P(`DELETE FROM meeting_cadences WHERE id=?`).run(Number(id)); }

  // ── sessions ──────────────────────────────────────────────────────────────────────
  const sesRow = (r) => r && ({ ...r, id: Number(r.id), cadence_id: Number(r.cadence_id), agenda: P_(r.agenda, null), items: P_(r.items, []), attendees: P_(r.attendees, []) });
  async function listSessions({ cadenceId = null, status = null, limit = 50 } = {}) {
    const where = [], args = [];
    if (cadenceId) { where.push('cadence_id=?'); args.push(Number(cadenceId)); }
    if (status) { const st = Array.isArray(status) ? status : [status]; where.push(`status IN (${st.map(() => '?').join(',')})`); args.push(...st); }
    const rows = await P(`SELECT id, cadence_id, scheduled_at, status, started_at, closed_at, closed_by, minutes_sent_at, minutes_accepted_at, minutes_accepted_by, cancelled_at, cancel_reason, exception_status, created_by, created_at FROM meeting_sessions${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY scheduled_at DESC LIMIT ${Math.min(500, Number(limit) || 50)}`).all(...args);
    return rows.map(r => ({ ...r, id: Number(r.id), cadence_id: Number(r.cadence_id) }));
  }
  async function getSession(id) { return sesRow(await P(`SELECT * FROM meeting_sessions WHERE id=?`).get(Number(id))); }
  async function createSession({ cadenceId, scheduledAt, agenda, user }) {
    const id = await insert('meeting_sessions', ['cadence_id', 'scheduled_at', 'status', 'agenda', 'items', 'attendees', 'created_by', 'created_at', 'updated_at'],
      [Number(cadenceId), scheduledAt || now(), 'planned', J(agenda || null), J((agenda && agenda.items || []).map(it => ({ id: it.id, started_at: null, ended_at: null, notes: '' }))), J([]), user ? user.id : null, now(), now()]);
    return getSession(id);
  }
  async function updateSession(id, patch) {
    const p = {};
    if (patch.status) { if (!SESSION_STATUSES.includes(patch.status)) throw Object.assign(new Error('bad session status'), { code: 'INVALID' }); p.status = patch.status; }
    for (const k of ['agenda', 'items', 'attendees']) if (patch[k] !== undefined) p[k] = J(patch[k]);
    for (const k of ['notes', 'minutes_html', 'started_at', 'closed_at', 'minutes_sent_at', 'scheduled_at', 'closed_by', 'minutes_accepted_at', 'minutes_accepted_by',
      'cancelled_at', 'cancelled_by', 'cancel_reason', 'exception_status', 'exception_approved_by', 'exception_approved_at', 'reopen_reason']) if (patch[k] !== undefined) p[k] = patch[k];
    await updateRow('meeting_sessions', id, p, Object.keys(p));
    return getSession(id);
  }
  async function stampItem(id, itemId, field) {
    const s = await getSession(id); if (!s) return null;
    const items = s.items || []; let it = items.find(x => x.id === itemId);
    if (!it) { it = { id: itemId, started_at: null, ended_at: null, notes: '' }; items.push(it); }
    it[field] = now();
    return updateSession(id, { items });
  }
  async function sessionActions(sessionId) { return (await P(`SELECT * FROM session_actions WHERE session_id=? ORDER BY id`).all(Number(sessionId))).map(r => ({ ...r, id: Number(r.id), session_id: Number(r.session_id) })); }
  async function addSessionAction(sessionId, a, { user } = {}) {
    if (!a || !a.title) throw Object.assign(new Error('action title is required'), { code: 'INVALID' });
    const id = await insert('session_actions', ['session_id', 'title', 'owner', 'due_date', 'status', 'source_kind', 'source_ref', 'decision_ref', 'created_by', 'created_at', 'updated_at'],
      [Number(sessionId), str(a.title, 500), str(a.owner, 120), str(a.due_date, 10), 'open', str(a.source_kind, 40), str(a.source_ref, 120), str(a.decision_ref, 40), user ? user.id : null, now(), now()]);
    return (await sessionActions(sessionId)).find(x => x.id === id);
  }
  /** sessionId is REQUIRED: an action is only changed through the session that owns it (security P1-1). Returns rows changed. */
  async function setSessionActionStatus(id, status, sessionId) {
    if (!DECISION_STATUSES.includes(status)) throw Object.assign(new Error('bad status'), { code: 'INVALID' });
    if (sessionId == null) throw Object.assign(new Error('session id required'), { code: 'INVALID' });
    const r = await P(`UPDATE session_actions SET status=?, closed_at=CASE WHEN ? IN ('done','cancelled') THEN ? ELSE NULL END, updated_at=? WHERE id=? AND session_id=?`).run(status, status, now(), now(), Number(id), Number(sessionId));
    return Number(r && r.changes) || 0;
  }
  /** Status change guarded by the expected current status (two runners cannot both close — QA P2). */
  async function moveSession(id, fromStatus, patch) {
    const p = { ...patch }; const keys = Object.keys(p);
    const r = await P(`UPDATE meeting_sessions SET ${keys.map((k) => `${k}=?`).join(', ')}, version=version+1, updated_at=? WHERE id=? AND status=?`).run(...keys.map((k) => p[k]), now(), Number(id), fromStatus);
    return Number(r && r.changes) === 1 ? getSession(id) : null;
  }

  // ── decisions ─────────────────────────────────────────────────────────────────────
  const decRow = (r) => r && ({ ...r, id: Number(r.id), session_id: r.session_id == null ? null : Number(r.session_id), site_id: r.site_id == null ? null : Number(r.site_id) });
  async function listDecisions({ status = null, sessionId = null, siteIds = null, limit = 500 } = {}) {
    const where = [], args = [];
    if (status) { const st = Array.isArray(status) ? status : [status]; where.push(`status IN (${st.map(() => '?').join(',')})`); args.push(...st); }
    if (sessionId) { where.push('session_id=?'); args.push(Number(sessionId)); }
    const rows = (await P(`SELECT * FROM decisions${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${Math.min(2000, Number(limit) || 500)}`).all(...args)).map(decRow);
    return Array.isArray(siteIds) ? rows.filter(d => d.site_id == null || siteIds.includes(d.site_id)) : rows;
  }
  async function addDecision(d, { user } = {}) {
    if (!d || !d.title) throw Object.assign(new Error('decision title is required'), { code: 'INVALID' });
    const ref = await nextRef('decisions', 'DEC', (d.date || now()).slice(0, 4));
    const id = await insert('decisions', ['ref', 'session_id', 'title', 'text', 'owner', 'due_date', 'status', 'source_kind', 'source_ref', 'site_id', 'created_by', 'created_at', 'updated_at'],
      [ref, num(d.session_id), str(d.title, 300), str(d.text), str(d.owner, 120), str(d.due_date, 10), 'open', str(d.source_kind, 40), str(d.source_ref, 120), num(d.site_id), user ? user.id : null, now(), now()]);
    return decRow(await P(`SELECT * FROM decisions WHERE id=?`).get(id));
  }
  async function updateDecision(id, patch) {
    const p = {}; for (const k of ['title', 'text', 'owner', 'due_date']) if (patch[k] !== undefined) p[k] = str(patch[k]);
    if (patch.status) { if (!DECISION_STATUSES.includes(patch.status)) throw Object.assign(new Error('bad decision status'), { code: 'INVALID' }); p.status = patch.status; p.closed_at = ['done', 'cancelled'].includes(patch.status) ? now() : null; }
    await updateRow('decisions', id, p, Object.keys(p));
    return decRow(await P(`SELECT * FROM decisions WHERE id=?`).get(Number(id)));
  }

  // ── RFI register ──────────────────────────────────────────────────────────────────
  const rfiRow = (r) => r && ({ ...r, id: Number(r.id), impact: Number(r.impact), effort: Number(r.effort), data_risk: Number(r.data_risk), site_id: r.site_id == null ? null : Number(r.site_id), score: rfiScore(r) });
  /** Committee rubric (docs/sdp360/02): value = impact × 3 − effort − data_risk, 1..3 each → −3..7; higher first. */
  function rfiScore(r) { return Number(r.impact) * 3 - Number(r.effort) - Number(r.data_risk); }
  // scope: null = the whole register (committee); otherwise { userId, siteIds } — the reader's own
  // requests plus those of their sites (G-08, spec 04 §146: "the Help page lists the user's RFIs").
  async function listRfi({ status = null, limit = 500, scope = null } = {}) {
    const where = [], args = [];
    if (scope) {
      const ids = (scope.siteIds || []).map(Number).filter(Number.isFinite);
      const own = ['requester_id = ?']; args.push(Number(scope.userId) || -1);
      if (ids.length) { own.push(`site_id IN (${ids.map(() => '?').join(',')})`); args.push(...ids); }
      where.push(`(${own.join(' OR ')})`);
    }
    if (status) { const st = Array.isArray(status) ? status : [status]; where.push(`status IN (${st.map(() => '?').join(',')})`); args.push(...st); }
    const rows = (await P(`SELECT * FROM rfi_requests${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${Math.min(2000, Number(limit) || 500)}`).all(...args)).map(rfiRow);
    return rows.sort((a, b) => b.score - a.score || String(b.created_at).localeCompare(String(a.created_at)));
  }
  async function submitRfi(r, { user } = {}) {
    if (!r || !RFI_KINDS.includes(r.kind)) throw Object.assign(new Error(`kind must be one of ${RFI_KINDS.join(', ')}`), { code: 'INVALID' });
    if (!r.title || !r.problem) throw Object.assign(new Error('title and problem are required'), { code: 'INVALID' });
    const ref = await nextRef('rfi_requests', 'RFI', now().slice(0, 4));
    const clamp = (v, d) => Math.min(3, Math.max(1, Number(v) || d));
    const id = await insert('rfi_requests', ['ref', 'kind', 'title', 'problem', 'proposal', 'site_id', 'requester_id', 'impact', 'effort', 'data_risk', 'status', 'created_at', 'updated_at'],
      [ref, r.kind, str(r.title, 200), str(r.problem), str(r.proposal), num(r.site_id), user ? user.id : null, clamp(r.impact, 2), clamp(r.effort, 2), clamp(r.data_risk, 1), 'submitted', now(), now()]);
    return rfiRow(await P(`SELECT * FROM rfi_requests WHERE id=?`).get(id));
  }
  async function triageRfi(id, patch) {
    const p = {}; const clamp = (v) => Math.min(3, Math.max(1, Number(v)));
    for (const k of ['impact', 'effort', 'data_risk']) if (patch[k] != null) p[k] = clamp(patch[k]);
    if (patch.status) { if (!RFI_STATUSES.includes(patch.status)) throw Object.assign(new Error('bad RFI status'), { code: 'INVALID' }); p.status = patch.status; }
    if (patch.decision !== undefined) { p.decision = str(patch.decision); p.decided_at = now(); }
    await updateRow('rfi_requests', id, p, Object.keys(p));
    return rfiRow(await P(`SELECT * FROM rfi_requests WHERE id=?`).get(Number(id)));
  }

  // ── portfolio ─────────────────────────────────────────────────────────────────────
  const idRow = (r) => r && ({ ...r, id: Number(r.id) });
  async function portfolio() {
    const programmes = (await P(`SELECT * FROM portfolio_programmes ORDER BY name`).all()).map(idRow);
    const objectives = (await P(`SELECT * FROM portfolio_objectives ORDER BY programme_id, sort_order, name`).all()).map(r => ({ ...idRow(r), programme_id: Number(r.programme_id), weight: num(r.weight), progress_pct: num(r.progress_pct), evidence_target: num(r.evidence_target), evidence_hib: Number(r.evidence_hib) !== 0 }));
    const projects = (await P(`SELECT * FROM portfolio_projects ORDER BY objective_id, start_date, name`).all()).map(r => ({ ...idRow(r), objective_id: Number(r.objective_id), site_id: r.site_id == null ? null : Number(r.site_id), progress_pct: num(r.progress_pct), budget: num(r.budget), spent: num(r.spent), depends_on: P_(r.depends_on, []) }));
    const milestones = (await P(`SELECT * FROM portfolio_milestones ORDER BY project_id, sort_order, due_date`).all()).map(r => ({ ...idRow(r), project_id: Number(r.project_id) }));
    const deliverables = (await P(`SELECT * FROM portfolio_deliverables ORDER BY project_id, sort_order`).all()).map(r => ({ ...idRow(r), project_id: Number(r.project_id), milestone_id: r.milestone_id == null ? null : Number(r.milestone_id) }));
    const risks = (await P(`SELECT * FROM portfolio_risks ORDER BY project_id, id`).all()).map(r => ({ ...idRow(r), project_id: Number(r.project_id), probability: Number(r.probability), impact: Number(r.impact) }));
    return { programmes, objectives, projects, milestones, deliverables, risks };
  }
  const TABLES = {
    programme: { table: 'portfolio_programmes', cols: ['key', 'name', 'sponsor', 'description', 'status'], req: ['key', 'name'] },
    objective: { table: 'portfolio_objectives', cols: ['programme_id', 'key', 'name', 'weight', 'owner', 'target_date', 'status', 'confidence', 'progress_pct', 'evidence_metric', 'evidence_target', 'evidence_hib', 'manual_evidence', 'sort_order'], req: ['programme_id', 'key', 'name'] },
    project: { table: 'portfolio_projects', cols: ['objective_id', 'key', 'name', 'owner', 'site_id', 'start_date', 'end_date', 'baseline_end', 'status', 'confidence', 'progress_pct', 'budget', 'spent', 'currency', 'depends_on'], req: ['objective_id', 'key', 'name'] },
    milestone: { table: 'portfolio_milestones', cols: ['project_id', 'name', 'due_date', 'baseline_date', 'done_at', 'status', 'sort_order'], req: ['project_id', 'name'] },
    deliverable: { table: 'portfolio_deliverables', cols: ['project_id', 'milestone_id', 'name', 'owner', 'due_date', 'status', 'action_kind', 'action_ref', 'sort_order', 'closed_at'], req: ['project_id', 'name'] },
    risk: { table: 'portfolio_risks', cols: ['project_id', 'title', 'probability', 'impact', 'mitigation', 'owner', 'status', 'incident_ref', 'closed_at'], req: ['project_id', 'title'] },
  };
  function normalise(kind, body) {
    const out = {};
    for (const c of TABLES[kind].cols) if (body[c] !== undefined) {
      let v = body[c];
      if (c === 'depends_on') v = J(Array.isArray(v) ? v.map(Number) : []);
      else if (c === 'evidence_hib') v = v === false || v === 0 ? 0 : 1;
      else if (/_id$|^sort_order$|^probability$|^impact$/.test(c)) v = num(v);
      else if (/pct$|^weight$|^budget$|^spent$|evidence_target/.test(c)) v = num(v);
      else v = str(v, c === 'description' || c === 'mitigation' || c === 'manual_evidence' ? 4000 : 300);
      out[c] = v;
    }
    if (kind === 'project' && out.status && !PROJECT_STATUSES.includes(out.status)) throw Object.assign(new Error('bad project status'), { code: 'INVALID' });
    if (out.confidence && !CONFIDENCE.includes(out.confidence)) throw Object.assign(new Error('confidence must be low | medium | high'), { code: 'INVALID' });
    return out;
  }
  async function upsertPortfolio(kind, body) {
    const T = TABLES[kind]; if (!T) throw Object.assign(new Error('unknown portfolio entity'), { code: 'INVALID' });
    const vals = normalise(kind, body || {});
    if (body && body.id) { await updateRow(T.table, body.id, vals, T.cols); return Number(body.id); }
    for (const r of T.req) if (vals[r] == null || vals[r] === '') throw Object.assign(new Error(`${r} is required`), { code: 'INVALID' });
    return insert(T.table, [...Object.keys(vals), 'created_at', 'updated_at'], [...Object.values(vals), now(), now()]);
  }
  async function removePortfolio(kind, id) { const T = TABLES[kind]; if (!T) throw new Error('unknown portfolio entity'); await P(`DELETE FROM ${T.table} WHERE id=?`).run(Number(id)); }

  return { init, listCadences, getCadence, saveCadence, removeCadence, listSessions, getSession, createSession, updateSession, stampItem, sessionActions, addSessionAction, setSessionActionStatus, moveSession,
    listDecisions, addDecision, updateDecision, listRfi, submitRfi, triageRfi, rfiScore, portfolio, upsertPortfolio, removePortfolio,
    CADENCE_KINDS, SESSION_STATUSES, DECISION_STATUSES, RFI_KINDS, RFI_STATUSES, PROJECT_STATUSES, CONFIDENCE };
}

module.exports = { makeGovernanceStore, CADENCE_KINDS, SESSION_STATUSES, DECISION_STATUSES, RFI_KINDS, RFI_STATUSES, PROJECT_STATUSES, CONFIDENCE };
