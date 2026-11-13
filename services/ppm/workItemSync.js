'use strict';
// W4-CONNECTORS — OPTIONAL read-only pull of Jira / Azure DevOps work items into a native project (PURE: no I/O).
// The native tool never depends on this: a project only receives external items after it explicitly opts in, and the
// external tool is never written to.
//
//   jiraQuery(scope)                      Jira JQL from a project key (`ABC` → project = "ABC") or a JQL string
//   azdoWiql(scope, project)              Azure DevOps WIQL for an area path (UNDER), quotes escaped
//   mapJiraIssue(issue, {baseUrl})        → item
//   mapAzdoItem(wi, {orgUrl, project})    → item
//   planSync({items, links, tasks})       → { create, update, unchanged, deleted_locally, missing_upstream, skipped }
//
// item = { system, external_key, external_url, external_type, external_status, name, status (todo|in_progress|done|
//          cancelled), progress_pct (100 when done, else null = UNKNOWN — never invented), effort_hours (null when the
//          source has no estimate), deadline, start_date, end_date (both or neither) }
// Fields the connector OWNS on a linked task: name, status, progress_pct, effort_hours, deadline, start/end dates —
// a non-null upstream value overwrites the native one on the next applied sync; a null upstream value never clears a
// native value (null = unknown upstream). Everything else (owner, parent, dependencies, duration…) stays native.
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const day = (v) => { const d = String(v || '').slice(0, 10); return ISO.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z')) ? d : null; };
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const str = (v, n = 300) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, n));
const OWNED = ['name', 'status', 'progress_pct', 'effort_hours', 'deadline', 'start_date', 'end_date'];

function jiraQuery(scope) {
  const s = String(scope || '').trim();
  if (!s) throw Object.assign(new Error('a Jira project key or JQL is required'), { status: 400, reason: 'SCOPE_REQUIRED' });
  if (s.length > 1000) throw Object.assign(new Error('the Jira query is too long'), { status: 400, reason: 'SCOPE_TOO_LONG' });
  return /^[A-Z][A-Z0-9_]{0,29}$/.test(s) ? `project = "${s}" ORDER BY key ASC` : s;
}
function azdoWiql(scope, project) {
  const s = String(scope || '').trim();
  if (!s) throw Object.assign(new Error('an Azure DevOps area path is required'), { status: 400, reason: 'SCOPE_REQUIRED' });
  if (s.length > 400 || /[\r\n]/.test(s)) throw Object.assign(new Error('the area path is invalid'), { status: 400, reason: 'SCOPE_INVALID' });
  const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
  return `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = ${q(project || '')} AND [System.AreaPath] UNDER ${q(s)} ORDER BY [System.Id]`;
}

function jiraStatus(f) {
  const cat = f && f.status && f.status.statusCategory && f.status.statusCategory.key;
  if (cat === 'done') return 'done';
  if (cat === 'indeterminate') return 'in_progress';
  return 'todo';   // 'new' or unknown category → not started
}
function mapJiraIssue(issue, { baseUrl } = {}) {
  const f = (issue && issue.fields) || {};
  const status = jiraStatus(f);
  const est = f.timeoriginalestimate != null ? Number(f.timeoriginalestimate) : null;
  const key = str(issue && issue.key, 64);
  return { system: 'jira', external_key: key, external_url: baseUrl && key ? `${String(baseUrl).replace(/\/+$/, '')}/browse/${encodeURIComponent(key)}` : null,
    external_type: str(f.issuetype && f.issuetype.name, 60), external_status: str(f.status && f.status.name, 60),
    name: `[${key}] ${str(f.summary, 280) || 'untitled'}`, status, progress_pct: status === 'done' ? 100 : null,
    effort_hours: Number.isFinite(est) && est >= 0 ? r2(est / 3600) : null, deadline: day(f.duedate), start_date: null, end_date: null };
}

