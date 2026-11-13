'use strict';
// W4-CONNECTORS — READ-ONLY clients for Jira (REST v2 search) and Azure DevOps (WIQL + work-items batch). The transport
// is INJECTABLE ({get, post} with axios-like signatures returning {data}); by default every call goes through
// services/safeUrl (https only, private / metadata addresses refused unless allow-listed, no redirect, DNS re-checked
// at connect time). Only GET and the WIQL query POST are ever sent — nothing is created or modified upstream.
// Bounded: at most `maxItems` items (default 2000) and a 30 s timeout per call. Credentials go in an Authorization
// header only (never in a URL, never logged; errors are redacted).
const MAX_ITEMS = 2000;
const TIMEOUT_MS = 30000;
const JIRA_FIELDS = 'summary,status,issuetype,duedate,timeoriginalestimate';
const AZDO_FIELDS = ['System.Id', 'System.Title', 'System.State', 'System.WorkItemType', 'Microsoft.VSTS.Scheduling.OriginalEstimate', 'Microsoft.VSTS.Scheduling.StartDate', 'Microsoft.VSTS.Scheduling.TargetDate', 'Microsoft.VSTS.Scheduling.DueDate'];
const trim = (u) => String(u || '').trim().replace(/\/+$/, '');
const fail = (msg, reason, status = 502) => Object.assign(new Error(msg), { status, reason });

let _override = null;
/** Replaces the transport (tests: a fake that never touches the network). Not reachable over HTTP. */
function useTransport(t) { _override = t || null; }
function transport(allowHosts) { return _override || defaultHttp(allowHosts); }
function defaultHttp(allowHosts) {
  const S = require('../safeUrl');
  return { get: S.safeGet(allowHosts), post: S.safePost(allowHosts) };
}
function redact(e, secrets) {
  const S = require('../safeUrl');
  const status = e && e.response && e.response.status;
  const base = status ? `HTTP ${status}` : (e && e.code) || 'request failed';
  return S.redactMessage(`${base}${e && e.message && !status ? ': ' + e.message : ''}`, secrets);
}

/** Jira Cloud (email + API token → Basic) or Jira Server / Data Center (PAT → Bearer when no user is set). */
async function fetchJira({ baseUrl, user, token, jql, maxItems = MAX_ITEMS, http }) {
  const base = trim(baseUrl);
  if (!base || !token) throw fail('the Jira connection is not configured (base URL and API token)', 'CONNECTOR_NOT_CONFIGURED', 409);
  const auth = user ? `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}` : `Bearer ${token}`;
  const out = []; let startAt = 0;
  for (let guard = 0; guard < 100 && out.length < maxItems; guard++) {
    const url = `${base}/rest/api/2/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=100&fields=${JIRA_FIELDS}`;
    let r; try { r = await http.get(url, { headers: { Authorization: auth, Accept: 'application/json' }, timeout: TIMEOUT_MS }); }
    catch (e) { throw fail(`Jira read failed: ${redact(e, [token, user])}`, 'CONNECTOR_READ_FAILED'); }
    const d = (r && r.data) || {};
    const issues = Array.isArray(d.issues) ? d.issues : [];
    out.push(...issues);
    startAt += issues.length;
    if (!issues.length || startAt >= Number(d.total || 0)) break;
  }
  return { items: out.slice(0, maxItems), truncated: out.length > maxItems || out.length === maxItems };
}

/** Azure DevOps Services / Server: PAT → Basic ":pat". */
async function fetchAzdo({ orgUrl, project, pat, wiql, maxItems = MAX_ITEMS, http }) {
  const base = trim(orgUrl);
  if (!base || !project || !pat) throw fail('the Azure DevOps connection is not configured (organisation URL, project and PAT)', 'CONNECTOR_NOT_CONFIGURED', 409);
  const headers = { Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`, Accept: 'application/json', 'Content-Type': 'application/json' };
  let ids;
  try {
    const r = await http.post(`${base}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.0&$top=${maxItems + 1}`, { query: wiql }, { headers, timeout: TIMEOUT_MS });
    ids = ((r && r.data && r.data.workItems) || []).map((w) => Number(w.id)).filter(Number.isInteger);
  } catch (e) { throw fail(`Azure DevOps query failed: ${redact(e, [pat])}`, 'CONNECTOR_READ_FAILED'); }
  const truncated = ids.length > maxItems;
  ids = ids.slice(0, maxItems);
  const out = [];
  for (let i = 0; i < ids.length; i += 200) {
    const url = `${base}/_apis/wit/workitems?ids=${ids.slice(i, i + 200).join(',')}&fields=${AZDO_FIELDS.join(',')}&api-version=7.0`;
    try { const r = await http.get(url, { headers, timeout: TIMEOUT_MS }); out.push(...(((r && r.data && r.data.value) || []))); }
    catch (e) { throw fail(`Azure DevOps read failed: ${redact(e, [pat])}`, 'CONNECTOR_READ_FAILED'); }
  }
  return { items: out, truncated };
}

module.exports = { fetchJira, fetchAzdo, defaultHttp, transport, useTransport, MAX_ITEMS, JIRA_FIELDS, AZDO_FIELDS };
