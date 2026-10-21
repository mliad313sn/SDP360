'use strict';
// Teams SLA alerts (2026-10-03) — read-only ServiceDesk Plus Cloud API v3 client.
// Zoho OAuth: a refresh token (scope SDPOnDemand.requests.READ) is exchanged for a
// short-lived access token, cached until shortly before it expires. Transport
// {get, post} is injectable (defaults to axios) so tests never hit the network.
// Inert when unconfigured: no call, empty list.
//
// INTEGRATION CONFIRMATIONS (validate on the real instance — the admin "preview" shows
// what comes back): the open-requests filter name (default 'Open_System') and the v3
// field names below. Every field is optional downstream (services/teamsSla.normalizeRequest).
const FIELDS = ['id', 'display_id', 'subject', 'status', 'priority', 'group', 'technician', 'site',
  'created_time', 'due_by_time', 'first_response_due_by_time', 'responded_time'];

const MAX_PAGES = 50;
function _createdMs(r) {
  const v = r && r.created_time && typeof r.created_time === 'object' ? r.created_time.value : (r && r.created_time);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
let _axios = null;
function _defaultTransport(allowHosts) {
  // M4 — the real transport validates every URL (https, no private address unless allow-listed), maxRedirects:0.
  const S = require('./safeUrl');
  return { get: S.safeGet(allowHosts), post: S.safePost(allowHosts, { timeout: 30000 }) };
}

function makeSdpClient({ baseUrl, accountsUrl = 'https://accounts.zoho.com', clientId, clientSecret, refreshToken,
  openFilter = 'Open_System', excludeStatuses = [], writeEnabled = false, allowHosts, transport } = {}) {
  const T = transport || _defaultTransport(allowHosts);
  // M9 — every error leaving this client is redacted: URLs → scheme+host, secrets/tokens masked.
  const _red = (m) => require('./safeUrl').redactMessage(m, [clientSecret, refreshToken, token]);
  const configured = !!(baseUrl && clientId && clientSecret && refreshToken);
  const base = String(baseUrl || '').replace(/\/+$/, '');
  let token = null, tokenExp = 0;
  // 'none' (no statuses to exclude) | 'accepted' | 'rejected' (SDP answered 400 → plain listing from then on)
  let criteriaState = excludeStatuses && excludeStatuses.length ? 'pending' : 'none';
  let meta = { criteria: criteriaState };

  async function _token() {
    if (token && Date.now() < tokenExp) return token;
    let res;
    try {
      res = await T.post(`${String(accountsUrl).replace(/\/+$/, '')}/oauth/v2/token`, null, {
        params: { refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' },
      });
    } catch (e) {
      const st = e && e.response && e.response.status;
      throw new Error(_red(`Zoho OAuth token refresh failed${st ? ` (HTTP ${st})` : `: ${e.message}`}`));
    }
    const d = (res && res.data) || {};
    if (!d.access_token) throw new Error(_red(`Zoho OAuth token refresh refused: ${d.error || 'no access_token returned'}`));
    token = d.access_token;
    tokenExp = Date.now() + Math.max(60, Number(d.expires_in) || 3600) * 1000 - 60000;
    return token;
  }

  // createdAfterMs: the listing is newest first, so once a page reaches older tickets the
  // rest is older still → drop them and stop paging (fewer API calls every 5 min).
  async function _list(tok, { rowCount, maxPages, createdAfterMs, useCriteria }) {
    const out = [];
    for (let page = 0; page < maxPages; page++) {
      const li = { row_count: rowCount, start_index: page * rowCount + 1, sort_field: 'created_time',
        sort_order: 'desc', filter_by: { name: openFilter }, fields_required: FIELDS };
      // Ask SDP to leave finished tickets out (the 'Open_System' filter name is ignored by
      // the cloud edition — prod preview 2026-10-04 read 1598 Closed out of 2036).
      if (useCriteria) li.search_criteria = [{ field: 'status.name', condition: 'is not', values: excludeStatuses }];
      let res;
      try {
        res = await T.get(`${base}/requests`, {
          timeout: 30000, params: { input_data: JSON.stringify({ list_info: li }) },
          headers: { Authorization: `Zoho-oauthtoken ${tok}`, Accept: 'application/vnd.manageengine.sdp.v3+json' },
        });
      } catch (e) {
        const st = e && e.response && e.response.status;
        const msg = e && e.response && e.response.data && JSON.stringify(e.response.data).slice(0, 300);
        const err = new Error(_red(`SDP GET /requests${st ? ` → HTTP ${st}` : ` → ${e.message}`}${msg ? ` ${msg}` : ''}`));
        err.status = st;
        throw err;
      }
      const d = (res && res.data) || {};
      const rows = Array.isArray(d.requests) ? d.requests : [];
      if (createdAfterMs != null) {
        const keep = rows.filter(r => { const c = _createdMs(r); return c == null || c >= createdAfterMs; });
        out.push(...keep);
        if (keep.length < rows.length) break;
      } else out.push(...rows);
      if (!(d.list_info && d.list_info.has_more_rows)) break;
    }
    return out;
  }

  async function listOpenRequests({ rowCount = 100, maxPages = MAX_PAGES, createdAfterMs = null } = {}) {
    if (!configured) return [];
    const tok = await _token();
    const opts = { rowCount, maxPages, createdAfterMs };
    if (criteriaState === 'pending' || criteriaState === 'accepted') {
      try {
        const rows = await _list(tok, { ...opts, useCriteria: true });
        criteriaState = 'accepted'; meta = { criteria: criteriaState };
        return rows;
      } catch (e) {
        if (e.status !== 400) throw e;
        criteriaState = 'rejected';   // this instance does not take the criteria: plain listing from now on
      }
    }
    const rows = await _list(tok, { ...opts, useCriteria: false });
    meta = { criteria: criteriaState };
    return rows;
  }

  /**
   * Step 10 — quick action "SDP ticket from a finding". WRITE path: requires the OAuth scope
   * SDPOnDemand.requests.CREATE on the self-client (new scope → through the CAB) AND `writeEnabled`
   * (config sdp_api_write_enabled='1'). Returns { id, display_id } or throws with .code 'WRITE_DISABLED'.
   */
  async function createRequest({ subject, description = '', siteName = null, priority = null, requesterEmail = null } = {}) {
    if (!writeEnabled) throw Object.assign(new Error('SDP write is not enabled (sdp_api_write_enabled) — the CREATE scope must be approved by the CAB first'), { code: 'WRITE_DISABLED' });
    if (!configured) throw Object.assign(new Error('SDP API client is not configured'), { code: 'WRITE_DISABLED' });
    const tok = await _token();
    const request = { subject: String(subject).slice(0, 250), description: String(description || '').slice(0, 20000) };
    if (siteName) request.site = { name: String(siteName) };
    if (priority) request.priority = { name: String(priority) };
    if (requesterEmail) request.requester = { email_id: String(requesterEmail) };
    let res;
    try {
      res = await T.post(`${base}/requests`, null, { params: { input_data: JSON.stringify({ request }) }, headers: { Authorization: `Zoho-oauthtoken ${tok}`, Accept: 'application/vnd.manageengine.sdp.v3+json' } });
    } catch (e) { const st = e && e.response && e.response.status; const err = new Error(_red(`SDP POST /requests${st ? ` → HTTP ${st}` : ` → ${e.message}`}`)); err.status = st; throw err; }
    const r = (res && res.data && res.data.request) || {};
    return { id: r.id || null, display_id: r.display_id || null };
  }

  // rows a default listing can hold — a result this long was probably cut off
  return { configured, listOpenRequests, createRequest, writeEnabled, pageCap: 100 * MAX_PAGES, lastMeta: () => ({ ...meta }) };
}

module.exports = { makeSdpClient, FIELDS };
