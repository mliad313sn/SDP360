'use strict';
// A-15 — portfolio access guard (PURE: no I/O, no clock unless passed). One rule for every route:
//   canReadProject  — who reads a project when the PROPOSED site-scoped read policy is on
//   canEditPlan     — who maintains a project's plan (tasks, milestones, risks, deliverables)
//   filterPortfolio — the portfolio view a non-committee reader may see, counts recomputed
// Both policies sit behind report_config switches (portfolio_site_scope_reads, portfolio_editor_plan_writes)
// that default to '0' = today's behaviour (every session reads every project; the committee alone writes).
// Sites are checked through services/userSites only (multi-site editors), never user.site_id === x.

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

/** ctx: { scopeOn, isCommittee, isAdmin, extraSites } */
function canReadProject(user, project, ctx = {}) {
  if (!ctx.scopeOn) return true;                       // today: every session reads every project
  if (ctx.isCommittee || ctx.isAdmin) return true;
  if (!project) return false;
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
  if (!view || !ctx.scopeOn || ctx.isCommittee || ctx.isAdmin) return view;
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
    summary: PE.portfolioSummary({ programmes: view.programmes || [], objectiveViews: objective_views, gantt, risks }),
    scoped: true,
  };
}

module.exports = { actorIds, ownerMatches, projectSiteIds, canReadProject, canEditPlan, filterPortfolio };
