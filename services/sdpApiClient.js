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
function _defaultTransport() {
  if (!_axios) _axios = require('axios');
  return {
    get: (url, opts) => _axios.get(url, { timeout: 30000, ...opts }),
    post: (url, body, opts) => _axios.post(url, body, { timeout: 30000, ...opts }),
  };
}

function makeSdpClient({ baseUrl, accountsUrl = 'https://accounts.zoho.com', clientId, clientSecret, refreshToken,
  openFilter = 'Open_System', excludeStatuses = [], transport } = {}) {
  const T = transport || _defaultTransport();
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
      throw new Error(`Zoho OAuth token refresh failed${st ? ` (HTTP ${st})` : `: ${e.message}`}`);
    }
    const d = (res && res.data) || {};
    if (!d.access_token) throw new Error(`Zoho OAuth token refresh refused: ${d.error || 'no access_token returned'}`);
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
          params: { input_data: JSON.stringify({ list_info: li }) },
          headers: { Authorization: `Zoho-oauthtoken ${tok}`, Accept: 'application/vnd.manageengine.sdp.v3+json' },
        });
      } catch (e) {
        const st = e && e.response && e.response.status;
        const msg = e && e.response && e.response.data && JSON.stringify(e.response.data).slice(0, 300);
        const err = new Error(`SDP GET /requests${st ? ` → HTTP ${st}` : ` → ${e.message}`}${msg ? ` ${msg}` : ''}`);
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

  // rows a default listing can hold — a result this long was probably cut off
  return { configured, listOpenRequests, pageCap: 100 * MAX_PAGES, lastMeta: () => ({ ...meta }) };
}

module.exports = { makeSdpClient, FIELDS };
