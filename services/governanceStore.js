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
const RFI_KINDS = ['tracker', 'widget', 'metric', 'integration', 'ux', 'data-quality', 'governance'];   // charter 02 §3: governance requests too
const RFI_STATUSES = ['submitted', 'triaged', 'accepted', 'scheduled', 'delivered', 'verified', 'rejected', 'deferred'];   // verified = the requester confirms delivery (charter 02:63)
const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'done', 'cancelled'];
const CONFIDENCE = ['low', 'medium', 'high'];
const softDelete = require('./softDelete');   // A-19c

const J = (v) => (v == null ? null : JSON.stringify(v));
const P_ = (s, d) => { if (s == null) return d; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch (_) { return d; } };
const num = (v) => (v == null || v === '' ? null : Number(v));
const str = (v, max = 4000) => (v == null ? null : String(v).slice(0, max));
// G-21 — effective dates: YYYY-MM-DD or null; anything else is refused rather than stored.
const _day = (v) => { if (v == null || v === '') return null; const d = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw Object.assign(new Error('effective dates must be YYYY-MM-DD'), { code: 'INVALID' }); return d; };

function makeGovernanceStore(db, { isPg = false, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new Error('governanceStore needs a db handle');
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (typeof db.runTransaction === 'function' ? db.runTransaction(fn) : fn());
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
    const rows = (await P(`SELECT * FROM meeting_cadences WHERE deleted_at IS NULL${includeInactive ? '' : ' AND active=1'} ORDER BY kind, name`).all()).map(cadRow);
    return Array.isArray(siteIds) ? rows.filter(c => c.site_id == null || siteIds.includes(c.site_id)) : rows;
  }
  async function getCadence(id) { return cadRow(await P(`SELECT * FROM meeting_cadences WHERE id=? AND deleted_at IS NULL`).get(Number(id))); }
  async function saveCadence(c, { user } = {}) {
    if (!c || !c.key || !/^[a-z0-9][a-z0-9_-]{0,47}$/i.test(c.key)) throw Object.assign(new Error('cadence key is required (letters, digits, - _)'), { code: 'INVALID' });
    if (!c.name) throw Object.assign(new Error('cadence name is required'), { code: 'INVALID' });
    if (c.kind && !CADENCE_KINDS.includes(c.kind)) throw Object.assign(new Error('unknown cadence kind'), { code: 'INVALID' });
    const ex = await P(`SELECT id, deleted_at FROM meeting_cadences WHERE key=?`).get(c.key);
    // A-19c — the key is UNIQUE: a save must neither resurrect nor silently edit a soft-deleted cadence.
    if (ex && ex.deleted_at) throw softDelete.deletedConflict('cadence', ex);
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
  // A-19c — opts.soft (route: soft_delete_enabled) stamps the cadence; its sessions / actions / decision links stay
  // and are hidden through the cadence. Without it: today's hard delete (sessions → actions cascade, decisions SET NULL).
  async function removeCadence(id, opts = {}) {
    if (opts.soft) return softDelete.stamp(db, 'meeting_cadences', Number(id), { by: opts.user && opts.user.id, reason: opts.reason, now: new Date(now()) });
    await P(`DELETE FROM meeting_cadences WHERE id=?`).run(Number(id));
    return true;
  }
  async function restoreCadence(id) { return softDelete.unstamp(db, 'meeting_cadences', Number(id)); }
  async function getCadenceTrashRow(id) { const r = await P(`SELECT id, key, name, kind, site_id, deleted_at, deleted_by, delete_reason FROM meeting_cadences WHERE id=?`).get(Number(id)); return r ? { ...r, id: Number(r.id) } : null; }
  async function listDeletedCadences() { return (await P(`SELECT id, key, name, kind, site_id, deleted_at, deleted_by, delete_reason FROM meeting_cadences WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all()).map(r => ({ ...r, id: Number(r.id) })); }
  async function purgeDeletedCadences(cutoff, { apply = false } = {}) {
    const ids = (await P(`SELECT id FROM meeting_cadences WHERE deleted_at IS NOT NULL AND deleted_at < ? ORDER BY deleted_at`).all(cutoff)).map(r => Number(r.id));
    let purged = 0;
    if (apply) for (const id of ids) if (Number((await P(`DELETE FROM meeting_cadences WHERE id=? AND deleted_at IS NOT NULL AND deleted_at < ?`).run(id, cutoff) || {}).changes) > 0) purged++;
    return { ids, purged };
  }
  // Sessions of a soft-deleted cadence are hidden with it (A-19c).
  const LIVE_CAD = `cadence_id IN (SELECT id FROM meeting_cadences WHERE deleted_at IS NULL)`;

  // ── sessions ──────────────────────────────────────────────────────────────────────
  const sesRow = (r) => r && ({ ...r, id: Number(r.id), cadence_id: Number(r.cadence_id), agenda: P_(r.agenda, null), items: P_(r.items, []), attendees: P_(r.attendees, []) });
  async function listSessions({ cadenceId = null, status = null, limit = 50 } = {}) {
    const where = [LIVE_CAD], args = [];
    if (cadenceId) { where.push('cadence_id=?'); args.push(Number(cadenceId)); }
    if (status) { const st = Array.isArray(status) ? status : [status]; where.push(`status IN (${st.map(() => '?').join(',')})`); args.push(...st); }
    const rows = await P(`SELECT id, cadence_id, scheduled_at, status, started_at, closed_at, closed_by, minutes_sent_at, minutes_accepted_at, minutes_accepted_by, cancelled_at, cancel_reason, exception_status, created_by, created_at FROM meeting_sessions WHERE ${where.join(' AND ')} /* always carries LIVE_CAD (deleted_at) */ ORDER BY scheduled_at DESC LIMIT ${Math.max(1, Math.min(500, Math.floor(Number(limit)) || 50))}`).all(...args);
    return rows.map(r => ({ ...r, id: Number(r.id), cadence_id: Number(r.cadence_id) }));
  }
  async function getSession(id) { return sesRow(await P(`SELECT * FROM meeting_sessions WHERE id=? AND cadence_id IN (SELECT id FROM meeting_cadences WHERE deleted_at IS NULL)`).get(Number(id))); }
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
  // UAT (PMO F2): actions agreed in a session follow the site between meetings — open ones of a cadence
  // (for the next agenda) and of a site (for the site obligations).
  async function openSessionActions({ cadenceId = null, siteId = null } = {}) {
    const where = [`a.status NOT IN ('done','cancelled')`, 'c.deleted_at IS NULL']; const args = [];
    if (cadenceId != null) { where.push('s.cadence_id = ?'); args.push(Number(cadenceId)); }
    if (siteId != null) { where.push('c.site_id = ?'); args.push(Number(siteId)); }
    return (await P(`SELECT a.*, s.cadence_id, s.scheduled_at AS session_at, c.name AS cadence_name, c.site_id FROM session_actions a JOIN meeting_sessions s ON s.id = a.session_id JOIN meeting_cadences c ON c.id = s.cadence_id WHERE ${where.join(' AND ')} ORDER BY a.due_date NULLS LAST, a.id LIMIT 500`).all(...args))
      .map(r => ({ ...r, id: Number(r.id), session_id: Number(r.session_id), cadence_id: Number(r.cadence_id) }));
  }
  async function sessionActions(sessionId) { return (await P(`SELECT * FROM session_actions WHERE session_id=? ORDER BY id`).all(Number(sessionId))).map(r => ({ ...r, id: Number(r.id), session_id: Number(r.session_id) })); }
  // A repeated idem_key in the same session returns the first row (a double tap on a slow link — field P1-4).
  const idemOf = (x) => (x && x.idem_key ? str(String(x.idem_key).trim(), 80) || null : null);
  const isDup = (e) => e && (e.code === '23505' || /unique|duplicate/i.test(String(e.message)));
  async function addSessionAction(sessionId, a, { user } = {}) {
    if (!a || !a.title) throw Object.assign(new Error('action title is required'), { code: 'INVALID' });
    const idem = idemOf(a);
    const again = async () => { const r = await P(`SELECT id FROM session_actions WHERE session_id=? AND idem_key=?`).get(Number(sessionId), idem); return r ? (await sessionActions(sessionId)).find(x => x.id === Number(r.id)) : null; };
    if (idem) { const ex = await again(); if (ex) return ex; }
    let id;
    try {
      id = await insert('session_actions', ['session_id', 'title', 'owner', 'due_date', 'status', 'source_kind', 'source_ref', 'decision_ref', 'idem_key', 'created_by', 'created_at', 'updated_at'],
        [Number(sessionId), str(a.title, 500), str(a.owner, 120), str(a.due_date, 10), 'open', str(a.source_kind, 40), str(a.source_ref, 120), str(a.decision_ref, 40), idem, user ? user.id : null, now(), now()]);
    } catch (e) { if (idem && isDup(e)) return again(); throw e; }
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
    const rows = (await P(`SELECT * FROM decisions${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(2000, Math.floor(Number(limit)) || 500))}`).all(...args)).map(decRow);
    return Array.isArray(siteIds) ? rows.filter(d => d.site_id == null || siteIds.includes(d.site_id)) : rows;
  }
  async function addDecision(d, { user } = {}) {
    if (!d || !d.title) throw Object.assign(new Error('decision title is required'), { code: 'INVALID' });
    const idem = d.session_id != null ? idemOf(d) : null;
    const again = async () => decRow(await P(`SELECT * FROM decisions WHERE session_id=? AND idem_key=?`).get(Number(d.session_id), idem));
    if (idem) { const ex = await again(); if (ex) return ex; }
    const ref = await nextRef('decisions', 'DEC', (d.date || now()).slice(0, 4));
    let id;
    try {
      id = await insert('decisions', ['ref', 'session_id', 'title', 'text', 'owner', 'due_date', 'status', 'source_kind', 'source_ref', 'site_id', 'idem_key', 'created_by', 'created_at', 'updated_at'],
        [ref, num(d.session_id), str(d.title, 300), str(d.text), str(d.owner, 120), str(d.due_date, 10), 'open', str(d.source_kind, 40), str(d.source_ref, 120), num(d.site_id), idem, user ? user.id : null, now(), now()]);
    } catch (e) { if (idem && isDup(e)) return again(); throw e; }
    return decRow(await P(`SELECT * FROM decisions WHERE id=?`).get(id));
  }
  async function getDecision(id) { return decRow(await P(`SELECT * FROM decisions WHERE id=?`).get(Number(id))); }
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
    const rows = (await P(`SELECT * FROM rfi_requests${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(2000, Math.floor(Number(limit)) || 500))}`).all(...args)).map(rfiRow);
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
  async function getRfi(id) { return rfiRow(await P(`SELECT * FROM rfi_requests WHERE id=?`).get(Number(id))); }
  /** UAT (PMO F5): only the requester confirms a delivered request — `delivered → verified`. */
  async function verifyRfi(id, { user }) {
    const r = await getRfi(id);
    if (!r) throw Object.assign(new Error('request not found'), { code: 'NOT_FOUND', status: 404 });
    if (!user || Number(r.requester_id) !== Number(user.id)) throw Object.assign(new Error('only the requester confirms the delivery'), { code: 'FORBIDDEN', status: 403 });
    if (r.status !== 'delivered') throw Object.assign(new Error('only a delivered request can be confirmed'), { code: 'STATE', status: 409 });
    await updateRow('rfi_requests', id, { status: 'verified' }, ['status']);
    return getRfi(id);
  }
  async function triageRfi(id, patch, opts = {}) {
    if (patch && patch.status === 'verified') throw Object.assign(new Error('verified is set by the requester (POST /rfi/:id/verify)'), { code: 'INVALID' });
    const p = {}; const clamp = (v) => Math.min(3, Math.max(1, Number(v)));
    for (const k of ['impact', 'effort', 'data_risk']) if (patch[k] != null) p[k] = clamp(patch[k]);
    if (patch.status) { if (!RFI_STATUSES.includes(patch.status)) throw Object.assign(new Error('bad RFI status'), { code: 'INVALID' }); p.status = patch.status; }
    if (patch.decision !== undefined) { p.decision = str(patch.decision); p.decided_at = now(); }
    const before = await getRfi(id);
    await updateRow('rfi_requests', id, p, Object.keys(p));
    // G14 — decision provenance: every status / decision change is kept (append-only ledger), never overwritten
    if (before && (p.status !== undefined && p.status !== before.status || p.decision !== undefined)) {
      await ppmEvent({ entity: 'rfi', entity_id: id, action: 'triage', field: 'status', old_value: before.status, new_value: p.status || before.status, note: p.decision !== undefined ? p.decision : null }, opts.user);
    }
    return rfiRow(await P(`SELECT * FROM rfi_requests WHERE id=?`).get(Number(id)));
  }

  // ── portfolio ─────────────────────────────────────────────────────────────────────
  const idRow = (r) => r && ({ ...r, id: Number(r.id) });
  const taskRow = (r) => r && ({ ...idRow(r), project_id: Number(r.project_id), parent_id: r.parent_id == null ? null : Number(r.parent_id), duration_days: num(r.duration_days), allocation_pct: num(r.allocation_pct), progress_pct: num(r.progress_pct), effort_hours: num(r.effort_hours), depends_on: P_(r.depends_on, []) });
  const RISK_KINDS = ['risk', 'issue', 'assumption'];   // A-14 RAID (dependencies live in depends_on, decisions in DEC-…)
  const riskRow = (r) => ({ ...idRow(r), project_id: Number(r.project_id), probability: Number(r.probability), impact: Number(r.impact), kind: r.kind || 'risk' });
  const projectRow = (r) => ({ ...idRow(r), objective_id: Number(r.objective_id), site_id: r.site_id == null ? null : Number(r.site_id), progress_pct: num(r.progress_pct), budget: num(r.budget), spent: num(r.spent), depends_on: P_(r.depends_on, []), rfi_id: r.rfi_id == null ? null : Number(r.rfi_id) });
  // B-08 — expected / realised benefits (migration 056). Values are numbers or null; money values are stripped by the route.
  const benefitRow = (r) => r && ({ ...idRow(r), project_id: Number(r.project_id), baseline_value: num(r.baseline_value), target_value: num(r.target_value), realised_value: num(r.realised_value),
    realised_by: r.realised_by == null ? null : Number(r.realised_by), verified_by: r.verified_by == null ? null : Number(r.verified_by), sort_order: num(r.sort_order), value_kind: r.value_kind || 'quantity' });
  const BENEFIT_TERMS = ['measure', 'unit', 'value_kind', 'currency', 'baseline_value', 'target_value'];   // a change clears a verification
  const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'];
  const SPEND_TYPES = ['capex', 'opex', 'mixed'];
  const FINANCE_FIELDS = ['budget', 'spent', 'currency', 'spend_type'];
  const ROLE_FIELDS = ['owner', 'sponsor'];
  /** G11/G12/G14 — one append-only, hash-chained ledger for gate passages, financial edits and RFI decisions. */
  async function ppmEvent(e, user) {
    await insert('ppm_events', ['entity', 'entity_id', 'action', 'field', 'old_value', 'new_value', 'currency', 'note', 'actor_id', 'actor', 'at'],
      [String(e.entity), Number(e.entity_id), String(e.action), e.field || null, e.old_value == null ? null : String(e.old_value), e.new_value == null ? null : String(e.new_value), e.currency || null, str(e.note, 2000), user && user.id != null ? Number(user.id) : null, user ? String(user.username || user.full_name || '') : null, now()]);
  }
  async function ppmEvents(entity, id) { return (await P(`SELECT entity, entity_id, action, field, old_value, new_value, currency, note, actor_id, actor, at FROM ppm_events WHERE entity=? AND entity_id=? ORDER BY id`).all(String(entity), Number(id))).map(r => ({ ...r, entity_id: Number(r.entity_id), actor_id: r.actor_id == null ? null : Number(r.actor_id) })); }
  // A-19c — every kind is read live only (deleted_at IS NULL) and a child whose parent chain holds a deleted node is
  // dropped too (programme → objective → project → plan elements; task → parent task). The children are never stamped.
  async function portfolio() {
    const programmes = (await P(`SELECT * FROM portfolio_programmes WHERE deleted_at IS NULL ORDER BY name`).all()).map(idRow);
    const progIds = new Set(programmes.map(r => r.id));
    const objectives = (await P(`SELECT * FROM portfolio_objectives WHERE deleted_at IS NULL ORDER BY programme_id, sort_order, name`).all()).map(r => ({ ...idRow(r), programme_id: Number(r.programme_id), weight: num(r.weight), progress_pct: num(r.progress_pct), evidence_target: num(r.evidence_target), evidence_hib: Number(r.evidence_hib) !== 0 }))
      .filter(o => progIds.has(o.programme_id));
    const objIds = new Set(objectives.map(r => r.id));
    const projects = (await P(`SELECT * FROM portfolio_projects WHERE deleted_at IS NULL ORDER BY objective_id, start_date, name`).all()).map(projectRow)
      .filter(p => objIds.has(Number(p.objective_id)));
    const projIds = new Set(projects.map(r => r.id));
    const live = (r) => projIds.has(Number(r.project_id));
    const milestones = (await P(`SELECT * FROM portfolio_milestones WHERE deleted_at IS NULL ORDER BY project_id, sort_order, due_date`).all()).map(r => ({ ...idRow(r), project_id: Number(r.project_id) })).filter(live);
    const deliverables = (await P(`SELECT * FROM portfolio_deliverables WHERE deleted_at IS NULL ORDER BY project_id, sort_order`).all()).map(r => ({ ...idRow(r), project_id: Number(r.project_id), milestone_id: r.milestone_id == null ? null : Number(r.milestone_id) })).filter(live);
    const risks = (await P(`SELECT * FROM portfolio_risks WHERE deleted_at IS NULL ORDER BY project_id, id`).all()).map(riskRow).filter(live);
    const tasks = _liveTaskTree((await P(`SELECT * FROM portfolio_tasks WHERE deleted_at IS NULL ORDER BY project_id, sort_order, id`).all()).map(taskRow).filter(live));
    const project_sites = (await allProjectSites()).filter(live);
    // B-08 benefits carry no deleted_at of their own: they follow their project (hidden when it or an ancestor is deleted).
    const benefits = (await P(`SELECT * FROM portfolio_benefits ORDER BY project_id, sort_order, id`).all()).map(benefitRow).filter(live);
    return { programmes, objectives, projects, milestones, deliverables, risks, tasks, project_sites, benefits };
  }
  /** Drops tasks whose parent task is not in the list (deleted, or itself dropped). */
  function _liveTaskTree(tasks) {
    let keep = tasks, changed = true;
    while (changed) { const ids = new Set(keep.map(t => Number(t.id))); const next = keep.filter(t => t.parent_id == null || ids.has(Number(t.parent_id))); changed = next.length !== keep.length; keep = next; }
    return keep;
  }
  /** A-19c — true when the project or any ancestor (objective, programme) is soft-deleted, or it does not exist. */
  async function _projectGone(pid) {
    const r = await P(`SELECT p.deleted_at AS p, o.deleted_at AS o, g.deleted_at AS g FROM portfolio_projects p
      JOIN portfolio_objectives o ON o.id = p.objective_id JOIN portfolio_programmes g ON g.id = o.programme_id WHERE p.id=?`).get(Number(pid));
    return !r || !!(r.p || r.o || r.g);
  }
  /** The deleted_at of the first deleted node in a project's chain (for the 409 message). */
  async function _goneSince(pid) {
    const r = await P(`SELECT p.deleted_at AS p, o.deleted_at AS o, g.deleted_at AS g FROM portfolio_projects p
      JOIN portfolio_objectives o ON o.id = p.objective_id JOIN portfolio_programmes g ON g.id = o.programme_id WHERE p.id=?`).get(Number(pid));
    return r ? (r.p || r.o || r.g) : null;
  }
  // A-15 — extra sites of a project (migration 043); the primary site stays portfolio_projects.site_id.
  const siteRow = (r) => ({ project_id: Number(r.project_id), site_id: Number(r.site_id) });
  async function allProjectSites() { return (await P(`SELECT project_id, site_id FROM portfolio_project_sites ORDER BY project_id, site_id`).all()).map(siteRow); }
  async function projectSites(projectId) { return (await P(`SELECT site_id FROM portfolio_project_sites WHERE project_id=? ORDER BY site_id`).all(Number(projectId))).map(r => Number(r.site_id)); }
  /** Replace the extra sites of a project in one transaction; the ledger keeps the before/after list. */
  async function setProjectSites(projectId, siteIds, { user } = {}) {
    const id = Number(projectId);
    const ids = [...new Set((siteIds || []).map(Number))].sort((a, b) => a - b);
    if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw Object.assign(new Error('site_ids must be positive integers'), { code: 'INVALID', status: 400 });
    return tx(async () => {
      if (!(await P(`SELECT id FROM portfolio_projects WHERE id=? AND deleted_at IS NULL`).get(id))) throw Object.assign(new Error('project not found'), { code: 'NOT_FOUND', status: 404 });
      const before = await projectSites(id);
      await P(`DELETE FROM portfolio_project_sites WHERE project_id=?`).run(id);
      for (const s of ids) await P(`INSERT INTO portfolio_project_sites (project_id, site_id) VALUES (?, ?)`).run(id, s);
      await ppmEvent({ entity: 'project', entity_id: id, action: 'sites_edit', field: 'site_ids', old_value: before.join(','), new_value: ids.join(',') }, user);
      return ids;
    });
  }
  /** The project row a plan element (task / milestone / risk / deliverable) belongs to — for the access guard. */
  async function getProject(id) { if (await _projectGone(id)) return null; const r = await P(`SELECT id, site_id, owner, objective_id FROM portfolio_projects WHERE id=? AND deleted_at IS NULL`).get(Number(id)); return r ? { ...r, id: Number(r.id), site_id: r.site_id == null ? null : Number(r.site_id) } : null; }
  /**
   * A-14 — one project with the same shapes portfolio() returns, read by project_id (never a filter over the whole
   * portfolio), plus the counts the stage gates need. Null when the project does not exist.
   */
  async function projectDetail(id) {
    const pid = Number(id);
    if (await _projectGone(pid)) return null;   // A-19c — a soft-deleted project (or ancestor) reads as missing
    const r = await P(`SELECT * FROM portfolio_projects WHERE id=? AND deleted_at IS NULL`).get(pid);
    if (!r) return null;
    const project = projectRow(r);
    const milestones = (await P(`SELECT * FROM portfolio_milestones WHERE project_id=? AND deleted_at IS NULL ORDER BY sort_order, due_date`).all(pid)).map(m => ({ ...idRow(m), project_id: Number(m.project_id) }));
    const deliverables = (await P(`SELECT * FROM portfolio_deliverables WHERE project_id=? AND deleted_at IS NULL ORDER BY sort_order`).all(pid)).map(d => ({ ...idRow(d), project_id: Number(d.project_id), milestone_id: d.milestone_id == null ? null : Number(d.milestone_id) }));
    const risks = (await P(`SELECT * FROM portfolio_risks WHERE project_id=? AND deleted_at IS NULL ORDER BY id`).all(pid)).map(riskRow);
    const tasks = _liveTaskTree((await P(`SELECT * FROM portfolio_tasks WHERE project_id=? AND deleted_at IS NULL ORDER BY sort_order, id`).all(pid)).map(taskRow));
    const objective = await P(`SELECT id, key, name, programme_id FROM portfolio_objectives WHERE id=?`).get(project.objective_id);
    const benefits = await listBenefits(pid);
    return { project, objective: objective ? { ...idRow(objective), programme_id: Number(objective.programme_id) } : null, milestones, deliverables, risks, tasks, benefits, extra_sites: await projectSites(pid), gate_ctx: await gateCounts(pid) };
  }
  /** The counts the stage gates read: open tasks, open high (P×I >= 6) risks — only kind = 'risk' (today's rule). */
  async function gateCounts(id) {
    // A-19c: live tasks only — a sub-task of a soft-deleted task is hidden with it, so it does not block a gate either
    const openTasks = _liveTaskTree(await P(`SELECT id, parent_id, status FROM portfolio_tasks WHERE project_id=? AND deleted_at IS NULL`).all(Number(id)))
      .filter(t => !['done', 'cancelled'].includes(t.status)).length;
    const openRisksHigh = (await P(`SELECT probability, impact FROM portfolio_risks WHERE project_id=? AND deleted_at IS NULL AND status='open' AND COALESCE(kind,'risk')='risk'`).all(Number(id))).filter(r => Number(r.probability) * Number(r.impact) >= 6).length;
    return { openTasks, openRisksHigh };
  }
  async function planRow(kind, id) { const T = TABLES[kind]; if (!T || !T.cols.includes('project_id')) return null; const r = await P(`SELECT id, project_id FROM ${T.table} WHERE id=?${softDelete.TABLES[T.table] ? ' AND deleted_at IS NULL' : ''}`).get(Number(id)); /* benefits have no deleted_at: they follow their project */ return r && !(await _projectGone(r.project_id)) ? { id: Number(r.id), project_id: Number(r.project_id) } : null; }
  const TABLES = {
    programme: { table: 'portfolio_programmes', cols: ['key', 'name', 'sponsor', 'description', 'status'], req: ['key', 'name'] },
    objective: { table: 'portfolio_objectives', cols: ['programme_id', 'key', 'name', 'weight', 'owner', 'target_date', 'status', 'confidence', 'progress_pct', 'evidence_metric', 'evidence_target', 'evidence_hib', 'manual_evidence', 'sort_order'], req: ['programme_id', 'key', 'name'] },
    project: { table: 'portfolio_projects', cols: ['objective_id', 'key', 'name', 'owner', 'site_id', 'start_date', 'end_date', 'baseline_end', 'status', 'confidence', 'progress_pct', 'budget', 'spent', 'currency', 'depends_on', 'charter', 'sponsor', 'baseline_start', 'forecast_end', 'actual_start', 'actual_end', 'spend_type'], req: ['objective_id', 'key', 'name'] },
    task: { table: 'portfolio_tasks', cols: ['project_id', 'parent_id', 'wbs_code', 'name', 'owner', 'start_date', 'end_date', 'baseline_start', 'baseline_end', 'forecast_end', 'actual_start', 'actual_end', 'duration_days', 'allocation_pct', 'status', 'depends_on', 'sort_order', 'progress_pct', 'effort_hours'], req: ['project_id', 'name'] },
    milestone: { table: 'portfolio_milestones', cols: ['project_id', 'name', 'due_date', 'baseline_date', 'done_at', 'status', 'sort_order', 'owner'], req: ['project_id', 'name'] },
    deliverable: { table: 'portfolio_deliverables', cols: ['project_id', 'milestone_id', 'name', 'owner', 'due_date', 'status', 'action_kind', 'action_ref', 'sort_order', 'closed_at'], req: ['project_id', 'name'] },
    benefit: { table: 'portfolio_benefits', cols: ['project_id', 'description', 'measure', 'unit', 'value_kind', 'currency', 'baseline_value', 'target_value', 'owner', 'review_date', 'sort_order'], req: ['project_id', 'description'] },
    risk: { table: 'portfolio_risks', cols: ['project_id', 'title', 'probability', 'impact', 'mitigation', 'owner', 'status', 'incident_ref', 'closed_at', 'kind'], req: ['project_id', 'title'] },
  };
  function normalise(kind, body) {
    const out = {};
    for (const c of TABLES[kind].cols) if (body[c] !== undefined) {
      let v = body[c];
      if (c === 'depends_on') v = J(Array.isArray(v) ? v.map(Number) : []);
      else if (c === 'evidence_hib') v = v === false || v === 0 ? 0 : 1;
      else if (/_id$|^sort_order$|^probability$|^impact$|^duration_days$|^allocation_pct$|^effort_hours$/.test(c)) v = num(v);
      else if (/pct$|^weight$|^budget$|^spent$|evidence_target|_value$/.test(c)) v = num(v);
      else if (c === 'review_date') v = _day(v);
      else v = str(v, c === 'description' || c === 'mitigation' || c === 'manual_evidence' ? 4000 : 300);
      out[c] = v;
    }
    if (kind === 'project' && out.status && !PROJECT_STATUSES.includes(out.status)) throw Object.assign(new Error('bad project status'), { code: 'INVALID' });
    if (kind === 'task' && out.status && !TASK_STATUSES.includes(out.status)) throw Object.assign(new Error('task status must be ' + TASK_STATUSES.join(' | ')), { code: 'INVALID' });
    if (kind === 'task' && out.allocation_pct != null && !(out.allocation_pct >= 0 && out.allocation_pct <= 100)) throw Object.assign(new Error('allocation_pct must be 0..100'), { code: 'INVALID' });
    if (kind === 'task' && out.progress_pct != null && !(out.progress_pct >= 0 && out.progress_pct <= 100)) throw Object.assign(new Error('progress_pct must be 0..100'), { code: 'INVALID' });
    if (kind === 'task' && out.effort_hours != null && !(Number.isFinite(out.effort_hours) && out.effort_hours >= 0)) throw Object.assign(new Error('effort_hours must be a positive number (leave empty when unknown)'), { code: 'INVALID' });
    if (kind === 'risk' && body.kind !== undefined && !RISK_KINDS.includes(out.kind)) throw Object.assign(new Error('kind must be ' + RISK_KINDS.join(' | ')), { code: 'INVALID' });
    if (kind === 'project' && out.spend_type && !SPEND_TYPES.includes(out.spend_type)) throw Object.assign(new Error('spend_type must be capex | opex | mixed'), { code: 'INVALID' });
    if (kind === 'project' && out.currency != null && !/^[A-Z]{3}$/.test(out.currency)) throw Object.assign(new Error('currency must be an ISO code such as USD or XOF'), { code: 'INVALID' });
    if (kind === 'project' && ['budget', 'spent'].some(k => out[k] != null && !(Number.isFinite(out[k]) && out[k] >= 0))) throw Object.assign(new Error('budget and spent must be positive numbers (leave empty when unknown)'), { code: 'INVALID' });
    if (kind === 'benefit') {
      const BV = require('./portfolioBenefits');
      if (out.value_kind != null && !BV.VALUE_KINDS.includes(out.value_kind)) throw Object.assign(new Error('value_kind must be ' + BV.VALUE_KINDS.join(' | ')), { code: 'INVALID' });
      if (out.currency != null && !/^[A-Z]{3}$/.test(out.currency)) throw Object.assign(new Error('currency must be an ISO code such as USD or XOF'), { code: 'INVALID' });
      if (['baseline_value', 'target_value'].some(k => out[k] != null && !Number.isFinite(out[k]))) throw Object.assign(new Error('baseline and target must be numbers (leave empty when unknown)'), { code: 'INVALID' });
      if (out.description !== undefined && !String(out.description || '').trim()) throw Object.assign(new Error('description is required'), { code: 'INVALID' });
    }
    if (out.confidence && !CONFIDENCE.includes(out.confidence)) throw Object.assign(new Error('confidence must be low | medium | high'), { code: 'INVALID' });
    return out;
  }
  async function upsertPortfolio(kind, body, opts = {}) {
    const T = TABLES[kind]; if (!T) throw Object.assign(new Error('unknown portfolio entity'), { code: 'INVALID' });
    const vals = normalise(kind, body || {});
    const id = body && body.id ? Number(body.id) : null;
    // G11 — dependencies must exist, stay inside their family (projects / tasks of the same project) and never loop
    if ((kind === 'project' || kind === 'task') && body && body.depends_on !== undefined) {
      const S = require('./projectSchedule');
      let siblings;
      if (kind === 'project') siblings = (await P(`SELECT id, depends_on FROM portfolio_projects`).all()).map(r => ({ id: Number(r.id), depends_on: P_(r.depends_on, []) }));
      else { const pid = vals.project_id != null ? vals.project_id : id ? Number((await P(`SELECT project_id FROM portfolio_tasks WHERE id=?`).get(id) || {}).project_id) : null; siblings = (await P(`SELECT id, depends_on FROM portfolio_tasks WHERE project_id=?`).all(pid)).map(r => ({ id: Number(r.id), depends_on: P_(r.depends_on, []) })); }
      const prob = S.dependencyProblem(siblings, id, P_(vals.depends_on, []));
      if (prob) throw Object.assign(new Error(prob.error), { code: 'INVALID', reason: prob.code });
    }
    // A-19c — a soft-deleted node (or one under a deleted project) is not editable until restored; benefits (no
    // deleted_at column, B-08) follow their project.
    if (id && softDelete.TABLES[T.table]) { const ex = await P(`SELECT id, deleted_at FROM ${T.table} WHERE id=?`).get(id); if (ex && ex.deleted_at) throw softDelete.deletedConflict(kind, ex); }
    if (T.cols.includes('project_id')) {
      let pid = vals.project_id;
      if (pid == null && id) { const cur = await P(`SELECT project_id FROM ${T.table} WHERE id=?`).get(id); pid = cur ? cur.project_id : null; }
      if (pid != null && (await P(`SELECT id FROM portfolio_projects WHERE id=?`).get(Number(pid))) && await _projectGone(pid)) throw softDelete.deletedConflict('project', { deleted_at: await _goneSince(pid) });
    }
    if (id && kind === 'benefit') {
      const before = await getBenefit(id);
      if (!before) throw Object.assign(new Error('benefit not found'), { code: 'NOT_FOUND', status: 404 });
      delete vals.project_id;   // a benefit never moves to another project
      await updateRow(T.table, id, vals, T.cols);
      // the terms a verification vouched for changed → the verification no longer holds
      const termsChanged = BENEFIT_TERMS.some(k => vals[k] !== undefined && String(vals[k] ?? '') !== String(before[k] ?? ''));
      if (termsChanged && before.verified_at) {
        await P(`UPDATE portfolio_benefits SET verified_by=NULL, verified_by_name=NULL, verified_at=NULL WHERE id=?`).run(Number(id));
        await ppmEvent({ entity: 'project', entity_id: before.project_id, action: 'benefit_unverified', field: `benefit:${id}`, note: 'terms changed after verification' }, opts.user);
      }
      return id;
    }
    if (id) {
      if (kind === 'project') {
        const before = await P(`SELECT * FROM portfolio_projects WHERE id=?`).get(id);
        if (!before) throw Object.assign(new Error('project not found'), { code: 'NOT_FOUND', status: 404 });
        // the baseline is frozen once the project passed its approval gate (a re-baseline is a decision, not an edit)
        const gated = ['in_progress', 'on_hold', 'closure', 'closed'].includes(before.stage);
        const changed = (k) => vals[k] !== undefined && String(vals[k] || '') !== String(before[k] || '');
        if (gated && ['baseline_end', 'baseline_start'].some(changed)) throw Object.assign(new Error('the baseline is frozen after approval'), { code: 'CONFLICT', status: 409, reason: 'BASELINE_FROZEN' });
        // separation of duties: once the approval gate is reached, who owns and who sponsors cannot be swapped
        // around an approval, and the status follows the stage (only a gate passage moves it)
        if ((before.stage && before.stage !== 'proposal' && changed('owner')) || (gated && changed('sponsor'))) throw Object.assign(new Error('the owner is fixed once the project is submitted for approval, the sponsor once it is approved'), { code: 'CONFLICT', status: 409, reason: 'ROLES_FROZEN' });
        if (before.stage && before.stage !== 'proposal' && changed('status')) throw Object.assign(new Error('the status follows the stage gates — use the stage action'), { code: 'CONFLICT', status: 409, reason: 'STATUS_BY_STAGE' });
        await updateRow(T.table, id, vals, T.cols);
        // G12 — every financial edit is kept with its old and new value
        const same = (f) => (['budget', 'spent'].includes(f) ? (vals[f] == null ? before[f] == null : before[f] != null && Number(before[f]) === Number(vals[f])) : String(vals[f] ?? '') === String(before[f] ?? ''));
        for (const f of ROLE_FIELDS) if (changed(f)) await ppmEvent({ entity: 'project', entity_id: id, action: 'role_edit', field: f, old_value: before[f], new_value: vals[f], note: opts.reason || null }, opts.user);
        for (const f of FINANCE_FIELDS) if (vals[f] !== undefined && !same(f)) await ppmEvent({ entity: 'project', entity_id: id, action: 'finance_edit', field: f, old_value: before[f], new_value: vals[f], currency: vals.currency || before.currency, note: opts.reason || null }, opts.user);
        return id;
      }
      await updateRow(T.table, id, vals, T.cols); return id;
    }
    for (const r of T.req) if (vals[r] == null || vals[r] === '') throw Object.assign(new Error(`${r} is required`), { code: 'INVALID' });
    const nid = await insert(T.table, [...Object.keys(vals), 'created_at', 'updated_at'], [...Object.values(vals), now(), now()]);
    if (kind === 'project') for (const f of FINANCE_FIELDS) if (vals[f] != null) await ppmEvent({ entity: 'project', entity_id: nid, action: 'finance_edit', field: f, old_value: null, new_value: vals[f], currency: vals.currency || 'USD' }, opts.user);
    return nid;
  }
  // ── B-08 benefits: realised value + independent verification (catalogue A09) ──────────
  // A-19 — benefits have no deleted_at: they follow their project (a deleted project or ancestor hides them).
  async function listBenefits(projectId) { if (await _projectGone(projectId)) return []; return (await P(`SELECT * FROM portfolio_benefits WHERE project_id=? ORDER BY sort_order, id`).all(Number(projectId))).map(benefitRow); }
  // A-19: a benefit follows its project — writing to one whose project chain is soft-deleted is a 409, not a 404
  async function _benefitOfGoneProject(id) {
    const r = await P(`SELECT project_id FROM portfolio_benefits WHERE id=?`).get(Number(id));
    if (r && await _projectGone(r.project_id)) throw softDelete.deletedConflict('project', { deleted_at: await _goneSince(r.project_id) });
  }
  async function getBenefit(id) { const r = await P(`SELECT * FROM portfolio_benefits WHERE id=?`).get(Number(id)); return r && !(await _projectGone(r.project_id)) ? benefitRow(r) : null; }
  const actorName = (u) => (u ? String(u.full_name || u.username || '') || null : null);
  /** Record the realised value with its evidence link; clears any earlier verification. */
  async function recordBenefitRealised(id, body, { user } = {}) {
    await _benefitOfGoneProject(id);
    const BV = require('./portfolioBenefits');
    const b = await getBenefit(id);
    if (!b) throw Object.assign(new Error('benefit not found'), { code: 'NOT_FOUND', status: 404 });
    const v = num(body && body.realised_value);
    if (v == null || !Number.isFinite(v)) throw Object.assign(new Error('realised_value must be a number'), { code: 'INVALID' });
    if (!BV.evidenceLinkOk(body && body.evidence_link)) throw Object.assign(new Error('evidence_link must be an http(s) link to the evidence'), { code: 'INVALID' });
    const link = String(body.evidence_link).trim(); const note = str(body && body.note, 2000);
    return tx(async () => {
      await P(`UPDATE portfolio_benefits SET realised_value=?, evidence_link=?, realised_note=?, realised_by=?, realised_by_name=?, realised_at=?, verified_by=NULL, verified_by_name=NULL, verified_at=NULL, updated_at=? WHERE id=?`)
        .run(v, link, note, user && user.id != null ? Number(user.id) : null, actorName(user), now(), now(), Number(id));
      await ppmEvent({ entity: 'project', entity_id: b.project_id, action: 'benefit_realised', field: `benefit:${id}`, old_value: b.realised_value, new_value: v, currency: b.value_kind === 'money' ? b.currency : null, note: link }, user);
      return getBenefit(id);
    });
  }
  /** Verify the realised value — never by the person who entered it (SELF_REVIEW, 403). */
  async function verifyBenefit(id, { user } = {}) {
    await _benefitOfGoneProject(id);
    const b = await getBenefit(id);
    if (!b) throw Object.assign(new Error('benefit not found'), { code: 'NOT_FOUND', status: 404 });
    if (b.realised_value == null) throw Object.assign(new Error('no realised value to verify yet'), { code: 'CONFLICT', status: 409, reason: 'NOT_REALISED' });
    const uid = user && user.id != null ? Number(user.id) : null;
    if (uid == null || b.realised_by == null || uid === b.realised_by) throw Object.assign(new Error('the person who entered the realised value cannot verify it'), { code: 'SELF_REVIEW', status: 403, expose: true, reason: 'SELF_REVIEW' });
    return tx(async () => {
      await P(`UPDATE portfolio_benefits SET verified_by=?, verified_by_name=?, verified_at=?, updated_at=? WHERE id=?`).run(uid, actorName(user), now(), now(), Number(id));
      await ppmEvent({ entity: 'project', entity_id: b.project_id, action: 'benefit_verified', field: `benefit:${id}`, new_value: b.realised_value, currency: b.value_kind === 'money' ? b.currency : null }, user);
      return getBenefit(id);
    });
  }
  /** Benefits of the projects of one site (primary or extra site) whose review date is reached and that are not verified. */
  async function dueBenefitReviews({ siteId, asOf }) {
    const rows = await P(`SELECT b.*, p.key AS project_key, p.name AS project_name FROM portfolio_benefits b JOIN portfolio_projects p ON p.id = b.project_id
      JOIN portfolio_objectives o ON o.id = p.objective_id JOIN portfolio_programmes g ON g.id = o.programme_id
      WHERE p.deleted_at IS NULL AND o.deleted_at IS NULL AND g.deleted_at IS NULL AND b.verified_at IS NULL AND b.review_date IS NOT NULL AND b.review_date <= ? AND (p.site_id = ? OR EXISTS (SELECT 1 FROM portfolio_project_sites s WHERE s.project_id = p.id AND s.site_id = ?))
      ORDER BY b.review_date, b.id`).all(String(asOf).slice(0, 10), Number(siteId), Number(siteId));
    return rows.map(r => ({ ...benefitRow(r), project_key: r.project_key, project_name: r.project_name }));
  }
  /** G11 — stage gate passage (rules in services/projectSchedule.stageGate), recorded in the ledger. */
  // A-27 — captureBaseline: the caller (route) passes report_config ppm_baseline_versions === '1'; the store reads no config.
  async function moveProjectStage(id, to, { user, note, captureBaseline = false } = {}) {
    const p = await P(`SELECT * FROM portfolio_projects WHERE id=? AND deleted_at IS NULL`).get(Number(id));   // A-19c
    if (!p) throw Object.assign(new Error('project not found'), { code: 'NOT_FOUND', status: 404 });
    const { openTasks, openRisksHigh } = await gateCounts(id);
    const err = require('./projectSchedule').stageGate(p, to, user, { openTasks, openRisksHigh, note });
    if (err) throw Object.assign(new Error(err.error), { code: 'CONFLICT', status: 409, reason: err.code });
    const statusFor = { proposal: 'planned', approval: 'planned', in_progress: 'active', on_hold: 'on_hold', closure: 'active', closed: 'done' };
    const capture = !!captureBaseline && (p.stage || 'proposal') === 'approval' && to === 'in_progress';
    const move = async () => {
      await updateRow('portfolio_projects', id, { stage: to, status: statusFor[to] }, ['stage', 'status']);
      await ppmEvent({ entity: 'project', entity_id: id, action: 'stage', field: 'stage', old_value: p.stage, new_value: to, note }, user);
      if (capture) {
        // the plan approved at the gate becomes the task baselines where none was entered (never overwrites one)
        await P(`UPDATE portfolio_tasks SET baseline_start=COALESCE(baseline_start, start_date), baseline_end=COALESCE(baseline_end, end_date) WHERE project_id=? AND (baseline_start IS NULL OR baseline_end IS NULL)`).run(Number(id));
        const v = await writeBaseline(id, { user, approved: false, reason: note || null });
        await ppmEvent({ entity: 'project', entity_id: id, action: 'baseline_captured', field: 'baseline_version', old_value: null, new_value: v, note: 'approval gate' }, user);
      }
    };
    await (capture ? tx(move) : move());
    return P(`SELECT * FROM portfolio_projects WHERE id=?`).get(Number(id));
  }
  // ---- A-27 versioned baselines (portfolio_baselines, append-only, migration 045) -----------------------------------
  const BL = () => require('./ppmBaseline');
  const baselineRow = (r) => ({ id: Number(r.id), project_id: Number(r.project_id), version: Number(r.version), captured_at: r.captured_at, captured_by: r.captured_by == null ? null : Number(r.captured_by), approved_by: r.approved_by == null ? null : Number(r.approved_by), approved_by_name: r.approved_by_name || null, reason: r.reason || null, payload: P_(r.payload_json, null) });
  /** Snapshot the CURRENT stored plan as version max + 1. Must run inside the caller's transaction. */
  async function writeBaseline(projectId, { user, approved, reason }) {
    const pid = Number(projectId);
    const p = await P(`SELECT * FROM portfolio_projects WHERE id=?`).get(pid);
    // A-19: the snapshot holds the live plan only (soft-deleted tasks / milestones and orphaned sub-tasks are out)
    const tasks = _liveTaskTree((await P(`SELECT * FROM portfolio_tasks WHERE project_id=? AND deleted_at IS NULL ORDER BY sort_order, id`).all(pid)).map(taskRow));
    const ms = (await P(`SELECT * FROM portfolio_milestones WHERE project_id=? AND deleted_at IS NULL ORDER BY sort_order, due_date`).all(pid)).map(m => ({ ...idRow(m), project_id: Number(m.project_id) }));
    const max = await P(`SELECT MAX(version) AS v FROM portfolio_baselines WHERE project_id=?`).get(pid);
    const version = Number((max && max.v) || 0) + 1;
    await insert('portfolio_baselines', ['project_id', 'version', 'captured_at', 'captured_by', 'approved_by', 'approved_by_name', 'reason', 'payload_json'],
      [pid, version, now(), user && user.id != null ? Number(user.id) : null, approved && user && user.id != null ? Number(user.id) : null, approved && user ? String(user.full_name || user.username || '') : null, str(reason, 2000), J(BL().snapshotPayload(p, tasks, ms))]);
    return version;
  }
  /** Versions of one project (oldest first), or of every project when projectId is null. */
  async function listBaselines(projectId = null) {
    // A-19: baselines of a soft-deleted project (or ancestor) are kept (append-only) but not served
    if (projectId != null && await _projectGone(projectId)) return [];
    const rows = projectId == null ? await P(`SELECT b.* FROM portfolio_baselines b JOIN portfolio_projects p ON p.id = b.project_id
        JOIN portfolio_objectives o ON o.id = p.objective_id JOIN portfolio_programmes g ON g.id = o.programme_id
        WHERE p.deleted_at IS NULL AND o.deleted_at IS NULL AND g.deleted_at IS NULL ORDER BY b.project_id, b.version`).all() : await P(`SELECT * FROM portfolio_baselines WHERE project_id=? ORDER BY version`).all(Number(projectId));
    return rows.map(baselineRow);
  }
  /**
   * The ONLY way to move an approved baseline (the ordinary edit keeps refusing it with BASELINE_FROZEN).
   * body: { reason, project: { baseline_start|start_date, baseline_end|end_date }, tasks: [{ id, start_date, end_date }] }.
   * The route checks the committee role and the switch; this checks the rule (services/ppmBaseline.rebaselineCheck).
   */
  async function rebaseline(projectId, body = {}, { user } = {}) {
    const pid = Number(projectId);
    const p = (await _projectGone(pid)) ? null : await P(`SELECT * FROM portfolio_projects WHERE id=? AND deleted_at IS NULL`).get(pid);   // A-19
    if (!p) throw Object.assign(new Error('project not found'), { code: 'NOT_FOUND', status: 404 });
    const err = BL().rebaselineCheck(p, user, body.reason);
    if (err) throw Object.assign(new Error(err.error), { code: 'CONFLICT', status: 409, reason: err.code });
    const pj = body.project || {};
    const bs = pj.baseline_start !== undefined ? _day(pj.baseline_start) : pj.start_date !== undefined ? _day(pj.start_date) : undefined;
    const be = pj.baseline_end !== undefined ? _day(pj.baseline_end) : pj.end_date !== undefined ? _day(pj.end_date) : undefined;
    const tasks = (Array.isArray(body.tasks) ? body.tasks : []).map((t) => ({ id: Number(t && t.id), start: t && t.start_date !== undefined ? _day(t.start_date) : undefined, end: t && t.end_date !== undefined ? _day(t.end_date) : undefined }));
    if (tasks.some((t) => !Number.isInteger(t.id) || t.id <= 0)) throw Object.assign(new Error('every task needs its id'), { code: 'INVALID', status: 400 });
    const mine = new Set((await P(`SELECT id FROM portfolio_tasks WHERE project_id=? AND deleted_at IS NULL`).all(pid)).map((r) => Number(r.id)));
    if (tasks.some((t) => !mine.has(t.id))) throw Object.assign(new Error('a task does not belong to this project'), { code: 'INVALID', status: 400 });
    const newStart = bs === undefined ? p.baseline_start : bs, newEnd = be === undefined ? p.baseline_end : be;
    if (newStart && newEnd && newStart > newEnd) throw Object.assign(new Error('the baseline start is after its end'), { code: 'INVALID', status: 400 });
    return tx(async () => {
      await P(`UPDATE portfolio_projects SET baseline_start=?, baseline_end=?, updated_at=? WHERE id=?`).run(newStart || null, newEnd || null, now(), pid);
      for (const t of tasks) {
        if (t.start !== undefined) await P(`UPDATE portfolio_tasks SET baseline_start=?, updated_at=? WHERE id=? AND project_id=?`).run(t.start, now(), t.id, pid);
        if (t.end !== undefined) await P(`UPDATE portfolio_tasks SET baseline_end=?, updated_at=? WHERE id=? AND project_id=?`).run(t.end, now(), t.id, pid);
      }
      const version = await writeBaseline(pid, { user, approved: true, reason: String(body.reason).trim() });
      await ppmEvent({ entity: 'project', entity_id: pid, action: 'rebaseline', field: 'baseline_end', old_value: p.baseline_end, new_value: newEnd, note: `v${version}: ${String(body.reason).trim()}` }, user);
      return { version, baseline_start: newStart || null, baseline_end: newEnd || null };
    });
  }
  // ---- A-27 PPM exception alert dedup (ppm_alert_state) --------------------------------------------------------------
  async function alertStates() { return (await P(`SELECT * FROM ppm_alert_state`).all()).map((r) => ({ ...r, project_id: r.project_id == null ? null : Number(r.project_id) })); }
  async function saveAlertState(s) {
    const ex = await P(`SELECT item_key FROM ppm_alert_state WHERE item_key=?`).get(String(s.item_key));
    if (ex) await P(`UPDATE ppm_alert_state SET kind=?, project_id=?, first_seen=COALESCE(first_seen, ?), last_notified=?, cleared_at=? WHERE item_key=?`).run(String(s.kind), s.project_id == null ? null : Number(s.project_id), s.first_seen || null, s.last_notified || null, s.cleared_at || null, String(s.item_key));
    else await P(`INSERT INTO ppm_alert_state (item_key, kind, project_id, first_seen, last_notified, cleared_at) VALUES (?,?,?,?,?,?)`).run(String(s.item_key), String(s.kind), s.project_id == null ? null : Number(s.project_id), s.first_seen || null, s.last_notified || null, s.cleared_at || null);
  }
  /** G14 — an accepted request becomes at most ONE project, which keeps the link (unique index, migration 039). */
  async function rfiToProject(rfiId, body, { user } = {}) {
    const r = await getRfi(rfiId);
    if (!r) throw Object.assign(new Error('request not found'), { code: 'NOT_FOUND', status: 404 });
    if (!['accepted', 'scheduled'].includes(r.status)) throw Object.assign(new Error('only an accepted or scheduled request becomes a project'), { code: 'CONFLICT', status: 409 });
    const ex = await P(`SELECT id, key FROM portfolio_projects WHERE rfi_id=?`).get(Number(rfiId));
    if (ex) throw Object.assign(new Error(`request already became project ${ex.key}`), { code: 'CONFLICT', status: 409, project_id: Number(ex.id) });
    // one INSERT carries the link: a concurrent second conversion hits the unique index and leaves nothing behind
    const vals = normalise('project', { objective_id: body.objective_id, key: body.key, name: body.name || r.title, owner: body.owner, site_id: r.site_id, charter: body.charter || r.problem, status: 'planned' });
    for (const k of ['objective_id', 'key', 'name']) if (vals[k] == null || vals[k] === '') throw Object.assign(new Error(`${k} is required`), { code: 'INVALID' });
    let pid;
    try { pid = await insert('portfolio_projects', [...Object.keys(vals), 'rfi_id', 'created_at', 'updated_at'], [...Object.values(vals), Number(rfiId), now(), now()]); }
    catch (e) { if (/uq_portfolio_projects_rfi|unique/i.test(String(e.message))) throw Object.assign(new Error('request already became a project'), { code: 'CONFLICT', status: 409 }); throw e; }
    if (r.status === 'accepted') await updateRow('rfi_requests', rfiId, { status: 'scheduled' }, ['status']);
    await ppmEvent({ entity: 'rfi', entity_id: rfiId, action: 'to_project', field: 'project_id', old_value: null, new_value: pid, note: body.key }, user);
    return pid;
  }
  async function removePortfolio(kind, id, opts = {}) {
    const T = TABLES[kind]; if (!T) throw new Error('unknown portfolio entity');
    // a deleted project takes its budget with it: the ledger keeps what was removed and by whom
    if (kind === 'project') { const b = await P(`SELECT key, budget, spent, currency, stage FROM portfolio_projects WHERE id=?${opts.soft ? ' AND deleted_at IS NULL' : ''}`).get(Number(id)); if (b) await ppmEvent({ entity: 'project', entity_id: id, action: 'deleted', field: 'budget', old_value: b.budget, new_value: null, currency: b.currency, note: `${b.key} (stage ${b.stage}, spent ${b.spent == null ? 'unknown' : b.spent})${opts.soft ? ' — soft delete, restorable' : ''}` }, opts.user); }
    // A-19c — opts.soft (route: soft_delete_enabled) stamps the node; its subtree is hidden, not stamped. A kind whose
    // table has no deleted_at (B-08 benefit) keeps the hard delete — it follows its project instead.
    if (opts.soft && softDelete.TABLES[T.table]) return softDelete.stamp(db, T.table, Number(id), { by: opts.user && opts.user.id, reason: opts.reason, now: new Date(now()) });
    await P(`DELETE FROM ${T.table} WHERE id=?`).run(Number(id));
    return true;
  }
  async function restorePortfolio(kind, id, opts = {}) {
    const T = TABLES[kind]; if (!T || !softDelete.TABLES[T.table]) throw Object.assign(new Error('unknown portfolio entity'), { code: 'INVALID' });
    const ok = await softDelete.unstamp(db, T.table, Number(id));
    if (ok && kind === 'project') { const b = await P(`SELECT key, budget, currency, stage FROM portfolio_projects WHERE id=?`).get(Number(id)); await ppmEvent({ entity: 'project', entity_id: id, action: 'restored', field: 'budget', old_value: null, new_value: b && b.budget, currency: b && b.currency, note: b ? `${b.key} (stage ${b.stage})` : null }, opts.user); }
    return ok;
  }
  async function getPortfolioTrashRow(kind, id) {
    const T = TABLES[kind]; if (!T || !softDelete.TABLES[T.table]) return null;   // a benefit is not soft-deletable on its own
    const r = await P(`SELECT * FROM ${T.table} WHERE id=?`).get(Number(id));
    return r ? { kind, id: Number(r.id), label: r.name || r.title || r.key || `${kind} #${r.id}`, project_id: r.project_id == null ? null : Number(r.project_id), deleted_at: r.deleted_at, deleted_by: r.deleted_by == null ? null : Number(r.deleted_by), delete_reason: r.delete_reason || null } : null;
  }
  async function listDeletedPortfolio() {
    const out = [];
    for (const kind of SOFT_KINDS()) for (const r of await P(`SELECT id FROM ${TABLES[kind].table} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all()) out.push(await getPortfolioTrashRow(kind, r.id));
    return out;
  }
  // A-27 baselines are append-only (a trigger refuses DELETE), so a project with baselines — or a programme / objective
  // above one — cannot be hard-deleted: such a row is skipped and reported, never crashes the purge, stays soft-deleted.
  async function purgeDeletedPortfolio(cutoff, { apply = false } = {}) {
    const ids = [], skipped = []; let purged = 0;
    for (const kind of SOFT_KINDS()) {
      const t = TABLES[kind].table;
      for (const r of await P(`SELECT id FROM ${t} WHERE deleted_at IS NOT NULL AND deleted_at < ? ORDER BY deleted_at`).all(cutoff)) {
        ids.push(`${kind}:${r.id}`);
        if (!apply) continue;
        try { if (Number((await P(`DELETE FROM ${t} WHERE id=? AND deleted_at IS NOT NULL AND deleted_at < ?`).run(Number(r.id), cutoff) || {}).changes) > 0) purged++; }
        catch (e) { skipped.push({ id: `${kind}:${r.id}`, reason: /append.only|baseline/i.test(String(e.message)) ? 'has approved baselines (append-only) — kept soft-deleted' : String(e.message).slice(0, 200) }); }
      }
    }
    return { ids, purged, skipped };
  }
  function SOFT_KINDS() { return Object.keys(TABLES).filter((k) => softDelete.TABLES[TABLES[k].table]); }

  async function addMinutesHistory(sessionId, action, actorId, reason) {
    await insert('minutes_history', ['session_id', 'action', 'actor_id', 'at', 'reason'], [Number(sessionId), String(action), actorId == null ? null : Number(actorId), now(), str(reason, 1000)]);
  }
  async function minutesHistory(sessionId) { return (await P('SELECT action, actor_id, at, reason FROM minutes_history WHERE session_id=? ORDER BY id').all(Number(sessionId))).map(r => ({ ...r, actor_id: r.actor_id == null ? null : Number(r.actor_id) })); }
  return { ppmEvent, ppmEvents, moveProjectStage, rfiToProject, getRfi, verifyRfi, getDecision, openSessionActions, addMinutesHistory, minutesHistory, init, listCadences, getCadence, saveCadence, removeCadence, listSessions, getSession, createSession, updateSession, stampItem, sessionActions, addSessionAction, setSessionActionStatus, moveSession,
    listDecisions, addDecision, updateDecision, listRfi, submitRfi, triageRfi, rfiScore, portfolio, upsertPortfolio, removePortfolio,
    restorePortfolio, getPortfolioTrashRow, listDeletedPortfolio, purgeDeletedPortfolio, restoreCadence, getCadenceTrashRow, listDeletedCadences, purgeDeletedCadences, projectSites, setProjectSites, getProject, planRow, projectDetail, gateCounts, RISK_KINDS, listBaselines, rebaseline, alertStates, saveAlertState, listBenefits, getBenefit, recordBenefitRealised, verifyBenefit, dueBenefitReviews,
    CADENCE_KINDS, SESSION_STATUSES, DECISION_STATUSES, RFI_KINDS, RFI_STATUSES, PROJECT_STATUSES, CONFIDENCE };
}

module.exports = { makeGovernanceStore, CADENCE_KINDS, SESSION_STATUSES, DECISION_STATUSES, RFI_KINDS, RFI_STATUSES, PROJECT_STATUSES, CONFIDENCE };
