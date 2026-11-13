'use strict';
// A-15 — portfolio access guard (PURE: no I/O, no clock unless passed). One rule for every route:
//   canReadProject  — who reads a project when the PROPOSED site-scoped read policy is on
//   canEditPlan     — who maintains a project's plan (tasks, milestones, risks, deliverables)
//   filterPortfolio — the portfolio view a non-committee reader may see, counts recomputed
// Both policies sit behind report_config switches (portfolio_site_scope_reads, portfolio_editor_plan_writes)
// that default to '0' = today's behaviour (every session reads every project; the committee alone writes).
// Sites are checked through services/userSites only (multi-site editors), never user.site_id === x.
// B3 (P7a, ADR-P7a-portfolio-sensitive-and-publication) — a SENSITIVE project (portfolio_projects.sensitive = 1) is read
// only by the admin tier, the committee, its owner, its named team members and the holders of one of its sites —
// in BOTH states of portfolio_site_scope_reads — and only while report_config portfolio_sensitive_projects = '1'
// (ctx.sensitiveOn). '0' = today: the flag means nothing. A group-level sensitive project (no site) is therefore read
// by the admin tier, the committee, its owner and its members only. Grants nothing: it only ever narrows.

const userSites = require('./userSites');

const _norm = (x) => String(x == null ? '' : x).trim().toLowerCase();

/** The identities a user answers to in a free-text owner field: username, full name, e-mail. */
function actorIds(user) {
  if (!user) return [];
  return [user.username, user.full_name, user.email].map(_norm).filter(Boolean);
}

/** The project owner is free text; it may hold the username, the full name or the e-mail. Empty never matches. */
function ownerMatches(project, user) {
  const owner = _norm(project && project.owner);
  return !!owner && actorIds(user).includes(owner);
}

/** Primary site + extra sites (rows {project_id, site_id} or plain ids), unique, without nulls. [] = group-level. */
function projectSiteIds(project, extra) {
  const out = [];
  const add = (v) => { const n = Number(v); if (v != null && v !== '' && Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n); };
  if (!project) return out;
  add(project.site_id);
  for (const r of extra || []) {
    if (r && typeof r === 'object') { if (Number(r.project_id) === Number(project.id)) add(r.site_id); }
    else add(r);
  }
  return out;
}

const _holdsSite = (user, sites) => { const mine = userSites.siteIds(user); return sites.some((s) => mine.includes(s)); };

const isSensitive = (project) => !!project && (project.sensitive === true || Number(project.sensitive) === 1);
/** memberProjectIds: ids of the projects where the user is a named team member (ppm_project_members.user_id). */
const _isMember = (project, ctx) => (ctx.memberProjectIds || []).map(Number).includes(Number(project.id));
// W4 — a user holding a PROJECT ROLE on a project (ppm_project_members.ppm_role) reads it while the PROPOSED switch
// ppm_project_roles_enabled = '1' (ctx.rolesOn, ctx.roleMemberProjectIds). '0' = today: the role means nothing.
const _isRoleMember = (project, ctx) => !!ctx.rolesOn && !!project && (ctx.roleMemberProjectIds || []).map(Number).includes(Number(project.id));

/** ctx: { scopeOn, sensitiveOn, isCommittee, isAdmin, extraSites, memberProjectIds, rolesOn, roleMemberProjectIds } */
function canReadProject(user, project, ctx = {}) {
  if (ctx.sensitiveOn && isSensitive(project)) {
    if (ctx.isCommittee || ctx.isAdmin) return true;
    if (ownerMatches(project, user) || _isMember(project, ctx) || _isRoleMember(project, ctx)) return true;
    const sites = projectSiteIds(project, ctx.extraSites);
    return sites.length > 0 && _holdsSite(user, sites);   // group-level sensitive: committee, owner and members only
  }
  if (!ctx.scopeOn) return true;                       // today: every session reads every project
  if (ctx.isCommittee || ctx.isAdmin) return true;
  if (!project) return false;
  if (_isRoleMember(project, ctx)) return true;        // W4 — a named project role opens reading this project
  const sites = projectSiteIds(project, ctx.extraSites);
  if (!sites.length) return true;                      // group-level project
  if (_holdsSite(user, sites)) return true;
  return ownerMatches(project, user);
}

