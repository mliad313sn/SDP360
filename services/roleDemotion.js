'use strict';
// G-12 bulk demotion — PURE planner (user request 2026-10-02: "without doing it one by
// one"). The selection is roleAudit.classifyAccount's `over_privileged` verdict, verbatim,
// so this plan names EXACTLY the accounts tools/pg/audit-roles.js lists: an admin WITH a
// site. A site-less admin (central IT, to confirm), a super_admin or an executive is never
// in the plan — an editor without a site can write nothing, which is the one outcome this
// tool must not produce. Feature roles are kept; the hierarchical level becomes `editor`.

const { classifyAccount } = require('./roleAudit');

/**
 * planDemotion(users, { addTrackerEditor, except }) → [{ id, username, site_name, before, after }]
 *   users: [{ id, username, roles: [...], site_id, site_name }] — roles = level + feature roles.
 *   addTrackerEditor: also grant `tracker-editor` (the coordinators' tracker input role).
 *   except: usernames to leave out (case-insensitive).
 */
function planDemotion(users, opts = {}) {
  const except = new Set((opts.except || []).map(s => String(s).trim().toLowerCase()).filter(Boolean));
  const out = [];
  for (const u of (users || [])) {
    if (!u || except.has(String(u.username || '').toLowerCase())) continue;
    if (classifyAccount(u).verdict !== 'over_privileged') continue;
    const before = [...new Set(u.roles || [])].sort();
    const after = new Set(before.filter(r => r !== 'admin'));
    after.add('editor');
    if (opts.addTrackerEditor) after.add('tracker-editor');
    out.push({ id: u.id, username: u.username, site_name: u.site_name || null, before, after: [...after].sort() });
  }
  return out;
}

const HIERARCHY = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];

/**
 * planDrop(users, roles) → [{ id, username, site_name, before, after }]
 * Remove FEATURE roles (e.g. audit-viewer) from site-scoped accounts below the admin tier
 * that hold them (user request 2026-10-02: audit-viewer reads every site's audit log, while
 * a coordinator keeps their own site's log through `editor`). The admin tier and site-less
 * accounts (a central auditor) are never touched; a hierarchical level cannot be dropped.
 */
function planDrop(users, roles) {
  const drop = [...new Set((roles || []).map(r => String(r).trim()).filter(Boolean))];
  const bad = drop.filter(r => HIERARCHY.includes(r));
  if (bad.length) throw new Error(`--drop only removes a feature role, not a level: ${bad.join(', ')}`);
  const out = [];
  for (const u of (users || [])) {
    const rs = [...new Set(u && u.roles || [])].sort();
    const hasSite = u && u.site_id != null && u.site_id !== '';
    if (!hasSite || rs.some(r => ['super_admin', 'executive', 'admin'].includes(r))) continue;
    if (!drop.some(r => rs.includes(r))) continue;
    out.push({ id: u.id, username: u.username, site_name: u.site_name || null, before: rs, after: rs.filter(r => !drop.includes(r)) });
  }
  return out;
}

/**
 * planRoles(users, { addTrackerEditor, except, drop }) — what the CLI applies: the demotion,
 * then --drop on the resulting role sets, merged into ONE entry per account (one backup,
 * one transaction). `before` is always the account's ORIGINAL role set.
 */
function planRoles(users, opts = {}) {
  const demote = planDemotion(users, opts);
  if (!opts.drop || !opts.drop.length) return demote;
  const byId = new Map(demote.map(p => [p.id, p]));
  const except = new Set((opts.except || []).map(s => String(s).trim().toLowerCase()));
  const after = (users || []).filter(u => u && !except.has(String(u.username || '').toLowerCase()))
    .map(u => (byId.has(u.id) ? { ...u, roles: byId.get(u.id).after } : u));
  for (const d of planDrop(after, opts.drop)) {
    const first = byId.get(d.id);
    byId.set(d.id, { ...d, before: first ? first.before : d.before });
  }
  return [...byId.values()].sort((a, b) => String(a.username).localeCompare(String(b.username)));
}

module.exports = { planDemotion, planDrop, planRoles };
