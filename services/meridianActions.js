'use strict';
// F1 — Pure: flatten a buildSiteActions() result into the C2 open-actions API shape.
// Stable id = "<source>:<action_id ?? uid>". Whitelist keys (PII-safe: owner name only,
// never requester/technician). No DB, no Date.now — asOf is passed in.

// The SDP stable action id Meridian caches in its external_action_link row.
function actionId(it) {
  const key = (it.action_id != null) ? it.action_id : it.uid;
  return `${it.source}:${key}`;
}

function flattenOpenActions(site, sa, asOf) {
  const groups = (sa && sa.groups) || {};
  const actions = [];
  for (const g of ['meetings', 'inspection', 'report']) {
    for (const it of ((groups[g] && groups[g].items) || [])) {
      actions.push({
        id: actionId(it),
        source: it.source,
        title: it.title || '',
        owner: it.owner || null,
        status: it.status || null,
        due_date: it.due_date || null,
        age_days: (it.age_days == null ? null : it.age_days),
        overdue: !!it.overdue,
        origin_label: it.origin_label || null,
      });
    }
  }
  return { site, as_of: asOf, actions };
}

// Fold a Meridian links map (ext_id → link row, from meridianLinks.getLinksForSite)
// onto a buildSiteActions() result IN PLACE: each item gets `it.project =
// {id,name,activity_id,url}` when linked, else null (never fabricated). Returns sa.
// Used by the Site Actions hub route to render the "▸ Projet: X" badge.
function attachProjectLinks(sa, linksMap, baseUrl) {
  const map = linksMap || {};
  const groups = (sa && sa.groups) || {};
  const trim = String(baseUrl || '').replace(/\/$/, '');
  for (const g of ['meetings', 'inspection', 'report']) {
    for (const it of ((groups[g] && groups[g].items) || [])) {
      const l = map[actionId(it)];
      it.project = l ? {
        id: l.project_id,
        name: l.project_name || l.project_id,
        activity_id: l.activity_id || null,
        url: (trim && l.project_id) ? `${trim}/projects/${encodeURIComponent(l.project_id)}` : null,
      } : null;
    }
  }
  return sa;
}

module.exports = { flattenOpenActions, actionId, attachProjectLinks };