const AZ_DONE = new Set(['closed', 'done', 'resolved', 'completed']);
const AZ_NEW = new Set(['new', 'to do', 'proposed', 'approved']);
function mapAzdoItem(wi, { orgUrl, project } = {}) {
  const f = (wi && wi.fields) || {};
  const st = String(f['System.State'] || '').trim();
  const s = st.toLowerCase();
  const status = s === 'removed' ? 'cancelled' : AZ_DONE.has(s) ? 'done' : AZ_NEW.has(s) || !s ? 'todo' : 'in_progress';
  const key = wi && wi.id != null ? String(wi.id) : null;
  const est = f['Microsoft.VSTS.Scheduling.OriginalEstimate'];
  const start = day(f['Microsoft.VSTS.Scheduling.StartDate']);
  const due = day(f['Microsoft.VSTS.Scheduling.TargetDate']) || day(f['Microsoft.VSTS.Scheduling.DueDate']);
  const both = start && due && start <= due;
  return { system: 'azdo', external_key: key, external_url: orgUrl && key ? `${String(orgUrl).replace(/\/+$/, '')}/${encodeURIComponent(project || '')}/_workitems/edit/${encodeURIComponent(key)}` : null,
    external_type: str(f['System.WorkItemType'], 60), external_status: str(st, 60),
    name: `[#${key}] ${str(f['System.Title'], 280) || 'untitled'}`, status, progress_pct: status === 'done' ? 100 : null,
    effort_hours: est != null && Number.isFinite(Number(est)) && Number(est) >= 0 ? r2(Number(est)) : null,
    deadline: due, start_date: both ? start : null, end_date: both ? due : null };
}

/**
 * @param {{items:object[], links:{external_key,task_id}[], tasks:Object<string,{name,status,progress_pct,effort_hours,deadline,start_date,end_date,deleted}>}} x
 */
function planSync({ items = [], links = [], tasks = {} } = {}) {
  const out = { create: [], update: [], unchanged: [], deleted_locally: [], missing_upstream: [], skipped: [] };
  const linkByKey = new Map(links.map((l) => [String(l.external_key), l]));
  const seen = new Set();
  for (const it of items) {
    if (!it || !it.external_key) { out.skipped.push({ reason: 'NO_KEY' }); continue; }
    if (seen.has(it.external_key)) { out.skipped.push({ external_key: it.external_key, reason: 'DUPLICATE' }); continue; }
    seen.add(it.external_key);
    const l = linkByKey.get(it.external_key);
    if (!l) {
      if (it.status === 'cancelled') { out.skipped.push({ external_key: it.external_key, reason: 'REMOVED_UPSTREAM' }); continue; }
      out.create.push(it); continue;
    }
    const t = tasks[String(l.task_id)];
    if (!t || t.deleted) { out.deleted_locally.push({ external_key: it.external_key, task_id: l.task_id }); continue; }
    const patch = {};
    for (const k of OWNED) {
      const v = it[k];
      if (v == null) continue;   // unknown upstream → never clears a native value
      const cur = t[k] == null ? null : t[k];
      const same = typeof v === 'number' ? cur != null && Number(cur) === v : String(cur) === String(v);
      if (!same) patch[k] = v;
    }
    if (patch.start_date || patch.end_date) { patch.start_date = it.start_date; patch.end_date = it.end_date; patch.schedule_mode = 'manual'; }
    if (Object.keys(patch).length) out.update.push({ task_id: Number(l.task_id), external_key: it.external_key, item: it, patch });
    else out.unchanged.push({ task_id: Number(l.task_id), external_key: it.external_key, item: it });
  }
  for (const l of links) if (!seen.has(String(l.external_key))) out.missing_upstream.push({ external_key: String(l.external_key), task_id: Number(l.task_id) });
  return out;
}

const summarize = (p) => ({ create: p.create.length, update: p.update.length, unchanged: p.unchanged.length, deleted_locally: p.deleted_locally.length, missing_upstream: p.missing_upstream.length, skipped: p.skipped.length });

module.exports = { jiraQuery, azdoWiql, mapJiraIssue, mapAzdoItem, planSync, summarize, OWNED };
