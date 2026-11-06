'use strict';
// C-18 (G38 G39 G40 G50 · A02 A03 A09) — persistence of access templates, requests and grants (057 / 058).
//
// user_roles + user_sites stay the only thing read at request time. An ACTIVE request writes them through
// rdb.updateUser (the path Admin ▸ Users uses) inside the same transaction as its access_grants rows, and the
// change is logged to system_log category 'identity' with request id, grant ids and valid_to (A03).
// Every request step is written to access_request_events (append-only, hash-chained) in the same transaction.
const L = require('./accessRequestLifecycle');
const AP = require('./accessApproverPolicy');
const RC = require('./accessRecert');
const userSites = require('./userSites');
const { typed } = require('./httpError');

const str = (v, max = 2000) => (v == null || v === '' ? null : String(v).slice(0, max));
const toId = (v) => Number(v);
const fail = (c) => { throw typed(c.code, c.error, c.status); };
const todayOf = (iso) => String(iso).slice(0, 10);

function makeAccessStore(db, rdb, { now = () => new Date().toISOString(), getConfig = null } = {}) {
  if (!db || !rdb) throw new Error('accessStore needs a db handle and reports-db');
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (db.runTransaction ? db.runTransaction(fn) : fn());
  const knownRoles = () => [...(rdb.ROLE_HIERARCHY || []), ...(rdb.FEATURE_ROLES_KNOWN || [])];
  const today = () => todayOf(now());

  async function event(requestId, action, actorId, details) {
    await P('INSERT INTO access_request_events (request_id, action, actor_id, at, details) VALUES (?, ?, ?, ?, ?)')
      .run(toId(requestId), action, actorId == null ? null : toId(actorId), now(), details ? JSON.stringify(details) : null);
  }
  const rowReq = (r) => (r ? { ...r, id: toId(r.id), subject_user_id: toId(r.subject_user_id), requested_by: toId(r.requested_by),
    template_version_id: r.template_version_id == null ? null : toId(r.template_version_id),
    roles: r.roles || [], site_ids: (r.site_ids || []).map(Number) } : null);
  const rowVer = (v) => (v ? { ...v, id: toId(v.id), template_id: toId(v.template_id), version: Number(v.version), payload: JSON.parse(v.payload) } : null);

  // ── templates ─────────────────────────────────────────────────────
  async function listTemplates({ includeDrafts = false } = {}) {
    const tpls = await P('SELECT * FROM access_templates ORDER BY key').all();
    const vers = (await P('SELECT * FROM access_template_versions ORDER BY template_id, version').all()).map(rowVer);
    return tpls.map((t) => {
      const vs = vers.filter((v) => v.template_id === toId(t.id) && (includeDrafts || v.status === 'published'));
      const published = vs.filter((v) => v.status === 'published');
      return { ...t, id: toId(t.id), versions: vs, current: published.length ? published[published.length - 1] : null };
    }).filter((t) => includeDrafts || (!t.retired_at && t.current));
  }
  async function createTemplate(b, { actorId }) {
    b = b || {};
    const key = String(b.key || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,47}$/.test(key)) fail({ status: 400, code: 'VALIDATION', error: 'key: 2-48 lower-case letters, digits, . _ -' });
    if (!str(b.title_en) || !str(b.title_fr)) fail({ status: 400, code: 'VALIDATION', error: 'title_en and title_fr are required' });
    const dup = await P('SELECT id FROM access_templates WHERE key = ?').get(key);
    if (dup) fail({ status: 409, code: 'CONFLICT', error: 'a template with this key exists' });
    const r = await P('INSERT INTO access_templates (key, title_en, title_fr, intended_position, owner_user_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .get(key, str(b.title_en, 200), str(b.title_fr, 200), str(b.intended_position, 500), b.owner_user_id == null ? null : toId(b.owner_user_id), actorId, now());
    return toId(r.id);
  }
  async function addVersion(templateId, payload, { actorId }) {
    const v = L.validateTemplatePayload(payload, { knownRoles: knownRoles() }); if (v.error) fail(v.error);
    return tx(async () => {
      const t = await P('SELECT id, retired_at FROM access_templates WHERE id = ? FOR UPDATE').get(toId(templateId));
      if (!t) fail({ status: 404, code: 'NOT_FOUND', error: 'template not found' });
      if (t.retired_at) fail({ status: 409, code: 'CONFLICT', error: 'template is retired' });
      const m = await P('SELECT COALESCE(MAX(version), 0) AS m FROM access_template_versions WHERE template_id = ?').get(toId(templateId));
      const r = await P('INSERT INTO access_template_versions (template_id, version, status, payload, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
        .get(toId(templateId), Number(m.m) + 1, 'draft', JSON.stringify(v.value), actorId, now());
      return toId(r.id);
    });
  }
  async function getVersion(id) { return rowVer(await P('SELECT * FROM access_template_versions WHERE id = ?').get(toId(id))); }
  async function updateDraft(versionId, payload) {
    const v = L.validateTemplatePayload(payload, { knownRoles: knownRoles() }); if (v.error) fail(v.error);
    const cur = await getVersion(versionId);
    if (!cur) fail({ status: 404, code: 'NOT_FOUND', error: 'version not found' });
    if (cur.status !== 'draft') fail({ status: 409, code: 'CONFLICT', error: 'a published version is immutable — add a new version' });
    await P('UPDATE access_template_versions SET payload = ? WHERE id = ?').run(JSON.stringify(v.value), toId(versionId));
  }
  async function publish(versionId, { actorId }) {
    const r = await P("UPDATE access_template_versions SET status = 'published', published_by = ?, published_at = ? WHERE id = ? AND status = 'draft'")
      .run(actorId, now(), toId(versionId));
    if (Number(r.changes) !== 1) fail({ status: 409, code: 'CONFLICT', error: 'version not found or already published' });
  }
  async function retire(templateId, { actorId }) {
    const r = await P('UPDATE access_templates SET retired_by = ?, retired_at = ? WHERE id = ? AND retired_at IS NULL').run(actorId, now(), toId(templateId));
    if (Number(r.changes) !== 1) fail({ status: 404, code: 'NOT_FOUND', error: 'template not found or already retired' });
  }

  // ── requests ──────────────────────────────────────────────────────
  async function getRequest(id) { return rowReq(await P('SELECT * FROM access_requests WHERE id = ?').get(toId(id))); }
  async function events(requestId) {
    return (await P('SELECT id, request_id, action, actor_id, at, details FROM access_request_events WHERE request_id = ? ORDER BY id').all(toId(requestId)))
      .map((e) => ({ ...e, id: toId(e.id), request_id: toId(e.request_id), details: e.details ? JSON.parse(e.details) : null }));
  }
  async function createRequest(b, { actorId }) {
    let template = null, tvId = null;
    if (b && b.template_version_id != null) {
      const v = await getVersion(b.template_version_id);
      const t = v ? await P('SELECT retired_at FROM access_templates WHERE id = ?').get(v.template_id) : null;
      if (!v || v.status !== 'published' || !t || t.retired_at) fail({ status: 400, code: 'VALIDATION', error: 'template version is not published' });
      template = v.payload; tvId = v.id;
    }
    const v = L.validateRequest(b, { knownRoles: knownRoles(), today: today(), template }); if (v.error) fail(v.error);
    const q = v.value;
    const users = await rdb.listUsers();
    const subject = (users || []).find((u) => toId(u.id) === q.subject_user_id);
    if (!subject || subject.active === 0 || subject.active === false) fail({ status: 400, code: 'VALIDATION', error: 'no active account with this id' });
    return tx(async () => {
      const open = await P("SELECT id, roles FROM access_requests WHERE subject_user_id = ? AND status IN ('REQUESTED','REVIEWING','APPROVED') FOR UPDATE").all(q.subject_user_id);
      const clash = open.find((o) => (o.roles || []).some((r) => q.roles.includes(r)));
      if (clash) fail({ status: 409, code: 'CONFLICT', error: `a pending request (#${clash.id}) already covers one of these roles` });
      const r = await P(`INSERT INTO access_requests (kind, subject_user_id, requested_by, template_version_id, roles, site_ids, valid_from, valid_to, justification, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?) RETURNING id`)
        .get(q.kind, q.subject_user_id, toId(actorId), tvId, q.roles, q.site_ids, q.valid_from, q.valid_to, q.justification, now());
      await event(r.id, 'requested', actorId, { subject: q.subject_user_id, roles: q.roles, site_ids: q.site_ids, from: q.valid_from, to: q.valid_to, template_version_id: tvId });
      return toId(r.id);
    });
  }

  /** Active deputies of the subject and of the requester (deputy_id set), today. */
  async function deputyIdsFor(r) {
    const t = today();
    const rows = await P('SELECT deputy_id FROM deputies WHERE user_id IN (?, ?) AND revoked_at IS NULL AND start_date <= ? AND end_date >= ?')
      .all(toId(r.subject_user_id), toId(r.requested_by), t, t);
    return new Set(rows.map((x) => toId(x.deputy_id)));
  }

  /** C-19 (R7): the approver rule for `actor` on request `r`, from the editable policy (report_config). */
  async function approverCtx(r, actor, users) {
    let policy = AP.DEFAULT_POLICY;
    try { const cfg = await (getConfig ? getConfig() : require('./reportConfig').getConfig(rdb.db)); policy = AP.parsePolicy(cfg && cfg.access_approver_policy); } catch (_) { /* default policy */ }
    const list = users || (await rdb.listUsers()) || [];
    const subj = list.find((u) => toId(u.id) === toId(r.subject_user_id));
    const subjectSiteIds = subj ? [subj.site_id, ...(subj.extra_site_ids || [])].filter((x) => x != null).map(Number) : [];
    const actorSiteIds = userSites.siteIds(actor);
    const hasRole = (u, role) => rdb.userHasRole(u, role);
    const e = AP.approverCheck(r, actor, { policy, hasRole, actorSiteIds, subjectSiteIds });
    return { isApprover: !e, approverError: e || undefined, canRevoke: !!(actor && rdb.userHasRole(actor, 'super_admin')) };
  }

  async function _activate(r, actorId) {
    const t = today();
    const c = L.check(r, 'activate', null, { today: t }); if (c) fail(c);
    const user = ((await rdb.listUsers()) || []).find((u) => toId(u.id) === r.subject_user_id);
    if (!user) fail({ status: 409, code: 'CONFLICT', error: 'the subject account no longer exists' });
    const roles = new Set(user.roles || []);
    const sites = new Set([user.site_id, ...(user.extra_site_ids || [])].filter((x) => x != null).map(Number));
    const grantIds = [];
    const ins = (role, site, held) => P(`INSERT INTO access_grants (user_id, role, site_id, request_id, template_version_id, valid_from, valid_to, held_before, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(r.subject_user_id, role, site, r.id, r.template_version_id, r.valid_from, r.valid_to, held, now());
    for (const role of r.roles) grantIds.push(toId((await ins(role, null, roles.has(role))).id));
    for (const s of r.site_ids) grantIds.push(toId((await ins(null, s, sites.has(s))).id));
    const before = [...roles].sort();
    for (const role of r.roles) roles.add(role);
    let primary = user.site_id == null ? null : Number(user.site_id);
    for (const s of r.site_ids) sites.add(s);
    if (primary == null && r.site_ids.length) primary = r.site_ids[0];
    await rdb.updateUser(r.subject_user_id, { full_name: user.full_name, site_id: primary, active: user.active, roles: [...roles],
      extra_site_ids: [...sites].filter((s) => s !== primary) });
    await P("UPDATE access_requests SET status = 'ACTIVE', activated_at = ? WHERE id = ?").run(now(), r.id);
    await event(r.id, 'activated', actorId, { grant_ids: grantIds });
    try {
      rdb.logEvent({ category: 'identity', action: 'user_role_changed', actor: actorId == null ? 'system' : 'user:' + actorId, actor_id: actorId,
        target: user.username, details: { via: 'access_request', request_id: r.id, grant_ids: grantIds, user_id: r.subject_user_id, before, after: [...roles].sort(), site_ids: r.site_ids, valid_to: r.valid_to } });
    } catch (_) { /* a dead log never blocks */ }
    return grantIds;
  }

  async function decide(id, action, actor, { reason, isApprover } = {}) {
    if (!['review', 'approve', 'reject', 'revoke'].includes(action)) fail({ status: 400, code: 'VALIDATION', error: 'unknown action' });
    if ((action === 'reject' || action === 'revoke') && String(reason || '').trim().length < 5) fail({ status: 400, code: 'VALIDATION', error: 'a reason (5+ characters) is required' });
    return tx(async () => {
      const r = rowReq(await P('SELECT * FROM access_requests WHERE id = ? FOR UPDATE').get(toId(id)));
      if (!r) fail({ status: 404, code: 'NOT_FOUND', error: 'request not found' });
      const who = isApprover !== undefined ? { isApprover } : await approverCtx(r, actor);
      const c = L.check(r, action, actor, { ...who, deputyIds: await deputyIdsFor(r), today: today() }); if (c) fail(c);
      const me = actor && actor.id != null ? toId(actor.id) : null;
      if (action === 'review') {
        await P("UPDATE access_requests SET status = 'REVIEWING', reviewed_by = ?, reviewed_at = ? WHERE id = ?").run(me, now(), r.id);
        await event(r.id, 'review', me, null);
        return { status: 'REVIEWING' };
      }
      if (action === 'reject') {
        await P("UPDATE access_requests SET status = 'REJECTED', decided_by = ?, decided_at = ?, decision_reason = ? WHERE id = ?").run(me, now(), str(reason), r.id);
        await event(r.id, 'reject', me, { reason: str(reason) });
        return { status: 'REJECTED' };
      }
      if (action === 'approve') {
        const scope = L.scopeKey(r);
        await P("UPDATE access_requests SET status = 'APPROVED', decided_by = ?, decided_at = ?, decision_reason = ?, approved_scope = ? WHERE id = ?")
          .run(me, now(), str(reason), scope, r.id);
        await event(r.id, 'approve', me, { reason: str(reason), scope: JSON.parse(scope) });
        if (r.valid_from <= today()) { await _activate({ ...r, status: 'APPROVED', approved_scope: scope }, me); return { status: 'ACTIVE' }; }
        return { status: 'APPROVED' };
      }
      // revoke
      if (r.status === 'ACTIVE') await _endGrants(r, me, 'revoked');
      await P("UPDATE access_requests SET status = 'REVOKED', ended_by = ?, ended_at = ?, end_reason = ? WHERE id = ?").run(me, now(), str(reason), r.id);
      await event(r.id, 'revoke', me, { reason: str(reason) });
      return { status: 'REVOKED' };
    });
  }

  /** End the live grants of request r and take away what no other source still holds. */
  async function _endGrants(r, actorId, why) {
    const t = today();
    const all = await P('SELECT * FROM access_grants WHERE user_id = ?').all(r.subject_user_id);
    const ending = all.filter((g) => toId(g.request_id) === r.id && !g.ended_at);
    if (!ending.length) return { roles: [], sites: [] };
    const others = all.filter((g) => !ending.includes(g));
    const rm = L.planRemoval(ending, others, t);
    for (const g of ending) await P('UPDATE access_grants SET ended_at = ?, ended_by = ?, end_reason = ? WHERE id = ?').run(now(), actorId, why, toId(g.id));
    if (rm.roles.length || rm.sites.length) {
      const user = ((await rdb.listUsers()) || []).find((u) => toId(u.id) === r.subject_user_id);
      if (user) {
        let roles = (user.roles || []).filter((x) => !rm.roles.includes(x));
        if (!roles.length) roles = ['viewer'];                  // never strand an account with no role at all
        const extras = (user.extra_site_ids || []).map(Number).filter((s) => !rm.sites.includes(s));
        let primary = user.site_id == null ? null : Number(user.site_id);
        if (primary != null && rm.sites.includes(primary)) primary = extras.length ? extras.shift() : null;
        await rdb.updateUser(r.subject_user_id, { full_name: user.full_name, site_id: primary, active: user.active, roles, extra_site_ids: extras.filter((s) => s !== primary) });
        try {
          rdb.logEvent({ category: 'identity', action: 'user_role_changed', actor: actorId == null ? 'system' : 'user:' + actorId, actor_id: actorId,
            target: user.username, details: { via: 'access_grant_' + why, request_id: r.id, user_id: r.subject_user_id, removed_roles: rm.roles, removed_sites: rm.sites } });
        } catch (_) { /* never blocks */ }
      }
    }
    return rm;
  }

  /** Nightly job body: activate approved requests whose day has come, end the ones past valid_to. */
  async function runExpiry({ actorId = null } = {}) {
    const t = today();
    let activated = 0, expired = 0;
    const due = await P("SELECT id FROM access_requests WHERE status IN ('APPROVED','ACTIVE') ORDER BY id").all();
    for (const { id } of due) {
      await tx(async () => {
        const r = rowReq(await P('SELECT * FROM access_requests WHERE id = ? FOR UPDATE').get(toId(id)));
        if (!r) return;
        if (r.valid_to < t) {
          if (r.status === 'ACTIVE') await _endGrants(r, actorId, 'expired');
          await P("UPDATE access_requests SET status = 'EXPIRED', ended_at = ?, end_reason = 'expired' WHERE id = ?").run(now(), r.id);
          await event(r.id, 'expire', actorId, null); expired++;
        } else if (r.status === 'APPROVED' && r.valid_from <= t) { await _activate(r, actorId); activated++; }
      });
    }
    return { activated, expired, rows: activated + expired };
  }

  // ── C-22 emergency access (written through the same request / grant path) ──
  /** An emergency grant: an access_requests row kind='emergency', decided by the granter, activated at once. */
  async function createEmergency(q, { actorId }) {
    return tx(async () => {
      const from = todayOf(q.starts_at), to = todayOf(q.expires_at);
      const scope = L.scopeKey({ subject_user_id: q.subject_user_id, roles: q.roles, site_ids: q.site_ids, valid_from: from, valid_to: to });
      const r = await P(`INSERT INTO access_requests (kind, subject_user_id, requested_by, roles, site_ids, valid_from, valid_to, justification, status, decided_by, decided_at, decision_reason, approved_scope, created_at)
        VALUES ('emergency', ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?, ?, ?) RETURNING id`)
        .get(q.subject_user_id, toId(actorId), q.roles, q.site_ids, from, to, q.reason, toId(actorId), now(), q.reason, scope, now());
      const id = toId(r.id);
      await event(id, 'emergency_granted', actorId, { subject: q.subject_user_id, roles: q.roles, site_ids: q.site_ids, starts_at: q.starts_at, expires_at: q.expires_at, reason: q.reason, review_due: q.review_due });
      const grantIds = await _activate({ ...rowReq(await P('SELECT * FROM access_requests WHERE id = ?').get(id)) }, toId(actorId));
      return { requestId: id, grantIds };
    });
  }
  /** C-18 break-glass direct edit (Admin ▸ Users) recorded as an emergency: the roles are already written by the
   *  route; this records the request + grants (held_before false, so expiry takes them away again). */
  async function recordDirectEmergency({ subjectId, roles, actorId, reason, startsAt, expiresAt }) {
    return tx(async () => {
      const from = todayOf(startsAt), to = todayOf(expiresAt);
      const r = await P(`INSERT INTO access_requests (kind, subject_user_id, requested_by, roles, site_ids, valid_from, valid_to, justification, status, decided_by, decided_at, decision_reason, activated_at, created_at)
        VALUES ('emergency', ?, ?, ?, '{}', ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?) RETURNING id`)
        .get(toId(subjectId), toId(actorId), roles, from, to, reason, toId(actorId), now(), reason, now(), now());
      const id = toId(r.id);
      const grantIds = [];
      for (const role of roles) {
        grantIds.push(toId((await P(`INSERT INTO access_grants (user_id, role, site_id, request_id, valid_from, valid_to, held_before, created_at)
          VALUES (?, ?, NULL, ?, ?, ?, false, ?) RETURNING id`).get(toId(subjectId), role, id, from, to, now())).id));
      }
      await event(id, 'break_glass_recorded', actorId, { subject: toId(subjectId), roles, starts_at: startsAt, expires_at: expiresAt, reason, grant_ids: grantIds });
      return { requestId: id, grantIds };
    });
  }
  /** End an ACTIVE request now (emergency hour reached): same removal rule as expiry. */
  async function endRequest(id, { actorId = null, why = 'expired' } = {}) {
    return tx(async () => {
      const r = rowReq(await P('SELECT * FROM access_requests WHERE id = ? FOR UPDATE').get(toId(id)));
      if (!r || r.status !== 'ACTIVE') return { ended: false, status: r ? r.status : null };
      await _endGrants(r, actorId, why);
      await P("UPDATE access_requests SET status = 'EXPIRED', ended_by = ?, ended_at = ?, end_reason = ? WHERE id = ?").run(actorId, now(), why, r.id);
      await event(r.id, 'expire', actorId, { why });
      return { ended: true, status: 'EXPIRED' };
    });
  }

  // ── reads ─────────────────────────────────────────────────────────
  async function liveGrants(userId) {
    const t = today();
    return (await P('SELECT * FROM access_grants WHERE user_id = ? AND ended_at IS NULL AND valid_from <= ? AND valid_to >= ? ORDER BY id').all(toId(userId), t, t))
      .map((g) => ({ ...g, id: toId(g.id), request_id: toId(g.request_id), site_id: g.site_id == null ? null : Number(g.site_id) }));
  }
  async function liveGrantRoles(userId) { return [...new Set((await liveGrants(userId)).filter((g) => g.role).map((g) => g.role))]; }
  async function requestsFor(userId) {
    return (await P('SELECT * FROM access_requests WHERE subject_user_id = ? OR requested_by = ? ORDER BY id DESC LIMIT 100').all(toId(userId), toId(userId))).map(rowReq);
  }
  /** Requests the actor may decide now (pending, approver rule R7, not their own, not where they deputise). */
  async function approvalsFor(actor) {
    const rows = (await P("SELECT * FROM access_requests WHERE status IN ('REQUESTED','REVIEWING') ORDER BY id").all()).map(rowReq);
    const out = [];
    const users = rows.length ? await rdb.listUsers() : [];
    for (const r of rows) if (!L.check(r, 'approve', actor, { ...(await approverCtx(r, actor, users)), deputyIds: await deputyIdsFor(r) })) out.push(r);
    return out;
  }
  /** Is `role` for `userId` covered today by an APPROVED or ACTIVE request? (access_require_approval) */
  async function hasApproved(userId, role) {
    const t = today();
    const rows = await P("SELECT roles FROM access_requests WHERE subject_user_id = ? AND status IN ('APPROVED','ACTIVE') AND valid_to >= ?").all(toId(userId), t);
    return rows.some((r) => (r.roles || []).includes(role));
  }
  async function deputiesOf(userId) {
    const t = today();
    return P('SELECT id, user_id, deputy_id, start_date, end_date FROM deputies WHERE (user_id = ? OR deputy_id = ?) AND revoked_at IS NULL AND end_date >= ? ORDER BY start_date')
      .all(toId(userId), toId(userId), t);
  }

  // ── E-S03 recertification campaigns (068) ─────────────────────────
  async function _policy() {
    try { const cfg = await (getConfig ? getConfig() : require('./reportConfig').getConfig(rdb.db)); return AP.parsePolicy(cfg && cfg.access_approver_policy); } catch (_) { return AP.DEFAULT_POLICY; }
  }
  const hasRole = (u, role) => rdb.userHasRole(u, role);
  const rowLine = (l) => ({ ...l, id: toId(l.id), campaign_id: toId(l.campaign_id), user_id: toId(l.user_id),
    site_id: l.site_id == null ? null : Number(l.site_id), approver_user_id: l.approver_user_id == null ? null : toId(l.approver_user_id) });
  const rowCamp = (c) => (c ? { ...c, id: toId(c.id), scope_site_id: c.scope_site_id == null ? null : Number(c.scope_site_id) } : null);

  async function openCampaign(b, { actorId }) {
    b = b || {};
    const title = str(b.title, 200);
    if (!title) fail({ status: 400, code: 'VALIDATION', error: 'title is required' });
    const scope = b.scope_site_id == null || b.scope_site_id === '' ? null : Number(b.scope_site_id);
    if (scope != null && !Number.isInteger(scope)) fail({ status: 400, code: 'VALIDATION', error: 'scope_site_id must be a site id' });
    const users = (await rdb.listUsers()) || [];
    const policy = await _policy();
    const lines = RC.buildLines(users, { scopeSiteId: scope });
    return tx(async () => {
      const c = await P('INSERT INTO access_recert_campaigns (title, scope_site_id, status, orphan_days, opened_by, opened_at) VALUES (?, ?, \'open\', ?, ?, ?) RETURNING id')
        .get(title, scope, b.orphan_days == null ? null : Number(b.orphan_days), toId(actorId), now());
      for (const l of lines) {
        const approver = RC.resolveApprover(l, users, { policy, hasRole });
        await P('INSERT INTO access_recert_lines (campaign_id, kind, user_id, role, site_id, approver_user_id) VALUES (?, ?, ?, ?, ?, ?)')
          .run(toId(c.id), l.kind, l.user_id, l.role, l.site_id, approver);
      }
      return { id: toId(c.id), lines: lines.length };
    });
  }
  async function listCampaigns() {
    const cs = (await P('SELECT * FROM access_recert_campaigns ORDER BY id DESC LIMIT 50').all()).map(rowCamp);
    for (const c of cs) c.progress = RC.progress((await P('SELECT answer, applied_at, approver_user_id FROM access_recert_lines WHERE campaign_id = ?').all(c.id)));
    return cs;
  }
  async function getCampaign(id, { approverId = null } = {}) {
    const c = rowCamp(await P('SELECT * FROM access_recert_campaigns WHERE id = ?').get(toId(id)));
    if (!c) return null;
    let lines = (await P('SELECT * FROM access_recert_lines WHERE campaign_id = ? ORDER BY user_id, kind, role, site_id').all(c.id)).map(rowLine);
    c.progress = RC.progress(lines);
    if (approverId != null) lines = lines.filter((l) => l.approver_user_id === toId(approverId));
    const users = new Map(((await rdb.listUsers()) || []).map((u) => [toId(u.id), u]));
    c.lines = lines.map((l) => ({ ...l, username: (users.get(l.user_id) || {}).username || null,
      approver_username: l.approver_user_id == null ? null : (users.get(l.approver_user_id) || {}).username || null }));
    return c;
  }
  async function linesAssignedTo(actorId) {
    return (await P("SELECT l.* FROM access_recert_lines l JOIN access_recert_campaigns c ON c.id = l.campaign_id WHERE c.status = 'open' AND l.approver_user_id = ? AND l.answer IS NULL ORDER BY l.id")
      .all(toId(actorId))).map(rowLine);
  }
  /** Answer one line. apply=true (access_recert_apply '1') applies a revoke through rdb.updateUser + an identity log. */
  async function answerLine(lineId, actor, body, { apply = false } = {}) {
    const v = RC.validateAnswer(body); if (v.error) fail({ status: 400, code: 'VALIDATION', error: v.error });
    const users = (await rdb.listUsers()) || [];
    const policy = await _policy();
    return tx(async () => {
      const l = await P('SELECT l.*, c.status AS campaign_status FROM access_recert_lines l JOIN access_recert_campaigns c ON c.id = l.campaign_id WHERE l.id = ? FOR UPDATE OF l').get(toId(lineId));
      if (!l) fail({ status: 404, code: 'NOT_FOUND', error: 'line not found' });
      if (l.campaign_status !== 'open') fail({ status: 409, code: 'CONFLICT', error: 'the campaign is closed' });
      const line = rowLine(l);
      const why = RC.canAnswer(line, actor, { users, policy, hasRole });
      if (why) fail({ status: 403, code: 'FORBIDDEN', error: why });
      if (line.applied_at) fail({ status: 409, code: 'CONFLICT', error: 'this line was already applied' });
      const me = toId(actor.id);
      await P('UPDATE access_recert_lines SET answer = ?, reason = ?, answered_by = ?, answered_at = ? WHERE id = ?').run(v.value.answer, v.value.reason, me, now(), line.id);
      let applied = false;
      if (apply && v.value.answer === 'revoke') {
        const user = users.find((u) => toId(u.id) === line.user_id);
        const plan = RC.applyPlan(user, line);
        if (plan) {
          await rdb.updateUser(line.user_id, plan);
          await P('UPDATE access_recert_lines SET applied_by = ?, applied_at = ? WHERE id = ?').run(me, now(), line.id);
          applied = true;
          try {
            rdb.logEvent({ category: 'identity', action: 'user_role_changed', actor: 'user:' + me, actor_id: me, target: user.username, risk: 1,
              details: { via: 'access_recert', campaign_id: line.campaign_id, line_id: line.id, user_id: line.user_id, kind: line.kind,
                removed_role: line.kind === 'role' ? line.role : null, removed_site: line.kind === 'site' ? line.site_id : null, before: [...(user.roles || [])].sort(), after: [...plan.roles].sort() } });
          } catch (_) { /* never blocks */ }
        }
      }
      return { answer: v.value.answer, applied, recorded_only: v.value.answer === 'revoke' && !applied };
    });
  }
  async function closeCampaign(id, { actorId }) {
    const r = await P("UPDATE access_recert_campaigns SET status = 'closed', closed_by = ?, closed_at = ? WHERE id = ? AND status = 'open'").run(toId(actorId), now(), toId(id));
    if (Number(r.changes) !== 1) fail({ status: 404, code: 'NOT_FOUND', error: 'campaign not found or already closed' });
  }
  /** Live orphan list (days = N from config). Last sign-in = latest login_success log row or session start. */
  async function recertOrphans({ days } = {}) {
    const users = (await rdb.listUsers()) || [];
    const last = new Map();
    const bump = (id, v) => { if (v == null) return; const s = v instanceof Date ? v.toISOString() : String(v); const k = toId(id); if (!last.get(k) || s > last.get(k)) last.set(k, s); };
    for (const r of await P("SELECT actor_id, MAX(ts) AS ts FROM system_log WHERE category = 'auth' AND action = 'login_success' AND actor_id IS NOT NULL GROUP BY actor_id").all()) bump(r.actor_id, r.ts);
    for (const r of await P('SELECT user_id, MAX(created_at) AS ts FROM sessions GROUP BY user_id').all()) bump(r.user_id, r.ts);
    const sites = await P('SELECT id, name, active FROM sites').all();
    const tpls = await listTemplates({});
    const roles = new Set(); for (const t of tpls) for (const r of (t.current && t.current.payload && t.current.payload.roles) || []) roles.add(r);
    return RC.orphans(users, { lastLoginById: last, sites, templateRoles: tpls.length ? roles : null, today: today(), days, hasRole });
  }

  return { listTemplates, createTemplate, addVersion, getVersion, updateDraft, publish, retire,
    createRequest, getRequest, events, decide, createEmergency, recordDirectEmergency, endRequest, approverCtx, runExpiry, liveGrants, liveGrantRoles, requestsFor, approvalsFor, hasApproved, deputiesOf,
    openCampaign, listCampaigns, getCampaign, linesAssignedTo, answerLine, closeCampaign, recertOrphans };
}

/** Store bound to the live reports-db PostgreSQL handle. */
function forRdb(rdb) {
  return makeAccessStore({ prepare: (sql) => rdb.pgHandle().prepare(sql), runTransaction: (fn) => rdb.pgHandle().runTransaction(fn) }, rdb);
}

module.exports = { makeAccessStore, forRdb };
