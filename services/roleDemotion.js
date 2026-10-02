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

module.exports = { planDemotion };
