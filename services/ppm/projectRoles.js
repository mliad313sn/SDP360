'use strict';
// PPM parity W4 (enterprise) — finer PROJECT roles (PURE: no I/O, no clock, no config read).
//
// A project role is held through a team membership (ppm_project_members.ppm_role on a member linked to a user account)
// and only counts while report_config ppm_project_roles_enabled = '1' ('0' = today: the column means nothing). It is
// evaluated for a user who is NOT committee / admin tier (those keep today's rights) on ONE project:
//
//   pm               maintains the whole plan of the project (every plan kind, team, time, RACI, change requests)
//   scheduler        tasks and milestones (create / edit / delete) and time; not the team, risks, benefits, RACI, CRs
//   resource_manager the team, time, and on an EXISTING task only who / how much (owner, allocation, effort)
//   contributor      on a task they OWN (owner field = their username / full name / e-mail): progress fields and time
//   client           read-only external stakeholder: no write at all, and never an amount (the route strips money)
//
// An explicit project role REPLACES the default plan-write rule for that user on that project (it may narrow a site
// editor who is only a contributor there, or open a plan to a named PM outside the project's sites). Membership with a
// role also opens READING the project (services/portfolioAccess.canReadProject, ctx.roleMemberProjectIds). The money
// rule is never widened by a role: a pm without the money-read rule still does not see or write amounts.
//
// op: 'write' (PUT /api/governance/portfolio/:kind — a row create or edit), 'delete', 'team' (team members),
//     'time' (time entries on a task), 'action' (RACI, change requests, timesheets, team picker — project-level steps).

const ROLES = Object.freeze(['pm', 'scheduler', 'resource_manager', 'contributor', 'client']);
// a user listed twice on a project holds the MOST RESTRICTIVE of the roles (client wins): never widen by accident
const PRECEDENCE = Object.freeze(['client', 'contributor', 'resource_manager', 'scheduler', 'pm']);
const META_FIELDS = Object.freeze(['id', 'version', 'reason', 'project_id']);
const PROGRESS_FIELDS = Object.freeze(['progress_pct', 'status', 'actual_start', 'actual_end']);
const RESOURCE_FIELDS = Object.freeze(['owner', 'allocation_pct', 'effort_hours']);
const LABELS = Object.freeze({
  pm: { en: 'Project manager', fr: 'Chef de projet' },
  scheduler: { en: 'Scheduler', fr: 'Planificateur' },
  resource_manager: { en: 'Resource manager', fr: 'Gestionnaire des ressources' },
  contributor: { en: 'Contributor', fr: 'Contributeur' },
  client: { en: 'Client (read-only)', fr: 'Client (lecture seule)' },
});

const isRole = (r) => ROLES.includes(String(r || ''));

/** The role that counts among several rows for one user on one project (most restrictive), or null. */
function effectiveRole(roles) {
  const held = (roles || []).map(String).filter(isRole);
  if (!held.length) return null;
  return PRECEDENCE.find((r) => held.includes(r)) || null;
}

/** Normalise a requested role: null / '' clears it; anything else must be one of ROLES. */
function normaliseRole(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (!isRole(s)) throw Object.assign(new Error(`ppm_role must be one of ${ROLES.join(', ')} (or empty)`), { code: 'INVALID', reason: 'BAD_ROLE', status: 400 });
  return s;
}

const _refuse = (code, error) => ({ allow: false, code, error });
const _ok = { allow: true };
/** The body keys a write touches (META fields do not count as data). */
function touched(body) { return Object.keys(body || {}).filter((k) => body[k] !== undefined && !META_FIELDS.includes(k)); }

/**
 * @param {object} a { role, kind, op, isNew, body, ownsTask, moves }
 *   kind: task | milestone | deliverable | risk | benefit | team; isNew: a create (no id); ownsTask: the user is the
 *   owner of the stored task; moves: the write moves the row to another project.
 * @returns {{allow:boolean, code?:string, error?:string}}
 */
function decide(a) {
  const role = a && a.role, kind = a && a.kind, op = (a && a.op) || 'action';
  if (!isRole(role)) return _refuse('ROLE_SCOPE', 'no project role');
  if (role === 'client') return _refuse('CLIENT_READ_ONLY', 'a client of the project reads it; they do not change it');
  if (a.moves && role !== 'pm') return _refuse('ROLE_SCOPE', 'only the project manager moves an item to another project');
  if (role === 'pm') return _ok;
  if (role === 'scheduler') {
    if (op === 'time') return _ok;
    if ((op === 'write' || op === 'delete') && (kind === 'task' || kind === 'milestone')) return _ok;
    return _refuse('ROLE_SCOPE', 'a scheduler maintains tasks, milestones and time — this step is the project manager’s');
  }
  if (role === 'resource_manager') {
    if (op === 'team' || op === 'time') return _ok;
    if (op === 'write' && kind === 'task' && !a.isNew) {
      const extra = touched(a.body).filter((k) => !RESOURCE_FIELDS.includes(k));
      return extra.length ? _refuse('FIELD_SCOPE', `a resource manager changes only ${RESOURCE_FIELDS.join(', ')} on a task (not ${extra.join(', ')})`) : _ok;
    }
    return _refuse('ROLE_SCOPE', 'a resource manager maintains the team, time and task assignments — this step is the project manager’s');
  }
  // contributor
  if (!a.ownsTask || kind !== 'task') return _refuse('OWN_TASK_ONLY', 'a contributor updates only the tasks they own');
  if (op === 'time') return _ok;
  if (op === 'write' && !a.isNew) {
    const extra = touched(a.body).filter((k) => !PROGRESS_FIELDS.includes(k));
    return extra.length ? _refuse('FIELD_SCOPE', `a contributor updates only ${PROGRESS_FIELDS.join(', ')} on their task (not ${extra.join(', ')})`) : _ok;
  }
  return _refuse('OWN_TASK_ONLY', 'a contributor updates the progress of their own tasks only');
}

/** May this role move a task card on the board? (presentation; the server decides with decide()). */
function canMoveCard(role, ownsTask) {
  if (role === 'pm' || role === 'scheduler') return true;
  return role === 'contributor' && !!ownsTask;
}

module.exports = { ROLES, PRECEDENCE, LABELS, PROGRESS_FIELDS, RESOURCE_FIELDS, META_FIELDS, isRole, effectiveRole, normaliseRole, decide, touched, canMoveCard };
