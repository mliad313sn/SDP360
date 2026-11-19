'use strict';
// Who may read a report run / follow a report template — ONE rule shared by the report studio
// (routes/reportStudio.js visibleRun), subscriptions (routes/engagement.js) and the scheduled
// notification fan-out (services/engagementJobs.js generateScheduledReports).
//
// P11 round 2 R2-N1: subscriptions accepted any report_template for any session and the scheduled
// jobs notified every subscriber of every site's run and of the executive pack (site name + headline).
// Now subscribing needs the template's audience, and every notification re-checks the run against
// the subscriber's CURRENT roles and sites, so an older subscription cannot leak either.
const userSites = require('./userSites');

const isAuthor = (rdb, u) => !!u && (rdb.userHasRole(u, 'admin') || rdb.userHasRole(u, 'report-author'));

// P11-F1: a group-wide run (site_id NULL) is read by a non-author only for a council template and a
// committee member; executive packs stay with the authors.
const groupRunReadable = (rdb, u, t) => !!(u && t && t.audience === 'council' && rdb.userHasRole(u, 'committee-member'));

/** Same answer as visibleRun (read): authors see every run; others only PUBLISHED runs of their sites
 *  or a council run when they sit on the committee. */
function canReadRun(rdb, u, run, template) {
  if (!u || !run) return false;
  if (isAuthor(rdb, u)) return true;
  if (run.status !== 'published') return false;
  if (run.site_id != null) return userSites.hasSite(u, run.site_id);
  return groupRunReadable(rdb, u, template);
}

/** May this account follow the template at all? Authors: any. Site templates: an account with a site.
 *  Council templates: committee members. Executive (and any other) audience: authors only. */
function canSubscribeTemplate(rdb, u, template) {
  if (!u || !template) return false;
  if (isAuthor(rdb, u)) return true;
  if (template.audience === 'site') return userSites.siteIds(u).length > 0;
  if (template.audience === 'council') return rdb.userHasRole(u, 'committee-member');
  return false;
}

/** listUsers() row → the session-shaped user the rules above expect (roles + site_ids). */
function sessionShape(row) {
  if (!row) return null;
  return { ...row, site_ids: [row.site_id].concat(Array.isArray(row.extra_site_ids) ? row.extra_site_ids : []).filter((x) => x != null) };
}

async function loadUsers(rdb) { const map = new Map(); for (const u of (await rdb.listUsers()) || []) map.set(Number(u.id), sessionShape(u)); return map; }

/** Subscribers of the run's template who may read THIS run now. `users` (optional) = a Map id →
 *  session-shaped user, or an async function returning one (a batch job shares it across runs; it is
 *  only called when the template has subscribers). Returns { allowed, withheld }. */
async function readableSubscribers(engStore, rdb, run, template, users = null) {
  const subs = await engStore.subscribersOf('report_template', template ? template.key : run.template_key);
  if (!subs.length) return { allowed: [], withheld: 0 };
  let map = typeof users === 'function' ? await users() : users;
  if (!map) map = await loadUsers(rdb);
  const allowed = []; let withheld = 0;
  for (const s of subs) {
    const u = map.get(Number(s.user_id));
    if (u && u.active !== 0 && u.active !== false && canReadRun(rdb, u, run, template)) allowed.push(s); else withheld++;
  }
  return { allowed, withheld };
}

module.exports = { isAuthor, groupRunReadable, canReadRun, canSubscribeTemplate, sessionShape, loadUsers, readableSubscribers };