/** ctx: { writesOn, isCommittee, isEditor, extraSites } */
function canEditPlan(user, project, ctx = {}) {
  if (ctx.isCommittee) return true;
  if (!ctx.writesOn) return false;                     // today: committee only
  if (!project) return false;
  const sites = projectSiteIds(project, ctx.extraSites);
  if (!sites.length) return false;                     // group-level plans stay the committee's
  if (ownerMatches(project, user)) return true;
  return !!ctx.isEditor && _holdsSite(user, sites);
}

/**
 * The portfolio view restricted to the projects the user may read. Every child keyed by project_id goes with
 * its project; resource conflicts, objective views and the programme summary are RECOMPUTED on the visible
 * set so that no count of a hidden project leaks. ctx: { scopeOn, isCommittee, isAdmin, now }.
 */
function filterPortfolio(view, user, ctx = {}) {
  if (!view || ctx.isCommittee || ctx.isAdmin) return view;
  const sensitiveBites = !!ctx.sensitiveOn && (view.projects || []).some(isSensitive);
  if (!ctx.scopeOn && !sensitiveBites) return view;
  const PE = require('./portfolioEvidence');
  const SCH = require('./projectSchedule');
  const extra = view.project_sites || [];
  const projects = (view.projects || []).filter((p) => canReadProject(user, p, { ...ctx, extraSites: extra }));
  const ids = new Set(projects.map((p) => Number(p.id)));
  const byProject = (list) => (list || []).filter((x) => ids.has(Number(x.project_id)));
  const tasks = byProject(view.tasks);
  const risks = byProject(view.risks);
  const gantt = (view.gantt || []).filter((g) => ids.has(Number(g.id)));
  const now = ctx.now || (view.as_of ? new Date(view.as_of) : new Date());
  const objectives = view.objectives || [];
  const objective_views = (view.objective_views || []).map((v) => {
    const o = objectives.find((x) => Number(x.id) === Number(v.id));
    if (!o) return v;
    const metric = v.metric ? { ...v.metric, window: v.metric.window ? { label: v.metric.window } : null } : null;
    return { ...PE.objectiveView(o, { metric, projects: projects.filter((p) => Number(p.objective_id) === Number(o.id)), now }), programme_id: v.programme_id };
  });
  return {
    ...view,
    projects,
    milestones: byProject(view.milestones),
    deliverables: byProject(view.deliverables),
    benefits: byProject(view.benefits),   // B-08
    tasks,
    risks,
    plans: byProject(view.plans),
    project_sites: byProject(extra),
    gantt,
    objective_views,
    resource_conflicts: SCH.resourceConflicts(tasks),
    resource_coverage: SCH.resourceCoverage(tasks),   // F-PRODUCT-01: unknown / invalid allocations are counted, never read as 0
    summary: PE.portfolioSummary({ programmes: view.programmes || [], objectiveViews: objective_views, gantt, risks }),
    scoped: true,
  };
}

/**
 * B3 — "my projects" (a PRESENTATION default, grants nothing): the ids, among the projects already readable, that the
 * user owns, holds a site of, or is a named member of. ctx: { extraSites, memberProjectIds }.
 */
function myProjectIds(user, projects, ctx = {}) {
  return (projects || []).filter((p) => ownerMatches(p, user) || _isMember(p, ctx) || _holdsSite(user, projectSiteIds(p, ctx.extraSites))).map((p) => Number(p.id));
}

module.exports = { actorIds, ownerMatches, projectSiteIds, isSensitive, canReadProject, canEditPlan, filterPortfolio, myProjectIds };
